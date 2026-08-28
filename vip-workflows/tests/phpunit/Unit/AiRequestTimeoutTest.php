<?php
/**
 * Tests for the AI provider HTTP-timeout extension.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Plugin;

/**
 * Covers Plugin::extend_ai_request_timeout().
 */
class AiRequestTimeoutTest extends TestCase
{
    /**
     * @dataProvider ai_host_provider
     *
     * @param string $url Request URL.
     */
    public function test_extends_timeout_for_ai_hosts( string $url ): void
    {
        $this->assertSame( 60.0, Plugin::extend_ai_request_timeout( 5.0, $url ) );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function ai_host_provider(): array
    {
        return array(
            'openai'    => array( 'https://api.openai.com/v1/chat/completions' ),
            'anthropic' => array( 'https://api.anthropic.com/v1/messages' ),
            'google'    => array( 'https://generativelanguage.googleapis.com/v1/models' ),
        );
    }

    public function test_leaves_non_ai_hosts_untouched(): void
    {
        $this->assertSame( 5.0, Plugin::extend_ai_request_timeout( 5.0, 'https://example.com/api' ) );
    }

    public function test_never_shortens_a_longer_existing_timeout(): void
    {
        $this->assertSame( 90.0, Plugin::extend_ai_request_timeout( 90.0, 'https://api.anthropic.com/v1/messages' ) );
    }
}
