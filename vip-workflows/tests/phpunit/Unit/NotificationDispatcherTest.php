<?php
/**
 * NotificationDispatcher unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Notifications\Notification;
use VIPWorkflows\Notifications\NotificationChannel;
use VIPWorkflows\Notifications\NotificationDispatcher;

/**
 * Smoke tests for NotificationDispatcher.
 *
 * Tests channel registration, dispatch routing, queueing, the queued send, and
 * static helpers. Tests that call get_channel() / get_channels() trigger the
 * internal register_channels() guard, which instantiates SlackChannel +
 * EmailChannel; setUp() stubs the WP functions those classes require.
 */
class NotificationDispatcherTest extends TestCase
{
    use QueuedNotifications;

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
        Functions\expect( 'as_enqueue_async_action' )->never();

        $this->dispatcher->dispatch( 'published', [ 'post_id' => 1 ] );
        $this->addToAssertionCount( 1 );
    }

    // -------------------------------------------------------------------------
    // dispatch: channel not configured
    // -------------------------------------------------------------------------

    public function test_dispatch_skips_unconfigured_channel(): void
    {
        $this->stub_matrix_routing( [ 'published' => [ 'slack' ] ] );
        Functions\expect( 'as_enqueue_async_action' )->never();

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
        $this->stub_matrix_routing( [ 'transition' => [ 'slack' ] ] ); // only transition → slack
        Functions\expect( 'as_enqueue_async_action' )->never();

        $channel = $this->make_channel( 'slack', configured: true );
        $channel->shouldNotReceive( 'send' );
        // Routing has no entry for 'published', which is the whole answer now —
        // there is no per-channel list left to fall back to.

        $this->dispatcher->register_channel( $channel );
        $this->dispatcher->dispatch( 'published', [ 'post_id' => 1 ] );
    }

    public function test_dispatch_queues_one_job_per_routed_channel_and_sends_nothing(): void
    {
        $this->stub_matrix_routing( [ 'published' => [ 'slack' ] ] );
        $this->stub_transients();
        $this->capture_enqueues();

        $channel = $this->make_channel( 'slack' );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->dispatch( 'published', [ 'post_id' => 42, 'stage' => 'live' ] );

        $this->assertSame(
            [
                [
                    'hook'  => 'vip_workflows_send_notification',
                    'args'  => [
                        'channel_id' => 'slack',
                        'event_type' => 'published',
                        'data'       => [ 'post_id' => 42, 'stage' => 'live' ],
                    ],
                    'group' => 'vip-workflows-notifications',
                ],
            ],
            $this->enqueued
        );
        $this->assertArrayHasKey( 'vip_notification_slack_published_42', $this->transients );
    }

    public function test_dispatch_skips_a_channel_still_inside_the_debounce_window(): void
    {
        $this->stub_matrix_routing( [ 'published' => [ 'slack' ] ] );
        Functions\when( 'get_transient' )->alias(
            fn( $key ) => 'vip_notification_slack_published_42' === $key ? time() : false
        );
        Functions\expect( 'as_enqueue_async_action' )->never();

        $this->dispatcher->register_channel( $this->make_channel( 'slack' ) );
        $this->dispatcher->dispatch( 'published', [ 'post_id' => 42 ] );

        $this->addToAssertionCount( 1 );
    }

    // -------------------------------------------------------------------------
    // queue_transition_notifications
    // -------------------------------------------------------------------------

    public function test_queue_transition_notifications_does_nothing_for_empty_notifications(): void
    {
        Functions\expect( 'as_enqueue_async_action' )->never();

        $this->dispatcher->queue_transition_notifications( [ 'notifications' => [] ], [ 'post_id' => 1 ], false );

        $this->addToAssertionCount( 1 );
    }

    public function test_queue_transition_notifications_skips_unregistered_and_unconfigured_channels(): void
    {
        $this->stub_transients();
        Functions\expect( 'as_enqueue_async_action' )->never();

        $channel = $this->make_channel( 'slack', configured: false );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->queue_transition_notifications(
            [ 'notifications' => [ 'slack', 'not-registered' ] ],
            [ 'post_id' => 1 ],
            false
        );

        $this->assertSame( [], $this->transients );
    }

    public function test_queue_transition_notifications_queues_each_listed_channel_and_sends_nothing(): void
    {
        $this->stub_transients();
        $this->capture_enqueues();

        foreach ( [ 'slack', 'mail' ] as $id ) {
            $channel = $this->make_channel( $id );
            $channel->shouldNotReceive( 'send' );
            $this->dispatcher->register_channel( $channel );
        }

        $this->dispatcher->queue_transition_notifications(
            [ 'notifications' => [ 'slack', 'mail' ] ],
            [ 'post_id' => 7, 'from_label' => 'Draft', 'to_label' => 'Review' ],
            false
        );

        $this->assertSame( [ 'slack', 'mail' ], array_map( fn( $job ) => $job['args']['channel_id'], $this->enqueued ) );
        $this->assertSame( [ 'transition', 'transition' ], array_map( fn( $job ) => $job['args']['event_type'], $this->enqueued ) );
        $this->assertSame(
            [ 'vip_notification_slack_transition_7', 'vip_notification_mail_transition_7' ],
            array_keys( $this->transients )
        );
    }

    public function test_queue_transition_notifications_uses_published_event_type_for_a_go_live(): void
    {
        $this->stub_transients();
        $this->capture_enqueues();
        $this->dispatcher->register_channel( $this->make_channel( 'slack' ) );

        $this->dispatcher->queue_transition_notifications( [ 'notifications' => [ 'slack' ] ], [ 'post_id' => 1 ], true );

        $this->assertCount( 1, $this->enqueued );
        $this->assertSame( 'published', $this->enqueued[0]['args']['event_type'] );
    }

    /**
     * Action Scheduler returns 0 when it couldn't store the job: no debounce is
     * left behind, nothing is thrown, and the next channel is still queued.
     */
    public function test_a_job_that_was_not_queued_sets_no_debounce_and_the_next_channel_still_queues(): void
    {
        $this->stub_transients();
        $calls = [];
        Functions\when( 'as_enqueue_async_action' )->alias(
            function ( $hook, $args ) use ( &$calls ) {
                $calls[] = $args['channel_id'];
                return 'slack' === $args['channel_id'] ? 0 : 99;
            }
        );

        $this->dispatcher->register_channel( $this->make_channel( 'slack' ) );
        $this->dispatcher->register_channel( $this->make_channel( 'mail' ) );

        $this->dispatcher->queue_transition_notifications( [ 'notifications' => [ 'slack', 'mail' ] ], [ 'post_id' => 3 ], false );

        $this->assertSame( [ 'slack', 'mail' ], $calls );
        $this->assertSame( [ 'vip_notification_mail_transition_3' ], array_keys( $this->transients ) );
    }

    /**
     * An enqueue that throws (a store error, oversized arguments) is caught, sets
     * no debounce, and doesn't stop the next channel.
     */
    public function test_an_enqueue_that_throws_is_caught_and_the_next_channel_still_queues(): void
    {
        $this->stub_transients();
        $calls = [];
        Functions\when( 'as_enqueue_async_action' )->alias(
            function ( $hook, $args ) use ( &$calls ) {
                $calls[] = $args['channel_id'];
                if ( 'slack' === $args['channel_id'] ) {
                    throw new \RuntimeException( 'Error saving action.' );
                }
                return 99;
            }
        );

        $this->dispatcher->register_channel( $this->make_channel( 'slack' ) );
        $this->dispatcher->register_channel( $this->make_channel( 'mail' ) );

        $this->dispatcher->queue_transition_notifications( [ 'notifications' => [ 'slack', 'mail' ] ], [ 'post_id' => 3 ], false );

        $this->assertSame( [ 'slack', 'mail' ], $calls );
        $this->assertSame( [ 'vip_notification_mail_transition_3' ], array_keys( $this->transients ) );
    }

    // -------------------------------------------------------------------------
    // handle_async_send
    // -------------------------------------------------------------------------

    public function test_handle_async_send_skips_unknown_channel(): void
    {
        Functions\expect( 'get_post' )->never();

        $this->dispatcher->handle_async_send( 'nonexistent', 'published', [] );
        $this->addToAssertionCount( 1 );
    }

    public function test_handle_async_send_skips_unconfigured_channel(): void
    {
        Functions\expect( 'get_post' )->never();

        $channel = $this->make_channel( 'email', configured: false );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->handle_async_send( 'email', 'published', [] );
    }

    /**
     * Title, author and links come from the live post when the job runs; the
     * stage labels come from the job. A title stored by an older job is
     * overwritten by the live one.
     */
    public function test_handle_async_send_renders_the_live_title_with_the_stored_labels(): void
    {
        $this->stub_send_time_reads( $this->create_mock_post( [ 'ID' => 42, 'post_title' => 'Renamed headline' ] ) );

        $received = null;
        $channel  = $this->make_channel( 'slack' );
        $channel->shouldReceive( 'send' )->once()->andReturnUsing(
            function ( Notification $notification ) use ( &$received ) {
                $received = $notification;
                return true;
            }
        );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->handle_async_send(
            'slack',
            'transition',
            [
                'post_id'    => 42,
                'post_title' => 'Headline when queued',
                'from_label' => 'Writing',
                'to_label'   => 'Copy desk',
            ]
        );

        $this->assertInstanceOf( Notification::class, $received );
        $this->assertSame( '“Renamed headline” moved from Writing to Copy desk', $received->message );
        $this->assertSame( 'Renamed headline', $received->data['post_title'] );
        $this->assertSame( 'Jane', $received->data['author_name'] );
        $this->assertSame( 'https://example.com/view', $received->data['view_url'] );
    }

    /**
     * Every queued job carries a post ID, so a job without one is malformed and
     * fails. get_post( 0 ) would return the global post, an unrelated one.
     */
    public function test_handle_async_send_fails_a_job_without_a_post_id(): void
    {
        Functions\expect( 'get_post' )->never();

        $channel = $this->make_channel( 'slack' );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $this->expectException( \RuntimeException::class );
        $this->expectExceptionMessage( 'Notification job for channel "slack" has no post ID.' );
        $this->dispatcher->handle_async_send( 'slack', 'transition', [ 'from_label' => 'Writing' ] );
    }

    /**
     * A failed send throws, so Action Scheduler marks the job Failed. The message
     * names the channel and the post, not the post's content.
     */
    public function test_handle_async_send_fails_the_job_when_the_channel_does_not_deliver(): void
    {
        $this->stub_send_time_reads( $this->create_mock_post( [ 'ID' => 42, 'post_title' => 'Secret headline' ] ) );

        $channel = $this->make_channel( 'slack' );
        $channel->shouldReceive( 'send' )->once()->andReturn( false );
        $this->dispatcher->register_channel( $channel );

        $this->expectException( \RuntimeException::class );
        $this->expectExceptionMessage( 'Channel "slack" did not deliver the "transition" notification for post 42.' );
        $this->dispatcher->handle_async_send( 'slack', 'transition', [ 'post_id' => 42 ] );
    }

    public function test_handle_async_send_sends_nothing_for_a_deleted_post(): void
    {
        Functions\when( 'get_post' )->justReturn( null );

        $channel = $this->make_channel( 'slack' );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->handle_async_send( 'slack', 'transition', [ 'post_id' => 42 ] );
    }

    public function test_handle_async_send_sends_nothing_for_a_trashed_post(): void
    {
        $this->stub_send_time_reads( $this->create_mock_post( [ 'ID' => 42, 'post_status' => 'trash' ] ) );

        $channel = $this->make_channel( 'slack' );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->handle_async_send( 'slack', 'transition', [ 'post_id' => 42 ] );
    }

    /**
     * The queue runner has no current user, so get_edit_post_link() would return
     * nothing there. The link is built without a capability check.
     */
    public function test_handle_async_send_builds_the_edit_link_without_a_current_user(): void
    {
        $this->stub_send_time_reads( $this->create_mock_post( [ 'ID' => 42 ] ) );
        Functions\expect( 'get_edit_post_link' )->never();
        Functions\expect( 'current_user_can' )->never();

        $received = null;
        $channel  = $this->make_channel( 'slack' );
        $channel->shouldReceive( 'send' )->once()->andReturnUsing(
            function ( Notification $notification ) use ( &$received ) {
                $received = $notification;
                return true;
            }
        );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->handle_async_send( 'slack', 'transition', [ 'post_id' => 42 ] );

        $this->assertSame( 'https://example.com/wp-admin/post.php?post=42&action=edit', $received->get_post_url( 'edit' ) );
    }

    /**
     * An administrator can run a job by hand from Scheduled Actions in another
     * profile language. The message is built in the site language, and the
     * previous locale comes back even when the channel throws.
     */
    public function test_handle_async_send_switches_to_the_site_language_and_restores_it(): void
    {
        Functions\when( 'get_post' )->justReturn( $this->create_mock_post( [ 'ID' => 42 ] ) );
        Functions\when( 'get_userdata' )->justReturn( false );
        Functions\when( 'get_permalink' )->justReturn( 'https://example.com/view' );
        Functions\when( 'get_post_type_object' )->justReturn( null );
        Functions\when( 'get_locale' )->justReturn( 'fr_FR' );
        Functions\expect( 'switch_to_locale' )->once()->with( 'fr_FR' )->andReturn( true );
        Functions\expect( 'restore_previous_locale' )->once()->andReturn( 'de_DE' );

        $channel = $this->make_channel( 'slack' );
        $channel->shouldReceive( 'send' )->once()->andThrow( new \RuntimeException( 'Channel failed.' ) );
        $this->dispatcher->register_channel( $channel );

        $this->expectException( \RuntimeException::class );
        $this->dispatcher->handle_async_send( 'slack', 'transition', [ 'post_id' => 42 ] );
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
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Configure the global event-matrix routing option.
     *
     * @param array $routing Event type => channel IDs.
     */
    private function stub_matrix_routing( array $routing ): void
    {
        Functions\when( 'get_option' )->alias(
            function ( $option, $default = [] ) use ( $routing ) {
                if ( 'vip_workflows_notification_routing' === $option ) {
                    return $routing;
                }
                return $default;
            }
        );
    }

    private function make_channel( string $id, bool $configured = true ): NotificationChannel&Mockery\MockInterface
    {
        $channel = Mockery::mock( NotificationChannel::class );
        $channel->shouldReceive( 'get_id' )->andReturn( $id );
        $channel->shouldReceive( 'is_configured' )->andReturn( $configured )->byDefault();
        $channel->shouldReceive( 'register_option' )->byDefault();
        return $channel;
    }
}
