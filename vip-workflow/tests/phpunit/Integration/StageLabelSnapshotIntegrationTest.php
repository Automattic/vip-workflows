<?php
/**
 * Integration coverage: stage labels are snapshotted into the workflow audit trail.
 *
 * Stage keys are minted by the sequence editor as `status_1`, `status_2`, … and are
 * permanently decoupled from the author-editable label, so any surface that prints
 * the key shows `status_3` forever. Every workflow event that names a stage must
 * therefore record the label the stage carried at the moment the event happened.
 *
 * The fixture sequence deliberately uses generated `status_<n>` keys with labels
 * that share no text with them: a fixture whose keys already read like labels
 * would pass with the bug still present.
 *
 * Driven end to end (real sequence rows, real posts, real StatusManager, real
 * registered abilities) because the write paths are private and reachable only
 * through transition() / assign_sequence() / remove_sequence().
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Database\Schema;
use VIPWorkflow\Workflow\StatusManager;

/**
 * Exposes the label-repair migration step for direct testing.
 */
class StageLabelRepairProbe extends Schema
{
	/**
	 * Run the 2.18.0 repair.
	 *
	 * @return int Number of rows rewritten.
	 */
	public static function run_repair(): int
	{
		return self::repair_fabricated_stage_labels();
	}
}

/**
 * Real-WordPress tests for stage-label snapshots in the audit trail.
 */
class StageLabelSnapshotIntegrationTest extends TestCase
{
	private const HARD_CHECK = 'vip-workflow/test-stage-label-hard-check';

	private const SOFT_CHECK = 'vip-workflow/test-stage-label-soft-check';

