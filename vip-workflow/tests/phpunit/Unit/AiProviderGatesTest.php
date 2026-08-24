<?php
/**
 * Gates that used to name OpenAI outright.
 *
 * `IdeationAnalyzer` and `MediaProcessor` both generate through `AiInference`,
 * which honors the admin-selected provider, but both refused to run unless
 * OpenAI specifically was configured — and pointed at "Settings → AI Services",
 * a screen that does not exist. These tests pin that each now reports the
 * selected provider, and that the model-not-chosen state is unmet rather than
 * available: that state only fails at runtime because the OpenAI fallback in
 * `AiInference::model()` is gone, so nothing else would catch a gate that
 * ignored it.
 *
 * Unit rather than integration: both gates return `true|WP_Error` and touch no
 * `WP_Ability`. The ability-level wiring for the stage agents is covered in
 * tests/phpunit/Integration/AiProviderGatesIntegrationTest.php.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\ConnectorsCredentialBackend;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\Ideation\Research\IdeationAnalyzer;
use VIPWorkflow\Integrations\MediaProcessor;
use WordPress\AiClient\AiClient;

class AiProviderGatesTest extends TestCase
{
    /**
     * Option store backing the Connectors backend's key lookups.
     *
     * @var array<string, string>
     */
    private array $options = array();

    /**
     * Provider map the AI Client stub started with, restored on tear down.
     *
     * @var array<string, string>
     */
    private array $registered_providers = array();

    protected function set_up()
    {
        parent::set_up();

        Functions\when( 'admin_url' )->alias(
            static fn( string $path = '' ): string => 'https://example.test/wp-admin/' . $path
        );

        Functions\when( 'get_option' )->alias(
            fn( string $name, $default = false ) => $this->options[ $name ] ?? $default
        );

        Functions\when( 'wp_get_connector' )->alias(
            static fn( string $id ): array => array(
                'authentication' => array(
                    'method'        => 'api_key',
                    'setting_name'  => 'vipwf_test_key_' . $id,
                    'env_var_name'  => '',
                    'constant_name' => '',
                ),
            )
        );

        $this->registered_providers = AiClient::defaultRegistry()->providers;

        Credentials::get_instance()->set_backend( new ConnectorsCredentialBackend() );
    }

    protected function tear_down()
    {
        AiClient::defaultRegistry()->providers = $this->registered_providers;
        Credentials::get_instance()->set_backend( null );

        parent::tear_down();
    }

    /* ---------------------------------------------------------------------
     * Fixtures
     * ------------------------------------------------------------------ */

    /**
     * Select a provider, as the settings screen would.
     *
     * @param string $provider Provider id.
     */
    private function select_provider( string $provider ): void
    {
        $this->options['vip_workflow_ai_provider'] = $provider;
    }

    /**
     * Store a key for a provider.
     *
     * @param string $provider Provider id.
     */
    private function set_key( string $provider ): void
    {
        $this->options[ 'vipwf_test_key_' . $provider ] = 'key-' . $provider;
    }

    /**
     * Store the chosen model for a provider.
     *
     * @param string $provider Provider id.
     */
    private function set_model( string $provider ): void
    {
        $map              = $this->options['vip_workflow_ai_models'] ?? array();
        $map[ $provider ] = 'model-' . $provider;

        $this->options['vip_workflow_ai_models'] = $map;
    }

    /**
     * Drop a provider from the AI Client registry, restored on tear down.
     *
     * @param string $provider Provider id to remove.
     */
    private function unregister_provider( string $provider ): void
    {
        $providers = AiClient::defaultRegistry()->providers;
        unset( $providers[ $provider ] );
        AiClient::defaultRegistry()->providers = $providers;
    }

    /**
     * Every gate under test, as a callable returning true|WP_Error.
     *
     * @return array<string, array{0:callable}>
     */
    public static function provide_gates(): array
    {
        return array(
            'ideation analyzer' => array( array( new IdeationAnalyzer(), 'check_configuration' ) ),
            'media processor'   => array( array( new MediaProcessor(), 'check_configuration' ) ),
        );
    }

    /* ---------------------------------------------------------------------
     * Configured
     * ------------------------------------------------------------------ */

    /**
     * OpenAI is the default selection and resolves a default model, so a key is
     * all it needs.
     *
     * @dataProvider provide_gates
     *
     * @param callable $gate Gate under test.
     */
    public function test_a_configured_openai_selection_passes( callable $gate ): void
    {
        $this->set_key( 'openai' );

        $this->assertTrue( call_user_func( $gate ) );
    }

    /**
     * The regression these gates caused: a site generating through Anthropic was
     * refused because OpenAI was not configured.
     *
     * @dataProvider provide_gates
     *
     * @param callable $gate Gate under test.
     */
    public function test_a_configured_anthropic_selection_passes( callable $gate ): void
    {
        $this->select_provider( 'anthropic' );
        $this->set_key( 'anthropic' );
        $this->set_model( 'anthropic' );

        // OpenAI is made unusable so a pass cannot be coming from it. Its key is
        // supplied by a suite-wide constant and cannot be withdrawn, so the
        // registry entry is what gets removed.
        $this->unregister_provider( 'openai' );

        $this->assertTrue(
            call_user_func( $gate ),
            'An Anthropic site must not be refused because OpenAI is unavailable.'
        );
    }

    /* ---------------------------------------------------------------------
     * Unmet
     * ------------------------------------------------------------------ */

    /**
     * @dataProvider provide_gates
     *
     * @param callable $gate Gate under test.
     */
    public function test_an_unconfigured_selection_names_that_provider( callable $gate ): void
    {
        $this->select_provider( 'anthropic' );

        $result = call_user_func( $gate );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertStringContainsString( 'Anthropic', $result->get_error_message() );
        $this->assertStringNotContainsString(
            'OpenAI',
            $result->get_error_message(),
            'Naming OpenAI here is the bug: this site never calls it.'
        );
    }

    /**
     * The stale destination is gone with the old copy. Nothing may point at
     * "Settings → AI Services", which does not exist.
     *
     * @dataProvider provide_gates
     *
     * @param callable $gate Gate under test.
     */
    public function test_the_error_names_no_nonexistent_screen( callable $gate ): void
    {
        $this->select_provider( 'anthropic' );

        $message = call_user_func( $gate )->get_error_message();

        $this->assertStringNotContainsString( 'AI Services', $message );
        $this->assertStringNotContainsString( 'wp-admin', $message );
    }

    /**
     * The state the removed OpenAI fallback used to hide: a keyed provider with no
     * model resolves to no model at all, so generation fails. The gate has to
     * refuse rather than report ready.
     *
     * @dataProvider provide_gates
     *
     * @param callable $gate Gate under test.
     */
    public function test_a_keyed_provider_with_no_model_is_refused( callable $gate ): void
    {
        $this->select_provider( 'anthropic' );
        $this->set_key( 'anthropic' );

        $this->assertInstanceOf(
            \WP_Error::class,
            call_user_func( $gate ),
            'AiInference::model() returns null here, so reporting ready would promise a generation that cannot run.'
        );
    }

    /**
     * Adding the model closes it — proving the previous test failed for the model
     * and not for the key.
     *
     * @dataProvider provide_gates
     *
     * @param callable $gate Gate under test.
     */
    public function test_choosing_the_model_satisfies_the_gate( callable $gate ): void
    {
        $this->select_provider( 'anthropic' );
        $this->set_key( 'anthropic' );

        $this->assertInstanceOf( \WP_Error::class, call_user_func( $gate ) );

        $this->set_model( 'anthropic' );

        $this->assertTrue( call_user_func( $gate ) );
    }
}
