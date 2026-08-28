<?php
/**
 * MetadataController unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\API\MetadataController;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;

/**
 * Tests for MetadataController::get_metadata().
 */
class MetadataControllerTest extends TestCase
{

	/**
	 * Build a Sequence object from a config array with the given ID.
	 */
	private function make_sequence( int $id, array $config_overrides = array() ): Sequence {
		$config = array_merge(
			array(
				'post_types'      => array( 'post' ),
				'statuses'        => array(),
				'metadata_fields' => array(),
			),
			$config_overrides
		);

		$row = (object) array(
			'id'          => $id,
			'uuid'        => 'test-uuid-' . $id,
			'type'        => Sequence::TYPE_WORKFLOW,
			'name'        => 'Sequence ' . $id,
			'slug'        => 'sequence-' . $id,
			'description' => '',
			'version'     => 1,
			'status'      => 'active',
			'config'      => json_encode( $config ),
			'created_by'  => 1,
			'created_at'  => '2026-01-01 00:00:00',
			'updated_at'  => '2026-01-01 00:00:00',
		);

		return Sequence::from_row( $row );
	}

	/**
	 * Build a fake WP_REST_Request-like object.
	 */
	private function make_request( int $post_id ): object {
		$request = Mockery::mock( 'WP_REST_Request' );
		$request->shouldReceive( 'get_param' )->with( 'id' )->andReturn( $post_id );

		return $request;
	}

	/**
	 * POST not found returns 404 WP_Error.
	 */
	public function test_returns_404_when_post_not_found(): void {
		Functions\when( 'get_post' )->justReturn( null );
		Functions\when( 'get_post_meta' )->justReturn( '' );
		Functions\when( '__' )->returnArg();

		$controller = new MetadataController();
		$result     = $controller->get_metadata( $this->make_request( 999 ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'rest_post_not_found', $result->get_error_code() );
	}

	/**
	 * Post with no active sequence returns { fields: [] }.
	 */
	public function test_returns_empty_fields_when_no_sequence(): void {
		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 1 ) );
		Functions\when( 'get_post_meta' )->justReturn( '' );

		$controller = new MetadataController();
		$result     = $controller->get_metadata( $this->make_request( 1 ) );

