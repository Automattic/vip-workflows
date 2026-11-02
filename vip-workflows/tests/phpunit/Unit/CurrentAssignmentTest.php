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
		$wpdb           = Mockery::mock( 'wpdb' );
		$wpdb->postmeta = 'wp_postmeta';
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
}
