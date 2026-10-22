<?php
/**
 * `GET /workflow/my-work` lists only posts the caller can read.
 *
 * The route gate is `edit_posts`, and a row is selected by involvement: the
 * caller is the author, the claimer, or a pending assignee. Involvement is
 * not access. An editor can assign anyone a transition offers, and a claim
 * or an authorship can outlive the rights it was made with, so a row can
 * name a post its reader is not allowed to open. Each row is therefore
 * checked with `read_post` before it is serialized.
 *
 * `read_post`, not `edit_post`: an author's post stays in their list after it
 * publishes (the route's own rule), and a Contributor can read their own
 * published post but cannot edit it. For another user's draft, pending or
 * scheduled post, core maps `read_post` to `edit_others_posts`.
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

class MyWorkPerObjectGateTest extends TestCase {

	/**
	 * Sequence with a draft stage and a terminal published stage.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Somebody who can edit every post.
	 *
	 * @var int
	 */
	private int $editor_id;

	/**
	 * Somebody who can edit only their own unpublished posts.
	 *
	 * @var int
	 */
	private int $contributor_id;

	public function set_up(): void {
		parent::set_up();
		Actor::flush();
		set_current_screen( 'front' );

		$admin = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );

		$this->editor_id      = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->contributor_id = (int) self::factory()->user->create( array( 'role' => 'contributor' ) );

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'My Work Rows',
			'my-work-rows',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'review',
						'label'        => 'Review',
						'status'       => 'draft',
						'region_entry' => true,
						'transitions'  => array( array( 'to' => 'published' ) ),
					),
					array(
						'key'          => 'published',
						'label'        => 'Published',
						'status'       => 'publish',
						'region_entry' => true,
						'is_terminal'  => true,
						'transitions'  => array(),
					),
				),
			),
			$admin
		);
	}

	public function tear_down(): void {
		Actor::flush();
		parent::tear_down();
	}

	/**
	 * Create a workflow post without running a transition.
	 *
	 * @param int    $author_id Post author.
	 * @param string $stage     Workflow stage.
	 * @return int Post ID.
	 */
	private function make_post( int $author_id, string $stage = 'review' ): int {
		$post_id = (int) self::factory()->post->create(
			array(
				'post_author' => $author_id,
				'post_status' => 'published' === $stage ? 'publish' : 'draft',
				'post_title'  => 'A post in the ' . $stage . ' stage',
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

		return $post_id;
	}

	/**
	 * Dispatch the endpoint as the given user.
	 *
	 * @param  int $user_id User to assume.
	 * @return array Response rows.
	 */
	private function work_as( int $user_id ): array {
		wp_set_current_user( $user_id );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/my-work' ) );
		$this->assertSame( 200, $response->get_status() );

		return (array) $response->get_data();
	}

	/**
	 * A pending assignment on a draft the assignee cannot read gives no row.
	 */
	public function test_an_assignee_who_cannot_read_the_draft_gets_no_row(): void {
		$draft = $this->make_post( $this->editor_id );
		( new AssignmentManager() )->assign( $draft, 'reviewer', $this->contributor_id, 'user' );

		$this->assertSame( array(), $this->work_as( $this->contributor_id ) );
	}

	/**
	 * A claim made while the claimer was the author does not keep the post in
	 * their list once the post belongs to somebody else.
	 */
	public function test_a_claim_on_a_post_the_claimer_can_no_longer_read_gets_no_row(): void {
		$draft = $this->make_post( $this->contributor_id );
		update_post_meta( $draft, '_vip_workflows_assigned_to', $this->contributor_id );
		wp_update_post(
			array(
				'ID'          => $draft,
				'post_author' => $this->editor_id,
			)
		);

		$this->assertSame( array(), $this->work_as( $this->contributor_id ) );
	}

	/**
	 * The same for an assignment slot that was pending when the post changed hands.
	 */
	public function test_a_pending_slot_on_a_post_the_assignee_can_no_longer_read_gets_no_row(): void {
		$draft = $this->make_post( $this->contributor_id );
		( new AssignmentManager() )->assign( $draft, 'reviewer', $this->contributor_id, 'user' );
		wp_update_post(
			array(
				'ID'          => $draft,
				'post_author' => $this->editor_id,
			)
		);

		$this->assertSame( array(), $this->work_as( $this->contributor_id ) );
	}

	/**
	 * A Contributor's own published post stays listed.
	 *
	 * The counterweight that fixes the predicate: a Contributor holds no
	 * `edit_published_posts`, so an `edit_post` check would drop a post from
	 * its author's list the moment it ships.
	 */
	public function test_an_author_still_sees_their_own_published_post(): void {
		$published = $this->make_post( $this->contributor_id, 'published' );

		$rows = $this->work_as( $this->contributor_id );

		$this->assertCount( 1, $rows );
		$this->assertSame( $published, $rows[0]['post_id'] );
		$this->assertSame( 'Published', $rows[0]['status_label'] );
	}

	/**
	 * An Editor assigned to another user's draft still sees it.
	 */
	public function test_an_assignee_who_can_read_the_draft_still_sees_it(): void {
		$author = (int) self::factory()->user->create( array( 'role' => 'author' ) );
		$draft  = $this->make_post( $author );
		( new AssignmentManager() )->assign( $draft, 'reviewer', $this->editor_id, 'user' );

		$rows = $this->work_as( $this->editor_id );

		$this->assertCount( 1, $rows );
		$this->assertSame( $draft, $rows[0]['post_id'] );
		$this->assertSame( $author, $rows[0]['author']['id'] );
	}
}
