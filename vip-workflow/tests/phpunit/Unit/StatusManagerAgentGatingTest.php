<?php
/**
 * StatusManager agent-gating unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\PostTypeManager;
use VIPWorkflow\Workflow\StageAgentRunner;
use VIPWorkflow\Workflow\StatusManager;

/**
 * Tests for StatusManager::has_pending_agent_job() and its consumers.
 *
 * Two different questions, deliberately answered differently:
 *
 * - get_available_transitions() WITHHOLDS an AI stage's edges while its agent is
 *   working. The agent moves the post on along one of its outcome routes, so the
 *   stage's transitions are not anyone else's to take. States the agent will not
 *   resolve — a failed run, or a stage that gained its agent while posts sat in
 *   it — hand the edges back rather than strand the post.
 *
 * - transition() warns rather than blocks on interruption: a caller that means
 *   it (an admin tool, the Kanban board acting on a stuck post) gets the
 *   warn/confirm through warnings_pending.
 *   What it DOES refuse, for every human caller in every job state, is an
 *   AI stage exit no agent outcome routes — the server half of the sequence
 *   editor's disabled-transition contract.
 *
 * That confirm is issued by transition() itself rather than by each surface:
 * every surface that can move a post goes through this one method, and only one
 * of them (the block editor panel) ever implemented the confirm on its own.
 */
class StatusManagerAgentGatingTest extends TestCase
{
    /**
     * Build a StatusManager without running its constructor (avoids DB wiring).
     *
     * @return StatusManager
     */
    private function status_manager(): StatusManager
    {
        return ( new \ReflectionClass( StatusManager::class ) )->newInstanceWithoutConstructor();
    }

    /**
     * A pending agent job payload with a fresh queued_at timestamp.
     *
     * @param string $stage_key Stage owning the job.
     * @return array
     */
    private static function fresh_pending_job( string $stage_key = 'ai_desk' ): array
    {
        return array(
            'stage_key'  => $stage_key,
            'status'     => 'pending',
            'ability_id' => 'x',
            'queued_at'  => gmdate( 'Y-m-d H:i:s' ),
        );
    }

    /**
     * A fresh pending job for the current stage reports as pending.
     */
    public function test_reports_pending_for_matching_stage(): void
    {
        Functions\when( 'get_post_meta' )->justReturn( self::fresh_pending_job() );

        $this->assertTrue( $this->status_manager()->has_pending_agent_job( 42, 'ai_desk' ) );
    }

    /**
     * A pending job for a different stage does not gate the current stage.
     */
    public function test_not_pending_for_other_stage(): void
    {
        Functions\when( 'get_post_meta' )->justReturn( self::fresh_pending_job( 'other' ) );

        $this->assertFalse( $this->status_manager()->has_pending_agent_job( 42, 'ai_desk' ) );
    }

    /**
     * A non-pending job status (e.g. cleared) does not gate.
     */
    public function test_not_pending_when_status_not_pending(): void
    {
        Functions\when( 'get_post_meta' )->justReturn(
            array( 'stage_key' => 'ai_desk', 'status' => 'done', 'ability_id' => 'x' )
        );

        $this->assertFalse( $this->status_manager()->has_pending_agent_job( 42, 'ai_desk' ) );
    }

    /**
     * No marker at all means no pending job.
     */
    public function test_not_pending_when_no_marker(): void
    {
        Functions\when( 'get_post_meta' )->justReturn( '' );

        $this->assertFalse( $this->status_manager()->has_pending_agent_job( 42, 'ai_desk' ) );
    }

