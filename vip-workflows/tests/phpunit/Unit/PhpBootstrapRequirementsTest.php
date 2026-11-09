<?php
/**
 * Runtime requirement checks must protect directly loaded plugin bundles.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

use PHPUnit\Framework\TestCase;

class PhpBootstrapRequirementsTest extends TestCase {

	/**
	 * @return array<string, array{string, bool}> Runtime versions and expected bootstrap results.
	 */
	public static function php_versions(): array {
		return array(
			'unsupported PHP' => array( '8.1.99', false ),
			'minimum PHP'     => array( '8.2.0', true ),
			'platform PHP'    => array( '8.2.35', true ),
			'newer PHP'       => array( '8.3.0', true ),
		);
	}

	/**
	 * A fake Composer entrypoint records whether bootstrap reached vendor code.
	 *
	 * @dataProvider         php_versions
	 * @runInSeparateProcess
	 * @preserveGlobalState  disabled
	 *
	 * @param string $php_version Simulated runtime version in the plugin namespace.
	 * @param bool   $supported   Whether vendor code should load.
	 */
	public function test_php_requirement_is_checked_before_composer( string $php_version, bool $supported ): void {
		define( 'VIPWorkflows\PHP_VERSION', $php_version );
		$GLOBALS['vip_workflows_bootstrap_hooks'] = array();

		function add_action( string $hook, $callback, int $priority = 10, int $accepted_args = 1 ): bool {
			$GLOBALS['vip_workflows_bootstrap_hooks'][ $hook ][] = $callback;
			return true;
		}
		function plugin_dir_path( string $file ): string {
			return dirname( $file ) . '/';
		}
		function plugin_dir_url( string $file ): string {
			return 'https://example.test/plugins/vip-workflows/';
		}
		function register_activation_hook( string $file, $callback ): void {
		}
		function register_deactivation_hook( string $file, $callback ): void {
		}
		function get_bloginfo( string $show ): string {
			return '7.0';
		}

		$plugin_dir = sys_get_temp_dir() . '/vip-workflows-bootstrap-' . bin2hex( random_bytes( 8 ) );
		mkdir( $plugin_dir . '/vendor', 0777, true );
		copy( __DIR__ . '/../../../vip-workflows.php', $plugin_dir . '/vip-workflows.php' );
		copy( __DIR__ . '/../../../autoload-paths.php', $plugin_dir . '/autoload-paths.php' );
		file_put_contents( $plugin_dir . '/vendor/autoload.php', '<?php define( "VIP_WORKFLOWS_TEST_COMPOSER_LOADED", true );' );

		try {
			include $plugin_dir . '/vip-workflows.php';

			$this->assertSame( $supported, defined( 'VIP_WORKFLOWS_TEST_COMPOSER_LOADED' ) );
			$this->assertSame( $supported, isset( $GLOBALS['vip_workflows_bootstrap_hooks']['plugins_loaded'] ) );
			$this->assertSame( $supported, \VIPWorkflows\check_requirements() );
			if ( ! $supported ) {
				$this->assertContains( 'VIPWorkflows\\php_version_notice', $GLOBALS['vip_workflows_bootstrap_hooks']['admin_notices'] );
			}
		} finally {
			unlink( $plugin_dir . '/vendor/autoload.php' );
			unlink( $plugin_dir . '/autoload-paths.php' );
			unlink( $plugin_dir . '/vip-workflows.php' );
			rmdir( $plugin_dir . '/vendor' );
			rmdir( $plugin_dir );
		}
	}
}
