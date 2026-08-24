<?php
/**
 * Message-register selection on the `edit_posts`-gated REST surfaces.
 *
 * The assistants routes are `manage_options`-only, so they can only ever emit
 * the admin register. `AbilitiesController::get_items_permissions_check()` and
 * `DiscoveryController::read_permissions_check()` are the only surfaces an
 * `edit_posts`-only user can reach, which makes them the only place the user
 * register is observable at all — so its assertions belong here.
 *
 * The credential backend is pinned to Connectors in `set_up` so the admin
 * register genuinely carries a `/wp-admin/` URL. Without that pin the
 * "no admin URL reaches an editor" assertion could pass vacuously on an install
 * where no such URL exists to leak.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\AI\ConnectorsCredentialBackend;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\Destination;
use VIPWorkflow\Abilities\RequirementFactory;
use VIPWorkflow\Abilities\RequirementGroup;
use VIPWorkflow\API\DiscoveryController;
use VIPWorkflow\Discovery\DiscoveryProviderRegistry;
use VIPWorkflow\Ideation\Assistants\WebResearcher;
use WP_REST_Request;

/**
 * @covers \VIPWorkflow\API\AvailabilitySerializer
 * @covers \VIPWorkflow\API\AbilitiesController
 * @covers \VIPWorkflow\API\DiscoveryController
 */
class AbilitiesControllerRegisterTest extends TestCase
{
    private const WEB_RESEARCHER_ABILITY = 'vip-workflow/web-researcher';

    private const PROVIDER_SLUG = 'register-test-provider';

    /**
     * Register the Web Researcher ability and a discovery provider with unmet
     * requirements, then pin the credential backend.
     *
     * Abilities can only be registered while `wp_abilities_api_init` is running,
     * so the hook is fired again with every other listener detached —
     * WP_UnitTestCase restores `$wp_filter` afterwards. Registration is global
     * and outlives the test, hence the guards.
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
                if ( ! in_array( self::WEB_RESEARCHER_ABILITY, $registered, true ) ) {
                    WebResearcher::register_ability();
                }
            }
        );
        do_action( 'wp_abilities_api_init' );

        // `register()` is idempotent by slug, so a second call in the same
        // process is a no-op rather than a duplicate.
        DiscoveryProviderRegistry::get_instance()->register(
            self::PROVIDER_SLUG,
            array(
                'label'                 => 'Register Test Provider',
                'description'           => 'Reports one unmet credential requirement.',
                'icon'                  => 'admin-site',
                'features'              => array( 'search' ),
                'callbacks'             => array(
                    'search'  => static function (): array {
                        return array();
                    },
                    'filters' => static function (): array {
                        return array();
                    },
                    'seed'    => static function (): string {
                        return 'seed';
                    },
                ),
                'availability_callback' => static function (): Availability {
                    return Availability::unmet(
                        RequirementGroup::all(
                            RequirementFactory::missing_credential( 'tavily', 'Tavily', array( 'Register Test Provider' ) )
                        )
                    );
                },
            )
        );

        /*
         * The discovery routes are an ideation-only surface, and the `ideation`
         * experiment is off on a clean test database — so `RestController` never
         * registered them. Register just that controller rather than flipping the
         * experiment, which would pull in the whole ideation REST surface. The
         * server is materialized first (which fires `rest_api_init` normally, so
         * every other route is already in place), then the hook is re-fired with
         * only this listener attached, because `register_rest_route()` warns when
         * called outside it. WP_UnitTestCase restores `$wp_filter` afterwards.
         * The base `set_up` already handed back a fresh server, so materializing
         * it here is what fires `rest_api_init` for this test.
         */
        rest_get_server();
        remove_all_actions( 'rest_api_init' );
        add_action(
            'rest_api_init',
            static function (): void {
                ( new DiscoveryController() )->register_routes();
            }
        );
        do_action( 'rest_api_init', rest_get_server() );

