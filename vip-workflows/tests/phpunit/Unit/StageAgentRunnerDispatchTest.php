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
use VIPWorkflows\Telemetry\Tracker;
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

        // The person whose move entered the stage.
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
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
     * Mark an agent exit transition as in progress for a post.
     *
     * @param int $post_id    The exiting run's post.
     * @param int $started_by The exiting run's starter.
     */
    private function exiting_run( int $post_id, int $started_by ): void
    {
        ( new \ReflectionProperty( StageAgentRunner::class, 'exiting_run' ) )->setValue(
            null,
            array(
                'post_id'    => $post_id,
                'started_by' => $started_by,
            )
        );
    }

    /**
     * Mock $wpdb for the rerun compare-and-swap.
     *
     * @param int|false $rows Rows the conditional UPDATE reports changed.
     * @param array     $seen Receives the update's data and where clauses.
     */
    private function wpdb_replacing( $rows, ?array &$seen = null ): void
    {
        global $wpdb;
        $wpdb           = Mockery::mock( 'wpdb' );
        $wpdb->postmeta = 'wp_postmeta';
        $wpdb->shouldReceive( 'update' )->andReturnUsing(
            function ( $table, $data, $where ) use ( $rows, &$seen ) {
                $seen = array( 'table' => $table, 'data' => $data, 'where' => $where );
                return $rows;
            }
        );
        Functions\when( 'wp_cache_delete' )->justReturn( true );
        Functions\when( 'maybe_serialize' )->alias( 'serialize' );
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
        $this->assertSame( 5, $captured[2]['started_by'], 'the run belongs to whoever moved the post in' );
    }

    /**
     * An agent's exit transition enters the next AI stage with nobody logged in.
     * The next run belongs to whoever started the chain, not to nobody.
     */
    public function test_an_agent_to_agent_hop_keeps_the_person_who_started_the_chain(): void
    {
        $captured = null;
        Functions\when( 'get_current_user_id' )->justReturn( 0 );
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'delete_post_meta' )->justReturn( true );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$captured ) {
                $captured = $value;
                return true;
            }
        );
        Functions\when( 'wp_schedule_single_event' )->justReturn( true );

        $this->exiting_run( 42, 3 );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'other_ai_desk', $sequence );

        $this->assertSame( 3, $captured['started_by'] );
    }

    /**
     * A hop dispatched while some other user is logged in (cron run with
     * `--user`, or a user an earlier callback left set) still belongs to the
     * chain's starter. The ambient user authorized nothing.
     */
    public function test_a_hop_ignores_an_ambient_user_and_keeps_the_chain_starter(): void
    {
        $captured = null;
        Functions\when( 'get_current_user_id' )->justReturn( 1 ); // an administrator, ambient
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'delete_post_meta' )->justReturn( true );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$captured ) {
                $captured = $value;
                return true;
            }
        );
        Functions\when( 'wp_schedule_single_event' )->justReturn( true );

        $this->exiting_run( 42, 3 );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'other_ai_desk', $sequence );

        $this->assertSame( 3, $captured['started_by'], 'the chain starter, not the ambient administrator' );
    }

    /**
     * A chain nobody started stays nobody's, even with an ambient user, so the
     * next stage falls back to the author rather than borrowing that user.
     */
    public function test_a_hop_from_a_chain_nobody_started_does_not_borrow_an_ambient_user(): void
    {
        $captured = null;
        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'delete_post_meta' )->justReturn( true );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$captured ) {
                $captured = $value;
                return true;
            }
        );
        Functions\when( 'wp_schedule_single_event' )->justReturn( true );

        $this->exiting_run( 42, 0 );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'other_ai_desk', $sequence );

        $this->assertSame( 0, $captured['started_by'] );
    }

    /**
     * A callback inside one post's agent exit can move ANOTHER post into an AI
     * stage. That post's run does not borrow the exiting run's starter.
     */
    public function test_a_nested_dispatch_for_another_post_does_not_borrow_the_exiting_starter(): void
    {
        $captured = null;
        Functions\when( 'get_current_user_id' )->justReturn( 0 );
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'delete_post_meta' )->justReturn( true );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$captured ) {
                $captured = $value;
                return true;
            }
        );
        Functions\when( 'wp_schedule_single_event' )->justReturn( true );

        $this->exiting_run( 7, 3 ); // post 7's agent is exiting, started by user 3

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'draft', $sequence );

        $this->assertSame( 0, $captured['started_by'], 'post 42 is not post 7; its run is nobody\'s' );
    }

    /**
     * Under cron, nobody moved the post, whoever happens to be logged in.
     */
    public function test_a_dispatch_under_cron_ignores_an_ambient_user(): void
    {
        $captured = null;
        Functions\when( 'wp_doing_cron' )->justReturn( true );
        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'delete_post_meta' )->justReturn( true );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$captured ) {
                $captured = $value;
                return true;
            }
        );
        Functions\when( 'wp_schedule_single_event' )->justReturn( true );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'draft', $sequence, array( 'cause' => 'core' ) );

        $this->assertSame( 0, $captured['started_by'] );
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
     * A run that was never queued concluded all the same: the post stopped, so
     * it is reported, and as nothing the agent decided.
     */
    public function test_a_run_that_could_not_be_scheduled_reports_dispatch_failed(): void
    {
        $telemetry = new RecordingTelemetry();
        Tracker::set_telemetry( $telemetry );

        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'update_post_meta' )->justReturn( true );
        Functions\when( 'wp_schedule_single_event' )->justReturn( false );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => array( 'pass' => 'review' ),
                ),
            )
        );

        $this->runner->maybe_dispatch( 42, 'ai_desk', 'draft', $sequence );

        $events = $telemetry->of( 'agent_run_finished' );
        $this->assertCount( 1, $events );
        $this->assertSame(
            array(
                'disposition' => 'stopped_in_place',
                'stop_reason' => 'dispatch_failed',
                'initiator'   => 'agent',
            ),
            $events[0]['properties']
        );
        $this->assertSame( 5, $events[0]['user'], 'recorded as the person whose move entered the stage' );
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
     * Re-entering the same AI stage while an earlier entry's job is still
     * pending writes a fresh marker for this entry. The abandoned entry's
     * starter and origin don't carry over; only the cron event is deduplicated.
     */
    public function test_re_entry_over_a_pending_marker_writes_a_fresh_one(): void
    {
        Functions\when( 'get_post_meta' )->justReturn(
            array(
                'stage_key'  => 'ai_desk',
                'status'     => 'pending',
                'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                'from_stage' => 'review',
                'started_by' => 9,
            )
        );
        Functions\when( 'wp_doing_cron' )->justReturn( false );
        $writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$writes ) {
                if ( StageAgentRunner::JOB_META === $key ) {
                    $writes[] = $value;
                }
                return true;
            }
        );
        Functions\when( 'delete_post_meta' )->justReturn( true );
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

        $this->assertCount( 1, $writes );
        $this->assertSame( 'pending', $writes[0]['status'] );
        $this->assertSame( 5, $writes[0]['started_by'], 'the person making this entry, not the earlier one' );
        $this->assertSame( 'draft', $writes[0]['from_stage'], 'Go back leads where this entry came from' );
    }

    /**
     * Run again keeps the post at its stage and dispatches a fresh run started
     * by the person asking, keeping the go-back origin and restarting the chain.
     */
    public function test_rerun_dispatches_a_fresh_run_started_by_the_person_asking(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            static function ( $post_id, $key ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                if ( StageAgentRunner::JOB_META === $key ) {
                    return array( 'stage_key' => 'ai_desk', 'status' => 'failed', 'error' => 'x', 'from_stage' => 'draft' );
                }
                return '';
            }
        );
        Functions\expect( 'delete_post_meta' )->once()->with( 42, StageAgentRunner::CHAIN_META );
        $seen = null;
        $this->wpdb_replacing( 1, $seen );
        Functions\expect( 'wp_schedule_single_event' )
            ->once()
            ->with( Mockery::type( 'int' ), StageAgentRunner::RUN_HOOK, array( 42, 'ai_desk' ), true )
            ->andReturn( true );

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );
        $sequence->shouldReceive( 'get_role_permitted_transitions' )->andReturn( array( array( 'to' => 'ai_desk' ) ) );

        $this->assertTrue( $this->runner->rerun( 42, $sequence ) );
        $this->assertSame( 'wp_postmeta', $seen['table'] );
        $this->assertSame( StageAgentRunner::JOB_META, $seen['where']['meta_key'] );
        $this->assertSame(
            serialize( array( 'stage_key' => 'ai_desk', 'status' => 'failed', 'error' => 'x', 'from_stage' => 'draft' ) ),
            $seen['where']['meta_value'],
            'the update is conditional on the exact failed marker'
        );
        $captured = unserialize( $seen['data']['meta_value'] );
        $this->assertSame( 'pending', $captured['status'] );
        $this->assertSame( 'ai_desk', $captured['stage_key'] );
        $this->assertSame( 'test/agent', $captured['ability_id'] );
        $this->assertSame( 'draft', $captured['from_stage'], 'go-back still knows where the post came from' );
        $this->assertSame( 'rerun', $captured['cause'] );
        $this->assertSame( 5, $captured['started_by'], 'the run belongs to whoever pressed Run again' );
    }

    /**
     * Two people pressing Run again at once, or Run again racing Go back: the
     * marker is replaced only if it is still the failed one that was checked.
     * The loser is refused and schedules nothing.
     */
    public function test_rerun_is_refused_when_the_failed_marker_changed_underneath_it(): void
    {
        $failed = array( 'stage_key' => 'ai_desk', 'status' => 'failed', 'error' => 'x', 'from_stage' => 'draft' );
        Functions\when( 'get_post_meta' )->alias(
            static function ( $post_id, $key ) use ( $failed ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                return StageAgentRunner::JOB_META === $key ? $failed : '';
            }
        );
        // Gone or changed: the conditional UPDATE matches no row. It never
        // adds one, so a Go back that deleted the marker also refuses here.
        $this->wpdb_replacing( 0 );
        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_schedule_single_event' )->never();
        Functions\expect( 'delete_post_meta' )->never();

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );
        $sequence->shouldReceive( 'get_role_permitted_transitions' )->andReturn( array( array( 'to' => 'ai_desk' ) ) );

        $result = $this->runner->rerun( 42, $sequence );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'agent_rerun_conflict', $result->get_error_code() );
        $this->assertSame( 409, $result->get_error_data()['status'] );
    }

    /**
     * Run again keeps the sequence's role rules: a person whose role can't take
     * the move into the stage from where the job came is refused, and nothing
     * is written or scheduled.
     */
    public function test_rerun_is_refused_when_the_role_cannot_enter_the_stage(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            static function ( $post_id, $key ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                if ( StageAgentRunner::JOB_META === $key ) {
                    return array( 'stage_key' => 'ai_desk', 'status' => 'failed', 'error' => 'x', 'from_stage' => 'draft' );
                }
                return '';
            }
        );
        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_schedule_single_event' )->never();
        Functions\expect( 'delete_post_meta' )->never();

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );
        $sequence->shouldReceive( 'get_role_permitted_transitions' )
            ->with( 'draft', 5 )
            ->andReturn( array( array( 'to' => 'review' ) ) );

        $result = $this->runner->rerun( 42, $sequence );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'forbidden_transition', $result->get_error_code() );
        $this->assertSame( 403, $result->get_error_data()['status'] );
    }

    /**
     * Only a run that failed at the post's current stage can run again.
     *
     * @dataProvider not_rerunnable_jobs
     *
     * @param mixed $job The stored job marker.
     */
    public function test_rerun_refuses_without_a_failed_run_at_the_current_stage( $job ): void
    {
        Functions\when( 'get_post_meta' )->alias(
            static function ( $post_id, $key ) use ( $job ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                return StageAgentRunner::JOB_META === $key ? $job : '';
            }
        );
        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_schedule_single_event' )->never();

        $sequence = $this->sequence_with_status(
            array(
                'key'   => 'ai_desk',
                'agent' => array( 'ability_id' => 'test/agent', 'routing' => array() ),
            )
        );

        $result = $this->runner->rerun( 42, $sequence );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'no_agent_rerun', $result->get_error_code() );
    }

    /**
     * Job markers that do not allow a re-run.
     *
     * @return array
     */
    public static function not_rerunnable_jobs(): array
    {
        return array(
            'no job'                => array( '' ),
            'still pending'         => array( array( 'stage_key' => 'ai_desk', 'status' => 'pending' ) ),
            'held for a person'     => array( array( 'stage_key' => 'ai_desk', 'status' => 'warnings_pending' ) ),
            'failed at other stage' => array( array( 'stage_key' => 'other', 'status' => 'failed' ) ),
        );
    }

    /**
     * A stage whose agent was removed from the sequence has nothing to run again.
     */
    public function test_rerun_refuses_when_the_stage_no_longer_has_an_agent(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            static function ( $post_id, $key ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                return StageAgentRunner::JOB_META === $key
                    ? array( 'stage_key' => 'ai_desk', 'status' => 'failed' )
                    : '';
            }
        );
        Functions\expect( 'wp_schedule_single_event' )->never();

        $result = $this->runner->rerun( 42, $this->sequence_with_status( array( 'key' => 'ai_desk' ) ) );

        $this->assertInstanceOf( \WP_Error::class, $result );
    }
}
