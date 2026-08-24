<?php
/**
 * Media Scout structured availability tests.
 *
 * Media Scout is the motivating OR case: it needs one search-backed media
 * provider, not all of them. These tests pin that the satisfied case returns a
 * bare `true` (so no partially-satisfied group ever reaches a renderer), that
 * the unmet case is a single `any` group, that generative providers never
 * satisfy it, and that a third-party provider predating the reason channel
 * still loads.
 *
 * Credential resolution runs through the real backends rather than doubles:
 * whether a destination exists at all is a property of which backend is active,
 * so swapping in the genuine classes is what exercises the branch.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\ConnectorsCredentialBackend;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\AI\LegacyCredentialBackend;
use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\Destination;
use VIPWorkflow\Abilities\Requirement;
use VIPWorkflow\Abilities\RequirementGroup;
use VIPWorkflow\Ideation\Assistants\AiImageProvider;
use VIPWorkflow\Ideation\Assistants\MediaProviderInterface;
use VIPWorkflow\Ideation\Assistants\MediaProviderRequirements;
use VIPWorkflow\Ideation\Assistants\MediaScout;
use VIPWorkflow\Ideation\Assistants\TavilyImageProvider;
use VIPWorkflow\Ideation\Assistants\TavilyVideoProvider;
use VIPWorkflow\Ideation\Assistants\YouTubeVideoProvider;

/**
 * A third-party provider written against the original interface only.
 *
 * Deliberately does NOT implement MediaProviderRequirements — it is the
 * regression guard for the public `vip_workflow_media_providers` filter.
 */
class LegacyOnlyMediaProvider implements MediaProviderInterface
{
    public function get_id(): string
    {
        return 'legacy-only';
    }

    public function get_name(): string
    {
        return 'Legacy Only';
    }

    public function is_configured(): bool
    {
        return false;
    }

    public function is_generative(): bool
    {
        return false;
    }

    public function search_media( string $query, int $max_results = 8, array $context = array() )
    {
        return array();
    }
}

