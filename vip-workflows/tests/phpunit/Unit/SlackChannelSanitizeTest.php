<?php
/**
 * SlackChannel::sanitize_settings hardening.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Notifications\Channels\SlackChannel;

/**
 * Slack destination settings must be sanitized: the webhook URL is restricted
 * to Slack over https, and the bot name/icon are cleaned.
 */
class SlackChannelSanitizeTest extends TestCase
{
    protected function set_up()
    {
        parent::set_up();

        Functions\when( 'esc_url_raw' )->alias(
            fn( $url, $protocols = null ) => str_starts_with( (string) $url, 'https://' ) ? $url : ''
        );
        Functions\when( 'sanitize_text_field' )->alias( fn( $v ) => trim( (string) $v ) );
    }

    private function sanitize( array $input ): array
    {
        return ( new SlackChannel() )->sanitize_settings( $input );
    }

    public function test_rejects_a_non_slack_webhook_url(): void
    {
        $out = $this->sanitize( array( 'webhook_url' => 'file:///etc/passwd' ) );
        $this->assertSame( '', $out['webhook_url'] );
    }

    public function test_rejects_a_non_slack_https_url(): void
    {
        $out = $this->sanitize( array( 'webhook_url' => 'https://evil.example.com/hook' ) );
        $this->assertSame( '', $out['webhook_url'] );
    }

    public function test_keeps_a_valid_slack_webhook(): void
    {
        $url = 'https://hooks.slack.com/services/T00/B00/xyz';
        $out = $this->sanitize( array( 'webhook_url' => $url ) );
        $this->assertSame( $url, $out['webhook_url'] );
    }

    public function test_keeps_a_valid_slack_gov_webhook(): void
    {
        $url = 'https://hooks.slack-gov.com/services/T00/B00/xyz';
        $out = $this->sanitize( array( 'webhook_url' => $url ) );
        $this->assertSame( $url, $out['webhook_url'] );
    }

    public function test_rejects_a_slack_lookalike_host(): void
    {
        $out = $this->sanitize( array( 'webhook_url' => 'https://hooks.slack.com.evil.com/services/x' ) );
        $this->assertSame( '', $out['webhook_url'] );
    }

    public function test_sanitizes_bot_name_and_keeps_emoji_icon(): void
    {
        $out = $this->sanitize( array( 'bot_name' => '  Newsbot  ', 'bot_icon' => ':robot:' ) );
        $this->assertSame( 'Newsbot', $out['bot_name'] );
        $this->assertSame( ':robot:', $out['bot_icon'] );
    }
}
