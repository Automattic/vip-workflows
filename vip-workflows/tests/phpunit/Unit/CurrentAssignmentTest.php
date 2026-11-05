<?php
/**
 * Current assignment selection and assignment-agent descriptions.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Workflow\AgentRunner;
use VIPWorkflows\Workflow\AssignmentManager;

/**
 * Exercise real assignment writes and reads with an in-memory post-meta store.
 */
class CurrentAssignmentTest extends TestCase {

	/**
	 * Assignment manager under test.
	 *
	 * @var AssignmentManager
	 */
	private AssignmentManager $manager;

	/**
	 * Time returned by the WordPress clock stub.
	 *
	 * @var \DateTimeImmutable
	 */
	private \DateTimeImmutable $now;

	/**
	 * Stored post meta, preserving insertion order when a slot is updated.
	 *
	 * @var array
	 */
	private array $meta = array();

	/**
	 * Exercise selection independently of the database's unspecified row order.
	 *
	 * @var bool
	 */
	private bool $reverse_rows = false;

	/**
	 * Database global to restore after the fixture.
	 *
	 * @var mixed
	 */
	private $previous_wpdb;

	/**
	 * Set up the fake clock and storage without booting WordPress or a database.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->manager = new AssignmentManager();
		$this->now     = new \DateTimeImmutable( '2026-09-21 12:00:00.100000', new \DateTimeZone( 'America/Chicago' ) );

		Functions\when( 'current_time' )->alias(
			fn( $format ) => $this->now->format( 'mysql' === $format ? 'Y-m-d H:i:s' : $format )
		);
		Functions\when( 'get_current_user_id' )->justReturn( 5 );
		Functions\when( 'update_post_meta' )->alias(
			function ( $post_id, $key, $value ) {
				$this->meta[ $key ] = $value;
				return true;
			}
		);
		Functions\when( 'get_post_meta' )->alias( fn( $post_id, $key ) => $this->meta[ $key ] ?? '' );
		Functions\when( 'delete_post_meta' )->alias(
			function ( $post_id, $key ) {
				unset( $this->meta[ $key ] );
				return true;
			}
		);
		Functions\when( 'maybe_unserialize' )->alias( fn( $value ) => $value );

		global $wpdb;
		$this->previous_wpdb = $wpdb;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Unit storage double, restored in tearDown().
		$wpdb             = Mockery::mock( 'wpdb' );
		$wpdb->postmeta   = 'wp_postmeta';
		$wpdb->last_error = '';
		$wpdb->shouldReceive( 'esc_like' )->andReturnUsing( fn( $value ) => $value );
		$wpdb->shouldReceive( 'prepare' )->andReturnUsing( fn( $query ) => $query );
		$wpdb->shouldReceive( 'get_results' )->andReturnUsing(
			function () {
				$rows = array();
				foreach ( $this->meta as $key => $value ) {
					$rows[] = (object) array(
						'meta_key'   => $key,
						'meta_value' => $value,
					);
				}
				return $this->reverse_rows ? array_reverse( $rows ) : $rows;
			}
		);
	}

	/**
	 * Restore the database global before releasing the function mocks.
	 */
	protected function tearDown(): void {
		global $wpdb;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restore the fixture's saved database global.
		$wpdb = $this->previous_wpdb;
		parent::tearDown();
	}

	/**
	 * A second assignment within one second replaces the earlier primary assignee.
	 */
	public function test_latest_assignment_wins_within_the_same_second(): void {
		$this->manager->assign( 42, 'first_reviewer', 7, 'user' );
		$this->now = $this->now->modify( '+100000 microseconds' );
		$this->manager->assign( 42, 'second_reviewer', 11, 'user' );

		$current = $this->manager->get_current( 42 );

		$this->assertSame( 'second_reviewer', $current['meta_key'] );
		$this->assertSame( 11, $current['assignment']['value'] );
		$this->assertSame( '2026-09-21 12:00:00.200000', $current['assignment']['assigned_at'] );
	}

	/**
	 * Reusing an older meta row must outrank a newer row when that slot is reassigned.
	 */
	public function test_reassigning_an_older_slot_is_current_regardless_of_row_order(): void {
		$this->manager->assign( 42, 'first_reviewer', 7, 'user' );
		$this->now = $this->now->modify( '+100000 microseconds' );
		$this->manager->assign( 42, 'second_reviewer', 11, 'user' );
		$this->now = $this->now->modify( '+100000 microseconds' );
		$this->manager->assign( 42, 'first_reviewer', 15, 'user' );
		$this->reverse_rows = true;

		$current = $this->manager->get_current( 42 );

		$this->assertSame( 'first_reviewer', $current['meta_key'] );
		$this->assertSame( 15, $current['assignment']['value'] );
		$this->assertCount( 2, $this->manager->get_all( 42 ), 'Reassignment updates the existing slot.' );
	}

