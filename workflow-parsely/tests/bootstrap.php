<?php
/**
 * Integration bootstrap for workflow-parsely.
 *
 * This plugin is a bridge, so its tests are only meaningful with all three
 * plugins loaded: wp-parsely (the capability source), vip-workflow (the
 * extension points), and workflow-parsely itself.
 *
 * vip-workflow's own bootstrap deliberately loads only vip-workflows.php, and
 * extending it to load extension plugins would couple core's test harness to
 * every extension in the monorepo. This suite exists instead, and is the
 * pattern any other `workflow-*` plugin can copy.
 *
 * Runs inside wp-env, where all three plugins are siblings under
 * wp-content/plugins. The same relative layout holds in the repo checkout, so
 * the paths below work in both places.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

// Composer autoloader (PHPUnit, wp-test-utils, polyfills).
$wfp_autoload = dirname( __DIR__ ) . '/vendor/autoload.php';

if ( ! file_exists( $wfp_autoload ) ) {
	fwrite(
		STDERR,
		"workflow-parsely: install dev dependencies first — composer install --working-dir=workflow-parsely\n"
	);
	exit( 1 );
}

require_once $wfp_autoload;

require_once dirname( __DIR__ ) . '/vendor/yoast/wp-test-utils/src/WPIntegration/bootstrap-functions.php';

$wfp_tests_dir = Yoast\WPTestUtils\WPIntegration\get_path_to_wp_test_dir();

// Gives access to tests_add_filter().
require_once $wfp_tests_dir . '/includes/functions.php';

/*
 * Plugin directory: wp-content/plugins in the container, the repo root in a
 * checkout. Both put the three plugins side by side.
 */
$wfp_plugin_dir = dirname( __DIR__, 2 );

tests_add_filter(
	'muplugins_loaded',
	static function () use ( $wfp_plugin_dir ): void {
		/*
		 * Order matters. wp-parsely first so its service classes exist, then
		 * vip-workflow so its registries and Abilities classes are defined,
		 * then this plugin, whose registrations reference both.
		 */
		$wp_parsely = $wfp_plugin_dir . '/wp-parsely/wp-parsely.php';

		if ( file_exists( $wp_parsely ) ) {
			require_once $wp_parsely;
		} else {
			/*
			 * Loudly, not silently. A bridge suite that quietly runs without
			 * the thing it bridges to would report green while proving nothing.
			 */
			fwrite(
				STDERR,
				"workflow-parsely: wp-parsely not found at {$wp_parsely}; bridge tests cannot be trusted.\n"
			);
		}

		require_once $wfp_plugin_dir . '/vip-workflows/vip-workflows.php';

		/*
		 * Shared ability-tool helpers.
		 *
		 * Composer autoloads vip-workflow's `includes/` by classmap, which
		 * resolves classes only — a file of plain functions is never picked up.
		 * In production `Plugin` include_once's this when it registers the
		 * built-in tools; under the test suite that path is not reached, and
		 * StageAgent::read_post() calls require_post_edit_permission() from it.
		 * Loaded here for the same reason vip-workflow's own bootstrap loads it.
		 */
		require_once $wfp_plugin_dir . '/vip-workflows/includes/abilities/tools/helpers.php';

		require_once dirname( __DIR__ ) . '/workflow-parsely.php';
	}
);

// Boot WordPress (also loads the PHPUnit Polyfills and the WP test case).
Yoast\WPTestUtils\WPIntegration\bootstrap_it();

/*
 * vip-workflow's custom tables. Activation hooks do not fire under the test
 * suite — plugins are merely loaded — so any bridge test touching a wp_vip_*
 * table would fail on a clean database without this. install() is idempotent
 * and version-guarded.
 */
( new VIPWorkflow\Database\Schema() )->install();
