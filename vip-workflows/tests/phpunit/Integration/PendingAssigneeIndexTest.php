<?php
/**
 * The pending-assignee index stays in step with every assignment write.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Database\Schema;
use VIPWorkflows\Workflow\AssignmentManager;

/**
 * My Work finds a user's pending assignments through this index instead of
 * reading every assignment on the site. A write the index misses would drop a
 * post from someone's My Work, or keep one there after the work is done, so
 * each write path is exercised against real post meta and the real hooks.
 */
class PendingAssigneeIndexTest extends TestCase {

	private AssignmentManager $assignments;

	private int $post_id;

	private int $user_a;

	private int $user_b;

	public function set_up(): void {
		parent::set_up();

		$this->assignments = new AssignmentManager();
		$this->post_id     = (int) self::factory()->post->create();
		$this->user_a      = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->user_b      = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
	}

	/**
	 * @return int[] User IDs indexed for the post, sorted.
	 */
	private function indexed(): array {
		wp_cache_delete( $this->post_id, 'post_meta' );
		$ids = array_map( 'intval', get_post_meta( $this->post_id, AssignmentManager::PENDING_ASSIGNEE_INDEX_KEY ) );
		sort( $ids );
		return $ids;
	}

	public function test_assign_indexes_the_user_and_completion_removes_them(): void {
		$this->assignments->assign( $this->post_id, 'reviewer', $this->user_a, 'user' );
		$this->assertSame( array( $this->user_a ), $this->indexed() );

		$this->assignments->mark_completed( $this->post_id, 'reviewer' );
		$this->assertSame( array(), $this->indexed() );
	}

	public function test_expiry_and_unassign_remove_the_user(): void {
		$this->assignments->assign( $this->post_id, 'reviewer', $this->user_a, 'user' );
		$this->assignments->assign( $this->post_id, 'legal', $this->user_b, 'user' );
		$this->assertSame( array( $this->user_a, $this->user_b ), $this->indexed() );

		$this->assignments->mark_expired( $this->post_id, 'reviewer' );
		$this->assertSame( array( $this->user_b ), $this->indexed() );

		$this->assignments->unassign( $this->post_id, 'legal' );
		$this->assertSame( array(), $this->indexed() );
	}

	public function test_a_user_in_two_slots_is_indexed_once_and_roles_are_not_indexed(): void {
		$this->assignments->assign( $this->post_id, 'reviewer', $this->user_a, 'user' );
		$this->assignments->assign( $this->post_id, 'legal', (string) $this->user_a, 'user' );
		$this->assignments->assign( $this->post_id, 'desk', 'editor', 'role' );

		$this->assertSame( array( $this->user_a ), $this->indexed() );
	}

	/**
	 * A transition writes its slot with a compare-and-set in direct SQL, which
	 * no meta hook sees.
	 */
	public function test_a_transition_assignment_written_by_compare_and_set_is_indexed(): void {
		$transition = array(
			'to'     => 'review',
			'inputs' => array(
				array(
					'type'          => 'assignment',
					'meta_key'      => 'reviewer',
					'assignee_type' => 'user',
				),
			),
		);

		$assigned = $this->assignments->process_transition_input( $this->post_id, $transition, array( 'reviewer' => $this->user_a ), array( 'reviewer' => null ) );
		$this->assertSame( array( 'reviewer' ), $assigned );
		$this->assertSame( array( $this->user_a ), $this->indexed() );

		$previous = $this->assignments->get( $this->post_id, 'reviewer' );
		$this->assignments->process_transition_input( $this->post_id, $transition, array( 'reviewer' => $this->user_b ), array( 'reviewer' => $previous ) );
		$this->assertSame( array( $this->user_b ), $this->indexed(), 'Reassigning moves the post to the new user.' );
	}

	/**
	 * Assignments made before the index existed have no rows until the
	 * schema migration builds them.
	 */
	public function test_the_migration_backfills_assignments_written_before_the_index(): void {
		update_post_meta(
			$this->post_id,
			'_vip_workflows_assignment_reviewer',
			array(
				'value'       => $this->user_a,
				'type'        => 'user',
				'status'      => AssignmentManager::STATUS_PENDING,
				'assigned_at' => '2026-10-01 00:00:00.000000',
			)
		);
		$this->assertSame( array(), $this->indexed() );

		$backfill = new \ReflectionMethod( Schema::class, 'backfill_pending_assignee_index' );
		$backfill->invoke( null );
		$this->assertSame( array( $this->user_a ), $this->indexed() );

		$backfill->invoke( null );
		$this->assertSame( array( $this->user_a ), $this->indexed(), 'Running it again changes nothing.' );
	}
}
