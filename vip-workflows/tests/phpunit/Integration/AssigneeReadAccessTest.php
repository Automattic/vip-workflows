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

		// Drafting, In Review and On the Desk sit in the `draft` region, so
		// access is the same before and after a move between them. Live sits in
		// `publish`: a move to or from it changes who may read the post.
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
							array(
								'to'     => 'live',
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
						'key'          => 'live',
						'label'        => 'Live',
						'status'       => 'publish',
						'region_entry' => true,
						'transitions'  => array(
							array(
								'to'     => 'draft_stage',
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
		return $this->make_post( array( 'post_status' => 'draft' ), 'draft_stage' );
	}

	/**
	 * An Editor's post seated at a stage.
	 *
	 * @param  array  $args  Post fields.
	 * @param  string $stage Stage key.
	 * @return int Post ID.
	 */
	private function make_post( array $args, string $stage ): int {
		$post_id = (int) self::factory()->post->create( array_merge( array( 'post_author' => $this->editor_id ), $args ) );
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

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

	/**
	 * A Contributor cannot read an Editor's draft but can read it once it is
	 * published. Assigned on the move that publishes it, they are accepted.
	 */
	public function test_a_user_who_can_read_the_post_once_published_is_accepted_on_the_publishing_move(): void {
		$post_id = $this->make_draft();
		$this->assertFalse( user_can( $this->contributor_id, 'read_post', $post_id ) );

		$response = $this->transition( $post_id, 'live', array( 'reviewer' => $this->contributor_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( 'live', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( $this->contributor_id, (int) ( new AssignmentManager() )->get( $post_id, 'reviewer' )['value'] );
		$this->assertTrue( user_can( $this->contributor_id, 'read_post', $post_id ) );
	}

	/**
	 * A Contributor reads a published post, but not the draft it becomes.
	 * Assigned on the move that unpublishes it, they are refused and the post
	 * stays published.
	 */
	public function test_a_user_who_loses_access_on_the_unpublishing_move_is_refused(): void {
		$post_id = $this->make_post( array( 'post_status' => 'publish' ), 'live' );
		$this->assertTrue( user_can( $this->contributor_id, 'read_post', $post_id ) );

		$response = $this->transition( $post_id, 'draft_stage', array( 'reviewer' => $this->contributor_id ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'assignee_cannot_read', $response->get_data()['code'] );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( 'live', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertNull( ( new AssignmentManager() )->get( $post_id, 'reviewer' ) );
	}

	/**
	 * An Editor can read another user's draft, so the same unpublishing move
	 * accepts them.
	 */
	public function test_a_user_who_keeps_access_on_the_unpublishing_move_is_accepted(): void {
		$post_id     = $this->make_post( array( 'post_status' => 'publish' ), 'live' );
		$reviewer_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );

		$response = $this->transition( $post_id, 'draft_stage', array( 'reviewer' => $reviewer_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( $reviewer_id, (int) ( new AssignmentManager() )->get( $post_id, 'reviewer' )['value'] );
	}

	/**
	 * A future-dated post is scheduled, not published, by the publishing move.
	 * A scheduled post is not public, so a Contributor who is not its author
	 * cannot read it and is refused.
	 */
	public function test_a_publishing_move_that_schedules_the_post_is_judged_as_scheduled(): void {
		$date    = gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS );
		$post_id = $this->make_post(
			array(
				'post_status'   => 'draft',
				'post_date'     => get_date_from_gmt( $date ),
				'post_date_gmt' => $date,
			),
			'draft_stage'
		);

		$response = $this->transition( $post_id, 'live', array( 'reviewer' => $this->contributor_id ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'assignee_cannot_read', $response->get_data()['code'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_stage', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}
}
