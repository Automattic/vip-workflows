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
	 * Run a callback with error_log() captured, and return what was logged.
	 *
	 * @param callable $callback Work that may log.
	 * @return string The log output.
	 */
	private function capture_log( callable $callback ): string {
		$file     = wp_tempnam( 'vipwf-index-log' );
		$previous = ini_set( 'error_log', $file ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- capturing this test's own log output.
		try {
			$callback();
		} finally {
			ini_set( 'error_log', (string) $previous ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- restoring the setting changed above.
		}
		$log = (string) file_get_contents( $file );
		unlink( $file );
		return $log;
	}

	/**
	 * Write a slot straight to post meta, bypassing AssignmentManager and its
	 * hooks, the way data written before the index or by hand arrives.
	 *
	 * @param string $slot  Slot key.
	 * @param mixed  $value Stored value.
	 */
	private function write_raw_slot( string $slot, $value ): void {
		update_post_meta( $this->post_id, AssignmentManager::STORAGE_PREFIX . $slot, $value );
	}

	/**
	 * A malformed slot is a data-integrity error: it is logged with its post
	 * and slot, and left out, while the post's other slots are still indexed.
	 */
	public function test_a_malformed_slot_is_logged_and_left_out(): void {
		$this->write_raw_slot( 'broken', array( 'type' => 'user', 'status' => AssignmentManager::STATUS_PENDING ) );
		$this->write_raw_slot( 'not_an_array', 'nonsense' );

		$log = $this->capture_log(
			function (): void {
				$this->assignments->assign( $this->post_id, 'reviewer', $this->user_a, 'user' );
			}
		);

		$this->assertSame( array( $this->user_a ), $this->indexed() );
		$this->assertStringContainsString( sprintf( 'Assignment slot %sbroken on post %d is malformed', AssignmentManager::STORAGE_PREFIX, $this->post_id ), $log );
		$this->assertStringContainsString( sprintf( 'Assignment slot %snot_an_array on post %d is malformed', AssignmentManager::STORAGE_PREFIX, $this->post_id ), $log );
	}

	/**
	 * A pending user assignment whose value is not a user ID is never indexed
	 * as user 0, which would match no one and hide the fault.
	 */
	public function test_a_pending_user_assignment_without_a_user_id_is_never_indexed_as_zero(): void {
		$this->write_raw_slot(
			'reviewer',
			array(
				'type'   => 'user',
				'status' => AssignmentManager::STATUS_PENDING,
				'value'  => '',
			)
		);

		$log = $this->capture_log(
			function (): void {
				$this->assignments->sync_pending_assignee_index( $this->post_id );
			}
		);

		$this->assertSame( array(), $this->indexed() );
		$this->assertStringContainsString( 'names no valid user ID', $log );
	}

	/**
	 * The rebuild runs under a per-post lock, and gives it back.
	 */
	public function test_the_rebuild_releases_its_lock(): void {
		global $wpdb;

		$this->assignments->assign( $this->post_id, 'reviewer', $this->user_a, 'user' );

		$this->assertSame( '1', $wpdb->get_var( $wpdb->prepare( 'SELECT IS_FREE_LOCK(%s)', 'vip_workflows_assignee_index_' . $this->post_id ) ) );
	}

	/**
	 * A backfill cut short resumes after the last post it finished, and clears
	 * its cursor once it reaches the end.
	 */
	public function test_the_backfill_resumes_from_its_cursor(): void {
		$pending = array(
			'value'  => $this->user_a,
			'type'   => 'user',
			'status' => AssignmentManager::STATUS_PENDING,
		);
		$this->write_raw_slot( 'reviewer', $pending );
		$later = (int) self::factory()->post->create();
		update_post_meta( $later, AssignmentManager::STORAGE_PREFIX . 'reviewer', $pending );

		update_option( Schema::ASSIGNEE_BACKFILL_CURSOR_OPTION, $this->post_id );
		( new \ReflectionMethod( Schema::class, 'backfill_pending_assignee_index' ) )->invoke( null );

		$this->assertSame( array(), $this->indexed(), 'The post at the cursor was done before the cut, so it is not redone.' );
		$this->assertSame( array( (string) $this->user_a ), get_post_meta( $later, AssignmentManager::PENDING_ASSIGNEE_INDEX_KEY ) );
		$this->assertFalse( get_option( Schema::ASSIGNEE_BACKFILL_CURSOR_OPTION ) );
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
