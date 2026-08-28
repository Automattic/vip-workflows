<?php
/**
 * What `GET /vip-workflows/v1/abilities` really returns, pinned to the shared contract.
 *
 * The unit half (tests/phpunit/Unit/AbilitiesResponseContractTest.php) can only
 * reach the plain-`WP_Ability` branch, because `VIPWorkflows\Abilities\Ability`
 * extends a class the unit suite does not load. That leaves the branch every VIP
 * agent actually takes untested there — and it is the branch `icon` comes from, one
 * of the three keys whose absence from a JS fixture let a bug ship. So the subclass
 * shape is asserted here, against real WordPress and a really-registered ability.
 *
 * This is the half of the triangle that keeps the other two honest. The JS fixture
 * builder and the PHP schema are both pinned to
 * tests/fixtures/abilities-response-contract.json, which means they agree with each
 * other whether or not either agrees with the endpoint. This file is what makes the
 * contract answerable to the response: a key added to `get_items()` and left out of
 * the contract fails here, and a key the contract promises that the endpoint stopped
 * sending fails here too.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Ability;
use VIPWorkflows\Ideation\Assistants\WebResearcher;
use WP_REST_Request;

/**
 * @covers \VIPWorkflows\API\AbilitiesController
 */
class AbilitiesResponseShapeTest extends TestCase
{
    private const WEB_RESEARCHER_ABILITY = 'vip-workflows/web-researcher';

    /**
     * Register the Web Researcher, a real `VIPWorkflows\Abilities\Ability`.
     *
     * Abilities can only be registered while `wp_abilities_api_init` is running, so
     * the hook is fired again with every other listener detached — WP_UnitTestCase
     * restores `$wp_filter` afterwards. Registration is global and outlives the
     * test, hence the guard.
     */
    public function set_up(): void
    {
        parent::set_up();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

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
    }

    /**
     * The shared contract, decoded.
     *
     * @return array
     */
    private static function contract(): array
    {
        $path = dirname( __DIR__, 2 ) . '/fixtures/abilities-response-contract.json';
        $raw  = file_get_contents( $path );

        static::assertIsString( $raw, 'The shared abilities-response contract must be readable.' );

        $decoded = json_decode( $raw, true );

        static::assertIsArray( $decoded, 'The shared abilities-response contract must be valid JSON.' );

        return $decoded;
    }

    /**
     * Contract keys carrying one of the given presence rules.
     *
     * @param string ...$rules Presence rules to collect.
     * @return string[]
     */
    private static function keys_with_presence( string ...$rules ): array
    {
        $keys = array();

        foreach ( self::contract()['keys'] as $key => $spec ) {
            if ( in_array( $spec['presence'], $rules, true ) ) {
                $keys[] = $key;
            }
        }

        return $keys;
    }

    /**
     * Dispatch a GET against the abilities collection.
     *
     * @param array $params Query parameters.
     * @return array
     */
    private function abilities( array $params = array() ): array
    {
        $request = new WP_REST_Request( 'GET', '/vip-workflows/v1/abilities' );
        foreach ( $params as $key => $value ) {
            $request->set_param( $key, $value );
        }

        $response = rest_get_server()->dispatch( $request );

        $this->assertSame( 200, $response->get_status() );

        return $response->get_data();
    }

    /**
     * Pick one row out of a payload by id.
     *
     * @param array  $rows Payload rows.
     * @param string $id   Ability id.
     * @return array
     */
    private function row( array $rows, string $id ): array
    {
        foreach ( $rows as $row ) {
            if ( ( $row['id'] ?? null ) === $id ) {
                return $row;
            }
        }

        $this->fail( sprintf( 'No row with id "%s" in the abilities payload.', $id ) );
    }

    /**
     * The registered Web Researcher really is the subclass, so the row below really
     * does exercise the conditional branch. Without this the next assertion could
     * pass by describing the plain shape instead.
     */
    public function test_the_web_researcher_is_registered_as_the_ability_subclass(): void
    {
        $this->assertInstanceOf( Ability::class, wp_get_ability( self::WEB_RESEARCHER_ABILITY ) );
    }

    /**
     * A VIP ability's row carries the always-present keys AND the subclass-only
     * ones. This is the shape `vipAbility()` builds in
     * tests/unit-js/helpers/abilities-fixture.js, and the shape whose missing `icon`
     * put dashicon slugs on screen as literal text.
     */
    public function test_a_vip_ability_row_carries_the_always_and_subclass_keys(): void
    {
        $row = $this->row(
            $this->abilities( array( 'category' => 'research' ) ),
            self::WEB_RESEARCHER_ABILITY
        );

        $emitted  = array_keys( $row );
        $expected = self::keys_with_presence( 'always', 'ability_subclass' );

        sort( $emitted );
        sort( $expected );

        $this->assertSame(
            $expected,
            $emitted,
            'The keys a VIPWorkflows\Abilities\Ability row carries no longer match the contract\'s '
                . '"always" + "ability_subclass" sets. Update AbilitiesController::get_item_schema(), '
                . 'tests/fixtures/abilities-response-contract.json, and the JS fixture builder together.'
        );
    }

