<?php
/**
 * AgentRunner unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Workflow\AgentRunner;

/**
 * Tests for AgentRunner.
 */
class AgentRunnerTest extends TestCase
{
    /**
     * An unknown agent ID is logged as a bounded token, so it cannot forge log entries.
     */
    public function test_unknown_agent_is_logged_as_a_token(): void
    {
        Functions\expect( 'wp_schedule_single_event' )->never();

        // phpunit.xml routes error_log to /dev/null; capture it here.
        $log_file = tempnam( sys_get_temp_dir(), 'vipwf-log-' );
        $previous = ini_set( 'error_log', $log_file );
        try {
            ( new AgentRunner() )->queue_agent_task( 42, "seo-checker\n[VIP Workflows] forged entry", array() );
        } finally {
            ini_set( 'error_log', $previous );
        }
        $log = (string) file_get_contents( $log_file );
        unlink( $log_file );

        $this->assertStringContainsString( '[VIP Workflows] Unknown agent: post=42 agent=seo-checkerVIPWorkflowsforgedentry' . "\n", $log );
        $this->assertSame( 1, substr_count( $log, "\n" ), 'One whole log entry.' );
    }
}
