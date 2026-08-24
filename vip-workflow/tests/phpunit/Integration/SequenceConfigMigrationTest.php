<?php
/**
 * Integration coverage for the stored-sequence normalization migration.
 *
 * Sequence::prepare_config_for_write() is a WRITE-time gate: it runs on
 * create/update and nowhere else. The read path deliberately has no fallbacks,
 * so every stage rule added to that gate turned each row already in the database
 * into a latent fatal — nothing re-ran the gate over stored data, and the first
 * read that touched regions threw.
 *
 * The 2.17.0 and 2.19.0 migrations close that by replaying stored configs through
 * the same gate. These tests drive them against real rows inserted with direct SQL
 * (the only way to reproduce a pre-gate row, since every supported write path
 * normalizes).
 *
 * SequenceRepository::repair_stage_regions() is the same repair applied to one
 * sequence on author request, so it is covered here too, against the same rows —
 * the two must not disagree about what a stored config can be repaired into.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Database\Schema;

/**
 * Real-WordPress tests for the stored-config replay migration.
 */
class SequenceConfigMigrationTest extends TestCase
{
	/**
	 * Insert a sequence row with direct SQL, bypassing the write gate.
	 *
	 * The repository cannot be used here: create()/update() run
	 * prepare_config_for_write(), which is precisely the normalization these rows
	 * must be missing.
	 *
	 * @param  string $slug   Sequence slug.
	 * @param  array  $config Raw config to persist verbatim.
	 * @param  string $type   Sequence type.
	 * @return int Inserted sequence ID.
	 */
	private function insert_unnormalized( string $slug, array $config, string $type = 'workflow' ): int
	{
		global $wpdb;

		$wpdb->insert(
			$wpdb->prefix . 'vip_sequences',
			array(
				'uuid'        => wp_generate_uuid4(),
				'type'        => $type,
				'name'        => $slug,
				'slug'        => $slug,
				'description' => '',
				'version'     => 1,
				'status'      => 'active',
				'config'      => wp_json_encode( $config ),
				'created_by'  => 1,
				'created_at'  => current_time( 'mysql' ),
				'updated_at'  => current_time( 'mysql' ),
			)
		);

		return (int) $wpdb->insert_id;
	}

	/**
	 * Versions of the migration entries that replay stored configs through the gate.
	 *
	 * The repair ships as two entries, not one: 2.17.0 replays the configs, and
	 * 2.19.0 replays them again with the checkpoint reroute applied to the rows
	 * 2.17.0 could only give up on. It had to be a second version because an install
	 * that has already run 2.17.0 never re-evaluates it — see
	 * test_install_from_the_previous_release_repairs_an_illegal_crossing(), which is
	 * the one test here that proves the version gate lets the repair through.
	 */
	private const REPLAY_MIGRATIONS = array( '2.17.0', '2.19.0' );

	/**
	 * Run the stored-config replay migrations, in isolation from version bookkeeping.
	 *
	 * Invoking install() would also run create_tables(); this reaches the entries
	 * under test directly so a failure names the repair rather than the upgrade.
	 * What it deliberately does NOT cover is whether an install ever reaches those
	 * entries — that is the version gate, and it has its own test below.
	 */
	private function run_normalization_migration(): void
	{
		$method     = new \ReflectionMethod( Schema::class, 'get_migrations' );
		$migrations = $method->invoke( new Schema() );

		$ran = array();

		foreach ( $migrations as $migration ) {
			if ( in_array( $migration['version'], self::REPLAY_MIGRATIONS, true ) ) {
				( $migration['run'] )();
				$ran[] = $migration['version'];
			}
		}

		$this->assertSame(
			self::REPLAY_MIGRATIONS,
			$ran,
			'Both stored-config replay migrations must be registered, in ascending order.'
		);
	}

