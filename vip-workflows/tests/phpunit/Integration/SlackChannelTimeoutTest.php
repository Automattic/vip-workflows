<?php
/**
 * Integration coverage for the Slack webhook timeout.
 *
 * Runs through real WordPress HTTP (intercepted by `pre_http_request`) so the
 * timeout is read from the request WordPress would actually make.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Notifications\Channels\SlackChannel;
use VIPWorkflows\Notifications\Notification;

/**
 * Real-WordPress tests for the Slack webhook timeout.
 */
class SlackChannelTimeoutTest extends TestCase
{
	/**
	 * Timeouts of the webhook requests seen by `pre_http_request`.
	 *
	 * @var array<int, mixed>
	 */
	private array $timeouts = array();

	public function set_up(): void
	{
		parent::set_up();

		if ( ! gethostbynamel( 'hooks.slack.com' ) ) {
			$this->markTestSkipped( 'hooks.slack.com does not resolve here; the SSRF guard rejects the webhook before posting.' );
		}

		$this->timeouts = array();
		add_filter(
			'pre_http_request',
			function ( $pre, $args, $url ) {
				if ( false !== strpos( (string) $url, 'hooks.slack.com' ) ) {
					$this->timeouts[] = $args['timeout'] ?? null;
					return array(
						'headers'  => array(),
						'body'     => 'ok',
						'response' => array(
							'code'    => 200,
							'message' => 'OK',
						),
					);
				}
				return $pre;
			},
			10,
			3
		);
	}

	public function test_send_and_test_connection_use_the_three_second_timeout(): void
	{
		$channel = new SlackChannel(
			'timeout-test',
			array(
				'name'        => 'Timeout Test',
				'webhook_url' => 'https://hooks.slack.com/services/T000/B000/XXXX',
			)
		);

		$notification          = new Notification();
		$notification->type    = 'test';
		$notification->title   = 'Timeout test';
		$notification->message = 'Timeout check.';
		$notification->icon    = ':white_check_mark:';

		$this->assertTrue( $channel->send( $notification ) );
		$this->assertTrue( $channel->test_connection() );
		$this->assertSame( array( 3, 3 ), $this->timeouts );
	}
}
