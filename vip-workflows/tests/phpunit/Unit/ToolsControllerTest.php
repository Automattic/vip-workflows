<?php
/**
 * ToolsController unit tests.
 *
 * Runs on the doubles-based unit harness (Brain\Monkey + the WP_REST_Controller
 * / WP_REST_Request / WP_REST_Response / WP_Error doubles in
 * tests/phpunit/Unit/doubles/). No WordPress is booted: wp_get_abilities() and
 * the option store are mocked per-test. Mirrors AbilitiesControllerTest.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\API\ToolsController;
use VIPWorkflows\Abilities\AbilitySettings;
use WP_Error;
use WP_REST_Response;

class ToolsControllerTest extends TestCase
{
    private array $stored_settings = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->stored_settings = array();

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflows_ability_settings' === $option
                    ? $this->stored_settings
                    : $default;
            }
        );

        Functions\when( 'update_option' )->alias(
            function ( string $option, $value ) {
                if ( 'vip_workflows_ability_settings' === $option ) {
                    $this->stored_settings = $value;
                }

                return true;
            }
        );

        // Availability serialization asks who is reading; the permission tests
        // below override this where the answer matters.
        Functions\when( 'current_user_can' )->justReturn( true );

        AbilitySettings::get_instance()->clear_cache();
    }

    public function test_admin_permissions_check_requires_manage_options(): void
    {
        $controller = $this->create_controller();

        Functions\when( 'current_user_can' )->justReturn( true );
        $this->assertTrue( $controller->admin_permissions_check() );

        Functions\when( 'current_user_can' )->justReturn( false );
        $this->assertFalse( $controller->admin_permissions_check() );
    }

    public function test_get_items_returns_only_vip_workflows_tools(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array(
                $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ),
                $this->create_ability_stub( 'vip-workflows/web-researcher', 'research' ),
            )
        );

        $controller = $this->create_controller();
        $response   = $controller->get_items( $this->create_request_stub() );

        $this->assertInstanceOf( WP_REST_Response::class, $response );
        $data = $response->get_data();
        $this->assertCount( 1, $data );
        $this->assertSame( 'vip-workflows/readability', $data[0]['id'] );
        $this->assertSame( 'vip-workflows', $data[0]['category'] );
    }

    public function test_get_items_skips_abilities_without_meta_type(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array(
                $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ),
                $this->create_ability_stub( 'vip-workflows/no-type', 'vip-workflows', array( 'type' => '' ) ),
            )
        );

        $controller = $this->create_controller();
        $data       = $controller->get_items( $this->create_request_stub() )->get_data();

        $this->assertCount( 1, $data );
        $this->assertSame( 'vip-workflows/readability', $data[0]['id'] );
    }

    public function test_get_items_includes_management_fields(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ) )
        );

        $controller = $this->create_controller();
        $item       = $controller->get_items( $this->create_request_stub() )->get_data()[0];

        $this->assertArrayHasKey( 'settings_schema', $item );
        $this->assertArrayHasKey( 'check_modes', $item );
        $this->assertArrayHasKey( 'transition_eligible', $item );
        $this->assertArrayHasKey( 'show_in_commands', $item );
        $this->assertArrayHasKey( 'enabled', $item );
        $this->assertArrayHasKey( 'options', $item );
        $this->assertSame( array( 'threshold' => array( 'type' => 'number' ) ), $item['settings_schema'] );
    }

    public function test_update_settings_persists_and_returns_single_tool(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ) )
        );

        $controller = $this->create_controller();
        $request    = $this->create_request_stub(
            array( 'id' => 'vip-workflows/readability' ),
            array(
                'enabled'             => false,
                'show_in_commands'    => false,
                'transition_eligible' => false,
                'options'             => array( 'threshold' => 80 ),
                'check_modes'         => array( 'threshold' => 'hard' ),
            )
        );

        $response = $controller->update_settings( $request );

        $this->assertInstanceOf( WP_REST_Response::class, $response );
        $data = $response->get_data();
        $this->assertSame( 'vip-workflows/readability', $data['id'] );
        $this->assertFalse( $data['enabled'] );
        $this->assertFalse( $data['show_in_commands'] );
        $this->assertFalse( $data['transition_eligible'] );
        $this->assertSame( 80, $data['options']['threshold'] );
        $this->assertSame( 'hard', $data['check_modes']['threshold'] );

        // Persisted through to the option store.
        $persisted = $this->stored_settings['vip-workflows/readability'];
        $this->assertFalse( $persisted['enabled'] );
        $this->assertSame( 80, $persisted['options']['threshold'] );
    }

    public function test_update_settings_returns_404_for_unknown_tool(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ) )
        );

        $controller = $this->create_controller();
        $result     = $controller->update_settings(
            $this->create_request_stub( array( 'id' => 'vip-workflows/does-not-exist' ), array( 'enabled' => true ) )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'unknown_tool', $result->get_error_code() );
        $this->assertSame( 404, $result->get_error_data()['status'] );
    }

    public function test_update_settings_returns_404_for_wrong_category_tool(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->create_ability_stub( 'vip-workflows/web-researcher', 'research' ) )
        );

        $controller = $this->create_controller();
        $result     = $controller->update_settings(
            $this->create_request_stub( array( 'id' => 'vip-workflows/web-researcher' ), array( 'enabled' => true ) )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'unknown_tool', $result->get_error_code() );
    }

    public function test_update_settings_returns_400_for_non_array_body(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ) )
        );

        $controller = $this->create_controller();
        $result     = $controller->update_settings(
            $this->create_request_stub( array( 'id' => 'vip-workflows/readability' ), null )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'invalid_payload', $result->get_error_code() );
        $this->assertSame( 400, $result->get_error_data()['status'] );
    }

    private function create_controller(): ToolsController
    {
        $reflection = new \ReflectionClass( ToolsController::class );

        return $reflection->newInstanceWithoutConstructor();
    }

    /**
     * Request double extending WP_REST_Request (the unit double) so it
     * satisfies the `update_settings( WP_REST_Request $request )` type hint,
     * while letting us control get_param()/get_json_params() directly.
     *
     * @param array      $params Route/query params (category, id).
     * @param mixed|null $body   JSON body returned by get_json_params().
     */
    private function create_request_stub( array $params = array(), $body = array() ): \WP_REST_Request
    {
        return new class( $params, $body ) extends \WP_REST_Request {
            /**
             * @param array      $vipwf_params Route/query params.
             * @param mixed|null $vipwf_body   JSON body.
             */
            public function __construct( private array $vipwf_params, private $vipwf_body )
            {
                parent::__construct();
            }

            public function get_param( $key )
            {
                return $this->vipwf_params[ $key ] ?? null;
            }

            public function get_json_params()
            {
                return $this->vipwf_body;
            }
        };
    }

    /**
     * @param array $meta_overrides Override keys merged into get_meta().
     */
    private function create_ability_stub( string $name, string $category, array $meta_overrides = array() ): object
    {
        $meta = array_merge(
            array(
                'type'            => 'check',
                'settings_schema' => array( 'threshold' => array( 'type' => 'number' ) ),
            ),
            $meta_overrides
        );

        return new class( $name, $category, $meta ) {
            public function __construct(
                private string $name,
                private string $category,
                private array $meta
            ) {}

            public function get_category(): string
            {
                return $this->category;
            }

            public function get_name(): string
            {
                return $this->name;
            }

            public function get_label(): string
            {
                return $this->name;
            }

            public function get_description(): string
            {
                return 'Test ability';
            }

            public function get_input_schema(): array
            {
                return array();
            }

            public function get_meta(): array
            {
                return $this->meta;
            }
        };
    }
}
