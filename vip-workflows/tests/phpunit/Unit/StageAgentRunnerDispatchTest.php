<?php
/**
 * StageAgentRunner dispatch unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Workflow\StageAgentRunner;

/**
 * Tests for StageAgentRunner::maybe_dispatch().
 */
class StageAgentRunnerDispatchTest extends TestCase
{
    /**
     * Runner under test.
     *
     * @var StageAgentRunner
     */
    private StageAgentRunner $runner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->runner = new StageAgentRunner();
    }

    /**
     * Build a Sequence mock whose get_status() returns the given status.
     *
     * @param array|null $status Status config to return.
     * @return object
     */
    private function sequence_with_status( ?array $status ): object
    {
        $sequence = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'get_status' )->andReturn( $status );
        return $sequence;
    }

    /**
     * Entering an AI stage writes a pending job marker and schedules the run hook.
     */
    public function test_dispatch_schedules_job_and_writes_pending_meta(): void
    {
        $captured = null;
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\expect( 'update_post_meta' )
            ->once()
            ->andReturnUsing(
                function ( $post_id, $key, $value ) use ( &$captured ) {
                    $captured = array( $post_id, $key, $value );
                    return true;
                }
            );
        Functions\expect( 'wp_schedule_single_event' )
            ->once()
            ->with( Mockery::type( 'int' ), StageAgentRunner::RUN_HOOK, array( 42, 'ai_desk' ), true )
            ->andReturn( true );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => array( 'error' => 'review' ),
                ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'draft', $sequence );

        $this->assertNotNull( $captured );
        $this->assertSame( 42, $captured[0] );
        $this->assertSame( StageAgentRunner::JOB_META, $captured[1] );
        $this->assertSame( 'pending', $captured[2]['status'] );
        $this->assertSame( 'ai_desk', $captured[2]['stage_key'] );
        $this->assertSame( 'workflow-agent-reformat-to-template/reformat-to-template', $captured[2]['ability_id'] );
    }

    /**
     * When the run cannot be scheduled, the job is not left pending: it fails
     * in place so the editor surfaces the error and a Re-run action.
     */
    public function test_dispatch_fails_in_place_when_scheduling_fails(): void
    {
        $writes = array();
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$writes ) {
                if ( StageAgentRunner::JOB_META === $key ) {
                    $writes[] = $value;
                }
                return true;
            }
        );
        Functions\when( 'wp_schedule_single_event' )->justReturn(
            new \WP_Error( 'could_not_set', 'cron store unavailable' )
        );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => array( 'error' => 'review' ),
                ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'draft', $sequence );

        $last = end( $writes );
        $this->assertSame( 'failed', $last['status'] );
        $this->assertSame( 'cron store unavailable', $last['error'] );
    }

    /**
     * A duplicate-event scheduling result is success, not failure: an identical
     * event (same post + stage) is already queued — e.g. a reseat round-trip
     * (A→B→A) while A's original run event is still pending — and will serve
     * the freshly written pending marker. The job must stay pending; no
     * spurious visible failure.
     */
    public function test_dispatch_treats_duplicate_event_as_already_queued(): void
    {
        $writes = array();
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$writes ) {
                if ( StageAgentRunner::JOB_META === $key ) {
                    $writes[] = $value;
                }
                return true;
            }
        );
        Functions\when( 'wp_schedule_single_event' )->justReturn(
            new \WP_Error( 'duplicate_event', 'A duplicate event already exists.' )
        );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => array( 'error' => 'review' ),
                ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'draft', $sequence );

        $last = end( $writes );
        $this->assertSame( 'pending', $last['status'], 'The pending marker survives — the queued event will serve it.' );
    }

    /**
     * A non-AI stage schedules nothing and writes no marker.
     */
    public function test_dispatch_is_noop_for_non_agent_stage(): void
    {
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_schedule_single_event' )->never();

        $sequence = $this->sequence_with_status( array( 'key' => 'draft' ) );
        $this->runner->maybe_dispatch( 42, 'draft', 'new', $sequence );

        $this->addToAssertionCount( 1 );
    }

    /**
     * A no-op transition (new === old) never dispatches.
     */
    public function test_dispatch_is_noop_when_status_unchanged(): void
    {
        Functions\expect( 'wp_schedule_single_event' )->never();

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'x', 'routing' => array( 'error' => 'review' ) ),
            )
        );
        $this->runner->maybe_dispatch( 42, 'ai_desk', 'ai_desk', $sequence );

        $this->addToAssertionCount( 1 );
    }

    /**
     * Re-entering the same AI stage while a job is already pending does not
     * schedule a second job.
     */
    public function test_dispatch_does_not_double_schedule_when_pending(): void
    {
        Functions\when( 'get_post_meta' )->justReturn(
            array(
                'stage_key'  => 'ai_desk',
                'status'     => 'pending',
                'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
            )
        );
        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_schedule_single_event' )->never();

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => array( 'error' => 'review' ),
                ),
            )
        );
        $this->runner->maybe_dispatch( 42, 'ai_desk', 'draft', $sequence );

        $this->addToAssertionCount( 1 );
    }
}
