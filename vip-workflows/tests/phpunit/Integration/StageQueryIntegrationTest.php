<?php
/**
 * Integration coverage for StageQuery's DB-backed methods.
 *
 * counts_by_stage() runs a raw aggregation and apply_to_admin_query() mutates a
 * real WP_Query, so both need a booted WordPress.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StageQuery;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Real-WordPress tests for StageQuery.
 */
class StageQueryIntegrationTest extends TestCase
{
	/**
	 * Sequence under test.
	 *
	 * @var Sequence
	 */
	private Sequence $sequence;

	public function set_up(): void
	{
		parent::set_up();

		$repository = new SequenceRepository();
		$id         = (int) $repository->create(
			'Query Flow',
			'query-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft' ),
					array( 'key' => 'review', 'label' => 'Review' ),
					array( 'key' => 'publish', 'label' => 'Publish', 'status' => 'publish' ),
				),
			),
			get_current_user_id()
		);

		$this->sequence = $repository->find( $id );
	}

	/**
	 * Create a post carrying sequence + stage meta.
	 *
	 * @param string $stage       Stage key.
	 * @param string $post_status Post status.
	 * @return int
	 */
	private function make_post( string $stage, string $post_status = 'draft' ): int
	{
		$post_id = self::factory()->post->create( array( 'post_status' => $post_status ) );
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence->id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );
		return $post_id;
	}

	public function test_counts_by_stage_returns_per_stage_totals(): void
	{
		$this->make_post( 'draft' );
		$this->make_post( 'draft' );
		$this->make_post( 'review' );

		$counts = StageQuery::counts_by_stage( $this->sequence );

		$this->assertSame( 2, $counts['draft'] );
		$this->assertSame( 1, $counts['review'] );
		$this->assertSame( 0, $counts['publish'], 'Every defined stage is present, 0 when empty.' );
	}

	public function test_in_stage_query_selects_only_that_stage_regardless_of_post_status(): void
	{
		$draft_post   = $this->make_post( 'draft', 'draft' );
		// A post-publish-style row: different post_status but the stage still filters correctly.
		$review_post  = $this->make_post( 'review', 'publish' );

		$found = get_posts( array_merge(
			StageQuery::in_stage( $this->sequence, 'review' ),
			array( 'fields' => 'ids', 'posts_per_page' => -1 )
		) );

		$this->assertContains( $review_post, $found );
		$this->assertNotContains( $draft_post, $found );
	}

	public function test_apply_to_admin_query_narrows_to_stage(): void
	{
		$draft_post  = $this->make_post( 'draft' );
		$review_post = $this->make_post( 'review' );

		$query = new \WP_Query();
		$query->set( 'post_type', 'post' );
		$query->set( 'post_status', 'any' );
		$query->set( 'fields', 'ids' );
		$query->set( 'posts_per_page', -1 );
		StageQuery::apply_to_admin_query( $query, $this->sequence, 'draft' );

		$ids = $query->get_posts();

		$this->assertContains( $draft_post, $ids );
		$this->assertNotContains( $review_post, $ids );
	}

	public function test_apply_to_admin_query_disambiguates_same_stage_key_across_sequences(): void
	{
		// Another sequence that also defines a 'draft' stage.
		$other_id = (int) ( new SequenceRepository() )->create(
			'Second Flow',
			'second-flow',
			'',
			array( 'post_types' => array( 'post' ), 'statuses' => array( array( 'key' => 'draft', 'label' => 'D' ) ) ),
			get_current_user_id()
		);
		$other_post = self::factory()->post->create();
		update_post_meta( $other_post, StatusManager::SEQUENCE_META_KEY, $other_id );
		update_post_meta( $other_post, StatusManager::STAGE_META_KEY, 'draft' );

		$mine = $this->make_post( 'draft' );

		$query = new \WP_Query();
		$query->set( 'post_type', 'post' );
		$query->set( 'post_status', 'any' );
		$query->set( 'fields', 'ids' );
		$query->set( 'posts_per_page', -1 );
		StageQuery::apply_to_admin_query( $query, $this->sequence, 'draft' );

		$ids = $query->get_posts();
		$this->assertContains( $mine, $ids );
		$this->assertNotContains( $other_post, $ids, 'The other sequence\'s same-named stage is excluded.' );
	}

	public function test_counts_by_stage_scopes_to_sequence(): void
	{
		// A post in a DIFFERENT sequence's same-named stage must not be counted.
		$other_id = (int) ( new SequenceRepository() )->create(
			'Other Flow',
			'other-flow',
			'',
			array( 'post_types' => array( 'post' ), 'statuses' => array( array( 'key' => 'draft', 'label' => 'D' ) ) ),
			get_current_user_id()
		);
		$other_post = self::factory()->post->create();
		update_post_meta( $other_post, StatusManager::SEQUENCE_META_KEY, $other_id );
		update_post_meta( $other_post, StatusManager::STAGE_META_KEY, 'draft' );

		$this->make_post( 'draft' );

		$counts = StageQuery::counts_by_stage( $this->sequence );

		$this->assertSame( 1, $counts['draft'], 'Only this sequence\'s draft posts are counted.' );
	}

	/**
	 * A pre-publish (draft) stage row is found by in_stage() with NO caller status
	 * override. Without the post_status => 'any' default, WP_Query's non-admin
	 * publish-only default would hide it — the review queue / SLA / dashboard bug.
	 */
	public function test_in_stage_finds_draft_pre_publish_without_status_override(): void
	{
		$draft_review = $this->make_post( 'review', 'draft' );

		// Query exactly as the review-queue / SLA consumers do: no post_status set.
		$found = get_posts( StageQuery::in_stage( $this->sequence, 'review', array( 'fields' => 'ids', 'posts_per_page' => -1 ) ) );

		$this->assertContains( $draft_review, $found, 'A draft pre-publish stage row must be returned.' );
	}

	/**
	 * not_in_any_workflow() excludes workflow-managed posts at the QUERY level (NOT
	 * EXISTS on the sequence meta key), so the My Work fallback and the Kanban
	 * no-workflow columns cannot leak workflow posts, and the exclusion is applied
	 * before LIMIT rather than filtered per-row afterwards.
	 */
	public function test_not_in_any_workflow_excludes_managed_posts_and_keeps_plain(): void
	{
		$managed = $this->make_post( 'draft', 'draft' );
		$plain   = self::factory()->post->create( array( 'post_status' => 'draft' ) );

		$found = get_posts( StageQuery::not_in_any_workflow( array(
			'post_type'      => 'post',
			'post_status'    => 'draft',
			'fields'         => 'ids',
			'posts_per_page' => -1,
		) ) );

		$this->assertContains( $plain, $found, 'A non-workflow post is returned.' );
		$this->assertNotContains( $managed, $found, 'A workflow-managed post is excluded at the query level.' );
	}

	/**
	 * The exclusion runs inside the query, so LIMIT applies AFTER it: a plain draft
	 * still surfaces even when a wall of workflow drafts would otherwise fill the
	 * LIMIT window ahead of it. This is the Kanban-column-empties regression the
	 * per-row PHP discard caused.
	 */
	public function test_not_in_any_workflow_limit_applies_after_exclusion(): void
	{
		// A wall of workflow-managed drafts (lower IDs), then one plain draft
		// (higher ID). With ORDER BY ID ASC + LIMIT 3, a discard that ran AFTER
		// the LIMIT would return only the workflow rows and starve the plain
		// draft out of the window; the in-query exclusion keeps it visible.
		for ( $i = 0; $i < 5; $i++ ) {
			$this->make_post( 'draft', 'draft' );
		}
		$plain = self::factory()->post->create( array( 'post_status' => 'draft' ) );

		$found = get_posts( StageQuery::not_in_any_workflow( array(
			'post_type'      => 'post',
			'post_status'    => 'draft',
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'fields'         => 'ids',
			'posts_per_page' => 3,
		) ) );

		$this->assertContains( $plain, $found, 'The plain draft is not starved out of the LIMIT window by workflow rows.' );
	}

	/**
	 * counts_by_stage() excludes trashed rows — KTD-4 leaves stage meta on trash,
	 * so without the SQL exclusion a trashed post would keep inflating stage counts.
	 */
	public function test_counts_by_stage_excludes_trashed(): void
	{
		$this->make_post( 'review' );
		$trashed = $this->make_post( 'review' );
		wp_trash_post( $trashed );

		$counts = StageQuery::counts_by_stage( $this->sequence );

		$this->assertSame( 1, $counts['review'], 'Trashed workflow posts are not counted.' );
	}
}
