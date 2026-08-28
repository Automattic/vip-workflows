<?php
/**
 * Integration coverage for the assign-sequence route's data-integrity handling.
 *
 * Seating a post reads the target sequence's stage regions, so a stored config
 * that violates a Sequence write-gate invariant throws on the read path — by
 * design, because the architecture forbids defaulting missing stage data. Uncaught,
 * that throw made the route answer with WordPress's generic critical-error page: a
 * 500 with no message, in the editor, with the reason only in debug.log.
 *
 * Driven through the real route because the value under test is the HTTP contract:
 * a machine-readable code and the exception's own message reaching the client.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use WP_REST_Request;

/**
 * Real-WordPress tests for assigning a sequence whose stored config is broken.
 */
class AssignSequenceInvalidConfigTest extends TestCase
{
	/**
	 * Route template.
	 */
	private const ROUTE = '/vip-workflows/v1/workflow/post/%d/sequence';

	public function set_up(): void
	{
		parent::set_up();

		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	/**
	 * Insert a sequence row with direct SQL, bypassing the write gate.
	 *
	 * The repository normalizes on create()/update(), so direct SQL is the only way
	 * to reproduce a row persisted before a gate rule existed.
	 *
	 * @param  string $slug   Sequence slug.
	 * @param  array  $config Raw config to persist verbatim.
	 * @return int Inserted sequence ID.
	 */
	private function insert_unnormalized( string $slug, array $config ): int
	{
		global $wpdb;

		$wpdb->insert(
			$wpdb->prefix . 'vip_sequences',
			array(
				'uuid'        => wp_generate_uuid4(),
				'type'        => 'workflow',
				'name'        => $slug,
				'slug'        => $slug,
				'description' => '',
				'version'     => 1,
				'status'      => 'active',
				'config'      => wp_json_encode( $config ),
				'created_by'  => get_current_user_id(),
				'created_at'  => current_time( 'mysql' ),
				'updated_at'  => current_time( 'mysql' ),
			)
		);

		return (int) $wpdb->insert_id;
	}

	/**
	 * Dispatch the assign route.
	 *
	 * PostTypeManager builds its post-type-to-sequence map on `init`, which has
	 * already fired by the time a test inserts rows, so eligibility is granted
	 * through the documented per-post filter instead. Without it the route answers
	 * 400 ("not eligible") before ever reading the config under test.
	 *
	 * @param  int $post_id      Post to seat.
	 * @param  int $sequence_id Sequence to assign.
	 * @return \WP_REST_Response
	 */
	private function dispatch_assign( int $post_id, int $sequence_id ): \WP_REST_Response
	{
		$make_eligible = static function ( array $ids ) use ( $sequence_id ): array {
			$ids[] = $sequence_id;
			return $ids;
		};

		add_filter( 'vip_workflows_sequences_for_post', $make_eligible );

		try {
			$request = new WP_REST_Request( 'POST', sprintf( self::ROUTE, $post_id ) );
			$request->set_header( 'Content-Type', 'application/json' );
			$request->set_body( (string) wp_json_encode( array( 'sequence_id' => $sequence_id ) ) );

			return rest_get_server()->dispatch( $request );
		} finally {
			remove_filter( 'vip_workflows_sequences_for_post', $make_eligible );
		}
	}

	/**
	 * A used region with no checkpoint reaches the client as a coded error naming
	 * the sequence and the region — not a critical-error page.
	 */
	public function test_missing_region_entry_returns_a_diagnosable_error(): void
	{
		$sequence_id = $this->insert_unnormalized(
			'assign-no-checkpoint',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
					array( 'key' => 'ai_desk', 'label' => 'AI Desk', 'status' => 'draft' ),
				),
			)
		);

		$post_id  = (int) self::factory()->post->create( array( 'post_status' => 'draft', 'post_author' => get_current_user_id() ) );
		$response = $this->dispatch_assign( $post_id, $sequence_id );
		$data     = $response->get_data();

		$this->assertSame( 500, $response->get_status() );
		$this->assertSame( 'rest_sequence_invalid_config', $data['code'] );
		$this->assertStringContainsString( 'assign-no-checkpoint', $data['message'], 'The message names the offending sequence.' );
		$this->assertStringContainsString( 'no entry checkpoint', $data['message'], 'The message carries the read path\'s own diagnosis.' );
		$this->assertStringNotContainsString( 'critical error', $data['message'] );
	}

	/**
	 * The sibling invariant — a stage with no `status` region — surfaces the same
	 * way, so the handler covers the class of failure rather than one message.
	 */
	public function test_missing_status_region_returns_a_diagnosable_error(): void
	{
		$sequence_id = $this->insert_unnormalized(
			'assign-no-region',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
			)
		);

		$post_id  = (int) self::factory()->post->create( array( 'post_status' => 'draft', 'post_author' => get_current_user_id() ) );
		$response = $this->dispatch_assign( $post_id, $sequence_id );
		$data     = $response->get_data();

		$this->assertSame( 500, $response->get_status() );
		$this->assertSame( 'rest_sequence_invalid_config', $data['code'] );
		$this->assertStringContainsString( 'no status region', $data['message'] );
	}

	/**
	 * Nothing is written when the config is rejected: a failed assignment must not
	 * leave the post half-seated, with a sequence but no resolvable stage.
	 */
	public function test_a_rejected_assignment_writes_no_workflow_meta(): void
	{
		$sequence_id = $this->insert_unnormalized(
			'assign-no-checkpoint-clean',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
					array( 'key' => 'ai_desk', 'label' => 'AI Desk', 'status' => 'draft' ),
				),
			)
		);

		$post_id = (int) self::factory()->post->create( array( 'post_status' => 'draft', 'post_author' => get_current_user_id() ) );

		$this->dispatch_assign( $post_id, $sequence_id );

		$this->assertSame( '', get_post_meta( $post_id, \VIPWorkflows\Workflow\StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( '', get_post_meta( $post_id, \VIPWorkflows\Workflow\StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * The happy path is unaffected: a normalized sequence still seats the post and
	 * answers 200, so the handler cannot be masking a real assignment failure.
	 */
	public function test_a_normalized_sequence_still_assigns(): void
	{
		$sequence_id = (int) ( new \VIPWorkflows\Sequences\SequenceRepository() )->create(
			'Assign Healthy Flow',
			'assign-healthy-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft', 'transitions' => array() ),
					array( 'key' => 'ai_desk', 'label' => 'AI Desk', 'status' => 'draft', 'transitions' => array() ),
				),
			),
			get_current_user_id()
		);

		$post_id  = (int) self::factory()->post->create( array( 'post_status' => 'draft', 'post_author' => get_current_user_id() ) );
		$response = $this->dispatch_assign( $post_id, $sequence_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['has_workflow'] );
		$this->assertSame( 'draft', $response->get_data()['current']['key'] );
	}
}
