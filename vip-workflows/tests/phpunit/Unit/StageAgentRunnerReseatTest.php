<?php
/**
 * StageAgentRunner mid-execution reseat unit tests.
 *
 * A stage move landing while the agent is mid-execution (most commonly a
 * core-driven checkpoint reseat) must cancel the run cleanly: result
 * discarded, no spurious failure recorded, never finished against the new
 * stage — and a stale failure must never clobber a newer stage's job marker.
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
 * Tests for the post-execution stage re-check and the fail_in_place guard.
 */
class StageAgentRunnerReseatTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Functions\when( 'update_post_meta' )->justReturn( true );
        Functions\when( 'delete_post_meta' )->justReturn( true );

        // Actor resolution in the user-less cron context.
        Functions\when( 'get_current_user_id' )->justReturn( 0 );
        Functions\when( 'wp_set_current_user' )->justReturn( 1 );
        Functions\when( 'get_post_field' )->justReturn( 7 );
        Functions\when( 'user_can' )->justReturn( true );
        Functions\when( 'get_users' )->justReturn( array() );
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
     * Sequence mock whose get_status() returns an AI stage.
     *
     * @return object
     */
    private function ai_sequence(): object
    {
        $sequence = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'get_status' )->andReturn(
            array(
                'key'   => 'ai_desk',
                'agent' => array(
                    'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
                    'routing'    => array( 'pass' => 'review', 'error' => 'review' ),
                ),
            )
        );
        return $sequence;
    }

    /**
     * Build a successful pass AbilityResult.
     *
     * @return AbilityResult
     */
    private static function pass_result(): AbilityResult
    {
        $result             = new AbilityResult();
        $result->ability_id = 'workflow-agent-reformat-to-template/reformat-to-template';
        $result->success    = true;
        $result->output     = array( 'status' => 'pass' );
        return $result;
    }

    /**
     * StatusManager mock that never transitions.
     *
     * @return object
     */
    private function status_manager_expecting_no_transition(): object
    {
        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )->andReturn( $this->ai_sequence() );
        $status_manager->shouldReceive( 'transition' )->never();
        return $status_manager;
    }

    /**
     * A stage move landing MID-EXECUTION cancels the completed run cleanly:
     * its own job marker is cleared (compare-and-delete with the exact value
     * read), no failure is recorded, no transition fires, neither agent action
     * fires, and the loop-guard chain is never written.
     */
    public function test_mid_execution_stage_move_abandons_completed_run(): void
    {
        $stage      = 'ai_desk';
        $own_marker = array(
            'stage_key'  => 'ai_desk',
            'ability_id' => 'workflow-agent-reformat-to-template/reformat-to-template',
            'status'     => 'pending',
            'cause'      => 'workflow',
        );
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) use ( &$stage, $own_marker ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return $stage;
                }
                if ( StageAgentRunner::JOB_META === $key ) {
                    return $own_marker;
                }
                if ( StageAgentRunner::CHAIN_META === $key ) {
                    return 3; // Pre-run chain value.
                }
                return '';
            }
        );

        $job_writes   = array();
        $chain_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$job_writes, &$chain_writes ) {
                if ( StageAgentRunner::JOB_META === $key ) {
                    $job_writes[] = $value;
                }
                if ( StageAgentRunner::CHAIN_META === $key ) {
                    $chain_writes[] = $value;
                }
                return true;
            }
        );

        $deleted = array();
        Functions\when( 'delete_post_meta' )->alias(
            function ( $post_id, $key, $value = '' ) use ( &$deleted ) {
                $deleted[] = array( $key, $value );
                return true;
            }
        );

        $fired = array();
        Functions\when( 'do_action' )->alias(
            function ( $hook, ...$args ) use ( &$fired ) {
                $fired[] = $hook;
            }
        );

        $this->seed_status_manager( $this->status_manager_expecting_no_transition() );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturnUsing(
                function () use ( &$stage ) {
                    // A checkpoint reseat lands while the agent is executing.
                    $stage = 'entry_stage';
                    return self::pass_result();
                }
            );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( array(), $job_writes, 'No failure marker may be recorded for the departed stage.' );
        // Compare-and-delete: the delete carries the exact marker that was
        // read, so a marker swapped in by another process would match nothing.
        $this->assertContains( array( StageAgentRunner::JOB_META, $own_marker ), $deleted, 'The abandoned run clears its own job marker by exact value.' );
        $this->assertNotContains( 'vip_workflows_agent_completed', $fired );
        $this->assertNotContains( 'vip_workflows_agent_failed', $fired );
        // The chain is written once, in finish(), immediately before the exit
        // transition. An abandoned run never reaches it, so it writes NOTHING —
        // rather than incrementing and then blind-restoring a value read before
        // the ability ran, which discarded any concurrent run's increment.
        $this->assertSame( array(), $chain_writes, 'An abandoned run must not write to the agent chain at all.' );
    }

    /**
     * A stage move landing mid-execution abandons a THROWN run the same way:
     * no failure marker, no agent_failed broadcast, chain untouched.
     */
    public function test_mid_execution_stage_move_abandons_thrown_run(): void
    {
        $stage = 'ai_desk';
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) use ( &$stage ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return $stage;
                }
                if ( StageAgentRunner::CHAIN_META === $key ) {
                    return 2;
                }
                return '';
            }
        );

        $job_writes   = array();
        $chain_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$job_writes, &$chain_writes ) {
                if ( StageAgentRunner::JOB_META === $key ) {
                    $job_writes[] = $value;
                }
                if ( StageAgentRunner::CHAIN_META === $key ) {
                    $chain_writes[] = $value;
                }
                return true;
            }
        );

        $fired = array();
        Functions\when( 'do_action' )->alias(
            function ( $hook, ...$args ) use ( &$fired ) {
                $fired[] = $hook;
            }
        );

        $this->seed_status_manager( $this->status_manager_expecting_no_transition() );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturnUsing(
                function () use ( &$stage ) {
                    $stage = 'entry_stage';
                    throw new \RuntimeException( 'boom mid-reseat' );
                }
            );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( array(), $job_writes, 'A thrown run for a departed stage must not record a failure.' );
        $this->assertNotContains( 'vip_workflows_agent_failed', $fired, 'No agent_failed broadcast for a stage the post left.' );
        $this->assertSame( array(), $chain_writes, 'An abandoned thrown run must not write to the agent chain at all.' );
    }

    /**
     * When the mid-execution reseat already queued the NEW stage's job, the
     * abandoned run must not clear it — only its own stage's marker may go.
     */
    public function test_mid_execution_stage_move_preserves_new_stage_job(): void
    {
        $stage = 'ai_desk';
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) use ( &$stage ) {
                if ( '_vip_workflows_current_stage_key' === $key ) {
                    return $stage;
                }
                if ( StageAgentRunner::JOB_META === $key ) {
                    // The reseat's dispatch already owns the marker.
                    return array(
                        'stage_key' => 'entry_stage',
                        'status'    => 'pending',
                        'cause'     => 'core',
                    );
                }
                return '';
            }
        );

        Functions\expect( 'delete_post_meta' )->never();

        $job_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$job_writes ) {
                if ( StageAgentRunner::JOB_META === $key ) {
                    $job_writes[] = $value;
                }
                return true;
            }
        );

        $this->seed_status_manager( $this->status_manager_expecting_no_transition() );

        $executor = Mockery::mock( AbilityExecutor::class );
        $executor->shouldReceive( 'execute' )
            ->once()
            ->andReturnUsing(
                function () use ( &$stage ) {
                    $stage = 'entry_stage';
                    return self::pass_result();
                }
            );

        ( new StageAgentRunner( $executor ) )->run_stage_agent( 42, 'ai_desk' );

        $this->assertSame( array(), $job_writes, 'The new stage\'s pending job must not be overwritten.' );
    }

    /**
     * fail_in_place() with a newer stage's marker present leaves the marker
     * untouched (the suppression is logged instead) and does not fire the
     * agent-failed action for the stale failure.
     */
    public function test_fail_in_place_suppresses_stale_failure_for_newer_stage_marker(): void
    {
        Functions\when( 'get_post_meta' )->justReturn(
            array(
                'stage_key' => 'entry_stage',
                'status'    => 'pending',
                'cause'     => 'core',
            )
        );
        Functions\expect( 'update_post_meta' )->never();

        $fired = array();
        Functions\when( 'do_action' )->alias(
            function ( $hook, ...$args ) use ( &$fired ) {
                $fired[] = $hook;
            }
        );

        $method = new \ReflectionMethod( StageAgentRunner::class, 'fail_in_place' );
        $method->invoke(
            new StageAgentRunner(),
            42,
            'ai_desk',
            'workflow-agent-reformat-to-template/reformat-to-template',
            'stale failure'
        );

        $this->assertNotContains( 'vip_workflows_agent_failed', $fired );
    }
}
