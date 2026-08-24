<?php
/**
 * StageQuery unit tests — the storage-agnostic stage query seam.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Workflow\StageQuery;
use VIPWorkflow\Workflow\StatusManager;

/**
 * Tests the WP_Query-arg building of StageQuery (DB-backed methods live in Integration).
 */
class StageQueryTest extends TestCase
{
	/**
	 * Build a sequence with id 1 and the given post types / stages.
	 */
	private function sequence(): Sequence
	{
		$row = (object) array(
			'id'          => 1,
			'uuid'        => 'u',
			'type'        => Sequence::TYPE_WORKFLOW,
			'name'        => 'BP',
			'slug'        => 'bp',
			'description' => '',
			'version'     => 1,
			'status'      => 'active',
			'config'      => json_encode( array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft' ),
					array( 'key' => 'review', 'label' => 'Review' ),
				),
			) ),
			'created_by'  => 1,
			'created_at'  => '2026-01-01 00:00:00',
			'updated_at'  => '2026-01-01 00:00:00',
		);
		return Sequence::from_row( $row );
	}

	public function test_in_stage_builds_sequence_and_stage_meta_query(): void
	{
		$args = StageQuery::in_stage( $this->sequence(), 'review' );

		$this->assertSame( array( 'post' ), $args['post_type'] );
		$this->assertSame( 'AND', $args['meta_query']['relation'] );
		$this->assertContains(
			array( 'key' => StatusManager::SEQUENCE_META_KEY, 'value' => 1 ),
			$args['meta_query']
		);
		$this->assertContains(
			array( 'key' => StatusManager::STAGE_META_KEY, 'value' => 'review' ),
			$args['meta_query']
		);
	}

	public function test_in_stages_uses_in_comparison(): void
	{
		$args = StageQuery::in_stages( $this->sequence(), array( 'draft', 'review' ) );

		$this->assertContains(
			array(
				'key'     => StatusManager::STAGE_META_KEY,
				'value'   => array( 'draft', 'review' ),
				'compare' => 'IN',
			),
			$args['meta_query']
		);
	}

	public function test_in_any_workflow_unscoped_uses_exists(): void
	{
		$args = StageQuery::in_any_workflow();

		$this->assertArrayNotHasKey( 'post_type', $args );
		$this->assertContains(
			array( 'key' => StatusManager::SEQUENCE_META_KEY, 'compare' => 'EXISTS' ),
			$args['meta_query']
		);
	}

	public function test_in_any_workflow_scoped_to_sequence(): void
	{
		$args = StageQuery::in_any_workflow( $this->sequence() );

		$this->assertSame( array( 'post' ), $args['post_type'] );
		$this->assertContains(
			array( 'key' => StatusManager::SEQUENCE_META_KEY, 'value' => 1 ),
			$args['meta_query']
		);
	}

	public function test_not_in_any_workflow_uses_not_exists(): void
	{
		$args = StageQuery::not_in_any_workflow();

		// No sequence, so post_type must not be defaulted.
		$this->assertArrayNotHasKey( 'post_type', $args );
		$this->assertSame( 'AND', $args['meta_query']['relation'] );
		$this->assertContains(
			array( 'key' => StatusManager::SEQUENCE_META_KEY, 'compare' => 'NOT EXISTS' ),
			$args['meta_query']
		);
	}

	public function test_not_in_any_workflow_preserves_caller_post_type_and_status(): void
	{
		$args = StageQuery::not_in_any_workflow( array(
			'post_type'   => 'post',
			'post_status' => array( 'draft', 'pending', 'future' ),
			'author'      => 7,
		) );

		// Caller's scoping survives verbatim alongside the NOT EXISTS clause.
		$this->assertSame( 'post', $args['post_type'] );
		$this->assertSame( array( 'draft', 'pending', 'future' ), $args['post_status'] );
		$this->assertSame( 7, $args['author'] );
		$this->assertContains(
			array( 'key' => StatusManager::SEQUENCE_META_KEY, 'compare' => 'NOT EXISTS' ),
			$args['meta_query']
		);
	}

	public function test_merges_with_caller_meta_query_under_and(): void
	{
		$assignee = array( 'key' => '_assignee', 'value' => 5 );
		$args     = StageQuery::in_stage( $this->sequence(), 'review', array(
			'meta_query' => array( $assignee ),
		) );

		$this->assertSame( 'AND', $args['meta_query']['relation'] );
		// The caller's whole meta_query is preserved verbatim as a nested sub-clause.
		$this->assertContains( array( $assignee ), $args['meta_query'] );
		$this->assertContains(
			array( 'key' => StatusManager::STAGE_META_KEY, 'value' => 'review' ),
			$args['meta_query']
		);
	}

	/**
	 * A caller's OR meta_query must survive the merge (nested, not flattened to AND).
	 */
	public function test_preserves_caller_or_meta_query(): void
	{
		$or = array(
			'relation' => 'OR',
			array( 'key' => '_a', 'value' => 1 ),
			array( 'key' => '_b', 'value' => 2 ),
		);
		$args = StageQuery::in_stage( $this->sequence(), 'review', array( 'meta_query' => $or ) );

		// The OR group is nested intact under the top-level AND.
		$this->assertSame( 'AND', $args['meta_query']['relation'] );
		$this->assertContains( $or, $args['meta_query'] );
	}

	public function test_caller_post_type_is_not_overridden(): void
	{
		$args = StageQuery::in_stage( $this->sequence(), 'review', array( 'post_type' => array( 'page' ) ) );

		$this->assertSame( array( 'page' ), $args['post_type'] );
	}

	/**
	 * Stage queries default post_status to 'any' so pre-publish (draft) stage rows
	 * aren't hidden by WP_Query's non-admin publish-only default.
	 */
	public function test_defaults_post_status_to_any(): void
	{
		$args = StageQuery::in_stage( $this->sequence(), 'review' );
		$this->assertSame( 'any', $args['post_status'] );
	}

	public function test_caller_post_status_is_not_overridden(): void
	{
		$args = StageQuery::in_stage( $this->sequence(), 'review', array( 'post_status' => 'draft' ) );
		$this->assertSame( 'draft', $args['post_status'] );
	}
}
