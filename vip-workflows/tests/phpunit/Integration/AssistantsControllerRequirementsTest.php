<?php
/**
 * Requirement serialization on the Agents REST surface.
 *
 * Lives in the integration suite because everything asserted here depends on a
 * real, registered `VIPWorkflows\Abilities\Ability`: `wp_register_ability()` only
 * functions while `wp_abilities_api_init` is running and silently no-ops
 * elsewhere, so a Brain\Monkey unit test cannot produce an ability that reports
 * structured availability at all. Route dispatch through `rest_get_server()` is
 * also the only way to observe the permission gates and the 404 status.
 *
 * The assertions run against the plugin's real Web Researcher and Media Scout
 * registrations on a clean test database with no credentials configured — the
 * fresh-install state the feature exists to explain.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\AI\ConnectorsCredentialBackend;
use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\Abilities\Destination;
use VIPWorkflows\Abilities\Requirement;
use VIPWorkflows\Abilities\RequirementGroup;
use VIPWorkflows\API\AssistantsController;
use VIPWorkflows\Assistants\AssistantRegistry;
use VIPWorkflows\Discovery\DiscoveryProviderRegistry;
use VIPWorkflows\Ideation\Assistants\MediaScout;
use VIPWorkflows\Ideation\Assistants\WebResearcher;
use WP_REST_Request;
use WP_REST_Response;

/**
 * @covers \VIPWorkflows\API\AssistantsController
 * @covers \VIPWorkflows\API\AvailabilitySerializer
 */
class AssistantsControllerRequirementsTest extends TestCase
{
    /**
     * Auto-generated entry slugs carry the whole ability id, so each research
     * agent is addressable on its own. While the slug was the vendor prefix
     * alone, both of these were `vip-workflows` and the second agent could not be
     * reached at all.
     */
    private const WEB_RESEARCHER_SLUG = 'vip-workflows-web-researcher';

    private const MEDIA_SCOUT_SLUG = 'vip-workflows-media-scout';

    private const WEB_RESEARCHER_ABILITY = 'vip-workflows/web-researcher';

