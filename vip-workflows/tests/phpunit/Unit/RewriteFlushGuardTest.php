<?php
/**
 * Rewrite-flush gating guard.
 *
 * The Integration Contract forbids flush_rewrite_rules() on VIP (rewrite rules
 * are managed at the platform level). These tests pin the activate/deactivate
 * guard. deactivate() is targeted because it isolates the flush call; activate()
 * additionally runs schema + seeder work that would need a full DB stand-up.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

use PHPUnit\Framework\TestCase;

class RewriteFlushGuardTest extends TestCase
{
    private const PLUGIN_FILE = __DIR__ . '/../../../vip-workflows.php';

    /**
     * On VIP the flush must be skipped.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_deactivate_skips_flush_on_vip(): void
    {
        define( 'WPCOM_IS_VIP_ENV', true );
        $this->boot_plugin_with_flush_spy();

        \VIPWorkflow\deactivate();

        $this->assertSame( 0, $GLOBALS['__vw_flush_calls'], 'flush_rewrite_rules() must not run on VIP.' );
    }

    /**
     * Off VIP the flush must still run exactly once.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_deactivate_runs_flush_off_vip(): void
    {
        // WPCOM_IS_VIP_ENV intentionally left undefined to model a non-VIP host.
        $this->boot_plugin_with_flush_spy();

        \VIPWorkflow\deactivate();

        $this->assertSame( 1, $GLOBALS['__vw_flush_calls'], 'flush_rewrite_rules() must run when not on VIP.' );
    }

    /**
     * A falsy WPCOM_IS_VIP_ENV is treated as non-VIP and still flushes.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_deactivate_runs_flush_when_vip_env_falsy(): void
    {
        define( 'WPCOM_IS_VIP_ENV', false );
        $this->boot_plugin_with_flush_spy();

        \VIPWorkflow\deactivate();

        $this->assertSame( 1, $GLOBALS['__vw_flush_calls'], 'A falsy WPCOM_IS_VIP_ENV must not suppress the flush.' );
    }

    /**
     * Boot the plugin entrypoint with a flush spy and minimal WP stubs.
     * add_action is a no-op so init() never runs; ActionScheduler's API functions
     * stay undefined, so deactivate()'s as_unschedule_all_actions branch is skipped.
     */
    private function boot_plugin_with_flush_spy(): void
    {
        $GLOBALS['__vw_flush_calls'] = 0;

        if ( ! function_exists( 'flush_rewrite_rules' ) ) {
            function flush_rewrite_rules( bool $hard = true ): void {
                $GLOBALS['__vw_flush_calls'] = ( $GLOBALS['__vw_flush_calls'] ?? 0 ) + 1;
            }
        }

        if ( ! function_exists( 'add_action' ) ) {
            function add_action( string $hook_name, callable|string|array $callback, int $priority = 10, int $accepted_args = 1 ): bool {
                return true;
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
