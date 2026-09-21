<?php
/**
 * Integration coverage: the "Assigned to" header (the REST `assigned_to`
 * field, read by the editor sidebar and the Kanban board) reflects a post's
 * current assignment — whichever pending assignment, of ANY assignee type,
 * was made most recently.
 *
 * Before this, `assigned_to` was built by scanning a post's assignment slots
 * for the FIRST one whose type was `user`, ignoring `role` (and `agent`)
 * assignments outright and not even tracking recency among the user ones. A
 * post with a role-assigning transition, or with more than one assignment
 * slot, could show a stale or entirely wrong "who this is assigned to."
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\API\WorkflowController;
use VIPWorkflows\Workflow\AssignmentManager;

/**
 * Real-WordPress tests for the "Assigned to" header field.
 */
class AssignedToHeaderIntegrationTest extends TestCase
{
	private const ASSIGNMENT_AGENT_ID = 'integration-assignment-agent';

	/**
	 * Assignment manager under test.
	 *
	 * @var AssignmentManager
	 */
	private AssignmentManager $assignment_manager;

	public function set_up(): void
	{
		parent::set_up();

		$this->assignment_manager = new AssignmentManager();
	}

	// =========================================================================
	// AssignmentManager::get_current() — which slot wins
	// =========================================================================

	/**
	 * Write an assignment directly to post meta, with an explicit
	 * `assigned_at`, bypassing `assign()` so the test controls ordering
	 * without depending on wall-clock timing.
	 *
	 * @param int    $post_id     Post ID.
	 * @param string $meta_key    Assignment slot key.
	 * @param string $type        Assignee type.
	 * @param mixed  $value       Raw stored value.
	 * @param string $assigned_at 'Y-m-d H:i:s'.
	 * @param string $status      Assignment status.
	 */
	private function write_assignment(
		int $post_id,
		string $meta_key,
		string $type,
		$value,
		string $assigned_at,
		string $status = AssignmentManager::STATUS_PENDING
	): void {
		update_post_meta(
			$post_id,
			'_vip_workflows_assignment_' . $meta_key,
			array(
				'value'       => $value,
				'type'        => $type,
				'status'      => $status,
				'assigned_at' => $assigned_at,
				'assigned_by' => 1,
			)
		);
	}

	/**
	 * A role assignment is a real candidate for "current" — not silently
	 * skipped the way the old user-only scan skipped it.
	 */
	public function test_get_current_returns_a_role_assignment_when_it_is_the_only_one(): void
	{
		$post_id = self::factory()->post->create();

		$this->write_assignment( $post_id, 'approver', 'role', 'editor', '2026-01-01 10:00:00' );

		$current = $this->assignment_manager->get_current( $post_id );

		$this->assertNotNull( $current );
		$this->assertSame( 'approver', $current['meta_key'] );
		$this->assertSame( 'role', $current['assignment']['type'] );
	}

	/**
	 * Among several pending slots of mixed type, the one assigned most
	 * recently wins — not whichever slot happens to be a user, and not
	 * whichever slot's post meta row was created first.
	 */
	public function test_get_current_picks_the_most_recently_assigned_slot_regardless_of_type(): void
	{
		$post_id = self::factory()->post->create();

		// Created first (so it would win under the old "first found" rule),
		// but assigned earliest — must lose to the later role assignment.
		$this->write_assignment( $post_id, 'reviewer', 'user', '32', '2026-01-01 10:00:00' );
		$this->write_assignment( $post_id, 'approver', 'role', 'editor', '2026-01-01 12:00:00' );

		$current = $this->assignment_manager->get_current( $post_id );

		$this->assertSame( 'approver', $current['meta_key'] );
		$this->assertSame( 'role', $current['assignment']['type'] );
	}

	/**
	 * Two user assignments, exactly the shape a post can end up in after
	 * several transitions each asking for a reviewer — the current one is
	 * whichever was assigned last, not "the first user assignment found."
	 */
	public function test_get_current_picks_the_most_recent_among_multiple_user_assignments(): void
	{
		$post_id = self::factory()->post->create();

		$this->write_assignment( $post_id, 'first_reviewer', 'user', '32', '2026-01-01 10:00:00' );
		$this->write_assignment( $post_id, 'second_reviewer', 'user', '7', '2026-01-01 11:00:00' );

		$current = $this->assignment_manager->get_current( $post_id );

		$this->assertSame( 'second_reviewer', $current['meta_key'] );
		$this->assertSame( '7', $current['assignment']['value'] );
	}

	/**
	 * A completed (non-pending) assignment is not "current" — the same rule
	 * the previous code applied, preserved here.
	 */
	public function test_get_current_ignores_a_completed_assignment(): void
	{
		$post_id = self::factory()->post->create();

		$this->write_assignment(
			$post_id,
			'reviewer',
			'user',
			'32',
			'2026-01-01 10:00:00',
			AssignmentManager::STATUS_COMPLETED
		);

		$this->assertNull( $this->assignment_manager->get_current( $post_id ) );
	}

	/**
	 * A post with no assignment slots at all has no current assignment.
	 */
	public function test_get_current_returns_null_with_no_assignments(): void
	{
		$post_id = self::factory()->post->create();

		$this->assertNull( $this->assignment_manager->get_current( $post_id ) );
	}

