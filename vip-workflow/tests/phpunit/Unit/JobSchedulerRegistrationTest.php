<?php
/**
 * JobScheduler registration-contract unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Mockery;
use VIPWorkflow\Jobs\Job;
use VIPWorkflow\Jobs\JobScheduler;

/**
 * A job's ID is whatever its `get_id()` returns, and the REST routes address a
 * job by that ID under the `sanitize_key()` character class (see
 * JobsControllerRoutesTest). A job registered under anything else lists in the
 * admin and then 404s on both /run and /settings — un-runnable and
 * un-configurable, with nothing anywhere saying why. These tests pin the
 * registration end of that contract: the scheduler refuses such an ID and says
 * so, and accepts every ID the routes can actually serve.
 */
class JobSchedulerRegistrationTest extends TestCase
{
    private JobScheduler $scheduler;

    protected function set_up()
    {
        parent::set_up();

        $this->scheduler = new JobScheduler();
    }

    /**
     * An ID outside the `sanitize_key()` class is refused, and the refusal is
     * reported the same way a duplicate ID is — a warning naming the offender.
     *
     * @dataProvider provide_unservable_job_ids
     *
     * @param string $job_id Candidate job ID.
     */
    public function test_register_job_refuses_an_id_no_route_can_serve( string $job_id ): void
    {
        $warnings = $this->capture_warnings(
            fn() => $this->scheduler->register_job( $this->job_with_id( $job_id ) )
        );

        $this->assertCount( 1, $warnings, sprintf( 'Job ID "%s" should have been reported.', $job_id ) );
        $this->assertStringContainsString( 'Invalid job ID', $warnings[0] );
        $this->assertStringContainsString( sprintf( '"%s"', $job_id ), $warnings[0] );
        $this->assertSame( array(), $this->scheduler->get_jobs(), 'The job must not be registered.' );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function provide_unservable_job_ids(): array
    {
        return array(
            'spaced and capitalized' => array( 'SLA Check' ),
            'uppercase'              => array( 'SlaCheck' ),
            'dotted'                 => array( 'sla.check' ),
            'path separator'         => array( 'sla/check' ),
            'empty'                  => array( '' ),
        );
    }

    /**
     * Every ID the routes match is registered without complaint, keyed by that
     * ID so `get_job()` — which is how both parameterized routes resolve the
     * path parameter — finds it.
     *
     * @dataProvider provide_servable_job_ids
     *
     * @param string $job_id Candidate job ID.
     */
    public function test_register_job_accepts_an_id_the_routes_serve( string $job_id ): void
    {
        $job = $this->job_with_id( $job_id );

        $warnings = $this->capture_warnings(
            fn() => $this->scheduler->register_job( $job )
        );

        $this->assertSame( array(), $warnings, sprintf( 'Job ID "%s" should not have been reported.', $job_id ) );
        $this->assertSame( $job, $this->scheduler->get_job( $job_id ) );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function provide_servable_job_ids(): array
    {
        return array(
            'shipped: sla_check'  => array( 'sla_check' ),
            'extension plugin ID' => array( 'airtable_daily_stats' ),
            'hyphenated'          => array( 'airtable-daily-stats' ),
            'digit at the end'    => array( 's3sync2' ),
        );
    }

    /**
     * A duplicate is still refused, and still reported — the guard added for
     * unservable IDs runs ahead of it and must not swallow it.
     */
    public function test_register_job_still_refuses_a_duplicate_id(): void
    {
        $first = $this->job_with_id( 'sla_check' );
        $this->scheduler->register_job( $first );

        $warnings = $this->capture_warnings(
            fn() => $this->scheduler->register_job( $this->job_with_id( 'sla_check' ) )
        );

        $this->assertCount( 1, $warnings );
        $this->assertStringContainsString( 'Duplicate job ID', $warnings[0] );
        $this->assertSame( $first, $this->scheduler->get_job( 'sla_check' ) );
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * A Job double that answers only `get_id()` — the one method registration
     * reads.
     *
     * @param  string $job_id ID the double reports.
     * @return Job
     */
    private function job_with_id( string $job_id ): Job
    {
        $job = Mockery::mock( Job::class );
        $job->shouldReceive( 'get_id' )->andReturn( $job_id );

        return $job;
    }

    /**
     * Collect the E_USER_WARNINGs a callback triggers.
     *
     * PHPUnit's own error handler turns a triggered warning into a thrown
     * `Warning`, which would end the test at the trigger site and leave the
     * "was it registered?" half of each assertion unreachable. Taking the
     * handler for the duration keeps the call returning normally.
     *
     * @param  callable $callback Code to run.
     * @return string[] Warning messages, in order.
     */
    private function capture_warnings( callable $callback ): array
    {
        $warnings = array();

        set_error_handler(
            function ( int $errno, string $errstr ) use ( &$warnings ): bool {
                $warnings[] = $errstr;
                return true;
            },
            E_USER_WARNING
        );

        try {
            $callback();
        } finally {
            restore_error_handler();
        }

        return $warnings;
    }
}
