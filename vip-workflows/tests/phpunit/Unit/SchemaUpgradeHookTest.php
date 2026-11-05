<?php
/**
 * The automatic schema upgrade runs on every kind of request.
 *
 * Write gates refuse stored shapes that a migration removes, so the upgrade has
 * to finish before REST, cron or WP-CLI traffic reaches a sequence. It used to
 * run on `admin_init`, which only an admin screen fires.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

use PHPUnit\Framework\TestCase;

class SchemaUpgradeHookTest extends TestCase
{
    private const PLUGIN_FILE = __DIR__ . '/../../../vip-workflows.php';

    /**
     * The upgrade is hooked on `init`, early, and no longer on `admin_init`.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_upgrade_is_hooked_on_init_not_admin_init(): void
    {
        $this->boot_plugin();

        $hooks = array_filter(
            $GLOBALS['__vw_actions'],
            static fn( array $action ): bool => 'VIPWorkflows\\maybe_upgrade_schema' === $action['callback']
        );

        $this->assertSame(
            array( array( 'hook' => 'init', 'callback' => 'VIPWorkflows\\maybe_upgrade_schema', 'priority' => 1 ) ),
            array_values( $hooks )
        );
    }

    /**
     * When the schema is current, the check is one option read and nothing else.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_current_schema_costs_one_option_read(): void
    {
        $this->boot_plugin();

        $GLOBALS['__vw_option_reads'] = array();
        $GLOBALS['__vw_db_version']   = \VIPWorkflows\Database\Schema::VERSION;

        // Any database access would fail on this.
        $GLOBALS['wpdb'] = null;

        \VIPWorkflows\maybe_upgrade_schema();

        $this->assertSame( array( 'vip_workflows_db_version' ), $GLOBALS['__vw_option_reads'] );
    }

    /**
     * Boot the plugin entrypoint with a recording add_action and minimal WP stubs.
     */
    private function boot_plugin(): void
    {
        $GLOBALS['__vw_actions'] = array();

        if ( ! function_exists( 'add_action' ) ) {
            function add_action( string $hook_name, callable|string|array $callback, int $priority = 10, int $accepted_args = 1 ): bool {
                $GLOBALS['__vw_actions'][] = array(
                    'hook'     => $hook_name,
                    'callback' => $callback,
                    'priority' => $priority,
                );
                return true;
            }
        }

        if ( ! function_exists( 'get_option' ) ) {
            function get_option( string $option, mixed $default_value = false ): mixed {
                $GLOBALS['__vw_option_reads'][] = $option;
                return 'vip_workflows_db_version' === $option ? ( $GLOBALS['__vw_db_version'] ?? $default_value ) : $default_value;
            }
        }

        if ( ! function_exists( 'did_action' ) ) {
            function did_action( string $hook_name ): int {
                return 0;
            }
        }

        if ( ! function_exists( 'doing_action' ) ) {
            function doing_action( ?string $hook_name = null ): bool {
                return false;
            }
        }

        if ( ! function_exists( 'do_action' ) ) {
            function do_action( string $hook_name, mixed ...$args ): void {
            }
        }

        if ( ! function_exists( 'register_activation_hook' ) ) {
            function register_activation_hook( string $file, callable|string|array $callback ): bool {
                return true;
            }
        }

        if ( ! function_exists( 'register_deactivation_hook' ) ) {
            function register_deactivation_hook( string $file, callable|string|array $callback ): bool {
                return true;
            }
        }

        if ( ! function_exists( 'plugin_dir_path' ) ) {
            function plugin_dir_path( string $file ): string {
                return trailingslashit( dirname( $file ) );
            }
        }

        if ( ! function_exists( 'plugin_dir_url' ) ) {
            function plugin_dir_url( string $file ): string {
                return 'https://example.test/wp-content/plugins/' . basename( dirname( $file ) ) . '/';
            }
        }

        if ( ! function_exists( 'trailingslashit' ) ) {
            function trailingslashit( string $value ): string {
                return rtrim( $value, '/\\' ) . '/';
            }
        }

        require_once self::PLUGIN_FILE;
    }
}
