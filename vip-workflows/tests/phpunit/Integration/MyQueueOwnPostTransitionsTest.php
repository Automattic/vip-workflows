<?php
/**
 * Own-post queue actions agree with role and core capability checks.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

/**
 * Compare queue actions with the transition service on the owner's post.
 */
class MyQueueOwnPostTransitionsTest extends TestCase {

	/**
	 * Cases for own-post moves within and across core status regions.
	 *
	 * @return array
	 */
	public function own_post_cases(): array {
		return array(
			'contributor within draft' => array( 'contributor', 'draft', array(), true, '' ),
			'contributor to publish'   => array( 'contributor', 'publish', array(), false, 'forbidden_region_crossing' ),
			'author to publish'        => array( 'author', 'publish', array(), true, '' ),
			'author with editor edge'  => array( 'author', 'draft', array( 'editor' ), false, 'forbidden_transition' ),
		);
	}

	/**
	 * Queue membership and its action agree with the transition result.
	 *
	 * @dataProvider own_post_cases
	 * @param string $role User role.
	 * @param string $target_region Destination core status.
	 * @param array  $allowed_roles Edge role list.
	 * @param bool   $allowed Whether the move is allowed.
	 * @param string $error Expected refusal code.
	 */
	public function test_own_post_queue_and_transition_agree( string $role, string $target_region, array $allowed_roles, bool $allowed, string $error ): void {
		Plugin::get_instance()->get_experiment_registry()->enable( 'my_queue' );
		$admin = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );

		$repository  = new SequenceRepository();
		$sequence_id = $repository->create(
			'Own post queue',
			'own-post-queue',
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
								'label'         => 'Continue',
								'show_in_queue' => true,
								'allowed_roles' => $allowed_roles,
							),
						),
					),
					array(
						'key'    => 'done',
						'label'  => 'Done',
						'status' => $target_region,
					),
				),
			),
			$admin
		);
		$this->assertNotFalse( $sequence_id );

		$owner = (int) self::factory()->user->create( array( 'role' => $role ) );
		wp_set_current_user( $owner );
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $owner,
				'post_title'  => 'Own queue post',
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'review' );
		// A claim held by the owner preserves queue membership.
		update_post_meta( $post_id, '_vip_workflows_assigned_to', $owner );

		$this->assertTrue( current_user_can( 'edit_post', $post_id ) );
		$sequence = $repository->find( $sequence_id );
		$this->assertSame( $allowed, ! empty( $sequence->get_transitions_for_user( 'review', 0, $post_id ) ) );

		$response = rest_do_request( new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/my-queue' ) );
		$this->assertSame( 200, $response->get_status() );
		$items = array_values( array_filter( $response->get_data(), fn( $item ) => $item['post_id'] === $post_id ) );
		$this->assertCount( $allowed ? 1 : 0, $items );
		if ( $allowed ) {
			$this->assertSame(
				array(
					array(
						'to'    => 'done',
						'label' => 'Continue',
					),
				),
				$items[0]['quick_actions']
			);
		}

		$result = Plugin::get_instance()->get_status_manager()->transition( $post_id, 'done' );
		if ( $allowed ) {
			$this->assertNotWPError( $result );
			$this->assertSame( 'done', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
			$this->assertSame( $target_region, get_post_status( $post_id ) );
		} else {
			$this->assertWPError( $result );
			$this->assertSame( $error, $result->get_error_code() );
			$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
			$this->assertSame( 'draft', get_post_status( $post_id ) );
		}
	}
}
