<?php
/**
 * The PHP half of the shared abilities-response contract.
 *
 * The JS half is tests/unit-js/abilities-response-contract.test.js, reading the SAME
 * tests/fixtures/abilities-response-contract.json. Three bugs shipped this week
 * behind a green suite because each JS suite hand-built its own partial copy of
 * `GET /vip-workflow/v1/abilities`, and a partial copy cannot contradict the code it
 * stands in for. The response had no schema either, so there was nothing for a
 * fixture to be wrong against.
 *
 * `AbilitiesController::get_item_schema()` now declares the shape, which is worth
 * doing on its own — the contract is introspectable for REST consumers and for
 * agents reading this API over MCP. This file makes it load-bearing for the tests
 * too: the schema is pinned to the shared contract, and the contract is pinned to
 * what `get_items()` actually builds. Adding a key to the response without declaring
 * it turns the suite red rather than silently going missing from every fixture.
 *
 * Reading a declared schema rather than regexing the builder is the point. A regex
 * over `get_items()` would fail noisily on any refactor of code it was not really
 * asserting about; a schema is a stable thing to compare against, and the behavioral
 * half below keeps the schema from being a comment that lies.
 *
 * Only the plain-`WP_Ability` branch is reachable here: `VIPWorkflow\Abilities\Ability`
 * extends `WP_Ability`, which the unit suite does not load. The subclass branch —
 * where `icon` comes from, the third bug — is pinned against real WordPress in
 * tests/phpunit/Integration/AbilitiesResponseShapeTest.php.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\API\AbilitiesController;

/**
 * @covers \VIPWorkflow\API\AbilitiesController
 */
class AbilitiesResponseContractTest extends TestCase
{
    /**
     * Presence rules a key may declare.
     *
     * @var string[]
     */
    private const PRESENCE_RULES = array( 'always', 'ability_subclass', 'request_param' );

    protected function set_up()
    {
        parent::set_up();

        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'current_user_can' )->justReturn( true );
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
     * A controller with no constructor wiring (the schema needs none).
     *
     * @return AbilitiesController
     */
    private function bare_controller(): AbilitiesController
    {
        return ( new \ReflectionClass( AbilitiesController::class ) )->newInstanceWithoutConstructor();
    }

    /**
     * A plain ability object — deliberately NOT a `VIPWorkflow\Abilities\Ability`,
     * so it takes the same branch a bare `WP_Ability` from another plugin takes.
     *
     * @param string $name     Ability name.
     * @param string $category Ability category.
     * @return object
     */
    private function plain_ability( string $name, string $category ): object
    {
        return new class( $name, $category ) {
            public function __construct(
                private string $name,
                private string $category
            ) {}

            public function get_name(): string
            {
                return $this->name;
            }

            public function get_label(): string
            {
                return 'Human Readable Name';
            }

            public function get_description(): string
            {
                return 'Test ability';
            }

            public function get_category(): string
            {
                return $this->category;
            }

            public function get_input_schema(): array
            {
                return array();
            }

            public function get_meta(): array
            {
                return array( 'supports' => array() );
            }
        };
    }

    /**
     * A request stub answering only the params `get_items()` reads.
     *
     * @param array $params Request params.
     * @return object
     */
    private function request( array $params = array() ): object
    {
        return new class( $params ) {
            public function __construct( private array $params ) {}

            public function get_param( string $key )
            {
                return $this->params[ $key ] ?? null;
            }
        };
    }

    public function test_the_contract_assigns_every_key_a_known_presence_rule_and_a_reason(): void
    {
        $keys = self::contract()['keys'];

        $this->assertNotEmpty( $keys, 'An empty contract would make every assertion below vacuous.' );

        foreach ( $keys as $key => $spec ) {
            $this->assertContains(
                $spec['presence'],
                self::PRESENCE_RULES,
                sprintf( 'Key "%s" declares an unknown presence rule.', $key )
            );
            $this->assertNotEmpty( $spec['why'], sprintf( 'Key "%s" has no reason recorded.', $key ) );
        }
    }

