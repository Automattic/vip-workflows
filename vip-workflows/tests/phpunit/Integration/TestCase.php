<?php
/**
 * Base test case for VIP Workflows integration tests.
 *
 * Integration tests run against a real, booted WordPress install (provided by
 * wp-env / the WordPress test suite). This base extends Yoast's WPIntegration
 * TestCase, which wraps WP_UnitTestCase and exposes the PHPUnit 9.x
 * polyfilled assertion/expectation API.
 *
 * Because the parent ultimately extends WP_UnitTestCase, this suite can only
 * be run with WordPress booted — i.e. `--testsuite integration` under wp-env
 * (see the conditional bootstrap). Run it from the repo root with
 * `npm run test:php:integration`, which executes inside the isolated
 * `.wp-env.tests.json` environment (start it first with
 * `npm run wp-env:start:tests`) against a dedicated `wordpress_test` database —
 * separate from the dev `wordpress` DB, so a run never touches dev options, API
 * keys, or posts. The bootstrap DROPS AND RECREATES ALL TABLES and refuses to
 * run against any database whose name does not contain "test" (see
 * docs/TESTING.md). The in-container `composer test:integration` invokes PHPUnit
 * directly and is not meant to run on a bare host checkout.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use Yoast\WPTestUtils\WPIntegration\TestCase as WPIntegrationTestCase;

/**
 * Base integration test case (real WordPress).
 */
abstract class TestCase extends WPIntegrationTestCase
{
    /**
     * Set up, then discard state the rollback cannot reach.
     */
    public function set_up(): void
    {
        parent::set_up();

        self::reset_cached_process_state();
        self::reset_rest_server();
    }

    /**
     * Discard the REST server so `rest_api_init` re-fires for this test.
     *
     * `WP_REST_Posts_Controller::register_routes()` bakes `get_collection_params()`
     * — and therefore every `rest_{$post_type}_collection_params` filter — into the
     * route's `args` at registration time, and dispatch validates against that
     * frozen copy. The server is a process-wide singleton that `rest_get_server()`
     * builds on first use, so without this the FIRST test in the run to touch REST
     * freezes the collection args for every test after it: a later test that adds a
     * collection-params filter in its own `set_up` has already missed the window,
     * and its param silently never gets declared.
     *
     * Nulling the global is what core's own `WP_Test_REST_Controller_Testcase`
     * does, and it restores production semantics rather than simulating them: in
     * production `rest_api_init` fires once per request, after `init`, so route
     * args are always rebuilt against the current filters. It is lazy — a test that
     * never touches REST pays nothing, because `rest_get_server()` only rebuilds on
     * demand.
     *
     * Unlike the `init`-built registries deliberately left alone above, there is
     * nothing to lose here: `rest_api_init` is re-fired by the rebuild, and the
     * listeners that populate it survive in the per-test hook snapshot.
     *
     * Two test files previously carried a private copy of this; it lives here so
     * every test gets the guarantee rather than the ones that noticed they needed it.
     */
    protected static function reset_rest_server(): void
    {
        $GLOBALS['wp_rest_server'] = null;
    }

    /**
     * Clear the process-wide caches that a rolled-back transaction leaves stale.
     *
     * WP_UnitTestCase wraps each test in a transaction and rolls it back, which
     * restores the database but not PHP memory. A singleton that has already read
     * an option keeps serving the value it read inside the rolled-back
     * transaction, so a test that (say) disables an agent leaks that setting into
     * every later test. This runs centrally so no individual file has to remember.
     *
     * Deliberately narrower than the unit suite's equivalent: this clears caches
     * and re-derivable state only, and never discards a singleton whose contents
     * were built on `init`. `init` fires once, at bootstrap, for the whole
     * integration run — so dropping `Plugin`, `AbilityRegistry`,
     * `AssistantRegistry`, `DiscoveryProviderRegistry` or `SearchProviderRegistry`
     * would empty them permanently with nothing left to repopulate them. Each
     * entry below either re-reads its option or is rebuilt lazily on next use.
     */
    protected static function reset_cached_process_state(): void
    {
        // Option-backed caches; both re-read on next access.
        \VIPWorkflows\Abilities\AbilitySettings::get_instance()->clear_cache();
        \VIPWorkflows\AI\PromptSettings::get_instance()->clear_cache();

        // Re-fires `vip_workflows_register_prompts` on next access, and the real
        // listener registered during init is still attached.
        \VIPWorkflows\AI\PromptRegistry::get_instance()->reset();

        // Backend is lazily re-resolved by capability, so dropping the instance
        // costs nothing and clears any backend a test installed.
        ( new \ReflectionProperty( \VIPWorkflows\AI\Credentials::class, 'instance' ) )->setValue( null, null );

        // Once-per-request diagnostic de-duplication.
        ( new \ReflectionProperty( \VIPWorkflows\AI\AiInference::class, 'reported' ) )->setValue( null, array() );

        // Re-entrancy guard keyed by post id; a leftover key makes a later
        // transition look already in progress and silently no-op.
        ( new \ReflectionProperty( \VIPWorkflows\Workflow\StatusManager::class, 'transition_in_progress' ) )
            ->setValue( null, array() );

        // Ability id whose agent run is currently attributed.
        ( new \ReflectionProperty( \VIPWorkflows\Workflow\StageAgentRunner::class, 'acting_ability_id' ) )
            ->setValue( null, '' );
    }
}
