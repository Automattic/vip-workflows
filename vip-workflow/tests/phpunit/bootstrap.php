<?php
/**
 * PHPUnit bootstrap file.
 *
 * Conditional bootstrap following the VIP plugin testing standard:
 *
 *   - Unit suite (default): no WordPress is loaded. WordPress *functions* are
 *     mocked per-test via Brain\Monkey (see tests/phpunit/Unit/TestCase.php).
 *     A few tiny, behavior-free WP class doubles (WP_Error, WP_Post,
 *     WP_REST_Controller, WP_REST_Response) and the php-ai-client test double
 *     are loaded here for the unit suite only.
 *   - Integration suite (`--testsuite integration`): real WordPress is booted
 *     via yoast/wp-test-utils, so the real WP classes — including WordPress 7.0
 *     core's bundled `WordPress\AiClient\AiClient` — are present. We must NOT
 *     pre-define any of those classes here, or core's richer surface (e.g.
 *     AiClient::setCache()) would be shadowed and crash bootstrap.
 *
 * @package VIPWorkflow\Tests
 */

declare( strict_types=1 );

// Composer autoloader (plugin classes + dev dependencies, incl. wp-test-utils).
require_once dirname( __DIR__, 2 ) . '/vendor/autoload.php';

// Detect a request to run the integration suite, supporting both
// `--testsuite integration` and `--testsuite=integration`.
$vipwf_argv           = $GLOBALS['argv'] ?? array();
$vipwf_is_integration = false;

$vipwf_flag_index = array_search( '--testsuite', $vipwf_argv, true );
if ( false !== $vipwf_flag_index && isset( $vipwf_argv[ $vipwf_flag_index + 1 ] ) && 'integration' === $vipwf_argv[ $vipwf_flag_index + 1 ] ) {
    $vipwf_is_integration = true;
}
if ( in_array( '--testsuite=integration', $vipwf_argv, true ) ) {
    $vipwf_is_integration = true;
}

