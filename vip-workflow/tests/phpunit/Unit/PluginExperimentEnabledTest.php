<?php
/**
 * Tests for Plugin::experiment_enabled().
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use VIPWorkflow\Plugin;
use VIPWorkflow\Experiments\ExperimentRegistry;

/**
 * Tests for the Plugin::experiment_enabled() static convenience wrapper.
 */
class PluginExperimentEnabledTest extends TestCase
{
    private \ReflectionClass $reflection;

    protected function setUp(): void
    {
        parent::setUp();
        $this->reflection = new \ReflectionClass( Plugin::class );
    }

    protected function tearDown(): void
    {
        // Reset singleton between tests to prevent order-dependent failures.
        $instance_prop = $this->reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, null );

        parent::tearDown();
    }

    public function test_returns_false_when_singleton_not_initialised(): void
    {
        $this->assertFalse( Plugin::experiment_enabled( 'ideation' ) );
    }

    public function test_returns_false_when_experiment_registry_is_null(): void
    {
        $instance = $this->reflection->newInstanceWithoutConstructor();

        $registry_prop = $this->reflection->getProperty( 'experiment_registry' );
        $registry_prop->setValue( $instance, null );

        $instance_prop = $this->reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, $instance );

        $this->assertFalse( Plugin::experiment_enabled( 'ideation' ) );
    }

    public function test_returns_false_for_unregistered_experiment(): void
    {
        $registry = \Mockery::mock( ExperimentRegistry::class );
        $registry->shouldReceive( 'is_enabled' )
                 ->with( 'unknown-experiment' )
                 ->andReturn( false );

        $this->seed_instance_with_registry( $registry );

        $this->assertFalse( Plugin::experiment_enabled( 'unknown-experiment' ) );
    }

    public function test_returns_true_for_enabled_experiment(): void
    {
        $registry = \Mockery::mock( ExperimentRegistry::class );
        $registry->shouldReceive( 'is_enabled' )
                 ->with( 'ideation' )
                 ->andReturn( true );

        $this->seed_instance_with_registry( $registry );

        $this->assertTrue( Plugin::experiment_enabled( 'ideation' ) );
    }

    public function test_returns_false_for_disabled_experiment(): void
    {
        $registry = \Mockery::mock( ExperimentRegistry::class );
        $registry->shouldReceive( 'is_enabled' )
                 ->with( 'ideation' )
                 ->andReturn( false );

        $this->seed_instance_with_registry( $registry );

        $this->assertFalse( Plugin::experiment_enabled( 'ideation' ) );
    }

    private function seed_instance_with_registry( ExperimentRegistry $registry ): void
    {
        $instance = $this->reflection->newInstanceWithoutConstructor();

        $registry_prop = $this->reflection->getProperty( 'experiment_registry' );
        $registry_prop->setValue( $instance, $registry );

        $instance_prop = $this->reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, $instance );
    }
}
