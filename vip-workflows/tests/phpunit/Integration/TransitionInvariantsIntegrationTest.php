<?php
/**
 * Integration coverage for the transition invariants the suite described but
 * did not pin — the gaps called out in the #152 review.
 *
 * Each of these is an invariant the design depends on and that nothing would
 * have caught breaking: the compare-and-swap that makes two concurrent
 * transitions safe, the `private` reconcile region, cron's `future` -> `publish`
 * emitting go-live exactly once, and the per-stage entered_/exited_ hooks firing
 * for a same-region move (which produces no core status transition at all, so
 * the core hook cannot carry them).
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Real-WordPress tests for transition invariants.
 */
class TransitionInvariantsIntegrationTest extends TestCase
{
	/**
	 * A required tool that fires RACE_TOOL_HOOK while it runs, then passes.
	 */
	private const RACE_TOOL = 'vip-workflows/transition-race-fixture';

	/**
	 * Fired by the race tool with the post ID it was run for.
	 */
	private const RACE_TOOL_HOOK = 'vip_workflows_test_race_tool_ran';

	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Admin user ID.
	 *
	 * @var int
	 */
	private int $admin_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->admin_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->admin_id );

		// Four stages spanning four regions, so the reconcile tests have a
		// modelled entry stage for each and the same-region test has two stages
		// inside one region.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Transition Invariants',
			'transition-invariants',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'draft',
						'label'       => 'Draft',
						'status'      => 'draft',
						'transitions' => array(
							array( 'to' => 'second_draft', 'label' => 'Second Draft' ),
							array( 'to' => 'review', 'label' => 'Review' ),
							array( 'to' => 'live', 'label' => 'Publish' ),
						),
					),
					// Same region as `draft` on purpose: moving between them
					// writes no post_status, so core's transition_post_status
					// never fires and only the stage actions can carry the move.
					array(
						'key'         => 'second_draft',
						'label'       => 'Second Draft',
						'status'      => 'draft',
						'transitions' => array(
							array( 'to' => 'review', 'label' => 'Review' ),
						),
					),
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'status'      => 'pending',
						'transitions' => array(
							array( 'to' => 'live', 'label' => 'Publish' ),
						),
					),
					array(
						'key'         => 'vault',
						'label'       => 'Vault',
						'status'      => 'private',
						'transitions' => array(),
					),
					array(
						'key'         => 'live',
						'label'       => 'Live',
						'status'      => 'publish',
						'transitions' => array(),
					),
				),
			),
			get_current_user_id()
		);
	}

	/**
	 * A workflow post seated at the given stage with the matching core status.
	 *
	 * @param string $stage       Stage key.
	 * @param string $post_status Core status.
	 * @param array  $extra       Extra wp_insert_post args.
	 * @return int Post ID.
	 */
	private function make_post( string $stage, string $post_status, array $extra = array() ): int
	{
		$post_id = (int) self::factory()->post->create(
			array_merge(
				array(
					'post_status' => $post_status,
					'post_author' => $this->admin_id,
				),
				$extra
			)
		);

		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

		return $post_id;
	}

	/**
	 * Two concurrent transitions from the same stage: the second is REFUSED, not
	 * silently applied over the first.
	 *
	 * Both requests read the stage, both validate an edge that starts there, and
	 * both write. The stage-meta write is a compare-and-swap against the stage
	 * the transition validated against, so the loser changes nothing. Simulated
	 * by performing the winning move and then replaying the losing one, which is
	 * exactly the state the loser's write would meet.
	 */
	public function test_a_transition_whose_stage_moved_underneath_it_is_refused(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$manager = new StatusManager();

		// Request A wins the race.
		$this->assertTrue( $manager->transition( $post_id, 'second_draft' ) );
		$this->assertSame( 'second_draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		// Request B validated against `draft` and now tries to write. Replayed by
		// putting the stage back to what B read, performing B, and asserting it
		// cannot land on a post that has since moved: B's edge draft -> review is
		// valid FROM draft, but the post is at second_draft.
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'second_draft' );

		$result = $manager->transition( $post_id, 'live' );

		// second_draft has no `live` edge — the point is that B's validation is
		// re-run against the CURRENT stage rather than the one it read.
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'invalid_transition', $result->get_error_code() );
		$this->assertSame( 'second_draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * The compare-and-swap itself: when the stage meta no longer holds what the
	 * transition validated against, the write is refused with a 409 conflict and
	 * the post does not move.
	 */
	public function test_stage_swap_refuses_when_the_stage_changed_mid_transition(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		// Move the stage out from under the transition at the moment the region
		// status is committed — the window between validation and the stage write.
		$hijack = function () use ( $post_id ) {
			update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'review' );
		};
		add_action( 'vip_workflows_hijack_probe', $hijack );

		// commit_post_status() runs wp_update_post, so hooking save_post gives a
		// deterministic point inside the transition, after validation.
		$fired = false;
		$probe = function () use ( &$fired, $hijack ) {
			if ( $fired ) {
				return;
			}
			$fired = true;
			$hijack();
		};
		add_action( 'save_post', $probe, 1 );

		$result = ( new StatusManager() )->transition( $post_id, 'live' );

		remove_action( 'save_post', $probe, 1 );
		remove_action( 'vip_workflows_hijack_probe', $hijack );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] );

		// The stage is the hijacker's, not the transition's target.
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		// And the status write that already landed was rolled back, so the post
		// is not left published at a pending-region stage.
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * Write the stage, and optionally the status, the way another request would.
	 *
	 * This request's caches are primed first and the rows are then changed by
	 * direct SQL, with no cache invalidation: a write from another process never
	 * reaches this request's in-memory caches.
	 *
	 * @param int         $post_id Post ID.
	 * @param string      $stage   Stage the other request moved the post to.
	 * @param string|null $status  Status it wrote, or null for none.
	 */
	private function write_from_another_request( int $post_id, string $stage, ?string $status = null ): void
	{
		global $wpdb;

		get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true );
		get_post_status( $post_id );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$wpdb->update(
			$wpdb->postmeta,
			array( 'meta_value' => $stage ), // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			array(
				'post_id'  => $post_id,
				'meta_key' => StatusManager::STAGE_META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			)
		);

		if ( null !== $status ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->update( $wpdb->posts, array( 'post_status' => $status ), array( 'ID' => $post_id ) );
		}
	}

	/**
	 * The stage and status as stored, past this request's caches.
	 *
	 * @param  int $post_id Post ID.
	 * @return array{0: string, 1: string} Stage and status.
	 */
	private function stored_state( int $post_id ): array
	{
		clean_post_cache( $post_id );

		return array(
			(string) get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ),
			(string) get_post_status( $post_id ),
		);
	}

	/**
	 * Run a transition with another request's write landing just after its
	 * status write, before its stage compare-and-swap.
	 *
	 * @param  int         $post_id Post ID.
	 * @param  string      $to      Target stage of the losing transition.
	 * @param  string      $stage   Stage the other request moves the post to.
	 * @param  string|null $status  Status the other request writes, or null for none.
	 * @return true|array|\WP_Error What the losing transition returned.
	 */
	private function lose_race_after_status_write( int $post_id, string $to, string $stage, ?string $status = null )
	{
		// save_post fires inside commit_post_status()'s wp_update_post(), after
		// the status write and before the swap.
		$fired = false;
		$probe = function ( $saved_id ) use ( &$fired, $post_id, $stage, $status ) {
			if ( $fired || (int) $saved_id !== $post_id ) {
				return;
			}
			$fired = true;
			$this->write_from_another_request( $post_id, $stage, $status );
		};
		add_action( 'save_post', $probe, 1 );

		try {
			return ( new StatusManager() )->transition( $post_id, $to );
		} finally {
			remove_action( 'save_post', $probe, 1 );
		}
	}

	/**
	 * Two moves to the same stage at once: the loser keeps the winner's status.
	 *
	 * Both requests start at Draft and both publish. The winner's stage swap
	 * takes; the loser's doesn't. The status the loser wrote is the one the
	 * winner wanted too, so the post stays published.
	 */
	public function test_losing_a_race_to_the_same_stage_keeps_the_post_published(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$result = $this->lose_race_after_status_write( $post_id, 'live', 'live' );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] );
		$this->assertSame(
			'This post moved from “Draft” to “Live” before your move was saved. Reload to see where it is now.',
			$result->get_error_message()
		);
		$this->assertSame( array( 'live', 'publish' ), $this->stored_state( $post_id ) );
	}

	/**
	 * A status written after the loser's is left alone.
	 */
	public function test_losing_a_race_leaves_a_status_written_after_it(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$result = $this->lose_race_after_status_write( $post_id, 'live', 'review', 'pending' );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( array( 'review', 'pending' ), $this->stored_state( $post_id ) );
	}

	/**
	 * A winner in the loser's own source region doesn't want the loser's
	 * status, so it is put back.
	 */
	public function test_losing_a_race_to_a_stage_in_the_source_region_puts_the_status_back(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$result = $this->lose_race_after_status_write( $post_id, 'live', 'second_draft' );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( array( 'second_draft', 'draft' ), $this->stored_state( $post_id ) );
	}

	/**
	 * A future-dated post commits `future`, which is in the publish region, so a
	 * winner at a publish stage keeps it.
	 */
	public function test_losing_a_race_keeps_a_scheduled_status_the_winner_shares(): void
	{
		$timestamp = time() + HOUR_IN_SECONDS;
		$post_id   = $this->make_post(
			'draft',
			'draft',
			array(
				'post_date'     => wp_date( 'Y-m-d H:i:s', $timestamp ),
				'post_date_gmt' => gmdate( 'Y-m-d H:i:s', $timestamp ),
			)
		);

		$result = $this->lose_race_after_status_write( $post_id, 'live', 'live' );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( array( 'live', 'future' ), $this->stored_state( $post_id ) );
	}

	/**
	 * A stage write that fails with no other writer is a 500, and the status
	 * goes back.
	 */
	public function test_a_failed_stage_write_puts_the_status_back(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$refuse = static function ( $check, $object_id, $meta_key, $meta_value ) use ( $post_id ) {
			if ( (int) $object_id === $post_id && StatusManager::STAGE_META_KEY === $meta_key && 'live' === $meta_value ) {
				return false;
			}
			return $check;
		};
		add_filter( 'update_post_metadata', $refuse, 10, 4 );

		try {
			$result = ( new StatusManager() )->transition( $post_id, 'live' );
		} finally {
			remove_filter( 'update_post_metadata', $refuse, 10 );
		}

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_write_failed', $result->get_error_code() );
		$this->assertSame( 500, $result->get_error_data()['status'] );
		$this->assertSame( array( 'draft', 'draft' ), $this->stored_state( $post_id ) );
	}

	/**
	 * A same-region loser writes no status. Its error still reports the stage
	 * the other request stored, not the one in this request's cache.
	 */
	public function test_a_same_region_loser_reports_a_conflict(): void
	{
		$post_id = $this->make_tool_gated_post();

		$move = function ( int $tool_post_id ) use ( $post_id ): void {
			if ( $tool_post_id === $post_id ) {
				$this->write_from_another_request( $post_id, 'review', 'pending' );
			}
		};
		add_action( self::RACE_TOOL_HOOK, $move );

		try {
			$result = ( new StatusManager() )->transition( $post_id, 'second_draft' );
		} finally {
			remove_action( self::RACE_TOOL_HOOK, $move );
		}

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( array( 'review', 'pending' ), $this->stored_state( $post_id ) );
	}

	/**
	 * A crossing that has already lost by the time its required tools finish
	 * writes no status, so WordPress never sees a status change for it.
	 */
	public function test_a_crossing_that_lost_during_its_tools_writes_no_status(): void
	{
		$post_id = $this->make_tool_gated_post();

		$move = function ( int $tool_post_id ) use ( $post_id ): void {
			if ( $tool_post_id === $post_id ) {
				$this->write_from_another_request( $post_id, 'review' );
			}
		};
		add_action( self::RACE_TOOL_HOOK, $move );

		$status_changes = array();
		$spy            = static function ( $new_status, $old_status, $post ) use ( &$status_changes, $post_id ): void {
			if ( (int) $post->ID === $post_id ) {
				$status_changes[] = array( $old_status, $new_status );
			}
		};
		add_action( 'transition_post_status', $spy, 10, 3 );

		try {
			$result = ( new StatusManager() )->transition( $post_id, 'live' );
		} finally {
			remove_action( self::RACE_TOOL_HOOK, $move );
			remove_action( 'transition_post_status', $spy, 10 );
		}

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame(
			'This post moved from “Draft” to “Review” before your move was saved. Reload to see where it is now.',
			$result->get_error_message()
		);
		$this->assertSame( array(), $status_changes );
		$this->assertSame( array( 'review', 'draft' ), $this->stored_state( $post_id ) );
	}

	/**
	 * A winner writes its status, then its stage. When the loser's tools finish
	 * between the two, the loser passes its stage re-check and loses the swap.
	 * The put-back restores the winner's status, which the post held when the
	 * loser wrote, not the one it held when the loser started.
	 */
	public function test_losing_a_race_puts_back_the_status_the_winner_wrote_before_it(): void
	{
		$post_id = $this->make_tool_gated_post();

		$winner_writes_status = function ( int $tool_post_id ) use ( $post_id ): void {
			if ( $tool_post_id === $post_id ) {
				$this->write_from_another_request( $post_id, 'draft', 'pending' );
			}
		};
		add_action( self::RACE_TOOL_HOOK, $winner_writes_status );

		try {
			$result = $this->lose_race_after_status_write( $post_id, 'live', 'review' );
		} finally {
			remove_action( self::RACE_TOOL_HOOK, $winner_writes_status );
		}

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( array( 'review', 'pending' ), $this->stored_state( $post_id ) );
	}

	/**
	 * Two requests publish the same post, and the other one has already written
	 * `publish` when this one reaches its status write. This request wins the
	 * stage swap and still reports the go-live, since it was decided from
	 * `draft`. The other request's own refusal is covered by the put-back tests
	 * above.
	 */
	public function test_the_winner_of_a_double_publish_reports_its_go_live(): void
	{
		$this->assert_winner_of_a_double_publish_reports_its_go_live( false );
	}

	/**
	 * As above, with this request's post cache flushed after the other
	 * request's write, as a required tool or a cache eviction can do. The
	 * go-live still comes from the status this request started from.
	 */
	public function test_the_winner_of_a_double_publish_reports_its_go_live_after_a_cache_flush(): void
	{
		$this->assert_winner_of_a_double_publish_reports_its_go_live( true );
	}

	/**
	 * Run a double publish that this request wins, and check its go-live.
	 *
	 * @param bool $flush_cache Whether to clear the post cache after the other request's write.
	 */
	private function assert_winner_of_a_double_publish_reports_its_go_live( bool $flush_cache ): void
	{
		$post_id = $this->make_tool_gated_post();

		$other = function ( int $tool_post_id ) use ( $post_id, $flush_cache ): void {
			if ( $tool_post_id === $post_id ) {
				$this->write_from_another_request( $post_id, 'draft', 'publish' );
				if ( $flush_cache ) {
					clean_post_cache( $post_id );
				}
			}
		};
		add_action( self::RACE_TOOL_HOOK, $other );

		$events = array();
		$spy    = static function ( $event_type ) use ( &$events ): void {
			$events[] = (string) $event_type;
		};
		add_action( 'vip_workflows_event_emitted', $spy );

		$contexts    = array();
		$context_spy = static function ( $moved_id, $new_stage, $old_stage, $sequence, $context ) use ( &$contexts, $post_id ): void {
			if ( (int) $moved_id === $post_id ) {
				$contexts[] = $context;
			}
		};
		add_action( 'vip_workflows_status_transition', $context_spy, 10, 5 );

		try {
			$result = ( new StatusManager() )->transition( $post_id, 'live' );
		} finally {
			remove_action( self::RACE_TOOL_HOOK, $other );
			remove_action( 'vip_workflows_event_emitted', $spy );
			remove_action( 'vip_workflows_status_transition', $context_spy, 10 );
		}

		$this->assertTrue( $result );
		$this->assertSame( array( 'live', 'publish' ), $this->stored_state( $post_id ) );
		$this->assertCount( 1, $contexts );
		$this->assertSame( 'draft', $contexts[0]['previous_status'] );
		$this->assertSame( 'publish', $contexts[0]['committed_status'] );
		$this->assertContains( 'post.published', $events );
	}

	/**
	 * A stored stage the sequence doesn't define is a data-integrity error, and
	 * the loser puts its status back as for any other loss.
	 */
	public function test_losing_a_race_to_an_unknown_stage_puts_the_status_back(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$result = $this->lose_race_after_status_write( $post_id, 'live', 'not_a_stage' );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( array( 'not_a_stage', 'draft' ), $this->stored_state( $post_id ) );
	}

	/**
	 * The re-read before the status write doesn't refuse a move nobody raced,
	 * even with this request's stage cache primed.
	 */
	public function test_a_crossing_with_required_tools_and_no_race_publishes(): void
	{
		$post_id = $this->make_tool_gated_post();

		$this->assertTrue( ( new StatusManager() )->transition( $post_id, 'live' ) );
		$this->assertSame( array( 'live', 'publish' ), $this->stored_state( $post_id ) );
	}

	/**
	 * A post in a sequence whose crossing and same-region edges out of `draft`
	 * both run the race tool, with an editor (who doesn't skip tool checks) as
	 * the current user.
	 *
	 * @return int Post ID.
	 */
	private function make_tool_gated_post(): int
	{
		$this->register_race_tool();

		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Transition Race Tools',
			'transition-race-tools',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'draft',
						'label'       => 'Draft',
						'status'      => 'draft',
						'transitions' => array(
							array(
								'to'             => 'second_draft',
								'label'          => 'Second Draft',
								'required_tools' => array( self::RACE_TOOL ),
							),
							array(
								'to'             => 'live',
								'label'          => 'Publish',
								'required_tools' => array( self::RACE_TOOL ),
							),
						),
					),
					array(
						'key'         => 'second_draft',
						'label'       => 'Second Draft',
						'status'      => 'draft',
						'transitions' => array(),
					),
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'status'      => 'pending',
						'transitions' => array(),
					),
					array(
						'key'         => 'live',
						'label'       => 'Live',
						'status'      => 'publish',
						'transitions' => array(),
					),
				),
			),
			$this->admin_id
		);

		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->admin_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );

		return $post_id;
	}

	/**
	 * Register the race tool: a required tool that passes, after firing
	 * RACE_TOOL_HOOK so a test can land another request's write while it runs.
	 *
	 * Abilities can only be registered while `wp_abilities_api_init` is running,
	 * so the hook is fired again with every other listener detached;
	 * WP_UnitTestCase restores `$wp_filter` afterwards. Registration is global
	 * and outlives the test, hence the guard.
	 */
	private function register_race_tool(): void
	{
		$registered = array_map(
			static function ( $ability ): string {
				return $ability->get_name();
			},
			wp_get_abilities()
		);
		if ( in_array( self::RACE_TOOL, $registered, true ) ) {
			return;
		}

		remove_all_actions( 'wp_abilities_api_init' );
		add_action(
			'wp_abilities_api_init',
			static function (): void {
				wp_register_ability(
					self::RACE_TOOL,
					array(
						'label'               => 'Transition Race Fixture',
						'description'         => 'A required tool that lets a test land a concurrent write mid-transition.',
						'category'            => 'research',
						'execute_callback'    => static function ( $input ): array {
							do_action( self::RACE_TOOL_HOOK, (int) ( $input['post_id'] ?? 0 ) );
							return array( 'issues' => array() );
						},
						'permission_callback' => static function (): bool {
							return true;
						},
						'input_schema'        => array(
							'type'       => 'object',
							'properties' => array(
								'post_id' => array( 'type' => 'integer' ),
							),
							'required'   => array( 'post_id' ),
						),
					)
				);
			}
		);
		do_action( 'wp_abilities_api_init' );
	}

	/**
	 * A core-driven move to `private` re-seats the post at the private region's
	 * entry stage — the reconcile region the suite never covered.
	 */
	public function test_core_private_reseats_at_the_private_entry_stage(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'private',
			)
		);

		$this->assertSame( 'private', get_post_status( $post_id ) );
		$this->assertSame( 'vault', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * Cron's `future` -> `publish` emits go-live EXACTLY once.
	 *
	 * `future` is an overlay: scheduling reseats nothing, and the stage moves
	 * when the post actually goes live. Double-emitting here means a duplicate
	 * notification for every scheduled post on the site.
	 */
	public function test_cron_future_to_publish_emits_go_live_once(): void
	{
		$post_id = $this->make_post(
			'draft',
			'future',
			array( 'post_date' => gmdate( 'Y-m-d H:i:s', time() + 3600 ) )
		);

		$emitted  = array();
		$listener = function ( $event_type, $event_data = array() ) use ( &$emitted, $post_id ) {
			if ( 'post.published' === $event_type && (int) ( $event_data['post_id'] ?? 0 ) === $post_id ) {
				$emitted[] = $event_data;
			}
		};
		add_action( 'vip_workflows_event_emitted', $listener, 10, 2 );

		// What wp-cron's publish_future_post does.
		wp_publish_post( $post_id );

		remove_action( 'vip_workflows_event_emitted', $listener, 10 );

		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertCount( 1, $emitted, 'Going live must emit post.published exactly once.' );
	}

	/**
	 * Core-publishing into a region the sequence does not model leaves the stage
	 * where it is — and the boundary follows the LIVE post, not the stranded
	 * stage.
	 *
	 * The reseat not happening is deliberate: resolve_reseat_stage() has nowhere
	 * to seat the post, and a region the sequence does not use is left untouched.
	 * What used to follow from that was not: the post was live while its stage
	 * said `draft`, so crosses_publish_boundary() compared draft to draft and a
	 * non-bypass user could unpublish a live post with no veto.
	 *
	 * boundary_region() now takes whichever side is publish.
	 */
	public function test_core_publish_into_an_unmodelled_region_keeps_the_post_on_the_publish_side(): void
	{
		// A sequence with NO publish-region stage at all.
		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Never Publishes',
			'never-publishes',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'draft',
						'label'       => 'Draft',
						'status'      => 'draft',
						'transitions' => array(),
					),
				),
			),
			get_current_user_id()
		);

		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->admin_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'publish',
			)
		);

		// The post is live and the stage did not move — there was nowhere to move it.
		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( 'draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		$manager = new StatusManager();

		// Going back to draft un-publishes a live post, so it crosses — even
		// though the stage it is stranded at is draft-region.
		$this->assertTrue(
			$manager->crosses_publish_boundary( $post_id, 'draft' ),
			'A live post must be publish-side whatever its stage says.'
		);

		// It is already publish-side, so re-publishing crosses nothing, and
		// scheduling it stays on the same side.
		$this->assertFalse( $manager->crosses_publish_boundary( $post_id, 'publish' ) );
		$this->assertFalse( $manager->crosses_publish_boundary( $post_id, 'future' ) );

		// Trash remains an overlay in both directions.
		$this->assertFalse( $manager->crosses_publish_boundary( $post_id, 'trash' ) );
	}

	/**
	 * A same-region stage move fires the per-stage entered_/exited_ hooks.
	 *
	 * It writes no post_status, so core's transition_post_status never fires —
	 * these hooks are the ONLY signal such a move produces, and nothing pinned
	 * that they fire at all.
	 */
	public function test_same_region_move_fires_entered_and_exited_hooks(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$entered = array();
		$exited  = array();

		add_action(
			'vip_workflows_entered_second_draft',
			function ( $id, $old_stage ) use ( &$entered ) {
				$entered[] = array( $id, $old_stage );
			},
			10,
			2
		);
		add_action(
			'vip_workflows_exited_draft',
			function ( $id, $new_stage ) use ( &$exited ) {
				$exited[] = array( $id, $new_stage );
			},
			10,
			2
		);

		$this->assertTrue( ( new StatusManager() )->transition( $post_id, 'second_draft' ) );

		// No status was written — the move stayed inside the draft region.
		$this->assertSame( 'draft', get_post_status( $post_id ) );

		$this->assertSame( array( array( $post_id, 'draft' ) ), $entered );
		$this->assertSame( array( array( $post_id, 'second_draft' ) ), $exited );
	}
}