    /**
     * A pending job older than PENDING_TTL is stale: it stops gating and the
     * marker is converted to a failure so the editor surfaces it. The origin
     * stage survives the conversion — a timed-out run's failed state offers the
     * same go-back a failed run's does.
     */
    public function test_stale_pending_job_converts_to_failed_and_stops_gating(): void
    {
        Functions\when( 'get_post_meta' )->justReturn(
            array(
                'stage_key'  => 'ai_desk',
                'status'     => 'pending',
                'ability_id' => 'x',
                'queued_at'  => gmdate( 'Y-m-d H:i:s', time() - StageAgentRunner::PENDING_TTL - 60 ),
                'from_stage' => 'draft',
            )
        );

        $written = null;
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$written ) {
                if ( StageAgentRunner::JOB_META === $key ) {
                    $written = $value;
                }
                return true;
            }
        );

        $this->assertFalse( $this->status_manager()->has_pending_agent_job( 42, 'ai_desk' ) );
        $this->assertSame( 'failed', $written['status'] );
        $this->assertSame( 'Agent run timed out.', $written['error'] );
        $this->assertSame( 'draft', $written['from_stage'] );
    }

    /**
     * The helper reads the shared StageAgentRunner marker meta key.
     */
    public function test_reads_the_shared_job_meta_key(): void
    {
        $seen_key = null;
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) use ( &$seen_key ) {
                $seen_key = $key;
                return '';
            }
        );

        $this->status_manager()->has_pending_agent_job( 42, 'ai_desk' );

        $this->assertSame( StageAgentRunner::JOB_META, $seen_key );
    }

    // =========================================================================
    // transition() / get_available_transitions() consumers
    // =========================================================================

    /**
     * Build a StatusManager wired with mocked repository + post type manager.
     *
     * @param object $sequence Sequence mock the repository returns.
     * @return StatusManager
     */
    private function gated_status_manager( object $sequence ): StatusManager
    {
        $repository = Mockery::mock( SequenceRepository::class );
        $repository->shouldReceive( 'find' )->andReturn( $sequence );

        $post_type_manager = Mockery::mock( PostTypeManager::class );
        $post_type_manager->shouldReceive( 'get_unprefixed_status' )->andReturnUsing( fn( $s ) => $s );
        $post_type_manager->shouldReceive( 'get_prefixed_status' )->andReturnUsing( fn( $s ) => 'wf_test_' . $s );

        return new StatusManager( $repository, $post_type_manager );
    }

    /**
     * Stub post + meta for a post sitting in ai_desk with the given job marker.
     *
     * @param mixed $job JOB_META value.
     */
    private function stub_post_in_ai_stage( $job ): void
    {
        Functions\when( 'get_post' )->justReturn( $this->create_mock_post( array( 'ID' => 42 ) ) );
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key, $single = false ) use ( $job ) {
                if ( '_vip_workflow_sequence_id' === $key ) {
                    return 7;
                }
                if ( '_vip_workflow_current_stage_key' === $key ) {
                    return 'ai_desk';
                }
                if ( StageAgentRunner::JOB_META === $key ) {
                    return $job;
                }
                return '';
            }
        );
    }

    /**
     * Stub the current user with the given roles (drives Settings bypass checks,
     * which default the bypass role lists to ['administrator']).
     *
     * @param string[] $roles Role slugs.
     */
    private function stub_current_user_roles( array $roles ): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'roles' => $roles, 'display_name' => 'Test' ) );
        Functions\when( 'get_option' )->justReturn( array() );
    }

    /**
     * Sequence mock that allows the ai_desk → review transition.
     *
     * @return object
     */
    private function permissive_sequence(): object
    {
        $sequence = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'is_transition_allowed' )->andReturn( true );
        $sequence->shouldReceive( 'get_transition' )->andReturn( array() );
        $sequence->shouldReceive( 'can_user_transition' )->andReturn( true );
        // The target resolves to a defined stage (transition() rejects undefined targets).
        $sequence->shouldReceive( 'get_status' )->andReturn( array( 'key' => 'review' ) );
        // ai_desk (draft region) → review (publish region): a region crossing, so
        // the tests reach wp_update_post (stubbed to fail after the agent gate).
        $sequence->shouldReceive( 'get_stage_status' )->with( 'ai_desk' )->andReturn( 'draft' );
        $sequence->shouldReceive( 'get_stage_status' )->with( 'review' )->andReturn( 'publish' );
        // ...and a crossing INTO publish, which is the one shape the
        // required-field gate covers, so it applies here rather than being out
        // of scope. No missing required fields, so the gate that does apply has
        // nothing to hold — these tests are about the agent gate, not that one.
        $sequence->shouldReceive( 'get_missing_required_metadata' )->andReturn( array() );
        return $sequence;
    }

    /**
     * Stub the core capability surface (edit_post baseline + region-crossing
     * caps granted).
     */
    private function stub_granted_caps(): void
    {
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'get_post_type_object' )->justReturn(
            (object) array(
                'cap' => (object) array(
                    'publish_posts'        => 'publish_posts',
                    'edit_published_posts' => 'edit_published_posts',
                ),
            )
        );
    }

    /**
     * A pending agent job does not BLOCK a non-bypass human's transition — it
     * asks. transition() answers warnings_pending, the shape every surface
     * already understands for "confirm before I do this".
     *
     * The confirm used to live only in the block editor panel, which left the
     * Kanban board, My Queue, the Quick Edit buttons and the transition-post
     * ability all killing a running agent silently. It is here now because this
     * is the one method all five go through.
     */
    public function test_transition_warns_before_interrupting_a_pending_agent(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );
        $this->stub_current_user_roles( array( 'editor' ) );
        $this->stub_granted_caps();
        Functions\when( 'get_post_status' )->justReturn( 'draft' );
        Functions\when( 'wp_update_post' )->justReturn( new \WP_Error( 'update_failed', 'stop here' ) );

        $manager = $this->gated_status_manager( $this->permissive_sequence() );
        $result  = $manager->transition( 42, 'review' );

        $this->assertIsArray( $result );
        $this->assertTrue( $result['warnings_pending'] );
        $this->assertSame( 'agent_in_progress', $result['soft_warnings'][0]['type'] );
        // Same sentence the JS getAgentInterruptWarning() returns, so the two
        // share one translation entry rather than drifting into two.
        $this->assertSame(
            'An AI agent is working on this post — continuing will stop it.',
            $result['soft_warnings'][0]['message']
        );
    }

    /**
     * Acknowledging the warning proceeds: the interruption is the user's call to
     * make, they just have to make it. wp_update_post is stubbed to fail so the
     * test stops at the region-crossing commit — reaching it proves the
     * transition ran rather than warning a second time.
     */
    public function test_acknowledged_transition_proceeds_while_agent_pending(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );
        $this->stub_current_user_roles( array( 'editor' ) );
        $this->stub_granted_caps();
        Functions\when( 'get_post_status' )->justReturn( 'draft' );
        Functions\when( 'wp_update_post' )->justReturn( new \WP_Error( 'update_failed', 'stop here' ) );

        $manager = $this->gated_status_manager( $this->permissive_sequence() );
        $result  = $manager->transition( 42, 'review', array( 'acknowledge_warnings' => true ) );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'update_failed', $result->get_error_code() );
    }

    /**
     * A post with NO agent running is never warned — the ordinary path is
     * untouched.
     */
    public function test_transition_does_not_warn_without_a_pending_agent(): void
    {
        $this->stub_post_in_ai_stage( '' );
        $this->stub_current_user_roles( array( 'editor' ) );
        $this->stub_granted_caps();
        Functions\when( 'get_post_status' )->justReturn( 'draft' );
        Functions\when( 'wp_update_post' )->justReturn( new \WP_Error( 'update_failed', 'stop here' ) );

        $manager = $this->gated_status_manager( $this->permissive_sequence() );
        $result  = $manager->transition( 42, 'review' );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'update_failed', $result->get_error_code() );
    }

    /**
     * The agent's own exit transition (agent_actor) skips the human ROLE and
     * ASSIGNMENT checks — those describe which person may push a button, and no
     * person is pushing one. It remains bound by the core capabilities of the
     * actor it names: `user_can` is stubbed true here for a named actor, and
     * wp_update_post is stubbed to fail so the test stops at the region-crossing
     * commit, proving the workflow-configuration checks did not block it.
     */
    public function test_agent_actor_transition_skips_the_workflow_rules_but_not_capabilities(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );
        $this->stub_current_user_roles( array( 'editor' ) );
        Functions\when( 'user_can' )->justReturn( true );
        // The agent path now resolves the crossing capability from the post
        // type, which the old unconditional bypass never reached.
        Functions\when( 'get_post_type_object' )->justReturn(
            (object) array(
                'cap' => (object) array(
                    'publish_posts'        => 'publish_posts',
                    'edit_published_posts' => 'edit_published_posts',
                ),
            )
        );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );
        Functions\when( 'wp_update_post' )->justReturn( new \WP_Error( 'update_failed', 'stop here' ) );

        $manager = $this->gated_status_manager( $this->permissive_sequence() );
        $result  = $manager->transition(
            42,
            'review',
            array(
                'agent_actor'      => 'workflow-agent-reformat-to-template/reformat-to-template',
                'agent_actor_user' => 7,
            )
        );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'update_failed', $result->get_error_code() );
    }

    /**
     * The same run for an actor who cannot edit the post is refused before any
     * write — the agent has no authority its actor does not have.
     */
    public function test_agent_actor_transition_is_refused_for_an_incapable_actor(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );
        $this->stub_current_user_roles( array( 'editor' ) );
        Functions\when( 'user_can' )->justReturn( false );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );

        $wrote = false;
        Functions\when( 'wp_update_post' )->alias(
            function () use ( &$wrote ) {
                $wrote = true;
                return 42;
            }
        );

        $manager = $this->gated_status_manager( $this->permissive_sequence() );
        $result  = $manager->transition(
            42,
            'review',
            array(
                'agent_actor'      => 'workflow-agent-reformat-to-template/reformat-to-template',
                'agent_actor_user' => 9,
            )
        );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'cannot_edit_post', $result->get_error_code() );
        $this->assertFalse( $wrote, 'nothing is written when the actor cannot edit the post' );
    }

    /**
     * A bypass-capable user is warned too. Bypassing the WORKFLOW is not the
     * same as being told an agent is mid-run: the warning is information, not a
     * permission, and an administrator has no more reason to destroy a run
     * unknowingly than anyone else. (The separate tool-check bypass does not
     * cover it either — that is why the check sits outside that block.)
     */
    public function test_bypass_user_is_also_warned_about_a_pending_agent(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );
        $this->stub_current_user_roles( array( 'administrator' ) );
        $this->stub_granted_caps();
        Functions\when( 'get_post_status' )->justReturn( 'draft' );
        Functions\when( 'wp_update_post' )->justReturn( new \WP_Error( 'update_failed', 'stop here' ) );

        $manager = $this->gated_status_manager( $this->permissive_sequence() );
        $result  = $manager->transition( 42, 'review' );

        $this->assertIsArray( $result );
        $this->assertTrue( $result['warnings_pending'] );
    }

    /**
     * Sequence mock offering one ai_desk → review edge, where ai_desk carries
     * the given agent config.
     *
     * @param array $agent Agent config for the ai_desk stage ([] for none).
     * @return object
     */
    private function sequence_offering_one_edge( array $agent = array() ): object
    {
        $ai_desk = array( 'key' => 'ai_desk', 'label' => 'AI Desk' );
        if ( $agent ) {
            $ai_desk['agent'] = $agent;
        }

        $sequence = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'get_transitions_for_user' )
            ->andReturn( array( array( 'to' => 'review', 'label' => 'Advance' ) ) );
        $sequence->shouldReceive( 'get_status' )
            ->with( 'ai_desk' )
            ->andReturn( $ai_desk );
        $sequence->shouldReceive( 'get_status' )
            ->with( 'review' )
            ->andReturn( array( 'key' => 'review', 'label' => 'Review' ) );
        return $sequence;
    }

    /** An ai_desk agent config. */
    private const AI_DESK_AGENT = array(
        'ability_id' => 'workflow-agent-fact-check/fact-check',
        'routing'    => array( 'error' => 'review' ),
    );

    /**
     * A working agent owns the way out: the stage offers nobody its edges.
     *
     * The agent moves the post on along one of its outcome routes, so the
     * stage's transitions are not anyone else's to take — the Sequence editor
     * greys the unrouted ones out for the same reason.
     */
    public function test_available_transitions_withheld_while_agent_is_working(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );
        $this->stub_current_user_roles( array( 'editor' ) );

        $manager = $this->gated_status_manager(
            $this->sequence_offering_one_edge( self::AI_DESK_AGENT )
        );

        $this->assertSame( array(), $manager->get_available_transitions( 42 ) );
    }

    /**
     * A bypass-capable user is treated identically — the edges are withheld
     * because the agent owns them, not because of what anyone may do.
     */
    public function test_available_transitions_withheld_from_bypass_user_too(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );
        $this->stub_current_user_roles( array( 'administrator' ) );

        $manager = $this->gated_status_manager(
            $this->sequence_offering_one_edge( self::AI_DESK_AGENT )
        );

        $this->assertSame( array(), $manager->get_available_transitions( 42 ) );
    }

    /**
     * A FAILED run with no recorded origin hands the stage's ROUTED edges back.
     * fail_in_place() schedules nothing further and the go-back cannot be
     * honored (this marker predates `from_stage`), so withholding would strand
     * the post. The offered edge here is the error route's destination — a
     * routed target — which is why it survives the routed-only filter.
     */
    public function test_available_transitions_return_after_an_origin_less_failure(): void
    {
        $this->stub_post_in_ai_stage(
            array(
                'stage_key'  => 'ai_desk',
                'status'     => 'failed',
                'ability_id' => 'x',
                'error'      => 'boom',
            )
        );
        $this->stub_current_user_roles( array( 'editor' ) );

        $manager     = $this->gated_status_manager(
            $this->sequence_offering_one_edge( self::AI_DESK_AGENT )
        );
        $transitions = $manager->get_available_transitions( 42 );

        $this->assertCount( 1, $transitions );
        $this->assertSame( 'review', $transitions[0]['to'] );
    }

    /**
     * A post already sitting in a stage when it gained its agent has no job
     * marker, and nothing will dispatch one. It keeps its edges rather than
     * being stranded waiting for a run that is never coming.
     */
    public function test_available_transitions_offered_when_no_run_was_ever_dispatched(): void
    {
        $this->stub_post_in_ai_stage( '' );
        $this->stub_current_user_roles( array( 'editor' ) );

        $manager     = $this->gated_status_manager(
            $this->sequence_offering_one_edge( self::AI_DESK_AGENT )
        );
        $transitions = $manager->get_available_transitions( 42 );

        $this->assertCount( 1, $transitions );
        $this->assertSame( 'review', $transitions[0]['to'] );
    }

    /**
     * A stage with no agent is untouched by any of this, pending marker or not.
     */
    public function test_available_transitions_untouched_on_a_stage_without_an_agent(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );
        $this->stub_current_user_roles( array( 'editor' ) );

        $manager     = $this->gated_status_manager(
            $this->sequence_offering_one_edge()
        );
        $transitions = $manager->get_available_transitions( 42 );

        $this->assertCount( 1, $transitions );
        $this->assertSame( 'review', $transitions[0]['to'] );
    }

    // =========================================================================
    // Routed-only exits and the failed state's go-back
    // =========================================================================

    /**
     * Sequence mock for an AI stage with two authored edges (review, approve)
     * of which only `review` is routed, plus a defined `draft` origin stage.
     *
     * @return object
     */
    private function sequence_with_unrouted_edge(): object
    {
        $ai_desk = array(
            'key'   => 'ai_desk',
            'label' => 'AI Desk',
            'agent' => array(
                'ability_id' => 'workflow-agent-fact-check/fact-check',
                'routing'    => array( 'pass' => 'review' ),
            ),
        );

        $sequence = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'get_transitions_for_user' )->andReturn(
            array(
                array( 'to' => 'review', 'label' => 'Advance' ),
                array( 'to' => 'approve', 'label' => 'Approve' ),
            )
        );
        $sequence->shouldReceive( 'get_status' )->with( 'ai_desk' )->andReturn( $ai_desk );
        $sequence->shouldReceive( 'get_status' )->with( 'review' )->andReturn( array( 'key' => 'review', 'label' => 'Review' ) );
        $sequence->shouldReceive( 'get_status' )->with( 'approve' )->andReturn( array( 'key' => 'approve', 'label' => 'Approve' ) );
        $sequence->shouldReceive( 'get_status' )->with( 'draft' )->andReturn( array( 'key' => 'draft', 'label' => 'Draft' ) );
        return $sequence;
    }

    /**
     * An AI stage's unrouted transition is never offered — in any job state.
     * The sequence editor draws it disabled and promises it "is not offered to
     * anyone in the post editor"; this filter is that promise's server half.
     */
    public function test_unrouted_transition_is_never_offered(): void
    {
        $this->stub_post_in_ai_stage( '' ); // no job at all — the released state
        $this->stub_current_user_roles( array( 'editor' ) );

        $manager     = $this->gated_status_manager( $this->sequence_with_unrouted_edge() );
        $transitions = $manager->get_available_transitions( 42 );

        $this->assertCount( 1, $transitions );
        $this->assertSame( 'review', $transitions[0]['to'] );
    }

    /**
     * A failed run WITH a resolvable origin withholds the stage's transitions:
     * the one human exit is the go-back (revert_failed_agent_stage), offered by
     * the editor panel, not the transition list.
     */
    public function test_available_transitions_withheld_when_failure_offers_a_go_back(): void
    {
        $this->stub_post_in_ai_stage(
            array(
                'stage_key'  => 'ai_desk',
                'status'     => 'failed',
                'ability_id' => 'x',
                'error'      => 'boom',
                'from_stage' => 'draft',
            )
        );
        $this->stub_current_user_roles( array( 'editor' ) );

        $manager = $this->gated_status_manager( $this->sequence_with_unrouted_edge() );

        $this->assertSame( array(), $manager->get_available_transitions( 42 ) );
    }

    /**
     * transition() refuses an AI stage exit no outcome routes, for a human, in
     * every job state — a hand-built REST call cannot take an edge no surface
     * shows. 403, not a warning.
     */
    public function test_transition_refuses_unrouted_agent_exit(): void
    {
        $this->stub_post_in_ai_stage( '' );
        $this->stub_current_user_roles( array( 'editor' ) );
        $this->stub_granted_caps();

        $sequence = $this->sequence_with_unrouted_edge();
        $sequence->shouldReceive( 'is_transition_allowed' )->andReturn( true );

        $manager = $this->gated_status_manager( $sequence );
        $result  = $manager->transition( 42, 'approve' );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'unrouted_agent_exit', $result->get_error_code() );
    }

    /**
     * get_agent_revert_stage() resolves only for a failed job, on the AI stage
     * it failed at, whose recorded origin the sequence still defines.
     */
    public function test_get_agent_revert_stage_resolves_the_recorded_origin(): void
    {
        $this->stub_post_in_ai_stage(
            array(
                'stage_key'  => 'ai_desk',
                'status'     => 'failed',
                'ability_id' => 'x',
                'error'      => 'boom',
                'from_stage' => 'draft',
            )
        );

        $manager = $this->gated_status_manager( $this->sequence_with_unrouted_edge() );

        $this->assertSame( 'draft', $manager->get_agent_revert_stage( 42 ) );
    }

    /**
     * No origin recorded (a marker predating from_stage) resolves nothing.
     */
    public function test_get_agent_revert_stage_null_without_recorded_origin(): void
    {
        $this->stub_post_in_ai_stage(
            array(
                'stage_key'  => 'ai_desk',
                'status'     => 'failed',
                'ability_id' => 'x',
                'error'      => 'boom',
            )
        );

        $manager = $this->gated_status_manager( $this->sequence_with_unrouted_edge() );

        $this->assertNull( $manager->get_agent_revert_stage( 42 ) );
    }

    /**
     * An origin the sequence no longer defines resolves nothing — the go-back
     * is only offered where transition() could honor it.
     */
    public function test_get_agent_revert_stage_null_when_origin_no_longer_defined(): void
    {
        $this->stub_post_in_ai_stage(
            array(
                'stage_key'  => 'ai_desk',
                'status'     => 'failed',
                'ability_id' => 'x',
                'error'      => 'boom',
                'from_stage' => 'retired_stage',
            )
        );

        $sequence = $this->sequence_with_unrouted_edge();
        $sequence->shouldReceive( 'get_status' )->with( 'retired_stage' )->andReturn( null );

        $manager = $this->gated_status_manager( $sequence );

        $this->assertNull( $manager->get_agent_revert_stage( 42 ) );
    }

    /**
     * A pending (not failed) job resolves nothing — the agent still owns the
     * stage and go-back is not on offer mid-run.
     */
    public function test_get_agent_revert_stage_null_while_job_pending(): void
    {
        $this->stub_post_in_ai_stage( self::fresh_pending_job() );

        $manager = $this->gated_status_manager( $this->sequence_with_unrouted_edge() );

        $this->assertNull( $manager->get_agent_revert_stage( 42 ) );
    }

    /**
     * revert_failed_agent_stage() performs the go-back as an internal
     * agent_revert transition, resets the loop guard first (human intervention,
     * like any human transition into an AI stage), and clears the failed marker
     * compare-and-delete after the move.
     */
    public function test_revert_failed_agent_stage_transitions_back_and_clears_state(): void
    {
        $failed_job = array(
            'stage_key'  => 'ai_desk',
            'status'     => 'failed',
            'ability_id' => 'x',
            'error'      => 'boom',
            'from_stage' => 'draft',
        );
        $this->stub_post_in_ai_stage( $failed_job );

        $deleted = array();
        Functions\when( 'delete_post_meta' )->alias(
            function ( $post_id, $key, $value = '' ) use ( &$deleted ) {
                $deleted[] = array( $key, $value );
                return true;
            }
        );

        $manager = Mockery::mock( StatusManager::class )->makePartial();
        $manager->shouldReceive( 'get_agent_revert_stage' )->with( 42 )->andReturn( 'draft' );
        $manager->shouldReceive( 'transition' )
            ->once()
            ->with( 42, 'draft', array( 'agent_revert' => true ) )
            ->andReturn( true );

        $this->assertTrue( $manager->revert_failed_agent_stage( 42 ) );

        $this->assertContains( array( StageAgentRunner::CHAIN_META, '' ), $deleted, 'The loop guard resets before the move.' );
        $this->assertContains( array( StageAgentRunner::JOB_META, $failed_job ), $deleted, 'The failed marker is cleared compare-and-delete.' );
    }

    /**
     * With no go-back to honor, revert refuses rather than guessing a
     * destination.
     */
    public function test_revert_failed_agent_stage_refuses_without_a_resolvable_origin(): void
    {
        $manager = Mockery::mock( StatusManager::class )->makePartial();
        $manager->shouldReceive( 'get_agent_revert_stage' )->with( 42 )->andReturn( null );
        $manager->shouldReceive( 'transition' )->never();

        $result = $manager->revert_failed_agent_stage( 42 );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'no_agent_revert', $result->get_error_code() );
    }
}
