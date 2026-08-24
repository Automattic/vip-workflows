<?php
/**
 * Integration coverage for the stage × status matrix transition path.
 *
 * Runs against real WordPress so it exercises the actual transition_post_status
 * hook, the request-scoped static re-entrancy guard across StatusManager
 * instances, core's own status coercions (publish → future), core capability
 * resolution, and the stage-change event dispatch — none of which the
 * Brain\Monkey unit suite can prove.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\StatusManager;

/**
 * Real-WordPress tests for StatusManager under the matrix model.
 */
class StatusTransitionIntegrationTest extends TestCase
{
	/**
	 * Sequence ID under test.
	 *
	 * @var int
	 */
	private int $sequence_id;

	public function set_up(): void
	{
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		// Regions: draft { draft*, review } and publish { published*, promote }.
		// The sequence deliberately models NO pending region (exercises the
		// unmodeled-region tolerance). Asterisks mark region entry stages.
		$config = array(
			'post_types' => array( 'post' ),
			'statuses'   => array(
				array(
					'key'          => 'draft',
					'label'        => 'Draft',
					'status'       => 'draft',
					'region_entry' => true,
					'transitions'  => array(
						array( 'to' => 'review' ),
					),
				),
				array(
					'key'         => 'review',
					'label'       => 'In Review',
					'status'      => 'draft',
					'transitions' => array(
						array( 'to' => 'draft' ),
						array( 'to' => 'published' ),
					),
				),
				array(
					'key'          => 'published',
					'label'        => 'Published',
					'status'       => 'publish',
					'region_entry' => true,
					'transitions'  => array(
						array( 'to' => 'promote' ),
						// Unpublishing lands on the draft region's checkpoint, not
						// mid-region at `review`: a region is only enterable
						// through its checkpoint.
						array( 'to' => 'draft' ),
					),
				),
				array(
					'key'         => 'promote',
					'label'       => 'Promote',
					'status'      => 'publish',
					'is_terminal' => true,
					'transitions' => array(),
				),
			),
		);

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Post-Publish Flow',
			'post-publish-flow',
			'',
			$config,
			get_current_user_id()
		);
	}

	/**
	 * Create a post already assigned to the test sequence at a given stage.
	 *
	 * @param string $stage Stage key to seed.
	 * @param string $post_status Initial post_status.
	 * @param array  $extra Extra post args (e.g. post_date for scheduled posts).
	 * @return int Post ID.
	 */
	private function make_workflow_post( string $stage = 'draft', string $post_status = 'draft', array $extra = array() ): int
	{
		$post_id = self::factory()->post->create( array_merge( array( 'post_status' => $post_status ), $extra ) );
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );
		return $post_id;
	}

	/**
	 * Build a StatusManager whose PostTypeManager mapping includes sequences
	 * created after `init` ran (assign_sequence checks post-type eligibility
	 * against that mapping, which is normally built once on init).
	 *
	 * @return StatusManager
	 */
	private function status_manager_with_mapping(): StatusManager
	{
		$post_type_manager = new \VIPWorkflow\Workflow\PostTypeManager();
		$post_type_manager->register_post_types();

		return new StatusManager( null, $post_type_manager );
	}

	/**
	 * Collect vip_workflow_status_transition dispatches for one post.
	 *
	 * @param int   $post_id Post to filter on.
	 * @param array $events  Capture target: [new, old, context] triples (by reference).
	 * @return callable The listener (pass to remove_action with priority 10).
	 */
	private function listen( int $post_id, array &$events ): callable
	{
		$listener = function ( $id, $new, $old, $sequence, $context = null ) use ( &$events, $post_id ) {
			if ( $id === $post_id ) {
				$events[] = array( $new, $old, $context );
			}
		};
		add_action( 'vip_workflow_status_transition', $listener, 10, 5 );
		return $listener;
	}

	// =========================================================================
	// transition() — write rules
	// =========================================================================

	/**
	 * A same-region stage move never writes post_status: a core-set `pending`
	 * survives a draft-region move untouched, the event fires exactly once, and
	 * its context carries cause 'workflow' and the committed status.
	 */
	public function test_same_region_move_preserves_pending_and_dispatches_once(): void
	{
		$post_id = $this->make_workflow_post( 'draft', 'pending' );

		$events   = array();
		$listener = $this->listen( $post_id, $events );

		$result = ( new StatusManager() )->transition( $post_id, 'review' );

		remove_action( 'vip_workflow_status_transition', $listener, 10 );

		$this->assertTrue( $result );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'pending', get_post_status( $post_id ), 'A same-region move never touches post_status.' );
		$this->assertCount( 1, $events );
		$this->assertSame( 'review', $events[0][0] );
		$this->assertSame( 'draft', $events[0][1] );
		$this->assertSame( 'workflow', $events[0][2]['cause'] );
		$this->assertSame( 'pending', $events[0][2]['committed_status'] );
		$this->assertSame( 'pending', $events[0][2]['previous_status'], 'No status write: previous equals committed.' );
	}

	/**
	 * A same-region move within the publish region leaves a scheduled post
	 * scheduled — `future` is never unscheduled by a stage move.
	 */
	public function test_same_region_move_preserves_future(): void
	{
		$post_id = $this->make_workflow_post(
			'published',
			'future',
			array(
				'post_date'     => '2099-01-01 00:00:00',
				'post_date_gmt' => '2099-01-01 00:00:00',
			)
		);

		$result = ( new StatusManager() )->transition( $post_id, 'promote' );

		$this->assertTrue( $result );
		$this->assertSame( 'promote', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'future', get_post_status( $post_id ), 'The post is still scheduled.' );
	}

	/**
	 * A region crossing into publish makes the post a real, live `publish` post
	 * and dispatches with post_status already committed (the ordering
	 * NotificationDispatcher depends on).
	 */
	public function test_crossing_makes_post_live_and_dispatch_sees_publish(): void
	{
		$post_id = $this->make_workflow_post( 'review', 'draft' );

		$status_at_dispatch = null;
		$listener = function ( $id ) use ( &$status_at_dispatch, $post_id ) {
			if ( $id === $post_id ) {
				$status_at_dispatch = get_post_status( $id );
			}
		};
		add_action( 'vip_workflow_status_transition', $listener, 10, 1 );

		$result = ( new StatusManager() )->transition( $post_id, 'published' );

		remove_action( 'vip_workflow_status_transition', $listener, 10 );

		$this->assertTrue( $result );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( 'publish', $status_at_dispatch, 'Dispatch runs after post_status is committed to publish.' );

		// The post is genuinely live: a default publish query finds it.
		$found = get_posts( array( 'post_type' => 'post', 'post_status' => 'publish', 'fields' => 'ids', 'include' => array( $post_id ) ) );
		$this->assertContains( $post_id, $found );
	}

	/**
	 * Crossing into publish on a future-dated post: core coerces the write to
	 * `future`, the coercion is accepted silently, the stage still advances,
	 * and the event context reports the COMMITTED status (`future`).
	 */
	public function test_crossing_scheduled_coercion_accepted(): void
	{
		$post_id = $this->make_workflow_post(
			'review',
			'draft',
			array(
				'post_date'     => '2099-01-01 00:00:00',
				'post_date_gmt' => '2099-01-01 00:00:00',
			)
		);

		$events   = array();
		$listener = $this->listen( $post_id, $events );

		$result = ( new StatusManager() )->transition( $post_id, 'published' );

		remove_action( 'vip_workflow_status_transition', $listener, 10 );

		$this->assertTrue( $result, 'The coercion is not a failure.' );
		$this->assertSame( 'future', get_post_status( $post_id ), 'Core committed `future` for the future-dated post.' );
		$this->assertSame( 'published', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertCount( 1, $events );
		$this->assertSame( 'future', $events[0][2]['committed_status'] );
		$this->assertSame( 'draft', $events[0][2]['previous_status'], 'previous_status is the pre-write committed status.' );
	}

	/**
	 * Transitions on a trashed post are rejected with a 409 — trash suspends the
	 * workflow in place and nothing is written.
	 */
	public function test_transition_on_trashed_post_is_rejected(): void
	{
		$post_id = $this->make_workflow_post( 'review', 'draft' );
		wp_trash_post( $post_id );

		$result = ( new StatusManager() )->transition( $post_id, 'published' );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'post_trashed', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] ?? null );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'Stage untouched.' );
		$this->assertSame( 'trash', get_post_status( $post_id ) );
	}

	/**
	 * A transition whose target is a core status (`future`) is rejected. Core
	 * statuses are overlays owned by core, never workflow stages, so the target
	 * neither resolves nor mis-schedules the post. Controlled 422, not a 500.
	 */
	public function test_transition_to_core_status_target_is_rejected(): void
	{
		$post_id = $this->make_workflow_post( 'review', 'draft' );

		$result = ( new StatusManager() )->transition( $post_id, 'future' );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'invalid_transition', $result->get_error_code() );
		$this->assertSame( 422, $result->get_error_data()['status'] ?? null );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'draft', get_post_status( $post_id ), 'Status unchanged; not mis-scheduled.' );
	}

	/**
	 * The runtime backstop: a transition whose target is a DANGLING stage — a
	 * sequence transition `to:` that references a stage which isn't defined — is
	 * rejected with a WP_Error, not an uncaught exception. Write-time validation
	 * rejects such a config on create/update, so a dangling target can only reach
	 * the runtime via corrupted/hand-edited persisted data; this test injects
	 * exactly that, bypassing the write gate.
	 */
	public function test_transition_to_dangling_target_is_rejected(): void
	{
		global $wpdb;

		// Create a VALID sequence (start -> end), then corrupt its stored config so
		// 'start' transitions to the undefined 'ghost' — a state the write-time gate
		// would reject, simulating legacy/corrupted data.
		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Dangling Flow',
			'dangling-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'start', 'label' => 'Start', 'status' => 'draft', 'transitions' => array( array( 'to' => 'end' ) ) ),
					array( 'key' => 'end', 'label' => 'End', 'status' => 'draft', 'is_terminal' => true ),
				),
			),
			get_current_user_id()
		);

		$corrupted = array(
			'post_types' => array( 'post' ),
			'statuses'   => array(
				array( 'key' => 'start', 'label' => 'Start', 'status' => 'draft', 'region_entry' => true, 'transitions' => array( array( 'to' => 'ghost' ) ) ),
				array( 'key' => 'end', 'label' => 'End', 'status' => 'draft', 'is_terminal' => true ),
			),
		);
		$wpdb->update(
			\VIPWorkflow\Database\Schema::get_table_name( 'sequences' ),
			array( 'config' => wp_json_encode( $corrupted ) ),
			array( 'id' => $sequence_id )
		);
		wp_cache_flush();

		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'start' );

		$result = ( new StatusManager() )->transition( $post_id, 'ghost' );

		$this->assertInstanceOf( 'WP_Error', $result, 'A dangling target returns WP_Error, not a thrown exception.' );
		$this->assertSame( 'invalid_transition', $result->get_error_code() );
		$this->assertSame( 422, $result->get_error_data()['status'] ?? null );
		$this->assertSame( 'start', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'Stage unchanged.' );
	}

	/**
	 * The static guard is visible across StatusManager instances: a crossing
	 * driven from a freshly constructed instance (as the transition-post ability
	 * does) is still recognized as plugin-driven by the hooked singleton, so the
	 * reconcile layer does not double-fire (one event, cause 'workflow', no
	 * 'core' reseat).
	 */
	public function test_guard_holds_across_instances(): void
	{
		$post_id = $this->make_workflow_post( 'review', 'draft' );

		$events   = array();
		$listener = $this->listen( $post_id, $events );

		$fresh_instance = new StatusManager();
		$result = $fresh_instance->transition( $post_id, 'published' );

		remove_action( 'vip_workflow_status_transition', $listener, 10 );

		$this->assertTrue( $result );
		$this->assertSame( 'published', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertCount( 1, $events, 'Exactly one dispatch: the reconcile layer did not double-fire.' );
		$this->assertSame( 'workflow', $events[0][2]['cause'] );
		$this->assertSame( 'publish', $events[0][2]['committed_status'] );
		$this->assertSame( 'draft', $events[0][2]['previous_status'], 'Go-live is detectable: previous draft, committed publish.' );
	}

	/**
	 * The transition REST endpoint reports the committed post_status as
	 * `current.wp_status` on every successful transition, so the editor panel
	 * can display the real committed status.
	 */
	public function test_transition_endpoint_returns_committed_wp_status(): void
	{
		$post_id = $this->make_workflow_post( 'draft', 'draft' );

		$controller = new \VIPWorkflow\API\WorkflowController();

		// Same-region move: draft -> review keeps post_status draft.
		$request = new \WP_REST_Request( 'POST', "/vip-workflow/v1/workflow/post/{$post_id}/transition" );
		$request->set_param( 'id', $post_id );
		$request->set_param( 'to_status', 'review' );

		$response = $controller->transition_status( $request );

		$this->assertInstanceOf( 'WP_REST_Response', $response );
		$data = $response->get_data();
		$this->assertSame( 'draft', $data['current']['wp_status'] ?? null, 'wp_status reflects the committed status after a same-region move.' );
		$this->assertSame( get_post_status( $post_id ), $data['current']['wp_status'] );

		// Crossing: review -> published commits post_status publish and the
		// response reports it.
		$request = new \WP_REST_Request( 'POST', "/vip-workflow/v1/workflow/post/{$post_id}/transition" );
		$request->set_param( 'id', $post_id );
		$request->set_param( 'to_status', 'published' );

		$response = $controller->transition_status( $request );

		$this->assertInstanceOf( 'WP_REST_Response', $response );
		$data = $response->get_data();
		$this->assertSame( 'publish', $data['current']['wp_status'] ?? null, 'wp_status reports the committed publish status after a crossing.' );
		$this->assertSame( get_post_status( $post_id ), $data['current']['wp_status'] );
	}

	// =========================================================================
	// transition() — capability gates
	// =========================================================================

	/**
	 * A contributor (no publish_posts) cannot traverse an edge crossing into the
	 * publish region — rejected server-side with 403, nothing written.
	 */
	public function test_contributor_cannot_cross_into_publish(): void
	{
		$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id     = self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $contributor,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'review' );

		wp_set_current_user( $contributor );

		$result = ( new StatusManager() )->transition( $post_id, 'published' );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'forbidden_region_crossing', $result->get_error_code() );
		$this->assertSame( 403, $result->get_error_data()['status'] ?? null );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * The same contributor CAN make a same-region move on their own draft — the
	 * baseline edit_post cap is enough when no boundary is crossed.
	 */
	public function test_contributor_can_move_within_region(): void
	{
		$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id     = self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $contributor,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );

		wp_set_current_user( $contributor );

		$result = ( new StatusManager() )->transition( $post_id, 'review' );

		$this->assertTrue( $result );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	// =========================================================================
	// Core-driven reconcile (Gutenberg/bulk/REST/cron change post_status directly)
	// =========================================================================

	/**
	 * A core-driven publish reseats the post at the publish region's entry
	 * stage — regardless of whether the sequence has an edge there (checkpoint
	 * semantics replace the old allowed-gate rule) — and dispatches once with
	 * cause 'core'.
	 */
	public function test_core_publish_reseats_at_publish_entry(): void
	{
		// draft has NO direct edge to published; the checkpoint reseat happens anyway.
		$post_id = $this->make_workflow_post( 'draft', 'draft' );

		$events   = array();
		$listener = $this->listen( $post_id, $events );

		wp_publish_post( $post_id ); // core-driven, no StatusManager::transition().

		remove_action( 'vip_workflow_status_transition', $listener, 10 );

		$this->assertSame( 'published', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertCount( 1, $events, 'The checkpoint reseat dispatches exactly once.' );
		$this->assertSame( 'published', $events[0][0] );
		$this->assertSame( 'draft', $events[0][1] );
		$this->assertSame( 'core', $events[0][2]['cause'] );
		$this->assertSame( 'publish', $events[0][2]['committed_status'] );
		$this->assertSame( 'publish', $events[0][2]['previous_status'], 'A reseat writes no status: previous equals committed.' );
	}

	/**
	 * Core drives a live publish-region post back to draft: reseat at the draft
	 * region's entry stage.
	 */
	public function test_core_unpublish_reseats_at_draft_entry(): void
	{
		$post_id = $this->make_workflow_post( 'promote', 'publish' );

		$events   = array();
		$listener = $this->listen( $post_id, $events );

		wp_update_post( array( 'ID' => $post_id, 'post_status' => 'draft' ) );

		remove_action( 'vip_workflow_status_transition', $listener, 10 );

		$this->assertSame( 'draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'Publish-region stage reseats at the draft checkpoint.' );
		$this->assertCount( 1, $events );
		$this->assertSame( 'core', $events[0][2]['cause'] );
	}

	/**
	 * Scheduling (core sets `future`) is an overlay: the stage never moves.
	 */
	public function test_core_future_leaves_stage(): void
	{
		$post_id = $this->make_workflow_post( 'review', 'draft' );

		// edit_date is required for wp_update_post to actually apply the future date;
		// without it the date stays ~now and core flips future -> publish.
		wp_update_post( array(
			'ID'            => $post_id,
			'post_status'   => 'future',
			'post_date'     => '2099-01-01 00:00:00',
			'post_date_gmt' => '2099-01-01 00:00:00',
			'edit_date'     => true,
		) );

		$this->assertSame( 'future', get_post_status( $post_id ), 'Post is genuinely scheduled.' );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * Trash is an overlay: it suspends the workflow in place and the stage stays.
	 */
	public function test_core_trash_leaves_stage(): void
	{
		$post_id = $this->make_workflow_post( 'promote', 'publish' );

		wp_trash_post( $post_id );

		$this->assertSame( 'promote', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * Untrash needs no special case: core restores the post (default: draft) and
	 * the generic reconcile seats it at the restored region's entry stage — a
	 * formerly-live post does not come back dark in a publish-region stage.
	 */
	public function test_untrash_reseats_at_restored_region_entry(): void
	{
		$post_id = $this->make_workflow_post( 'promote', 'publish' );

		wp_trash_post( $post_id );
		$this->assertSame( 'promote', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'Trash leaves the stage in place.' );

		wp_untrash_post( $post_id );

		$this->assertSame( 'draft', get_post_status( $post_id ), 'Core default restore status is draft.' );
		$this->assertSame( 'draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'Untrash reseats at the restored region checkpoint.' );
	}

	/**
	 * A core-set status whose region the sequence does not model (`pending`
	 * here) is tolerated: the stage stays and nothing dispatches.
	 */
	public function test_core_pending_unmodeled_region_leaves_stage(): void
	{
		$post_id = $this->make_workflow_post( 'review', 'draft' );

		$events   = array();
		$listener = $this->listen( $post_id, $events );

		wp_update_post( array( 'ID' => $post_id, 'post_status' => 'pending' ) );

		remove_action( 'vip_workflow_status_transition', $listener, 10 );

		$this->assertSame( 'pending', get_post_status( $post_id ) );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'Stage left in place for an unmodeled region.' );
		$this->assertCount( 0, $events );
	}

	// =========================================================================
	// assign_sequence() seating
	// =========================================================================

	/**
	 * Assigning to a live post seats it at the publish region's entry stage,
	 * keeps it live (no post_status write), and fires the stage-change dispatch
	 * with cause 'workflow'.
	 */
	public function test_assign_seats_published_post_at_publish_entry(): void
	{
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$events   = array();
		$listener = $this->listen( $post_id, $events );

		$result = $this->status_manager_with_mapping()->assign_sequence( $post_id, $this->sequence_id );

		remove_action( 'vip_workflow_status_transition', $listener, 10 );

		$this->assertTrue( $result );
		$this->assertSame( 'published', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'publish', get_post_status( $post_id ), 'Assignment never unpublishes a live post.' );
		$this->assertCount( 1, $events, 'Assignment fires the stage-change dispatch.' );
		$this->assertSame( 'published', $events[0][0] );
		$this->assertSame( '', $events[0][1], 'No prior stage.' );
		$this->assertSame( 'workflow', $events[0][2]['cause'] );
		$this->assertSame( 'publish', $events[0][2]['previous_status'], 'Seating writes no status: previous equals committed.' );
	}

	/**
	 * `future` counts as the publish region for seating: a scheduled post seats
	 * at the publish entry stage and stays scheduled.
	 */
	public function test_assign_seats_future_post_and_stays_scheduled(): void
	{
		$post_id = self::factory()->post->create(
			array(
				'post_status'   => 'future',
				'post_date'     => '2099-01-01 00:00:00',
				'post_date_gmt' => '2099-01-01 00:00:00',
			)
		);

		$result = $this->status_manager_with_mapping()->assign_sequence( $post_id, $this->sequence_id );

		$this->assertTrue( $result );
		$this->assertSame( 'published', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'future', get_post_status( $post_id ), 'Seating never unschedules the post.' );
	}

	/**
	 * A post in a region the sequence does not model (`pending`) is refused.
	 *
	 * Nothing in the sequence matches where the post already is, and assignment
	 * will not move it to fit — the author changes the status or picks another
	 * sequence.
	 */
	public function test_assign_pending_post_unmodeled_region_is_refused(): void
	{
		$post_id = self::factory()->post->create( array( 'post_status' => 'pending' ) );

		$result = $this->status_manager_with_mapping()->assign_sequence( $post_id, $this->sequence_id );

		$this->assertWPError( $result );
		$this->assertSame( 'unmodeled_post_status', $result->get_error_code() );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'Nothing written.' );
		$this->assertSame( 'pending', get_post_status( $post_id ), 'The refusal leaves the post status alone.' );
	}

	/**
	 * A trashed post refuses assignment.
	 */
	public function test_assign_trashed_post_refused(): void
	{
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		wp_trash_post( $post_id );

		$result = $this->status_manager_with_mapping()->assign_sequence( $post_id, $this->sequence_id );

		$this->assertFalse( $result );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ), 'Nothing written.' );
	}

	/**
	 * Assignment cannot be used as a capability bypass, because it cannot write
	 * post_status at all: a contributor (no publish_posts) starting a workflow on
	 * a live post is seated at the publish region's entry stage and the post
	 * stays exactly where core had it.
	 *
	 * The region-capability gate lives in transition(), which is where crossings
	 * happen. Entering a workflow is not a crossing, so there is nothing here for
	 * a gate to refuse — the invariant is structural, not permission-based.
	 */
	public function test_assign_never_writes_status_even_without_publish_cap(): void
	{
		$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id     = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_author' => $contributor,
			)
		);

		wp_set_current_user( $contributor );

		$result = $this->status_manager_with_mapping()->assign_sequence( $post_id, $this->sequence_id );

		$this->assertTrue( $result );
		$this->assertSame( 'published', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'Seated at the publish region entry stage.' );
		$this->assertSame( 'publish', get_post_status( $post_id ), 'Assignment wrote no status.' );
	}
}
