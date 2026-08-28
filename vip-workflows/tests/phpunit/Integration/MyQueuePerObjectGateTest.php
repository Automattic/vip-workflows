<?php
/**
 * `GET /workflow/my-queue` must not hand out posts the caller cannot edit.
 *
 * The route's own gate is a bare `edit_posts` — the capability a Contributor
 * holds — and the only per-post predicate it applies is
 * `Sequence::get_transitions_for_user()`, whose docblock says outright that
 * "the per-post `edit_post` baseline is enforced by `StatusManager::transition()`,
 * not here". Nothing in between asks whether this caller may see this post.
 *
 * So a Contributor received the title, author, sequence, stage and waiting time
 * of every other user's unpublished post sitting in a `show_in_queue` stage —
 * content core grants them neither `edit_post` nor `read_post` on.
 *
 * The fix is one line, and the line already exists in this controller: the
 * kanban endpoint skips any post failing `current_user_can( 'edit_post', ... )`,
 * as do the calendar and dashboard queries. This endpoint was the omission.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\StatusManager;
use WP_REST_Request;

class MyQueuePerObjectGateTest extends TestCase {

	/**
	 * The sequence under test.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * A post authored by somebody else, sitting in a queue-visible stage.
	 *
	 * @var int
	 */
	private int $other_users_post;

	public function set_up(): void {
		parent::set_up();

		$admin = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );

		// Both stages sit in the draft region, so traversing the edge needs no
		// region-crossing capability and the queue's own transition filter is not
		// what excludes anything here.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Queue Flow',
			'queue-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'           => 'review',
						'label'         => 'Review',
						'status'        => 'draft',
						'show_in_queue' => true,
						'transitions'   => array(
							array(
								'to'            => 'done',
								'label'         => 'Approve',
								'show_in_queue' => true,
							),
						),
					),
					array( 'key' => 'done', 'label' => 'Done', 'status' => 'draft' ),
				),
			),
			$admin
		);

		$author = (int) self::factory()->user->create( array( 'role' => 'author' ) );

		$this->other_users_post = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $author,
				'post_title'  => 'Somebody else unpublished draft',
			)
		);
		update_post_meta( $this->other_users_post, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $this->other_users_post, StatusManager::STAGE_META_KEY, 'review' );
	}

	/**
	 * Call the endpoint as the given role.
	 *
	 * @param  string $role Role to assume.
	 * @return array Queue items.
	 */
	private function queue_as( string $role ): array {
		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => $role ) ) );

		$response = rest_do_request( new WP_REST_Request( 'GET', '/vip-workflow/v1/workflow/my-queue' ) );

		return (array) $response->get_data();
	}

	/**
	 * A Contributor is not shown another user's unpublished post.
	 */
	public function test_contributor_does_not_see_another_users_post(): void {
		$items = $this->queue_as( 'contributor' );

		$this->assertSame(
			array(),
			$items,
			'the queue must not list a post the caller has no edit rights on'
		);
	}

	/**
	 * Nor is an Author, who also lacks `edit_others_posts`.
	 *
	 * Worth pinning separately: Author is the role most likely to be given to
	 * ordinary newsroom staff, and it holds `publish_posts`, so a reader might
	 * reasonably assume it is the trusted tier. It is not.
	 */
	public function test_author_does_not_see_another_users_post(): void {
		$this->assertSame( array(), $this->queue_as( 'author' ) );
	}

	/**
	 * An Editor still sees it.
	 *
	 * The counterweight. `edit_others_posts` is exactly the capability that
	 * makes another user's draft this person's business, and the queue is
	 * useless if it filters them out too.
	 */
	public function test_editor_still_sees_the_post(): void {
		$items = $this->queue_as( 'editor' );

		$this->assertCount( 1, $items );
		$this->assertSame( $this->other_users_post, $items[0]['post_id'] );
	}
}