	/**
	 * Recency applies across types, and clearing a slot preserves other pending work.
	 */
	public function test_clearing_the_latest_role_assignment_reveals_the_previous_pending_slot(): void {
		$this->manager->assign( 42, 'reviewer', 7, 'user' );
		$this->now = $this->now->modify( '+100000 microseconds' );
		$this->manager->assign( 42, 'approver', 'editor', 'role' );

		$this->assertSame( 'role', $this->manager->get_current( 42 )['assignment']['type'] );
		$this->manager->unassign( 42, 'approver' );
		$this->assertSame( 'reviewer', $this->manager->get_current( 42 )['meta_key'] );
	}

	/**
	 * Completed or expired assignments cannot remain the primary pending assignment.
	 */
	public function test_current_assignment_excludes_finished_slots(): void {
		$this->manager->assign( 42, 'reviewer', 7, 'user' );
		$this->now = $this->now->modify( '+100000 microseconds' );
		$this->manager->assign( 42, 'approver', 'editor', 'role' );
		$this->manager->mark_completed( 42, 'approver' );

		$this->assertSame( 'reviewer', $this->manager->get_current( 42 )['meta_key'] );
		$this->manager->mark_expired( 42, 'reviewer' );
		$this->assertNull( $this->manager->get_current( 42 ) );
	}

	/**
	 * Leaving a stage completes its pending user and role slots, and only those.
	 */
	public function test_stage_exit_completes_pending_user_and_role_slots(): void {
		$this->manager->assign( 42, 'reviewer', 7, 'user' );
		$this->manager->assign( 42, 'approver', 'editor', 'role' );
		$this->manager->assign( 42, 'checker', 'some-agent', 'agent' );
		$this->manager->assign( 42, 'legal', 9, 'user' );
		$this->manager->mark_expired( 42, 'legal' );

		$this->manager->complete_on_stage_exit( 42 );

		$this->assertSame( AssignmentManager::STATUS_COMPLETED, $this->manager->get( 42, 'reviewer' )['status'] );
		$this->assertSame( AssignmentManager::STATUS_COMPLETED, $this->manager->get( 42, 'approver' )['status'] );
		$this->assertSame( 5, $this->manager->get( 42, 'reviewer' )['completed_by'] );
		$this->assertSame( AssignmentManager::STATUS_PENDING, $this->manager->get( 42, 'checker' )['status'], 'The agent runner owns agent slots.' );
		$this->assertSame( AssignmentManager::STATUS_EXPIRED, $this->manager->get( 42, 'legal' )['status'], 'A finished slot keeps its outcome.' );
		$this->assertSame( 'checker', $this->manager->get_current( 42 )['meta_key'] );
	}

	/**
	 * Register assignment agents through the same filter their runner consumes.
	 *
	 * @param array $agents Registered assignment agents.
	 */
	private function register_agents( array $agents ): void {
		Functions\when( 'apply_filters' )->alias(
			fn( $hook, $value ) => 'vip_workflows_agents' === $hook ? $agents : $value
		);
		Functions\expect( 'wp_get_ability' )->never();
	}

	/**
	 * Assignment-agent ids are resolved by their own registry, not the abilities registry.
	 */
	public function test_registered_assignment_agent_is_described_by_its_label(): void {
		$this->register_agents( array( 'copy-reviewer' => array( 'label' => 'Copy reviewer' ) ) );

		$this->assertSame(
			array(
				'id'           => 0,
				'type'         => 'agent',
				'display_name' => 'Copy reviewer',
				'agent_actor'  => 'copy-reviewer',
				'avatar'       => null,
			),
			$this->manager->describe_assignee( 'agent', 'copy-reviewer' )
		);
	}

	/**
	 * An unknown assignment agent must not be given an invented actor description.
	 */
	public function test_unknown_assignment_agent_has_no_description(): void {
		$this->register_agents( array() );

		$this->assertNull( $this->manager->describe_assignee( 'agent', 'missing-reviewer' ) );
	}

	/**
	 * The description follows the runner UI's documented label default.
	 */
	public function test_agent_without_an_explicit_label_matches_the_runner_ui(): void {
		$this->register_agents( array( 'copy-reviewer' => array() ) );

		$description = $this->manager->describe_assignee( 'agent', 'copy-reviewer' );
		$ui_agents   = ( new AgentRunner() )->get_agents_for_ui();

		$this->assertSame( 'copy-reviewer', $description['display_name'] );
		$this->assertSame( $ui_agents[0]['label'], $description['display_name'] );
	}

