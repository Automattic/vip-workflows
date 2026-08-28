<?php
/**
 * SequencesController unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\API\SequencesController;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;

/**
 * Tests for the SequencesController REST API.
 */
class SequencesControllerTest extends TestCase
{
    /**
     * Controller under test.
     *
     * @var SequencesController
     */
    private SequencesController $controller;

    /**
     * Mock wpdb.
     *
     * @var object
     */
    private $wpdb;

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        // Mock global $wpdb.
        global $wpdb;
        $this->wpdb         = Mockery::mock( 'wpdb' );
        $this->wpdb->prefix = 'wp_';
        $wpdb               = $this->wpdb;

        $this->controller = new SequencesController();
    }

    protected function tearDown(): void
    {
        // Reset the Plugin singleton seeded by feature-gating tests.
        $reflection    = new \ReflectionClass( \VIPWorkflows\Plugin::class );
        $instance_prop = $reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, null );

        parent::tearDown();
    }

    /**
     * Create a test sequence database row.
     *
     * @param array $overrides Field overrides.
     * @return object
     */
    private function create_sequence_row( array $overrides = array() ): object
    {
        $config = array(
            'statuses' => array(
                array(
                    'key'         => 'draft',
                    'label'       => 'Draft',
                    'color'       => '#gray',
                    'transitions' => array(
                        array( 'to' => 'review', 'label' => 'Submit' ),
                    ),
                ),
                array(
                    'key'         => 'review',
                    'label'       => 'In Review',
                    'color'       => '#orange',
                    'transitions' => array(),
                ),
            ),
            'post_types' => array( 'post' ),
        );

        $defaults = array(
            'id'          => 1,
            'uuid'        => 'test-uuid-1234',
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => 'Test Sequence',
            'slug'        => 'test-sequence',
            'description' => 'A test sequence',
            'version'     => 1,
            'status'      => 'active',
            'config'      => json_encode( $config ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        return (object) array_merge( $defaults, $overrides );
    }

    /**
     * Create a mock WP_REST_Request.
     *
     * @param array $params Request parameters.
     * @return object
     */
    private function create_mock_request( array $params = array() ): object
    {
        $request = Mockery::mock( 'WP_REST_Request' );

        $request->shouldReceive( 'get_param' )
            ->andReturnUsing(
                function ( $key ) use ( $params ) {
                    return $params[ $key ] ?? null;
                }
            );

        return $request;
    }

    // =========================================================================
    // Permission Tests
    // =========================================================================

    /**
     * Test get_items_permissions_check requires edit_posts capability.
     */
    public function test_get_items_permissions_check_allows_editors(): void
    {
        Functions\when( 'current_user_can' )->justReturn( true );

        $request = $this->create_mock_request();
        $result  = $this->controller->get_items_permissions_check( $request );

        $this->assertTrue( $result );
    }

    /**
     * Test get_items_permissions_check denies users without edit_posts.
     */
    public function test_get_items_permissions_check_denies_subscribers(): void
    {
        Functions\when( 'current_user_can' )->justReturn( false );

        $request = $this->create_mock_request();
        $result  = $this->controller->get_items_permissions_check( $request );

        $this->assertFalse( $result );
    }

    /**
     * Test delete_item_permissions_check requires manage_options.
     */
    public function test_delete_requires_admin(): void
    {
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'manage_options' )
            ->andReturn( false );

        $request = $this->create_mock_request( array( 'id' => 1 ) );
        $result  = $this->controller->delete_item_permissions_check( $request );

        $this->assertFalse( $result );
    }

    /**
     * Test create_item_permissions_check requires manage_options.
     */
    public function test_create_requires_admin(): void
    {
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'manage_options' )
            ->andReturn( true );

        $request = $this->create_mock_request();
        $result  = $this->controller->create_item_permissions_check( $request );

        $this->assertTrue( $result );
    }

    // =========================================================================
    // GET /sequences Tests
    // =========================================================================

    /**
     * Test get_items returns array of sequences.
     */
    public function test_get_items_returns_sequences(): void
    {
        $rows = array(
            $this->create_sequence_row( array( 'id' => 1, 'name' => 'First' ) ),
            $this->create_sequence_row( array( 'id' => 2, 'name' => 'Second' ) ),
        );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_results' )->andReturn( $rows );

        $request  = $this->create_mock_request();
        $response = $this->controller->get_items( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertCount( 2, $data );
        $this->assertSame( 'First', $data[0]['name'] );
        $this->assertSame( 'Second', $data[1]['name'] );
    }

    /**
     * Test get_items with type filter, with the Ideation feature enabled so
     * phase sequences are visible.
     */
    public function test_get_items_filters_by_type(): void
    {
        $this->seed_plugin_with_ideation_enabled( true );

        $rows = array(
            $this->create_sequence_row( array( 'type' => Sequence::TYPE_PHASE ) ),
        );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_results' )->andReturn( $rows );

        $request  = $this->create_mock_request( array( 'type' => Sequence::TYPE_PHASE ) );
        $response = $this->controller->get_items( $request );

        $data = $response->get_data();
        $this->assertCount( 1, $data );
        $this->assertSame( Sequence::TYPE_PHASE, $data[0]['type'] );
    }

    /**
     * Test get_items hides phase sequences while the Ideation feature is
     * disabled.
     */
    public function test_get_items_hides_phase_sequences_when_ideation_disabled(): void
    {
        $this->seed_plugin_with_ideation_enabled( false );

        $rows = array(
            $this->create_sequence_row( array( 'id' => 1, 'type' => Sequence::TYPE_WORKFLOW ) ),
            $this->create_sequence_row( array( 'id' => 2, 'type' => Sequence::TYPE_PHASE ) ),
        );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_results' )->andReturn( $rows );

        $request  = $this->create_mock_request();
        $response = $this->controller->get_items( $request );

        $data = $response->get_data();
        $this->assertCount( 1, $data );
        $this->assertSame( Sequence::TYPE_WORKFLOW, $data[0]['type'] );
    }

    /**
     * Test create_item rejects phase sequences while the Ideation feature
     * is disabled.
     */
    public function test_create_item_rejects_phase_type_when_ideation_disabled(): void
    {
        $this->seed_plugin_with_ideation_enabled( false );

        $request = $this->create_mock_request(
            array(
                'type' => Sequence::TYPE_PHASE,
                'name' => 'Lifecycle',
            )
        );

        $result = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'rest_sequence_type_disabled', $result->get_error_code() );
    }

    /**
     * Seed the Plugin singleton with an experiment registry where the Ideation
     * experiment resolves to the given state.
     *
     * @param bool $enabled Whether 'ideation' reports enabled.
     */
    private function seed_plugin_with_ideation_enabled( bool $enabled ): void
    {
        $registry = Mockery::mock( \VIPWorkflows\Experiments\ExperimentRegistry::class );
        $registry->shouldReceive( 'is_enabled' )->with( 'ideation' )->andReturn( $enabled );

        $reflection = new \ReflectionClass( \VIPWorkflows\Plugin::class );
        $instance   = $reflection->newInstanceWithoutConstructor();

        $registry_prop = $reflection->getProperty( 'experiment_registry' );
        $registry_prop->setValue( $instance, $registry );

        $instance_prop = $reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, $instance );
    }

    /**
     * Test response includes status summary.
     */
    public function test_get_items_includes_status_summary(): void
    {
        $rows = array( $this->create_sequence_row() );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_results' )->andReturn( $rows );

        $request  = $this->create_mock_request();
        $response = $this->controller->get_items( $request );

        $data = $response->get_data();
        $this->assertArrayHasKey( 'status_summary', $data[0] );
        $this->assertArrayHasKey( 'statuses_count', $data[0] );
        $this->assertSame( 2, $data[0]['statuses_count'] );
    }

    // =========================================================================
    // GET /sequences/{id} Tests
    // =========================================================================

    /**
     * Test get_item returns single sequence.
     */
    public function test_get_item_returns_sequence(): void
    {
        $row = $this->create_sequence_row( array( 'id' => 5 ) );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $row );

        $request  = $this->create_mock_request( array( 'id' => 5 ) );
        $response = $this->controller->get_item( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertSame( 5, $data['id'] );
        $this->assertSame( 'Test Sequence', $data['name'] );
    }

    /**
     * Test get_item returns 404 for non-existent sequence.
     */
    public function test_get_item_returns_404_when_not_found(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->get_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_not_found', $response->get_error_code() );
    }

    // =========================================================================
    // GET /sequences/slug/{slug} Tests
    // =========================================================================

    /**
     * Test get_item_by_slug returns sequence.
     */
    public function test_get_item_by_slug(): void
    {
        $row = $this->create_sequence_row( array( 'slug' => 'my-workflow' ) );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $row );

        $request  = $this->create_mock_request( array( 'slug' => 'my-workflow' ) );
        $response = $this->controller->get_item_by_slug( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertSame( 'my-workflow', $data['slug'] );
    }

    /**
     * Test get_item_by_slug returns 404 when not found.
     */
    public function test_get_item_by_slug_returns_404(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( null );

        $request  = $this->create_mock_request( array( 'slug' => 'nonexistent' ) );
        $response = $this->controller->get_item_by_slug( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_not_found', $response->get_error_code() );
    }

    // =========================================================================
    // DELETE /sequences/{id} Tests
    // =========================================================================

    /**
     * Test delete_item removes sequence.
     */
    public function test_delete_item_success(): void
    {
        $row = $this->create_sequence_row( array( 'id' => 3 ) );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $row );
        $this->wpdb->shouldReceive( 'delete' )->once()->andReturn( 1 );

        $request  = $this->create_mock_request( array( 'id' => 3 ) );
        $response = $this->controller->delete_item( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertTrue( $data['deleted'] );
        $this->assertSame( 3, $data['id'] );
    }

    /**
     * Test delete_item returns 404 for non-existent sequence.
     */
    public function test_delete_item_returns_404(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->delete_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_not_found', $response->get_error_code() );
    }

    /**
     * Test delete_item returns error on failure.
     */
    public function test_delete_item_handles_failure(): void
    {
        $row = $this->create_sequence_row();

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $row );
        $this->wpdb->shouldReceive( 'delete' )->once()->andReturn( false );

        $request  = $this->create_mock_request( array( 'id' => 1 ) );
        $response = $this->controller->delete_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_delete_failed', $response->get_error_code() );
    }

    // =========================================================================
    // POST /sequences Tests
    // =========================================================================

    /**
     * Test create_item creates sequence.
     */
    public function test_create_item_success(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // slug_exists() -> not taken.
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcd' );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'        => 'New Workflow',
                'description' => 'Test description',
                'type'        => Sequence::TYPE_WORKFLOW,
                'statuses'    => array(
                    array(
                        'key'         => 'draft',
                        'label'       => 'Draft',
                        'color'       => '#gray',
                        'transitions' => array(),
                    ),
                ),
                'post_types'  => array( 'post' ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( 201, $response->get_status() );
    }

    /**
     * Test create_item returns error on failure.
     */
    public function test_create_item_handles_failure(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // slug_exists() -> not taken.
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( null );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturn( false );

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'New Workflow',
                'statuses' => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_create_failed', $response->get_error_code() );
    }

    /**
     * Test build_config persists the declared status flags.
     */
    public function test_create_item_persists_status_flags(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Flagged',
                'statuses' => array(
                    array(
                        'key'            => 'intake',
                        'label'          => 'Intake',
                        'is_initial'     => true,
                        'is_in_progress' => true,
                    ),
                    array(
                        'key'         => 'spiked',
                        'label'       => 'Spiked',
                        'is_dead_end' => true,
                    ),
                ),
            )
        );

        $this->controller->create_item( $request );

        $config   = json_decode( $captured['config'], true );
        $statuses = $config['statuses'];
        $this->assertTrue( $statuses[0]['is_initial'] );
        $this->assertTrue( $statuses[0]['is_in_progress'] );
        $this->assertTrue( $statuses[1]['is_dead_end'] );
        // Flags that were not set are not persisted as false noise.
        $this->assertArrayNotHasKey( 'creates_post', $statuses[0] );
    }

    /**
     * Test slug dedup checks all statuses, not just active ones.
     */
    public function test_create_item_dedups_slug_against_non_active_sequence(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        // slug_exists() -> taken (e.g. by a draft sequence find_by_slug would miss).
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 1 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcd' );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Taken Name',
                'statuses' => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
            )
        );

        $this->controller->create_item( $request );

        // The colliding slug was suffixed rather than allowed to hit the unique key.
        $this->assertSame( 'taken-name-abcd', $captured['slug'] );
    }

    /**
     * A config the write-time gate rejects (here: a transition to an undefined
     * stage) is surfaced as a controlled 422, not an uncaught fatal / HTTP 500.
     */
    public function test_create_item_rejects_invalid_config_with_422(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // slug not taken.

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Dangling',
                'statuses' => array(
                    array( 'key' => 'start', 'label' => 'Start', 'transitions' => array( array( 'to' => 'ghost' ) ) ),
                    array( 'key' => 'end', 'label' => 'End' ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_invalid_config', $response->get_error_code() );
        $this->assertSame( 422, $response->get_error_data()['status'] ?? null );
    }

    /**
     * REST-submitted stage × status matrix fields (`status` region and
     * `region_entry` checkpoint) survive build_config() into the persisted
     * config, and a stage submitted without a `status` is normalized to the
     * draft region by the write gate — write-time normalization, never a
     * read-time fallback.
     */
    public function test_create_item_persists_matrix_fields(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Matrix Stages',
                'statuses' => array(
                    array( 'key' => 'writing', 'label' => 'Writing' ),
                    array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish', 'region_entry' => true ),
                ),
            )
        );

        $this->controller->create_item( $request );

        $config = json_decode( $captured['config'], true );
        $this->assertSame( 'draft', $config['statuses'][0]['status'], 'Missing status defaults to draft at write time.' );
        $this->assertTrue( $config['statuses'][0]['region_entry'], 'Sole draft-region stage auto-assigned as its checkpoint.' );
        $this->assertSame( 'publish', $config['statuses'][1]['status'], 'Submitted region persisted.' );
        $this->assertTrue( $config['statuses'][1]['region_entry'], 'Submitted checkpoint marker persisted.' );
    }

    /**
     * A client written against the older schema sends what a transition captures
     * as a singular `input`. build_config() rebuilds each transition from an
     * allowlist that names only `inputs`, so without a conversion at the boundary
     * the key is neither read nor refused — the save returns 200 having deleted
     * the note or the assignment slot the caller sent. Converted the same way the
     * import boundary converts it, through the same function.
     */
    public function test_create_item_converts_the_retired_singular_input(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Legacy Input',
                'statuses' => array(
                    array(
                        'key'         => 'draft',
                        'label'       => 'Draft',
                        'transitions' => array(
                            array(
                                'to'    => 'review',
                                'label' => 'Send',
                                'input' => array(
                                    'type'          => 'assignment',
                                    'meta_key'      => 'legal_reviewer',
                                    'assignee_type' => 'user',
                                ),
                            ),
                        ),
                    ),
                    array( 'key' => 'review', 'label' => 'Review' ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertNotInstanceOf( 'WP_Error', $response, 'A legacy-shaped payload is accepted.' );

        $config = json_decode( $captured['config'], true );
        $inputs = $config['statuses'][0]['transitions'][0]['inputs'] ?? null;

        $this->assertIsArray( $inputs, 'The retired singular key reaches storage as a list.' );
        $this->assertCount( 1, $inputs );
        $this->assertSame( 'assignment', $inputs[0]['type'] );
        $this->assertSame( 'legal_reviewer', $inputs[0]['meta_key'], 'The slot the caller declared survives the save.' );
        $this->assertArrayNotHasKey( 'input', $config['statuses'][0]['transitions'][0] );
    }

    /**
     * The same conversion runs BEFORE validate_assignment_keys(), so a
     * legacy-shaped payload's `requires_assignment` gate is measured against the
     * slots it actually declares rather than against none.
     */
    public function test_create_item_sees_legacy_assignment_slots_when_validating(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Legacy Duplicate Slots',
                'statuses' => array(
                    array(
                        'key'         => 'draft',
                        'label'       => 'Draft',
                        'transitions' => array(
                            array(
                                'to'    => 'review',
                                'input' => array( 'type' => 'assignment', 'meta_key' => 'reviewer' ),
                            ),
                        ),
                    ),
                    array(
                        'key'         => 'review',
                        'label'       => 'Review',
                        'transitions' => array(
                            array(
                                'to'    => 'draft',
                                'input' => array( 'type' => 'assignment', 'meta_key' => 'reviewer' ),
                            ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'duplicate_assignment_key', $response->get_error_code() );
    }

    /**
     * A present-but-invalid stage `status` region (an overlay like `future`)
     * is rejected by the write gate as a controlled 422.
     */
    public function test_create_item_rejects_invalid_stage_region_with_422(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // slug not taken.

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Overlay Region',
                'statuses' => array(
                    array( 'key' => 'scheduled', 'label' => 'Scheduled', 'status' => 'future' ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_invalid_config', $response->get_error_code() );
        $this->assertSame( 422, $response->get_error_data()['status'] ?? null );
    }

    // =========================================================================
    // Collection Params Tests
    // =========================================================================

    /**
     * Test get_collection_params returns correct schema.
     */
    public function test_get_collection_params(): void
    {
        $params = $this->controller->get_collection_params();

        $this->assertArrayHasKey( 'type', $params );
        $this->assertArrayHasKey( 'status', $params );
        $this->assertArrayHasKey( 'latest_only', $params );

        $this->assertContains( Sequence::TYPE_WORKFLOW, $params['type']['enum'] );
        $this->assertContains( Sequence::TYPE_PHASE, $params['type']['enum'] );

        $this->assertContains( 'active', $params['status']['enum'] );
        $this->assertContains( 'draft', $params['status']['enum'] );
        $this->assertContains( 'archived', $params['status']['enum'] );
    }

    // =========================================================================
    // PUT /sequences/{id} Tests
    // =========================================================================

    /**
     * Test update_item_permissions_check requires manage_options.
     */
    public function test_update_requires_admin(): void
    {
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'manage_options' )
            ->andReturn( true );

        $request = $this->create_mock_request( array( 'id' => 1 ) );
        $result  = $this->controller->update_item_permissions_check( $request );

        $this->assertTrue( $result );
    }

    /**
     * Test update_item returns 404 for non-existent sequence.
     */
    public function test_update_item_returns_404(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->update_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_not_found', $response->get_error_code() );
    }

    /**
     * Test update_item success.
     */
    public function test_update_item_success(): void
    {
        $existing_row = $this->create_sequence_row( array( 'id' => 5 ) );
        $updated_row  = $this->create_sequence_row(
            array(
                'id'   => 5,
                'name' => 'Updated Name',
            )
        );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        // First call finds existing, second call returns updated.
        $this->wpdb->shouldReceive( 'get_row' )
            ->andReturn( $existing_row, $updated_row );
        $this->wpdb->shouldReceive( 'update' )->once()->andReturn( 1 );

        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'id'       => 5,
                'name'     => 'Updated Name',
                'statuses' => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
            )
        );

        $response = $this->controller->update_item( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $data = $response->get_data();
        $this->assertSame( 5, $data['id'] );
    }

    /**
     * Test update_item handles failure.
     */
    public function test_update_item_handles_failure(): void
    {
        $existing_row = $this->create_sequence_row();

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $existing_row );
        $this->wpdb->shouldReceive( 'update' )->once()->andReturn( false );

        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'id'       => 1,
                'name'     => 'Updated',
                'statuses' => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
            )
        );

        $response = $this->controller->update_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_update_failed', $response->get_error_code() );
    }

    // =========================================================================
    // GET /sequences/{id}/export Tests
    // =========================================================================

    /**
     * Test export_sequence returns JSON structure.
     */
    public function test_export_sequence_success(): void
    {
        $row = $this->create_sequence_row(
            array(
                'id'          => 3,
                'name'        => 'Export Test',
                'description' => 'Test description',
            )
        );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $row );

        $request  = $this->create_mock_request( array( 'id' => 3 ) );
        $response = $this->controller->export_sequence( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertArrayHasKey( 'name', $data );
        $this->assertArrayHasKey( 'type', $data );
        $this->assertArrayHasKey( 'description', $data );
        $this->assertArrayHasKey( 'config', $data );
        $this->assertSame( 'Export Test', $data['name'] );
    }

    /**
     * Test export_sequence returns 404 for missing sequence.
     */
    public function test_export_sequence_returns_404(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->export_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_not_found', $response->get_error_code() );
    }

    /**
     * Test export_sequence includes metadata_fields in the exported config.
     */
    public function test_export_sequence_includes_metadata_fields(): void
    {
        $config = array(
            'statuses'        => array(
                array( 'key' => 'draft', 'label' => 'Draft', 'transitions' => array() ),
            ),
            'post_types'      => array( 'post' ),
            'metadata_fields' => array(
                array( 'key' => 'content_pillar', 'label' => 'Content Pillar', 'type' => 'select', 'options' => array( 'News', 'Opinion' ), 'required' => false, 'searchable' => true ),
            ),
        );
        $row = $this->create_sequence_row( array( 'id' => 8, 'config' => json_encode( $config ) ) );

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $row );

        $request  = $this->create_mock_request( array( 'id' => 8 ) );
        $response = $this->controller->export_sequence( $request );

        $data = $response->get_data();
        $this->assertArrayHasKey( 'metadata_fields', $data['config'] );
        $this->assertCount( 1, $data['config']['metadata_fields'] );
        $this->assertSame( 'content_pillar', $data['config']['metadata_fields'][0]['key'] );
    }

    // =========================================================================
    // POST /sequences/import Tests
    // =========================================================================

    /**
     * Test import_sequence validates type.
     */
    public function test_import_sequence_validates_type(): void
    {
        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type' => 'invalid',
                    'name' => 'Test',
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'invalid_sequence_type', $response->get_error_code() );
    }

    /**
     * Test import_sequence validates name.
     */
    public function test_import_sequence_validates_name(): void
    {
        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type' => 'workflow',
                    'name' => '',
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'missing_sequence_name', $response->get_error_code() );
    }

    /**
     * Test import_sequence validates config.
     */
    public function test_import_sequence_validates_config(): void
    {
        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Test',
                    'config' => 'not-an-array',
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'invalid_sequence_config', $response->get_error_code() );
    }

    /**
     * Test import_sequence validates statuses.
     */
    public function test_import_sequence_validates_statuses(): void
    {
        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Test',
                    'config' => array( 'statuses' => array() ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'invalid_sequence_statuses', $response->get_error_code() );
    }

    /**
     * Test import_sequence success.
     */
    public function test_import_sequence_success(): void
    {
        // Mock slug uniqueness check.
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // No existing slug.
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturn( 1 );
        $this->wpdb->shouldReceive( 'update' )->once()->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'        => 'workflow',
                    'name'        => 'Imported Sequence',
                    'description' => 'Imported',
                    'config'      => array(
                        'statuses' => array(
                            array( 'key' => 'draft', 'label' => 'Draft' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( 201, $response->get_status() );

        $data = $response->get_data();
        $this->assertTrue( $data['success'] );
        $this->assertArrayHasKey( 'sequence', $data );
    }

    /**
     * Test import_sequence persists metadata_fields from the imported config
     * (the export -> import round-trip the editorial-metadata feature relies on).
     */
    public function test_import_sequence_preserves_metadata_fields(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // No existing slug.
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->shouldReceive( 'update' )->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported With Metadata',
                    'config' => array(
                        'statuses'        => array(
                            array( 'key' => 'draft', 'label' => 'Draft' ),
                        ),
                        'metadata_fields' => array(
                            array( 'key' => 'content_pillar', 'label' => 'Content Pillar', 'type' => 'text', 'required' => false, 'searchable' => true ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( 201, $response->get_status() );

        // The metadata fields survive into the persisted sequence config.
        $this->assertNotNull( $captured );
        $stored = json_decode( $captured['config'], true );
        $this->assertArrayHasKey( 'metadata_fields', $stored );
        $this->assertSame( 'content_pillar', $stored['metadata_fields'][0]['key'] );
    }

    /**
     * import_sequence flows through the shared write gate: stage keys and
     * transition targets are sanitize_key-normalized, a missing per-stage
     * `status` defaults to the draft region, and each used region gets its
     * entry checkpoint. (Regression: import used to skip build_config() and
     * could persist unnormalized keys.)
     */
    public function test_import_sequence_normalizes_keys_and_regions_via_write_gate(): void
    {
        // The TestCase sanitize_key stub strips before lowercasing; re-stub with
        // WordPress's real order (lowercase first) so case-folding is exercised.
        $this->stub_real_sanitize_key();

        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // No existing slug.
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->shouldReceive( 'update' )->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported Unnormalized',
                    'config' => array(
                        'statuses' => array(
                            array(
                                'key'         => 'First Draft',
                                'label'       => 'First Draft',
                                'transitions' => array( array( 'to' => 'Final Review', 'label' => 'Next' ) ),
                            ),
                            array( 'key' => 'Final Review', 'label' => 'Final Review', 'status' => 'pending' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( 201, $response->get_status() );

        $stored = json_decode( $captured['config'], true );
        $this->assertSame( 'firstdraft', $stored['statuses'][0]['key'], 'Stage key normalized by the gate.' );
        $this->assertSame( 'finalreview', $stored['statuses'][0]['transitions'][0]['to'], 'Transition target normalized to match.' );
        $this->assertSame( 'draft', $stored['statuses'][0]['status'], 'Missing region defaults to draft at write time.' );
        $this->assertTrue( $stored['statuses'][0]['region_entry'], 'Draft-region checkpoint auto-assigned.' );
        $this->assertSame( 'pending', $stored['statuses'][1]['status'], 'Explicit region persisted.' );
        $this->assertTrue( $stored['statuses'][1]['region_entry'], 'Pending-region checkpoint auto-assigned.' );
    }

    /**
     * import_sequence surfaces a gate rejection (here: an overlay region) as a
     * controlled 422 rather than an uncaught fatal.
     */
    public function test_import_sequence_rejects_invalid_stage_region_with_422(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // No existing slug.

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported Overlay Region',
                    'config' => array(
                        'statuses' => array(
                            array( 'key' => 'scheduled', 'label' => 'Scheduled', 'status' => 'trash' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_invalid_config', $response->get_error_code() );
        $this->assertSame( 422, $response->get_error_data()['status'] ?? null );
    }

    /**
     * import_sequence rejects a stage whose `transitions` is a bare string as
     * a controlled 422. (Regression: the gate's is_array-guarded loops used to
     * SKIP the value, importing a config that fatals in
     * get_transitions_for_user() on every panel load.)
     */
    public function test_import_sequence_rejects_string_transitions_with_422(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // No existing slug.

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported String Transitions',
                    'config' => array(
                        'statuses' => array(
                            array( 'key' => 'draft', 'label' => 'Draft', 'transitions' => 'review' ),
                            array( 'key' => 'review', 'label' => 'Review' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_invalid_config', $response->get_error_code() );
        $this->assertSame( 422, $response->get_error_data()['status'] ?? null );
    }

    /**
     * import_sequence rejects a non-boolean region_entry as a controlled 422.
     * (Regression: truthiness normalization coerced the JSON string "false" to
     * TRUE on the import path, which the REST create/update schema's boolean
     * type never sees.)
     */
    public function test_import_sequence_rejects_string_region_entry_with_422(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // No existing slug.

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported String Marker',
                    'config' => array(
                        'statuses' => array(
                            array( 'key' => 'draft', 'label' => 'Draft', 'region_entry' => 'false' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_invalid_config', $response->get_error_code() );
        $this->assertSame( 422, $response->get_error_data()['status'] ?? null );
    }

    /**
     * import_sequence rejects a malformed agent config (routing that is not an
     * object), proving the agent validator is wired into the import path like
     * create/update.
     */
    public function test_import_sequence_rejects_malformed_agent(): void
    {
        $this->stub_stage_ability();

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported With Bad Agent',
                    'config' => array(
                        'statuses' => array(
                            array(
                                'key'         => 'ai_desk',
                                'label'       => 'AI Desk',
                                'transitions' => array( array( 'to' => 'review' ) ),
                                'agent'       => array(
                                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                                    'routing'    => 'review', // not an object
                                ),
                            ),
                            array( 'key' => 'review', 'label' => 'Review' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'invalid_status_agent_routing', $response->get_error_code() );
    }

    /**
     * import_sequence sanitizes a valid agent config before persisting it —
     * only the binary pass/fail/error routing keys survive, unknown keys drop.
     */
    public function test_import_sequence_sanitizes_agent_config(): void
    {
        $this->stub_stage_ability();

        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // No existing slug.
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->shouldReceive( 'update' )->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported With Agent',
                    'config' => array(
                        'statuses' => array(
                            array(
                                'key'         => 'ai_desk',
                                'label'       => 'AI Desk',
                                'transitions' => array(
                                    array( 'to' => 'review' ),
                                    array( 'to' => 'draft' ),
                                ),
                                'agent'       => array(
                                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                                    'routing'    => array(
                                        'pass'  => 'review',
                                        'fail'  => 'draft',
                                        'error' => 'review',
                                    ),
                                    'unexpected' => 'dropped by sanitization',
                                ),
                            ),
                            array( 'key' => 'review', 'label' => 'Review' ),
                            array( 'key' => 'draft', 'label' => 'Draft' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( 201, $response->get_status() );

        $this->assertNotNull( $captured );
        $stored = json_decode( $captured['config'], true );
        $agent  = $stored['statuses'][0]['agent'];

        $this->assertSame( 'workflow-agent-reformat-to-template/reformat-to-template', $agent['ability_id'] );
        $this->assertSame( 'review', $agent['routing']['pass'] );
        $this->assertSame( 'draft', $agent['routing']['fail'] );
        $this->assertSame( 'review', $agent['routing']['error'] );
        $this->assertArrayNotHasKey( 'warning', $agent['routing'], 'the retired warning outcome is never persisted' );
        $this->assertArrayNotHasKey( 'unexpected', $agent, 'unknown agent keys are stripped' );
    }

    /**
     * A workflow import cannot bypass the stage-graph gate by smuggling in a stray
     * `phases` key. Validation keys off the sequence TYPE, so an invalid `statuses`
     * graph (here: duplicate stage keys) is still rejected as a controlled 422.
     */
    public function test_import_sequence_rejects_workflow_with_stray_phases(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 ); // slug not taken.

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Smuggled Phases',
                    'config' => array(
                        // Stray phases key must NOT exempt a workflow from stage rules.
                        'phases'   => array( array( 'key' => 'ideation' ) ),
                        'statuses' => array(
                            array( 'key' => 'review', 'label' => 'Review' ),
                            array( 'key' => 'review', 'label' => 'Duplicate' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_sequence_invalid_config', $response->get_error_code() );
        $this->assertSame( 422, $response->get_error_data()['status'] ?? null );
    }

    // =========================================================================
    // validate_metadata_fields tests
    // =========================================================================

    /**
     * Test validate_metadata_fields returns empty array for empty input.
     */
    public function test_validate_metadata_fields_empty(): void
    {
        $result = $this->controller->validate_metadata_fields( [] );
        $this->assertSame( [], $result );
    }

    /**
     * Test validate_metadata_fields returns empty array for null input.
     */
    public function test_validate_metadata_fields_null(): void
    {
        $result = $this->controller->validate_metadata_fields( null );
        $this->assertSame( [], $result );
    }

    /**
     * Test validate_metadata_fields accepts valid fields (text, textarea, select, date, user).
     */
    public function test_validate_metadata_fields_valid_types(): void
    {
        $fields = [
            [ 'key' => 'section', 'label' => 'Section', 'type' => 'text' ],
            [ 'key' => 'body_notes', 'label' => 'Body Notes', 'type' => 'textarea' ],
            [ 'key' => 'embargo_date', 'label' => 'Embargo Date', 'type' => 'date' ],
            [ 'key' => 'assigned_to', 'label' => 'Assigned To', 'type' => 'user' ],
            [
                'key'     => 'pillar',
                'label'   => 'Content Pillar',
                'type'    => 'select',
                'options' => [ 'News', 'Opinion' ],
            ],
        ];

        $result = $this->controller->validate_metadata_fields( $fields );

        $this->assertCount( 5, $result );
        $this->assertSame( 'section', $result[0]['key'] );
        $this->assertSame( 'text', $result[0]['type'] );
        $this->assertFalse( $result[0]['required'] );
        $this->assertFalse( $result[0]['searchable'] );
        $this->assertSame( [ 'News', 'Opinion' ], $result[4]['options'] );
    }

    /**
     * Test validate_metadata_fields returns error for invalid type.
     */
    public function test_validate_metadata_fields_invalid_type(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'key' => 'foo', 'label' => 'Foo', 'type' => 'richtext' ],
        ] );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_metadata_field_type', $result->get_error_code() );
    }

    /**
     * Test validate_metadata_fields returns error for missing key.
     */
    public function test_validate_metadata_fields_missing_key(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'label' => 'No Key', 'type' => 'text' ],
        ] );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_metadata_field_key', $result->get_error_code() );
    }

    /**
     * Test validate_metadata_fields returns error for key with invalid characters (space).
     */
    public function test_validate_metadata_fields_key_with_spaces(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'key' => 'my field', 'label' => 'My Field', 'type' => 'text' ],
        ] );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_metadata_field_key', $result->get_error_code() );
    }

    /**
     * Test validate_metadata_fields accepts key with underscores.
     */
    public function test_validate_metadata_fields_key_with_underscores(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'key' => 'my_field', 'label' => 'My Field', 'type' => 'text' ],
        ] );

        $this->assertIsArray( $result );
        $this->assertSame( 'my_field', $result[0]['key'] );
    }

    /**
     * Test validate_metadata_fields returns error for missing label.
     */
    public function test_validate_metadata_fields_missing_label(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'key' => 'section', 'type' => 'text' ],
        ] );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_metadata_field_label', $result->get_error_code() );
    }

    /**
     * Test validate_metadata_fields returns error for duplicate keys.
     */
    public function test_validate_metadata_fields_duplicate_keys(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'key' => 'section', 'label' => 'Section', 'type' => 'text' ],
            [ 'key' => 'section', 'label' => 'Section Again', 'type' => 'textarea' ],
        ] );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'duplicate_metadata_field_key', $result->get_error_code() );
        $this->assertStringContainsString( 'section', $result->get_error_message() );
    }

    /**
     * Test validate_metadata_fields returns error for select type without options.
     */
    public function test_validate_metadata_fields_select_without_options(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'key' => 'pillar', 'label' => 'Pillar', 'type' => 'select' ],
        ] );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_metadata_field_options', $result->get_error_code() );
    }

    /**
     * Test validate_metadata_fields returns error for select type with empty options.
     */
    public function test_validate_metadata_fields_select_with_empty_options(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'key' => 'pillar', 'label' => 'Pillar', 'type' => 'select', 'options' => [] ],
        ] );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_metadata_field_options', $result->get_error_code() );
    }

    /**
     * Test validate_metadata_fields preserves required and searchable flags.
     */
    public function test_validate_metadata_fields_flags(): void
    {
        $result = $this->controller->validate_metadata_fields( [
            [ 'key' => 'section', 'label' => 'Section', 'type' => 'text', 'required' => true, 'searchable' => true ],
        ] );

        $this->assertIsArray( $result );
        $this->assertTrue( $result[0]['required'] );
        $this->assertTrue( $result[0]['searchable'] );
    }

    // =========================================================================
    // validate_status_agents tests.
    // =========================================================================

    /**
     * Stub the abilities registry so validate_status_agents() resolves any
     * ability_id to a (configurably) stage-eligible ability.
     *
     * @param bool $eligible  Whether the ability reports stage_eligible.
     * @param bool $registered Whether the ability exists at all.
     */
    private function stub_stage_ability( bool $eligible = true, bool $registered = true ): void
    {
        if ( ! $registered ) {
            Functions\when( 'wp_get_ability' )->justReturn( null );
            return;
        }

        $ability = Mockery::mock();
        $ability->shouldReceive( 'get_meta' )->andReturn( array( 'stage_eligible' => $eligible ) );
        Functions\when( 'wp_get_ability' )->justReturn( $ability );
    }

    /**
     * A status with a valid agent config (ability_id + routing whose targets are
     * configured transitions) passes validation.
     */
    public function test_validate_status_agents_accepts_valid_config(): void
    {
        $this->stub_stage_ability();
        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'label'       => 'AI Desk',
                'transitions' => array(
                    array( 'to' => 'review' ),
                    array( 'to' => 'draft' ),
                ),
                'agent'       => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => array(
                        'pass'  => 'review',
                        'fail'  => 'draft',
                        'error' => 'review',
                    ),
                ),
            ),
        );

        $this->assertTrue( $this->controller->validate_status_agents( $statuses ) );
    }

    /**
     * Statuses with no agent config are left alone (no false positives).
     */
    public function test_validate_status_agents_ignores_non_agent_statuses(): void
    {
        $statuses = array(
            array( 'key' => 'draft', 'label' => 'Draft', 'transitions' => array() ),
        );

        $this->assertTrue( $this->controller->validate_status_agents( $statuses ) );
    }

    /**
     * An agent config with an empty ability_id is rejected.
     */
    public function test_validate_status_agents_rejects_empty_ability_id(): void
    {
        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'transitions' => array( array( 'to' => 'review' ) ),
                'agent'       => array(
                    'ability_id' => '',
                    'routing'    => array( 'error' => 'review' ),
                ),
            ),
        );

        $result = $this->controller->validate_status_agents( $statuses );
        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_status_agent_ability', $result->get_error_code() );
    }

    /**
     * The error route is optional: a routing map with no `error` destination is
     * valid — an errored run on such a stage fails in place (with a go-back)
     * rather than routing. A routing map that is not an object at all is still
     * rejected.
     */
    public function test_validate_status_agents_accepts_missing_error_route(): void
    {
        $this->stub_stage_ability();

        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'transitions' => array( array( 'to' => 'review' ) ),
                'agent'       => array(
                    'ability_id' => 'workflow-agent-copy-edit/copy-edit',
                    'routing'    => array( 'pass' => 'review' ),
                ),
            ),
        );

        $this->assertTrue( $this->controller->validate_status_agents( $statuses ) );

        $statuses[0]['agent']['routing'] = 'review'; // not an object
        $result = $this->controller->validate_status_agents( $statuses );
        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_status_agent_routing', $result->get_error_code() );
    }

    /**
     * A routing target that is not a configured transition of the status is rejected.
     */
    public function test_validate_status_agents_rejects_unconfigured_routing_target(): void
    {
        $this->stub_stage_ability();

        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'transitions' => array( array( 'to' => 'review' ) ),
                'agent'       => array(
                    'ability_id' => 'workflow-agent-fact-check/fact-check',
                    'routing'    => array(
                        'pass'  => 'published', // not a transition of this status
                        'error' => 'review',
                    ),
                ),
            ),
        );

        $result = $this->controller->validate_status_agents( $statuses );
        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_status_agent_routing_target', $result->get_error_code() );
    }

    /**
     * The retired `warning` routing key (and any unknown key) is rejected:
     * stage agents make a binary editorial judgment, so only pass/fail/error
     * are valid routing outcomes.
     */
    public function test_validate_status_agents_rejects_warning_routing_key(): void
    {
        $this->stub_stage_ability();

        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'transitions' => array( array( 'to' => 'review' ) ),
                'agent'       => array(
                    'ability_id' => 'workflow-agent-fact-check/fact-check',
                    'routing'    => array(
                        'pass'    => 'review',
                        'warning' => 'review',
                        'error'   => 'review',
                    ),
                ),
            ),
        );

        $result = $this->controller->validate_status_agents( $statuses );
        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_status_agent_routing_key', $result->get_error_code() );
    }

    /**
     * A non-array agent value is rejected.
     */
    public function test_validate_status_agents_rejects_non_object_agent(): void
    {
        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'transitions' => array( array( 'to' => 'review' ) ),
                'agent'       => 'not-an-object',
            ),
        );

        $result = $this->controller->validate_status_agents( $statuses );
        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_status_agent', $result->get_error_code() );
    }

    /**
     * An ability_id that is not registered in the abilities registry is rejected.
     */
    public function test_validate_status_agents_rejects_unregistered_ability(): void
    {
        $this->stub_stage_ability( true, false );

        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'transitions' => array( array( 'to' => 'review' ) ),
                'agent'       => array(
                    'ability_id' => 'vip-workflows/does-not-exist',
                    'routing'    => array( 'error' => 'review' ),
                ),
            ),
        );

        $result = $this->controller->validate_status_agents( $statuses );
        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_status_agent_ability_unknown', $result->get_error_code() );
    }

    /**
     * A registered ability that is not stage-eligible cannot own a stage.
     */
    public function test_validate_status_agents_rejects_non_stage_eligible_ability(): void
    {
        $this->stub_stage_ability( false );

        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'transitions' => array( array( 'to' => 'review' ) ),
                'agent'       => array(
                    'ability_id' => 'vip-workflows/some-tool',
                    'routing'    => array( 'error' => 'review' ),
                ),
            ),
        );

        $result = $this->controller->validate_status_agents( $statuses );
        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_status_agent_ability_unknown', $result->get_error_code() );
    }

    /**
     * create_item rejects a sequence whose AI stage has an invalid routing target,
     * proving the validator is wired into the create path.
     */
    public function test_create_item_rejects_invalid_agent_routing(): void
    {
        $this->stub_stage_ability();
        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Agent Workflow',
                'type'     => Sequence::TYPE_WORKFLOW,
                'statuses' => array(
                    array(
                        'key'         => 'ai_desk',
                        'label'       => 'AI Desk',
                        'transitions' => array( array( 'to' => 'review' ) ),
                        'agent'       => array(
                            'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                            'routing'    => array( 'pass' => 'nowhere', 'error' => 'review' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'invalid_status_agent_routing_target', $response->get_error_code() );
    }

    /**
     * build_config() rebuilds the stored config from an explicit field list, so a
     * key it does not carry is dropped rather than left alone — that is how
     * reviewer_roles became unconfigurable. allow_agent_publish decides whether an
     * agent may publish, so it has to survive a write.
     */
    public function test_build_config_round_trips_the_settings_bag(): void
    {
        $statuses = array(
            array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft', 'region_entry' => true ),
        );

        $method = new \ReflectionMethod( SequencesController::class, 'build_config' );
        $config = $method->invoke(
            $this->controller,
            Sequence::TYPE_WORKFLOW,
            $statuses,
            array( 'post' ),
            array( 'allow_agent_publish' => true, 'kept' => 'value' ),
            array()
        );

        $this->assertSame(
            array( 'allow_agent_publish' => true, 'kept' => 'value' ),
            $config['settings'],
            'build_config() dropped or rewrote the settings bag.'
        );
        $this->assertTrue(
            $config['settings']['allow_agent_publish'],
            'The publish opt-in must survive as a real boolean — the runner tests `true ===`.'
        );
    }

    /**
     * build_config persists the sanitized agent config with only the binary
     * pass/fail/error routing keys.
     */
    public function test_build_config_stores_agent_binary_routing(): void
    {
        Functions\when( 'sanitize_hex_color' )->alias( fn( $v ) => $v );

        $statuses = array(
            array(
                'key'         => 'ai_desk',
                'label'       => 'AI Desk',
                'transitions' => array(
                    array( 'to' => 'review', 'label' => 'Advance' ),
                    array( 'to' => 'draft', 'label' => 'Bump back' ),
                ),
                'agent'       => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'settings'   => array( 'template' => 'sun' ),
                    'routing'    => array(
                        'pass'  => 'review',
                        'fail'  => 'draft',
                        'error' => 'review',
                    ),
                ),
            ),
        );

        $method = new \ReflectionMethod( SequencesController::class, 'build_config' );
        $config = $method->invoke( $this->controller, Sequence::TYPE_WORKFLOW, $statuses, array( 'post' ), array(), array() );

        $agent = $config['statuses'][0]['agent'];
        $this->assertSame( 'workflow-agent-reformat-to-template/reformat-to-template', $agent['ability_id'] );
        $this->assertSame( 'review', $agent['routing']['pass'] );
        $this->assertSame( 'draft', $agent['routing']['fail'] );
        $this->assertSame( 'review', $agent['routing']['error'] );
        $this->assertArrayNotHasKey( 'warning', $agent['routing'], 'the retired warning outcome is never persisted' );
        $this->assertSame( array( 'template' => 'sun' ), $agent['settings'] );
    }


    /**
     * Stub sanitize_key with WordPress's real order (lowercase, then strip), so
     * case folding is exercised rather than the base stub's strip-then-lowercase.
     */
    private function stub_real_sanitize_key(): void
    {
        Functions\when( 'sanitize_key' )->alias(
            fn( $key ) => preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $key ) )
        );
    }

    // =========================================================================
    // Assignment slot key Tests
    // =========================================================================

    /**
     * An import mints fresh assignment slot keys, and the gates that point at
     * them follow. Regenerating the slot alone left `requires_assignment` reading
     * `_vip_workflows_assignment_{old_key}` — a slot nothing writes any more — so
     * the gated transition failed closed, silently, for every user.
     */
    public function test_import_sequence_repoints_assignment_gates_at_regenerated_keys(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->shouldReceive( 'update' )->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported With Assignment',
                    'config' => array(
                        'statuses' => array(
                            array(
                                'key'         => 'draft',
                                'label'       => 'Draft',
                                'transitions' => array(
                                    array(
                                        'to'    => 'review',
                                        'label' => 'Assign reviewer',
                                        'inputs' => array(
                                            array(
                                                'type'          => 'assignment',
                                                'meta_key'      => 'legal_reviewer',
                                                'assignee_type' => 'user',
                                            ),
                                        ),
                                    ),
                                ),
                            ),
                            array(
                                'key'         => 'review',
                                'label'       => 'Review',
                                'transitions' => array(
                                    array(
                                        'to'                  => 'published',
                                        'label'               => 'Approve',
                                        'requires_assignment' => array(
                                            'meta_key' => 'legal_reviewer',
                                            'match'    => 'current_user',
                                        ),
                                    ),
                                ),
                            ),
                            array( 'key' => 'published', 'label' => 'Published', 'status' => 'publish' ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( 201, $response->get_status() );

        $stored   = json_decode( $captured['config'], true );
        $slot_key = $stored['statuses'][0]['transitions'][0]['inputs'][0]['meta_key'];
        $gate_key = $stored['statuses'][1]['transitions'][0]['requires_assignment']['meta_key'];

        $this->assertNotSame( 'legal_reviewer', $slot_key, 'The imported slot gets its own key.' );
        $this->assertStringStartsWith( 'wfp_n', $slot_key );
        $this->assertSame( $slot_key, $gate_key, 'The gate follows the slot it points at.' );
        $this->assertSame( 'current_user', $stored['statuses'][1]['transitions'][0]['requires_assignment']['match'] );
    }

    /**
     * The shorthand gate form — `requires_assignment: "legal_reviewer"` — is the
     * same pointer written shorter (AssignmentManager::normalize_requirement),
     * so it is re-pointed too.
     */
    public function test_import_sequence_repoints_shorthand_assignment_gate(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->shouldReceive( 'update' )->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported Shorthand Gate',
                    'config' => array(
                        'statuses' => array(
                            array(
                                'key'         => 'draft',
                                'label'       => 'Draft',
                                'transitions' => array(
                                    array(
                                        'to'    => 'review',
                                        'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ) ),
                                    ),
                                ),
                            ),
                            array(
                                'key'         => 'review',
                                'label'       => 'Review',
                                'transitions' => array(
                                    array( 'to' => 'draft', 'requires_assignment' => 'legal_reviewer' ),
                                ),
                            ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $stored   = json_decode( $captured['config'], true );
        $slot_key = $stored['statuses'][0]['transitions'][0]['inputs'][0]['meta_key'];

        $this->assertSame( $slot_key, $stored['statuses'][1]['transitions'][0]['requires_assignment'] );
    }

    /**
     * An import whose gate points at a slot no transition assigns is rejected
     * rather than persisted: the transition it gates could never be taken.
     */
    public function test_import_sequence_rejects_dangling_assignment_gate(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported Dangling Gate',
                    'config' => array(
                        'statuses' => array(
                            array(
                                'key'         => 'review',
                                'label'       => 'Review',
                                'transitions' => array(
                                    array(
                                        'to'                  => 'published',
                                        'requires_assignment' => array( 'meta_key' => 'legal_reviewer' ),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'unknown_assignment_key', $response->get_error_code() );
    }

    /**
     * Two transitions assigning the same slot key write and read the same post
     * meta, so the second assignment silently replaces the first.
     */
    public function test_create_item_rejects_duplicate_assignment_keys(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Duplicate Slots',
                'type'     => Sequence::TYPE_WORKFLOW,
                'statuses' => array(
                    array(
                        'key'         => 'draft',
                        'label'       => 'Draft',
                        'transitions' => array(
                            array( 'to' => 'review', 'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ) ) ),
                        ),
                    ),
                    array(
                        'key'         => 'review',
                        'label'       => 'Review',
                        'transitions' => array(
                            array( 'to' => 'draft', 'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ) ) ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'duplicate_assignment_key', $response->get_error_code() );
    }

    /**
     * The whole list survives a create, in order, with every field an input can
     * carry sanitized rather than dropped.
     *
     * build_config() rebuilds a transition from an allowlist, so a key it does
     * not name never reaches storage — which is exactly how a transition's
     * inputs would disappear in silence if the allowlist still said `input`.
     */
    public function test_create_item_round_trips_a_list_of_inputs(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->shouldReceive( 'update' )->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Several Inputs',
                'type'     => Sequence::TYPE_WORKFLOW,
                'statuses' => array(
                    array(
                        'key'         => 'draft',
                        'label'       => 'Draft',
                        'transitions' => array(
                            array(
                                'to'     => 'review',
                                'inputs' => array(
                                    array( 'type' => 'textarea', 'note_id' => 'n1', 'note_name' => 'Why', 'required' => true ),
                                    array(
                                        'type'          => 'assignment',
                                        'meta_key'      => 'legal_reviewer',
                                        'assignee_type' => 'user',
                                        'label'         => 'Pick a reviewer',
                                        'filter'        => array( 'roles' => array( 'editor' ) ),
                                    ),
                                    array( 'type' => 'textarea', 'note_id' => 'n2', 'note_name' => 'Anything else' ),
                                ),
                            ),
                        ),
                    ),
                    array(
                        'key'         => 'review',
                        'label'       => 'Review',
                        'transitions' => array(
                            array( 'to' => 'draft', 'requires_assignment' => array( 'meta_key' => 'legal_reviewer', 'match' => 'current_user' ) ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $stored = json_decode( $captured['config'], true );
        $inputs = $stored['statuses'][0]['transitions'][0]['inputs'];

        $this->assertCount( 3, $inputs, 'Every input reaches storage.' );
        $this->assertSame(
            array( 'textarea', 'assignment', 'textarea' ),
            array_column( $inputs, 'type' ),
            'In the order the author arranged them.'
        );

        $this->assertSame( 'Why', $inputs[0]['note_name'] );
        $this->assertTrue( $inputs[0]['required'] );
        $this->assertSame( 'n1', $inputs[0]['note_id'] );

        $this->assertSame( 'legal_reviewer', $inputs[1]['meta_key'] );
        $this->assertSame( 'user', $inputs[1]['assignee_type'] );
        $this->assertSame( 'Pick a reviewer', $inputs[1]['label'] );
        $this->assertSame( array( 'editor' ), $inputs[1]['filter']['roles'] );

        $this->assertSame( 'Anything else', $inputs[2]['note_name'] );
    }

    /**
     * Two assignments on one transition is refused on write.
     *
     * The cap lives in the shared write gate rather than in this controller, so
     * every path is covered by one rule — this proves the create path reaches it
     * and turns the refusal into a 400 rather than a fatal.
     */
    public function test_create_item_rejects_two_assignment_inputs_on_one_transition(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->never();

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Two Slots One Transition',
                'type'     => Sequence::TYPE_WORKFLOW,
                'statuses' => array(
                    array(
                        'key'         => 'draft',
                        'label'       => 'Draft',
                        'transitions' => array(
                            array(
                                'to'     => 'review',
                                'inputs' => array(
                                    array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ),
                                    array( 'type' => 'assignment', 'meta_key' => 'copy_editor' ),
                                ),
                            ),
                        ),
                    ),
                    array( 'key' => 'review', 'label' => 'Review' ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertStringContainsString( 'assignment inputs', $response->get_error_message() );
    }

    /**
     * A file exported by an older version still imports.
     *
     * Import validates assignment slots and mints fresh keys on the raw JSON it
     * was handed, before the write gate ever sees it — so the conversion happens
     * at that boundary, and a legacy `input` is a list by the time either of them
     * walks it. Without that, the slot key would go un-regenerated and the
     * imported sequence would share its source's assignment slot.
     */
    public function test_import_sequence_converts_a_legacy_singular_input(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'query' );
        $this->wpdb->shouldReceive( 'get_var' )->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_sequence_row() );
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturnUsing(
            function ( $table, $data ) use ( &$captured ) {
                $captured = $data;
                return 1;
            }
        );
        $this->wpdb->shouldReceive( 'update' )->andReturn( 1 );
        $this->wpdb->insert_id = 1;

        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'wp_generate_password' )->justReturn( 'abcde' );

        $request = $this->create_mock_request(
            array(
                'sequence_json' => array(
                    'type'   => 'workflow',
                    'name'   => 'Imported From An Older Export',
                    'config' => array(
                        'statuses' => array(
                            array(
                                'key'         => 'draft',
                                'label'       => 'Draft',
                                'transitions' => array(
                                    array(
                                        'to'    => 'review',
                                        'input' => array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ),
                                    ),
                                ),
                            ),
                            array(
                                'key'         => 'review',
                                'label'       => 'Review',
                                'transitions' => array(
                                    array( 'to' => 'draft', 'requires_assignment' => 'legal_reviewer' ),
                                ),
                            ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->import_sequence( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( 201, $response->get_status() );

        $stored     = json_decode( $captured['config'], true );
        $transition = $stored['statuses'][0]['transitions'][0];

        $this->assertArrayNotHasKey( 'input', $transition, 'The singular key does not survive the import.' );
        $this->assertCount( 1, $transition['inputs'] );

        $slot_key = $transition['inputs'][0]['meta_key'];
        $this->assertNotSame( 'legal_reviewer', $slot_key, 'The imported slot still gets its own key.' );
        $this->assertStringStartsWith( 'wfp_n', $slot_key );
        $this->assertSame(
            $slot_key,
            $stored['statuses'][1]['transitions'][0]['requires_assignment'],
            'And the gate still follows the slot it points at.'
        );
    }

    /**
     * create_item refuses a gate pointing at a slot nothing assigns, proving the
     * validator is wired into the create path.
     */
    public function test_create_item_rejects_dangling_assignment_gate(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'sanitize_textarea_field' )->alias( fn( $v ) => $v );

        $request = $this->create_mock_request(
            array(
                'name'     => 'Dangling Gate',
                'type'     => Sequence::TYPE_WORKFLOW,
                'statuses' => array(
                    array(
                        'key'         => 'review',
                        'label'       => 'Review',
                        'transitions' => array(
                            array( 'to' => 'published', 'requires_assignment' => array( 'meta_key' => 'legal_reviewer' ) ),
                        ),
                    ),
                ),
            )
        );

        $response = $this->controller->create_item( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'unknown_assignment_key', $response->get_error_code() );
    }

    /**
     * A slot with no key assigns nothing and gates nothing — a required field
     * left empty, rejected rather than stored.
     */
    public function test_validate_assignment_keys_rejects_slot_without_key(): void
    {
        $result = $this->controller->validate_assignment_keys(
            array(
                array(
                    'key'         => 'draft',
                    'transitions' => array(
                        array( 'to' => 'review', 'inputs' => array( array( 'type' => 'assignment', 'meta_key' => '' ) ) ),
                    ),
                ),
            )
        );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_assignment_key', $result->get_error_code() );
    }

    /**
     * Toggling the gate on without naming a key leaves a transition nobody can
     * take, so it is a save-time error rather than a silent dead end.
     */
    public function test_validate_assignment_keys_rejects_gate_without_key(): void
    {
        $result = $this->controller->validate_assignment_keys(
            array(
                array(
                    'key'         => 'review',
                    'transitions' => array(
                        array( 'to' => 'published', 'requires_assignment' => array( 'meta_key' => '', 'match' => 'current_user' ) ),
                    ),
                ),
            )
        );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'invalid_requires_assignment', $result->get_error_code() );
    }

    /**
     * Both sides are compared after sanitize_key — the normalization the config
     * is stored under — so "Legal Reviewer" (which loses its space on write) and
     * a hand-typed "legal_reviewer" are caught as the mismatch they are instead
     * of silently becoming two slots.
     */
    public function test_validate_assignment_keys_catches_sanitize_normalized_mismatch(): void
    {
        $this->stub_real_sanitize_key();

        $result = $this->controller->validate_assignment_keys(
            array(
                array(
                    'key'         => 'draft',
                    'transitions' => array(
                        array( 'to' => 'review', 'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'Legal Reviewer' ) ) ),
                    ),
                ),
                array(
                    'key'         => 'review',
                    'transitions' => array(
                        array( 'to' => 'draft', 'requires_assignment' => array( 'meta_key' => 'legal_reviewer' ) ),
                    ),
                ),
            )
        );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'unknown_assignment_key', $result->get_error_code() );
    }

    // =========================================================================
    // GET /sequences/options Tests
    // =========================================================================

    /**
     * Stub get_post_types()/get_post_type_object() over a registry shaped like
     * WordPress's own, so the eligibility rule is exercised against real flags
     * rather than a list of slugs the test agrees with in advance.
     *
     * The core entries carry the flags core registers them with: everything
     * WordPress registers itself is `_builtin`, including the ones that used to
     * be named one by one in the editor to keep them out.
     *
     * @param array $extra Additional post types, slug => flags.
     */
    private function stub_post_type_registry( array $extra = array() ): void
    {
        $registry = array_merge(
            array(
                'post'             => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Posts' ),
                'page'             => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Pages' ),
                'attachment'       => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Media' ),
                'nav_menu_item'    => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Navigation Menu Items' ),
                'wp_block'         => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Patterns' ),
                'wp_template'      => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Templates' ),
                'wp_template_part' => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Template Parts' ),
                'wp_global_styles' => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Global Styles' ),
                'wp_navigation'    => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Navigation Menus' ),
                'wp_font_family'   => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Font Families' ),
                'wp_font_face'     => array( '_builtin' => true, 'show_in_rest' => true, 'label' => 'Font Faces' ),
            ),
            $extra
        );

        $objects = array();
        foreach ( $registry as $slug => $flags ) {
            $object               = new \stdClass();
            $object->name         = $slug;
            $object->_builtin     = $flags['_builtin'];
            $object->show_in_rest = $flags['show_in_rest'];
            $object->label        = $flags['label'];
            $objects[ $slug ]     = $object;
        }

        Functions\when( 'get_post_type_object' )->alias(
            fn( $slug ) => $objects[ $slug ] ?? null
        );

        Functions\when( 'get_post_types' )->alias(
            function ( $args ) use ( $objects ) {
                $matched = array();
                foreach ( $objects as $slug => $object ) {
                    foreach ( $args as $field => $value ) {
                        if ( $object->$field !== $value ) {
                            continue 2;
                        }
                    }
                    $matched[ $slug ] = $object;
                }

                return $matched;
            }
        );
    }

    /**
     * The editor used to build this list itself, by reading `/wp/v2/types` and
     * subtracting a hand-written denylist of WordPress's internals — a list that
     * had to grow every time core registered another post type, and had already
     * grown twice for the font ones. The answer comes from here now, and it is
     * not a denylist: core marks everything it registers `_builtin`, so patterns,
     * templates, navigation, fonts, menu items and media stay out without being
     * named, and so will whatever core adds next.
     */
    public function test_authoring_options_offers_content_types_and_no_core_internals(): void
    {
        $this->stub_post_type_registry(
            array(
                'recipe' => array( '_builtin' => false, 'show_in_rest' => true, 'label' => 'Recipes' ),
            )
        );

        $response = $this->controller->get_authoring_options( $this->create_mock_request() );
        $offered  = array_column( $response->get_data()['post_types'], 'label', 'value' );

        $this->assertSame(
            array( 'post' => 'Posts', 'page' => 'Pages', 'recipe' => 'Recipes' ),
            $offered,
            'the two content types WordPress ships, plus what someone else registered'
        );
    }

    /**
     * A post type nobody can reach over REST cannot run a workflow: the editor
     * sidebar, the metadata fields and the transition endpoints all get at a post
     * through it.
     */
    public function test_authoring_options_omits_post_types_hidden_from_rest(): void
    {
        $this->stub_post_type_registry(
            array(
                'ledger' => array( '_builtin' => false, 'show_in_rest' => false, 'label' => 'Ledger' ),
            )
        );

        $response = $this->controller->get_authoring_options( $this->create_mock_request() );
        $offered  = array_column( $response->get_data()['post_types'], 'value' );

        $this->assertNotContains( 'ledger', $offered );
    }

    /**
     * The canvas and the write gate read the same phase graph.
     *
     * They used to hold one each — `source === 'ideation' && target ===
     * 'editorial'` in the editor, `$valid_keys` plus an `'editorial' !== $to`
     * check here — so a phase added to either side alone would let an author draw
     * a connection the save then dropped without a word, or refuse one the save
     * would have kept. This pins them to the same source.
     */
    public function test_write_gate_keeps_exactly_the_phase_transitions_it_publishes(): void
    {
        $this->stub_post_type_registry();

        $published = $this->controller->get_authoring_options( $this->create_mock_request() )
            ->get_data()['phase_transitions'];

        $this->assertNotEmpty( $published, 'a phase sequence that connects nothing is not a lifecycle' );

        // Every published edge, offered to the gate from its source phase.
        $config = $this->build_phase_config( $this->phases_carrying( $published ) );

        $kept = array();
        foreach ( $config['phases'] as $phase ) {
            foreach ( $phase['transitions'] as $transition ) {
                $kept[] = array( 'from' => $phase['key'], 'to' => $transition['to'] );
            }
        }

        $this->assertSame( $published, $kept );
    }

    /**
     * A phase the graph does not name is not a phase, and neither is a hand-off
     * it does not carry: both are dropped rather than stored, which is what makes
     * the published graph worth drawing against.
     */
    public function test_write_gate_drops_phases_and_hand_offs_outside_the_published_graph(): void
    {
        $config = $this->build_phase_config(
            array(
                array(
                    'key'         => 'ideation',
                    'label'       => 'Ideation',
                    // The required hand-off, then one to a phase the graph has
                    // never heard of.
                    'transitions' => array(
                        array( 'to' => 'editorial', 'label' => 'Create Draft' ),
                        array( 'to' => 'archive', 'label' => 'Shelve' ),
                    ),
                ),
                array(
                    'key'         => 'editorial',
                    'label'       => 'Editorial',
                    // Backwards, which the graph is directed against.
                    'transitions' => array(
                        array( 'to' => 'ideation', 'label' => 'Send back' ),
                    ),
                ),
                array( 'key' => 'archive', 'label' => 'Archive', 'transitions' => array() ),
            )
        );

        $this->assertSame( array( 'ideation', 'editorial' ), array_column( $config['phases'], 'key' ) );
        $this->assertSame( array( 'editorial' ), array_column( $config['phases'][0]['transitions'], 'to' ) );
        $this->assertSame( array(), $config['phases'][1]['transitions'] );
    }

    /**
     * The lifecycle a phase sequence owes, published alongside the one it may
     * draw.
     *
     * Two different facts: PHASE_TRANSITIONS says which hand-offs are *allowed*,
     * REQUIRED_PHASES says which are *owed*. The canvas needs both — it draws
     * against the first and refuses Save against the second — and an obligation
     * the permission graph does not allow would be a rule no author could ever
     * satisfy, so the published required edges are pinned as a subset of the
     * published permitted ones.
     */
    public function test_options_publishes_the_hand_offs_a_phase_sequence_owes(): void
    {
        $this->stub_post_type_registry();

        $data = $this->controller->get_authoring_options( $this->create_mock_request() )->get_data();

        $this->assertNotEmpty(
            $data['required_phase_transitions'],
            'a phase sequence that is required to connect nothing is not a lifecycle'
        );

        foreach ( $data['required_phase_transitions'] as $edge ) {
            $this->assertContains(
                $edge,
                $data['phase_transitions'],
                'a required hand-off the canvas is not allowed to draw could never be satisfied'
            );
        }
    }

    /**
     * Every published obligation is one the write gate actually enforces.
     *
     * The rule used to live only in the browser: `[ 'ideation', 'editorial' ]`
     * written into the canvas validator, with nothing behind it — so a phase
     * sequence missing half the lifecycle saved fine through an ability call or a
     * direct PUT. Drop any one published hand-off and the gate must refuse the
     * save, whatever the graph grows into.
     */
    public function test_write_gate_refuses_a_phase_sequence_missing_a_hand_off_it_publishes_as_required(): void
    {
        $this->stub_post_type_registry();

        $required = $this->controller->get_authoring_options( $this->create_mock_request() )
            ->get_data()['required_phase_transitions'];

        // The whole obligation, satisfied: accepted, and stored intact.
        $config = $this->build_phase_config( $this->phases_carrying( $required ) );
        $kept   = array();
        foreach ( $config['phases'] as $phase ) {
            foreach ( $phase['transitions'] as $transition ) {
                $kept[] = array( 'from' => $phase['key'], 'to' => $transition['to'] );
            }
        }
        $this->assertSame( $required, $kept );

        // Then each one left out in turn.
        foreach ( $required as $index => $edge ) {
            $short = $required;
            unset( $short[ $index ] );

            $refused = false;
            try {
                $this->build_phase_config( $this->phases_carrying( array_values( $short ), $required ) );
            } catch ( \InvalidArgumentException $e ) {
                $refused = true;
                $this->assertStringContainsString( $edge['from'], $e->getMessage() );
                $this->assertStringContainsString( $edge['to'], $e->getMessage() );
            }

            $this->assertTrue(
                $refused,
                sprintf( 'the gate accepted a phase sequence with no %s → %s hand-off', $edge['from'], $edge['to'] )
            );
        }
    }

    /**
     * A phase sequence missing a required phase outright is refused, not stored
     * with a hole in it.
     */
    public function test_write_gate_refuses_a_phase_sequence_missing_a_required_phase(): void
    {
        $this->expectException( \InvalidArgumentException::class );
        $this->expectExceptionMessage( 'editorial' );

        $this->build_phase_config(
            array(
                array(
                    'key'         => 'ideation',
                    'label'       => 'Ideation',
                    'transitions' => array( array( 'to' => 'editorial', 'label' => 'Create Draft' ) ),
                ),
            )
        );
    }

    /**
     * Both phases present is not the rule; the hand-off between them is.
     *
     * The browser check counted nodes, and the "no way out" check that would have
     * caught the missing edge is only a warning on a phase sequence — so a
     * lifecycle with both phases and nothing joining them passed validation and
     * shipped bricked.
     */
    public function test_write_gate_refuses_a_phase_sequence_whose_phases_never_hand_off(): void
    {
        $this->expectException( \InvalidArgumentException::class );
        $this->expectExceptionMessageMatches( '/ideation.+editorial/' );

        $this->build_phase_config(
            array(
                array( 'key' => 'ideation', 'label' => 'Ideation', 'transitions' => array() ),
                array( 'key' => 'editorial', 'label' => 'Editorial', 'transitions' => array() ),
            )
        );
    }

    /**
     * The config the write gate would store for a phase sequence.
     *
     * @param array $phases Phases as the request carries them.
     * @return array The stored config.
     * @throws \InvalidArgumentException When the gate refuses the sequence.
     */
    private function build_phase_config( array $phases ): array
    {
        $method = new \ReflectionMethod( SequencesController::class, 'build_config' );

        return $method->invoke(
            $this->controller,
            Sequence::TYPE_PHASE,
            $phases,
            array(),
            array(),
            array()
        );
    }

    /**
     * Phases carrying the given hand-offs, in the shape a save sends.
     *
     * @param array $edges     Hand-offs to declare, as { from, to } pairs.
     * @param array $all_edges Every phase to declare, as { from, to } pairs the
     *                         endpoints are read off. Defaults to $edges, so a
     *                         caller can hold the phases fixed while removing a
     *                         hand-off between them.
     * @return array
     */
    private function phases_carrying( array $edges, array $all_edges = array() ): array
    {
        $phases = array();

        foreach ( $all_edges ? $all_edges : $edges as $edge ) {
            foreach ( array( $edge['from'], $edge['to'] ) as $key ) {
                $phases[ $key ] = array(
                    'key'         => $key,
                    'label'       => ucfirst( $key ),
                    'transitions' => $phases[ $key ]['transitions'] ?? array(),
                );
            }
        }

        foreach ( $edges as $edge ) {
            $phases[ $edge['from'] ]['transitions'][] = array( 'to' => $edge['to'], 'label' => 'Advance' );
        }

        return array_values( $phases );
    }

    /**
     * A matched pair — one slot, one gate pointing at it — passes, in both the
     * object and the shorthand string form.
     */
    public function test_validate_assignment_keys_accepts_matched_pair(): void
    {
        $this->stub_real_sanitize_key();

        $statuses = array(
            array(
                'key'         => 'draft',
                'transitions' => array(
                    array( 'to' => 'review', 'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ) ) ),
                ),
            ),
            array(
                'key'         => 'review',
                'transitions' => array(
                    array( 'to' => 'published', 'requires_assignment' => array( 'meta_key' => 'legal_reviewer', 'match' => 'current_user' ) ),
                    array( 'to' => 'draft', 'requires_assignment' => 'legal_reviewer' ),
                ),
            ),
        );

        $this->assertTrue( $this->controller->validate_assignment_keys( $statuses ) );
    }

}
