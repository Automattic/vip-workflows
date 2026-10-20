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
	 * Review; Review assigns an approver role on the way to Approval, or moves
	 * to Done with no assignment.
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

		$this->assertTrue( ( new StatusManager() )->assign_sequence( $post_id, $this->sequence_id ) );

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

		$this->assertTrue( ( new StatusManager() )->assign_sequence( $post_id, $this->sequence_id ) );

		$this->assertSame(
			AssignmentManager::STATUS_COMPLETED,
			( new AssignmentManager() )->get( $post_id, 'reviewer' )['status']
		);
	}
}
