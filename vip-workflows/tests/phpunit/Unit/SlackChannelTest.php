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

    public function test_webhook_timeout_is_three_seconds(): void
    {
        $this->assertSame( 3, SlackChannel::WEBHOOK_TIMEOUT );
    }

    public function test_send_and_test_connection_post_with_the_webhook_timeout(): void
    {
        if ( ! gethostbynamel( 'hooks.slack.com' ) ) {
            $this->markTestSkipped( 'hooks.slack.com does not resolve here; the SSRF guard rejects the webhook before posting.' );
        }

        $captured = array();

        Functions\stubs(
            array(
                'is_wp_error'                      => fn( $thing ) => $thing instanceof WP_Error,
                'wp_remote_retrieve_response_code' => fn( $response ) => $response['response']['code'] ?? 0,
                'wp_json_encode'                   => fn( $data ) => json_encode( $data ),
                'wp_safe_remote_post'              => function ( $url, $args ) use ( &$captured ) {
                    $captured[] = $args['timeout'] ?? null;
                    return array( 'response' => array( 'code' => 200 ) );
                },
            )
        );

        $channel = new SlackChannel(
            'timeout-test',
            array(
                'name'        => 'Timeout Test',
                'webhook_url' => 'https://hooks.slack.com/services/T000/B000/XXXX',
            )
        );

        $this->assertTrue( $channel->send( $this->make_notification() ) );
        $this->assertTrue( $channel->test_connection() );
        $this->assertSame( array( 3, 3 ), $captured );
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
