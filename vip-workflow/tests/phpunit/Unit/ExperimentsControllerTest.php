<?php
/**
 * ExperimentsController unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Mockery;
use VIPWorkflow\API\ExperimentsController;
use VIPWorkflow\Experiments\Experiment;
use VIPWorkflow\Experiments\ExperimentRegistry;
use VIPWorkflow\Plugin;

/**
 * Tests for the ExperimentsController REST API.
 */
class ExperimentsControllerTest extends TestCase
{
    private ExperimentsController $controller;

    protected function setUp(): void
    {
        parent::setUp();
        $this->controller = new ExperimentsController();
    }

    protected function tearDown(): void
    {
        // Reset the Plugin singleton between tests.
        $reflection    = new \ReflectionClass( Plugin::class );
        $instance_prop = $reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, null );

        parent::tearDown();
    }

    public function test_get_experiments_returns_registry_array(): void
    {
        $serialized = array(
            array(
                'id'          => 'ideation',
                'name'        => 'Ideation',
                'description' => 'Research and discovery.',
                'icon'        => 'lightbulb',
                'enabled'     => false,
                'available'   => true,
            ),
        );

        $registry = Mockery::mock( ExperimentRegistry::class );
        $registry->shouldReceive( 'to_array' )->andReturn( $serialized );
        $this->seed_plugin_with_registry( $registry );

        $response = $this->controller->get_experiments();

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( $serialized, $response->get_data() );
    }

    public function test_toggle_unknown_experiment_returns_404(): void
    {
        $registry = Mockery::mock( ExperimentRegistry::class );
        $registry->shouldReceive( 'get' )->with( 'nope' )->andReturn( null );
        $this->seed_plugin_with_registry( $registry );

        $request  = $this->create_mock_request( array( 'id' => 'nope', 'enabled' => true ) );
        $response = $this->controller->toggle_experiment( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_experiment_not_found', $response->get_error_code() );
        $this->assertSame( 404, $response->get_error_data()['status'] );
    }

    public function test_toggle_unavailable_experiment_returns_400(): void
    {
        $experiment = Mockery::mock( Experiment::class );
        $experiment->shouldReceive( 'is_available' )->andReturn( false );

        $registry = Mockery::mock( ExperimentRegistry::class );
        $registry->shouldReceive( 'get' )->with( 'ideation' )->andReturn( $experiment );
        $this->seed_plugin_with_registry( $registry );

        $request  = $this->create_mock_request( array( 'id' => 'ideation', 'enabled' => true ) );
        $response = $this->controller->toggle_experiment( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_experiment_unavailable', $response->get_error_code() );
        $this->assertSame( 400, $response->get_error_data()['status'] );
    }

    public function test_toggle_enables_available_experiment(): void
    {
        $experiment = Mockery::mock( Experiment::class );
        $experiment->shouldReceive( 'is_available' )->andReturn( true );

        $registry = Mockery::mock( ExperimentRegistry::class );
        $registry->shouldReceive( 'get' )->with( 'ideation' )->andReturn( $experiment );
        $registry->shouldReceive( 'enable' )->once()->with( 'ideation' )->andReturn( true );
        $registry->shouldReceive( 'to_array' )->andReturn( array() );
        $this->seed_plugin_with_registry( $registry );

        $request  = $this->create_mock_request( array( 'id' => 'ideation', 'enabled' => true ) );
        $response = $this->controller->toggle_experiment( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
    }

    public function test_toggle_disables_experiment(): void
    {
        $experiment = Mockery::mock( Experiment::class );
        $experiment->shouldReceive( 'is_available' )->andReturn( true );

        $registry = Mockery::mock( ExperimentRegistry::class );
        $registry->shouldReceive( 'get' )->with( 'ideation' )->andReturn( $experiment );
        $registry->shouldReceive( 'disable' )->once()->with( 'ideation' )->andReturn( true );
        $registry->shouldReceive( 'to_array' )->andReturn( array() );
        $this->seed_plugin_with_registry( $registry );

        $request  = $this->create_mock_request( array( 'id' => 'ideation', 'enabled' => false ) );
        $response = $this->controller->toggle_experiment( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
    }

    /**
     * Create a mock WP_REST_Request returning the given params.
     *
     * @param array $params Request parameters.
     * @return object
     */
    private function create_mock_request( array $params = array() ): object
    {
        $request = Mockery::mock( 'WP_REST_Request' );
        $request->shouldReceive( 'get_param' )
            ->andReturnUsing(
                static function ( $key ) use ( $params ) {
                    return $params[ $key ] ?? null;
                }
            );

        return $request;
    }

    /**
     * Seed the Plugin singleton with the given experiment registry.
     *
     * @param ExperimentRegistry $registry Registry (real or mock).
     */
    private function seed_plugin_with_registry( $registry ): void
    {
        $reflection = new \ReflectionClass( Plugin::class );
        $instance   = $reflection->newInstanceWithoutConstructor();

        $registry_prop = $reflection->getProperty( 'experiment_registry' );
        $registry_prop->setValue( $instance, $registry );

        $instance_prop = $reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, $instance );
    }
}