		$this->assertInstanceOf( \WP_REST_Response::class, $result );
		$this->assertSame( array( 'fields' => array() ), $result->get_data() );
	}

	/**
	 * Post whose sequence ID resolves to nothing returns { fields: [] }.
	 */
	public function test_returns_empty_fields_when_sequence_not_found(): void {
		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 1 ) );
		Functions\when( 'get_post_meta' )->justReturn( '99' );

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 99 )->andReturn( null );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 1 ) );

		$this->assertInstanceOf( \WP_REST_Response::class, $result );
		$this->assertSame( array( 'fields' => array() ), $result->get_data() );
	}

	/**
	 * Happy path: returns fields with labels, types, and current values.
	 */
	public function test_returns_fields_with_values(): void {
		$sequence = $this->make_sequence(
			42,
			array(
				'metadata_fields' => array(
					array( 'key' => 'content_pillar', 'label' => 'Content Pillar', 'type' => 'text', 'required' => false ),
				),
			)
		);

		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 5 ) );
		Functions\when( 'get_post_meta' )->alias(
			function ( $post_id, $key, $single ) {
				if ( '_vip_workflows_sequence_id' === $key ) {
					return '42';
				}
				if ( 'wf_meta_42_content_pillar' === $key ) {
					return 'Technology';
				}
				return '';
			}
		);

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 42 )->andReturn( $sequence );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 5 ) );

		$this->assertInstanceOf( \WP_REST_Response::class, $result );
		$data   = $result->get_data();
		$fields = $data['fields'];

		$this->assertCount( 1, $fields );
		$this->assertSame( 'content_pillar', $fields[0]['key'] );
		$this->assertSame( 'Content Pillar', $fields[0]['label'] );
		$this->assertSame( 'text', $fields[0]['type'] );
		$this->assertSame( 'Technology', $fields[0]['value'] );
		$this->assertFalse( $fields[0]['required'] );
	}

	/**
	 * Returned key is the short field key, not the full meta key.
	 */
	public function test_returned_key_is_short_not_full_meta_key(): void {
		$sequence = $this->make_sequence(
			7,
			array(
				'metadata_fields' => array(
					array( 'key' => 'section', 'label' => 'Section', 'type' => 'text' ),
				),
			)
		);

		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 10 ) );
		Functions\when( 'get_post_meta' )->alias(
			function ( $post_id, $key, $single ) {
				if ( '_vip_workflows_sequence_id' === $key ) {
					return '7';
				}
				return 'News';
			}
		);

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 7 )->andReturn( $sequence );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 10 ) );

		$data = $result->get_data();
		// Key must be 'section', not 'wf_meta_7_section'.
		$this->assertSame( 'section', $data['fields'][0]['key'] );
		$this->assertArrayNotHasKey( 'meta_key', $data['fields'][0] );
	}

	/**
	 * Unset meta value is returned as null, not empty string.
	 */
	public function test_unset_meta_value_returned_as_null(): void {
		$sequence = $this->make_sequence(
			1,
			array(
				'metadata_fields' => array(
					array( 'key' => 'embargo', 'label' => 'Embargo', 'type' => 'date' ),
				),
			)
		);

		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 3 ) );
		Functions\when( 'get_post_meta' )->alias(
			function ( $post_id, $key, $single ) {
				if ( '_vip_workflows_sequence_id' === $key ) {
					return '1';
				}
				return ''; // No value stored.
			}
		);

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 1 )->andReturn( $sequence );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 3 ) );

		$data = $result->get_data();
		$this->assertNull( $data['fields'][0]['value'] );
	}

	/**
	 * Select-type fields include options in the response.
	 */
	public function test_select_field_includes_options(): void {
		$sequence = $this->make_sequence(
			5,
			array(
				'metadata_fields' => array(
					array(
						'key'     => 'category',
						'label'   => 'Category',
						'type'    => 'select',
						'options' => array( 'News', 'Opinion', 'Feature' ),
					),
				),
			)
		);

		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 8 ) );
		Functions\when( 'get_post_meta' )->alias(
			function ( $post_id, $key, $single ) {
				if ( '_vip_workflows_sequence_id' === $key ) {
					return '5';
				}
				return 'Opinion';
			}
		);

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 5 )->andReturn( $sequence );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 8 ) );

		$data = $result->get_data();
		$this->assertArrayHasKey( 'options', $data['fields'][0] );
		$this->assertSame( array( 'News', 'Opinion', 'Feature' ), $data['fields'][0]['options'] );
	}

	/**
	 * Non-select fields do not include options key.
	 */
	public function test_text_field_omits_options(): void {
		$sequence = $this->make_sequence(
			3,
			array(
				'metadata_fields' => array(
					array( 'key' => 'byline', 'label' => 'Byline', 'type' => 'text' ),
				),
			)
		);

		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 2 ) );
		Functions\when( 'get_post_meta' )->alias(
			function ( $post_id, $key, $single ) {
				return '_vip_workflows_sequence_id' === $key ? '3' : '';
			}
		);

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 3 )->andReturn( $sequence );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 2 ) );

		$data = $result->get_data();
		$this->assertArrayNotHasKey( 'options', $data['fields'][0] );
	}

	/**
	 * A cleared `user` field is returned as null, not the 0 it is stored as.
	 *
	 * The editor clears a user field by writing 0 — the meta is registered as an
	 * integer, and core's REST schema refuses an empty string before absint can
	 * coerce it — so 0 is what an unassigned user field normally holds.
	 */
	public function test_cleared_user_field_returned_as_null(): void {
		$sequence = $this->make_sequence(
			11,
			array(
				'metadata_fields' => array(
					array( 'key' => 'photographer', 'label' => 'Photographer', 'type' => 'user' ),
				),
			)
		);

		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 4 ) );
		Functions\when( 'get_post_meta' )->alias(
			function ( $post_id, $key, $single ) {
				if ( '_vip_workflows_sequence_id' === $key ) {
					return '11';
				}
				// What the database gives back for a field cleared to 0.
				return '0';
			}
		);

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 11 )->andReturn( $sequence );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 4 ) );

		$data = $result->get_data();
		$this->assertNull( $data['fields'][0]['value'] );
	}

	/**
	 * A `user` field holding a real id still reports that id.
	 */
	public function test_assigned_user_field_returns_the_id(): void {
		$sequence = $this->make_sequence(
			12,
			array(
				'metadata_fields' => array(
					array( 'key' => 'photographer', 'label' => 'Photographer', 'type' => 'user' ),
				),
			)
		);

		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 6 ) );
		Functions\when( 'get_post_meta' )->alias(
			function ( $post_id, $key, $single ) {
				return '_vip_workflows_sequence_id' === $key ? '12' : '7';
			}
		);

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 12 )->andReturn( $sequence );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 6 ) );

		$data = $result->get_data();
		$this->assertSame( '7', $data['fields'][0]['value'] );
	}

	/**
	 * Zero survives on every other type: only `user` spells "empty" that way.
	 */
	public function test_zero_is_a_value_for_non_user_fields(): void {
		$sequence = $this->make_sequence(
			13,
			array(
				'metadata_fields' => array(
					array( 'key' => 'edition', 'label' => 'Edition', 'type' => 'text' ),
				),
			)
		);

		Functions\when( 'get_post' )->justReturn( (object) array( 'ID' => 9 ) );
		Functions\when( 'get_post_meta' )->alias(
			function ( $post_id, $key, $single ) {
				return '_vip_workflows_sequence_id' === $key ? '13' : '0';
			}
		);

		$repository = Mockery::mock( SequenceRepository::class );
		$repository->shouldReceive( 'find' )->with( 13 )->andReturn( $sequence );

		$controller = $this->make_controller_with_repository( $repository );
		$result     = $controller->get_metadata( $this->make_request( 9 ) );

		$data = $result->get_data();
		$this->assertSame( '0', $data['fields'][0]['value'] );
	}

	/**
	 * Permission check passes when the user can edit the post.
	 */
	public function test_permissions_check_passes_when_user_can_edit(): void {
		Functions\expect( 'current_user_can' )
			->once()
			->with( 'edit_post', 1 )
			->andReturn( true );

		$controller = new MetadataController();
		$result     = $controller->get_metadata_permissions_check( $this->make_request( 1 ) );

		$this->assertTrue( $result );
	}

	/**
	 * Permission check fails when the user cannot edit the post.
	 */
	public function test_permissions_check_fails_when_user_cannot_edit(): void {
		Functions\expect( 'current_user_can' )
			->once()
			->with( 'edit_post', 1 )
			->andReturn( false );

		$controller = new MetadataController();
		$result     = $controller->get_metadata_permissions_check( $this->make_request( 1 ) );

		$this->assertFalse( $result );
	}

	/**
	 * Create a MetadataController whose SequenceRepository can be swapped.
	 *
	 * Only the repository is replaced: get_metadata() itself is the thing under
	 * test, so the double is seated through the controller's own
	 * get_repository() seam rather than by re-implementing the method here.
	 */
	private function make_controller_with_repository( SequenceRepository $repository ): MetadataController {
		return new class( $repository ) extends MetadataController {
			private SequenceRepository $repo;

			public function __construct( SequenceRepository $repo ) {
				parent::__construct();
				$this->repo = $repo;
			}

			protected function get_repository(): SequenceRepository {
				return $this->repo;
			}
		};
	}
}