	/**
	 * Sequence name — also the sequence identity the migration resolves by.
	 */
	private const SEQUENCE_NAME = 'Label Snapshot Flow';

	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Editor user ID — deliberately NOT an administrator, because
	 * administrators bypass tool checks and would never produce a
	 * `transition_blocked` or `tool_warnings` row.
	 *
	 * @var int
	 */
	private int $editor_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->editor_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $this->editor_id );

		$this->register_check_abilities();

		// Every stage sits in the `draft` region on purpose: no move crosses a
		// region boundary, so nothing writes post_status and the test is isolated
		// to what the audit rows record.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			self::SEQUENCE_NAME,
			'label-snapshot-flow',
			'',
			$this->sequence_config(),
			$this->editor_id
		);
	}

	// =========================================================================
	// Fixtures
	// =========================================================================

	/**
	 * Sequence config using generated stage keys and unrelated labels.
	 *
	 * @param  string $status_2_label Label for the `status_2` stage (varied by the rename test).
	 * @return array
	 */
	private function sequence_config( string $status_2_label = 'Copy Desk' ): array
	{
		return array(
			'post_types' => array( 'post' ),
			'statuses'   => array(
				array(
					'key'          => 'status_1',
					'label'        => 'Ideas',
					'status'       => 'draft',
					'region_entry' => true,
					'transitions'  => array(
						array( 'to' => 'status_2' ),
						array(
							'to'             => 'status_3',
							'required_tools' => array( self::HARD_CHECK ),
						),
						array(
							'to'             => 'status_4',
							'required_tools' => array( self::SOFT_CHECK ),
						),
					),
				),
				array(
					'key'         => 'status_2',
					'label'       => $status_2_label,
					'status'      => 'draft',
					'transitions' => array(),
				),
				array(
					'key'         => 'status_3',
					'label'       => 'Legal Hold',
					'status'      => 'draft',
					'transitions' => array(),
				),
				array(
					'key'         => 'status_4',
					'label'       => 'Fact Check',
					'status'      => 'draft',
					'transitions' => array(),
				),
			),
		);
	}

	/**
	 * Register one hard-failing and one soft-warning check ability.
	 *
	 * Abilities can only be registered while `wp_abilities_api_init` is running, so
	 * the hook is fired again with every other listener detached; WP_UnitTestCase
	 * restores `$wp_filter` afterwards. Registration is global and outlives the
	 * test, hence the guards.
	 */
	private function register_check_abilities(): void
	{
		$registered = array_map(
			static function ( $ability ): string {
				return $ability->get_name();
			},
			wp_get_abilities()
		);

		remove_all_actions( 'wp_abilities_api_init' );
		add_action(
			'wp_abilities_api_init',
			static function () use ( $registered ): void {
				$checks = array(
					self::HARD_CHECK => 'error',
					self::SOFT_CHECK => 'warning',
				);

				foreach ( $checks as $ability_id => $severity ) {
					if ( in_array( $ability_id, $registered, true ) ) {
						continue;
					}

					wp_register_ability(
						$ability_id,
						array(
							'label'               => 'Stage Label Check Fixture',
							'description'         => 'Test fixture that always reports one issue.',
							'category'            => 'vip-workflow',
							'input_schema'        => array(
								'type'       => 'object',
								'properties' => array(
									'post_id' => array( 'type' => 'integer' ),
								),
							),
							'output_schema'       => array(
								'type'       => 'object',
								'properties' => array(
									'issues' => array( 'type' => 'array' ),
								),
							),
							'execute_callback'    => static function () use ( $severity ): array {
								return array(
									'issues' => array(
										array(
											'check_key' => 'fixture',
											'severity'  => $severity,
											'message'   => 'Fixture issue.',
										),
									),
								);
							},
							'permission_callback' => static function (): bool {
								return true;
							},
						)
					);
				}
			}
		);
		do_action( 'wp_abilities_api_init' );
	}

	/**
	 * A draft post seated at `status_1` of the fixture sequence.
	 *
	 * @return int Post ID.
	 */
	private function make_workflow_post(): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->editor_id,
			)
		);

		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'status_1' );

		return $post_id;
	}

	/**
	 * Fetch the decoded event_data of the most recent event of a type for a post.
	 *
	 * @param  int    $post_id    Post ID.
	 * @param  string $event_type Event type.
	 * @return array
	 */
	private function latest_event_data( int $post_id, string $event_type ): array
	{
		global $wpdb;

		$table = Schema::get_table_name( 'workflow_events' );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$json = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT event_data FROM {$table} WHERE post_id = %d AND event_type = %s ORDER BY id DESC LIMIT 1",
				$post_id,
				$event_type
			)
		);

		$this->assertNotNull( $json, "No {$event_type} event was recorded for post {$post_id}." );

		return (array) json_decode( (string) $json, true );
	}

	// =========================================================================
	// status_transition
	// =========================================================================

	/**
	 * A committed transition records both stage labels, not the generated keys.
	 */
	public function test_status_transition_snapshots_both_stage_labels(): void
	{
		$post_id = $this->make_workflow_post();

		$result = ( new StatusManager() )->transition( $post_id, 'status_2' );
		$this->assertTrue( $result, 'The transition should commit.' );

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame( 'Ideas', $data['from_label'] );
		$this->assertSame( 'Copy Desk', $data['to_label'] );
	}

	/**
	 * get_transition_history() carries the snapshots through to its callers —
	 * the editor sidebar and the transition-history / recent-activity abilities.
	 */
	public function test_get_transition_history_returns_the_snapshotted_labels(): void
	{
		$post_id = $this->make_workflow_post();

		$status_manager = new StatusManager();
		$status_manager->transition( $post_id, 'status_2' );

		$history = $status_manager->get_transition_history( $post_id );

		$this->assertCount( 1, $history );
		$this->assertArrayHasKey( 'from_label', $history[0]['event_data'], 'get_transition_history() must not discard the labels stored on the row.' );
		$this->assertSame( 'Ideas', $history[0]['event_data']['from_label'] );
		$this->assertSame( 'Copy Desk', $history[0]['event_data']['to_label'] );
	}

	/**
	 * History is immutable: renaming a stage does not rewrite what past events
	 * were called. This is the property that pins the snapshot decision — a live
	 * lookup would show "Production" here.
	 */
	public function test_renaming_a_stage_leaves_history_showing_the_historical_name(): void
	{
		$post_id = $this->make_workflow_post();

		$status_manager = new StatusManager();
		$status_manager->transition( $post_id, 'status_2' );

		$repository = new SequenceRepository();
		$repository->update(
			$this->sequence_id,
			array( 'config' => $this->sequence_config( 'Production' ) )
		);

		// The rename really landed.
		$this->assertSame(
			'Production',
			$repository->find( $this->sequence_id )->get_status( 'status_2' )['label']
		);

		$history = $status_manager->get_transition_history( $post_id );

		$this->assertSame(
			'Copy Desk',
			$history[0]['event_data']['to_label'],
			'An audit entry must show the name the stage had at the time, not its current name.'
		);
	}

	// =========================================================================
	// transition_blocked / tool_warnings
	// =========================================================================

	/**
	 * A transition blocked by a required check records both stage labels.
	 */
	public function test_transition_blocked_snapshots_both_stage_labels(): void
	{
		$post_id = $this->make_workflow_post();

		$result = ( new StatusManager() )->transition( $post_id, 'status_3' );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'tool_check_failed', $result->get_error_code() );

		$data = $this->latest_event_data( $post_id, 'transition_blocked' );

		$this->assertSame( 'Ideas', $data['from_label'] );
		$this->assertSame( 'Legal Hold', $data['to_label'] );
	}

	/**
	 * Acknowledged soft warnings record the target stage's label.
	 */
	public function test_tool_warnings_snapshots_the_target_stage_label(): void
	{
		$post_id = $this->make_workflow_post();

		$result = ( new StatusManager() )->transition(
			$post_id,
			'status_4',
			array( 'acknowledge_warnings' => true )
		);
		$this->assertTrue( $result, 'Acknowledged warnings should not block the transition.' );

		$data = $this->latest_event_data( $post_id, 'tool_warnings' );

		$this->assertSame( 'status_4', $data['to_status'] );
		$this->assertSame( 'Fact Check', $data['to_label'] );
	}

	// =========================================================================
	// workflow.assigned / workflow.removed
	// =========================================================================

	/**
	 * Assignment records the label of the stage the post was seated at.
	 */
	public function test_workflow_assigned_snapshots_the_initial_stage_label(): void
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->editor_id,
			)
		);

		// PostTypeManager builds its post-type-to-sequence map on `init`, which has
		// already fired by the time this test inserts its sequence, so eligibility
		// is granted through the documented per-post filter instead.
		$sequence_id  = $this->sequence_id;
		$make_eligible = static function ( array $ids ) use ( $sequence_id ): array {
			$ids[] = $sequence_id;
			return $ids;
		};
		add_filter( 'vip_workflow_sequences_for_post', $make_eligible );

		try {
			$result = ( new StatusManager() )->assign_sequence( $post_id, $this->sequence_id, 'status_1' );
		} finally {
			remove_filter( 'vip_workflow_sequences_for_post', $make_eligible );
		}

		$this->assertTrue( $result );

		$data = $this->latest_event_data( $post_id, 'workflow.assigned' );

		$this->assertSame( 'status_1', $data['initial_stage'] );
		$this->assertSame( 'Ideas', $data['initial_stage_label'] );
	}

	/**
	 * Removal records the label of the stage the post was sitting at.
	 */
	public function test_workflow_removed_snapshots_the_removed_stage_label(): void
	{
		$post_id = $this->make_workflow_post();

		$result = ( new StatusManager() )->remove_sequence( $post_id );
		$this->assertTrue( $result );

		$data = $this->latest_event_data( $post_id, 'workflow.removed' );

		$this->assertSame( 'status_1', $data['removed_stage'] );
		$this->assertSame( 'Ideas', $data['removed_stage_label'] );
	}

	/**
	 * A dangling sequence reference is the one case where no label can be proven.
	 * It records null rather than a fabrication that would outlive the removal.
	 */
	public function test_workflow_removed_records_null_label_when_the_sequence_is_gone(): void
	{
		$post_id = $this->make_workflow_post();

		( new SequenceRepository() )->delete( $this->sequence_id );

		$result = ( new StatusManager() )->remove_sequence( $post_id );
		$this->assertTrue( $result );

		$data = $this->latest_event_data( $post_id, 'workflow.removed' );

		$this->assertArrayHasKey( 'removed_stage_label', $data );
		$this->assertNull( $data['removed_stage_label'] );
	}

	// =========================================================================
	// Migration 2.18.0 — repairing fabricated labels
	// =========================================================================

	/**
	 * Insert a `status_transition` row carrying the old `ucfirst()` fabrication.
	 *
	 * @param  int   $post_id  Post ID.
	 * @param  array $overrides Event-data overrides.
	 * @return int Event row ID.
	 */
	private function insert_legacy_transition_row( int $post_id, array $overrides = array() ): int
	{
		global $wpdb;

		$data = array_merge(
			array(
				'from_status'    => 'status_1',
				'to_status'      => 'status_3',
				'from_label'     => 'Status_1',
				'to_label'       => 'Status_3',
				'post_title'     => 'Legacy row',
				'sequence_name' => self::SEQUENCE_NAME,
			),
			$overrides
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->insert(
			Schema::get_table_name( 'workflow_events' ),
			array(
				'post_id'    => $post_id,
				'event_type' => 'status_transition',
				'event_data' => wp_json_encode( $data ),
				'actor_id'   => $this->editor_id,
				'actor_type' => 'user',
				'created_at' => current_time( 'mysql' ),
			)
		);

		return (int) $wpdb->insert_id;
	}

	/**
	 * The migration replaces `Status_3` with the sequence's real stage label.
	 */
	public function test_migration_repairs_a_fabricated_label(): void
	{
		$post_id = $this->make_workflow_post();
		$this->insert_legacy_transition_row( $post_id );

		$this->assertSame( 1, StageLabelRepairProbe::run_repair() );

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame( 'Ideas', $data['from_label'] );
		$this->assertSame( 'Legal Hold', $data['to_label'] );
	}

	/**
	 * The repair is idempotent: a second run finds nothing left to rewrite and
	 * leaves the repaired row byte-identical.
	 */
	public function test_migration_is_idempotent(): void
	{
		$post_id = $this->make_workflow_post();
		$this->insert_legacy_transition_row( $post_id );

		StageLabelRepairProbe::run_repair();
		$after_first = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame( 0, StageLabelRepairProbe::run_repair(), 'A second run must rewrite nothing.' );
		$this->assertSame( $after_first, $this->latest_event_data( $post_id, 'status_transition' ) );
	}

	/**
	 * An author-written label is never overwritten, even when the stage has since
	 * been renamed — only the exact `ucfirst( status_<n> )` shape is a fabrication.
	 */
	public function test_migration_leaves_a_genuine_snapshot_alone(): void
	{
		$post_id = $this->make_workflow_post();
		$this->insert_legacy_transition_row(
			$post_id,
			array(
				'from_label' => 'Ideas',
				'to_label'   => 'Legal Review',
			)
		);

		$this->assertSame( 0, StageLabelRepairProbe::run_repair() );

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame( 'Ideas', $data['from_label'] );
		$this->assertSame( 'Legal Review', $data['to_label'] );
	}

	/**
	 * A row naming a sequence that no longer resolves is skipped, not guessed at,
	 * and does not abort the repair.
	 */
	public function test_migration_skips_a_row_whose_sequence_cannot_be_resolved(): void
	{
		$post_id = $this->make_workflow_post();
		$this->insert_legacy_transition_row( $post_id, array( 'sequence_name' => 'Sequence That Never Existed' ) );

		$this->assertSame( 0, StageLabelRepairProbe::run_repair() );

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame( 'Status_1', $data['from_label'] );
		$this->assertSame( 'Status_3', $data['to_label'] );
	}
}
