<?php
/**
 * Notification rate-limit TTL hardening.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Notifications\NotificationDispatcher;

/**
 * The debounce transient must use a real interval, not the old 1-second window
 * that was effectively no rate limit.
 */
class NotificationRateLimitTtlTest extends TestCase
{
    public function test_rate_limit_ttl_defaults_to_a_meaningful_interval(): void
    {
        $captured_ttl = null;
        Functions\when( 'set_transient' )->alias(
            function ( $key, $value, $ttl ) use ( &$captured_ttl ) {
                $captured_ttl = $ttl;
                return true;
            }
        );

        $dispatcher = ( new \ReflectionClass( NotificationDispatcher::class ) )->newInstanceWithoutConstructor();
        $method     = new \ReflectionMethod( NotificationDispatcher::class, 'update_rate_limit' );
        $method->invoke( $dispatcher, 'slack', 'entered_review', array( 'post_id' => 5 ) );

        $this->assertSame( 60, $captured_ttl );
        $this->assertGreaterThan( 1, $captured_ttl );
    }
}
