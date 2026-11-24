<?php
/**
 * A user assignee must have one of the roles the assignment input allows.
 *
 * An assignment input can limit who may be chosen with `filter.roles`. The
 * editor's picker lists only users with those roles. The transition applies
 * the same limit, so a request that names another user is refused before
 * anything is written, with an error that names the field and the roles.
 *
 * Every assignee here can read the post, so a refusal is the role filter's
 * and not the read-access check's.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\Actor;
use VIPWorkflows\Workflow\AssignmentManager;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;
use WP_REST_Response;

class AssigneeRoleFilterTest extends TestCase {

	/**
	 * Fixture sequence.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Administrator who performs every transition.
	 *
	 * @var int
	 */
	private int $admin_id;

	/**
	 * An Editor.
	 *
	 * @var int
	 */
	private int $editor_id;

	/**
	 * The Author who wrote the fixture draft, and so can read it.
	 *
	 * @var int
	 */
	private int $author_id;

	public function set_up(): void {
		parent::set_up();
		Actor::flush();

		$this->admin_id  = (int) self::factory()->user->create(
			array(
				'role'         => 'administrator',
				'display_name' => 'Ada Admin',
			)
		);
		$this->editor_id = (int) self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Eli Editor',
			)
		);
		$this->author_id = (int) self::factory()->user->create(
			array(
				'role'         => 'author',
				'display_name' => 'Avery Author',
			)
		);
		wp_set_current_user( $this->admin_id );

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Assignee role filter',
			'assignee-role-filter',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'drafting',
						'label'        => 'Drafting',
						'status'       => 'draft',
						'region_entry' => true,
						'transitions'  => array(
							$this->edge( 'one_role', 'user', true, array( 'editor' ) ),
							$this->edge( 'two_roles', 'user', true, array( 'editor', 'administrator' ) ),
							$this->edge( 'optional', 'user', false, array( 'author' ) ),
							$this->edge( 'no_filter', 'user', true, null ),
							$this->edge( 'role_slot', 'role', true, array( 'editor' ) ),
						),
					),
					array(
						'key'    => 'one_role',
						'label'  => 'One role',
						'status' => 'draft',
					),
					array(
						'key'    => 'two_roles',
						'label'  => 'Two roles',
						'status' => 'draft',
					),
					array(
						'key'    => 'optional',
						'label'  => 'Optional',
						'status' => 'draft',
					),
					array(
						'key'    => 'no_filter',
						'label'  => 'No filter',
						'status' => 'draft',
					),
					array(
						'key'    => 'role_slot',
						'label'  => 'Role slot',
						'status' => 'draft',
					),
				),
			),
			$this->admin_id
		);
	}

	public function tear_down(): void {
		Actor::flush();
		parent::tear_down();
	}

	/**
	 * An edge to a stage, with one assignment input under the meta key `reviewer`.
	 *
	 * @param  string        $to            Target stage.
	 * @param  string        $assignee_type Assignee type.
	 * @param  bool          $required      Whether the slot must be filled.
	 * @param  string[]|null $roles         Roles the input allows, or null for no filter.
	 * @return array<string, mixed>
	 */
	private function edge( string $to, string $assignee_type, bool $required, ?array $roles ): array {
		$input = array(
			'type'          => 'assignment',
			'meta_key'      => 'reviewer',
			'assignee_type' => $assignee_type,
			'label'         => 'Reviewer',
			'required'      => $required,
		);

		if ( null !== $roles ) {
			$input['filter'] = array( 'roles' => $roles );
		}

		return array(
			'to'     => $to,
			'inputs' => array( $input ),
		);
	}

	/**
	 * The Author's draft, seated at the first stage.
	 *
	 * @return int Post ID.
	 */
	private function make_draft(): int {
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->author_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'drafting' );

		return $post_id;
	}

	/**
	 * POST a transition through the REST route.
	 *
	 * @param  int    $post_id    Post ID.
	 * @param  string $to_status  Target stage.
	 * @param  array  $input_data Transition input.
	 * @return WP_REST_Response
	 */
	private function transition( int $post_id, string $to_status, array $input_data ): WP_REST_Response {
		$request = new WP_REST_Request( 'POST', '/vip-workflows/v1/workflow/post/' . $post_id . '/transition' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body(
			(string) wp_json_encode(
				array(
					'to_status'  => $to_status,
					'input_data' => $input_data,
				)
			)
		);

		return rest_do_request( $request );
	}

	/**
	 * The stage the post is seated at.
	 *
	 * @param  int $post_id Post ID.
	 * @return string
	 */
	private function stage_of( int $post_id ): string {
		return (string) get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true );
	}

	public function test_a_user_outside_the_role_filter_is_refused_and_nothing_is_written(): void {
		$post_id = $this->make_draft();
		$this->assertTrue( user_can( $this->author_id, 'read_post', $post_id ), 'the assignee can open the post' );

		$response = $this->transition( $post_id, 'one_role', array( 'reviewer' => $this->author_id ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'assignee_role_not_allowed', $response->get_data()['code'] );
		$this->assertSame(
			'Avery Author can’t be assigned to “Reviewer”. Choose someone with the Editor role.',
			$response->get_data()['message']
		);
		$this->assertSame( 'reviewer', $response->get_data()['data']['meta_key'] );
		$this->assertSame( array( 'editor' ), $response->get_data()['data']['roles'] );
		$this->assertNull( ( new AssignmentManager() )->get( $post_id, 'reviewer' ) );
		$this->assertSame( 'drafting', $this->stage_of( $post_id ) );
	}

	public function test_a_user_with_the_role_is_assigned(): void {
		$post_id = $this->make_draft();

		$response = $this->transition( $post_id, 'one_role', array( 'reviewer' => $this->editor_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $this->editor_id, (int) ( new AssignmentManager() )->get( $post_id, 'reviewer' )['value'] );
		$this->assertSame( 'one_role', $this->stage_of( $post_id ) );
	}

	public function test_the_person_making_the_move_is_held_to_the_filter_too(): void {
		$post_id = $this->make_draft();

		// An administrator is in the Workflow override roles, and still is not
		// an Editor.
		$response = $this->transition( $post_id, 'one_role', array( 'reviewer' => $this->admin_id ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'assignee_role_not_allowed', $response->get_data()['code'] );
		$this->assertSame( 'drafting', $this->stage_of( $post_id ) );
	}

	public function test_the_refusal_names_every_role_the_input_allows(): void {
		$post_id = $this->make_draft();

		$response = $this->transition( $post_id, 'two_roles', array( 'reviewer' => $this->author_id ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'Avery Author can’t be assigned to “Reviewer”. Choose someone with one of these roles: Editor, Administrator.',
			$response->get_data()['message']
		);
	}

	public function test_a_user_with_any_one_of_several_roles_is_assigned(): void {
		foreach ( array( $this->editor_id, $this->admin_id ) as $assignee ) {
			$post_id = $this->make_draft();

			$response = $this->transition( $post_id, 'two_roles', array( 'reviewer' => $assignee ) );

			$this->assertSame( 200, $response->get_status() );
			$this->assertSame( 'two_roles', $this->stage_of( $post_id ) );
		}
	}

	public function test_a_user_who_holds_an_allowed_role_beside_another_is_assigned(): void {
		$post_id = $this->make_draft();
		get_userdata( $this->author_id )->add_role( 'editor' );

		$response = $this->transition( $post_id, 'one_role', array( 'reviewer' => $this->author_id ) );

		$this->assertSame( 200, $response->get_status() );
	}

	public function test_an_optional_slot_is_held_to_its_filter_when_it_is_filled(): void {
		$refused = $this->make_draft();
		$empty   = $this->make_draft();
		$filled  = $this->make_draft();

		$response = $this->transition( $refused, 'optional', array( 'reviewer' => $this->editor_id ) );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'assignee_role_not_allowed', $response->get_data()['code'] );
		$this->assertSame( 'drafting', $this->stage_of( $refused ) );

		$this->assertSame( 200, $this->transition( $empty, 'optional', array() )->get_status() );
		$this->assertSame( 200, $this->transition( $filled, 'optional', array( 'reviewer' => $this->author_id ) )->get_status() );
	}

	public function test_a_slot_with_no_filter_takes_any_user_who_can_open_the_post(): void {
		foreach ( array( $this->author_id, $this->editor_id, $this->admin_id ) as $assignee ) {
			$post_id = $this->make_draft();

			$this->assertSame( 200, $this->transition( $post_id, 'no_filter', array( 'reviewer' => $assignee ) )->get_status() );
		}
	}

	/**
	 * The role picker offers every role and takes no filter, so a role
	 * assignee is not held to one.
	 */
	public function test_a_role_assignee_is_not_held_to_the_filter(): void {
		$post_id = $this->make_draft();

		$response = $this->transition( $post_id, 'role_slot', array( 'reviewer' => 'administrator' ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'administrator', ( new AssignmentManager() )->get( $post_id, 'reviewer' )['value'] );
	}

	/**
	 * The server accepts exactly the users the picker's own request lists.
	 */
	public function test_the_server_takes_the_users_the_picker_offers_and_no_others(): void {
		$request = new WP_REST_Request( 'GET', '/vip-workflows/v1/assignable-users' );
		$request->set_param( 'roles', 'editor,administrator' );
		$request->set_param( 'include', implode( ',', array( $this->admin_id, $this->editor_id, $this->author_id ) ) );
		$offered = wp_list_pluck( rest_do_request( $request )->get_data(), 'id' );

		foreach ( array( $this->admin_id, $this->editor_id, $this->author_id ) as $assignee ) {
			$post_id  = $this->make_draft();
			$response = $this->transition( $post_id, 'two_roles', array( 'reviewer' => $assignee ) );

			$this->assertSame(
				in_array( $assignee, $offered, true ) ? 200 : 400,
				$response->get_status(),
				get_userdata( $assignee )->display_name
			);
		}

		$this->assertContains( $this->editor_id, $offered );
		$this->assertNotContains( $this->author_id, $offered );
	}
}