        Credentials::get_instance()->set_backend( new ConnectorsCredentialBackend() );
    }

    public function tear_down(): void
    {
        Credentials::get_instance()->set_backend( null );

        parent::tear_down();
    }

    /**
     * Dispatch a GET request and return its payload.
     *
     * @param string $route  Route path.
     * @param array  $params Query parameters.
     * @return array
     */
    private function get( string $route, array $params = array() ): array
    {
        $request = new WP_REST_Request( 'GET', $route );
        foreach ( $params as $key => $value ) {
            $request->set_param( $key, $value );
        }

        $response = rest_get_server()->dispatch( $request );

        $this->assertSame( 200, $response->get_status() );

        return $response->get_data();
    }

    /**
     * The `research` abilities payload.
     *
     * @return array
     */
    private function research_abilities(): array
    {
        return $this->get( '/vip-workflow/v1/abilities', array( 'category' => 'research' ) );
    }

    /**
     * Pick one entry out of a payload by a key/value match.
     *
     * @param array  $rows  Payload rows.
     * @param string $key   Key to match on.
     * @param string $value Value to match.
     * @return array
     */
    private function row( array $rows, string $key, string $value ): array
    {
        foreach ( $rows as $row ) {
            if ( ( $row[ $key ] ?? null ) === $value ) {
                return $row;
            }
        }

        $this->fail( sprintf( 'No row with %s = "%s" in the payload.', $key, $value ) );
    }

    /**
     * Every requirement in a serialized availability payload.
     *
     * @param array $availability Serialized availability.
     * @return array<int, array>
     */
    private function requirements( array $availability ): array
    {
        $requirements = array();
        foreach ( $availability['groups'] as $group ) {
            foreach ( $group['requirements'] as $requirement ) {
                $requirements[] = $requirement;
            }
        }

        return $requirements;
    }

    private function become_editor_only(): void
    {
        $user_id = self::factory()->user->create( array( 'role' => 'author' ) );
        wp_set_current_user( $user_id );

        $this->assertTrue( current_user_can( 'edit_posts' ) );
        $this->assertFalse( current_user_can( 'manage_options' ) );
    }

    private function become_administrator(): void
    {
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    public function test_administrator_gets_the_destination_on_the_abilities_surface(): void
    {
        $this->become_administrator();

        $ability      = $this->row( $this->research_abilities(), 'id', self::WEB_RESEARCHER_ABILITY );
        $requirements = $this->requirements( $ability['availability'] );

        $this->assertCount( 1, $requirements );
        $this->assertArrayHasKey( 'reason', $requirements[0] );
        $this->assertSame( Destination::KIND_ADMIN_URL, $requirements[0]['destination']['kind'] );
        $this->assertStringContainsString( '/wp-admin/', $requirements[0]['destination']['url'] );
    }

    public function test_editor_only_user_gets_the_user_register_on_the_abilities_surface(): void
    {
        $this->become_editor_only();

        $ability      = $this->row( $this->research_abilities(), 'id', self::WEB_RESEARCHER_ABILITY );
        $requirements = $this->requirements( $ability['availability'] );

        $this->assertCount( 1, $requirements );
        $this->assertArrayHasKey( 'message', $requirements[0] );
        $this->assertArrayNotHasKey( 'reason', $requirements[0] );
        $this->assertArrayNotHasKey( 'destination', $requirements[0] );
    }

    public function test_abilities_payload_carries_no_admin_url_for_an_editor_only_user(): void
    {
        $this->become_editor_only();

        $this->assertStringNotContainsString(
            '/wp-admin/',
            (string) wp_json_encode( $this->research_abilities() ),
            'An editor cannot open an admin screen, so no admin URL may appear anywhere in their payload.'
        );
    }

    public function test_administrator_gets_the_destination_on_the_discovery_surface(): void
    {
        $this->become_administrator();

        $provider     = $this->row( $this->get( '/vip-workflow/v1/discovery/providers' ), 'slug', self::PROVIDER_SLUG );
        $requirements = $this->requirements( $provider['availability'] );

        $this->assertFalse( $provider['available'] );
        $this->assertCount( 1, $requirements );
        $this->assertArrayHasKey( 'reason', $requirements[0] );
        $this->assertStringContainsString( '/wp-admin/', $requirements[0]['destination']['url'] );
    }

    public function test_editor_only_user_gets_the_user_register_on_the_discovery_surface(): void
    {
        $this->become_editor_only();

        $payload      = $this->get( '/vip-workflow/v1/discovery/providers' );
        $provider     = $this->row( $payload, 'slug', self::PROVIDER_SLUG );
        $requirements = $this->requirements( $provider['availability'] );

        $this->assertCount( 1, $requirements );
        $this->assertArrayHasKey( 'message', $requirements[0] );
        $this->assertArrayNotHasKey( 'reason', $requirements[0] );
        $this->assertArrayNotHasKey( 'destination', $requirements[0] );
        $this->assertStringNotContainsString( '/wp-admin/', (string) wp_json_encode( $payload ) );
    }

    public function test_plain_wp_ability_serializes_an_empty_requirement_set_rather_than_omitting_the_key(): void
    {
        $this->become_administrator();

        // The `vip-workflow` category is where the plugin's plain tool abilities
        // live; whichever rows are present, none may omit the key.
        $rows = $this->get( '/vip-workflow/v1/abilities' );

        $this->assertNotEmpty( $rows );

        // Collected rather than asserted per row: how many abilities are
        // registered depends on which earlier tests registered theirs, and the
        // registry is process-wide for the whole run. Asserting inside the loop
        // made this test's assertion count a function of execution order, which
        // is the one signal that would otherwise reveal a silently skipped test.
        // One assertion over the offender list is also a better failure message —
        // it names every violator instead of only the first.
        $offenders = array();
        foreach ( $rows as $row ) {
            if ( ! array_key_exists( 'availability', $row ) || ! is_array( $row['availability']['groups'] ?? null ) ) {
                $offenders[] = $row['id'];
            }
        }

        $this->assertSame(
            array(),
            $offenders,
            'Every ability row must carry availability.groups as an array.'
        );
    }
}
