<?php
/**
 * LegacyCredentialBackend tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\LegacyCredentialBackend;

class LegacyCredentialBackendTest extends TestCase
{
    private const SALT = 'unit-test-auth-salt-0123456789abcdef';

    private array $options = array();

    protected function setUp(): void
    {
        parent::setUp();
        $this->options = array();
        Functions\when( 'wp_salt' )->justReturn( self::SALT );
        Functions\when( 'get_option' )->alias(
            fn( string $name, $default = false ) => $this->options[ $name ] ?? $default
        );
    }

    /** Encrypt with the same scheme the legacy store uses (IV prepended, base64). */
    private function encrypt( string $plaintext ): string
    {
        $iv         = openssl_random_pseudo_bytes( 16 );
        $ciphertext = openssl_encrypt( $plaintext, 'aes-256-cbc', self::SALT, OPENSSL_RAW_DATA, $iv );
        return base64_encode( $iv . $ciphertext );
    }

    public function test_round_trips_a_stored_key(): void
    {
        $this->options['vip_workflow_api_keys'] = array(
            'openai_key' => $this->encrypt( 'sk-secret-123' ),
        );

        $this->assertSame( 'sk-secret-123', ( new LegacyCredentialBackend() )->get_api_key( 'openai' ) );
    }

    public function test_unknown_service_returns_empty(): void
    {
        $this->assertSame( '', ( new LegacyCredentialBackend() )->get_api_key( 'no-such' ) );
    }

    public function test_missing_or_corrupt_option_returns_empty(): void
    {
        $this->assertSame( '', ( new LegacyCredentialBackend() )->get_api_key( 'openai' ) );

        $this->options['vip_workflow_api_keys'] = 'corrupt-not-an-array';
        $this->assertSame( '', ( new LegacyCredentialBackend() )->get_api_key( 'openai' ) );
    }

    public function test_unset_slug_returns_empty(): void
    {
        $this->options['vip_workflow_api_keys'] = array( 'openai_key' => $this->encrypt( 'sk-x' ) );
        $this->assertSame( '', ( new LegacyCredentialBackend() )->get_api_key( 'tavily' ) );
    }
}