	/**
	 * Clearing the current slot exposes the remaining pending assignment.
	 */
	public function test_clearing_the_latest_slot_reveals_the_other_pending_assignment(): void {
		$post_id = self::factory()->post->create();
		$this->write_assignment( $post_id, 'approver', 'role', 'editor', '2026-01-01 10:00:00' );
		$this->write_assignment( $post_id, 'reviewer', 'user', '32', '2026-01-01 11:00:00' );
		$remaining = $this->assignment_manager->get( $post_id, 'approver' );

		$this->assertSame( 'reviewer', $this->assignment_manager->get_current( $post_id )['meta_key'] );
		$this->assignment_manager->unassign( $post_id, 'reviewer' );

		$this->assertFalse( metadata_exists( 'post', $post_id, '_vip_workflows_assignment_reviewer' ) );
		$this->assertSame(
			array(
				'meta_key'   => 'approver',
				'assignment' => $remaining,
			),
			$this->assignment_manager->get_current( $post_id )
		);
	}

	// =========================================================================
	// AssignmentManager::describe_assignee()
	// =========================================================================

	/**
	 * A role has no single person behind it, so it is described by name
	 * rather than resolved through Actor::from_user().
	 */
	public function test_describe_assignee_names_a_role(): void
	{
		$description = $this->assignment_manager->describe_assignee( 'role', 'editor' );

		$this->assertSame( 'role', $description['type'] );
		$this->assertSame( 'Editor', $description['display_name'] );
		$this->assertNull( $description['avatar'] );
	}

	/**
	 * A retired role slug (renamed away, or from an uninstalled plugin)
	 * cannot be named, so it resolves to null rather than a guess.
	 */
	public function test_describe_assignee_returns_null_for_an_unknown_role(): void
	{
		$this->assertNull(
			$this->assignment_manager->describe_assignee( 'role', 'role_that_never_existed' )
		);
	}

	/**
	 * A user resolves through the same Actor shape every other route serves
	 * a person in.
	 */
	public function test_describe_assignee_resolves_a_user(): void
	{
		$user_id = (int) self::factory()->user->create( array( 'display_name' => 'Jane Reviewer' ) );

		$description = $this->assignment_manager->describe_assignee( 'user', (string) $user_id );

		$this->assertSame( 'user', $description['type'] );
		$this->assertSame( 'Jane Reviewer', $description['display_name'] );
	}

	/**
	 * Register an assignment agent independently of the Abilities API.
	 */
	private function register_assignment_agent(): void {
		add_filter(
			'vip_workflows_agents',
			static function ( array $agents ): array {
				$agents[ self::ASSIGNMENT_AGENT_ID ] = array(
					'label'   => 'Editorial Checker',
					'handler' => '__return_true',
				);
				return $agents;
			}
		);

		$ability_names = array_map(
			static function ( $ability ): string {
				return $ability->get_name();
			},
			wp_get_abilities()
		);
		$this->assertNotContains( self::ASSIGNMENT_AGENT_ID, $ability_names );
	}

	/**
	 * Assignment agents are named through their own registry, without an Ability.
	 */
	public function test_describe_assignee_resolves_a_registered_assignment_agent(): void {
		$this->register_assignment_agent();

		$this->assertSame(
			array(
				'id'           => 0,
				'type'         => 'agent',
				'display_name' => 'Editorial Checker',
				'agent_actor'  => self::ASSIGNMENT_AGENT_ID,
				'avatar'       => null,
			),
			$this->assignment_manager->describe_assignee( 'agent', self::ASSIGNMENT_AGENT_ID )
		);
	}

	// =========================================================================
	// WorkflowController::get_post_status() — the `assigned_to` REST field
	// =========================================================================

	/**
	 * The REST payload names roles and registered assignment agents as the
	 * current assignee, even when the agent has no corresponding Ability.
	 *
	 * @dataProvider non_user_assignments
	 * @param string $type         Assignee type.
	 * @param string $value        Assignment value.
	 * @param string $display_name Expected assignee name.
	 */
	public function test_assigned_to_field_surfaces_non_user_assignments( string $type, string $value, string $display_name ): void {
		if ( 'agent' === $type ) {
			$this->register_assignment_agent();
		}

		$editor_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor_id );

		$sequence_id = (int) ( new \VIPWorkflows\Sequences\SequenceRepository() )->create(
			'Assigned To Header Flow',
			'assigned-to-header-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'status_1',
						'label'        => 'Ideas',
						'status'       => 'draft',
						'region_entry' => true,
						'transitions'  => array(),
					),
				),
			),
			$editor_id
		);

		$post_id = (int) self::factory()->post->create( array( 'post_status' => 'draft' ) );
		update_post_meta( $post_id, \VIPWorkflows\Workflow\StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, \VIPWorkflows\Workflow\StatusManager::STAGE_META_KEY, 'status_1' );

		$this->write_assignment( $post_id, 'approver', $type, $value, '2026-01-01 10:00:00' );

		$request = new \WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/post/' . $post_id . '/status' );
		$request->set_param( 'id', $post_id );

		$response = ( new WorkflowController() )->get_post_status( $request );
		$data     = $response->get_data();

		$this->assertNotNull( $data['assigned_to'], 'A non-user assignment must surface as the current assignee.' );
		$this->assertSame( $type, $data['assigned_to']['type'] );
		$this->assertSame( $display_name, $data['assigned_to']['display_name'] );
		$this->assertSame( 'approver', $data['assigned_to']['slot'] );
		$this->assertFalse( $data['assigned_to']['is_current'] );
	}

	/**
	 * Non-user assignments supported by the header.
	 *
	 * @return array
	 */
	public static function non_user_assignments(): array {
		return array(
			'role'  => array( 'role', 'editor', 'Editor' ),
			'agent' => array( 'agent', self::ASSIGNMENT_AGENT_ID, 'Editorial Checker' ),
		);
	}
}
