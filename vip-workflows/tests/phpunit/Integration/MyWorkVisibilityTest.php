<?php
/**
 * My Work visibility through real assignment storage and WordPress queries.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\API\WorkflowController;
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
	 * An Editor: the claim and the assignment below are on another user's
	 * drafts, and a row is only served for a post its reader can read
	 * (`MyWorkPerObjectGateTest` pins that rule). The pagination case uses
	 * this user's own posts, which any role can read.
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
		$this->author_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
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
	 * Dated yesterday unless told otherwise: My Work only lists posts modified
	 * inside its window, and an inserted post's modified date is its post date.
	 *
	 * @param int    $author_id Post author.
	 * @param string $stage     Workflow stage.
	 * @param int    $days_ago  How long ago the post was written and last modified.
	 * @return int Post ID.
	 */
	private function make_post( int $author_id, string $stage = 'review', int $days_ago = 1 ): int {
		$date    = gmdate( 'Y-m-d H:i:s', time() - $days_ago * DAY_IN_SECONDS );
		$post_id = (int) self::factory()->post->create(
			array(
				'post_author'   => $author_id,
				'post_status'   => 'published' === $stage ? 'publish' : 'draft',
				'post_date'     => $date,
				'post_date_gmt' => $date,
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
		$this->assertSame( $this->author_id, $by_id[ $assigned ]['assignee']['id'], 'A pending assignment is shown as the assignee.' );
	}

	/**
	 * My Work only lists posts modified inside its window, whatever the reason
	 * the user is involved, and a post comes back the moment it is edited.
	 */
	public function test_leaves_out_posts_last_modified_before_the_window(): void {
		$old_days = WorkflowController::MY_WORK_WINDOW_DAYS + 30;

		$recent   = $this->make_post( $this->author_id );
		$authored = $this->make_post( $this->author_id, 'review', $old_days );
		$claimed  = $this->make_post( $this->other_id, 'review', $old_days );
		$assigned = $this->make_post( $this->other_id, 'review', $old_days );
		update_post_meta( $claimed, '_vip_workflows_assigned_to', $this->author_id );
		( new AssignmentManager() )->assign( $assigned, 'reviewer', $this->author_id, 'user' );

		$old_date = gmdate( 'Y-m-d H:i:s', time() - $old_days * DAY_IN_SECONDS );
		$outside  = (int) self::factory()->post->create(
			array(
				'post_author'   => $this->author_id,
				'post_date'     => $old_date,
				'post_date_gmt' => $old_date,
			)
		);

		$this->assertSame( array( $recent ), array_column( $this->get_work(), 'post_id' ) );

		wp_set_current_user( $this->other_id );
		wp_update_post(
			array(
				'ID'         => $assigned,
				'post_title' => 'Edited today',
			)
		);

		$this->assertEqualsCanonicalizing( array( $recent, $assigned ), array_column( $this->get_work(), 'post_id' ) );
		$this->assertNotContains( $outside, array_column( $this->get_work(), 'post_id' ) );
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

	/**
	 * Assignments are read once for the whole list, not once per row, and
	 * each row still shows its own assignee.
	 */
	public function test_assignments_are_read_once_however_many_rows_there_are(): void {
		$assignments = new AssignmentManager();
		$assigned    = array();
		for ( $i = 0; $i < 30; ++$i ) {
			$post_id = $this->make_post( $this->author_id );
			if ( 0 === $i % 3 ) {
				$assignments->assign( $post_id, 'reviewer', $this->other_id, 'user' );
				$assigned[] = $post_id;
			}
		}
		$plain = (int) self::factory()->post->create( array( 'post_author' => $this->author_id ) );

		$assignment_queries = array();
		$count_queries      = function ( $sql ) use ( &$assignment_queries ) {
			// esc_like() escapes the prefix's underscores, so drop the backslashes first.
			if ( false !== strpos( $sql, 'meta_key LIKE' ) && false !== strpos( str_replace( '\\', '', $sql ), '_vip_workflows_assignment_' ) ) {
				$assignment_queries[] = $sql;
			}
			return $sql;
		};
		add_filter( 'query', $count_queries );
		$rows = $this->get_work();
		remove_filter( 'query', $count_queries );

		$this->assertCount( 31, $rows );
		// The posts the user is involved in come from the pending-assignee
		// index, not a scan of the assignments, so the only assignment read is
		// the one for the rows found.
		$this->assertCount( 1, $assignment_queries, implode( "\n", $assignment_queries ) );
		$this->assertStringContainsString( 'post_id IN', $assignment_queries[0] );

		$by_id = array_column( $rows, null, 'post_id' );
		foreach ( $by_id as $post_id => $row ) {
			if ( in_array( $post_id, $assigned, true ) ) {
				$this->assertSame( $this->other_id, $row['assignee']['id'], "Post {$post_id} should show its pending assignment." );
			} else {
				$this->assertNull( $row['assignee'], "Post {$post_id} has no assignment or claim." );
			}
		}
		$this->assertNull( $by_id[ $plain ]['workflow_name'] );
	}
}