	/**
	 * Many posts' current assignments come from one query, with the same
	 * selection rule get_current() applies to each post.
	 */
	public function test_current_assignments_for_many_posts_are_read_in_one_query(): void {
		global $wpdb;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Replaced for this test; tearDown() restores the original.
		$wpdb             = Mockery::mock( 'wpdb' );
		$wpdb->postmeta   = 'wp_postmeta';
		$wpdb->last_error = '';
		$wpdb->shouldReceive( 'esc_like' )->andReturnUsing( fn( $value ) => $value );
		$wpdb->shouldReceive( 'prepare' )
			->once()
			->with(
				'SELECT post_id, meta_key, meta_value FROM wp_postmeta WHERE post_id IN ( %d, %d, %d ) AND meta_key LIKE %s',
				array( 10, 11, 12, '_vip_workflows_assignment_%' )
			)
			->andReturn( 'batched-read' );
		$wpdb->shouldReceive( 'get_results' )
			->once()
			->with( 'batched-read' )
			->andReturn(
				array(
					(object) array(
						'post_id'    => '10',
						'meta_key'   => '_vip_workflows_assignment_reviewer',
						'meta_value' => array(
							'value'       => 7,
							'type'        => 'user',
							'status'      => 'pending',
							'assigned_at' => '2026-09-21 12:00:00.100000',
						),
					),
					(object) array(
						'post_id'    => '10',
						'meta_key'   => '_vip_workflows_assignment_approver',
						'meta_value' => array(
							'value'       => 'editor',
							'type'        => 'role',
							'status'      => 'pending',
							'assigned_at' => '2026-09-21 12:00:00.200000',
						),
					),
					(object) array(
						'post_id'    => '11',
						'meta_key'   => '_vip_workflows_assignment_reviewer',
						'meta_value' => array(
							'value'       => 8,
							'type'        => 'user',
							'status'      => 'completed',
							'assigned_at' => '2026-09-21 12:00:00.300000',
						),
					),
				)
			);

		// Post 10 appears twice in the input; it is queried once.
		$current = $this->manager->get_current_for_posts( array( 10, 11, 12, 10 ) );

		$this->assertSame( array( 10, 11, 12 ), array_keys( $current ) );
		$this->assertSame( 'approver', $current[10]['meta_key'], 'The most recent pending assignment wins.' );
		$this->assertSame( 'editor', $current[10]['assignment']['value'] );
		$this->assertNull( $current[11], 'A completed assignment is not current.' );
		$this->assertNull( $current[12], 'A post with no assignment has none.' );
	}

	/**
	 * No posts means no query.
	 */
	public function test_current_assignments_for_no_posts_skip_the_query(): void {
		global $wpdb;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Replaced for this test; tearDown() restores the original.
		$wpdb = Mockery::mock( 'wpdb' );
		$wpdb->shouldNotReceive( 'get_results' );

		$this->assertSame( array(), $this->manager->get_current_for_posts( array() ) );
	}

