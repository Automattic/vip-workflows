<?php
/**
 * Required dependencies and programming errors must fail loudly.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Notifications\NotificationChannel;
use VIPWorkflows\Notifications\NotificationDispatcher;

class NotificationDispatcherEnqueueErrorsTest extends TestCase
{
    /**
     * Brain Monkey function definitions survive teardown, so absence requires
     * a fresh process with no restored globals from other dispatcher tests.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_a_missing_action_scheduler_is_not_treated_as_a_delivery_failure(): void
    {
        $this->assertFalse( function_exists( 'as_enqueue_async_action' ) );
        $this->expectException( \Error::class );
        $this->expectExceptionMessage( 'undefined function' );

        $this->queue_one_channel();
    }

    public function test_an_enqueue_type_error_is_not_treated_as_a_delivery_failure(): void
    {
        Functions\when( 'as_enqueue_async_action' )->alias(
            static function () {
                throw new \TypeError( 'Invalid enqueue arguments.' );
            }
        );
        $this->expectException( \TypeError::class );
        $this->expectExceptionMessage( 'Invalid enqueue arguments.' );

        $this->queue_one_channel();
    }

    private function queue_one_channel(): void
    {
        Functions\when( 'register_setting' )->justReturn( true );
        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'get_transient' )->justReturn( false );
        Functions\expect( 'set_transient' )->never();

        $channel = Mockery::mock( NotificationChannel::class );
        $channel->shouldReceive( 'get_id' )->andReturn( 'review-fixture' );
        $channel->shouldReceive( 'is_configured' )->andReturn( true );
        $channel->shouldReceive( 'register_option' );
        $channel->shouldNotReceive( 'send' );

        $dispatcher = new NotificationDispatcher();
        $dispatcher->register_channel( $channel );
        $dispatcher->queue_transition_notifications(
            array( 'notifications' => array( 'review-fixture' ) ),
            array( 'post_id' => 42 ),
            false
        );
    }
}
