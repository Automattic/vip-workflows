<?php
/**
 * My Work visibility through real assignment storage and WordPress queries.
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

/**
 * Exercise the involvement lookup and pagination without a WP_Query double.
 */
class MyWorkVisibilityTest extends TestCase {

	/**
	 * Sequence containing draft and terminal published stages.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * User whose work is requested.
	 *
	 * @var int
	 */
	private int $author_id;

	/**
	 * Author of unrelated and assigned posts.
	 *
	 * @var int
	 */
	private int $other_id;

	/**
	 * Create independent users and a sequence for each visibility scenario.
	 */
	public function set_up(): void {
		parent::set_up();
		Actor::flush();
		set_current_screen( 'front' );

		$admin = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );
		$this->author_id = (int) self::factory()->user->create( array( 'role' => 'author' ) );
		$this->other_id  = (int) self::factory()->user->create( array( 'role' => 'author' ) );

		$sequence_id = ( new SequenceRepository() )->create(
			'My Work Visibility',
			'my-work-visibility',
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
		$this->assertIsInt( $sequence_id );
		$this->sequence_id = $sequence_id;
	}

	/**
	 * Discard cached actors before the database fixture is rolled back.
	 */
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
				'post_date'   => '2026-01-01 12:00:00',
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );
		return $post_id;
	}

	/**
	 * Dispatch the endpoint as the author under test.
	 *
	 * @return array Response rows.
	 */
	private function get_work(): array {
		wp_set_current_user( $this->author_id );
		$response = rest_do_request( new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/my-work' ) );
		$this->assertSame( 200, $response->get_status() );
		return $response->get_data();
	}

	/**
	 * Authorship, claims, and pending user assignments are independent reasons
	 * for inclusion; an unrelated sticky must not bypass any of them.
	 */
	public function test_returns_only_involved_posts_including_terminal_stages(): void {
		$published = $this->make_post( $this->author_id, 'published' );
		$claimed   = $this->make_post( $this->other_id );
		$assigned  = $this->make_post( $this->other_id );
		$completed = $this->make_post( $this->other_id );
		$unrelated = $this->make_post( $this->other_id, 'published' );
		update_post_meta( $claimed, '_vip_workflows_assigned_to', $this->author_id );

		$assignments = new AssignmentManager();
		$assignments->assign( $assigned, 'reviewer', $this->author_id, 'user' );
		$assignments->assign( $completed, 'reviewer', $this->author_id, 'user' );
		$assignments->mark_completed( $completed, 'reviewer' );
		$assignments->assign( $unrelated, 'reviewer', $this->other_id, 'user' );
		stick_post( $unrelated );

		$rows = $this->get_work();
		$this->assertCount( 3, $rows );
		$this->assertEqualsCanonicalizing( array( $published, $claimed, $assigned ), array_column( $rows, 'post_id' ) );

		$by_id = array_column( $rows, null, 'post_id' );
		$this->assertSame( 'Published', $by_id[ $published ]['status_label'] );
		$this->assertSame( 'publish', $by_id[ $published ]['post_status'] );
		$this->assertSame( 'Review', $by_id[ $claimed ]['status_label'] );
		$this->assertSame( $this->author_id, $by_id[ $claimed ]['assignee']['id'] );
		$this->assertSame( $this->other_id, $by_id[ $assigned ]['author']['id'] );
		$this->assertNull( $by_id[ $assigned ]['assignee'], 'An assignment slot is distinct from a claim.' );
	}

	/**
	 * Sticky injection must neither add unrelated rows nor turn a full first
	 * page into 101 rows and prematurely stop pagination.
	 */
	public function test_reads_past_the_first_page_when_an_unrelated_sticky_exists(): void {
		$expected = array();
		for ( $i = 0; $i < 101; ++$i ) {
			$expected[] = $this->make_post( $this->author_id );
		}
		stick_post( $this->make_post( $this->other_id, 'published' ) );

		$rows = $this->get_work();
		$this->assertCount( 101, $rows );
		$this->assertEqualsCanonicalizing( $expected, array_column( $rows, 'post_id' ) );
		$this->assertSame( array( 'Review' ), array_values( array_unique( array_column( $rows, 'status_label' ) ) ) );
	}
}