if ( $vipwf_is_integration ) {
    /*
     * Guardrail: refuse to run against a non-test database.
     *
     * The WordPress test bootstrap (bootstrap_it() below) runs the WP installer,
     * which DROPS AND RECREATES EVERY TABLE in the target DB before any test.
     * The wp-env WordPress PHPUnit config resolves the database from
     * `getenv_docker('WORDPRESS_DB_NAME', 'wordpress')`, so pointing the suite at
     * the dev `cli` container (or any env where that name is `wordpress`) would
     * silently wipe the dev site's options, API keys, and posts.
     *
     * Mirror that resolution here and abort unless the name looks like a test DB
     * (contains "test"), turning a silent data-wipe into an immediate, safe
     * error. Run the suite via `npm run test:php:integration`, which targets the
     * isolated `.wp-env.tests.json` env and the dedicated `wordpress_test` DB
     * (see docs/TESTING.md).
     */
    $vipwf_db_name = getenv( 'WORDPRESS_DB_NAME' );
    if ( false === $vipwf_db_name ) {
        $vipwf_db_name = 'wordpress'; // Mirrors wp-tests-config.php's getenv_docker default.
    }
    if ( false === stripos( (string) $vipwf_db_name, 'test' ) ) {
        fwrite(
            STDERR,
            sprintf(
                "\n[vip-workflow] Refusing to run the integration suite against database \"%s\".\n" .
                "Integration bootstrap DROPS AND RECREATES ALL TABLES. It must only run against an\n" .
                "isolated test database whose name contains \"test\". Run it with:\n" .
                "    npm run test:php:integration   (see docs/TESTING.md)\n\n",
                $vipwf_db_name
            )
        );
        exit( 1 );
    }

    /*
     * Integration: boot real WordPress.
     *
     * wp-env exposes the WordPress test suite via WP_TESTS_DIR;
     * get_path_to_wp_test_dir() resolves it (with sensible fallbacks).
     */
    require_once dirname( __DIR__, 2 ) . '/vendor/yoast/wp-test-utils/src/WPIntegration/bootstrap-functions.php';

    $vipwf_tests_dir = Yoast\WPTestUtils\WPIntegration\get_path_to_wp_test_dir();

    // Give access to tests_add_filter().
    require_once $vipwf_tests_dir . '/includes/functions.php';

    // Load the plugin into the test WordPress install.
    tests_add_filter(
        'muplugins_loaded',
        static function (): void {
            require dirname( __DIR__, 2 ) . '/vip-workflow.php';
        }
    );

    // Boot WordPress (also loads the PHPUnit Polyfills and the WP test case).
    Yoast\WPTestUtils\WPIntegration\bootstrap_it();

    /*
     * Install the plugin's custom schema into the freshly-installed test DB.
     *
     * The WordPress test installer creates only core tables, and plugin
     * activation hooks (which call Schema::install()) do NOT fire under the test
     * suite — the plugin is merely loaded on `muplugins_loaded`. Without this,
     * every integration test that touches a `wp_vip_*` table fails on a clean
     * database with "table doesn't exist". Run it once here, after WordPress is
     * fully loaded so $wpdb points at the test DB and dbDelta is available
     * (create_tables() includes wp-admin/includes/upgrade.php itself). install()
     * is idempotent and version-guarded. Default sequences are intentionally
     * NOT seeded — integration tests build their own fixtures.
     */
    ( new VIPWorkflow\Database\Schema() )->install();
} else {
    /*
     * Unit: no WordPress.
     *
     * Define ABSPATH so the plugin entrypoint's `defined('ABSPATH') || exit`
     * guard passes for the autoloader smoke test. This is a path constant, not
     * a WP class stub; it is set too late to trigger the abilities-api `files`
     * autoload (which already ran when phpunit booted its own autoloader).
     */
    if ( ! defined( 'ABSPATH' ) ) {
        define( 'ABSPATH', sys_get_temp_dir() . '/wordpress/' );
    }

    /*
     * WordPress core constant. Declared here rather than in the one test file
     * that first needed it, because a constant is process-wide and irreversible:
     * defining it at test-file scope makes its presence depend on whether that
     * file happened to be loaded, so a single-file or filtered run sees a
     * different environment than the full suite.
     */
    if ( ! defined( 'ARRAY_A' ) ) {
        define( 'ARRAY_A', 'ARRAY_A' );
    }

    /*
     * OpenAI is unconditionally keyed for the whole unit suite.
     *
     * `Credentials::api_key()` honors a `VIP_WORKFLOW_*_KEY` constant ahead of
     * any backend, and constants cannot be undefined. This one is declared here,
     * for the whole suite, instead of at the scope of whichever test file needed
     * it first — that arrangement left the constant's presence dependent on file
     * load order, so `AiAvailabilityTest` passed in the full suite and failed
     * when run as a single file.
     *
     * The consequence is deliberate and pre-existing: no unit test can model an
     * unkeyed OpenAI. Tests that need an unconfigured provider parameterize on
     * Anthropic instead (see `AiAvailabilityTest`), and the OpenAI-specific
     * consumers are covered against real WordPress in the integration suite.
     * Making this explicit here does not change what any test can express; it
     * only makes the environment identical in every execution order.
     */
    if ( ! defined( 'VIP_WORKFLOW_OPENAI_KEY' ) ) {
        define( 'VIP_WORKFLOW_OPENAI_KEY', 'test-openai-key-for-integration-tests' );
    }

    /*
     * Provide only the tiny, behavior-free WP value-object doubles that
     * pure-logic tests need at runtime (see each file header for the
     * rationale). All other WordPress functions are mocked per-test via
     * Brain\Monkey.
     */
    require_once __DIR__ . '/Unit/doubles/wp-error.php';
    require_once __DIR__ . '/Unit/doubles/wp-post.php';
    require_once __DIR__ . '/Unit/doubles/wp-query.php';
    require_once __DIR__ . '/Unit/doubles/wp-rest-controller.php';
    require_once __DIR__ . '/Unit/doubles/wp-rest-request.php';
    require_once __DIR__ . '/Unit/doubles/wp-rest-response.php';

    /*
     * Shared php-ai-client test doubles (AiClient, File DTO, OpenAiProvider).
     * The AI client is a replaced package, so the unit suite (which never boots
     * WordPress) needs a double to exercise the call sites without hitting the
     * network. This is deliberately the unit branch only: under integration,
     * WordPress 7.0 core ships its own `WordPress\AiClient\AiClient`, and
     * pre-defining the stub would shadow core's API and crash bootstrap.
     */
    require_once __DIR__ . '/stubs/ai-client.php';

    /*
     * Shared ability-tool helper functions.
     *
     * Composer autoloads `includes/` by classmap, which resolves classes only —
     * a file of plain functions is never autoloaded. In production `Plugin`
     * include_once's this file when it registers the tools; the unit suite has no
     * Plugin, so it was being pulled in by whichever test file happened to
     * require it, leaving `require_post_edit_permission()` defined or not
     * depending on execution order. Load it once here, as Plugin does, so every
     * test sees the same functions. Individual tool files stay with the tests
     * that exercise them — each requires its own, so none depends on another.
     */
    require_once dirname( __DIR__, 2 ) . '/includes/abilities/tools/helpers.php';
}
