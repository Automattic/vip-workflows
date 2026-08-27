<?php
/**
 * Integration Center bundle-conformance guard.
 *
 * Locks the contract the platform wrapper depends on: the load sentinel and
 * version/path constants, idempotent double-load via the self-load guard, and
 * VIP-safe autoloader containment.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

use PHPUnit\Framework\TestCase;

class BootstrapConformanceTest extends TestCase
{
    private const PLUGIN_FILE = __DIR__ . '/../../../vip-workflow.php';

    /**
     * Every constant the Integration Center wrapper's is_loaded() / loader rely on.
     *
     * Requiring the file with no injected config constants is parse-safe.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_bootstrap_defines_all_contract_constants(): void
    {
        $this->register_wordpress_path_helpers();

        require_once self::PLUGIN_FILE;

        $this->assertTrue( defined( 'VIP_WORKFLOW_LOADED' ), 'VIP_WORKFLOW_LOADED must be defined for the wrapper is_loaded() check.' );
        $this->assertTrue( VIP_WORKFLOW_LOADED, 'VIP_WORKFLOW_LOADED must be truthy.' );

        foreach ( array( 'VIP_WORKFLOW_VERSION', 'VIP_WORKFLOW_PLUGIN_FILE', 'VIP_WORKFLOW_PLUGIN_DIR', 'VIP_WORKFLOW_PLUGIN_URL' ) as $constant ) {
            $this->assertTrue( defined( $constant ), sprintf( '%s must be defined by the plugin entrypoint.', $constant ) );
        }
    }

    /**
     * The runtime version constant and the plugin-header Version must stay in lockstep.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_version_constant_matches_header(): void
    {
        $this->register_wordpress_path_helpers();

        require_once self::PLUGIN_FILE;

        $this->assertMatchesRegularExpression( '/^\\d+\\.\\d+\\.\\d+$/', VIP_WORKFLOW_VERSION, 'VIP_WORKFLOW_VERSION should be a semantic version.' );

        $source = (string) file_get_contents( self::PLUGIN_FILE );
        $this->assertSame( 1, preg_match( '/^\s*\*\s*Version:\s*(.+)$/m', $source, $matches ), 'Plugin header must declare a Version.' );
        $this->assertSame( VIP_WORKFLOW_VERSION, trim( $matches[1] ), 'Header Version and VIP_WORKFLOW_VERSION must match.' );
    }

    /**
     * Self-load guard: when VIP_WORKFLOW_LOADED is already defined, requiring the
     * file returns before any constant block runs, so the second parse defines nothing.
     * Covers idempotent double-load.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_self_load_guard_short_circuits_second_load(): void
    {
        $this->register_wordpress_path_helpers();

        // Simulate a site copy having already loaded.
        define( 'VIP_WORKFLOW_LOADED', true );

        require_once self::PLUGIN_FILE;

        $this->assertFalse(
            defined( 'VIP_WORKFLOW_VERSION' ),
            'Self-load guard must return before the constant block, so VIP_WORKFLOW_VERSION stays undefined on the second load.'
        );
    }

    /**
     * Autoloader containment: a VIPWorkflow class mapping to a non-existent file
     * resolves to a false realpath and is skipped silently — no error, no class.
     * Covers the realpath gate, not bare file_exists.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_autoloader_skips_unresolved_class_file(): void
    {
        $this->register_wordpress_path_helpers();

        require_once self::PLUGIN_FILE;

        \VIPWorkflow\autoloader( 'VIPWorkflow\\Nonexistent\\TotallyFakeClass' );

        $this->assertFalse(
            class_exists( 'VIPWorkflow\\Nonexistent\\TotallyFakeClass', false ),
            'Autoloader must not define a class whose mapped file does not exist within includes/.'
        );
    }

    /**
     * Regression: containment gate must not break loading of a real in-tree class.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_autoloader_still_loads_in_tree_class(): void
    {
        $this->register_wordpress_path_helpers();

        require_once self::PLUGIN_FILE;

        \VIPWorkflow\autoloader( 'VIPWorkflow\\Integrations\\YouTubeTranscript' );

        $this->assertTrue(
            class_exists( 'VIPWorkflow\\Integrations\\YouTubeTranscript', false ),
            'Containment gate must still load valid classes under includes/.'
        );
    }

    /**
     * Minimal WordPress function stubs so the entrypoint parses without a full WP load.
     * Mirrors PluginAutoloaderSmokeTest; add_action is a no-op so init() never runs.
     */
    private function register_wordpress_path_helpers(): void
    {
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
    }
}
