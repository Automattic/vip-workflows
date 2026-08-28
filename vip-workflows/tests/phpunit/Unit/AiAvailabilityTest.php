<?php
/**
 * AI generation availability tests.
 *
 * Pins the one thing this check exists to get right: it must agree with what a
 * generation call actually needs at runtime. Two conditions block generation and
 * they need different kinds and different copy — a provider the AI Client cannot
 * offer (nothing to configure) versus a provider with no credential (which has a
 * destination, resolved against the active backend) — and the order between them
 * matters, because naming a key on a site whose AI Client has no such provider
 * sends the reader to fix something that would not help.
 *
 * The credential-absent cases run against Anthropic rather than OpenAI: the unit
 * bootstrap defines `VIP_WORKFLOW_OPENAI_KEY` for the whole suite, and a constant
 * is process-global and outranks every backend, so OpenAI is unconditionally
 * keyed here and no test can model it as unkeyed. The check is
 * provider-parameterized, so the branch is the same one either way — and the
 * OpenAI-specific consumers are covered against a real WordPress in
 * tests/phpunit/Integration/AiToolAvailabilityTest.php.
 *
 * Unit rather than integration: `AiAvailability` returns value objects and never
 * touches `WP_Ability`.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\ConnectorsCredentialBackend;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\AI\LegacyCredentialBackend;
use VIPWorkflow\Abilities\AiAvailability;
use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\Destination;
use VIPWorkflow\Abilities\Requirement;
use VIPWorkflow\Abilities\RequirementGroup;
use WordPress\AiClient\AiClient;

class AiAvailabilityTest extends TestCase
{
    /**
     * Provider under test for the credential branch. See the file docblock for
     * why this is not OpenAI.
     */
    private const PROVIDER = 'anthropic';

    /**
     * Display name the check must use for that provider.
     */
    private const PROVIDER_LABEL = 'Anthropic';

    /**
     * Label an ability passes through as the requirement's source.
     */
    private const SOURCE = 'Excerpt Generator';

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

        $this->registered_providers = AiClient::defaultRegistry()->providers;

        $this->use_connectors_backend();
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
     * Install the Connectors backend plus a connector definition per service.
     */
    private function use_connectors_backend(): void
    {
        Credentials::get_instance()->set_backend( new ConnectorsCredentialBackend() );

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
    }

    /**
     * Store a key for a service, as Settings → Connectors would.
     *
     * @param string $service Logical service id.
     * @param string $key     Key value ('' to leave it unset).
     */
    private function set_key( string $service, string $key ): void
    {
        $this->options[ 'vipwf_test_key_' . $service ] = $key;
    }

    /**
     * Store the chosen model for a provider, as the settings screen would.
     *
     * @param string $provider Provider id.
     * @param string $model    Model id.
     */
    private function set_model( string $provider, string $model ): void
    {
        $map              = $this->options['vip_workflow_ai_models'] ?? array();
        $map[ $provider ] = $model;

        $this->options['vip_workflow_ai_models'] = $map;
    }

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
     * Fully configure a provider: key plus chosen model.
     *
     * @param string $provider Provider id.
     */
    private function configure( string $provider ): void
    {
        $this->set_key( $provider, 'key-' . $provider );
        $this->set_model( $provider, 'model-' . $provider );
    }

    /**
     * Drop a provider from the AI Client registry.
     *
     * Models a site whose AI Client never received the provider — the state that
     * makes a stored key unusable, because `Plugin::init_ai_client()` only
     * authenticates providers the registry has.
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
     * The single requirement of a structured result.
     *
     * @param  Availability $availability Structured result.
     * @return Requirement
     */
    private function only_requirement( Availability $availability ): Requirement
    {
        $requirements = $availability->get_requirements();
        $this->assertCount( 1, $requirements );

        return $requirements[0];
    }

    /**
     * Run the check with the source label an ability would pass.
     *
     * @param  string $provider Provider id.
     * @return bool|Availability
     */
    private function check( string $provider = self::PROVIDER )
    {
        return AiAvailability::for_provider( $provider, array( self::SOURCE ) );
    }

    /**
     * The structured result of a check that must be unmet.
     *
     * @param  string $provider Provider id.
     * @return Availability
     */
    private function unmet( string $provider = self::PROVIDER ): Availability
    {
        $availability = $this->check( $provider );

        $this->assertInstanceOf( Availability::class, $availability );
        $this->assertFalse( $availability->is_available() );

        return $availability;
    }

    /* ---------------------------------------------------------------------
     * Configured
     * ------------------------------------------------------------------ */

    public function test_registered_keyed_and_modelled_provider_returns_bare_true(): void
    {
        $this->configure( self::PROVIDER );

        $this->assertTrue(
            $this->check(),
            'A satisfied check returns bare true so no consumer has to re-derive satisfaction.'
        );
    }

    /**
     * A `wp-config.php` constant is a first-class way to supply a key, and it
     * outranks every backend — so a site configured that way must not be gated.
     */
    public function test_a_key_supplied_by_constant_counts_as_configured(): void
    {
        $this->assertTrue(
            defined( 'VIP_WORKFLOW_OPENAI_KEY' ),
            'This assertion documents the suite-wide constant the OpenAI case relies on, declared in tests/phpunit/bootstrap.php.'
        );

        $this->assertTrue( $this->check( 'openai' ) );
    }

    /* ---------------------------------------------------------------------
     * Missing credential
     * ------------------------------------------------------------------ */

    public function test_missing_key_yields_one_missing_credential_requirement(): void
    {
        $availability = $this->unmet();

        $this->assertCount( 1, $availability->get_groups() );
        $this->assertSame(
            RequirementGroup::SATISFY_ALL,
            $availability->get_groups()[0]->get_satisfy(),
            'Generation needs this one provider; an `any` group would imply a choice that does not exist.'
        );

        $requirement = $this->only_requirement( $availability );
        $this->assertSame( 'credential:' . self::PROVIDER, $requirement->get_id() );
        $this->assertSame( Requirement::KIND_MISSING_CREDENTIAL, $requirement->get_kind() );
        $this->assertSame( array( self::SOURCE ), $requirement->get_sources() );
    }

    public function test_empty_string_key_is_treated_as_missing(): void
    {
        $this->set_key( self::PROVIDER, '' );

        $this->assertInstanceOf( Availability::class, $this->check() );
    }

    public function test_missing_credential_names_the_provider_in_both_registers(): void
    {
        $requirement = $this->only_requirement( $this->unmet() );

        $this->assertStringContainsString( self::PROVIDER_LABEL, $requirement->get_admin_reason() );
        $this->assertStringContainsString( self::PROVIDER_LABEL, $requirement->get_user_message() );
    }

    /**
     * The destination has to be resolved against the active backend, not
     * hardcoded: an install with no credential screen can only be told which
     * constant to set, and an install with one must get the link.
     */
    public function test_missing_credential_destination_is_resolved_not_hardcoded(): void
    {
        $connectors = $this->only_requirement( $this->unmet() )->get_destination();

        $this->assertSame( Destination::KIND_ADMIN_URL, $connectors->get_kind() );
        $this->assertSame( 'https://example.test/wp-admin/options-connectors.php', $connectors->get_url() );

        Credentials::get_instance()->set_backend( new LegacyCredentialBackend() );

        $legacy = $this->only_requirement( $this->unmet() )->get_destination();

        $this->assertSame( Destination::KIND_NONE, $legacy->get_kind() );
        $this->assertSame( '', $legacy->get_url() );
        $this->assertStringContainsString( 'VIP_WORKFLOW_ANTHROPIC_KEY', $legacy->get_hint() );
    }

    /* ---------------------------------------------------------------------
     * Provider the AI Client cannot offer
     * ------------------------------------------------------------------ */

    public function test_unregistered_provider_yields_an_unsupported_environment_requirement(): void
    {
        $this->unregister_provider( self::PROVIDER );

        $requirement = $this->only_requirement( $this->unmet() );

        $this->assertSame( 'environment:ai-provider:' . self::PROVIDER, $requirement->get_id() );
        $this->assertSame( Requirement::KIND_UNSUPPORTED_ENVIRONMENT, $requirement->get_kind() );
        $this->assertSame( array( self::SOURCE ), $requirement->get_sources() );
        $this->assertSame(
            Destination::KIND_NONE,
            $requirement->get_destination()->get_kind(),
            'There is nothing to configure, so there is nowhere to send the reader.'
        );
    }

    /**
     * A stored key cannot rescue a provider the AI Client never received: nothing
     * authenticates it, so the key can never reach a request. Reporting the
     * credential here would send the reader to add a key that changes nothing.
     */
    public function test_unregistered_provider_outranks_a_stored_key(): void
    {
        $this->unregister_provider( self::PROVIDER );
        $this->configure( self::PROVIDER );

        $this->assertSame(
            'environment:ai-provider:' . self::PROVIDER,
            $this->only_requirement( $this->unmet() )->get_id()
        );
    }

    /**
     * The same holds for OpenAI, whose key this suite cannot remove — so it is
     * the one provider where "keyed but unregistered" is the only reachable
     * unmet state, and it must still be reported rather than passing.
     */
    public function test_an_unregistered_openai_is_unmet_despite_its_key(): void
    {
        $this->unregister_provider( 'openai' );

        $this->assertSame(
            'environment:ai-provider:openai',
            $this->only_requirement( $this->unmet( 'openai' ) )->get_id()
        );
    }

    public function test_unregistered_provider_reports_both_registers(): void
    {
        $this->unregister_provider( self::PROVIDER );

        $requirement = $this->only_requirement( $this->unmet() );

        $this->assertStringContainsString( self::PROVIDER_LABEL, $requirement->get_admin_reason() );
        $this->assertNotSame( '', $requirement->get_user_message() );
    }

    /* ---------------------------------------------------------------------
     * No model chosen
     *
     * Only checkable because the OpenAI fallback in AiInference::model() is gone.
     * While it existed, a provider with no model still generated — through OpenAI
     * — so the gate had nothing to report and the misconfiguration was invisible.
     * ------------------------------------------------------------------ */

    public function test_a_keyed_provider_with_no_model_is_unmet(): void
    {
        $this->set_key( self::PROVIDER, 'key-test' );

        $requirement = $this->only_requirement( $this->unmet() );

        $this->assertSame( 'settings:ai-model:' . self::PROVIDER, $requirement->get_id() );
        $this->assertSame( Requirement::KIND_DEPENDENCY, $requirement->get_kind() );
        $this->assertStringContainsString( self::PROVIDER_LABEL, $requirement->get_admin_reason() );
    }

    /**
     * The model is chosen on this plugin's own settings screen, so unlike the
     * unregistered-provider case there is somewhere to send the reader.
     */
    public function test_the_missing_model_requirement_links_to_the_settings_screen(): void
    {
        $this->set_key( self::PROVIDER, 'key-test' );

        $destination = $this->only_requirement( $this->unmet() )->get_destination();

        $this->assertSame( Destination::KIND_ADMIN_URL, $destination->get_kind() );
        $this->assertSame(
            'https://example.test/wp-admin/admin.php?page=vip-workflow-settings',
            $destination->get_url()
        );
    }

    /**
     * The credential is the more fundamental gap and comes first: the settings
     * screen only offers models for providers that are already keyed, so there is
     * no model to choose until the key exists.
     */
    public function test_a_missing_key_outranks_a_missing_model(): void
    {
        $this->assertSame(
            'credential:' . self::PROVIDER,
            $this->only_requirement( $this->unmet() )->get_id()
        );
    }

    /**
     * OpenAI resolves a default model, so a keyed OpenAI needs nothing further —
     * the model requirement must not fire for it.
     */
    public function test_openai_needs_no_explicitly_chosen_model(): void
    {
        $this->assertTrue( $this->check( 'openai' ) );
    }

    /* ---------------------------------------------------------------------
     * The selected provider is what gets reported
     *
     * The reported bug: an Anthropic site was told to configure OpenAI, because
     * the gate named a provider the generation path never used.
     * ------------------------------------------------------------------ */

    public function test_a_fully_configured_anthropic_site_is_available(): void
    {
        $this->select_provider( 'anthropic' );
        $this->configure( 'anthropic' );

        // OpenAI is made unusable so the result cannot be coming from it. Its key
        // is supplied by a suite-wide constant and cannot be withdrawn, so the
        // registry entry is what gets removed.
        $this->unregister_provider( 'openai' );

        $this->assertTrue(
            AiAvailability::for_selected_provider( array( self::SOURCE ) ),
            'A site generating through Anthropic must not be gated on OpenAI.'
        );
        $this->assertTrue( AiAvailability::is_configured() );
    }

    public function test_an_unconfigured_anthropic_site_never_names_openai(): void
    {
        $this->select_provider( 'anthropic' );

        $availability = AiAvailability::for_selected_provider( array( self::SOURCE ) );
        $this->assertInstanceOf( Availability::class, $availability );

        $requirement = $this->only_requirement( $availability );

        $this->assertSame( 'credential:anthropic', $requirement->get_id() );
        $this->assertStringNotContainsString( 'OpenAI', $requirement->get_admin_text() );
        $this->assertStringNotContainsString( 'OpenAI', $requirement->get_user_message() );
    }

    /* ---------------------------------------------------------------------
     * No provider resolved
     * ------------------------------------------------------------------ */

    /**
     * The unit bootstrap keys OpenAI suite-wide and a constant cannot be
     * withdrawn, so the only unresolved state expressible here is the ambiguous
     * one: a second credential alongside it, and nothing chosen. The other route
     * to '' — a site with no credential at all — needs a process without that
     * constant, and is covered in tests/phpunit/Integration.
     */
    private function key_a_second_provider(): void
    {
        $this->set_key( 'anthropic', 'sk-ant' );
    }

    public function test_two_credentials_and_no_selection_report_no_provider(): void
    {
        $this->key_a_second_provider();

        $availability = AiAvailability::for_selected_provider( array( self::SOURCE ) );
        $this->assertInstanceOf( Availability::class, $availability );

        $this->assertSame(
            'settings:ai-provider:none',
            $this->only_requirement( $availability )->get_id(),
            'A real choice between two vendors is the administrator\'s to make, not one to guess at.'
        );
    }

    public function test_the_no_provider_requirement_names_no_vendor(): void
    {
        $this->key_a_second_provider();

        $requirement = $this->only_requirement(
            AiAvailability::for_selected_provider( array( self::SOURCE ) )
        );

        foreach ( array( 'OpenAI', 'Anthropic', 'Google' ) as $vendor ) {
            $this->assertStringNotContainsString( $vendor, $requirement->get_admin_text() );
            $this->assertStringNotContainsString( $vendor, $requirement->get_user_message() );
        }
    }

    public function test_the_no_provider_requirement_carries_kind_source_and_destination(): void
    {
        $this->key_a_second_provider();

        $requirement = $this->only_requirement(
            AiAvailability::for_selected_provider( array( self::SOURCE ) )
        );

        $this->assertSame( Requirement::KIND_DEPENDENCY, $requirement->get_kind() );
        $this->assertSame( array( self::SOURCE ), $requirement->get_sources() );
        $this->assertStringContainsString(
            'page=vip-workflow-settings',
            $requirement->get_destination()->get_url(),
            'The destination must be resolved through admin_url() against this plugin\'s own settings page.'
        );
    }

    public function test_a_lone_credential_is_resolved_rather_than_reported(): void
    {
        // The reported bug's exact shape, inverted: OpenAI is the suite's lone
        // keyed provider, so an unset selection has one meaning and must be used.
        $this->set_model( 'openai', 'gpt-4o' );

        $this->assertTrue(
            AiAvailability::for_selected_provider( array( self::SOURCE ) ),
            'One credential and no selection is unambiguous; there is nothing to ask about.'
        );
    }

    public function test_is_configured_is_false_when_no_provider_resolves(): void
    {
        $this->key_a_second_provider();

        $this->assertFalse( AiAvailability::is_configured() );
    }

    /**
     * `for_provider('')` is a caller bug and must keep saying so. Only
     * `for_selected_provider()` treats '' as a site condition, and conflating the
     * two would emit `_doing_it_wrong()` at a site owner over a fixable setting.
     */
    public function test_an_explicitly_empty_provider_is_still_a_caller_bug(): void
    {
        Functions\expect( '_doing_it_wrong' )->once();

        $availability = AiAvailability::for_provider( '', array( self::SOURCE ) );

        $this->assertInstanceOf( Availability::class, $availability );
        $this->assertFalse( $availability->is_available() );
        $this->assertSame( array(), $availability->get_groups() );
    }

    public function test_the_notice_names_the_selected_provider(): void
    {
        $this->select_provider( 'anthropic' );

        $this->assertStringContainsString( 'Anthropic', AiAvailability::unconfigured_notice() );
        $this->assertStringNotContainsString( 'OpenAI', AiAvailability::unconfigured_notice() );
    }

    /**
     * The persisted line must not freeze either message register, so it carries
     * neither an admin destination nor "ask an administrator".
     */
    public function test_the_notice_is_register_neutral(): void
    {
        $notice = AiAvailability::unconfigured_notice();

        $this->assertStringNotContainsString( 'wp-admin', $notice );
        $this->assertStringNotContainsString( 'administrator', $notice );
        $this->assertStringNotContainsString( 'wp-config', $notice );
    }

    /**
     * A provider id outside Credentials::AI_PROVIDERS can reach the notice via a
     * hand-edited option, and there is no display name to print for it.
     */
    public function test_the_notice_survives_an_unmanaged_provider(): void
    {
        $this->select_provider( 'mistral' );

        $this->assertNotSame( '', AiAvailability::unconfigured_notice() );
    }

    public function test_is_configured_is_false_for_an_unconfigured_selection(): void
    {
        $this->select_provider( 'anthropic' );

        $this->assertFalse( AiAvailability::is_configured() );
    }

    /* ---------------------------------------------------------------------
     * Register hygiene
     * ------------------------------------------------------------------ */

    /**
     * @dataProvider provide_unmet_states
     *
     * @param bool $registered Whether the provider stays in the registry.
     * @param bool $keyed      Whether a key is stored.
     * @param bool $modelled   Whether a model is chosen.
     */
    public function test_the_editor_register_names_no_admin_screen( bool $registered, bool $keyed, bool $modelled ): void
    {
        if ( ! $registered ) {
            $this->unregister_provider( self::PROVIDER );
        }

        if ( $keyed ) {
            $this->set_key( self::PROVIDER, 'key-test' );
        }

        if ( $modelled ) {
            $this->set_model( self::PROVIDER, 'model-test' );
        }

        $availability = $this->unmet();
        $requirement  = $this->only_requirement( $availability );

        $this->assertNotSame(
            '',
            $requirement->get_user_message(),
            'An unmet requirement with an empty user message tells an editor nothing.'
        );
        $this->assertStringNotContainsString( '/wp-admin/', $requirement->get_user_message() );
        $this->assertStringNotContainsString( 'wp-config', $requirement->get_user_message() );

        $encoded = (string) wp_json_encode( $availability->to_array( Requirement::REGISTER_USER ) );
        $this->assertStringNotContainsString(
            'wp-admin',
            $encoded,
            'The user register must carry no admin destination anywhere in the payload.'
        );
    }

    /**
     * One entry per unmet requirement kind, plus the states that outrank them.
     *
     * The "keyed, no model" row is the one that matters most here: its
     * destination is an admin URL, so it is the only unmet state that has an
     * admin screen to leak into the editor register.
     */
    public static function provide_unmet_states(): array
    {
        return array(
            'no key'                  => array( true, false, false ),
            'keyed, no model'         => array( true, true, false ),
            'provider not registered' => array( false, false, false ),
            'fully configured but provider not registered' => array( false, true, true ),
        );
    }

    /* ---------------------------------------------------------------------
     * Caller contract
     * ------------------------------------------------------------------ */

    /**
     * A provider id this plugin does not manage has no credential to name and no
     * destination to offer, so the check reports the bug and refuses to claim
     * available — the shape a bare `false` produces.
     */
    public function test_an_unknown_provider_is_reported_and_fails_closed(): void
    {
        Functions\expect( '_doing_it_wrong' )->once();

        $availability = AiAvailability::for_provider( 'mistral', array( self::SOURCE ) );

        $this->assertInstanceOf( Availability::class, $availability );
        $this->assertFalse( $availability->is_available() );
        $this->assertSame(
            array(),
            $availability->get_groups(),
            'Nothing can be said about a provider the plugin does not manage, so no requirement is invented.'
        );
    }

    /**
     * Every provider the plugin manages must be answerable, so a caller that
     * switches provider does not silently trip the caller-bug path.
     *
     * @dataProvider provide_managed_providers
     *
     * @param string $provider Provider id from Credentials::AI_PROVIDERS.
     */
    public function test_every_managed_provider_is_answerable( string $provider ): void
    {
        Functions\expect( '_doing_it_wrong' )->never();

        $this->configure( $provider );

        $this->assertTrue( AiAvailability::for_provider( $provider, array( self::SOURCE ) ) );
    }

    public static function provide_managed_providers(): array
    {
        return array_map(
            static fn( string $provider ): array => array( $provider ),
            Credentials::AI_PROVIDERS
        );
    }
}
