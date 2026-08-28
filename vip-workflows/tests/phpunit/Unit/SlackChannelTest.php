<?php
/**
 * SlackChannel unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Notifications\Channels\SlackChannel;
use VIPWorkflows\Notifications\Notification;
use WP_Error;

/**
 * Tests for Slack webhook delivery hardening.
 */
class SlackChannelTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Functions\stubs(
            array(
                'wp_parse_url' => function ( $url, $component = -1 ) {
                    return -1 === $component ? parse_url( $url ) : parse_url( $url, $component );
                },
            )
        );
    }

    public function test_send_rejects_non_slack_webhook_without_posting(): void
    {
        $post_called = false;

        Functions\stubs(
            array(
                'is_wp_error'                    => fn( $thing ) => $thing instanceof WP_Error,
                'wp_remote_retrieve_response_code' => fn( $response ) => $response['response']['code'] ?? 0,
                'wp_safe_remote_post'            => function () use ( &$post_called ) {
                    $post_called = true;
                    return array( 'response' => array( 'code' => 200 ) );
                },
            )
        );

        $channel = new SlackChannel(
            'security-test',
            array(
                'name'        => 'Security Test',
                'webhook_url' => 'https://evil.example.com/services/not-slack',
            )
        );

        $this->assertFalse( $channel->send( $this->make_notification() ) );
        $this->assertFalse( $post_called, 'SlackChannel must not POST to non-Slack webhook hosts.' );
    }

    private function make_notification(): Notification
    {
        $notification          = new Notification();
        $notification->type    = 'test';
        $notification->title   = 'Security test';
        $notification->message = 'Webhook validation check.';
        $notification->icon    = ':white_check_mark:';

        return $notification;
    }
}
