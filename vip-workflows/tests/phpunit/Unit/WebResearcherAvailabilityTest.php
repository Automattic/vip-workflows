<?php
/**
 * Web Researcher structured availability tests.
 *
 * Two different things can leave Web Researcher unavailable, and they need
 * different copy and different kinds: no search provider registered at all (a
 * code-level gap, nothing to configure) versus the selected provider having no
 * credential (which has a destination, resolved against the active backend).
 * These tests pin both, plus the removal of the stale "Settings → Integrations"
 * instruction for a screen that never existed.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\AI\ConnectorsCredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\AI\LegacyCredentialBackend;
use VIPWorkflows\Abilities\Availability;
use VIPWorkflows\Abilities\Destination;
use VIPWorkflows\Abilities\Requirement;
use VIPWorkflows\Abilities\RequirementGroup;
use VIPWorkflows\Ideation\Assistants\WebResearcher;
use VIPWorkflows\Ideation\Research\SearchProviders\SearchProviderRegistry;
use VIPWorkflows\Ideation\Research\SearchProviders\TavilyProvider;

class WebResearcherAvailabilityTest extends TestCase
{
    /**
     * Option store backing the Connectors backend's key lookups.
     *
     * @var array<string, string>
     */
    private array $options = array();

    protected function set_up()
    {
        parent::set_up();

        Functions\when( 'admin_url' )->alias(
            static fn( string $path = '' ): string => 'https://example.test/wp-admin/' . $path
        );

        Functions\when( 'get_option' )->alias(
            fn( string $name, $default = false ) => $this->options[ $name ] ?? $default
        );

        $this->reset_registry();
        $this->use_connectors_backend();
    }

    protected function tear_down()
    {
        Credentials::get_instance()->set_backend( null );
        $this->reset_registry();

        parent::tear_down();
    }

    /* ---------------------------------------------------------------------
     * Fixtures
     * ------------------------------------------------------------------ */

    /**
     * Drop the registry singleton so each test rebuilds its provider list.
     */
    private function reset_registry(): void
    {
        $instance = new \ReflectionProperty( SearchProviderRegistry::class, 'instance' );
        $instance->setValue( null, null );
    }

    /**
     * Empty the registry's provider list to model an install with none.
     *
     * Tavily is registered in the constructor, so the only way to reach the
     * no-provider branch is to clear the list after construction.
     */
    private function empty_the_registry(): void
    {
        $providers = new \ReflectionProperty( SearchProviderRegistry::class, 'providers' );
        $providers->setValue( SearchProviderRegistry::get_instance(), array() );
    }

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
     * Answer `current_user_can()` for the reader under test.
     *
     * The provider-level copy has to differ by reader, so which register it picks
     * is only observable with the capability answer pinned.
     *
     * @param bool $can Whether the reader has the admin capability.
     */
    private function act_as_administrator( bool $can ): void
    {
        Functions\when( 'current_user_can' )->justReturn( $can );
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

    /* ---------------------------------------------------------------------
     * Satisfied cases return a bare bool
     * ------------------------------------------------------------------ */

    public function test_configured_provider_returns_bare_true(): void
    {
        $this->set_key( 'tavily', 'tvly-key' );

        $this->assertTrue( WebResearcher::check_availability() );
    }

    public function test_empty_string_key_is_treated_as_missing(): void
    {
        $this->set_key( 'tavily', '' );

        $this->assertInstanceOf( Availability::class, WebResearcher::check_availability() );
    }

    /* ---------------------------------------------------------------------
     * Missing credential
     * ------------------------------------------------------------------ */

    public function test_missing_key_yields_one_missing_credential_requirement(): void
    {
        $availability = WebResearcher::check_availability();

        $this->assertInstanceOf( Availability::class, $availability );
        $this->assertFalse( $availability->is_available() );
        $this->assertCount( 1, $availability->get_groups() );
        $this->assertSame(
            RequirementGroup::SATISFY_ALL,
            $availability->get_groups()[0]->get_satisfy(),
            'A single hard requirement is an `all` group, not an OR.'
        );

        $requirement = $this->only_requirement( $availability );
        $this->assertSame( 'credential:tavily', $requirement->get_id() );
        $this->assertSame( Requirement::KIND_MISSING_CREDENTIAL, $requirement->get_kind() );
        $this->assertSame( array( 'Web Researcher' ), $requirement->get_sources() );
    }

    public function test_connectors_backend_yields_an_admin_destination(): void
    {
        $destination = $this->only_requirement( WebResearcher::check_availability() )->get_destination();

        $this->assertSame( Destination::KIND_ADMIN_URL, $destination->get_kind() );
        $this->assertSame(
            'https://example.test/wp-admin/options-connectors.php',
            $destination->get_url()
        );
    }

    public function test_legacy_backend_names_the_constant_and_emits_no_url(): void
    {
        Credentials::get_instance()->set_backend( new LegacyCredentialBackend() );

        $availability = WebResearcher::check_availability();
        $requirement  = $this->only_requirement( $availability );

        $this->assertSame( Destination::KIND_NONE, $requirement->get_destination()->get_kind() );
        $this->assertSame( '', $requirement->get_destination()->get_url() );
        $this->assertStringContainsString(
            'VIP_WORKFLOWS_TAVILY_KEY',
            $requirement->get_destination()->get_hint()
        );

        $encoded = (string) wp_json_encode( $availability->to_array( Requirement::REGISTER_ADMIN ) );
        $this->assertStringNotContainsString(
            'http',
            $encoded,
            'A destination kind of none must carry no URL anywhere in the payload.'
        );
    }

    public function test_key_supplied_by_constant_counts_as_configured(): void
    {
        if ( ! defined( 'VIPWF_TEST_WEB_TAVILY_CONSTANT' ) ) {
            define( 'VIPWF_TEST_WEB_TAVILY_CONSTANT', 'tvly-from-constant' );
        }

        Functions\when( 'wp_get_connector' )->alias(
            static fn( string $id ): array => array(
                'authentication' => array(
                    'method'        => 'api_key',
                    'setting_name'  => 'vipwf_test_key_' . $id,
                    'env_var_name'  => '',
                    'constant_name' => 'VIPWF_TEST_WEB_TAVILY_CONSTANT',
                ),
            )
        );

        $this->assertTrue( WebResearcher::check_availability() );
    }

    public function test_user_register_never_names_an_admin_screen(): void
    {
        $encoded = (string) wp_json_encode(
            WebResearcher::check_availability()->to_array( Requirement::REGISTER_USER )
        );

        $this->assertStringNotContainsString( '/wp-admin/', $encoded );
        $this->assertStringNotContainsString( 'Connectors', $encoded );
    }

    /* ---------------------------------------------------------------------
     * No provider registered at all
     * ------------------------------------------------------------------ */

    public function test_no_registered_provider_yields_a_dependency_requirement(): void
    {
        $this->empty_the_registry();

        $availability = WebResearcher::check_availability();
        $requirement  = $this->only_requirement( $availability );

        $this->assertFalse( $availability->is_available() );
        $this->assertSame( 'dependency:search-provider', $requirement->get_id() );
        $this->assertSame( Requirement::KIND_DEPENDENCY, $requirement->get_kind() );
    }

    public function test_no_registered_provider_reads_differently_from_a_missing_key(): void
    {
        $missing_key = $this->only_requirement( WebResearcher::check_availability() );

        $this->reset_registry();
        $this->empty_the_registry();
        $no_provider = $this->only_requirement( WebResearcher::check_availability() );

        $this->assertNotSame( $missing_key->get_kind(), $no_provider->get_kind() );
        $this->assertNotSame( $missing_key->get_admin_reason(), $no_provider->get_admin_reason() );
    }

    public function test_no_registered_provider_offers_no_destination(): void
    {
        $this->empty_the_registry();

        $destination = $this->only_requirement( WebResearcher::check_availability() )->get_destination();

        $this->assertSame(
            Destination::KIND_NONE,
            $destination->get_kind(),
            'No key can fix a provider that was never registered, so there is nowhere to send the reader.'
        );
        $this->assertSame( '', $destination->get_url() );
    }

    /* ---------------------------------------------------------------------
     * Provider-level configuration copy
     * ------------------------------------------------------------------ */

    public function test_tavily_configuration_error_no_longer_names_a_nonexistent_screen(): void
    {
        $this->act_as_administrator( true );

        $error = ( new TavilyProvider() )->get_configuration_error();

        $this->assertIsString( $error );
        $this->assertStringNotContainsString( 'Settings → Integrations', $error );
    }

    public function test_tavily_configuration_error_uses_the_admin_register_for_an_administrator(): void
    {
        // get_admin_text(), not get_admin_reason(): a WP_Error message has no room
        // for a link, so it folds the destination into the sentence. The card keeps
        // them apart and renders the destination as a link instead.
        $this->act_as_administrator( true );

        $this->assertSame(
            $this->only_requirement( WebResearcher::check_availability() )->get_admin_text(),
            ( new TavilyProvider() )->get_configuration_error(),
            'One source of copy for the same gap, whichever path the reader arrives by.'
        );
    }

    public function test_tavily_configuration_error_uses_the_user_register_for_an_editor(): void
    {
        // `search()` wraps this string in a WP_Error the editor sees, and agent
        // execution only needs `edit_posts` — so the admin register's instruction
        // would name a screen (or a wp-config.php constant) the reader cannot act
        // on. Choosing the register is not optional here.
        $this->act_as_administrator( false );

        $error = ( new TavilyProvider() )->get_configuration_error();

        $this->assertSame(
            $this->only_requirement( WebResearcher::check_availability() )->get_user_message(),
            $error
        );
        $this->assertStringNotContainsString( 'wp-admin', (string) $error );
        $this->assertStringNotContainsString( 'wp-config.php', (string) $error );
    }

    public function test_tavily_configuration_error_uses_the_user_register_on_the_legacy_backend(): void
    {
        // The legacy backend's admin destination is a wp-config.php constant, which
        // is the register leak that matters most: an editor cannot edit wp-config.
        Credentials::get_instance()->set_backend( new LegacyCredentialBackend() );
        $this->act_as_administrator( false );

        $error = ( new TavilyProvider() )->get_configuration_error();

        $this->assertSame(
            $this->only_requirement( WebResearcher::check_availability() )->get_user_message(),
            $error
        );
        $this->assertStringNotContainsString( 'wp-config.php', (string) $error );
    }

    public function test_tavily_configuration_error_is_null_when_configured(): void
    {
        $this->act_as_administrator( true );
        $this->set_key( 'tavily', 'tvly-key' );

        $this->assertNull( ( new TavilyProvider() )->get_configuration_error() );
    }

    public function test_registry_no_longer_exposes_the_unused_api_shape(): void
    {
        $this->assertFalse(
            method_exists( SearchProviderRegistry::class, 'get_all_for_api' ),
            'Wiring it would imply a provider-selection UI that does not exist.'
        );
    }
}
