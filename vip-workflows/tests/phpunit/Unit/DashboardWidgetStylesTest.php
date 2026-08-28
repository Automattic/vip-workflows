<?php
/**
 * Dashboard widget asset loading.
 *
 * The "My Workflow" widget renders on the wp-admin Dashboard, which loads none
 * of the plugin's built admin assets. Its styles used to be echoed as a `<style>`
 * block from the widget's own markup; now they come from a stylesheet, which is
 * only true if this screen actually enqueues it.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Admin\AdminStyles;
use VIPWorkflow\Admin\DashboardWidget;

class DashboardWidgetStylesTest extends TestCase
{
    /**
     * Arguments every wp_enqueue_style() call was made with.
     *
     * @var array<int, array>
     */
    private array $enqueued_styles = array();

    protected function set_up()
    {
        parent::set_up();

        // The stylesheet is served from the plugin directory, so the entrypoint
        // constants have to exist.
        if ( ! defined( 'VIP_WORKFLOW_PLUGIN_URL' ) ) {
            define( 'VIP_WORKFLOW_PLUGIN_URL', 'https://example.test/wp-content/plugins/vip-workflows/' );
        }
        if ( ! defined( 'VIP_WORKFLOW_VERSION' ) ) {
            define( 'VIP_WORKFLOW_VERSION', '0.0.1' );
        }

        $this->enqueued_styles = array();

        Functions\when( 'wp_enqueue_style' )->alias(
            function ( ...$args ) {
                $this->enqueued_styles[] = $args;
                return true;
            }
        );
        Functions\when( 'wp_style_add_data' )->justReturn( true );
    }

    /**
     * @param  string $hook_suffix Admin page to run the enqueue for.
     * @return array<int, string> Handles enqueued on that screen.
     */
    private function handles_enqueued_on( string $hook_suffix ): array
    {
        $this->enqueued_styles = array();

        ( new DashboardWidget() )->enqueue_assets( $hook_suffix );

        return array_column( $this->enqueued_styles, 0 );
    }

    /**
     * The enqueue is hooked at all — a stylesheet nothing asks for is the same
     * as no stylesheet.
     */
    public function test_the_enqueue_is_hooked_onto_admin_enqueue_scripts(): void
    {
        $hooks = array();

        Functions\when( 'add_action' )->alias(
            function ( $hook ) use ( &$hooks ) {
                $hooks[] = $hook;
                return true;
            }
        );

        ( new DashboardWidget() )->init();

        $this->assertContains( 'admin_enqueue_scripts', $hooks );
        // And the widget itself is still registered on the same pass.
        $this->assertContains( 'wp_dashboard_setup', $hooks );
    }

    /**
     * `index.php` is the hook suffix of every screen that runs
     * wp_dashboard_setup — site, network and user dashboards — so it is exactly
     * where the widget can render.
     */
    public function test_styles_load_on_the_dashboard(): void
    {
        $handles = $this->handles_enqueued_on( 'index.php' );

        $this->assertContains( AdminStyles::CLASSIC_HANDLE, $handles );
        // The stylesheet is all --wpds-* tokens. The build gives it PostCSS
        // fallbacks, but WP 7.0 defines no --wpds-* itself, so the real
        // definitions still have to come with it.
        $this->assertContains( AdminStyles::TOKENS_HANDLE, $handles );
    }

    /**
     * The stylesheet comes from the build like every other one here, not raw
     * from src/. The dashboard loads no bundle of ours to carry it, so it gets
     * its own CSS-only webpack entry rather than an exemption from the build.
     */
    public function test_the_stylesheet_is_served_from_the_build(): void
    {
        $this->handles_enqueued_on( 'index.php' );

        $classic = null;
        foreach ( $this->enqueued_styles as $args ) {
            if ( AdminStyles::CLASSIC_HANDLE === $args[0] ) {
                $classic = $args;
            }
        }

        $this->assertNotNull( $classic );
        $this->assertSame( VIP_WORKFLOW_PLUGIN_URL . 'build/classic-admin.css', $classic[1] );
        $this->assertSame( array( AdminStyles::TOKENS_HANDLE ), $classic[2] );
    }

    /**
     * No other screen renders the widget, so no other screen pays for it.
     */
    public function test_styles_do_not_load_elsewhere(): void
    {
        foreach ( array( 'edit.php', 'post.php', 'toplevel_page_vip-workflow', 'options-general.php' ) as $screen ) {
            $this->assertSame(
                array(),
                $this->handles_enqueued_on( $screen ),
                sprintf( 'the dashboard widget enqueued styles on %s', $screen )
            );
        }
    }
}
