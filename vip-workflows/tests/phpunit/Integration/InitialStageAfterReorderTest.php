<?php
/**
 * New posts start in the flagged stage after the stages are reordered.
 *
 * The Sequence editor's stages list saves its order as the stored `statuses`
 * array. The start stage used to fall back to the first item of that array, so
 * dragging a later review stage to the top sent new posts past the earlier
 * steps. The editor now writes `is_initial` on every save, and the server reads
 * only the flag.
 *
 * Driven through `StatusManager::assign_sequence()`, the path the editor's
 * REST route takes to seat a new post in a sequence.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Real-WordPress tests for the start stage of a reordered sequence.
 */
class InitialStageAfterReorderTest extends TestCase
{
	/**
	 * Stages in their authored order, with the start stage flagged.
	 *
	 * @return array
	 */
	private function stages(): array
	{
		return array(
			array(
				'key'          => 'writing',
				'label'        => 'Writing',
				'status'       => 'draft',
				'region_entry' => true,
				'is_initial'   => true,
				'transitions'  => array( array( 'to' => 'review' ) ),
			),
			array(
				'key'         => 'review',
				'label'       => 'Review',
				'status'      => 'draft',
				'transitions' => array( array( 'to' => 'writing' ) ),
			),
		);
	}

	public function test_a_post_created_after_a_reorder_starts_in_the_flagged_stage(): void
	{
		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$repository  = new SequenceRepository();
		$sequence_id = (int) $repository->create(
			'Reordered Flow',
			'reordered-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => $this->stages(),
			),
			get_current_user_id()
		);
		$this->assertGreaterThan( 0, $sequence_id );

		// "Review" dragged to the top of the stages list, as the editor saves it.
		$reordered = array_reverse( $this->stages() );
		$repository->update(
			$sequence_id,
			array(
				'config' => array(
					'post_types' => array( 'post' ),
					'statuses'   => $reordered,
				),
			)
		);

		$stored = $repository->find( $sequence_id );
		$this->assertSame( 'review', $stored->get_statuses()[0]['key'], 'The reorder was stored.' );
		$this->assertSame( 'writing', $stored->get_initial_status() );

		$post_id = (int) self::factory()->post->create(
			array(
				'post_title'  => 'Created after the reorder',
				'post_status' => 'draft',
				'post_type'   => 'post',
			)
		);

		// PostTypeManager builds its post-type-to-sequence map on `init`, which
		// has already fired by the time this test creates the sequence, so
		// eligibility is granted through the documented per-post filter.
		$make_eligible = static function ( array $ids ) use ( $sequence_id ): array {
			$ids[] = $sequence_id;
			return $ids;
		};
		add_filter( 'vip_workflows_sequences_for_post', $make_eligible );

		try {
			$result = ( new StatusManager() )->assign_sequence( $post_id, $sequence_id );
		} finally {
			remove_filter( 'vip_workflows_sequences_for_post', $make_eligible );
		}

		$this->assertTrue( $result );
		$this->assertSame( $sequence_id, (int) get_post_meta( $post_id, '_vip_workflows_sequence_id', true ) );
		$this->assertSame( 'writing', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}
}
