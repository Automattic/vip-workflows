<?php
/**
 * An assignee must be able to open the post they are assigned to.
 *
 * My Work lists an assigned post only for an assignee who passes `read_post`
 * on it. A user who cannot read the post is refused at assign time, so the
 * assigner can pick someone else. A role is accepted, but the transition
 * response warns when the role's members cannot all read the post.
 *
 * For another user's draft, core maps `read_post` to `edit_others_posts`, so
 * a Contributor cannot read an Editor's draft and another Editor can.
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

class AssigneeReadAccessTest extends TestCase {

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
	 * Author of the fixture draft.
	 *
	 * @var int
	 */
	private int $editor_id;

	/**
	 * A user who cannot read another user's draft.
	 *
	 * @var int
	 */
	private int $contributor_id;

	public function set_up(): void {
		parent::set_up();
		Actor::flush();

		$this->admin_id       = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->editor_id      = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->contributor_id = (int) self::factory()->user->create(
			array(
				'role'         => 'contributor',
				'display_name' => 'Casey Contributor',
			)
		);
		wp_set_current_user( $this->admin_id );

		// Every stage sits in the `draft` region, so access is the same before
		// and after each transition.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Assignee read access',
			'assignee-read-access',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'draft_stage',
						'label'        => 'Drafting',
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
							array(
								'to'     => 'desk',
								'inputs' => array(
									array(
										'type'          => 'assignment',
										'meta_key'      => 'desk',
										'assignee_type' => 'role',
										'label'         => 'Desk',
									),
								),
							),
						),
					),
					array(
						'key'         => 'review',
						'label'       => 'In Review',
						'status'      => 'draft',
						'transitions' => array(),
					),
					array(
						'key'         => 'desk',
						'label'       => 'On the Desk',
						'status'      => 'draft',
						'transitions' => array(),
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
	 * An Editor's draft seated at the first stage.
	 *
	 * @return int Post ID.
	 */
	private function make_draft(): int {
		$post_id = (int) self::factory()->post->create(
			array(
				'post_author' => $this->editor_id,
				'post_status' => 'draft',
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft_stage' );

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

	public function test_a_user_who_cannot_read_the_post_is_refused_and_nothing_is_written(): void {
		$post_id = $this->make_draft();
		$this->assertFalse( user_can( $this->contributor_id, 'read_post', $post_id ) );

		$response = $this->transition( $post_id, 'review', array( 'reviewer' => $this->contributor_id ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'assignee_cannot_read', $response->get_data()['code'] );
		$this->assertSame(
			'Casey Contributor can’t open this post, so they can’t be assigned to it.',
			$response->get_data()['message']
		);
		$this->assertNull( ( new AssignmentManager() )->get( $post_id, 'reviewer' ) );
		$this->assertSame( 'draft_stage', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	public function test_a_user_who_can_read_the_post_is_assigned_without_warnings(): void {
		$post_id     = $this->make_draft();
		$reviewer_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );

		$response = $this->transition( $post_id, 'review', array( 'reviewer' => $reviewer_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertArrayNotHasKey( 'warnings', $response->get_data() );
		$assignment = ( new AssignmentManager() )->get( $post_id, 'reviewer' );
		$this->assertSame( $reviewer_id, (int) $assignment['value'] );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	public function test_a_role_whose_members_cannot_read_the_post_is_assigned_with_a_warning(): void {
		$post_id = $this->make_draft();

		$response = $this->transition( $post_id, 'desk', array( 'desk' => 'contributor' ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'contributor', ( new AssignmentManager() )->get( $post_id, 'desk' )['value'] );
		$this->assertSame( 'desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		$warnings = $response->get_data()['warnings'] ?? array();
		$this->assertCount( 1, $warnings );
		$this->assertSame( 'assignee_cannot_read', $warnings[0]['type'] );
		$this->assertSame( 'desk', $warnings[0]['meta_key'] );
		$this->assertSame( 'contributor', $warnings[0]['role'] );
		$this->assertStringContainsString( 'Contributor role', $warnings[0]['message'] );
	}

	public function test_a_role_whose_members_can_read_the_post_is_assigned_without_warnings(): void {
		$post_id = $this->make_draft();

		$response = $this->transition( $post_id, 'desk', array( 'desk' => 'editor' ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'editor', ( new AssignmentManager() )->get( $post_id, 'desk' )['value'] );
		$this->assertArrayNotHasKey( 'warnings', $response->get_data() );
	}
}
