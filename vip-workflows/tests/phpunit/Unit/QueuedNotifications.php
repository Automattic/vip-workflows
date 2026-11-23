<?php
/**
 * Helpers for tests of queued notification delivery.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Notifications\NotificationDispatcher;

/**
 * Records Action Scheduler enqueues, runs them, and keeps transients in memory.
 *
 * The unit suite has no Action Scheduler, so every test that reaches an enqueue
 * stubs `as_enqueue_async_action` explicitly, through capture_enqueues() here.
 */
trait QueuedNotifications
{
    /**
     * Enqueues recorded by capture_enqueues(), in call order.
     *
     * @var array<int, array{hook: string, args: array, group: string}>
     */
    private array $enqueued = array();

    /**
     * Transients written during the test, keyed by name.
     *
     * @var array<string, mixed>
     */
    private array $transients = array();

    /**
     * Record every enqueue and return a fresh action ID for each.
     */
    private function capture_enqueues(): void
    {
        $this->enqueued = array();
        Functions\when( 'as_enqueue_async_action' )->alias(
            function ( $hook, $args = array(), $group = '' ) {
                $this->enqueued[] = array(
                    'hook'  => $hook,
                    'args'  => $args,
                    'group' => $group,
                );
                return count( $this->enqueued );
            }
        );
    }

    /**
     * Keep transients in memory, so the debounce behaves as it does on a site.
     */
    private function stub_transients(): void
    {
        $this->transients = array();
        Functions\when( 'get_transient' )->alias(
            fn( $key ) => $this->transients[ $key ] ?? false
        );
        Functions\when( 'set_transient' )->alias(
            function ( $key, $value ) {
                $this->transients[ $key ] = $value;
                return true;
            }
        );
    }

    /**
     * Stub what the job reads from the live post when it runs.
     *
     * @param object $post The post get_post() returns.
     */
    private function stub_send_time_reads( object $post ): void
    {
        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Jane' ) );
        Functions\when( 'get_permalink' )->justReturn( 'https://example.com/view' );
        Functions\when( 'get_post_type_object' )->justReturn( (object) array( '_edit_link' => 'post.php?post=%d' ) );
        Functions\when( 'admin_url' )->alias( fn( $path = '' ) => 'https://example.com/wp-admin/' . $path );
        // Already in the site language, as in a cron or async runner.
        Functions\when( 'get_locale' )->justReturn( 'en_US' );
        Functions\when( 'switch_to_locale' )->justReturn( false );
    }

    /**
     * Run every recorded job through the dispatcher, as the queue runner would.
     *
     * @param NotificationDispatcher $dispatcher Dispatcher whose handler runs the jobs.
     */
    private function run_enqueued( NotificationDispatcher $dispatcher ): void
    {
        foreach ( $this->enqueued as $job ) {
            $dispatcher->handle_async_send(
                $job['args']['channel_id'],
                $job['args']['event_type'],
                $job['args']['data']
            );
        }
    }

    /**
     * Assert that a job's stored data holds no post content.
     *
     * @param array $data The job's `data` argument.
     */
    private function assert_event_facts_only( array $data ): void
    {
        foreach ( array( 'post_title', 'author_name', 'edit_url', 'view_url' ) as $key ) {
            $this->assertArrayNotHasKey( $key, $data, "The job must not store {$key}; it is read when the job runs." );
        }
    }
}
