<?php
/**
 * Attachment cleanup when an ideation project is deleted.
 *
 * Integration rather than unit because the behaviour under test is the query
 * loop: the method reads a page of attachments, deletes them, and re-reads.
 * A mocked get_posts() would assert only that we call it the way we think we
 * do — the claim worth pinning is that every attachment is gone afterwards,
 * including past the page size, which only a real posts table can answer.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Ideation\Research\IdeationPostTypes;

/**
 * @covers \VIPWorkflow\Ideation\Research\IdeationPostTypes::cleanup_project_data
 */
class IdeationProjectCleanupTest extends TestCase
{
	public function set_up(): void
	{
		parent::set_up();
		( new IdeationPostTypes() )->register_post_type();
	}

	/**
	 * Attach $count media items to $project_id.
	 *
	 * @param  int $project_id Parent project.
	 * @param  int $count      How many to create.
	 * @return int[] Attachment IDs.
	 */
	private function attach( int $project_id, int $count ): array
	{
		$ids = array();
		for ( $i = 0; $i < $count; $i++ ) {
			$ids[] = (int) self::factory()->post->create(
				array(
					'post_type'   => 'attachment',
					'post_parent' => $project_id,
					'post_status' => 'inherit',
					'post_title'  => 'Attachment ' . $i,
				)
			);
		}
		return $ids;
	}

	/**
	 * More attachments than one page holds are all removed.
	 *
	 * The batch is 100, so 150 needs a second pass. An implementation that read
	 * one page and stopped would leave 50 behind — which is the regression this
	 * exists to catch, now that the query is bounded.
	 */
	public function test_every_attachment_is_removed_past_the_page_size(): void
	{
		$project_id = (int) self::factory()->post->create(
			array( 'post_type' => IdeationPostTypes::POST_TYPE )
		);
		$this->attach( $project_id, 150 );

		( new IdeationPostTypes() )->cleanup_project_data( $project_id );

		$remaining = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_parent'    => $project_id,
				'post_status'    => 'any',
				'fields'         => 'ids',
				'posts_per_page' => 200,
			)
		);

		$this->assertSame(
			array(),
			$remaining,
			'attachments past the first page survived the delete'
		);
	}

	/**
	 * A post of another type is left alone, page size or not.
	 */
	public function test_a_post_of_another_type_is_not_cleaned_up(): void
	{
		$post_id = (int) self::factory()->post->create( array( 'post_type' => 'post' ) );
		$ids     = $this->attach( $post_id, 3 );

		( new IdeationPostTypes() )->cleanup_project_data( $post_id );

		foreach ( $ids as $id ) {
			$this->assertNotNull( get_post( $id ), 'an unrelated post lost its attachments' );
		}
	}
}
