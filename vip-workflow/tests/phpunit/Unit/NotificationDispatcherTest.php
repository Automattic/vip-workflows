<?php
/**
 * NotificationDispatcher unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Notifications\Notification;
use VIPWorkflow\Notifications\NotificationChannel;
use VIPWorkflow\Notifications\NotificationDispatcher;

/**
 * Smoke tests for NotificationDispatcher.
 *
 * Tests channel registration, dispatch routing, async send, and static helpers.
 * Tests that call get_channel() / get_channels() trigger the internal
 * register_channels() guard, which instantiates SlackChannel + EmailChannel;
 * setUp() stubs the WP functions those classes require.
 */
class NotificationDispatcherTest extends TestCase
{
    private NotificationDispatcher $dispatcher;

    protected function setUp(): void
    {
        parent::setUp();

        // register_channels() calls register_setting() for each built-in channel.
        Functions\when( 'register_setting' )->justReturn( true );

        // SlackChannel::get_destinations() reads an option; return empty so no Slack instances are created.
        Functions\when( 'get_option' )->justReturn( [] );

        // Fresh dispatcher. init() is intentionally not called so we control channels directly.
        $this->dispatcher = new NotificationDispatcher();
    }

    // -------------------------------------------------------------------------
    // register_channel
    // -------------------------------------------------------------------------

    public function test_register_channel_returns_true_for_new_channel(): void
    {
        $channel = $this->make_channel( 'slack' );
        $this->assertTrue( $this->dispatcher->register_channel( $channel ) );
    }

    public function test_register_channel_returns_false_for_duplicate(): void
    {
        $this->dispatcher->register_channel( $this->make_channel( 'slack' ) );
        $result = $this->dispatcher->register_channel( $this->make_channel( 'slack' ) );
        $this->assertFalse( $result );
    }

    public function test_register_channel_duplicate_does_not_overwrite_original(): void
    {
        $original  = $this->make_channel( 'my-channel', configured: true );
        $duplicate = $this->make_channel( 'my-channel', configured: false );

        $this->dispatcher->register_channel( $original );
        $this->dispatcher->register_channel( $duplicate );

        // get_channel() triggers register_channels() — stubs in setUp() make that safe.
        $stored = $this->dispatcher->get_channel( 'my-channel' );
        $this->assertSame( $original, $stored );
    }

    public function test_get_channel_returns_null_for_unknown_id(): void
    {
        // get_channel() triggers register_channels() — stubs in setUp() make that safe.
        $this->assertNull( $this->dispatcher->get_channel( 'does-not-exist' ) );
    }

    // -------------------------------------------------------------------------
    // dispatch: no channels
    // -------------------------------------------------------------------------

    public function test_dispatch_does_nothing_when_no_channels_registered(): void
    {
        // Should complete without errors when there are no matching channels.
        $this->dispatcher->dispatch( 'published', [ 'post_id' => 1 ] );
        $this->assertTrue( true );
    }

    // -------------------------------------------------------------------------
    // dispatch: channel not configured
    // -------------------------------------------------------------------------

    public function test_dispatch_skips_unconfigured_channel(): void
    {
        $channel = $this->make_channel( 'slack', configured: false );
        $channel->shouldNotReceive( 'send' );

        $this->dispatcher->register_channel( $channel );
        $this->dispatcher->dispatch( 'published', [ 'post_id' => 1 ] );
    }

    // -------------------------------------------------------------------------
    // dispatch: routing
    // -------------------------------------------------------------------------

    public function test_dispatch_skips_channel_when_event_not_in_routing(): void
    {
        Functions\when( 'get_option' )->alias(
            function ( $option, $default = [] ) {
                if ( 'vip_workflow_notification_routing' === $option ) {
                    return [ 'transition' => [ 'slack' ] ]; // only transition → slack
                }
                return $default;
            }
        );

        $channel = $this->make_channel( 'slack', configured: true );
        $channel->shouldNotReceive( 'send' );
        // Routing has no entry for 'published', which is the whole answer now —
        // there is no per-channel list left to fall back to.

        $this->dispatcher->register_channel( $channel );
        $this->dispatcher->dispatch( 'published', [ 'post_id' => 1 ] );
    }