class MediaScoutAvailabilityTest extends TestCase
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

        $this->use_connectors_backend();
    }

    protected function tear_down()
    {
        Credentials::get_instance()->set_backend( null );

        parent::tear_down();
    }

    /* ---------------------------------------------------------------------
     * Fixtures
     * ------------------------------------------------------------------ */

    /**
     * Install the Connectors backend and a connector definition per service.
     *
     * Keys resolve from the option store, mirroring the real env → constant →
     * option chain with the first two left empty so the test controls the answer.
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
     * Install a connector whose key comes from a constant rather than an option.
     *
     * Uses a test-only constant name so defining it cannot leak into any other
     * test's view of whether Tavily is configured.
     *
     * @param string $service  Logical service id.
     * @param string $constant Constant to read the key from.
     */
    private function use_constant_backed_connector( string $service, string $constant ): void
    {
        Credentials::get_instance()->set_backend( new ConnectorsCredentialBackend() );

        Functions\when( 'wp_get_connector' )->alias(
            static function ( string $id ) use ( $service, $constant ): array {
                return array(
                    'authentication' => array(
                        'method'        => 'api_key',
                        'setting_name'  => 'vipwf_test_key_' . $id,
                        'env_var_name'  => '',
                        'constant_name' => $id === $service ? $constant : '',
                    ),
                );
            }
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
     * Replace the provider list Media Scout sees.
     *
     * @param MediaProviderInterface[] $providers Providers to expose.
     */
    private function use_providers( array $providers ): void
    {
        Functions\when( 'apply_filters' )->alias(
            static function ( string $tag, $value ) use ( $providers ) {
                return 'vip_workflow_media_providers' === $tag ? $providers : $value;
            }
        );
    }

    /**
     * Flatten a structured result's requirement ids.
     *
     * @param  Availability $availability Structured result.
     * @return string[]
     */
    private function requirement_ids( Availability $availability ): array
    {
        return array_map(
            static fn( Requirement $requirement ): string => $requirement->get_id(),
            $availability->get_requirements()
        );
    }

    /* ---------------------------------------------------------------------
     * Satisfied cases return a bare bool
     * ------------------------------------------------------------------ */

    public function test_one_configured_provider_returns_bare_true(): void
    {
        $this->set_key( 'youtube', 'yt-key' );

        $this->assertTrue(
            MediaScout::check_availability(),
            'One satisfied member of an OR is enough, and satisfaction is settled in the callback.'
        );
    }

    public function test_configured_provider_returns_no_partially_satisfied_group(): void
    {
        $this->set_key( 'youtube', 'yt-key' );

        $this->assertNotInstanceOf(
            Availability::class,
            MediaScout::check_availability(),
            'A partially-satisfied group must never reach a consumer.'
        );
    }

    public function test_key_supplied_by_constant_counts_as_configured(): void
    {
        if ( ! defined( 'VIPWF_TEST_TAVILY_CONSTANT' ) ) {
            define( 'VIPWF_TEST_TAVILY_CONSTANT', 'tvly-from-constant' );
        }
        $this->use_constant_backed_connector( 'tavily', 'VIPWF_TEST_TAVILY_CONSTANT' );

        $this->assertTrue( MediaScout::check_availability() );
    }

    public function test_empty_string_key_is_treated_as_missing(): void
    {
        $this->set_key( 'tavily', '' );
        $this->set_key( 'youtube', '' );

        $this->assertInstanceOf( Availability::class, MediaScout::check_availability() );
    }

    /* ---------------------------------------------------------------------
     * Unmet case: one `any` group
     * ------------------------------------------------------------------ */

    public function test_no_provider_configured_yields_a_single_any_group(): void
    {
        $availability = MediaScout::check_availability();

        $this->assertInstanceOf( Availability::class, $availability );
        $this->assertFalse( $availability->is_available() );
        $this->assertCount(
            1,
            $availability->get_groups(),
            'Media Scout needs one of several providers, so it must be one group, not one per provider.'
        );
        $this->assertSame(
            RequirementGroup::SATISFY_ANY,
            $availability->get_groups()[0]->get_satisfy()
        );
    }

    public function test_unmet_group_names_every_unconfigured_provider(): void
    {
        $availability = MediaScout::check_availability();

        $this->assertSame(
            array( 'credential:tavily', 'credential:tavily', 'credential:youtube' ),
            $this->requirement_ids( $availability ),
            'Tavily images and videos share one credential, so they share one id for registry-level dedupe.'
        );
    }

    public function test_each_requirement_is_attributed_to_its_provider(): void
    {
        $availability = MediaScout::check_availability();

        $sources = array_merge(
            ...array_map(
                static fn( Requirement $requirement ): array => $requirement->get_sources(),
                $availability->get_requirements()
            )
        );

        $this->assertSame(
            array( 'Web Images (Tavily)', 'Web Videos (Tavily)', 'YouTube Videos' ),
            $sources
        );
    }

    public function test_generative_provider_alone_does_not_satisfy_media_scout(): void
    {
        $generative = new class() implements MediaProviderInterface {
            public function get_id(): string
            {
                return 'always-configured-generator';
            }
            public function get_name(): string
            {
                return 'Always Configured Generator';
            }
            public function is_configured(): bool
            {
                return true;
            }
            public function is_generative(): bool
            {
                return true;
            }
            public function search_media( string $query, int $max_results = 8, array $context = array() )
            {
                return array();
            }
        };

        $this->use_providers( array( new TavilyImageProvider(), $generative ) );

        $availability = MediaScout::check_availability();

        $this->assertInstanceOf(
            Availability::class,
            $availability,
            'Generating an image is not finding one, so a configured generator cannot satisfy Media Scout.'
        );
        $this->assertSame( array( 'credential:tavily' ), $this->requirement_ids( $availability ) );
    }

    /* ---------------------------------------------------------------------
     * Destination resolution
     * ------------------------------------------------------------------ */

    public function test_connectors_backend_yields_an_admin_destination(): void
    {
        $requirements = MediaScout::check_availability()->get_requirements();

        $this->assertSame(
            Destination::KIND_ADMIN_URL,
            $requirements[0]->get_destination()->get_kind()
        );
        $this->assertSame(
            'https://example.test/wp-admin/options-connectors.php',
            $requirements[0]->get_destination()->get_url()
        );
    }

    public function test_legacy_backend_names_the_constant_and_emits_no_url(): void
    {
        Credentials::get_instance()->set_backend( new LegacyCredentialBackend() );

        $availability = MediaScout::check_availability();
        $requirements = $availability->get_requirements();

        $this->assertSame( Destination::KIND_NONE, $requirements[0]->get_destination()->get_kind() );
        $this->assertStringContainsString(
            'VIP_WORKFLOW_TAVILY_KEY',
            $requirements[0]->get_destination()->get_hint()
        );

        $encoded = (string) wp_json_encode( $availability->to_array( Requirement::REGISTER_ADMIN ) );
        $this->assertStringNotContainsString(
            'http',
            $encoded,
            'A destination kind of none must carry no URL anywhere in the payload.'
        );
    }

    public function test_user_register_never_names_an_admin_screen(): void
    {
        $encoded = (string) wp_json_encode(
            MediaScout::check_availability()->to_array( Requirement::REGISTER_USER )
        );

        $this->assertStringNotContainsString( '/wp-admin/', $encoded );
        $this->assertStringNotContainsString( 'Connectors', $encoded );
    }

    /* ---------------------------------------------------------------------
     * Third-party providers on the original interface
     * ------------------------------------------------------------------ */

    public function test_provider_without_the_reason_channel_reports_unavailable_without_reason(): void
    {
        $this->use_providers( array( new LegacyOnlyMediaProvider() ) );

        $availability = MediaScout::check_availability();

        $this->assertInstanceOf( Availability::class, $availability );
        $this->assertFalse( $availability->is_available() );
        $this->assertSame(
            array(),
            $availability->get_groups(),
            'A provider predating the reason channel reports no reason rather than fataling.'
        );
    }

    public function test_provider_without_the_reason_channel_still_satisfies_when_configured(): void
    {
        $configured = new class() extends LegacyOnlyMediaProvider {
            public function is_configured(): bool
            {
                return true;
            }
        };

        $this->use_providers( array( $configured ) );

        $this->assertTrue( MediaScout::check_availability() );
    }

    public function test_reasoned_and_unreasoned_providers_mix_without_error(): void
    {
        $this->use_providers( array( new LegacyOnlyMediaProvider(), new YouTubeVideoProvider() ) );

        $availability = MediaScout::check_availability();

        $this->assertSame( array( 'credential:youtube' ), $this->requirement_ids( $availability ) );
    }

    /* ---------------------------------------------------------------------
     * Per-provider requirement reports
     * ------------------------------------------------------------------ */

    public function test_tavily_providers_report_the_same_requirement_id(): void
    {
        $this->assertSame(
            ( new TavilyImageProvider() )->get_unmet_requirement()->get_id(),
            ( new TavilyVideoProvider() )->get_unmet_requirement()->get_id()
        );
    }

    public function test_youtube_provider_reports_a_missing_credential(): void
    {
        $requirement = ( new YouTubeVideoProvider() )->get_unmet_requirement();

        $this->assertSame( 'credential:youtube', $requirement->get_id() );
        $this->assertSame( Requirement::KIND_MISSING_CREDENTIAL, $requirement->get_kind() );
        $this->assertStringContainsString( 'YouTube Data API', $requirement->get_admin_reason() );
    }

    public function test_ai_image_provider_reports_an_environment_gap_without_the_ai_client(): void
    {
        $provider = new class() extends AiImageProvider {
            protected function has_ai_client(): bool
            {
                return false;
            }
        };

        $requirement = $provider->get_unmet_requirement();

        $this->assertSame( Requirement::KIND_UNSUPPORTED_ENVIRONMENT, $requirement->get_kind() );
        $this->assertSame(
            Destination::KIND_NONE,
            $requirement->get_destination()->get_kind(),
            'There is nothing to configure, so there must be nowhere to send the reader.'
        );
        $this->assertSame( '', $requirement->get_destination()->get_url() );
    }

    public function test_ai_image_provider_reports_a_credential_gap_with_the_ai_client_present(): void
    {
        $requirement = ( new AiImageProvider() )->get_unmet_requirement();

        $this->assertSame( 'credential:openai', $requirement->get_id() );
        $this->assertSame( Requirement::KIND_MISSING_CREDENTIAL, $requirement->get_kind() );
    }

    public function test_ai_image_provider_implements_the_reason_channel(): void
    {
        $this->assertInstanceOf( MediaProviderRequirements::class, new AiImageProvider() );
    }
}