	/**
	 * A list longer than one chunk is read in one query per chunk, every post
	 * in exactly one of them, and the merged result is what reading each post
	 * on its own gives.
	 */
	public function test_current_assignments_for_many_posts_are_read_in_chunks(): void {
		global $wpdb;

		$chunk    = AssignmentManager::CURRENT_FOR_POSTS_CHUNK;
		$post_ids = range( 1, 2 * $chunk + 1 );

		// Every third post's assignment is finished, every fifth has none, and
		// the rest have two pending slots of which the later one is current.
		$rows = array();
		foreach ( $post_ids as $post_id ) {
			if ( 0 === $post_id % 5 ) {
				continue;
			}
			$status = 0 === $post_id % 3 ? 'completed' : 'pending';
			$rows[] = (object) array(
				'post_id'    => (string) $post_id,
				'meta_key'   => '_vip_workflows_assignment_reviewer',
				'meta_value' => array(
					'value'       => $post_id,
					'type'        => 'user',
					'status'      => $status,
					'assigned_at' => '2026-09-21 12:00:00.200000',
				),
			);
			$rows[] = (object) array(
				'post_id'    => (string) $post_id,
				'meta_key'   => '_vip_workflows_assignment_approver',
				'meta_value' => array(
					'value'       => 'editor',
					'type'        => 'role',
					'status'      => $status,
					'assigned_at' => '2026-09-21 12:00:00.100000',
				),
			);
		}

		$queried = array();

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Replaced for this test; tearDown() restores the original.
		$wpdb             = Mockery::mock( 'wpdb' );
		$wpdb->postmeta   = 'wp_postmeta';
		$wpdb->last_error = '';
		$wpdb->shouldReceive( 'esc_like' )->andReturnUsing( fn( $value ) => $value );
		$wpdb->shouldReceive( 'prepare' )->andReturnUsing(
			function ( $query, $args ) {
				$ids = array_slice( $args, 0, -1 );
				$this->assertSame( count( $ids ), substr_count( $query, '%d' ), 'One placeholder per post ID.' );
				return wp_json_encode( $ids );
			}
		);
		$wpdb->shouldReceive( 'get_results' )->andReturnUsing(
			function ( $prepared ) use ( $rows, &$queried ) {
				$ids       = json_decode( $prepared, true );
				$queried[] = $ids;
				return array_values( array_filter( $rows, fn( $row ) => in_array( (int) $row->post_id, $ids, true ) ) );
			}
		);
		Functions\when( 'wp_json_encode' )->alias( 'json_encode' );

		$batched = $this->manager->get_current_for_posts( $post_ids );

		$this->assertCount( 3, $queried, 'Three chunks for two chunks and one post.' );
		$this->assertSame( array( $chunk, $chunk, 1 ), array_map( 'count', $queried ) );
		$this->assertSame( $post_ids, array_merge( ...$queried ), 'Each post is queried once, in order.' );

		$queried = array();
		$single  = array();
		foreach ( $post_ids as $post_id ) {
			$single += $this->manager->get_current_for_posts( array( $post_id ) );
		}

		$this->assertSame( $single, $batched, 'Chunking does not change the result.' );
		$this->assertSame( 'reviewer', $batched[1]['meta_key'] );
		$this->assertNull( $batched[3], 'A finished assignment is not current.' );
		$this->assertNull( $batched[5], 'A post with no assignment has none.' );
	}
	/**
	 * A chunk whose query fails fails the whole read, whether get_results()
	 * answers null or the database reports an error. No partial map comes
	 * back, so no post is reported unassigned because its chunk was unread.
	 *
	 * @dataProvider failed_chunk_reads
	 *
	 * @param bool $returns_null Whether the failed query answers null rather than an empty list.
	 */
	public function test_current_assignments_fail_when_a_chunk_cannot_be_read( bool $returns_null ): void {
		global $wpdb;

		$chunk    = AssignmentManager::CURRENT_FOR_POSTS_CHUNK;
		$post_ids = range( 1, 2 * $chunk + 1 );
		$reads    = 0;

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Replaced for this test; tearDown() restores the original.
		$wpdb             = Mockery::mock( 'wpdb' );
		$wpdb->postmeta   = 'wp_postmeta';
		$wpdb->last_error = '';
		$wpdb->shouldReceive( 'esc_like' )->andReturnUsing( fn( $value ) => $value );
		$wpdb->shouldReceive( 'prepare' )->andReturn( 'chunk-read' );
		$wpdb->shouldReceive( 'get_results' )->andReturnUsing(
			function () use ( $wpdb, $returns_null, &$reads ) {
				++$reads;
				$wpdb->last_error = '';
				if ( 2 !== $reads ) {
					return array(
						(object) array(
							'post_id'    => (string) $reads,
							'meta_key'   => '_vip_workflows_assignment_reviewer',
							'meta_value' => array(
								'value'       => 7,
								'type'        => 'user',
								'status'      => 'pending',
								'assigned_at' => '2026-09-21 12:00:00.100000',
							),
						),
					);
				}
				$wpdb->last_error = 'Lost connection to server during query';
				return $returns_null ? null : array();
			}
		);

		$log_file = tempnam( sys_get_temp_dir(), 'vipwf-log-' );
		$previous = ini_set( 'error_log', $log_file );
		try {
			$result = $this->manager->get_current_for_posts( $post_ids );
		} finally {
			ini_set( 'error_log', $previous );
		}
		$log = (string) file_get_contents( $log_file );
		unlink( $log_file );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'assignment_read_failed', $result->get_error_code() );
		$this->assertSame( array( 'status' => 500 ), $result->get_error_data() );
		$this->assertSame( 2, $reads, 'The read stops at the failed chunk.' );
		$this->assertStringContainsString( '[VIP Workflows]', $log );
		$this->assertStringContainsString( 'assignment_read_failed', $log );
		$this->assertStringNotContainsString( 'Lost connection', $log, 'The database error text is not logged.' );
		$this->assertStringNotContainsString( 'chunk-read', $log, 'The SQL is not logged.' );
	}

	/**
	 * The two ways a failed read shows itself.
	 *
	 * @return array<string, array{bool}>
	 */
	public static function failed_chunk_reads(): array {
		return array(
			'get_results() answers null'  => array( true ),
			'last_error set, empty list' => array( false ),
		);
	}
}
