<?php
/**
 * Integration coverage: a transition's user or role assignment is pending only
 * while the post sits in the stage that transition led into. Leaving that
 * stage completes it, so the assignee stops being "Assigned to" the post and
 * the post leaves their My Work.
 *
 * Driven end to end through StatusManager::transition() with real sequence
 * rows and real posts.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\AssignmentManager;
use VIPWorkflows\Workflow\PostTypeManager;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

/**
 * Real-WordPress tests for when transition assignments finish.
 */
class TransitionAssignmentLifecycleTest extends TestCase {

	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Administrator performing every transition.
	 *
	 * @var int
	 */
	private int $admin_id;

	/**
	 * Editor assigned as reviewer.
	 *
	 * @var int
	 */
	private int $reviewer_id;

	/**
	 * Create a draft-region sequence: Ideas assigns a reviewer on the way to
	 * Review; Review assigns an approver role on the way to Approval, moves
	 * to Done with no assignment, or stays put to hand the post to an owner.
	 */
	public function set_up(): void {
		parent::set_up();

		$this->admin_id    = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->reviewer_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $this->admin_id );

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Assignment Lifecycle Flow',
			'assignment-lifecycle-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'ideas',
						'label'        => 'Ideas',
						'status'       => 'draft',
						'region_entry' => true,
						'transitions'  => array(
							array(
								'to'     => 'review',
								'inputs' => array(
									array(
										'type'          => 'assignment',
										'meta_key'      => 'reviewer',
										'assignee_type' => 'user',
										'label'         => 'Reviewer',
									),
								),
							),
						),
					),
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'status'      => 'draft',
						'transitions' => array(
							array(
								'to'     => 'approval',
								'inputs' => array(
									array(
										'type'          => 'assignment',
										'meta_key'      => 'approver',
										'assignee_type' => 'role',
										'label'         => 'Approver',
									),
								),
							),
							array( 'to' => 'done' ),
							array(
								'to'     => 'review',
								'inputs' => array(
									array(
										'type'          => 'assignment',
										'meta_key'      => 'owner',
										'assignee_type' => 'user',
										'label'         => 'Owner',
									),
								),
							),
						),
					),
					array(
						'key'         => 'approval',
						'label'       => 'Approval',
						'status'      => 'draft',
						'transitions' => array(),
					),
					array(
						'key'         => 'done',
						'label'       => 'Done',
						'status'      => 'draft',
						'transitions' => array(),
					),
				),
			),
			$this->admin_id
		);
	}

	/**
	 * A draft post seated at Review with a pending reviewer, assigned through
	 * the Ideas → Review transition.
	 *
	 * @return int Post ID.
	 */
	private function make_post_in_review(): int {
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->admin_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ideas' );

		$result = ( new StatusManager() )->transition(
			$post_id,
			'review',
			array( 'input_data' => array( 'reviewer' => $this->reviewer_id ) )
		);
		$this->assertTrue( $result, 'Ideas → Review should commit.' );

		return $post_id;
	}

	/**
	 * Build a StatusManager whose PostTypeManager mapping includes the sequence
	 * created in set_up(). assign_sequence() checks post-type eligibility
	 * against that mapping, which is normally built once on `init`, before
	 * this test's sequence exists.
	 *
	 * @return StatusManager
	 */
	private function status_manager_with_mapping(): StatusManager {
		$post_type_manager = new PostTypeManager();
		$post_type_manager->register_post_types();

		return new StatusManager( null, $post_type_manager );
	}

	/**
	 * The assignment stays pending while the post is in the stage it was made for.
	 */
	public function test_assignment_is_pending_in_the_stage_it_led_into(): void {
		$post_id = $this->make_post_in_review();

		$current = ( new AssignmentManager() )->get_current( $post_id );
		$this->assertSame( 'reviewer', $current['meta_key'] );
		$this->assertSame( AssignmentManager::STATUS_PENDING, $current['assignment']['status'] );
	}

	/**
	 * Leaving the stage completes the reviewer, fires the completed hook, and
	 * leaves the post with no "Assigned to" and out of the reviewer's My Work.
	 */
	public function test_leaving_the_stage_completes_the_assignment(): void {
		$post_id   = $this->make_post_in_review();
		$completed = array();
		add_action(
			'vip_workflows_assignment_completed',
			static function ( $id, $meta_key ) use ( &$completed ) {
				$completed[] = array( $id, $meta_key );
			},
			10,
			2
		);

		$this->assertTrue( ( new StatusManager() )->transition( $post_id, 'done' ) );

		$manager = new AssignmentManager();
		$slot    = $manager->get( $post_id, 'reviewer' );
		$this->assertSame( AssignmentManager::STATUS_COMPLETED, $slot['status'] );
		$this->assertSame( $this->admin_id, $slot['completed_by'] );
		$this->assertSame( array( array( $post_id, 'reviewer' ) ), $completed );
		$this->assertNull( $manager->get_current( $post_id ) );

		wp_set_current_user( $this->reviewer_id );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/my-work' ) );
		$this->assertSame( 200, $response->get_status() );
		$this->assertNotContains( $post_id, array_column( $response->get_data(), 'post_id' ) );
	}

	/**
	 * The leaving transition's own assignment belongs to the stage it enters,
	 * so it is pending while the previous stage's assignment is completed.
	 */
	public function test_the_leaving_transitions_assignment_stays_pending(): void {
		$post_id = $this->make_post_in_review();

		$result = ( new StatusManager() )->transition(
			$post_id,
			'approval',
			array( 'input_data' => array( 'approver' => 'editor' ) )
		);
		$this->assertTrue( $result );

		$manager = new AssignmentManager();
		$this->assertSame( AssignmentManager::STATUS_COMPLETED, $manager->get( $post_id, 'reviewer' )['status'] );
		$this->assertSame( AssignmentManager::STATUS_PENDING, $manager->get( $post_id, 'approver' )['status'] );
		$this->assertSame( 'approver', $manager->get_current( $post_id )['meta_key'] );
	}

	/**
	 * Two transitions interleave: this one moves Ideas → Review, then another
	 * request moves the post on to Done before this one writes its reviewer.
	 * The other request's stage-exit pass ran before the reviewer existed, so
	 * this transition sees the stage has changed and completes the reviewer
	 * itself rather than leaving it pending in a stage the post has left.
	 */
	public function test_an_assignment_written_after_a_concurrent_move_is_completed(): void {
		global $wpdb;

		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->admin_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ideas' );

		// The other request's stage write lands between this transition's stage
		// write and its assignment write. It goes straight to the table, as a
		// write from another request would, so this request's meta cache does
		// not see it.
		$interleave = static function ( $id ) use ( $post_id, $wpdb ) {
			if ( $id !== $post_id ) {
				return;
			}
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.SlowDBQuery.slow_db_query_meta_key, WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- Simulates another request's write.
			$wpdb->update(
				$wpdb->postmeta,
				array( 'meta_value' => 'done' ),
				array(
					'post_id'  => $post_id,
					'meta_key' => StatusManager::STAGE_META_KEY,
				)
			);
			// Prime this request's cache with the stale stage, as an earlier read would have.
			wp_cache_set( $post_id, array( StatusManager::STAGE_META_KEY => array( 'review' ) ), 'post_meta' );
		};
		add_action( 'vip_workflows_assignment_created', $interleave );

		$result = ( new StatusManager() )->transition(
			$post_id,
			'review',
			array( 'input_data' => array( 'reviewer' => $this->reviewer_id ) )
		);
		remove_action( 'vip_workflows_assignment_created', $interleave );

		$this->assertTrue( $result );
		$this->assertSame( 'done', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		$manager = new AssignmentManager();
		$this->assertSame( AssignmentManager::STATUS_COMPLETED, $manager->get( $post_id, 'reviewer' )['status'] );
		$this->assertNull( $manager->get_current( $post_id ), 'Nothing may stay pending for a stage the post has left.' );
	}

	/**
	 * Hand a post in Review to an owner through the Review → Review self-edge.
	 *
	 * @param  int $post_id Post ID.
	 * @param  int $user_id Owner.
	 * @return mixed transition()'s result.
	 */
	private function hand_to_owner( int $post_id, int $user_id ) {
		return ( new StatusManager() )->transition(
			$post_id,
			'review',
			array( 'input_data' => array( 'owner' => $user_id ) )
		);
	}

	/**
	 * Land another request's write to a slot just before this request's own
	 * write to it reaches the database.
	 *
	 * @param  string   $verb  SQL verb of this request's write ('UPDATE' or 'INSERT').
	 * @param  callable $write The other request's write.
	 * @return callable The `query` filter, to remove afterwards.
	 */
	private function interleave_before_slot_write( string $verb, callable $write ): callable {
		$fired  = false;
		$filter = static function ( $query ) use ( $verb, $write, &$fired ) {
			if ( ! $fired && 0 === stripos( ltrim( $query ), $verb ) && false !== strpos( $query, '_vip_workflows_assignment_owner' ) ) {
				$fired = true;
				$write();
			}
			return $query;
		};
		add_filter( 'query', $filter );

		return $filter;
	}

	/**
	 * Self-edges one after another each replace the owner: the conditional
	 * write matches the value a real meta read returns.
	 */
	public function test_sequential_self_edges_each_reassign_the_slot(): void {
		$post_id = $this->make_post_in_review();
		$second  = (int) self::factory()->user->create( array( 'role' => 'editor' ) );

		$this->assertTrue( $this->hand_to_owner( $post_id, $this->reviewer_id ) );
		$this->assertTrue( $this->hand_to_owner( $post_id, $second ) );

		$owner = ( new AssignmentManager() )->get( $post_id, 'owner' );
		$this->assertSame( $second, (int) $owner['value'] );
		$this->assertSame( AssignmentManager::STATUS_PENDING, $owner['status'] );
	}

	/**
	 * Two self-edges hand the post to different owners at once. The other
	 * request's write lands between this one's read of the slot and its
	 * write, so this one is refused with a 409: the other owner stays, and
	 * this transition is not logged.
	 */
	public function test_concurrent_self_edges_on_one_slot_refuse_the_later_writer(): void {
		global $wpdb;

		$post_id = $this->make_post_in_review();
		$this->assertTrue( $this->hand_to_owner( $post_id, $this->admin_id ) );
		$theirs = (int) self::factory()->user->create( array( 'role' => 'editor' ) );

		$history_before = ( new StatusManager() )->count_transition_history( $post_id );

		$filter = $this->interleave_before_slot_write(
			'UPDATE',
			static function () use ( $wpdb, $post_id, $theirs ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.SlowDBQuery.slow_db_query_meta_key, WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- Simulates another request's write.
				$wpdb->update(
					$wpdb->postmeta,
					array(
						'meta_value' => serialize( // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize -- The stored form of another request's assignment.
							array(
								'value'       => $theirs,
								'type'        => 'user',
								'status'      => AssignmentManager::STATUS_PENDING,
								'assigned_at' => '2026-01-01 00:00:00.000000',
								'assigned_by' => $theirs,
							)
						),
					),
					array(
						'post_id'  => $post_id,
						'meta_key' => '_vip_workflows_assignment_owner',
					)
				);
			}
		);
		$result = $this->hand_to_owner( $post_id, $this->reviewer_id );
		remove_filter( 'query', $filter );

		$this->assertWPError( $result );
		$this->assertSame( 'assignment_conflict', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] );

		wp_cache_delete( $post_id, 'post_meta' );
		$this->assertSame( $theirs, (int) ( new AssignmentManager() )->get( $post_id, 'owner' )['value'], 'The other owner stays.' );
		$this->assertSame( $history_before, ( new StatusManager() )->count_transition_history( $post_id ), 'The refused transition is not logged.' );
	}

	/**
	 * Two self-edges fill an empty slot at once. Both pass add_post_meta()'s
	 * unique check; this one's row is the later, so it is removed and the
	 * transition is refused, leaving one row: the other request's.
	 */
	public function test_concurrent_first_assignment_of_a_slot_refuses_the_later_row(): void {
		global $wpdb;

		$post_id = $this->make_post_in_review();
		$theirs  = (int) self::factory()->user->create( array( 'role' => 'editor' ) );

		$filter = $this->interleave_before_slot_write(
			'INSERT',
			static function () use ( $wpdb, $post_id, $theirs ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Simulates another request's insert.
				$wpdb->insert(
					$wpdb->postmeta,
					array(
						'post_id'    => $post_id,
						'meta_key'   => '_vip_workflows_assignment_owner', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- Test fixture row.
						'meta_value' => serialize( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value, WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize -- Test fixture row.
							array(
								'value'       => $theirs,
								'type'        => 'user',
								'status'      => AssignmentManager::STATUS_PENDING,
								'assigned_at' => '2026-01-01 00:00:00.000000',
								'assigned_by' => $theirs,
							)
						),
					)
				);
			}
		);
		$result = $this->hand_to_owner( $post_id, $this->reviewer_id );
		remove_filter( 'query', $filter );

		$this->assertWPError( $result );
		$this->assertSame( 'assignment_conflict', $result->get_error_code() );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Count the slot's rows.
		$rows = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s", $post_id, '_vip_workflows_assignment_owner' ) );
		$this->assertSame( 1, $rows, 'Only the first row survives.' );

		wp_cache_delete( $post_id, 'post_meta' );
		$this->assertSame( $theirs, (int) ( new AssignmentManager() )->get( $post_id, 'owner' )['value'] );
	}

	/**
	 * A failed-agent revert sends the post back without finishing its
	 * assignments: the reviewer stays pending and no completed hook fires.
	 */
	public function test_a_failed_agent_revert_keeps_the_assignment(): void {
		$post_id   = $this->make_post_in_review();
		$completed = array();
		add_action(
			'vip_workflows_assignment_completed',
			static function ( $id, $meta_key ) use ( &$completed ) {
				$completed[] = array( $id, $meta_key );
			},
			10,
			2
		);

		// The option revert_failed_agent_stage() passes once it has resolved
		// the failed run's origin stage.
		$this->assertTrue( ( new StatusManager() )->transition( $post_id, 'ideas', array( 'agent_revert' => true ) ) );

		$manager = new AssignmentManager();
		$this->assertSame( 'ideas', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( AssignmentManager::STATUS_PENDING, $manager->get( $post_id, 'reviewer' )['status'] );
		$this->assertSame( 'reviewer', $manager->get_current( $post_id )['meta_key'] );
		$this->assertSame( array(), $completed );
	}

	/**
	 * Agent slots finish when the agent runner says so, not on a stage change.
	 */
	public function test_leaving_the_stage_leaves_agent_slots_to_their_runner(): void {
		$post_id = $this->make_post_in_review();
		update_post_meta(
			$post_id,
			'_vip_workflows_assignment_checker',
			array(
				'value'       => 'some-agent',
				'type'        => 'agent',
				'status'      => AssignmentManager::STATUS_PENDING,
				'assigned_at' => '2026-01-01 10:00:00',
				'assigned_by' => $this->admin_id,
			)
		);

		$this->assertTrue( ( new StatusManager() )->transition( $post_id, 'done' ) );

		$this->assertSame(
			AssignmentManager::STATUS_PENDING,
			( new AssignmentManager() )->get( $post_id, 'checker' )['status']
		);
	}

	/**
	 * Removing the post from its workflow leaves its stage too.
	 */
	public function test_removing_the_workflow_completes_the_assignment(): void {
		$post_id = $this->make_post_in_review();

		$this->assertTrue( ( new StatusManager() )->remove_sequence( $post_id ) );

		$this->assertSame(
			AssignmentManager::STATUS_COMPLETED,
			( new AssignmentManager() )->get( $post_id, 'reviewer' )['status']
		);
	}

	/**
	 * Re-assigning the post's own sequence while it sits at the entry stage
	 * leaves no stage, so that stage's assignment stays pending.
	 */
	public function test_reassigning_the_same_sequence_in_place_keeps_the_assignment(): void {
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->admin_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ideas' );
		update_post_meta(
			$post_id,
			'_vip_workflows_assignment_reviewer',
			array(
				'value'       => $this->reviewer_id,
				'type'        => 'user',
				'status'      => AssignmentManager::STATUS_PENDING,
				'assigned_at' => '2026-01-01 10:00:00',
				'assigned_by' => $this->admin_id,
			)
		);

		$this->assertTrue( $this->status_manager_with_mapping()->assign_sequence( $post_id, $this->sequence_id ) );

		$this->assertSame(
			AssignmentManager::STATUS_PENDING,
			( new AssignmentManager() )->get( $post_id, 'reviewer' )['status']
		);
	}

	/**
	 * Re-assigning the sequence from a later stage re-seats the post at the
	 * entry stage, which leaves its stage and completes the assignment.
	 */
	public function test_reassigning_the_sequence_from_another_stage_completes_the_assignment(): void {
		$post_id = $this->make_post_in_review();

		$this->assertTrue( $this->status_manager_with_mapping()->assign_sequence( $post_id, $this->sequence_id ) );

		$this->assertSame(
			AssignmentManager::STATUS_COMPLETED,
			( new AssignmentManager() )->get( $post_id, 'reviewer' )['status']
		);
	}
}
