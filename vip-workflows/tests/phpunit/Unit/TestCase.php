<?php
/**
 * Base test case for VIP Workflows unit tests.
 *
 * Unit tests run without WordPress. WordPress functions are mocked via
 * Brain\Monkey; this base builds on Yoast's BrainMonkey YoastTestCase, which
 * wires Monkey set-up/tear-down and Mockery integration and provides sensible
 * stubs for many common WP functions (sanitize_text_field, wp_kses_post,
 * wp_parse_args, wp_strip_all_tags, get_bloginfo, …).
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Yoast\WPTestUtils\BrainMonkey\YoastTestCase;

/**
 * Base test case with WordPress function mocking via Brain\Monkey.
 */
abstract class TestCase extends YoastTestCase
{
    /**
     * Set up test environment.
     *
     * Note: this overrides the Yoast/PHPUnit-Polyfills `set_up()` hook (not
     * `setUp()`). Tests that define `setUp()` and call `parent::setUp()` still
     * chain into this method via the polyfill.
     */
    protected function set_up()
    {
        parent::set_up();

        // Discard state the previous test left in the process before anything
        // else runs, so no test can inherit another's singletons or doubles.
        self::reset_process_state();

        // Yoast helpers: escaping (esc_html/esc_attr/esc_url/…) and i18n (__/_e/…).
        $this->stubEscapeFunctions();
        $this->stubTranslationFunctions();

        $this->setup_common_wp_functions();
    }

    /**
     * Reset every piece of state that outlives a single test.
     *
     * A PHPUnit run is one PHP process, so anything static survives from test to
     * test: production singletons, the static caches inside them, and the mutable
     * statics on the shared test doubles. Left alone, a test can pass only because
     * an earlier one seeded state it never asked for — which is why the suite used
     * to pass in its natural order and fail in others.
     *
     * This runs centrally so isolation is inherited rather than re-remembered in
     * each file's own `set_up()`. Individual tests still configure whatever they
     * need on top; they just no longer start from another test's leftovers.
     */
    protected static function reset_process_state(): void
    {
        /*
         * Production singletons.
         *
         * Nulling the instance is deliberately broader than the `reset()` /
         * `clear_cache()` helpers some of these expose: those clear a named cache,
         * whereas discarding the instance drops every property on it — including
         * ones added later, which a named-cache call would silently keep leaking.
         */
        foreach (
            array(
                \VIPWorkflows\Abilities\AbilityRegistry::class,
                \VIPWorkflows\Abilities\AbilitySettings::class,
                \VIPWorkflows\AI\AiInference::class,
                \VIPWorkflows\AI\Credentials::class,
                \VIPWorkflows\AI\PromptRegistry::class,
                \VIPWorkflows\AI\PromptSettings::class,
                \VIPWorkflows\Assistants\AssistantRegistry::class,
                \VIPWorkflows\Discovery\DiscoveryProviderRegistry::class,
                \VIPWorkflows\Ideation\Research\SearchProviders\SearchProviderRegistry::class,
                \VIPWorkflows\Plugin::class,
            ) as $class
        ) {
            ( new \ReflectionProperty( $class, 'instance' ) )->setValue( null, null );
        }

        /*
         * Pin the credential backend rather than leaving it to be detected.
         *
         * A freshly nulled `Credentials` has no backend, so the next call picks one
         * by asking `function_exists( 'wp_get_connector' )`. Under Brain\Monkey that
         * question does not have a stable answer for the whole run: mocking a
         * function defines it process-wide, so once any test has mocked
         * `wp_get_connector` — `AiAvailabilityTest` does, legitimately — every later
         * test that has not installed its own backend silently switches to the
         * Connectors one and calls a function no longer mocked for it. The failure
         * lands far from its cause, on whichever tests happen to run afterwards.
         *
         * Latent until provider resolution began deriving from credentials: before
         * that, reads went through paths that never touched a backend, so nothing
         * asked the question. It is order-dependent rather than deterministic, which
         * is precisely the shape that passes locally and fails in CI.
         *
         * Legacy is not an arbitrary choice — it is the backend detection already
         * lands on in a unit run, because WordPress is absent and the real
         * `wp_get_connector` never exists. Naming it makes the existing default
         * explicit and immune to what an earlier test happened to define. Tests
         * needing the Connectors backend install it themselves.
         */
        \VIPWorkflows\AI\Credentials::get_instance()->set_backend(
            new \VIPWorkflows\AI\LegacyCredentialBackend()
        );

        /*
         * Static state that is not held on a singleton instance, so nulling an
         * instance above would not reach it.
         */

        // Once-per-request diagnostic de-duplication; a leftover entry silences
        // the notice a later test is asserting on.
        ( new \ReflectionProperty( \VIPWorkflows\AI\AiInference::class, 'reported' ) )->setValue( null, array() );
        ( new \ReflectionProperty( \VIPWorkflows\Integrations\LlmTextGenerator::class, 'reported' ) )
            ->setValue( null, array() );
        ( new \ReflectionProperty( \VIPWorkflows\Integrations\GuidelineContextProvider::class, 'reported' ) )
            ->setValue( null, array() );

        // Ability id whose agent run is currently attributed; a leftover value
        // mis-attributes revisions in a later test.
        ( new \ReflectionProperty( \VIPWorkflows\Workflow\StageAgentRunner::class, 'acting_ability_id' ) )
            ->setValue( null, '' );

        // Re-entrancy guard keyed by post id; a leftover key makes a later
        // transition look already in progress and silently no-op.
        ( new \ReflectionProperty( \VIPWorkflows\Workflow\StatusManager::class, 'transition_in_progress' ) )
            ->setValue( null, array() );

        self::reset_test_doubles();
    }

