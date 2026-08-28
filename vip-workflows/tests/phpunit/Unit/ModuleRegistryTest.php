<?php
/**
 * Module registry unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\ModuleInterface;

/**
 * Tests for Plugin::register_module() and ModuleInterface contract.
 */
class ModuleRegistryTest extends TestCase
{

    /**
     * @var \VIPWorkflows\Plugin
     */
    private $plugin;

    protected function setUp(): void
    {
        parent::setUp();

        // Get a fresh Plugin instance via reflection (bypasses singleton).
        $reflection = new \ReflectionClass( \VIPWorkflows\Plugin::class );
        $this->plugin = $reflection->newInstanceWithoutConstructor();

        // Initialize the modules array via reflection.
        $modules_prop = $reflection->getProperty( 'modules' );
        $modules_prop->setValue( $this->plugin, array() );
    }

    public function test_register_module_stores_by_id(): void
    {
        $module = $this->create_mock_module( 'test-module' );

        $this->plugin->register_module( $module );

        $this->assertSame( $module, $this->plugin->get_module( 'test-module' ) );
    }

    public function test_get_module_returns_null_for_unknown_id(): void
    {
        $this->assertNull( $this->plugin->get_module( 'nonexistent' ) );
    }

    public function test_duplicate_id_overwrites_previous(): void
    {
        $first  = $this->create_mock_module( 'duplicate' );
        $second = $this->create_mock_module( 'duplicate' );

        $this->plugin->register_module( $first );
        $this->plugin->register_module( $second );

        $this->assertSame( $second, $this->plugin->get_module( 'duplicate' ) );
    }

    public function test_multiple_modules_coexist(): void
    {
        $alpha = $this->create_mock_module( 'alpha' );
        $beta  = $this->create_mock_module( 'beta' );

        $this->plugin->register_module( $alpha );
        $this->plugin->register_module( $beta );

        $this->assertSame( $alpha, $this->plugin->get_module( 'alpha' ) );
        $this->assertSame( $beta, $this->plugin->get_module( 'beta' ) );
    }

    /**
     * Create a mock module with a given ID.
     *
     * @param string $id Module identifier.
     * @return ModuleInterface
     */
    private function create_mock_module( string $id ): ModuleInterface
    {
        $module = \Mockery::mock( ModuleInterface::class );
        $module->shouldReceive( 'get_id' )->andReturn( $id );
        $module->shouldReceive( 'init' );

        return $module;
    }
}
