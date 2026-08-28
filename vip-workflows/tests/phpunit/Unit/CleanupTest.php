<?php
/**
 * Cleanup unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Maintenance\Cleanup;

/**
 * Tests for the nightly cleanup routine.
 *
 * The routine reports through the audit log rather than a screen of its own, so
 * what a run writes to the events table *is* its user-visible output. These
 * cover that: a clean run states what it deleted, and a failed DELETE is
 * reported as a failure rather than as zero rows.
 */
class CleanupTest extends TestCase
{
    /**
     * Mock wpdb instance.
     *
     * @var object
     */
    private $wpdb;

    /**
     * Routine under test.
     *
     * @var Cleanup
     */
    private Cleanup $cleanup;

    protected function setUp(): void
    {
        parent::setUp();

        $this->wpdb         = Mockery::mock( 'wpdb' );
        $this->wpdb->prefix = 'wp_';
        $this->wpdb->last_error = '';
        $this->wpdb->shouldReceive( 'prepare' )->andReturnUsing(
            static fn( $query ) => $query
        );

        global $wpdb;
        $wpdb = $this->wpdb;

        Functions\when( 'wp_date' )->justReturn( '2026-01-01 00:00:00' );
        Functions\when( 'current_time' )->justReturn( '2026-08-27 02:00:00' );

        $this->cleanup = new Cleanup();
    }

    /**
     * Capture the single event row a run writes.
     *
     * @return array The decoded event_data of the recorded run.
     */
    private function run_and_capture(): array
    {
        $recorded = array();
        $target   = '';

        $this->wpdb->shouldReceive( 'insert' )
            ->once()
            ->andReturnUsing(
                function ( $table, $data ) use ( &$recorded, &$target ) {
                    $target   = $table;
                    $recorded = $data;
                    return true;
                }
            );

        $this->cleanup->run();

        $this->assertSame( 'wp_vip_workflows_events', $target );
        $this->assertSame( Cleanup::EVENT_TYPE, $recorded['event_type'] );

        return array( $recorded, json_decode( $recorded['event_data'], true ) );
    }

    public function test_a_run_records_what_it_deleted(): void
    {
        $this->wpdb->shouldReceive( 'query' )->twice()->andReturn( 12, 3 );

        [ , $data ] = $this->run_and_capture();

        $this->assertSame( 12, $data['ability_results_deleted'] );
        $this->assertSame( 3, $data['events_deleted'] );
        $this->assertSame( array(), $data['errors'] );
    }

    /**
     * A failed DELETE returns false, which is not the same as deleting nothing.
     *
     * Reporting it as 0 would make a broken run read exactly like a clean one
     * that found nothing to prune — the failure mode the audit entry exists to
     * catch.
     */
    public function test_a_failed_delete_is_reported_as_an_error_not_as_zero_rows(): void
    {
        $this->wpdb->last_error = 'Table is marked as crashed';
        $this->wpdb->shouldReceive( 'query' )->twice()->andReturn( false, 4 );

        [ , $data ] = $this->run_and_capture();

        $this->assertNull( $data['ability_results_deleted'] );
        $this->assertSame( 4, $data['events_deleted'] );
        $this->assertContains( 'Table is marked as crashed', $data['errors'] );
    }

    /**
     * The run belongs to nobody, so it must not be credited to whoever is
     * logged in when cron happens to fire.
     */
    public function test_the_entry_carries_no_post_and_no_user(): void
    {
        $this->wpdb->shouldReceive( 'query' )->twice()->andReturn( 0, 0 );

        [ $recorded ] = $this->run_and_capture();

        $this->assertNull( $recorded['post_id'] );
        $this->assertSame( 0, $recorded['actor_id'] );
        $this->assertSame( 'system', $recorded['actor_type'] );
    }

    /**
     * Scheduling is skipped when Action Scheduler is not loaded, rather than
     * fataling on an undefined function.
     */
    public function test_scheduling_is_a_no_op_without_action_scheduler(): void
    {
        $this->cleanup->schedule();
        $this->cleanup->unschedule();

        $this->assertFalse( function_exists( 'as_schedule_recurring_action' ) );
    }
}