    /**
     * Every key the schema declares is in the contract and vice versa. This is the
     * drift check in both directions: a key added to the response and declared in
     * the schema but never added here would leave every JS fixture missing it, and a
     * contract key the schema does not declare is a contract describing nothing.
     */
    public function test_the_schema_declares_exactly_the_contract_keys(): void
    {
        $schema_keys   = array_keys( $this->bare_controller()->get_item_schema()['properties'] );
        $contract_keys = array_keys( self::contract()['keys'] );

        sort( $schema_keys );
        sort( $contract_keys );

        $this->assertSame(
            $contract_keys,
            $schema_keys,
            'AbilitiesController::get_item_schema() and tests/fixtures/abilities-response-contract.json '
                . 'disagree about which keys the abilities response contains. Update both, and the JS '
                . 'fixture builder that reads the contract.'
        );
    }

    /**
     * The schema's `required` list is the contract's `always` set. These are the
     * keys a fixture may never omit — the omission of one is what let the disabled
     * agent's cards vanish unnoticed.
     */
    public function test_the_schema_requires_exactly_the_always_present_keys(): void
    {
        $required = $this->bare_controller()->get_item_schema()['required'];
        $always   = self::keys_with_presence( 'always' );

        sort( $required );
        sort( $always );

        $this->assertSame( $always, $required );
    }

    /**
     * The behavioral half: what `get_items()` builds for an ability with no
     * subclass, which must be exactly the always-present keys. If a key the contract
     * calls `always` were in fact conditional, this fails — so the contract cannot
     * over-promise, and the JS guard's refusal to let a fixture omit one stays honest.
     */
    public function test_get_items_emits_exactly_the_always_present_keys_for_a_plain_ability(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->plain_ability( 'vip-workflow/readability', 'vip-workflow' ) )
        );

        $data = $this->bare_controller()->get_items( $this->request() )->get_data();

        $this->assertCount( 1, $data );

        $emitted = array_keys( $data[0] );
        $always  = self::keys_with_presence( 'always' );

        sort( $emitted );
        sort( $always );

        $this->assertSame(
            $always,
            $emitted,
            'The keys get_items() emits for a plain WP_Ability are no longer the contract\'s '
                . '"always" set. Either a key changed presence, or the contract needs updating.'
        );
    }

    /**
     * `id` and `name` are built from one `get_name()` call, so they cannot disagree.
     * The JS guard rejects a fixture where they do — which is only defensible while
     * that is genuinely true of the endpoint. It is the bug that put a human name in
     * `name` and rendered ability ids to readers.
     */
    public function test_the_identifier_keys_carry_the_identifier_and_never_the_label(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->plain_ability( 'vip-workflow/readability', 'vip-workflow' ) )
        );

        $row = $this->bare_controller()->get_items( $this->request() )->get_data()[0];

        foreach ( self::contract()['invariants']['identityKeys']['keys'] as $key ) {
            $this->assertSame( 'vip-workflow/readability', $row[ $key ] );
            $this->assertMatchesRegularExpression(
                '#' . self::contract()['invariants']['abilityIdPattern'] . '#',
                $row[ $key ]
            );
        }

        $this->assertSame( 'Human Readable Name', $row['label'] );
    }

    /**
     * `required_for` is request-scoped, and the contract says so. A fixture carrying
     * it by default would be describing a request nobody made.
     */
    public function test_required_for_is_absent_without_a_post_id(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->plain_ability( 'vip-workflow/readability', 'vip-workflow' ) )
        );

        $row = $this->bare_controller()->get_items( $this->request() )->get_data()[0];

        $this->assertArrayNotHasKey( 'required_for', $row );
        $this->assertContains( 'required_for', self::keys_with_presence( 'request_param' ) );
    }

    /**
     * The keys the three bugs turned on, named explicitly. A rename that quietly
     * dropped one from the contract would leave both guards passing while no longer
     * guarding what they were written for.
     */
    public function test_the_contract_still_covers_the_keys_the_three_bugs_turned_on(): void
    {
        $this->assertContains( 'name', self::keys_with_presence( 'always' ) );
        $this->assertContains( 'enabled', self::keys_with_presence( 'always' ) );
        $this->assertContains( 'icon', self::keys_with_presence( 'ability_subclass' ) );
    }
}
