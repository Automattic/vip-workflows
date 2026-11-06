<?php
/**
 * Saving a provider's settings must stop its cached discovery results being served.
 *
 * The cache used to be cleared by deleting `_transient_vip_discovery_*` rows from
 * `wp_options`. On VIP transients live in the persistent object cache, so that
 * delete matched nothing, and the filters cache was never cleared on any host.
 * The cache is now keyed by a per-provider generation that a settings save bumps.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\API\DiscoveryController;
use VIPWorkflows\Assistants\AssistantRegistry;
use VIPWorkflows\Discovery\DiscoveryProviderRegistry;
use WP_REST_Request;

class DiscoveryCacheClearTest extends TestCase
{
    private const PROVIDER = 'test-cache-clear';

    /**
     * How many times the provider's callbacks ran, by feature.
     *
     * @var array<string, int>
     */
    public static array $calls = array();

    public function set_up(): void
    {
        parent::set_up();

        self::$calls = array(
            'recommend' => 0,
            'filters'   => 0,
        );

        wp_set_current_user(
            (int) self::factory()->user->create( array( 'role' => 'administrator' ) )
        );

        $GLOBALS['wp_rest_server'] = null;

        DiscoveryProviderRegistry::get_instance()->register(
            self::PROVIDER,
            array(
                'label'     => 'Cache Clear',
                'features'  => array( 'recommend', 'search' ),
                'callbacks' => array(
                    'recommend' => array( self::class, 'recommend' ),
                    'search'    => array( self::class, 'recommend' ),
                    'filters'   => array( self::class, 'filters' ),
                    'seed'      => static fn( array $prompt ): string => (string) ( $prompt['title'] ?? '' ),
                ),
            )
        );

        AssistantRegistry::get_instance()->register(
            'test-cache-clear-card',
            array(
                'label'          => 'Cache Clear',
                'provider_slugs' => array( self::PROVIDER ),
            )
        );
    }

    public function tear_down(): void
    {
        delete_option( 'vip_discovery_cache_generation' );
        delete_option( 'vip_discovery_provider_' . self::PROVIDER );
        delete_option( 'vip_discovery_provider_settings' );

        $GLOBALS['wp_rest_server'] = null;

        parent::tear_down();
    }

    /**
     * @return array<int, array>
     */
    public static function recommend(): array
    {
        ++self::$calls['recommend'];

        return array(
            array(
                'id'    => 'p1',
                'title' => 'A prompt',
            ),
        );
    }

    /**
     * @return array<int, array>
     */
    public static function filters(): array
    {
        ++self::$calls['filters'];

        return array( array( 'key' => 'topic' ) );
    }

    private function dispatch( string $route, array $params = array() ): void
    {
        rest_get_server();
        ( new DiscoveryController() )->register_routes();

        $request = new WP_REST_Request( 'GET', '/vip-workflows/v1/discovery/' . $route );
        $request->set_param( 'provider', self::PROVIDER );
        foreach ( $params as $key => $value ) {
            $request->set_param( $key, $value );
        }

        $this->assertSame( 200, rest_get_server()->dispatch( $request )->get_status() );
    }

    public function test_saving_provider_settings_stops_a_cached_recommend_result_being_served(): void
    {
        $this->dispatch( 'recommend' );
        $this->dispatch( 'recommend' );
        $this->assertSame( 1, self::$calls['recommend'], 'The second request should be answered from the cache.' );

        $this->assertTrue(
            AssistantRegistry::get_instance()->update_settings(
                'test-cache-clear-card',
                array( 'options' => array( 'cache_minutes' => 30 ) )
            )
        );

        $this->dispatch( 'recommend' );
        $this->assertSame( 2, self::$calls['recommend'], 'A settings save must stop the old result being served.' );
    }

    public function test_saving_provider_settings_clears_the_filters_cache(): void
    {
        $this->dispatch( 'filters' );
        $this->dispatch( 'filters' );
        $this->assertSame( 1, self::$calls['filters'] );

        AssistantRegistry::get_instance()->update_settings(
            'test-cache-clear-card',
            array( 'options' => array( 'cache_minutes' => 30 ) )
        );

        $this->dispatch( 'filters' );
        $this->assertSame( 2, self::$calls['filters'], 'The filters cache was never cleared before.' );
    }
}
