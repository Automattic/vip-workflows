<?php
/**
 * Prevent malformed post type mappings from reaching site initialization.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\PostTypeManager;

/**
 * Exercise imports, updates and activation against real WordPress storage.
 */
class SequencePostTypesValidationTest extends TestCase {


	public function set_up(): void {
		parent::set_up();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	private function config(): array {
		return array(
			'post_types' => array( 'post' ),
			'statuses'   => array(
				array(
					'key'          => 'draft',
					'label'        => 'Draft',
					'status'       => 'draft',
					'region_entry' => true,
					'is_initial'   => true,
				),
			),
		);
	}

	public static function malformed_post_types(): array {
		return array(
			'string'           => array( 'post' ),
			'null'             => array( null ),
			'boolean'          => array( false ),
			'number'           => array( 1 ),
			'nested array'     => array( array( array( 'post' ) ) ),
			'non-string entry' => array( array( 1 ) ),
			'empty entry'      => array( array( '' ) ),
			'object shape'     => array( array( 'type' => 'post' ) ),
		);
	}

	/**
	 * @dataProvider malformed_post_types
	 */
	public function test_import_rejects_malformed_post_types_without_saving( $post_types ): void {
		$repository           = new SequenceRepository();
		$before               = count( $repository->get_all() );
		$config               = $this->config();
		$config['post_types'] = $post_types;
		$json                 = array(
			'type'   => 'workflow',
			'name'   => 'Invalid post types',
			'config' => $config,
		);
		$request              = new \WP_REST_Request( 'POST', '/vip-workflows/v1/sequences/import' );
		$request->set_param( 'sequence_json', $json );

		$response = rest_do_request( $request );
		$this->assertSame( 422, $response->get_status() );
		$this->assertSame( 'rest_sequence_invalid_config', $response->get_data()['code'] );
		$this->assertStringContainsString( 'post_types', $response->get_data()['message'] );
		$this->assertCount( $before, $repository->get_all() );

		$result = \VIPWorkflows\Abilities\Tools\execute_import_sequence( array( 'sequence_json' => $json ) );
		$this->assertWPError( $result );
		$this->assertSame( 'rest_sequence_invalid_config', $result->get_error_code() );
		$this->assertCount( $before, $repository->get_all() );
	}

	/**
	 * @dataProvider malformed_post_types
	 */
	public function test_repository_update_preserves_the_valid_config( $post_types ): void {
		$repository           = new SequenceRepository();
		$id                   = $repository->create( 'Valid', 'valid-types', '', $this->config(), get_current_user_id() );
		$before               = $repository->find( $id )->config;
		$config               = $before;
		$config['post_types'] = $post_types;

		try {
			$repository->update( $id, array( 'config' => $config ) );
			$this->fail( 'Malformed post types must be rejected before updating the row.' );
		} catch ( \InvalidArgumentException $e ) {
			$this->assertStringContainsString( 'post_types', $e->getMessage() );
		}

		wp_cache_flush_group( SequenceRepository::CACHE_GROUP );
		$this->assertSame( $before, $repository->find( $id )->config );
		$manager = new PostTypeManager( $repository );
		$manager->register_post_types();
		$this->assertContains( $id, $manager->get_sequences_for_post_type( 'post' ) );
	}

	/**
	 * @dataProvider malformed_post_types
	 */
	public function test_activation_refuses_an_already_stored_malformed_config( $post_types ): void {
		global $wpdb;
		$repository           = new SequenceRepository();
		$id                   = $repository->create( 'Old import', 'old-import', '', $this->config(), get_current_user_id() );
		$config               = $repository->find( $id )->config;
		$config['post_types'] = $post_types;
		// Reproduce a draft saved before import validation existed.
		$wpdb->update(
			$wpdb->prefix . 'vip_sequences',
			array( 'config' => wp_json_encode( $config ), 'status' => 'draft' ),
			array( 'id' => $id )
		);
		wp_cache_flush_group( SequenceRepository::CACHE_GROUP );

		$result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence( array( 'sequence_id' => $id, 'active' => true ) );
		$this->assertWPError( $result );
		$this->assertSame( 'sequence_invalid', $result->get_error_code() );
		$this->assertStringContainsString( 'post_types', $result->get_error_message() );
		$this->assertSame( 'draft', $repository->find( $id )->status );
		$this->assertSame( $config, $repository->find( $id )->config );
		$manager = new PostTypeManager( $repository );
		$manager->register_post_types();
		$this->assertNotContains( $id, $manager->get_sequences_for_post_type( 'post' ) );
	}

	public static function valid_post_types(): array {
		return array(
			'default' => array( null, array( 'post' ) ),
			'empty'   => array( array(), array() ),
			'custom'  => array( array( 'post', 'page', 'external_type' ), array( 'post', 'page', 'external_type' ) ),
		);
	}

	/**
	 * @dataProvider valid_post_types
	 */
	public function test_valid_import_can_be_activated_and_mapped( ?array $post_types, array $expected ): void {
		$config = $this->config();
		unset( $config['post_types'] );
		if ( null !== $post_types ) {
			$config['post_types'] = $post_types;
		}
		$request = new \WP_REST_Request( 'POST', '/vip-workflows/v1/sequences/import' );
		$request->set_param( 'sequence_json', array( 'type' => 'workflow', 'name' => 'Valid import', 'config' => $config ) );
		$response = rest_do_request( $request );
		$this->assertSame( 201, $response->get_status() );
		$id         = $response->get_data()['sequence']['id'];
		$repository = new SequenceRepository();
		$this->assertSame( 'draft', $repository->find( $id )->status );
		$this->assertSame( $expected, $repository->find( $id )->get_post_types() );

		$result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence( array( 'sequence_id' => $id, 'active' => true ) );
		$this->assertTrue( $result['success'] );
		$this->assertSame( 'active', $repository->find( $id )->status );
		$manager = new PostTypeManager( $repository );
		$manager->register_post_types();
		foreach ( $expected as $post_type ) {
			$this->assertContains( $id, $manager->get_sequences_for_post_type( $post_type ) );
		}
		$this->assertSame( $config, $repository->find( $id )->config );
	}
}
