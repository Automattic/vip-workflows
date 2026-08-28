<?php
/**
 * ConnectorsCredentialBackend tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\AI\ConnectorsCredentialBackend;

class ConnectorsCredentialBackendTest extends TestCase
{
    private array $options = array();

    protected function setUp(): void
    {
        parent::setUp();
        $this->options = array();
        Functions\when( 'get_option' )->alias(
            fn( string $name, $default = false ) => $this->options[ $name ] ?? $default
        );
    }

    private function stub_connector( array $auth ): void
    {
        Functions\when( 'wp_get_connector' )->alias(
            fn( string $id ) => array(
                'id'             => $id,
                'type'           => 'ai_provider',
                'authentication' => $auth,
            )
        );
    }

    public function test_resolves_key_from_database_setting(): void
    {
        $this->options['connectors_ai_openai_api_key'] = 'sk-from-db';
        $this->stub_connector(
            array( 'method' => 'api_key', 'setting_name' => 'connectors_ai_openai_api_key' )
        );

        $this->assertSame( 'sk-from-db', ( new ConnectorsCredentialBackend() )->get_api_key( 'openai' ) );
    }

    public function test_constant_beats_database(): void
    {
        if ( ! defined( 'VIPWF_TEST_OPENAI_CONST' ) ) {
            define( 'VIPWF_TEST_OPENAI_CONST', 'sk-from-constant' );
        }
        $this->options['connectors_ai_openai_api_key'] = 'sk-from-db';
        $this->stub_connector(
            array(
                'method'        => 'api_key',
                'setting_name'  => 'connectors_ai_openai_api_key',
                'constant_name' => 'VIPWF_TEST_OPENAI_CONST',
            )
        );

        $this->assertSame( 'sk-from-constant', ( new ConnectorsCredentialBackend() )->get_api_key( 'openai' ) );
    }

    public function test_unknown_or_unregistered_connector_returns_empty(): void
    {
        Functions\when( 'wp_get_connector' )->justReturn( null );
        $this->assertSame( '', ( new ConnectorsCredentialBackend() )->get_api_key( 'openai' ) );
        $this->assertSame( '', ( new ConnectorsCredentialBackend() )->get_api_key( 'no-such' ) );
    }

    public function test_non_api_key_auth_returns_empty(): void
    {
        $this->stub_connector( array( 'method' => 'none' ) );
        $this->assertSame( '', ( new ConnectorsCredentialBackend() )->get_api_key( 'openai' ) );
    }

    public function test_registers_custom_connectors_for_tavily_and_youtube(): void
    {
        $registered = array();
        $registry   = new class( $registered ) {
            public array $ids = array();
            public function __construct( &$ref )
            {
                $this->ref = &$ref;
            }
            public array $ref;
            public function is_registered( string $id ): bool
            {
                return in_array( $id, $this->ids, true );
            }
            public function register( string $id, array $args )
            {
                $this->ids[] = $id;
                return $args;
            }
        };

        ConnectorsCredentialBackend::register_custom_connectors( $registry );

        $this->assertContains( 'tavily', $registry->ids );
        $this->assertContains( 'youtube', $registry->ids );
    }
}
