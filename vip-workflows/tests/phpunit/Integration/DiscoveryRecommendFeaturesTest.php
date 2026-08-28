<?php
/**
 * The recommend payload tells the screen what each provider can do.
 *
 * The ideation screen offers a "Browse more…" affordance that opens the search
 * modal. It used to offer it for every provider, because the payload described a
 * provider only by slug, label and icon — nothing said whether it could answer a
 * query. The first two providers both could, so nothing surfaced the gap.
 *
 * A recommend-only provider surfaced it: the button reached the search route and
 * got back a 500 carrying the name of the missing callback. The screen now gates
 * the button on `features`, which only works while the payload keeps sending it.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\API\DiscoveryController;
use VIPWorkflow\Discovery\DiscoveryProviderRegistry;
use WP_REST_Request;

class DiscoveryRecommendFeaturesTest extends TestCase
{
    /**
     * Slug for the recommend-only provider registered by this test.
     *
     * @var string
     */
    private const RECOMMEND_ONLY = 'test-recommend-only';

    /**
     * Slug for the searchable provider registered by this test.
     *
     * @var string
     */
    private const SEARCHABLE = 'test-searchable';

    public function set_up(): void
    {
        parent::set_up();

        wp_set_current_user(
            (int) self::factory()->user->create( array( 'role' => 'administrator' ) )
        );

        /*
         * The routes are wired on `rest_api_init`, which only fires when the
         * server is built. Discarding it makes the next `rest_do_request()`
         * build a fresh one — otherwise a server materialized by an earlier
         * test answers with a 404 for routes registered after it.
         */
        $GLOBALS['wp_rest_server'] = null;

        $registry = DiscoveryProviderRegistry::get_instance();

        $registry->register(
            self::RECOMMEND_ONLY,
            array(
                'label'     => 'Recommend Only',
                'features'  => array( 'recommend' ),
                'callbacks' => array(
                    'recommend' => array( self::class, 'prompts' ),
                    'seed'      => array( self::class, 'seed' ),
                ),
            )
        );

        $registry->register(
            self::SEARCHABLE,
            array(
                'label'     => 'Searchable',
                'features'  => array( 'recommend', 'search' ),
                'callbacks' => array(
                    'recommend' => array( self::class, 'prompts' ),
                    'search'    => array( self::class, 'prompts' ),
                    'filters'   => array( self::class, 'filters' ),
                    'seed'      => array( self::class, 'seed' ),
                ),
            )
        );
    }

    public function tear_down(): void
    {
        global $wpdb;

        // The controller caches per provider; a stale entry would answer for the
        // next test in this class rather than the provider under it.
        $wpdb->query(
            "DELETE FROM {$wpdb->options} WHERE option_name LIKE '%vip_discovery_recommend%'"
        );

        $GLOBALS['wp_rest_server'] = null;

        parent::tear_down();
    }

    /**
     * A single prompt, so the controller does not drop the empty group.
     *
     * @return array<int, array>
     */
    public static function prompts(): array
    {
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
        return array();
    }

    public static function seed( array $prompt ): string
    {
        return (string) ( $prompt['title'] ?? '' );
    }

    /**
     * Register the discovery routes on a live server.
     *
     * The controller is only wired during `rest_api_init` while the ideation
     * experiment is enabled. What is under test is the payload's contents, not
     * the experiment gate, so the routes go directly onto the server this test
     * builds — the same approach the ideation tests take.
     */
    private function register_discovery_routes(): void
    {
        rest_get_server();
        ( new DiscoveryController() )->register_routes();
    }

    /**
     * Provider descriptors from the recommend route, keyed by slug.
     *
     * @return array<string, array>
     */
    private function providers(): array
    {
        $this->register_discovery_routes();

        $response = rest_get_server()->dispatch(
            new WP_REST_Request( 'GET', '/vip-workflow/v1/discovery/recommend' )
        );

        $this->assertSame( 200, $response->get_status() );

        $out = array();
        foreach ( (array) $response->get_data() as $group ) {
            $out[ $group['provider']['slug'] ] = $group['provider'];
        }

        return $out;
    }

    public function test_payload_reports_features_for_a_recommend_only_provider(): void
    {
        $providers = $this->providers();

        $this->assertArrayHasKey( self::RECOMMEND_ONLY, $providers );
        $this->assertSame(
            array( 'recommend' ),
            $providers[ self::RECOMMEND_ONLY ]['features'],
            'Without this the screen cannot tell that search is unavailable.'
        );
    }

    public function test_payload_reports_search_for_a_searchable_provider(): void
    {
        $providers = $this->providers();

        $this->assertContains(
            'search',
            $providers[ self::SEARCHABLE ]['features'],
            'Gating on a missing key would hide the affordance from every provider.'
        );
    }

    /**
     * The bug the gate prevents, asserted at its source: asking a recommend-only
     * provider to search is an error, not an empty result set.
     */
    public function test_searching_a_recommend_only_provider_is_an_error(): void
    {
        $request = new WP_REST_Request( 'GET', '/vip-workflow/v1/discovery/search' );
        $request->set_param( 'provider', self::RECOMMEND_ONLY );
        $request->set_param( 'text', 'anything' );

        $this->register_discovery_routes();

        $this->assertSame(
            500,
            rest_get_server()->dispatch( $request )->get_status(),
            'If this ever returns 200, the screen may offer search to every provider again.'
        );
    }
}
