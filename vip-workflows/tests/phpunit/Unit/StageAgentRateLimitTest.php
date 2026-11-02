<?php
/**
 * StageAgent interactive AI run ceiling.
 *
 * The per-user hourly ceiling is off by default: interactive runs are uncapped
 * unless a site opts in by filtering `vip_workflows_ai_hourly_limit` to a
 * positive value. Cron and anonymous callers are always exempt.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

if ( ! defined( 'HOUR_IN_SECONDS' ) ) {
    define( 'HOUR_IN_SECONDS', 3600 );
}

/**
 * Tests for StageAgent::check_rate_limit().
 */
class StageAgentRateLimitTest extends TestCase
{
    /**
     * Backing store for the mocked transient counter.
     *
     * @var array<string, int>
     */
    private array $store = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = array();

        // Default: an interactive, logged-in caller.
        Functions\when( 'wp_doing_cron' )->justReturn( false );
        Functions\when( 'get_current_user_id' )->justReturn( 7 );

        // A stateful transient double so the counter accumulates across calls.
        Functions\when( 'get_transient' )->alias(
            function ( $key ) {
                return $this->store[ $key ] ?? false;
            }
        );
        Functions\when( 'set_transient' )->alias(
            function ( $key, $value ) {
                $this->store[ $key ] = $value;
                return true;
            }
        );
    }

    /**
     * Invoke the private static ceiling check.
     *
     * @return true|\WP_Error
     */
    private function invoke_rate_limit()
    {
        // ReflectionMethod::invoke() reaches a private method directly on
        // PHP 8.1+; setAccessible() is a deprecated no-op and the suite bans it.
        $method = new \ReflectionMethod( StageAgent::class, 'check_rate_limit' );
        return $method->invoke( null );
    }

    /**
     * Set the opt-in cap the filter would return.
     *
     * @param int $cap Runs per user per hour, or 0 to leave uncapped.
     */
    private function set_cap( int $cap ): void
    {
        Functions\when( 'apply_filters' )->alias(
            function ( $tag, $value = null ) use ( $cap ) {
                return 'vip_workflows_ai_hourly_limit' === $tag ? $cap : $value;
            }
        );
    }

    /**
     * With no opt-in, the default filter value is 0 and runs are never capped.
     */
    public function test_default_leaves_interactive_runs_uncapped(): void
    {
        // The base test case stubs apply_filters as a passthrough of its
        // default, so no cap is configured here — this is the shipped default.
        for ( $i = 0; $i < 500; $i++ ) {
            $this->assertTrue( $this->invoke_rate_limit(), "run $i should be allowed" );
        }

        // Uncapped means the code returns before ever touching the counter.
        $this->assertSame( array(), $this->store );
    }

    /**
     * A zero or negative opt-in value is treated as uncapped.
     */
    public function test_non_positive_cap_is_uncapped(): void
    {
        $this->set_cap( 0 );
        $this->assertTrue( $this->invoke_rate_limit() );

        $this->set_cap( -5 );
        $this->assertTrue( $this->invoke_rate_limit() );

        $this->assertSame( array(), $this->store );
    }

    /**
     * A positive opt-in cap allows exactly that many runs, then refuses.
     */
    public function test_opt_in_cap_refuses_once_reached(): void
    {
        $this->set_cap( 3 );

        $this->assertTrue( $this->invoke_rate_limit() );
        $this->assertTrue( $this->invoke_rate_limit() );
        $this->assertTrue( $this->invoke_rate_limit() );

        $blocked = $this->invoke_rate_limit();
        $this->assertInstanceOf( \WP_Error::class, $blocked );
        $this->assertSame( 'vip_workflows_ai_rate_limited', $blocked->get_error_code() );
        $this->assertSame( array( 'status' => 429 ), $blocked->get_error_data() );
    }

    /**
     * Unattended cron runs are exempt even when a cap is configured.
     */
    public function test_cron_context_is_exempt_from_any_cap(): void
    {
        $this->set_cap( 1 );
        Functions\when( 'wp_doing_cron' )->justReturn( true );

        for ( $i = 0; $i < 10; $i++ ) {
            $this->assertTrue( $this->invoke_rate_limit() );
        }
    }

    /**
     * An anonymous caller (no user) is exempt even when a cap is configured.
     */
    public function test_anonymous_caller_is_exempt_from_any_cap(): void
    {
        $this->set_cap( 1 );
        Functions\when( 'get_current_user_id' )->justReturn( 0 );

        for ( $i = 0; $i < 10; $i++ ) {
            $this->assertTrue( $this->invoke_rate_limit() );
        }
    }
}
