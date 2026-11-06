<?php
/**
 * The address of a source an editor adds by hand, through the REST route.
 *
 * Integration rather than unit because the claims are about what the table
 * holds afterwards, and about the route as the REST server runs it: the
 * route's own argument handling runs before the handler, and a rewrite there
 * would give a manual source an identity that the card path does not give it.
 *
 * The routes are registered directly onto the server this test builds. They
 * are wired during `rest_api_init` only while the ideation experiment is
 * enabled, and what is under test is the handler rather than that gate.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use ReflectionMethod;
use VIPWorkflows\API\IdeationSourcesController;
use VIPWorkflows\Ideation\Assistants\IdeationOrchestrator;
use VIPWorkflows\Ideation\Research\IdeationPostTypes;
use WP_REST_Request;
use WP_REST_Response;

/**
 * @covers \VIPWorkflows\API\IdeationSourcesController::add_source
 */
class IdeationManualSourceUrlIntegrationTest extends TestCase
{
    private int $project_id;

    /**
     * Requests the handler made, which must be none in every test here.
     *
     * @var string[]
     */
    private array $fetched = array();

    public function set_up(): void
    {
        parent::set_up();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

        $this->project_id = self::factory()->post->create(
            array(
                'post_type'   => IdeationPostTypes::POST_TYPE,
                'post_title'  => 'Manual sources',
                'post_author' => get_current_user_id(),
            )
        );

        add_filter(
            'pre_http_request',
            function ( $preempt, $args, $url ) {
                $this->fetched[] = (string) $url;

                return new \WP_Error( 'http_request_blocked', 'No network in this test.' );
            },
            10,
            3
        );

        $GLOBALS['wp_rest_server'] = null;
        rest_get_server();
        ( new IdeationSourcesController() )->register_routes();
    }

    public function tear_down(): void
    {
        $GLOBALS['wp_rest_server'] = null;

        parent::tear_down();
    }

    private function add( string $url ): WP_REST_Response
    {
        $request = new WP_REST_Request( 'POST', '/vip-workflows/v1/ideation/' . $this->project_id . '/sources' );
        $request->set_header( 'content-type', 'application/json' );
        $request->set_body( (string) wp_json_encode( array( 'url' => $url ) ) );

        return rest_get_server()->dispatch( $request );
    }

    private function row_count(): int
    {
        global $wpdb;

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        return (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(*) FROM {$wpdb->prefix}vip_ideation_sources WHERE project_id = %d",
                $this->project_id
            )
        );
    }

    private function assert_refused_untouched( WP_REST_Response $response ): void
    {
        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'rest_invalid_param', $response->get_data()['code'] ?? null );
        $this->assertSame( 0, $this->row_count(), 'A row was written for an address that was refused.' );
        $this->assertSame( array(), $this->fetched, 'An address that was refused was fetched.' );
    }

    public function test_an_address_with_no_host_is_refused(): void
    {
        $this->assert_refused_untouched( $this->add( 'https://' ) );
    }

    public function test_an_address_in_another_scheme_is_refused(): void
    {
        $this->assert_refused_untouched( $this->add( 'ftp://example.test/a' ) );
    }

    /**
     * A card stored with no ability carries the scope a manual source carries,
     * so adding its address by hand must land on that row. The address is
     * written the way a browser would still read it: the two paths agree only
     * if both reduce it the same way before the identity is taken.
     */
    public function test_an_accepted_address_has_the_identity_the_card_path_gives_it(): void
    {
        $url = " https://example.test/a\t?b=1\n";

        $store = new ReflectionMethod( IdeationOrchestrator::class, 'store_cards_as_sources' );
        $store->invoke(
            new IdeationOrchestrator(),
            $this->project_id,
            array( array( 'type' => 'article', 'url' => $url, 'title' => 'A title' ) ),
            get_current_user_id(),
            null
        );
        $this->assertSame( 1, $this->row_count() );

        $response = $this->add( $url );

        $this->assertSame( 200, $response->get_status(), 'The manual add did not find the row the card path stored.' );
        $this->assertSame(
            IdeationOrchestrator::card_identity( $this->project_id, null, array( 'url' => 'https://example.test/a?b=1' ) ),
            $response->get_data()['source_id']
        );
        $this->assertSame( 1, $this->row_count() );
        $this->assertSame( array(), $this->fetched );
    }
}