	/**
	 * Read a stored config back out of the database.
	 *
	 * @param  int $id Sequence ID.
	 * @return array
	 */
	private function stored_config( int $id ): array
	{
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$json = $wpdb->get_var(
			$wpdb->prepare( "SELECT config FROM {$wpdb->prefix}vip_sequences WHERE id = %d", $id ) // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		);

		return (array) json_decode( (string) $json, true );
	}

	/**
	 * The exact reproduction: two stages share the `draft` region and neither
	 * carries the checkpoint marker, so get_region_entry_stage() throws. After the
	 * migration the region resolves to its first stage.
	 */
	public function test_migration_backfills_a_missing_region_entry_in_a_multi_stage_region(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-no-checkpoint',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
					array( 'key' => 'ai_desk', 'label' => 'AI Desk', 'status' => 'draft' ),
					array( 'key' => 'review', 'label' => 'Review', 'status' => 'pending' ),
					array( 'key' => 'published', 'label' => 'Published', 'status' => 'publish' ),
				),
			)
		);

		$before = ( new SequenceRepository() )->find( $id );

		try {
			$before->get_region_entry_stage( 'draft' );
			$this->fail( 'A used region with no checkpoint must throw before the migration runs.' );
		} catch ( \InvalidArgumentException $e ) {
			$this->assertStringContainsString( 'no entry checkpoint', $e->getMessage() );
		}

		$this->run_normalization_migration();

		$after = ( new SequenceRepository() )->find( $id );

		$this->assertSame( 'draft', $after->get_region_entry_stage( 'draft' ), 'First stage in the region becomes its checkpoint.' );
		$this->assertSame( 'review', $after->get_region_entry_stage( 'pending' ) );
		$this->assertSame( 'published', $after->get_region_entry_stage( 'publish' ) );
		$this->assertNull( $after->get_region_entry_stage( 'private' ), 'An unused region still has no entry.' );
	}

	/**
	 * A row predating the stage x status matrix has no `status` on any stage, so
	 * every region read throws. The migration seats the unprovable ones in `draft`
	 * — the gate's least-privileged default — and designates a checkpoint.
	 */
	public function test_migration_backfills_absent_status_regions(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-no-regions',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft' ),
					array( 'key' => 'review', 'label' => 'Review' ),
				),
			)
		);

		$this->assertNotEmpty(
			( new SequenceRepository() )->find( $id )->get_stages_missing_region(),
			'Precondition: the inserted row has region-less stages.'
		);

		$this->run_normalization_migration();

		$after = ( new SequenceRepository() )->find( $id );

		$this->assertSame( array(), $after->get_stages_missing_region() );
		$this->assertSame( 'draft', $after->get_region_entry_stage( 'draft' ) );
	}

	/**
	 * The regression this migration must never reintroduce.
	 *
	 * Defaulting every region-less stage to `draft` puts a legacy publishing stage
	 * in the draft region. Transitioning to it then crosses no region boundary, so
	 * no post_status is written and the post silently stays a draft — the default
	 * sequence's Publish step stops publishing, with no error anywhere.
	 *
	 * The legacy `publish` flag proves the region, so that stage must land in
	 * `publish` and the sequence must still be able to cross the boundary.
	 */
	public function test_migration_seats_a_legacy_publish_flagged_stage_in_the_publish_region(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-publish-flag',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'transitions' => array( array( 'to' => 'ready' ) ) ),
					array( 'key' => 'ready', 'label' => 'Ready', 'transitions' => array( array( 'to' => 'publish' ) ) ),
					array( 'key' => 'publish', 'label' => 'Published', 'is_terminal' => true, 'publish' => true ),
				),
			)
		);

		$this->run_normalization_migration();

		$after = ( new SequenceRepository() )->find( $id );

		$this->assertSame( 'publish', $after->get_stage_status( 'publish' ), 'The publish-flagged stage is in the publish region, not draft.' );
		$this->assertSame( 'publish', $after->get_region_entry_stage( 'publish' ), 'And it is that region\'s sole checkpoint.' );
		$this->assertSame( 'draft', $after->get_region_entry_stage( 'draft' ) );
		$this->assertTrue(
			$after->is_region_crossing( 'ready', 'publish' ),
			'Transitioning to it still crosses a region boundary, so post_status is still written.'
		);
	}

	/**
	 * `is_terminal` alone must NOT promote: a pipeline can end in rejection as well
	 * as publication. A hiring sequence ends at both `hired` and `rejected`; a
	 * scouting sequence at both `drafted` (published) and `passed` (declined).
	 * Promoting on terminality would publish declined posts.
	 */
	public function test_migration_does_not_promote_a_terminal_stage_without_the_publish_flag(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-terminal-only',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'applied', 'label' => 'Applied' ),
					array( 'key' => 'hired', 'label' => 'Hired', 'is_terminal' => true ),
					array( 'key' => 'rejected', 'label' => 'Rejected', 'is_terminal' => true ),
				),
			)
		);

		$this->run_normalization_migration();

		$after = ( new SequenceRepository() )->find( $id );

		$this->assertSame( 'draft', $after->get_stage_status( 'hired' ) );
		$this->assertSame( 'draft', $after->get_stage_status( 'rejected' ) );
		$this->assertNull( $after->get_region_entry_stage( 'publish' ), 'No stage was promoted into the publish region.' );
	}

	/**
	 * A mixed row: only the publish-flagged terminal stage is promoted, while a
	 * sibling terminal stage that represents rejection stays in draft.
	 */
	public function test_migration_promotes_only_the_publish_flagged_terminal_stage(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-mixed-terminals',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'scouting', 'label' => 'Scouting' ),
					array( 'key' => 'drafted', 'label' => 'Drafted', 'is_terminal' => true, 'publish' => true ),
					array( 'key' => 'passed', 'label' => 'Passed', 'is_terminal' => true ),
				),
			)
		);

		$this->run_normalization_migration();

		$after = ( new SequenceRepository() )->find( $id );

		$this->assertSame( 'publish', $after->get_stage_status( 'drafted' ) );
		$this->assertSame( 'draft', $after->get_stage_status( 'passed' ), 'A rejection stage must never be promoted into publish.' );
	}

	/**
	 * An explicitly declared region always wins. The migration only ever SUPPLIES a
	 * region where none was declared — it must never override an author's choice,
	 * even when a stale legacy flag disagrees.
	 */
	public function test_migration_never_overrides_a_declared_region(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-declared-wins',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					// Declares `draft` while still carrying the legacy publish flag.
					array( 'key' => 'archived', 'label' => 'Archived', 'status' => 'draft', 'publish' => true ),
				),
			)
		);

		$this->run_normalization_migration();

		$this->assertSame(
			'draft',
			( new SequenceRepository() )->find( $id )->get_stage_status( 'archived' ),
			'The declared region is respected over the legacy flag.'
		);
	}

	/**
	 * Sequences whose regions had to be inferred are recorded for the admin notice.
	 * A migration that repaired them silently would be the same broken promise the
	 * repair exists to end.
	 */
	public function test_migration_records_sequences_needing_region_review(): void
	{
		delete_option( Schema::REGION_REVIEW_OPTION );

		$cannot_publish = $this->insert_unnormalized(
			'legacy-review-record-no-publish',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array( array( 'key' => 'spec', 'label' => 'Spec' ) ),
			)
		);

		$can_publish = $this->insert_unnormalized(
			'legacy-review-record-publishes',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'writing', 'label' => 'Writing' ),
					array( 'key' => 'live', 'label' => 'Live', 'publish' => true ),
				),
			)
		);

		$this->run_normalization_migration();

		$recorded = get_option( Schema::REGION_REVIEW_OPTION );
		$this->assertIsArray( $recorded );

		$by_id = array_column( $recorded, null, 'id' );

		$this->assertArrayHasKey( $cannot_publish, $by_id );
		$this->assertFalse( $by_id[ $cannot_publish ]['reaches_publish'], 'A sequence left unable to publish is flagged as such.' );
		$this->assertSame( array( 'spec' ), $by_id[ $cannot_publish ]['stage_keys'] );

		$this->assertArrayHasKey( $can_publish, $by_id );
		$this->assertTrue( $by_id[ $can_publish ]['reaches_publish'], 'A sequence that kept its publish region is reported as still able to publish.' );
		$this->assertSame( array( 'writing' ), $by_id[ $can_publish ]['stage_keys'], 'Only the defaulted stage is listed; the proven one is not.' );
	}

	/**
	 * A fully-declared sequence contributes nothing to the review record, so a
	 * re-run cannot resurrect a notice an admin already dismissed.
	 */
	public function test_an_already_regioned_sequence_is_not_recorded_for_review(): void
	{
		$this->insert_unnormalized(
			'legacy-fully-declared',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
					array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
				),
			)
		);

		delete_option( Schema::REGION_REVIEW_OPTION );

		$this->run_normalization_migration();

		$recorded = (array) get_option( Schema::REGION_REVIEW_OPTION, array() );
		$slugs    = array_column( $recorded, 'name' );

		$this->assertNotContains( 'legacy-fully-declared', $slugs );
	}

	/**
	 * A legacy transition to `future` — a stage back when stage WAS post_status,
	 * an overlay now — is dropped, because the write gate would otherwise reject
	 * the whole config as dangling and leave the row unmigrated.
	 */
	public function test_migration_drops_a_legacy_transition_to_a_core_status(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-future-target',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'ready',
						'label'       => 'Ready',
						'transitions' => array(
							array( 'to' => 'publish' ),
							array( 'to' => 'future' ),
						),
					),
					array( 'key' => 'publish', 'label' => 'Published' ),
				),
			)
		);

		$this->run_normalization_migration();

		$config  = $this->stored_config( $id );
		$targets = array_column( $config['statuses'][0]['transitions'], 'to' );

		$this->assertSame( array( 'publish' ), $targets, 'The overlay target is gone; the real stage target survives.' );
		$this->assertSame( array(), ( new SequenceRepository() )->find( $id )->get_stages_missing_region() );
	}

	/**
	 * A dangling target that is NOT a core status is left alone: it is a typo or a
	 * deleted stage, and silently deleting it would discard a destination the
	 * author may still want. The row stays unmigrated for a human to resolve.
	 */
	public function test_migration_leaves_a_non_core_dangling_target_for_manual_repair(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-typo-target',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'draft',
						'label'       => 'Draft',
						'transitions' => array( array( 'to' => 'revieww' ) ),
					),
				),
			)
		);

		$this->run_normalization_migration();

		$config = $this->stored_config( $id );

		$this->assertSame(
			array( 'revieww' ),
			array_column( $config['statuses'][0]['transitions'], 'to' ),
			'The typo target is preserved rather than silently dropped.'
		);
		$this->assertArrayNotHasKey(
			'status',
			$config['statuses'][0],
			'The row is left wholly untouched, so the author sees it unchanged in the editor.'
		);
	}

	/**
	 * A malformed row does not abort the run: the migration must still normalize
	 * every other sequence, or one bad sequence would keep the whole install
	 * latently broken.
	 */
	public function test_migration_continues_past_an_unnormalizable_row(): void
	{
		delete_option( Schema::REGION_REVIEW_OPTION );

		$broken = $this->insert_unnormalized(
			'legacy-duplicate-keys',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft' ),
					array( 'key' => 'draft', 'label' => 'Draft Again' ),
				),
			)
		);

		$healthy = $this->insert_unnormalized(
			'legacy-healthy',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
			)
		);

		$this->run_normalization_migration();

		$this->assertArrayNotHasKey(
			'status',
			$this->stored_config( $broken )['statuses'][0],
			'The unnormalizable row is left for manual repair.'
		);
		$this->assertSame(
			'draft',
			( new SequenceRepository() )->find( $healthy )->get_region_entry_stage( 'draft' ),
			'A later row is still normalized despite the earlier failure.'
		);

		$recorded = array_column( (array) get_option( Schema::REGION_REVIEW_OPTION, array() ), null, 'id' );

		$this->assertArrayHasKey( $broken, $recorded, 'Continuing past a row is not the same as saying nothing about it.' );
	}

	/**
	 * A crossing that lands mid-region is migrated as the author wrote it. The
	 * gate does not ask where a crossing points, so there is nothing to repair and
	 * the transition keeps its target along with its policy.
	 *
	 * The row is still recorded, because its regions had to be inferred — but it
	 * is named for THAT and nothing else, so the notice does not accuse the
	 * migration of reshaping a sequence it left alone.
	 */
	public function test_migration_keeps_a_crossing_that_misses_the_checkpoint(): void
	{
		delete_option( Schema::REGION_REVIEW_OPTION );

		$id = $this->insert_unnormalized(
			'legacy-crossing-misses-checkpoint',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'writing',
						'label'       => 'Writing',
						// Straight into the publish region's second stage.
						'transitions' => array(
							array( 'to' => 'promoted', 'label' => 'Send to promo', 'required_roles' => array( 'editor' ) ),
						),
					),
					array( 'key' => 'live', 'label' => 'Live', 'publish' => true ),
					array( 'key' => 'promoted', 'label' => 'Promoted', 'publish' => true ),
				),
			)
		);

		$this->run_normalization_migration();

		$config     = $this->stored_config( $id );
		$transition = $config['statuses'][0]['transitions'][0];

		$this->assertSame( 'promoted', $transition['to'], 'The crossing still lands where the author aimed it.' );
		$this->assertSame( 'Send to promo', $transition['label'], 'The transition keeps its label.' );
		$this->assertSame( array( 'editor' ), $transition['required_roles'], 'The transition keeps its policy.' );

		$sequence = ( new SequenceRepository() )->find( $id );

		$this->assertSame( array(), $sequence->get_stages_missing_region(), 'And it gains the regions the migration exists to give it.' );
		$this->assertSame( 'live', $sequence->get_region_entry_stage( 'publish' ), 'The checkpoint keeps its own job: where core lands a post.' );

		$recorded = array_column( (array) get_option( Schema::REGION_REVIEW_OPTION, array() ), null, 'id' );

		$this->assertArrayHasKey( $id, $recorded, 'The inferred region still reaches the admin notice.' );
		$this->assertSame( array( 'writing' ), $recorded[ $id ]['stage_keys'] );
		$this->assertSame( array(), $recorded[ $id ]['dropped'], 'Nothing had to be removed.' );
		$this->assertNull( $recorded[ $id ]['error'] );
	}

	/**
	 * The whole failure path this repair closes, driven through the real entry
	 * point from where a 2.16.x site is actually sitting.
	 *
	 * A stage holding two transitions to one target is a legacy shape: the gate that
	 * wrote these rows tolerated it verbatim, and the rule rejecting it arrived
	 * later. Without a repair the row could never migrate — the 2.17.0 pass was
	 * rejected, and so was the 2.19.0 pass, because the reroute runs the same gate
	 * before it repairs anything. The row kept NO `status` region, which every read
	 * that touches regions throws on, the admin notice sent the operator to a canvas
	 * that keys edges by `from->to` and so cannot show the duplicate at all, and any
	 * save from there hit the same rejection.
	 *
	 * Both passes run here, in one upgrade: 2.17.0 rejects the row and records the
	 * error, 2.19.0 repairs it and its record REPLACES the error one (records merge
	 * by sequence id). Neither pass aborts the upgrade — the per-row `continue` is
	 * what guarantees that, since run_migrations() turns any Throwable out of a
	 * migration body into a RuntimeException and stops.
	 */
	public function test_install_migrates_a_legacy_row_holding_two_transitions_to_one_target(): void
	{
		$version_option = (string) ( new \ReflectionClass( Schema::class ) )
			->getReflectionConstant( 'VERSION_OPTION' )
			->getValue();

		delete_option( Schema::REGION_REVIEW_OPTION );

		$id = $this->insert_unnormalized(
			'legacy-duplicate-target',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'transitions' => array(
							array( 'to' => 'live', 'label' => 'Publish', 'allowed_roles' => array( 'editor' ) ),
							// The weaker copy: no roles at all, so at runtime it
							// widened the transition to everyone while the first
							// still decided the required tools.
							array( 'to' => 'live' ),
						),
					),
					array( 'key' => 'live', 'label' => 'Live', 'publish' => true ),
				),
			)
		);

		// A site coming from 2.16.x: it has run neither replay.
		update_option( $version_option, '2.16.0' );

		( new Schema() )->install();

		$config = $this->stored_config( $id );

		$this->assertCount( 1, $config['statuses'][0]['transitions'], 'One transition per target, never two.' );
		$this->assertSame(
			array( 'editor' ),
			$config['statuses'][0]['transitions'][0]['allowed_roles'],
			'The first declared transition survives with its policy; the copy that widened it is gone.'
		);

		$sequence = ( new SequenceRepository() )->find( $id );

		$this->assertSame(
			array(),
			$sequence->get_stages_missing_region(),
			'The row is no longer stranded without the regions every read needs.'
		);
		$this->assertSame( 'live', $sequence->get_region_entry_stage( 'publish' ) );

		$recorded = array_column( (array) get_option( Schema::REGION_REVIEW_OPTION, array() ), null, 'id' );

		$this->assertArrayHasKey( $id, $recorded, 'The reshaped sequence is named in the admin notice.' );
		$this->assertSame(
			array( array( 'from' => 'review', 'to' => 'live' ) ),
			$recorded[ $id ]['dropped'],
			'The removed transition is reported — deleting it in silence is what these repairs exist to end.'
		);
		$this->assertNull(
			$recorded[ $id ]['error'],
			'The 2.19.0 record replaces the error the 2.17.0 pass wrote, rather than listing the row twice.'
		);

		$this->assertSame(
			Schema::VERSION,
			get_option( $version_option ),
			'The upgrade ran to completion: a rejected row is continued past, not thrown on.'
		);
	}

	/**
	 * The gate every repair in this file has to get through: the version guard.
	 *
	 * Schema::install() returns early when the stored DB version is already at or
	 * past Schema::VERSION, and run_migrations() skips any entry whose version the
	 * stored one has passed. So a repair added to the BODY of an existing migration
	 * entry is dead code on precisely the installs it was written for — every site
	 * that already took the release which shipped that entry.
	 *
	 * That is what happened: a repair went into 2.17.0's body while
	 * Schema::VERSION stayed at 2.18.0, and every test above missed it, because they
	 * reach into get_migrations() and call the closure directly. So this one drives
	 * the real entry point, from the version the previous release left behind.
	 */
	public function test_install_from_the_previous_release_repairs_a_duplicate_target(): void
	{
		$version_option = (string) ( new \ReflectionClass( Schema::class ) )
			->getReflectionConstant( 'VERSION_OPTION' )
			->getValue();

		delete_option( Schema::REGION_REVIEW_OPTION );

		$id = $this->insert_unnormalized(
			'legacy-duplicate-on-an-upgraded-install',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'writing',
						'label'       => 'Writing',
						'transitions' => array(
							array( 'to' => 'live', 'label' => 'Publish', 'allowed_roles' => array( 'editor' ) ),
							array( 'to' => 'live' ),
						),
					),
					array( 'key' => 'live', 'label' => 'Live', 'publish' => true ),
				),
			)
		);

		// Where a site that has taken every previous release is sitting.
		update_option( $version_option, '2.18.0' );

		( new Schema() )->install();

		$transitions = $this->stored_config( $id )['statuses'][0]['transitions'];

		$this->assertCount(
			1,
			$transitions,
			'An upgrade from the previous release repairs the row, rather than skipping the migration that carries the repair.'
		);
		$this->assertSame( array( 'editor' ), $transitions[0]['allowed_roles'], 'The first declared transition survives with its policy.' );

		$sequence = ( new SequenceRepository() )->find( $id );

		$this->assertSame( array(), $sequence->get_stages_missing_region(), 'And the row gains the regions the replay exists to give it.' );
		$this->assertSame( 'live', $sequence->get_region_entry_stage( 'publish' ) );

		$recorded = array_column( (array) get_option( Schema::REGION_REVIEW_OPTION, array() ), null, 'id' );

		$this->assertArrayHasKey( $id, $recorded, 'The reshaped sequence still reaches the admin notice.' );
		$this->assertSame(
			array( array( 'from' => 'writing', 'to' => 'live' ) ),
			$recorded[ $id ]['dropped']
		);

		$this->assertSame(
			Schema::VERSION,
			get_option( $version_option ),
			'The upgrade records the version it reached, so the repair does not run again.'
		);
	}

	/**
	 * A row the migration cannot normalize at all is recorded for the admin notice.
	 *
	 * It used to be logged to `error_log` and dropped, which meant the one sequence
	 * an operator most needed to hear about was the one the notice never mentioned —
	 * and it stays region-less, so every read that touches its regions throws.
	 */
	public function test_migration_records_a_row_it_could_not_normalize(): void
	{
		delete_option( Schema::REGION_REVIEW_OPTION );

		$id = $this->insert_unnormalized(
			'legacy-unrepairable',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					// A dangling target that is not a core status: no inferable fix.
					array(
						'key'         => 'draft',
						'label'       => 'Draft',
						'transitions' => array( array( 'to' => 'revieww' ) ),
					),
				),
			)
		);

		$this->run_normalization_migration();

		$recorded = array_column( (array) get_option( Schema::REGION_REVIEW_OPTION, array() ), null, 'id' );

		$this->assertArrayHasKey( $id, $recorded, 'The skipped row reaches the admin notice.' );
		$this->assertSame( 'legacy-unrepairable', $recorded[ $id ]['name'], 'Named, so an admin can find it.' );
		$this->assertStringContainsString(
			'revieww',
			(string) $recorded[ $id ]['error'],
			'The record says what is actually wrong with the row.'
		);
	}

	/**
	 * A sequence that needed no repair contributes no record at all, so the notice
	 * never nags about a row the migration did not touch.
	 */
	public function test_a_repaired_sequence_is_recorded_but_a_clean_one_is_not(): void
	{
		delete_option( Schema::REGION_REVIEW_OPTION );

		$this->insert_unnormalized(
			'legacy-already-legal',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'draft',
						'label'        => 'Draft',
						'status'       => 'draft',
						'region_entry' => true,
						'transitions'  => array( array( 'to' => 'live' ) ),
					),
					array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true ),
				),
			)
		);

		$this->run_normalization_migration();

		$names = array_column( (array) get_option( Schema::REGION_REVIEW_OPTION, array() ), 'name' );

		$this->assertNotContains( 'legacy-already-legal', $names );
	}

	/**
	 * Phase sequences carry a `phases` graph, not stages, and the gate exempts
	 * them — the migration must not rewrite them either.
	 */
	public function test_migration_leaves_phase_sequences_untouched(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-phases',
			array( 'phases' => array( array( 'key' => 'ideation' ) ) ),
			'phase'
		);

		$before = $this->stored_config( $id );

		$this->run_normalization_migration();

		$this->assertSame( $before, $this->stored_config( $id ) );
	}

	/**
	 * Normalization is pure, so a second replay is a no-op. This matters because
	 * the migration runner re-runs a migration after any failure, and fresh
	 * installs run every migration against already-current data.
	 */
	public function test_migration_is_idempotent(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-idempotent',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
					array( 'key' => 'ai_desk', 'label' => 'AI Desk', 'status' => 'draft' ),
				),
			)
		);

		$this->run_normalization_migration();
		$first = $this->stored_config( $id );

		$this->run_normalization_migration();

		$this->assertSame( $first, $this->stored_config( $id ), 'A second replay changes nothing.' );
	}

	/**
	 * The seeded AI Copy Desk fixture is the live reproduction's source of truth,
	 * so it must itself satisfy the gate without normalization — regions and
	 * checkpoints declared, and the copy-edit agent's real registered ability id.
	 */
	public function test_ai_copy_desk_fixture_already_satisfies_the_write_gate(): void
	{
		$fixture = json_decode(
			(string) file_get_contents( dirname( __DIR__, 2 ) . '/fixtures/ai-copy-desk-workflow.json' ),
			true
		);

		$this->assertIsArray( $fixture, 'The fixture is valid JSON.' );

		$normalized = Sequence::prepare_config_for_write( $fixture['config'], 'workflow' );

		$this->assertSame(
			$fixture['config']['statuses'],
			$normalized['statuses'],
			'The fixture is already normalized; the gate has nothing to add.'
		);

		$regions = array_column( $normalized['statuses'], 'status', 'key' );
		$this->assertSame(
			array(
				'draft'        => 'draft',
				'ai_copy_desk' => 'draft',
				'review'       => 'pending',
				'published'    => 'publish',
			),
			$regions,
			'The terminal stage lives in the publish region, not draft.'
		);

		$agent = $normalized['statuses'][1]['agent'];
		$this->assertSame(
			'workflow-agent-copy-edit/copy-edit',
			$agent['ability_id'],
			'The agent names the ability id the copy-edit plugin actually registers.'
		);
	}

	/**
	 * The author's escape hatch has to work on the sequences it exists for.
	 *
	 * A row old enough to have no regions is old enough to predate the rule that a
	 * stage holds at most one transition per target, so replaying it through the
	 * gate alone fails and "Assign default status" returns a 400 on exactly the
	 * sequence the button is offered for. The repair collapses the duplicate on
	 * the way through, and names what that cost.
	 */
	public function test_repair_fixes_regions_on_a_row_that_also_holds_a_duplicate_target(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-repair-with-duplicate',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'writing',
						'label'       => 'Writing',
						'transitions' => array(
							array( 'to' => 'live', 'label' => 'Send to promo' ),
							array( 'to' => 'live', 'label' => 'Send to promo again' ),
						),
					),
					array( 'key' => 'live', 'label' => 'Live', 'publish' => true, 'status' => 'publish' ),
				),
			)
		);

		$repository = new SequenceRepository();

		$this->assertSame( array( 'writing' ), $repository->find( $id )->get_stages_missing_region() );

		$repaired = $repository->repair_stage_regions( $id );

		$this->assertIsArray( $repaired, 'The repair succeeds rather than returning a WP_Error.' );
		$this->assertSame( $id, $repaired['id'] );

		// The repair reports what it removed. It travels to the REST layer and into
		// the editor's notice: a repair that reshapes an author's sequence without
		// saying so is the silent change this whole path exists to end.
		$this->assertSame(
			array( array( 'from' => 'writing', 'to' => 'live' ) ),
			$repaired['dropped']
		);

		$sequence = $repository->find( $id );

		$this->assertSame( array(), $sequence->get_stages_missing_region(), 'The region the button promises is assigned.' );
		$this->assertCount(
			1,
			$sequence->get_statuses()[0]['transitions'],
			'The duplicate that blocked the repair is gone.'
		);
		$this->assertSame(
			'Send to promo',
			$sequence->get_statuses()[0]['transitions'][0]['label'],
			'The surviving transition keeps its configuration.'
		);
	}

	/**
	 * A failure no repair can infer still fails — and says which transition is
	 * wrong, so the author knows what to open rather than meeting a bare refusal.
	 */
	public function test_repair_names_the_problem_it_cannot_fix(): void
	{
		$id = $this->insert_unnormalized(
			'legacy-repair-unfixable',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'writing',
						'label'       => 'Writing',
						'transitions' => array( array( 'to' => 'revieww' ) ),
					),
				),
			)
		);

		$error = ( new SequenceRepository() )->repair_stage_regions( $id );

		$this->assertInstanceOf( \WP_Error::class, $error );
		$this->assertSame( 'sequence_invalid', $error->get_error_code() );
		$this->assertStringContainsString( 'revieww', $error->get_error_message() );
	}
}
