<?php
/**
 * StageAgentRunner execution and routing unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Abilities\AbilityExecutor;
use VIPWorkflows\Abilities\AbilityResult;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Workflow\StageAgentRunner;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Tests for StageAgentRunner::run_stage_agent() and its routing helpers.
 */
class StageAgentRunnerExecuteTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Functions\when( 'update_post_meta' )->justReturn( true );
        Functions\when( 'delete_post_meta' )->justReturn( true );

        // The runner runs the agent as a capable user in the (user-less) cron
        // context, then restores. Stub that resolution to the post author.
        Functions\when( 'get_current_user_id' )->justReturn( 0 );
        Functions\when( 'wp_set_current_user' )->justReturn( 1 );
        Functions\when( 'get_post_field' )->justReturn( 7 );
        Functions\when( 'user_can' )->justReturn( true );
        Functions\when( 'get_users' )->justReturn( array() );
    }

    /**
     * Build an AbilityResult directly (no factory) to avoid WP calls in static
     * data providers and unstubbed contexts.
     *
     * @param bool  $success Whether the run succeeded.
     * @param array $output  Output payload.
     * @return AbilityResult
     */
    private static function make_result( bool $success, array $output = array() ): AbilityResult
    {
        $result             = new AbilityResult();
        $result->ability_id = 'workflow-agent-reformat-to-template/reformat-to-template';
        $result->success    = $success;
        $result->output     = $output;
        $result->summary    = $output['summary'] ?? '';
        return $result;
    }

    protected function tearDown(): void
    {
        // Clear the seeded Plugin singleton.
        $reflection    = new \ReflectionClass( \VIPWorkflows\Plugin::class );
        $instance_prop = $reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, null );

        parent::tearDown();
    }

    /**
     * Seed the Plugin singleton so get_status_manager() returns the given mock.
     *
     * @param object $status_manager Mocked StatusManager.
     */
    private function seed_status_manager( object $status_manager ): void
    {
        $reflection = new \ReflectionClass( \VIPWorkflows\Plugin::class );
        $instance   = $reflection->newInstanceWithoutConstructor();

        $prop = $reflection->getProperty( 'status_manager' );
        $prop->setValue( $instance, $status_manager );

        $instance_prop = $reflection->getProperty( 'instance' );
        $instance_prop->setValue( null, $instance );
    }

    /**
     * Sequence mock whose get_status() returns an AI stage with the given routing.
     *
     * @param array  $routing       Routing map.
     * @param string $target_region Region the routed destination stage sits in.
     *                              Defaults to a non-publish region; pass
     *                              'publish' or 'private' to exercise the guard.
     * @param array  $settings      The sequence's own settings bag.
     * @param string $from_region   Region the AI stage itself sits in. The guard
     *                              compares the two, so they have to be separable.
     * @return object
     */
    private function ai_sequence( array $routing, string $target_region = 'draft', array $settings = array(), string $from_region = 'draft' ): object
    {
        $sequence = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'get_status' )->andReturn(
            array(
                'key'   => 'ai_desk',
                'agent' => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => $routing,
                ),
            )
        );
        // Argument-aware: a stub answering one region for every stage cannot tell a
        // from/to comparison from a to-only one, which is the whole subject here.
        $sequence->shouldReceive( 'get_stage_status' )->andReturnUsing(
            static function ( string $stage ) use ( $target_region, $from_region ): string {
                return 'ai_desk' === $stage ? $from_region : $target_region;
            }
        );
        $sequence->shouldReceive( 'get_settings' )->andReturn( $settings );
        return $sequence;
    }

    /**
     * Stub get_post_meta so the current stage matches and the loop chain starts at 0.
     *
     * @param string $current_stage Current stage key to report.
     */
    private function stub_meta( string $current_stage = 'ai_desk' ): void
    {
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) use ( $current_stage ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return $current_stage;
                }
                if ( StageAgentRunner::CHAIN_META === $key ) {
                    return '';
                }
                return '';
            }
        );
    }

    /**
     * A `pass` outcome routes the post to the configured pass destination,
     * transitioning as the agent actor.
     */
    public function test_pass_outcome_transitions_to_pass_route(): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'fail' => 'draft', 'error' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->with(
                42,
                'review',
                Mockery::on(
                    function ( $options ) {
                        // acknowledge_warnings must NOT be set: an agent does not
                        // dismiss the soft warnings a person would be asked to
                        // confirm. agent_actor still exempts the agent from
                        // warning about its own running job.
                        return 'workflow-agent-reformat-to-template/reformat-to-template' === ( $options['agent_actor'] ?? '' )
                            && empty( $options['acknowledge_warnings'] );
                    }
                )
            )
            ->andReturn( true );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * A `fail` outcome bumps the post back along the fail route.
     */
    public function test_fail_outcome_transitions_to_fail_route(): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'fail' => 'draft', 'error' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )->once()->with( 42, 'draft', Mockery::type( 'array' ) )->andReturn( true );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->andReturn(
            self::make_result( true, array( 'status' => 'fail', 'summary' => 'nope' ) )
        );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * Capture the last JOB_META write so failure-in-place can be asserted.
     *
     * @return array Reference-like holder; index 0 receives the written value.
     */
    private function capture_job_meta( array &$holder ): void
    {
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$holder ) {
                if ( StageAgentRunner::JOB_META === $key ) {
                    $holder = $value;
                }
                return true;
            }
        );
    }

    /**
     * An execution failure (thrown by the executor) on a stage WITHOUT an error
     * route fails in place: no transition, and the job marker is set to
     * `failed` with the message.
     */
    public function test_thrown_executor_fails_in_place_without_error_route(): void
    {
        $this->stub_meta();
        $job = array();
        $this->capture_job_meta( $job );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'fail' => 'draft' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->andThrow( new \InvalidArgumentException( 'boom' ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'failed', $job['status'] );
        $this->assertSame( 'boom', $job['error'] );
    }

    /**
     * The error path is opt-in: a stage that routes `error` sends a thrown run
     * along it — an agent-actor transition carrying the error message as its
     * audit comment — and records no failure marker.
     */
    public function test_thrown_executor_routes_error_when_error_route_configured(): void
    {
        $this->stub_meta();
        $job = array();
        $this->capture_job_meta( $job );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'needs_human' ) ) );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->with(
                42,
                'needs_human',
                Mockery::on(
                    function ( $options ) {
                        return 'workflow-agent-reformat-to-template/reformat-to-template' === ( $options['agent_actor'] ?? '' )
                            && 'boom' === ( $options['comment'] ?? '' );
                    }
                )
            )
            ->andReturn( true );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->andThrow( new \InvalidArgumentException( 'boom' ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( array(), $job, 'A routed error records no failure marker.' );
    }

    /**
     * A successful run whose output carries no recognized status is an execution
     * error: it fails in place when the stage routes no `error` destination.
     */
    public function test_unrecognized_status_fails_in_place_without_error_route(): void
    {
        $this->stub_meta();
        $job = array();
        $this->capture_job_meta( $job );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->andReturn(
            self::make_result( true, array( 'summary' => 'no status key' ) )
        );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'failed', $job['status'] );
    }

    /**
     * A missing actor cannot authorize even an error transition, so the runner
     * must preserve the actionable failure in place regardless of routing.
     */
    public function test_no_actor_fails_in_place_when_error_route_configured(): void
    {
        $this->stub_meta();
        Functions\when( 'user_can' )->justReturn( false ); // author cannot edit posts
        $job = array();
        $this->capture_job_meta( $job );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'needs_human' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->never();

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'failed', $job['status'] );
        $this->assertStringContainsString( 'author cannot edit posts', $job['error'] );
    }

    /**
     * Without an error route, the no-actor failure stays in place, and the
     * marker carries the origin stage read from the pending job — the failed
     * state's go-back destination.
     */
    public function test_no_actor_fails_in_place_preserving_from_stage(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                if ( StageAgentRunner::JOB_META === $key ) {
                    return array(
                        'stage_key'  => 'ai_desk',
                        'status'     => 'pending',
                        'queued_at'  => '2026-08-14 00:00:00',
                        'from_stage' => 'draft',
                    );
                }
                return '';
            }
        );
        Functions\when( 'user_can' )->justReturn( false ); // author cannot edit posts
        $job = array();
        $this->capture_job_meta( $job );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->never();

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'failed', $job['status'] );
        $this->assertSame( 'draft', $job['from_stage'], 'The failure marker keeps the way back.' );
    }

    /**
     * When the agent succeeds but the exit transition itself fails (WP_Error),
     * the runner fails in place: the job marker is set to `failed` with the
     * transition error, `vip_workflows_agent_failed` fires, and
     * `vip_workflows_agent_completed` does NOT fire.
     */
    public function test_failed_exit_transition_fails_in_place_without_completed_action(): void
    {
        $this->stub_meta();
        $job = array();
        $this->capture_job_meta( $job );

        $fired = array();
        Functions\when( 'do_action' )->alias(
            function ( $hook, ...$args ) use ( &$fired ) {
                $fired[] = $hook;
            }
        );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'needs_human' ) ) );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->with( 42, 'review', Mockery::type( 'array' ) )
            ->andReturn( new \WP_Error( 'transition_failed', 'required tool hard-failed' ) );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'failed', $job['status'] );
        $this->assertSame( 'required tool hard-failed', $job['error'] );
        $this->assertContains( 'vip_workflows_agent_failed', $fired );
        $this->assertNotContains( 'vip_workflows_agent_completed', $fired );
    }

    /**
     * Capture every LAST_RUN_META write so the resolved-outcome record can be
     * asserted (and asserted absent).
     *
     * @param array $holder Receives one entry per write.
     */
    private function capture_last_run( array &$holder ): void
    {
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$holder ) {
                if ( StageAgentRunner::LAST_RUN_META === $key ) {
                    $holder[] = $value;
                }
                return true;
            }
        );
    }

    /**
     * A resolved run records which outcome moved the post — the stage it ran
     * in, the outcome that fired, and the destination — because the job marker
     * is cleared before the transition and the editor's transition rail needs
     * the outcome to flash the taken route. Reading the destination back
     * through `agent.routing` cannot substitute: two outcomes may route to the
     * same stage.
     */
    public function test_finish_records_the_resolved_outcome(): void
    {
        $this->stub_meta();
        $runs = array();
        $this->capture_last_run( $runs );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'fail' => 'draft', 'error' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )->once()->with( 42, 'draft', Mockery::type( 'array' ) )->andReturn( true );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->andReturn(
            self::make_result( true, array( 'status' => 'fail', 'summary' => 'nope' ) )
        );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertCount( 1, $runs );
        $this->assertSame( 'ai_desk', $runs[0]['stage_key'] );
        $this->assertSame( 'fail', $runs[0]['outcome'] );
        $this->assertSame( 'draft', $runs[0]['to'] );
        $this->assertNotSame( '', $runs[0]['finished_at'] );
    }

    /**
     * A refused exit transition resolves nothing: the post never moved, so no
     * resolved-outcome record may claim it did.
     */
    public function test_failed_exit_transition_records_no_resolved_outcome(): void
    {
        $this->stub_meta();
        $runs = array();
        $this->capture_last_run( $runs );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'needs_human' ) ) );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->andReturn( new \WP_Error( 'transition_failed', 'required tool hard-failed' ) );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( array(), $runs );
    }

    /**
     * If the post has moved out of the dispatched stage, the run is abandoned
     * without forcing any transition.
     */
    public function test_stage_mismatch_abandons_without_transition(): void
    {
        $this->stub_meta( 'somewhere_else' );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->never();

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->addToAssertionCount( 1 );
    }

    /**
     * When the agent-transition chain exceeds MAX_CHAIN, the run fails in place
     * without executing the agent or transitioning (loop guard).
     */
    public function test_loop_guard_fails_in_place_without_running_agent(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                if ( StageAgentRunner::CHAIN_META === $key ) {
                    return StageAgentRunner::MAX_CHAIN; // next increment trips the guard
                }
                return '';
            }
        );
        $job = array();
        $this->capture_job_meta( $job );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'needs_human' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->never();

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'failed', $job['status'] );
    }

    /**
     * Capture every CHAIN_META write, in order.
     *
     * @param array $holder Receives the written values.
     */
    private function capture_chain_meta( array &$holder ): void
    {
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$holder ) {
                if ( StageAgentRunner::CHAIN_META === $key ) {
                    $holder[] = $value;
                }
                return true;
            }
        );
    }

    /**
     * The loop guard is written EXACTLY ONCE per run, in finish(), and only by a
     * run that actually transitions.
     *
     * It used to increment eagerly before the ability ran and blind-restore the
     * pre-run value on each non-transitioning path. That restore wrote a value
     * read before execution, so a concurrent run's increment landing in between
     * was discarded and the guard stopped counting the hops it exists to bound.
     */
    public function test_chain_is_written_once_by_a_transitioning_run(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                if ( StageAgentRunner::CHAIN_META === $key ) {
                    return 3;
                }
                return '';
            }
        );

        $chain_writes = array();
        $this->capture_chain_meta( $chain_writes );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'needs_human' ) ) );
        // The counter must already be incremented when the transition fires: the
        // transition is what dispatches the next agent, and that agent reads it.
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->andReturnUsing(
                function () use ( &$chain_writes ) {
                    $this->assertSame( array( 4 ), $chain_writes, 'The chain must be written before the exit transition.' );
                    return true;
                }
            );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( array( 4 ), $chain_writes, 'Exactly one chain write, and no restore after it.' );
    }

    /**
     * A run that fails in place never transitioned, so it never touches the
     * counter — there is nothing to restore because nothing was written. (An
     * error-ROUTED run does transition, and counts like any other hop.)
     */
    public function test_failed_run_never_writes_the_chain(): void
    {
        $this->stub_meta();

        $chain_writes = array();
        $this->capture_chain_meta( $chain_writes );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'fail' => 'draft' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->andThrow( new \RuntimeException( 'boom' ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( array(), $chain_writes );
    }

    /**
     * An abandoned run (post moved to another stage) must not delete a job the
     * new stage has since queued — only its own stage's marker may be cleared.
     */
    public function test_abandoned_run_does_not_clear_newer_stage_job(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'next_ai_stage'; // post has moved on
                }
                if ( StageAgentRunner::JOB_META === $key ) {
                    return array(
                        'stage_key' => 'next_ai_stage', // owned by the new stage
                        'status'    => 'pending',
                    );
                }
                return '';
            }
        );
        Functions\expect( 'delete_post_meta' )->never();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->never();

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->addToAssertionCount( 1 );
    }

    /**
     * fail_in_place() must not overwrite a job marker a newer stage owns — a
     * stale, slow run failing late cannot clobber the fresh pending job.
     */
    public function test_fail_in_place_does_not_clobber_newer_stage_job(): void
    {
        Functions\when( 'get_post_meta' )->justReturn(
            array(
                'stage_key' => 'next_ai_stage',
                'status'    => 'pending',
            )
        );
        Functions\expect( 'update_post_meta' )->never();

        $method = new \ReflectionMethod( StageAgentRunner::class, 'fail_in_place' );
        $method->invoke( new StageAgentRunner(), 42, 'ai_desk', 'workflow-agent-reformat-to-template/reformat-to-template', 'stale failure' );

        $this->addToAssertionCount( 1 );
    }

    /**
     * outcome_from_result maps ability results to routing outcomes.
     *
     * @dataProvider outcome_provider
     *
     * @param AbilityResult $result   Ability result.
     * @param string        $expected Expected outcome.
     */
    public function test_outcome_from_result( AbilityResult $result, string $expected ): void
    {
        $method = new \ReflectionMethod( StageAgentRunner::class, 'outcome_from_result' );
        $this->assertSame( $expected, $method->invoke( new StageAgentRunner(), $result ) );
    }

    /**
     * @return array<string, array{0: AbilityResult, 1: string}>
     */
    public static function outcome_provider(): array
    {
        return array(
            'pass'            => array( self::make_result( true, array( 'status' => 'pass' ) ), 'pass' ),
            'fail'            => array( self::make_result( true, array( 'status' => 'fail' ) ), 'fail' ),
            'warning->error'  => array( self::make_result( true, array( 'status' => 'warning' ) ), 'error' ),
            'unknown->error'  => array( self::make_result( true, array( 'status' => 'weird' ) ), 'error' ),
            'no-status->error' => array( self::make_result( true, array() ), 'error' ),
            'failure->error'  => array( self::make_result( false ), 'error' ),
        );
    }

    /**
     * The agent runs as the post author when the author can edit posts.
     */
    public function test_resolve_agent_user_prefers_author(): void
    {
        Functions\when( 'get_post_field' )->justReturn( 7 );
        Functions\when( 'user_can' )->justReturn( true );

        $method = new \ReflectionMethod( StageAgentRunner::class, 'resolve_agent_user' );
        $this->assertSame( 7, $method->invoke( new StageAgentRunner(), 99 ) );
    }

    /**
     * When the author cannot edit posts the run yields no actor, rather than
     * substituting an administrator.
     */
    public function test_resolve_agent_user_does_not_substitute_an_admin(): void
    {
        Functions\when( 'get_post_field' )->justReturn( 7 );
        Functions\when( 'user_can' )->justReturn( false );
        // Present, and deliberately never consulted.
        Functions\when( 'get_users' )->justReturn( array( 3 ) );

        $method = new \ReflectionMethod( StageAgentRunner::class, 'resolve_agent_user' );
        $this->assertSame(
            0,
            $method->invoke( new StageAgentRunner(), 99 ),
            'an author who cannot edit posts must yield no actor'
        );
    }

    /**
     * A `pass` verdict routing into the publish region does NOT transition.
     *
     * The pass/fail verdict is whatever the model put in output['status'], and
     * the model reads content the plugin does not control. Moving between
     * editorial stages on that basis is recoverable; publishing is not, so the
     * post stays put and waits for a person.
     */
    public function test_pass_outcome_does_not_cross_the_publish_boundary(): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn(
                $this->ai_sequence(
                    array( 'pass' => 'live', 'fail' => 'draft', 'error' => 'review' ),
                    'publish'
                )
            );
        // The whole point: no transition is attempted.
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'looks good to me' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * A sequence that opts in DOES publish on a pass — the block is a default,
     * not a law.
     */
    public function test_publish_route_is_taken_when_the_sequence_opts_in(): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn(
                $this->ai_sequence(
                    array( 'pass' => 'live', 'fail' => 'draft', 'error' => 'review' ),
                    'publish',
                    array( 'allow_agent_publish' => true )
                )
            );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->with( 42, 'live', Mockery::type( 'array' ) )
            ->andReturn( true );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'looks good to me' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * An error routed into the publish region is held too.
     *
     * The error route is an exit transition like any other. Left unguarded it is
     * the cheaper way past the boundary than steering a verdict: an execution
     * error needs only a provider timeout or an unparseable reply.
     */
    public function test_error_route_does_not_cross_the_publish_boundary(): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn(
                $this->ai_sequence(
                    array( 'pass' => 'review', 'error' => 'live' ),
                    'publish'
                )
            );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->once()->andThrow( new \RuntimeException( 'provider timed out' ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * An opted-in sequence still takes its error route into publish.
     */
    public function test_error_route_publishes_when_the_sequence_opts_in(): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn(
                $this->ai_sequence(
                    array( 'pass' => 'review', 'error' => 'live' ),
                    'publish',
                    array( 'allow_agent_publish' => true )
                )
            );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->with( 42, 'live', Mockery::type( 'array' ) )
            ->andReturn( true );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->once()->andThrow( new \RuntimeException( 'provider timed out' ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * The `private` region is the same boundary.
     *
     * StatusManager::region_crossing_cap() gates a crossing into `publish` OR
     * `private` on publish_posts, because both make the post readable by someone
     * who could not read it before.
     */
    public function test_pass_outcome_does_not_cross_into_the_private_region(): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn(
                $this->ai_sequence(
                    array( 'pass' => 'review', 'fail' => 'draft' ),
                    'private'
                )
            );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * A move that starts on the published side publishes nothing new, so it runs.
     *
     * Without this the post-publish leg of a sequence is unusable: an agent seated
     * in a publish-region stage could not route anywhere in its own region.
     *
     * @dataProvider provide_moves_within_the_published_side
     *
     * @param string $from_region Region the AI stage sits in.
     * @param string $to_region   Region the routed destination sits in.
     */
    public function test_a_move_inside_the_published_side_is_not_held( string $from_region, string $to_region ): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn(
                $this->ai_sequence(
                    array( 'pass' => 'archive_ready', 'fail' => 'archive_fix' ),
                    $to_region,
                    array(),
                    $from_region
                )
            );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->with( 42, 'archive_ready', Mockery::type( 'array' ) )
            ->andReturn( true );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * @return array<string, array{string, string}>
     */
    public static function provide_moves_within_the_published_side(): array
    {
        return array(
            'publish to publish' => array( 'publish', 'publish' ),
            'publish to private' => array( 'publish', 'private' ),
            'private to publish' => array( 'private', 'publish' ),
        );
    }

    /**
     * A destination whose region cannot be read is held, not waved through.
     *
     * get_stage_status() throws for a stage the sequence does not define or stored
     * without a region. Treating that as "not publishing" would make a broken
     * config the way around the boundary.
     */
    public function test_a_target_with_no_readable_region_is_held(): void
    {
        $this->stub_meta();

        $sequence = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'get_status' )->andReturn(
            array(
                'key'   => 'ai_desk',
                'agent' => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => array( 'pass' => 'nowhere' ),
                ),
            )
        );
        $sequence->shouldReceive( 'get_settings' )->andReturn( array() );
        $sequence->shouldReceive( 'get_stage_status' )->andThrow(
            new \InvalidArgumentException( 'Stage "nowhere" is not defined.' )
        );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )->andReturn( $sequence );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * Only a real boolean true is consent. import_sequence() stores config
     * verbatim, and "false" is truthy in PHP.
     *
     * @dataProvider provide_values_that_are_not_consent
     *
     * @param mixed $value What the settings bag holds under the flag.
     */
    public function test_only_a_literal_true_counts_as_opting_in( $value ): void
    {
        $this->stub_meta();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn(
                $this->ai_sequence(
                    array( 'pass' => 'live', 'fail' => 'draft', 'error' => 'review' ),
                    'publish',
                    array( 'allow_agent_publish' => $value )
                )
            );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );
    }

    /**
     * @return array<string, array{mixed}>
     */
    public static function provide_values_that_are_not_consent(): array
    {
        return array(
            'string one'         => array( '1' ),
            'integer one'        => array( 1 ),
            'the word true'      => array( 'true' ),
            'the word yes'       => array( 'yes' ),
            'the word false'     => array( 'false' ),
            'a non-empty string' => array( 'anything' ),
        );
    }

    /**
     * A held transition preserves the exact warning decision for a person.
     *
     * transition() returns run_transition_tools()'s payload verbatim, whose key
     * is `soft_warnings` and whose entries are arrays of tool/key/message — not
     * a flat list of strings. Asserting only that the run stopped in place would
     * pass against a marker that named no check at all.
     */
    public function test_held_transition_persists_the_warning_decision_for_a_person(): void
    {
        $this->stub_meta();
        $job = array();
        $this->capture_job_meta( $job );

        $warnings = array(
            array(
                'tool'     => 'workflow-tool-checklist',
                'key'      => 'featured_image',
                'message'  => 'Add a featured image',
                'severity' => 'soft',
            ),
            array(
                'tool'     => 'workflow-tool-excerpt-generator',
                'key'      => 'excerpt',
                'message'  => 'Excerpt is empty',
                'severity' => 'soft',
            ),
        );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'fail' => 'draft', 'error' => 'needs_human' ) ) );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->andReturn(
                array(
                    'warnings_pending' => true,
                    'soft_warnings'    => $warnings,
                )
            );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'warnings_pending', $job['status'], 'a warning decision is not a failed agent run' );
        $this->assertSame( 'review', $job['to_status'] );
        $this->assertSame( 'pass', $job['outcome'] );
        $this->assertSame( $warnings, $job['soft_warnings'] );
        $this->assertArrayNotHasKey( 'error', $job, 'the editor must show the standard warning modal, not the failed-run surface' );
    }

    /**
     * A soft check on an error-route exit must not erase why the agent routed
     * to human review. The person who acknowledges the warning needs the same
     * comment the agent transition would have committed to the audit trail.
     */
    public function test_held_error_route_preserves_the_error_outcome_and_comment(): void
    {
        $this->stub_meta();
        $job = array();
        $this->capture_job_meta( $job );

        $warnings = array(
            array(
                'tool'     => 'workflow-tool-checklist',
                'key'      => 'featured_image',
                'message'  => 'Add a featured image',
                'severity' => 'soft',
            ),
        );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'error' => 'needs_human' ) ) );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->with(
                42,
                'needs_human',
                Mockery::on( fn( $options ) => 'boom' === ( $options['comment'] ?? '' ) )
            )
            ->andReturn(
                array(
                    'warnings_pending' => true,
                    'soft_warnings'    => $warnings,
                )
            );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->andThrow( new \InvalidArgumentException( 'boom' ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'warnings_pending', $job['status'] );
        $this->assertSame( 'needs_human', $job['to_status'] );
        $this->assertSame( 'error', $job['outcome'] );
        $this->assertSame( 'boom', $job['comment'] );
        $this->assertSame( $warnings, $job['soft_warnings'] );
    }

    /**
     * route() resolves outcomes, defaulting any unrouted outcome to the error route.
     */
    public function test_route_defaults_unrouted_outcome_to_error(): void
    {
        $method  = new \ReflectionMethod( StageAgentRunner::class, 'route' );
        $runner  = new StageAgentRunner();
        $routing = array( 'pass' => 'review', 'error' => 'needs_human' );

        $this->assertSame( 'review', $method->invoke( $runner, 'pass', $routing ) );
        $this->assertSame( 'needs_human', $method->invoke( $runner, 'error', $routing ) );
        $this->assertSame( 'needs_human', $method->invoke( $runner, 'fail', $routing ), 'an unrouted outcome falls back to error' );
    }

    /**
     * route() is total: an unrouted outcome on a map that also carries no `error`
     * destination resolves to null rather than reading a key that isn't there.
     * Every routing key is optional — error included — so this is an ordinary
     * authorable state, and the caller answers it by failing in place.
     */
    public function test_route_returns_null_when_no_route_and_no_error_destination(): void
    {
        $method = new \ReflectionMethod( StageAgentRunner::class, 'route' );
        $runner = new StageAgentRunner();

        $this->assertNull( $method->invoke( $runner, 'fail', array( 'pass' => 'review' ) ) );
        $this->assertNull( $method->invoke( $runner, 'fail', array( 'pass' => 'review', 'error' => '' ) ) );
    }

    /**
     * A `fail` verdict on a stage that routes only `pass`, with no `error`
     * destination, fails in place: the post is not moved anywhere the author
     * never configured, and the job marker carries the reason.
     */
    public function test_unrouted_outcome_fails_in_place_without_transition(): void
    {
        $this->stub_meta();
        $job = array();
        $this->capture_job_meta( $job );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'fail', 'summary' => 'nope' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'failed', $job['status'] );
        $this->assertStringContainsString( 'fail', $job['error'], 'The failure names the unrouted outcome.' );
        $this->assertStringContainsString( 'sequence editor', $job['error'], 'The failure points at the sequence config.' );
    }

    /**
     * A stage whose routing map is EMPTY is still AI-owned — every outcome is
     * optional, an empty map included. The run executes, and its verdict (which
     * necessarily has no route) fails in place with the go-back preserved.
     *
     * The pre-execution guard used to read empty routing as "the stage is no
     * longer AI-owned" and silently cleared the job: no run, no failure marker,
     * no exits (the routed-only filter offers nothing on a zero-route stage) —
     * a stranded post nothing surfaced. That read was sound only while the
     * validator made an empty map unwritable.
     */
    public function test_zero_route_stage_runs_and_fails_in_place_with_go_back(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                if ( StageAgentRunner::JOB_META === $key ) {
                    return array(
                        'stage_key'  => 'ai_desk',
                        'status'     => 'pending',
                        'queued_at'  => '2026-08-14 00:00:00',
                        'from_stage' => 'draft',
                    );
                }
                return '';
            }
        );
        $job = array();
        $this->capture_job_meta( $job );

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array() ) );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( 'failed', $job['status'], 'The run fails loud, never silently cleared.' );
        $this->assertStringContainsString( 'pass', $job['error'], 'The failure names the unrouted verdict.' );
        $this->assertSame( 'draft', $job['from_stage'], 'The failed marker keeps the way back.' );
    }

    /**
     * Only a MISSING ability id means the config changed under the queued job —
     * the agent was removed from the stage — and only then is the job cleared
     * without running or recording anything.
     */
    public function test_agent_removed_mid_run_clears_the_job_silently(): void
    {
        $this->stub_meta();

        $cleared = array();
        Functions\when( 'delete_post_meta' )->alias(
            function ( $post_id, $key ) use ( &$cleared ) {
                $cleared[] = $key;
                return true;
            }
        );
        Functions\expect( 'update_post_meta' )->never();

        $status_manager = Mockery::mock( StatusManager::class );
        $sequence      = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'get_status' )->andReturn( array( 'key' => 'ai_desk' ) );
        $status_manager->shouldReceive( 'get_sequence_for_post' )->andReturn( $sequence );
        $status_manager->shouldReceive( 'transition' )->never();
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )->never();

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->addToAssertionCount( 1 );
    }

    /**
     * The exit transition must name the user the run is acting for.
     *
     * The runner restores the previous user before finish(), so by the time the
     * state is written there is no current user under cron. StatusManager
     * therefore evaluates the agent's core capabilities against the actor named
     * in the options — if the runner does not pass it, the transition is
     * (correctly) refused and agents stop working. This pins the wiring.
     */
    public function test_exit_transition_names_the_resolved_actor(): void
    {
        $this->stub_meta();

        $seen = null;
        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->andReturn( $this->ai_sequence( array( 'pass' => 'review', 'fail' => 'draft', 'error' => 'review' ) ) );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->andReturnUsing(
                function ( $post_id, $target, $options ) use ( &$seen ) {
                    $seen = $options;
                    return true;
                }
            );
        $this->seed_status_manager( $status_manager );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturn( self::make_result( true, array( 'status' => 'pass', 'summary' => 'ok' ) ) );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertIsArray( $seen, 'the exit transition ran' );
        $this->assertArrayHasKey(
            'agent_actor_user',
            $seen,
            'the runner must name the user it resolved, or the transition has no identity to authorise against'
        );
        $this->assertSame(
            7,
            $seen['agent_actor_user'],
            'the named actor is the post author the runner resolved and impersonated'
        );
    }
}
