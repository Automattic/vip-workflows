<?php
/**
 * Runtime autoloader smoke test.
 *
 * Boots the plugin entrypoint and ensures representative classes resolve
 * through the registered autoloader on demand.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

use PHPUnit\Framework\TestCase;

class PluginAutoloaderSmokeTest extends TestCase
{
    private const PLUGIN_FILE = __DIR__ . '/../../../vip-workflows.php';

    public static function autoload_target_classes(): array
    {
        return array(
            'youtube transcript' => array( 'VIPWorkflows\\Integrations\\YouTubeTranscript' ),
            'youtube video provider' => array( 'VIPWorkflows\\Ideation\\Assistants\\YouTubeVideoProvider' ),
        );
    }

    /**
     * @dataProvider autoload_target_classes
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_plugin_bootstrap_autoloads_representative_classes( string $class_name ): void
    {
        $this->register_wordpress_path_helpers();

        require_once self::PLUGIN_FILE;

        \VIPWorkflows\autoloader( $class_name );

        $this->assertTrue(
            class_exists( $class_name, false ),
            sprintf( 'Expected plugin bootstrap autoloader to load %s.', $class_name )
        );
    }

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
