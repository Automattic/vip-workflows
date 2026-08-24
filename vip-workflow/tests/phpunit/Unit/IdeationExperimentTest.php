<?php
/**
 * Tests for the IdeationExperiment declaration and its ExperimentRegistry gating.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Admin\IdeationAdmin;
use VIPWorkflow\Discovery\DiscoveryModule;
use VIPWorkflow\Experiments\ExperimentRegistry;
use VIPWorkflow\Experiments\IdeationExperiment;
use VIPWorkflow\Ideation\Research\IdeationPostTypes;
use VIPWorkflow\Ideation\Research\SourceProcessingJob;
use VIPWorkflow\Plugin;

/**
 * Tests for IdeationExperiment.
 */
class IdeationExperimentTest extends TestCase
{
    private IdeationExperiment $experiment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->experiment = new IdeationExperiment();
    }

    public function test_get_id_returns_ideation(): void
    {
        $this->assertSame( 'ideation', $this->experiment->get_id() );
    }

    public function test_get_modules_returns_ideation_and_discovery_modules(): void
    {
        $modules = $this->experiment->get_modules();

        $this->assertCount( 3, $modules );
        $this->assertInstanceOf( IdeationPostTypes::class, $modules[0] );
        $this->assertInstanceOf( SourceProcessingJob::class, $modules[1] );
        $this->assertInstanceOf( DiscoveryModule::class, $modules[2] );
    }

    public function test_get_admin_modules_returns_ideation_admin(): void
    {
        $modules = $this->experiment->get_admin_modules();

        $this->assertCount( 1, $modules );
        $this->assertInstanceOf( IdeationAdmin::class, $modules[0] );
    }

    public function test_modules_not_registered_when_experiment_disabled(): void
    {
        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'is_admin' )->justReturn( true );

        $plugin = $this->create_bare_plugin();

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );
        $registry->register_modules( $plugin );

        $this->assertSame( array(), $this->get_registered_module_ids( $plugin ) );
    }

    public function test_modules_registered_when_experiment_enabled(): void
    {
        Functions\when( 'get_option' )->justReturn( array( 'ideation' ) );
        Functions\when( 'is_admin' )->justReturn( false );

        $plugin = $this->create_bare_plugin();

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );
        $registry->register_modules( $plugin );

        $this->assertSame(
            array( 'ideation-post-types', 'source-processing-job', 'discovery' ),
            $this->get_registered_module_ids( $plugin )
        );
    }

    public function test_admin_module_registered_when_experiment_enabled_in_admin(): void
    {
        Functions\when( 'get_option' )->justReturn( array( 'ideation' ) );
        Functions\when( 'is_admin' )->justReturn( true );

        $plugin = $this->create_bare_plugin();

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );
        $registry->register_modules( $plugin );

        $this->assertContains( 'ideation-admin', $this->get_registered_module_ids( $plugin ) );
    }

    public function test_activate_does_not_reseed_existing_phase_sequence(): void
    {
        global $wpdb;
        $wpdb         = Mockery::mock( 'wpdb' );
        $wpdb->prefix = 'wp_';

        $wpdb->shouldReceive( 'prepare' )->andReturn( 'SQL' );
        $wpdb->shouldReceive( 'get_row' )->once()->andReturn(
            (object) array(
                'id'          => 7,
                'uuid'        => 'uuid-phase',
                'type'        => 'phase',
                'name'        => 'Content Lifecycle',
                'slug'        => 'content-lifecycle',
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => '{"phases":[]}',
                'created_by'  => 0,
                'created_at'  => '2026-01-01 00:00:00',
                'updated_at'  => '2026-01-01 00:00:00',
            )
        );
        $wpdb->shouldNotReceive( 'insert' );

        Functions\expect( 'flush_rewrite_rules' )->once();

        $this->experiment->activate();
    }

    public function test_deactivate_unschedules_source_processing_actions(): void
    {
        // Cancel by hook only — jobs carry [ project_id, source_id ] args,
        // which an empty-args + group filter would not match.
        Functions\expect( 'as_unschedule_all_actions' )
            ->once()
            ->with( 'vip_workflow_process_source' );
        Functions\expect( 'flush_rewrite_rules' )->once();

        $this->experiment->deactivate();
    }

    /**
     * Build a real Plugin instance without running its constructor or init.
     */
    private function create_bare_plugin(): Plugin
    {
        $reflection = new \ReflectionClass( Plugin::class );
        return $reflection->newInstanceWithoutConstructor();
    }

    /**
     * Read the registered module IDs off a Plugin instance.
     *
     * @return string[]
     */
    private function get_registered_module_ids( Plugin $plugin ): array
    {
        $reflection = new \ReflectionClass( Plugin::class );
        $property   = $reflection->getProperty( 'modules' );

        return array_keys( $property->getValue( $plugin ) );
    }
}
