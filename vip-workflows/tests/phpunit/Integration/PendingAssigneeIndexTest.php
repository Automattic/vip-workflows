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

		// Booting the suite installed the plugin, which ran this backfill on an
		// empty site and recorded it as finished. Each test starts as an
		// upgrade does: nothing done, no lease. The test transaction rolls
		// this back.
		global $wpdb;
		foreach ( array( Schema::ASSIGNEE_BACKFILL_CURSOR_OPTION, Schema::ASSIGNEE_BACKFILL_LEASE_OPTION ) as $option ) {
			$wpdb->delete( $wpdb->options, array( 'option_name' => $option ) );
			wp_cache_delete( $option, 'options' );
		}
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
	 * The race the check-after-write exists for: a rebuild reads the slots,
	 * then another request assigns a second user and finishes its own rebuild
	 * before the first one deletes and rewrites the rows. Without the check the
	 * first rebuild writes back its snapshot and the second user's row is lost.
	 *
	 * Forced with core's pre-delete filter, which runs after the first
	 * rebuild's read and before its delete.
	 */
	public function test_a_rebuild_overtaken_by_another_requests_assignment_settles(): void {
		$interleave = function ( $check, $object_id, $meta_key ) use ( &$interleave ) {
			if ( $this->post_id === (int) $object_id && AssignmentManager::PENDING_ASSIGNEE_INDEX_KEY === $meta_key ) {
				remove_filter( 'delete_post_metadata', $interleave );
				// The other request: its own slot write and rebuild, start to finish.
				$this->assignments->assign( $this->post_id, 'legal', $this->user_b, 'user' );
			}
			return $check;
		};
		add_filter( 'delete_post_metadata', $interleave, 10, 3 );

		$this->assignments->assign( $this->post_id, 'reviewer', $this->user_a, 'user' );

		$this->assertSame( array( $this->user_a, $this->user_b ), $this->indexed() );
	}

	/**
	 * The backfill reads a page, then writes it. A live assignment between the
	 * two would be overwritten by the page's stale snapshot, so the page is
	 * read back and settled after it is written.
	 *
	 * Forced at the backfill's DELETE, after its read.
	 */
	public function test_a_backfill_page_overtaken_by_a_live_assignment_settles(): void {
		$this->write_raw_slot(
			'reviewer',
			array(
				'value'  => $this->user_a,
				'type'   => 'user',
				'status' => AssignmentManager::STATUS_PENDING,
			)
		);

		$interleave = function ( $query ) use ( &$interleave ) {
			if ( 0 === stripos( ltrim( $query ), 'DELETE FROM' ) && false !== strpos( $query, AssignmentManager::PENDING_ASSIGNEE_INDEX_KEY ) ) {
				remove_filter( 'query', $interleave );
				$this->assignments->assign( $this->post_id, 'legal', $this->user_b, 'user' );
			}
			return $query;
		};
		add_filter( 'query', $interleave );

		( new \ReflectionMethod( Schema::class, 'backfill_pending_assignee_index' ) )->invoke( null );

		$this->assertSame( array( $this->user_a, $this->user_b ), $this->indexed() );
	}

	/**
	 * A live rebuild can insert a post's row while the backfill is writing the
	 * same post, leaving it twice. Reading the page back removes the double.
	 *
	 * Forced at the backfill's INSERT, where the other writer's row lands
	 * first.
	 */
	public function test_a_backfill_page_doubled_by_another_writer_leaves_each_user_once(): void {
		$this->write_raw_slot(
			'reviewer',
			array(
				'value'  => $this->user_a,
				'type'   => 'user',
				'status' => AssignmentManager::STATUS_PENDING,
			)
		);

		$interleave = function ( $query ) use ( &$interleave ) {
			if ( 0 === stripos( ltrim( $query ), 'INSERT INTO' ) && false !== strpos( $query, AssignmentManager::PENDING_ASSIGNEE_INDEX_KEY ) ) {
				remove_filter( 'query', $interleave );
				// The other writer's row for the same post.
				add_post_meta( $this->post_id, AssignmentManager::PENDING_ASSIGNEE_INDEX_KEY, (string) $this->user_a );
			}
			return $query;
		};
		add_filter( 'query', $interleave );

		( new \ReflectionMethod( Schema::class, 'backfill_pending_assignee_index' ) )->invoke( null );

		$this->assertSame( array( $this->user_a ), $this->indexed() );
	}

	/**
	 * A backfill cut short resumes after the last post it finished, and
	 * records that it is finished once it reaches the end.
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

		update_option( Schema::ASSIGNEE_BACKFILL_CURSOR_OPTION, (string) $this->post_id, false );
		( new \ReflectionMethod( Schema::class, 'backfill_pending_assignee_index' ) )->invoke( null );

		$this->assertSame( array(), $this->indexed(), 'The post at the cursor was done before the cut, so it is not redone.' );
		$this->assertSame( array( (string) $this->user_a ), get_post_meta( $later, AssignmentManager::PENDING_ASSIGNEE_INDEX_KEY ) );
		global $wpdb;
		$this->assertSame( Schema::ASSIGNEE_BACKFILL_COMPLETE, $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", Schema::ASSIGNEE_BACKFILL_CURSOR_OPTION ) ) );
	}

	/**
	 * The stored pending assignment the lease tests backfill.
	 */
	private function write_pending_slot_for_user_a(): void {
		$this->write_raw_slot(
			'reviewer',
			array(
				'value'  => $this->user_a,
				'type'   => 'user',
				'status' => AssignmentManager::STATUS_PENDING,
			)
		);
	}

	/**
	 * Hold the backfill lease as another request would.
	 *
	 * @param int $expires Expiry timestamp.
	 */
	private function hold_lease( int $expires ): void {
		global $wpdb;

		$wpdb->insert(
			$wpdb->options,
			array(
				'option_name'  => Schema::ASSIGNEE_BACKFILL_LEASE_OPTION,
				'option_value' => 'another-request|' . $expires,
				'autoload'     => 'off',
			)
		);
	}

	/**
	 * Run the backfill.
	 */
	private function backfill(): void {
		( new \ReflectionMethod( Schema::class, 'backfill_pending_assignee_index' ) )->invoke( null );
	}

	/**
	 * While another request holds a live lease, a second request running the
	 * upgrade writes nothing, and does not mark the backfill finished.
	 */
	public function test_a_backfill_writes_nothing_while_another_request_holds_the_lease(): void {
		$this->write_pending_slot_for_user_a();
		$this->hold_lease( time() + 60 );

		try {
			$this->backfill();
			$this->fail( 'A backfill ran while another request held the lease.' );
		} catch ( \RuntimeException $e ) {
			$this->assertStringContainsString( 'running in another request', $e->getMessage() );
		}

		$this->assertSame( array(), $this->indexed() );
		global $wpdb;
		$this->assertNotSame( Schema::ASSIGNEE_BACKFILL_COMPLETE, $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", Schema::ASSIGNEE_BACKFILL_CURSOR_OPTION ) ) );
	}

	/**
	 * A lease past its expiry belonged to a request that died. It is taken
	 * over, the backfill runs, and the lease is given back.
	 */
	public function test_an_expired_lease_is_taken_over(): void {
		global $wpdb;

		$this->write_pending_slot_for_user_a();
		$this->hold_lease( time() - 1 );

		$this->backfill();

		$this->assertSame( array( $this->user_a ), $this->indexed() );
		$this->assertNull( $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", Schema::ASSIGNEE_BACKFILL_LEASE_OPTION ) ) );
	}

	/**
	 * Every renewal changes the lease's value, and the owner gives the lease
	 * back by its latest value. Releasing by the value it first claimed would
	 * match nothing once a renewal moved the expiry, and leave the lease
	 * standing, blocking every other request, until it ran out.
	 *
	 * Forced by waiting at the first page read, after the claim and before
	 * the renewal, until the clock ticks over, so the renewal must change the
	 * value.
	 */
	public function test_the_lease_is_released_after_a_renewal_changed_it(): void {
		global $wpdb;

		$this->write_pending_slot_for_user_a();

		$tick = function ( $query ) use ( &$tick ) {
			if ( false !== stripos( $query, 'SELECT DISTINCT post_id' ) ) {
				remove_filter( 'query', $tick );
				$claimed_at = time();
				while ( time() === $claimed_at ) {
					usleep( 50000 );
				}
			}
			return $query;
		};
		add_filter( 'query', $tick );

		$this->backfill();

		$this->assertSame( array( $this->user_a ), $this->indexed() );
		$this->assertNull( $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", Schema::ASSIGNEE_BACKFILL_LEASE_OPTION ) ), 'The lease was left behind after the backfill finished.' );
	}

	/**
	 * An owner whose lease was taken over stops before it writes a page, so a
	 * page it read before the takeover is never written.
	 *
	 * Forced by taking the lease over at the owner's first page read.
	 */
	public function test_an_owner_that_lost_its_lease_writes_nothing(): void {
		global $wpdb;

		$this->write_pending_slot_for_user_a();

		$take_over = function ( $query ) use ( &$take_over, $wpdb ) {
			if ( false !== stripos( $query, 'SELECT DISTINCT post_id' ) ) {
				remove_filter( 'query', $take_over );
				$wpdb->update( $wpdb->options, array( 'option_value' => 'another-request|' . ( time() + 60 ) ), array( 'option_name' => Schema::ASSIGNEE_BACKFILL_LEASE_OPTION ) );
			}
			return $query;
		};
		add_filter( 'query', $take_over );

		try {
			$this->backfill();
			$this->fail( 'An owner that lost its lease kept writing.' );
		} catch ( \RuntimeException $e ) {
			$this->assertStringContainsString( 'taken over', $e->getMessage() );
		}

		$this->assertSame( array(), $this->indexed() );
	}

	/**
	 * The case a lease alone does not cover: a request that decided to upgrade
	 * before another finished must not write once it has. The finished
	 * backfill is recorded, so the late request does nothing.
	 */
	public function test_a_backfill_started_after_another_finished_does_nothing(): void {
		update_option( Schema::ASSIGNEE_BACKFILL_CURSOR_OPTION, Schema::ASSIGNEE_BACKFILL_COMPLETE );
		$this->write_pending_slot_for_user_a();

		$this->backfill();

		$this->assertSame( array(), $this->indexed(), 'A late backfill wrote after the backfill was finished.' );
	}

	/**
	 * An owner can write a page from a read a live assignment has since made
	 * stale, then die before reading it back. Its cursor was not moved past
	 * that page, so the next owner, taking over the expired lease, redoes the
	 * page from a fresh read and the live assignment is indexed.
	 *
	 * Forced by assigning live at the page's DELETE, then failing the read
	 * back, and leaving an expired lease as a dead request would.
	 */
	public function test_a_page_left_stale_by_an_owner_that_died_is_redone_by_the_next(): void {
		$this->write_pending_slot_for_user_a();

		$interleave = function ( $query ) use ( &$interleave ) {
			if ( 0 === stripos( ltrim( $query ), 'DELETE FROM' ) && false !== strpos( $query, AssignmentManager::PENDING_ASSIGNEE_INDEX_KEY ) ) {
				remove_filter( 'query', $interleave );
				$this->assignments->assign( $this->post_id, 'legal', $this->user_b, 'user' );
			}
			return $query;
		};
		$die = function ( $query ) use ( &$die ) {
			if ( false !== stripos( $query, 'SELECT post_id, meta_value FROM' ) ) {
				remove_filter( 'query', $die );
				throw new \RuntimeException( 'The request died before reading its page back.' );
			}
			return $query;
		};
		add_filter( 'query', $interleave );
		add_filter( 'query', $die );

		try {
			$this->backfill();
			$this->fail( 'The simulated death did not happen.' );
		} catch ( \RuntimeException $e ) {
			$this->assertStringContainsString( 'died', $e->getMessage() );
		}
		$this->assertSame( array( $this->user_a ), $this->indexed(), 'Fixture: the dead owner left the page stale.' );

		$this->hold_lease( time() - 1 );
		$this->backfill();

		$this->assertSame( array( $this->user_a, $this->user_b ), $this->indexed() );
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
