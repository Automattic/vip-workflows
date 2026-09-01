<?php
/**
 * `GET /abilities?post_id=N` reads a caller-supplied post, so it must check it.
 *
 * The route's permission callback is a bare `edit_posts` — unlike its two
 * siblings in the same controller, which both resolve the object and check
 * `edit_post` on it. Passing `post_id` turns a global listing into a question
 * about one post: which transitions are available from its current stage, and
 * which tools gate them. A Contributor could ask that about anybody's post.
 *
 * It did not leak in practice, because the code that answers crashed first.
 * The map-building loop calls `$sequence->get_status()` on a variable that is
 * never assigned in that scope — a method call on null, i.e. an uncaught 500,
 * on every request where a transition declares `required_tools`. The crash was
 * masking the missing check, so both have to be fixed together or fixing the
 * fatal opens the leak.
 *
 * The lookup was never needed: `get_available_transitions()` already returns a
 * computed `label` for each transition.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

class AbilitiesPostIdGateTest extends TestCase {

	/**
	 * A tool that really is registered, so the filtered listing is non-empty.
	 */
	private const REQUIRED_TOOL = 'vip-workflows/keyword-check';

	/**
	 * A post authored by somebody else.
	 *
	 * @var int
	 */
	private int $other_users_post;

	public function set_up(): void {
		parent::set_up();

		$admin = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );

		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Tool Gate Flow',
			'tool-gate-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'status'      => 'draft',
						'transitions' => array(
							array(
								'to'             => 'done',
								'label'          => 'Approve',
								// The `required_tools` entry is what makes the
								// map-building loop run at all — and therefore
								// what triggered the fatal.
								'required_tools' => array( self::REQUIRED_TOOL ),
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
			)
		);
		update_post_meta( $this->other_users_post, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $this->other_users_post, StatusManager::STAGE_META_KEY, 'review' );
	}

	/**
	 * Call the listing, optionally scoped to a post.
	 *
	 * @param  string   $role    Role to assume.
	 * @param  int|null $post_id Post to scope to, or null for the global listing.
	 * @return \WP_REST_Response
	 */
	private function list_as( string $role, ?int $post_id = null ): \WP_REST_Response {
		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => $role ) ) );

		$request = new WP_REST_Request( 'GET', '/vip-workflows/v1/abilities' );
		if ( null !== $post_id ) {
			$request->set_query_params( array( 'post_id' => $post_id ) );
		}

		return rest_do_request( $request );
	}

	/**
	 * A Contributor cannot ask about somebody else's post.
	 */
	public function test_contributor_is_refused_for_another_users_post(): void {
		$response = $this->list_as( 'contributor', $this->other_users_post );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * An Editor can, and gets an answer rather than a crash.
	 *
	 * This is the half that proves the fatal is gone: before the fix this
	 * request died on a method call against an unassigned variable.
	 */
	public function test_editor_gets_the_scoped_listing(): void {
		$response = $this->list_as( 'editor', $this->other_users_post );

		$this->assertSame( 200, $response->get_status() );

		$abilities = array_column( (array) $response->get_data(), null, 'id' );
		$this->assertArrayHasKey( self::REQUIRED_TOOL, $abilities );
		$this->assertSame(
			array( array( 'to' => 'done', 'label' => 'Approve' ) ),
			$abilities[ self::REQUIRED_TOOL ]['required_for'],
			'the transition label comes from get_available_transitions(), not a second lookup'
		);
	}

	/**
	 * The unscoped listing is unchanged.
	 *
	 * The counterweight: this route is also the general tool listing, and that
	 * has always been a type-level question. Tightening the post-scoped form
	 * must not take the plain one with it.
	 */
	public function test_unscoped_listing_still_open_to_edit_posts(): void {
		$response = $this->list_as( 'contributor' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNotEmpty( $response->get_data() );
	}
}