    /**
     * Register the two research agents and pin the credential backend.
     *
     * The plugin registers the agents only when the `ideation` experiment is
     * enabled, which it is not on a clean test database. Abilities can only be
     * registered while `wp_abilities_api_init` is running, so the hook is fired
     * again with every other listener detached — WP_UnitTestCase restores
     * `$wp_filter` afterwards. Registration is global and outlives the test,
     * hence the guard.
     *
     * The backend is pinned to Connectors so the admin register deterministically
     * carries a `/wp-admin/` destination. Without that the editor-register
     * assertions in AbilitiesControllerRegisterTest could pass vacuously on an
     * install where no destination URL exists to leak in the first place.
     */
    public function set_up(): void
    {
        parent::set_up();

        $registered = array_map(
            static function ( $ability ): string {
                return $ability->get_name();
            },
            wp_get_abilities()
        );

        remove_all_actions( 'wp_abilities_api_init' );
        add_action(
            'wp_abilities_api_init',
            static function () use ( $registered ): void {
                // `wp_get_ability()` warns on a miss, so membership is tested
                // against the registered set instead.
                if ( ! in_array( self::WEB_RESEARCHER_ABILITY, $registered, true ) ) {
                    WebResearcher::register_ability();
                }
                if ( ! in_array( 'vip-workflows/media-scout', $registered, true ) ) {
                    MediaScout::register_ability();
                }
            }
        );
        do_action( 'wp_abilities_api_init' );

        Credentials::get_instance()->set_backend( new ConnectorsCredentialBackend() );

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    public function tear_down(): void
    {
        Credentials::get_instance()->set_backend( null );

        parent::tear_down();
    }

    /**
     * Dispatch a REST request through the real server.
     *
     * @param string $method HTTP method.
     * @param string $route  Route path.
     * @param array  $body   JSON body for write requests.
     * @return WP_REST_Response
     */
    private function dispatch( string $method, string $route, array $body = array() ): WP_REST_Response
    {
        $request = new WP_REST_Request( $method, $route );

        if ( $body ) {
            $request->set_header( 'content-type', 'application/json' );
            $request->set_body( (string) wp_json_encode( $body ) );
        }

        return rest_get_server()->dispatch( $request );
    }

    /**
     * The list payload, keyed by nothing — plain list order as served.
     *
     * @return array<int, array>
     */
    private function list_entries(): array
    {
        $response = $this->dispatch( 'GET', '/vip-workflows/v1/assistants' );
        $this->assertSame( 200, $response->get_status() );

        return $response->get_data();
    }

    /**
     * The first list element carrying the given slug.
     *
     * @param string $slug Entry slug.
     * @return array
     */
    private function list_entry( string $slug ): array
    {
        foreach ( $this->list_entries() as $entry ) {
            if ( $slug === $entry['slug'] ) {
                return $entry;
            }
        }

        $this->fail( sprintf( 'No assistant entry with slug "%s" in the list response.', $slug ) );
    }

    /**
     * A credential backend that reports one service as connected.
     *
     * @param string $service Service id to report a key for.
     * @return CredentialBackend
     */
    private function backend_with_key( string $service ): CredentialBackend
    {
        return new class( $service ) implements CredentialBackend {
            public function __construct( private string $service ) {}

            public function get_api_key( string $service ): string
            {
                return $service === $this->service ? 'test-key' : '';
            }
        };
    }

    public function test_list_includes_requirements_for_an_unavailable_agent(): void
    {
        $entry = $this->list_entry( self::WEB_RESEARCHER_SLUG );

        $this->assertFalse( $entry['available'] );
        $this->assertFalse( $entry['availability']['available'] );

        $groups = $entry['availability']['groups'];
        $this->assertCount( 1, $groups );
        $this->assertSame( RequirementGroup::SATISFY_ALL, $groups[0]['satisfy'] );

        $requirement = $groups[0]['requirements'][0];
        $this->assertSame( 'credential:tavily', $requirement['id'] );
        $this->assertSame( Requirement::KIND_MISSING_CREDENTIAL, $requirement['kind'] );
        $this->assertSame( array( 'Web Researcher' ), $requirement['sources'] );
    }

    public function test_availability_is_serialized_rather_than_json_encoded_as_an_object(): void
    {
        $entry = $this->list_entry( self::WEB_RESEARCHER_SLUG );

        $this->assertIsArray(
            $entry['availability'],
            'The registry hands out an Availability object; leaking it into the response would expose private properties.'
        );
    }

    public function test_manage_options_user_receives_the_admin_register_with_a_destination(): void
    {
        $requirement = $this->list_entry( self::WEB_RESEARCHER_SLUG )['availability']['groups'][0]['requirements'][0];

        $this->assertArrayHasKey( 'reason', $requirement );
        $this->assertArrayNotHasKey( 'message', $requirement );
        $this->assertSame( Destination::KIND_ADMIN_URL, $requirement['destination']['kind'] );
        $this->assertStringContainsString( '/wp-admin/options-connectors.php', $requirement['destination']['url'] );
        $this->assertNotSame( '', $requirement['destination']['label'] );
    }

    public function test_single_item_read_matches_the_list_element(): void
    {
        $response = $this->dispatch( 'GET', '/vip-workflows/v1/assistants/' . self::WEB_RESEARCHER_SLUG );

        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( $this->list_entry( self::WEB_RESEARCHER_SLUG ), $response->get_data() );
    }

    /**
     * The re-check affordance is per-agent, so each agent must be reachable by
     * its own slug. Both research agents previously derived `vip-workflows` from
     * their shared vendor prefix, so this route could only ever return the first
     * of them and Media Scout — half the reason this feature exists — was
     * unaddressable.
     */
    public function test_each_research_agent_is_addressable_by_its_own_slug(): void
    {
        $web_researcher = $this->dispatch( 'GET', '/vip-workflows/v1/assistants/' . self::WEB_RESEARCHER_SLUG );
        $media_scout    = $this->dispatch( 'GET', '/vip-workflows/v1/assistants/' . self::MEDIA_SCOUT_SLUG );

        $this->assertSame( 200, $web_researcher->get_status() );
        $this->assertSame( 200, $media_scout->get_status() );

        $this->assertSame(
            array( 'vip-workflows/web-researcher' ),
            $web_researcher->get_data()['ability_ids']
        );
        $this->assertSame(
            array( 'vip-workflows/media-scout' ),
            $media_scout->get_data()['ability_ids'],
            'Media Scout must resolve to its own ability, not to a sibling sharing the vendor prefix.'
        );
    }

    public function test_single_item_read_reflects_a_credential_configured_after_the_list_was_fetched(): void
    {
        $before = $this->list_entry( self::WEB_RESEARCHER_SLUG );
        $this->assertFalse( $before['available'] );

        // Stand in for the user completing the Connectors round trip.
        Credentials::get_instance()->set_backend( $this->backend_with_key( 'tavily' ) );

        $after = $this->dispatch( 'GET', '/vip-workflows/v1/assistants/' . self::WEB_RESEARCHER_SLUG )->get_data();

        $this->assertTrue( $after['available'] );
        $this->assertTrue( $after['availability']['available'] );
        $this->assertSame( array(), $after['availability']['groups'] );
    }

    public function test_an_available_agent_serializes_an_empty_group_list_not_null(): void
    {
        Credentials::get_instance()->set_backend( $this->backend_with_key( 'tavily' ) );

        $entry = $this->list_entry( self::WEB_RESEARCHER_SLUG );

        $this->assertArrayHasKey( 'groups', $entry['availability'] );
        $this->assertSame( array(), $entry['availability']['groups'] );
    }

    /**
     * A registered slug is looked up by exact match, so reads must not fold case.
     *
     * The read route applied `sanitize_key` while its sibling settings route did
     * not, so a manifest declaring a mixed-case slug was writable but 404'd here.
     */
    public function test_a_mixed_case_manifest_slug_is_readable(): void
    {
        $slug = 'Test-Plugin-MixedCase';

        /*
         * Both registries are singletons that outlive the test, and a manifest
         * cannot be unregistered — so the entry is built on a throwaway provider
         * and both singletons are discarded afterwards. `maybe_init()` re-fires
         * `vip_workflows_register_assistant_meta` on the next read, so the plugin's
         * own manifests come back intact.
         */
        DiscoveryProviderRegistry::get_instance()->register(
            'test-mixedcase-provider',
            array(
                'label'     => 'Mixed Case Provider',
                'features'  => array( 'recommend' ),
                'callbacks' => array(
                    'recommend' => static function (): array {
                        return array();
                    },
                    'seed'      => static function (): array {
                        return array();
                    },
                ),
            )
        );
        AssistantRegistry::get_instance()->register(
            $slug,
            array(
                'label'          => 'Mixed Case Agent',
                'provider_slugs' => array( 'test-mixedcase-provider' ),
            )
        );

        try {
            $response = $this->dispatch( 'GET', '/vip-workflows/v1/assistants/' . $slug );

            $this->assertSame( 200, $response->get_status() );
            $this->assertSame( $slug, $response->get_data()['slug'] );
        } finally {
            $this->reset_singleton( AssistantRegistry::class );
            $this->reset_singleton( DiscoveryProviderRegistry::class );
        }
    }

    /**
     * Discard a singleton so the next `get_instance()` rebuilds it from the hooks.
     *
     * @param string $class_name Fully-qualified class name.
     */
    private function reset_singleton( string $class_name ): void
    {
        $property = new \ReflectionProperty( $class_name, 'instance' );
        $property->setValue( null, null );
    }

    public function test_single_item_read_for_an_unknown_slug_is_404(): void
    {
        $response = $this->dispatch( 'GET', '/vip-workflows/v1/assistants/no-such-agent' );

        $this->assertSame( 404, $response->get_status() );
        $this->assertSame( 'unknown_assistant', $response->get_data()['code'] );
    }

    /**
     * @dataProvider provide_assistants_routes
     *
     * @param string $method HTTP method.
     * @param string $route  Route path.
     */
    public function test_routes_reject_a_user_without_manage_options( string $method, string $route ): void
    {
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

        $response = $this->dispatch( $method, $route, 'POST' === $method ? array( 'enabled' => false ) : array() );

        $this->assertSame( 403, $response->get_status() );
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public function provide_assistants_routes(): array
    {
        return array(
            'list'        => array( 'GET', '/vip-workflows/v1/assistants' ),
            'single read' => array( 'GET', '/vip-workflows/v1/assistants/' . self::WEB_RESEARCHER_SLUG ),
            'settings'    => array( 'POST', '/vip-workflows/v1/assistants/' . self::WEB_RESEARCHER_SLUG . '/settings' ),
        );
    }

    public function test_response_validates_against_the_registered_item_schema(): void
    {
        $schema = ( new AssistantsController() )->get_public_item_schema();

        $this->assertArrayHasKey( 'availability', $schema['properties'] );

        // Collected rather than asserted per entry: how many assistants are
        // registered depends on which earlier tests registered theirs, and the
        // registry is process-wide for the whole run. Asserting inside the loop
        // made this test's assertion count a function of execution order, which
        // is the one signal that would otherwise reveal a silently skipped test.
        $invalid = array();
        foreach ( $this->list_entries() as $entry ) {
            $valid = rest_validate_value_from_schema( $entry, $schema, 'assistant' );

            if ( is_wp_error( $valid ) ) {
                $invalid[ (string) ( $entry['slug'] ?? '(no slug)' ) ] = $valid->get_error_message();
            }
        }

        $this->assertSame(
            array(),
            $invalid,
            'Every listed assistant must validate against the registered item schema.'
        );
    }

    public function test_single_item_read_validates_against_the_registered_item_schema(): void
    {
        $schema = ( new AssistantsController() )->get_public_item_schema();
        $data   = $this->dispatch( 'GET', '/vip-workflows/v1/assistants/' . self::WEB_RESEARCHER_SLUG )->get_data();

        $valid = rest_validate_value_from_schema( $data, $schema, 'assistant' );

        $this->assertNotWPError( $valid, is_wp_error( $valid ) ? $valid->get_error_message() : '' );
    }

    public function test_settings_save_returns_the_serialized_shape(): void
    {
        $response = $this->dispatch(
            'POST',
            '/vip-workflows/v1/assistants/' . self::WEB_RESEARCHER_SLUG . '/settings',
            array( 'enabled' => false )
        );

        $this->assertSame( 200, $response->get_status() );
        $this->assertIsArray( $response->get_data()['availability'] );
        $this->assertFalse( $response->get_data()['enabled'] );
    }
}