    /**
     * `icon` is not merely present — it is the dashicon slug the endpoint really
     * sends, which is what the board has to translate rather than print.
     */
    public function test_the_icon_is_the_slug_the_endpoint_really_sends(): void
    {
        $row = $this->row(
            $this->abilities( array( 'category' => 'research' ) ),
            self::WEB_RESEARCHER_ABILITY
        );

        $this->assertSame( 'search', $row['icon'] );
    }

    /**
     * Across every row of an unfiltered response: no always-present key is missing,
     * and no key appears that the contract has never heard of. This is the direction
     * that catches a key added to `get_items()` and nowhere else — the drift that
     * would otherwise leave every JS fixture silently incomplete.
     */
    public function test_every_row_conforms_to_the_contract_in_both_directions(): void
    {
        $rows = $this->abilities();

        $this->assertNotEmpty( $rows, 'An empty payload would make this assertion vacuous.' );

        $known  = array_keys( self::contract()['keys'] );
        $always = self::keys_with_presence( 'always' );

        foreach ( $rows as $row ) {
            foreach ( $always as $key ) {
                $this->assertArrayHasKey(
                    $key,
                    $row,
                    sprintf( '%s omitted "%s", which the contract calls always-present.', $row['id'], $key )
                );
            }

            foreach ( array_keys( $row ) as $key ) {
                $this->assertContains(
                    $key,
                    $known,
                    sprintf(
                        '%s carries "%s", which tests/fixtures/abilities-response-contract.json does not '
                            . 'declare. Add it there, to get_item_schema(), and to the JS fixture builder.',
                        $row['id'],
                        $key
                    )
                );
            }
        }
    }

    /**
     * The identifier keys agree, and the label is not the identifier. The JS guard
     * rejects a fixture that breaks either, so both have to be true of the endpoint.
     */
    public function test_the_identifier_keys_agree_and_the_label_differs(): void
    {
        $pattern = '#' . self::contract()['invariants']['abilityIdPattern'] . '#';

        foreach ( $this->abilities() as $row ) {
            foreach ( self::contract()['invariants']['identityKeys']['keys'] as $key ) {
                $this->assertSame( $row['id'], $row[ $key ] );
                $this->assertMatchesRegularExpression( $pattern, $row[ $key ] );
            }
        }

        $researcher = $this->row(
            $this->abilities( array( 'category' => 'research' ) ),
            self::WEB_RESEARCHER_ABILITY
        );

        $this->assertSame( 'Web Researcher', $researcher['label'] );
        $this->assertNotSame( $researcher['id'], $researcher['label'] );
    }

    /**
     * The collection route really does advertise the schema, so an OPTIONS request or
     * the route index describes the same response the fixtures model — which is the
     * half of the reason for declaring it that no test of `get_items()` can show.
     *
     * Asserted through `get_data_for_route()`, the method that actually builds that
     * payload, rather than by reading the `schema` key back off the route options.
     * Reading it back off the options is what an earlier version of this test did,
     * and it passed while the live endpoint advertised nothing at all: the key has to
     * be a sibling of the handler array, and a version nested inside the handler is
     * still visible to `get_routes()` while being invisible to the code that reports
     * it. A dispatched OPTIONS request is no good either — the server handles OPTIONS
     * in `serve_request()` ahead of routing, so `dispatch()` alone reports no route.
     */
    public function test_the_route_advertises_the_item_schema(): void
    {
        $route  = '/vip-workflows/v1/abilities';
        $routes = rest_get_server()->get_routes();

        $this->assertArrayHasKey( $route, $routes );

        // `help` is the context an OPTIONS request uses, and the only one under which
        // core calls the schema callback at all.
        $data = rest_get_server()->get_data_for_route( $route, $routes[ $route ], 'help' );

        $this->assertArrayHasKey(
            'schema',
            $data,
            'The abilities collection route reports no schema, so an OPTIONS request cannot '
                . 'describe the response the fixtures are built from. The `schema` key must be a '
                . 'sibling of the handler array in register_rest_route(), not a key inside it.'
        );

        $keys  = array_keys( $data['schema']['properties'] );
        $known = array_keys( self::contract()['keys'] );

        sort( $keys );
        sort( $known );

        $this->assertSame( $known, $keys );
    }
}