    /**
     * Restore the shared test doubles to their declared defaults.
     *
     * These are plain classes with public statics, so a test that sets one leaves
     * it set for the rest of the process. Rather than duplicate the default values
     * here — where they would drift from the stub — read them back off the class's
     * own default property table.
     */
    private static function reset_test_doubles(): void
    {
        $ai_client = new \ReflectionClass( \WordPress\AiClient\AiClient::class );
        foreach ( $ai_client->getDefaultProperties() as $name => $default ) {
            if ( $ai_client->getProperty( $name )->isStatic() ) {
                $ai_client->getProperty( $name )->setValue( null, $default );
            }
        }

        // `$registry` is among those statics and is now null, so the next
        // defaultRegistry() call rebuilds it with the full provider map. Tests
        // that unregister a provider therefore no longer need to restore it.

        \WP_Query::$next_posts = array();
    }

    /**
     * Stub the WordPress functions not already provided by YoastTestCase.
     */
    protected function setup_common_wp_functions(): void
    {
        Functions\stubs(
            array(
                // Sanitization helpers not covered by Yoast.
                'sanitize_title'     => function ( $title ) {
                    return strtolower( str_replace( ' ', '-', $title ) );
                },
                'sanitize_key'       => function ( $key ) {
                    return strtolower( preg_replace( '/[^a-z0-9_\-]/', '', $key ) );
                },
                'sanitize_hex_color' => function ( $color ) {
                    return $color;
                },
                'absint'             => function ( $value ) {
                    return abs( (int) $value );
                },
                'wp_json_encode'     => function ( $data ) {
                    return json_encode( $data );
                },
                'current_time'       => function ( $type ) {
                    return 'mysql' === $type ? gmdate( 'Y-m-d H:i:s' ) : time();
                },
                'wp_generate_uuid4'  => function () {
                    return sprintf(
                        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                        mt_rand( 0, 0xffff ),
                        mt_rand( 0, 0xffff ),
                        mt_rand( 0, 0xffff ),
                        mt_rand( 0, 0x0fff ) | 0x4000,
                        mt_rand( 0, 0x3fff ) | 0x8000,
                        mt_rand( 0, 0xffff ),
                        mt_rand( 0, 0xffff ),
                        mt_rand( 0, 0xffff )
                    );
                },
                // Object cache — null cache so code paths fall through to the mocked DB.
                'wp_cache_get'          => false,
                'wp_cache_get_multiple' => function ( $keys ) {
                    return array_fill_keys( $keys, false );
                },
                'wp_cache_set'          => true,
                'wp_cache_set_multiple' => true,
                'wp_cache_add'          => true,
                'wp_cache_delete'       => true,
                'wp_cache_flush_group'  => true,
                // Cron teardown — no-op. Scheduling itself is stubbed per test,
                // since its return value is what the code under test branches on.
                'wp_clear_scheduled_hook' => 0,
            )
        );

        // Action/filter functions - no-op by default.
        Functions\stubs(
            array(
                'add_action'    => true,
                'add_filter'    => true,
                'do_action'     => null,
                'apply_filters' => function ( $tag, $value ) {
                    return $value;
                },
            )
        );
    }

    /**
     * Create a mock WP_Post object.
     *
     * @param array $args Post properties.
     * @return object
     */
    protected function create_mock_post( array $args = array() ): object
    {
        $defaults = array(
            'ID'            => 1,
            'post_title'    => 'Test Post',
            'post_status'   => 'draft',
            'post_type'     => 'post',
            'post_author'   => 1,
            'post_content'  => 'Test content',
            // Always present on a real WP_Post, and read by code that reverts a
            // write core already shaped for a status it is refusing.
            'post_name'     => 'test-post',
            'post_date'     => '2026-01-01 00:00:00',
            'post_date_gmt' => '2026-01-01 00:00:00',
        );

        return new \WP_Post( array_merge( $defaults, $args ) );
    }

    /**
     * Create a mock WP_User object.
     *
     * @param array $args User properties.
     * @return object
     */
    protected function create_mock_user( array $args = array() ): object
    {
        $defaults = array(
            'ID'           => 1,
            'user_login'   => 'testuser',
            'display_name' => 'Test User',
            'user_email'   => 'test@example.com',
            'roles'        => array( 'editor' ),
        );

        return (object) array_merge( $defaults, $args );
    }
}