    // -------------------------------------------------------------------------
    // handle_async_send
    // -------------------------------------------------------------------------

    public function test_handle_async_send_skips_unknown_channel(): void
    {
        // Should not throw for a non-existent channel_id.
        $this->dispatcher->handle_async_send( 'nonexistent', 'published', [] );
        $this->assertTrue( true );
    }

    public function test_handle_async_send_skips_unconfigured_channel(): void
    {
        $channel = $this->make_channel( 'email', configured: false );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->handle_async_send( 'email', 'published', [] );
    }

    // -------------------------------------------------------------------------
    // Static helpers
    // -------------------------------------------------------------------------

    public function test_get_event_types_returns_expected_keys(): void
    {
        $types = NotificationDispatcher::get_event_types();
        $this->assertIsArray( $types );

        // The routing matrix is built from these ids and should_notify_channel()
        // matches them with isset(), so they have to be the ids dispatch() fires.
        // Ticking a row whose id nothing emits is a notification that never sends.
        $this->assertArrayHasKey( 'published', $types );
    }

    // -------------------------------------------------------------------------
    // send_transition_notifications
    // -------------------------------------------------------------------------

    public function test_send_transition_notifications_does_nothing_for_empty_notifications(): void
    {
        Functions\when( 'get_transient' )->justReturn( false );

        $this->dispatcher->send_transition_notifications(
            1,
            [ 'notifications' => [] ],
            [ 'post_id' => 1 ],
            false
        );

        $this->assertTrue( true );
    }

    public function test_send_transition_notifications_skips_unconfigured_channel(): void
    {
        Functions\when( 'get_transient' )->justReturn( false );

        $channel = $this->make_channel( 'slack', configured: false );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->send_transition_notifications(
            1,
            [ 'notifications' => [ 'slack' ] ],
            [ 'post_id' => 1 ],
            false
        );
    }

    public function test_send_transition_notifications_sends_to_configured_channel(): void
    {
        Functions\when( 'get_transient' )->justReturn( false );
        Functions\when( 'set_transient' )->justReturn( true );

        $channel = $this->make_channel( 'slack', configured: true );
        $channel->shouldReceive( 'send' )->once()->andReturn( true );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->send_transition_notifications(
            1,
            [ 'notifications' => [ 'slack' ] ],
            [ 'post_id' => 1, 'post_title' => 'Test', 'from_label' => 'Draft', 'to_label' => 'Review' ],
            false
        );
    }

    public function test_send_transition_notifications_uses_published_event_type(): void
    {
        Functions\when( 'get_transient' )->justReturn( false );
        Functions\when( 'set_transient' )->justReturn( true );

        $received_notification = null;
        $channel               = $this->make_channel( 'slack', configured: true );
        $channel->shouldReceive( 'send' )
            ->once()
            ->andReturnUsing(
                function ( $n ) use ( &$received_notification ) {
                    $received_notification = $n;
                    return true;
                }
            );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->send_transition_notifications(
            1,
            [ 'notifications' => [ 'slack' ] ],
            [ 'post_id' => 1, 'post_title' => 'Test Post', 'author_name' => 'Jane' ],
            true // is_published
        );

        $this->assertInstanceOf( Notification::class, $received_notification );
        $this->assertSame( 'published', $received_notification->type );
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function make_channel( string $id, bool $configured = true ): NotificationChannel&Mockery\MockInterface
    {
        $channel = Mockery::mock( NotificationChannel::class );
        $channel->shouldReceive( 'get_id' )->andReturn( $id );
        $channel->shouldReceive( 'is_configured' )->andReturn( $configured )->byDefault();
        $channel->shouldReceive( 'register_option' )->byDefault();
        return $channel;
    }
}
