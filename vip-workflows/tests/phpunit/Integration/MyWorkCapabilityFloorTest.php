<?php
/**
 * `GET /workflow/my-work` is the only route in the plugin with no capability floor.
 *
 * Every sibling requires `edit_posts` or a per-post `edit_post`. This one is
 * registered with `permission_callback => 'is_user_logged_in'`, so the whole
 * gate is "has an account". What bounds it after that is an identity test —
 * are you the author, the claimer, or an assignee — and that is business logic
 * about relevance, not a decision about authorization.
 *
 * It is reachable because nothing stops a Subscriber becoming an assignee:
 * `AssignableUsersController` applies no role filter, so Subscribers are
 * offered in the assignment picker. Assign one and they can read the post's
 * title and edit URL while holding no capability to edit anything.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

class MyWorkCapabilityFloorTest extends TestCase {

	/**
	 * A post claimed by the subscriber below.
	 *
	 * @var int
	 */
	private int $post_id;

	/**
	 * Somebody with an account and no editing rights at all.
	 *
	 * @var int
	 */
	private int $subscriber;

	public function set_up(): void {
		parent::set_up();

		$admin = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );

		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Work Flow',
			'work-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'review', 'label' => 'Review', 'status' => 'draft' ),
				),
			),
			$admin
		);

		$this->subscriber = (int) self::factory()->user->create( array( 'role' => 'subscriber' ) );

		$this->post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => (int) self::factory()->user->create( array( 'role' => 'author' ) ),
				'post_title'  => 'Draft a subscriber should not be reading',
			)
		);
		update_post_meta( $this->post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, 'review' );

		// The assignment picker offers Subscribers, so this is an ordinary state
		// rather than a contrived one.
		update_post_meta( $this->post_id, '_vip_workflows_assigned_to', $this->subscriber );
	}

	/**
	 * Dispatch the endpoint as a given user.
	 *
	 * @param  int $user_id User to assume.
	 * @return \WP_REST_Response
	 */
	private function work_as( int $user_id ): \WP_REST_Response {
		wp_set_current_user( $user_id );

		return rest_do_request( new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/my-work' ) );
	}

	/**
	 * A Subscriber is refused, claim or no claim.
	 */
	public function test_subscriber_is_refused(): void {
		$response = $this->work_as( $this->subscriber );

		$this->assertSame(
			403,
			$response->get_status(),
			'a route about editorial work needs an editorial capability'
		);
	}

	/**
	 * A logged-out caller too.
	 *
	 * Already true before the change — pinned so the floor cannot be raised in a
	 * way that accidentally lowers this.
	 */
	public function test_anonymous_is_refused(): void {
		$this->assertSame( 401, $this->work_as( 0 )->get_status() );
	}

	/**
	 * A Contributor still gets their own work.
	 *
	 * The counterweight: `edit_posts` is the floor, not `edit_others_posts`.
	 * This route is deliberately about the caller's own involvement, and the
	 * lowest editorial role has to keep reaching it.
	 */
	public function test_contributor_still_reaches_their_own_work(): void {
		$contributor = (int) self::factory()->user->create( array( 'role' => 'contributor' ) );
		update_post_meta( $this->post_id, '_vip_workflows_assigned_to', $contributor );

		$response = $this->work_as( $contributor );

		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( 1, (array) $response->get_data() );
	}
}
