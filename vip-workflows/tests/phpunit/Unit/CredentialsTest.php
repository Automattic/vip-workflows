<?php
/**
 * Credentials facade tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\AI\CredentialBackend;

class CredentialsTest extends TestCase
{
    private array $options = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->options = array();
        Functions\when( 'get_option' )->alias(
            fn( string $name, $default = false ) => $this->options[ $name ] ?? $default
        );

        // No `set_backend( null )` here. The base case pins one before every test;
        // handing back null would re-open the detection this file's own subject is
        // most exposed to, and detection is not stable across a Brain\Monkey run.
        // Tests below that care install their own backend explicitly.
    }

    protected function tearDown(): void
    {
        Credentials::get_instance()->set_backend( null );
        parent::tearDown();
    }

    private function fake_backend( array $keys ): CredentialBackend
    {
        return new class( $keys ) implements CredentialBackend {
            public function __construct( private array $keys ) {}
            public function get_api_key( string $service ): string
            {
                return $this->keys[ $service ] ?? '';
            }
        };
    }

    /**
     * Exercised on 'openai' deliberately.
     *
     * A `define()` here is process-wide and cannot be undone, so choosing a
     * service leaks "this service is keyed" into every later test in the run.
     * 'openai' is already constant-keyed suite-wide by the unit bootstrap, so
     * using it adds no new leakage — whereas defining, say, the Tavily constant
     * would silently make Web Researcher and Media Scout read as configured in
     * their own availability tests. The assertion below compares against the
     * constant rather than a literal for the same reason: the value is the
     * bootstrap's, not this test's.
     */
    public function test_constant_override_wins_over_backend(): void
    {
        if ( ! defined( 'VIP_WORKFLOW_OPENAI_KEY' ) ) {
            define( 'VIP_WORKFLOW_OPENAI_KEY', 'oai-from-constant' );
        }
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array( 'openai' => 'oai-from-backend' ) ) );

        $this->assertSame( VIP_WORKFLOW_OPENAI_KEY, $creds->api_key( 'openai' ) );
        $this->assertNotSame( 'oai-from-backend', $creds->api_key( 'openai' ) );
    }

    public function test_constant_name_maps_known_services(): void
    {
        $creds = Credentials::get_instance();

        $this->assertSame( 'VIP_WORKFLOW_TAVILY_KEY', $creds->constant_name( 'tavily' ) );
        $this->assertSame( 'VIP_WORKFLOW_YOUTUBE_KEY', $creds->constant_name( 'youtube' ) );
    }

    public function test_constant_name_is_empty_for_an_unknown_service(): void
    {
        $this->assertSame( '', Credentials::get_instance()->constant_name( 'no-such-service' ) );
    }

    public function test_admin_credential_ui_only_exists_on_the_connectors_backend(): void
    {
        $creds = Credentials::get_instance();

        $creds->set_backend( new \VIPWorkflow\AI\ConnectorsCredentialBackend() );
        $this->assertTrue( $creds->has_admin_credential_ui() );

        $creds->set_backend( new \VIPWorkflow\AI\LegacyCredentialBackend() );
        $this->assertFalse(
            $creds->has_admin_credential_ui(),
            'The legacy backend reads an option no UI writes, so there is nowhere to link.'
        );
    }

    public function test_admin_credential_ui_is_absent_for_a_custom_backend(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array() ) );

        $this->assertFalse( $creds->has_admin_credential_ui() );
    }

    public function test_delegates_to_backend_without_constant(): void
    {
        // 'google' has no constant defined in the test bootstrap, so the facade
        // delegates to the backend. (openai's constant is set by the bootstrap.)
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array( 'google' => 'goog-backend' ) ) );

        $this->assertSame( 'goog-backend', $creds->api_key( 'google' ) );
        $this->assertTrue( $creds->has_key( 'google' ) );
        $this->assertFalse( $creds->has_key( 'anthropic' ) );
    }

    /**
     * The unit suite keys OpenAI through a bootstrap constant and nothing else,
     * so "the only keyed provider" is necessarily OpenAI here. That the *derived*
     * provider can be a non-OpenAI vendor is what the integration suite proves,
     * where no key constant is defined — see `AiProviderGatesIntegrationTest`.
     */
    public function test_provider_resolves_to_the_only_keyed_provider_when_unset(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array() ) );

        $this->assertSame( 'openai', $creds->provider() );
    }

    public function test_provider_is_unresolved_when_two_providers_are_keyed(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array( 'anthropic' => 'sk-ant' ) ) );

        $this->assertSame(
            '',
            $creds->provider(),
            'Two credentials and no selection is a genuine choice; guessing one would send content to a vendor nobody chose.'
        );
    }

    public function test_provider_reads_option(): void
    {
        $this->options['vip_workflow_ai_provider'] = 'anthropic';
        $this->assertSame( 'anthropic', Credentials::get_instance()->provider() );
    }

    public function test_stored_provider_wins_over_the_keyed_one(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array( 'anthropic' => 'sk-ant' ) ) );
        $this->options['vip_workflow_ai_provider'] = 'anthropic';

        $this->assertSame( 'anthropic', $creds->provider() );
    }

    public function test_an_empty_stored_provider_is_treated_as_unset(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array() ) );
        $this->options['vip_workflow_ai_provider'] = '';

        $this->assertSame( 'openai', $creds->provider() );
    }

    public function test_a_non_string_stored_provider_is_unresolved(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array() ) );
        $this->options['vip_workflow_ai_provider'] = array( 'openai' );

        $this->assertSame(
            '',
            $creds->provider(),
            'A corrupted option must not be handed on to the AI Client as a provider id, nor stood in for by a derived one.'
        );
    }

    /**
     * The option is hand-editable and is handed on as a provider id. An
     * unrecognized one must not be passed on — it reaches
     * `AiAvailability::for_provider()`, which treats an unmanaged id as a caller
     * bug and reports it with `_doing_it_wrong()`, programmer-error machinery
     * pointed at a site owner over their own data.
     *
     * Nor may it derive. A site that stored `mistral` has an administrator who
     * chose something; generating through the one vendor that happens to be keyed
     * is the silent substitution this class was rewritten to remove, and it would
     * send editorial content to a vendor nobody named. Unusable and unset are
     * distinct states that happen to share a message.
     *
     * Asserted as a contrast on one site rather than as two: what makes the
     * outcomes differ is the stored value alone, so holding the credentials still
     * is what shows derivation is being withheld rather than merely unavailable.
     * The lone credential here is OpenAI's because the unit bootstrap
     * constant-keys it process-wide — see the note on `fake_backend()` — which
     * makes an empty backend the only single-provider site this suite can build.
     * That it is the former hardcoded default is incidental; the assertion is
     * about deriving at all, and `AiProviderGatesIntegrationTest` covers the
     * Anthropic-only site from the bug report.
     */
    public function test_an_unusable_stored_provider_does_not_derive_where_an_unset_one_does(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array() ) );

        unset( $this->options['vip_workflow_ai_provider'] );
        $this->assertSame(
            'openai',
            $creds->provider(),
            'Nothing stored: the lone keyed provider is the only one the site could mean.'
        );

        $this->options['vip_workflow_ai_provider'] = 'mistral';
        $this->assertSame(
            '',
            $creds->provider(),
            'Something stored but unusable: nothing may be derived on its behalf, keys notwithstanding.'
        );
        $this->assertFalse(
            $creds->has_explicit_provider(),
            'A value this plugin cannot use is not a selection.'
        );
    }

    public function test_an_unmanaged_stored_provider_is_unresolved_when_ambiguous(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array( 'anthropic' => 'sk-ant' ) ) );
        $this->options['vip_workflow_ai_provider'] = 'mistral';

        $this->assertSame( '', $creds->provider() );
    }

    public function test_provider_re_derives_when_the_backend_changes(): void
    {
        $creds = Credentials::get_instance();

        $creds->set_backend( $this->fake_backend( array() ) );
        $this->assertSame( 'openai', $creds->provider() );

        $creds->set_backend( $this->fake_backend( array( 'anthropic' => 'sk-ant' ) ) );
        $this->assertSame(
            '',
            $creds->provider(),
            'The derived provider is cached; swapping the backend must invalidate it.'
        );
    }

    public function test_has_explicit_provider_distinguishes_stored_from_derived(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array() ) );

        $this->assertSame( 'openai', $creds->provider() );
        $this->assertFalse(
            $creds->has_explicit_provider(),
            'A provider derived from a lone credential is not a saved choice.'
        );

        $this->options['vip_workflow_ai_provider'] = 'openai';
        $this->assertTrue( $creds->has_explicit_provider() );

        $this->options['vip_workflow_ai_provider'] = '';
        $this->assertFalse( $creds->has_explicit_provider() );
    }

    public function test_model_reads_dedicated_option_for_openai(): void
    {
        $this->options['vip_workflow_ai_model'] = 'gpt-4o-mini';
        $this->assertSame( 'gpt-4o-mini', Credentials::get_instance()->model() );
    }

    public function test_model_reads_per_provider_map(): void
    {
        $this->options['vip_workflow_ai_provider'] = 'anthropic';
        $this->options['vip_workflow_ai_models']   = array( 'anthropic' => 'claude-sonnet-4-5' );
        $this->assertSame( 'claude-sonnet-4-5', Credentials::get_instance()->model() );
    }

    public function test_model_falls_back_to_legacy_option(): void
    {
        $this->options['vip_workflow_api_keys'] = array( 'openai_model' => 'gpt-4-turbo' );
        $this->assertSame( 'gpt-4-turbo', Credentials::get_instance()->model() );
    }

    public function test_model_defaults_to_gpt4o_for_openai_when_unset(): void
    {
        $this->assertSame( 'gpt-4o', Credentials::get_instance()->model() );
    }

    public function test_model_empty_for_non_openai_provider_without_config(): void
    {
        $this->options['vip_workflow_ai_provider'] = 'google';
        $this->assertSame( '', Credentials::get_instance()->model() );
    }

    public function test_model_is_empty_when_no_provider_resolves(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array( 'anthropic' => 'sk-ant' ) ) );

        $this->assertSame( '', $creds->provider() );
        $this->assertSame(
            '',
            $creds->model(),
            'With no provider resolved there is no model, and OpenAI\'s default is not an answer.'
        );
    }

    public function test_available_providers_returns_registered_and_keyed(): void
    {
        // openai's key comes from the bootstrap constant; supply anthropic via
        // the backend. google has neither, so it should be excluded.
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array( 'anthropic' => 'sk-ant' ) ) );

        $available = $creds->available_providers();
        $this->assertContains( 'openai', $available );
        $this->assertContains( 'anthropic', $available );
        $this->assertNotContains( 'google', $available );
    }

    public function test_unknown_service_returns_empty(): void
    {
        $creds = Credentials::get_instance();
        $creds->set_backend( $this->fake_backend( array() ) );
        $this->assertSame( '', $creds->api_key( 'no-such-service' ) );
    }
}
