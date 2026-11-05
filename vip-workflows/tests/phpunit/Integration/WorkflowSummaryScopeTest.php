<?php
/**
 * Stage counts are scoped to the posts the caller may edit.
 *
 * The `get-workflow-summary` ability and `GET /sequences/{id}/stats` both
 * answer a count of posts at each stage, and both are open to anyone with
 * `edit_posts`. A count is an aggregate over posts the caller may not be
 * able to read, so the scope is decided once, in
 * `StageQuery::author_scope_for_current_user()`: a caller who can edit
 * others' posts gets the site-wide count, anyone else gets a count of their
 * own posts — the scope core gives the per-status counts on edit.php. These
 * tests pin that decision at both surfaces.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

class WorkflowSummaryScopeTest extends TestCase {

	/**
	 * Sequence with two stages.
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

		$admin = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );

		$this->editor_id      = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		$this->contributor_id = (int) self::factory()->user->create( array( 'role' => 'contributor' ) );

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Summary Scope',
			'summary-scope',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'writing',
						'label'        => 'Writing',
						'status'       => 'draft',
						'region_entry' => true,
						'transitions'  => array( array( 'to' => 'review' ) ),
					),
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'status'      => 'draft',
						'transitions' => array(),
					),
				),
			),
			$admin
		);

		// Two of the editor's drafts in writing, one in review; one of the
		// contributor's in writing.
		$this->make_post( $this->editor_id, 'writing' );
		$this->make_post( $this->editor_id, 'writing' );
		$this->make_post( $this->editor_id, 'review' );
		$this->make_post( $this->contributor_id, 'writing' );
	}

	/**
	 * Create a workflow post without running a transition.
	 *
	 * @param  int    $author_id Post author.
	 * @param  string $stage     Workflow stage.
	 * @return int Post ID.
	 */
	private function make_post( int $author_id, string $stage ): int {
		$post_id = (int) self::factory()->post->create(
			array(
				'post_author' => $author_id,
				'post_status' => 'draft',
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

		return $post_id;
	}

	/**
	 * Run the summary ability for this sequence and answer its stage counts.
	 *
	 * @param  int $user_id User to assume.
	 * @return array<string, int> Stage key => count.
	 */
	private function summary_counts_as( int $user_id ): array {
		wp_set_current_user( $user_id );

		$ability_id = 'vip-workflows/get-workflow-summary';
		$this->assertTrue( wp_has_ability( $ability_id ), "$ability_id is registered" );

		$result = wp_get_ability( $ability_id )->execute( array( 'sequence_id' => $this->sequence_id ) );
		$this->assertIsArray( $result, 'the summary ran' );
		$this->assertCount( 1, $result['sequences'] );

		return array_column( $result['sequences'][0]['statuses'], 'count', 'status' );
	}

	/**
	 * Fetch the stats route for this sequence as the given user.
	 *
	 * @param  int $user_id User to assume.
	 * @return array<string, int> Stage key => count.
	 */
	private function stats_as( int $user_id ): array {
		wp_set_current_user( $user_id );

		$response = rest_do_request( new WP_REST_Request( 'GET', '/vip-workflows/v1/sequences/' . $this->sequence_id . '/stats' ) );
		$this->assertSame( 200, $response->get_status() );

		return (array) $response->get_data();
	}

	/**
	 * A Contributor's summary counts their own posts only.
	 */
	public function test_summary_counts_only_the_callers_posts_below_edit_others_posts(): void {
		$this->assertSame(
			array(
				'writing' => 1,
				'review'  => 0,
			),
			$this->summary_counts_as( $this->contributor_id )
		);
	}

	/**
	 * An Editor's summary counts every author's posts.
	 */
	public function test_summary_counts_every_post_for_a_caller_who_can_edit_others_posts(): void {
		$this->assertSame(
			array(
				'writing' => 3,
				'review'  => 1,
			),
			$this->summary_counts_as( $this->editor_id )
		);
	}

	/**
	 * The stats route follows the same scope.
	 */
	public function test_stats_route_counts_only_the_callers_posts_below_edit_others_posts(): void {
		$this->assertSame(
			array(
				'writing' => 1,
				'review'  => 0,
			),
			$this->stats_as( $this->contributor_id )
		);
	}

	/**
	 * And the site-wide count for an Editor.
	 */
	public function test_stats_route_counts_every_post_for_a_caller_who_can_edit_others_posts(): void {
		$this->assertSame(
			array(
				'writing' => 3,
				'review'  => 1,
			),
			$this->stats_as( $this->editor_id )
		);
	}
}
