<?php
/**
 * AI inference resolver tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\AiInference;
use VIPWorkflow\AI\CredentialBackend;
use VIPWorkflow\AI\Credentials;
use WordPress\AiClient\AiClient;

class AiInferenceTest extends TestCase
{
    private array $options = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->options = array();
        Functions\when( 'get_option' )->alias(
            fn( string $name, $default = false ) => $this->options[ $name ] ?? $default
        );
    }

    protected function tearDown(): void
    {
        Credentials::get_instance()->set_backend( null );
        parent::tearDown();
    }

    /**
     * Install a backend holding the given keys.
     *
     * @param array<string, string> $keys Service id => key.
     */
    private function use_backend( array $keys ): void
    {
        Credentials::get_instance()->set_backend(
            new class( $keys ) implements CredentialBackend {
                /**
                 * @param array<string, string> $keys Service id => key.
                 */
                public function __construct( private array $keys ) {}

                public function get_api_key( string $service ): string
                {
                    return $this->keys[ $service ] ?? '';
                }
            }
        );
    }

    public function test_resolves_the_only_keyed_provider_when_unconfigured(): void
    {
        // OpenAI is the suite's only keyed provider, so an unset selection means
        // it; gpt-4o is its default model, and the stub's model() echoes the id.
        $this->assertSame( 'gpt-4o', AiInference::get_instance()->model() );
    }

    public function test_returns_model_for_selected_provider(): void
    {
        $this->options['vip_workflow_ai_provider'] = 'anthropic';
        $this->options['vip_workflow_ai_models']   = array( 'anthropic' => 'claude-sonnet-4-5' );

        $this->assertSame( 'claude-sonnet-4-5', AiInference::get_instance()->model() );
    }

    public function test_reads_openai_model_from_legacy_option(): void
    {
        $this->options['vip_workflow_ai_model'] = 'gpt-4o-mini';

        $this->assertSame( 'gpt-4o-mini', AiInference::get_instance()->model() );
    }

    /* ---------------------------------------------------------------------
     * An unresolvable selection bails instead of substituting a vendor
     *
     * These replace test_falls_back_to_openai_when_provider_has_no_model().
     * That fallback was not a safety net: `Plugin::init_ai_client()` authenticates
     * every keyed provider, so on a site holding an OpenAI key it succeeded, and
     * editorial content went to a vendor the administrator had not selected.
     * ------------------------------------------------------------------ */

    /**
     * The state the availability gate reports as "no provider selected" — two
     * credentials and nothing chosen. It has to bail before the registry lookup:
     * the real `ProviderRegistry` throws on an id it does not hold rather than
     * returning null, so reaching it with '' would surface as an uncaught fatal on
     * the first generation attempt of an unconfigured site.
     */
    public function test_an_unresolved_provider_resolves_to_null(): void
    {
        Functions\when( '_doing_it_wrong' )->justReturn( null );

        $this->use_backend( array( 'anthropic' => 'sk-ant' ) );

        $this->assertSame( '', Credentials::get_instance()->provider() );
        $this->assertNull( AiInference::get_instance()->model() );
    }

    public function test_a_provider_with_no_model_resolves_to_null(): void
    {
        Functions\when( '_doing_it_wrong' )->justReturn( null );

        // google is registered in the AI Client stub but has no model configured.
        $this->options['vip_workflow_ai_provider'] = 'google';

        $this->assertNull(
            AiInference::get_instance()->model(),
            'A provider with no model must bail, not silently generate through OpenAI.'
        );
    }

    /**
     * Parameterized on a provider this plugin manages, deliberately. An id it does
     * not manage can no longer reach here at all — `Credentials::stored_provider()`
     * filters the option against `AI_PROVIDERS`, and `provider()` then resolves a
     * hand-edited 'mistral' to '' rather than handing it to the registry or
     * deriving some other vendor in its place. What still has to bail is a managed
     * provider the AI Client was never given, which is an ordinary state: this
     * plugin registers only OpenAI, and relies on core or another plugin for the
     * rest.
     */
    public function test_an_unregistered_provider_resolves_to_null(): void
    {
        Functions\when( '_doing_it_wrong' )->justReturn( null );

        $registry            = AiClient::defaultRegistry();
        $restore             = $registry->providers;
        $providers           = $registry->providers;
        unset( $providers['anthropic'] );
        $registry->providers = $providers;

        $this->options['vip_workflow_ai_provider'] = 'anthropic';
        $this->options['vip_workflow_ai_models']   = array( 'anthropic' => 'claude-sonnet-5' );

        try {
            $this->assertNull( AiInference::get_instance()->model() );
        } finally {
            $registry->providers = $restore;
        }
    }

    /**
     * The bail is reported, so a misconfiguration is not silent — but once per
     * request, because model() is called on every generation and several times
     * over one ideation run.
     */
    public function test_the_bail_is_reported_once_per_request(): void
    {
        Functions\expect( '_doing_it_wrong' )->once();

        // Unique to this test, so the once-per-request guard is not already
        // satisfied by another test in this process.
        $this->options['vip_workflow_ai_provider'] = 'anthropic';

        $inference = AiInference::get_instance();

        $this->assertNull( $inference->model() );
        $this->assertNull( $inference->model() );
        $this->assertNull( $inference->model() );
    }
}
