<?php
/**
 * Admin unit tests.
 *
 * Covers the admin-menu and navigation logic that has no other coverage:
 *  - cleanup_menu() reorders the native Workflows submenu into the canonical
 *    Main -> System -> Integrations grouping.
 *  - enqueue_scripts() only loads the admin bundle on core VIP Workflow pages
 *    (the scope narrowing that stopped injecting it into third-party pages).
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Admin\Admin;

class AdminTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // cleanup_menu() removes the auto-added self-slug submenu before sorting.
        Functions\when( 'remove_submenu_page' )->justReturn( null );

        unset( $GLOBALS['submenu'] );
    }

    protected function tearDown(): void
    {
        unset( $GLOBALS['submenu'] );

        // Reset the Plugin singleton seeded by the redirect tests.
        $reflection    = new \ReflectionClass( \VIPWorkflow\Plugin::class );
        $instance_prop = $reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, null );

        parent::tearDown();
    }

    /**
     * Extract the ordered list of menu slugs after cleanup.
     *
     * @return string[]
     */
    private function ordered_slugs(): array
    {
        return array_map(
            static fn( array $item ) => $item[2],
            $GLOBALS['submenu']['vip-workflow']
        );
    }

    public function test_cleanup_menu_orders_main_then_system_then_integrations(): void
    {
        // Registered in a deliberately scrambled order.
        $GLOBALS['submenu']['vip-workflow'] = array(
            array( 'Audit Log', 'edit_others_posts', 'vip-workflow-audit-log' ),
            array( 'My Extension', 'edit_posts', 'my-plugin-page' ),
            array( 'My Dashboard', 'edit_posts', 'vip-workflow-my-dashboard' ),
            array( 'Settings', 'manage_options', 'vip-workflow-settings' ),
            array( 'Kanban', 'edit_posts', 'vip-workflow-kanban' ),
            array( 'Sequences', 'manage_options', 'vip-workflow-sequences' ),
        );

        ( new Admin() )->cleanup_menu();

        $this->assertSame(
            array(
                // Main.
                'vip-workflow-my-dashboard',
                'vip-workflow-kanban',
                // System.
                'vip-workflow-sequences',
                'vip-workflow-audit-log',
                'vip-workflow-settings',
                // Integrations (third-party).
                'my-plugin-page',
            ),
            $this->ordered_slugs()
        );
    }

    public function test_cleanup_menu_groups_unknown_pages_last_and_is_stable(): void
    {
        // Two third-party pages: neither has a weight entry, so both fall into
        // the trailing Integrations group and must keep their registration order.
        $GLOBALS['submenu']['vip-workflow'] = array(
            array( 'Settings', 'manage_options', 'vip-workflow-settings' ),
            array( 'Zeta Plugin', 'edit_posts', 'zeta-plugin' ),
            array( 'My Dashboard', 'edit_posts', 'vip-workflow-my-dashboard' ),
            array( 'Alpha Plugin', 'edit_posts', 'alpha-plugin' ),
        );

        ( new Admin() )->cleanup_menu();

        $this->assertSame(
            array(
                'vip-workflow-my-dashboard',
                'vip-workflow-settings',
                'zeta-plugin',
                'alpha-plugin',
            ),
            $this->ordered_slugs()
        );
    }

    public function test_cleanup_menu_is_a_noop_without_a_workflow_submenu(): void
    {
        // No vip-workflow submenu registered (e.g. low-capability user).
        ( new Admin() )->cleanup_menu();

        $this->assertArrayNotHasKey( 'vip-workflow', $GLOBALS['submenu'] ?? array() );
    }

    /**
     * The scope-narrowing assertion: foreign admin pages must not enqueue the
     * bundle. Covers both an unrelated core page and a third-party page that
     * lives under the Workflows menu (the documented breaking change — its hook
     * suffix does not contain "vip-workflow").
     *
     * @dataProvider foreign_hook_provider
     */
    public function test_enqueue_scripts_skips_non_workflow_pages( string $hook_suffix ): void
    {
        $enqueued = false;
        $mark     = static function () use ( &$enqueued ) {
            $enqueued = true;
        };
        Functions\when( 'wp_enqueue_script' )->alias( $mark );
        Functions\when( 'wp_enqueue_style' )->alias( $mark );

        ( new Admin() )->enqueue_scripts( $hook_suffix );

        $this->assertFalse(
            $enqueued,
            "Admin bundle should not enqueue on the '{$hook_suffix}' page."
        );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function foreign_hook_provider(): array
    {
        return array(
            'unrelated core page'              => array( 'plugins.php' ),
            'edit screen'                      => array( 'edit.php' ),
            'third-party page under Workflows' => array( 'workflows_page_my-plugin-extension' ),
        );
    }
}
