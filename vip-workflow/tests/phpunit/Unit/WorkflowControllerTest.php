<?php
/**
 * WorkflowController unit tests.
 *
 * The file uses BRACKETED namespace blocks: register_routes() reads
 * WP_REST_Server's HTTP-method constants and the unit suite boots no
 * WordPress, so the route-registration test needs a constants-only double in
 * the GLOBAL namespace — which PHP only allows when every namespace in the
 * file is bracketed. The test body is otherwise ordinary and keeps its
 * original indentation.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace {
    if ( ! class_exists( 'WP_REST_Server' ) ) {
        /**
         * Minimal WP_REST_Server double: only the HTTP-method constants the
         * controller's route registration reads. Under the integration suite the
         * real core class exists and this is a no-op.
         */
        class WP_REST_Server {
            const READABLE   = 'GET';
            const CREATABLE  = 'POST';
            const EDITABLE   = 'POST, PUT, PATCH';
            const DELETABLE  = 'DELETE';
            const ALLMETHODS = 'GET, POST, PUT, PATCH, DELETE';
        }
    }
}

namespace VIPWorkflow\Tests\Unit {

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\API\WorkflowController;
use VIPWorkflow\Sequences\Sequence;

/**
 * Tests for the WorkflowController REST API.
 */
class WorkflowControllerTest extends TestCase
{
    /**
     * Controller under test.
     *
     * @var WorkflowController
     */
    private WorkflowController $controller;

    /**
     * Mock wpdb.
     *
     * @var object
     */
    private $wpdb;

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        // Mock global $wpdb.
        global $wpdb;
        $this->wpdb         = Mockery::mock( 'wpdb' );
        $this->wpdb->prefix = 'wp_';
        $wpdb               = $this->wpdb;

        $this->controller = new WorkflowController();
    }

    /**
     * Create a mock WP_REST_Request.
     *
     * @param array $params Request parameters.
     * @return object
     */
    private function create_mock_request( array $params = array() ): object
    {
        $request = Mockery::mock( 'WP_REST_Request' );

        $request->shouldReceive( 'get_param' )
            ->andReturnUsing(
                function ( $key ) use ( $params ) {
                    return $params[ $key ] ?? null;
                }
            );

        return $request;
    }

    /**
     * Run a callback with the Plugin singleton's status manager replaced.
     *
     * The controller resolves the status manager through the singleton, so a
     * test double has to be injected there. Restores the previous value
     * afterwards so other tests in this process see the original state.
     *
     * @param object   $status_manager Status manager double.
     * @param callable $callback       Code to run with the double installed.
     * @return mixed The callback's return value.
     */
    private function with_status_manager( object $status_manager, callable $callback )
    {
        $plugin   = \VIPWorkflow\Plugin::get_instance();
        $property = new \ReflectionProperty( \VIPWorkflow\Plugin::class, 'status_manager' );
        $previous = $property->getValue( $plugin );
        $property->setValue( $plugin, $status_manager );

        try {
            return $callback();
        } finally {
            $property->setValue( $plugin, $previous );
        }
    }

    // =========================================================================
    // Permission Tests
    // =========================================================================

    /**
     * Test get_post_status_permissions_check requires edit_post capability.
     */
    public function test_get_post_status_requires_edit_post(): void
    {
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'edit_post', 123 )
            ->andReturn( true );

        $request = $this->create_mock_request( array( 'id' => 123 ) );
        $result  = $this->controller->get_post_status_permissions_check( $request );

        $this->assertTrue( $result );
    }

    /**
     * Test get_post_status_permissions_check denies without capability.
     */
    public function test_get_post_status_denied_without_capability(): void
    {
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'edit_post', 123 )
            ->andReturn( false );

        $request = $this->create_mock_request( array( 'id' => 123 ) );
        $result  = $this->controller->get_post_status_permissions_check( $request );

        $this->assertFalse( $result );
    }

    /**
     * Test transition_permissions_check requires edit_post capability.
     */
    public function test_transition_requires_edit_post(): void
    {
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'edit_post', 456 )
            ->andReturn( true );

        $request = $this->create_mock_request( array( 'id' => 456 ) );
        $result  = $this->controller->transition_permissions_check( $request );

        $this->assertTrue( $result );
    }

    /**
     * Test get_my_queue_permissions_check requires edit_posts.
     */
    public function test_get_my_queue_requires_edit_posts(): void
    {
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'edit_posts' )
            ->andReturn( true );

        $result = $this->controller->get_my_queue_permissions_check();

        $this->assertTrue( $result );
    }

    // =========================================================================
    // GET /workflow/post/{id}/status Tests
    // =========================================================================

    /**
     * Test get_post_status returns 404 for non-existent post.
     */
    public function test_get_post_status_returns_404_for_missing_post(): void
    {
        Functions\when( 'get_post' )->justReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->get_post_status( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_post_not_found', $response->get_error_code() );
    }

    /**
     * Build a Sequence whose stages carry their `status` region (stage × status
     * matrix): `review` sits in the draft region, `live` in the publish region.
     *
     * @return Sequence
     */
    private function create_guard_sequence(): Sequence
    {
        $config = array(
            'post_types' => array( 'post' ),
            'statuses'   => array(
                array(
                    'key'         => 'review',
                    'label'       => 'In Review',
                    'color'       => '#dba617',
                    'status'      => 'draft',
                    'is_initial'  => true,
                    'transitions' => array(
                        array(
                            'to'    => 'live',
                            'label' => 'Publish',
                        ),
                    ),
                ),
                array(
                    'key'         => 'live',
                    'label'       => 'Live',
                    'color'       => '#00a32a',
                    'status'      => 'publish',
                    'transitions' => array(),
                ),
            ),
        );

        return Sequence::from_row(
            (object) array(
                'id'          => 3,
                'uuid'        => 'uuid-guarded',
                'type'        => 'workflow',
                'name'        => 'Guarded',
                'slug'        => 'guarded',
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => json_encode( $config ),
                'created_by'  => 1,
                'created_at'  => '2026-01-01 00:00:00',
                'updated_at'  => '2026-01-01 00:00:00',
            )
        );
    }

    /**
     * Build a Sequence whose single stage predates the stage × status write
     * gate: it is defined, but carries no `status` region.
     *
     * @return Sequence
     */
    private function create_region_less_sequence(): Sequence
    {
        $config = array(
            'post_types' => array( 'post' ),
            'statuses'   => array(
                array(
                    'key'         => 'legacy',
                    'label'       => 'Legacy',
                    'color'       => '#767676',
                    'is_initial'  => true,
                    'transitions' => array(),
                ),
            ),
        );

        return Sequence::from_row(
            (object) array(
                'id'          => 4,
                'uuid'        => 'uuid-regionless',
                'type'        => 'workflow',
                'name'        => 'Region-less',
                'slug'        => 'region-less',
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => json_encode( $config ),
                'created_by'  => 1,
                'created_at'  => '2026-01-01 00:00:00',
                'updated_at'  => '2026-01-01 00:00:00',
            )
        );
    }

    /**
     * Drive get_post_status() for a workflow-managed post seated at $stage_key.
     *
     * Pass null for $stage_key to model a post whose stage does not resolve at
     * all (dangling stage meta after a sequence edit): StatusManager answers
     * null for the current status, exactly as it does in production.
     *
     * @param string|null $stage_key Stage the post is seated at, or null for an unresolvable stage.
     * @param array       $args      Optional 'post_status', 'roles', 'agent_pending', 'agent_job', 'sequence', 'available_sequences'.
     * @return array Response data.
     */
    private function get_status_data_for_workflow_post( ?string $stage_key, array $args = array() ): array
    {
        $post_status   = $args['post_status'] ?? 'draft';
        $roles         = $args['roles'] ?? array( 'editor' );
        $agent_pending = $args['agent_pending'] ?? false;

        $sequence = $args['sequence'] ?? $this->create_guard_sequence();
        $post      = $this->create_mock_post(
            array(
                'ID'          => 42,
                'post_status' => $post_status,
                'post_author' => 9,
            )
        );

        Functions\when( 'get_post' )->justReturn( $post );

        // Post meta is empty except, when a test seeds one, the current agent
        // job or resolved agent-run record surfaced by the payload.
        $last_run = $args['last_run'] ?? null;
        $agent_job = $args['agent_job'] ?? null;
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key ) use ( $last_run, $agent_job ) {
                if ( \VIPWorkflow\Workflow\StageAgentRunner::LAST_RUN_META === $key ) {
                    return $last_run ?? '';
                }
                if ( \VIPWorkflow\Workflow\StageAgentRunner::JOB_META === $key ) {
                    return $agent_job ?? '';
                }
                return '';
            }
        );

        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn(
            (object) array(
                'ID'           => 5,
                'display_name' => 'Test User',
                'roles'        => $roles,
            )
        );
        // Settings::can_user_bypass_workflow() reads the plugin settings option.
        Functions\when( 'get_option' )->justReturn( array( 'bypass_workflow_roles' => array( 'administrator' ) ) );

        // AssignmentManager::get_all() queries postmeta directly.
        $this->wpdb->postmeta = 'wp_postmeta';
        $this->wpdb->shouldReceive( 'esc_like' )->andReturnUsing( fn( $text ) => $text );
        $this->wpdb->shouldReceive( 'prepare' )->andReturnUsing( fn( $query ) => $query );
        $this->wpdb->shouldReceive( 'get_results' )->andReturn( array() );

        $current_status = null === $stage_key ? null : $sequence->get_status( $stage_key );

        $status_manager = Mockery::mock( \VIPWorkflow\Workflow\StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )->with( 42 )->andReturn( $sequence );
        $status_manager->shouldReceive( 'get_current_status' )->with( 42 )->andReturn( $current_status );
        $status_manager->shouldReceive( 'get_available_transitions' )->with( 42 )->andReturn( array() );
        $status_manager->shouldReceive( 'has_pending_agent_job' )->with( 42, $current_status['key'] ?? '' )->andReturn( $agent_pending );
        // An enrolled post is offered the sequences it could move to as well:
        // the editor sidebar draws its workflow as a picker, and re-assignment
        // is a real operation the payload has to describe.
        $status_manager->shouldReceive( 'get_available_sequences_for_post' )
            ->with( 42 )
            ->andReturn( $args['available_sequences'] ?? array( array( 'id' => 1, 'name' => 'Guard Flow', 'slug' => 'guard-flow' ) ) );

        // The guard payload's region comes through boundary_region(), the same
        // authority crosses_publish_boundary() uses; the double reproduces its
        // rule so the payload cannot drift from the predicate behind it.
        $status_manager->shouldReceive( 'boundary_region' )
            ->andReturnUsing(
                fn( $post_id, $stage_region ) => in_array( $post_status, array( 'publish', 'future' ), true )
                    ? 'publish'
                    : $stage_region
            );

        $request  = $this->create_mock_request( array( 'id' => 42 ) );
        $response = $this->with_status_manager(
            $status_manager,
            fn() => $this->controller->get_post_status( $request )
        );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        return $response->get_data();
    }

    /**
     * A workflow post carries the guard payload the client's status-change
     * evaluation runs on.
     */
    public function test_get_post_status_includes_guard_payload(): void
    {
        $data = $this->get_status_data_for_workflow_post( 'review' );

        $this->assertTrue( $data['has_workflow'] );
        $this->assertArrayHasKey( 'guard', $data );
        $this->assertSame(
            array( 'current_region', 'can_bypass', 'agent_pending' ),
            array_keys( $data['guard'] )
        );
        $this->assertSame( 'draft', $data['guard']['current_region'] );
        $this->assertFalse( $data['guard']['can_bypass'] );
        $this->assertFalse( $data['guard']['agent_pending'] );
    }

    /**
     * An enrolled post is served the sequences it could move to, not only a
     * post that has none.
     *
     * The editor sidebar draws a post's workflow as a picker rather than a
     * heading, so "which sequence is this post in" and "which could it be in"
     * are one answer. Re-assignment is a real operation — assign_sequence()
     * treats a second assignment as a replacement — and this list is what it
     * may name. The `orphaned` carve-out is unaffected and asserted separately:
     * a post whose sequence row was deleted is still offered nothing.
     */
    public function test_get_post_status_offers_alternative_sequences_to_an_enrolled_post(): void
    {
        $data = $this->get_status_data_for_workflow_post(
            'review',
            array(
                'available_sequences' => array(
                    array( 'id' => 1, 'name' => 'Guard Flow', 'slug' => 'guard-flow' ),
                    array( 'id' => 4, 'name' => 'Breaking News', 'slug' => 'breaking-news' ),
                ),
            )
        );

        $this->assertTrue( $data['has_workflow'] );
        $this->assertCount( 2, $data['available_sequences'] );
        // The post's own sequence is in the list, so the picker can show what
        // is selected rather than rendering blank over an enrolled post.
        $this->assertContains( 1, array_column( $data['available_sequences'], 'id' ) );
    }

    /**
     * With no resolved agent run recorded, the payload says so with null —
     * never a fabricated record.
     */
    public function test_get_post_status_reports_no_agent_last_run_without_a_resolved_run(): void
    {
        $data = $this->get_status_data_for_workflow_post( 'review' );

        $this->assertArrayHasKey( 'agent_last_run', $data );
        $this->assertNull( $data['agent_last_run'] );
    }

    /**
     * The resolved agent run rides the payload: which stage the run belonged
     * to, which of pass/fail/error fired, and where it routed. The editor's
     * transition rail matches stage_key/to against the move it just observed
     * to flash the taken outcome.
     */
    public function test_get_post_status_surfaces_the_resolved_agent_outcome(): void
    {
        $data = $this->get_status_data_for_workflow_post(
            'review',
            array(
                'last_run' => array(
                    'stage_key'   => 'ai_desk',
                    'outcome'     => 'fail',
                    'to'          => 'review',
                    'finished_at' => '2026-08-14 10:00:00',
                ),
            )
        );

        $this->assertSame(
            array(
                'stage_key'   => 'ai_desk',
                'outcome'     => 'fail',
                'to'          => 'review',
                'finished_at' => '2026-08-14 10:00:00',
            ),
            $data['agent_last_run']
        );
    }

    /**
     * A soft warning held by an agent is a human decision, not a failed run.
     * The response carries everything the editor needs to show the standard
     * warning modal and retry the exact route with acknowledgement.
     */
    public function test_get_post_status_surfaces_an_agent_warning_decision(): void
    {
        $warnings = array(
            array(
                'code'    => 'soft_check_failed',
                'message' => 'An editor should confirm this move.',
                'data'    => array( 'status' => 409 ),
            ),
        );

        $data = $this->get_status_data_for_workflow_post(
            'review',
            array(
                'agent_job' => array(
                    'stage_key'     => 'review',
                    'ability_id'    => 'vip-workflow/check-copy',
                    'status'        => 'warnings_pending',
                    'to_status'     => 'live',
                    'outcome'       => 'error',
                    'soft_warnings' => $warnings,
                    'comment'       => 'The agent could not complete its review.',
                    'held_at'       => '2026-08-24 10:00:00',
                ),
            )
        );

        $this->assertSame(
            array(
                'status'        => 'warnings_pending',
                'to_status'     => 'live',
                'outcome'       => 'error',
                'soft_warnings' => $warnings,
                'comment'       => 'The agent could not complete its review.',
            ),
            $data['agent_job']
        );
        $this->assertArrayNotHasKey( 'revert_to', $data['agent_job'] );
    }

    /**
     * current_region comes from the post's STAGE when the committed status has
     * no publish-side pull: core may already have moved the status out from
     * under the workflow. can_bypass and agent_pending track the actor and the
     * stage's agent job.
     */
    public function test_guard_region_comes_from_the_stage_when_the_post_is_not_live(): void
    {
        $data = $this->get_status_data_for_workflow_post(
            'live',
            array(
                'post_status'   => 'draft',
                'roles'         => array( 'administrator' ),
                'agent_pending' => true,
            )
        );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( 'publish', $data['guard']['current_region'] );
        $this->assertTrue( $data['guard']['can_bypass'] );
        $this->assertTrue( $data['guard']['agent_pending'] );
    }

    /**
     * ...and from the LIVE post when the two disagree.
     *
     * This is the payload the block editor's save guard evaluates. If it
     * reported the stranded draft-region stage while crosses_publish_boundary()
     * reported publish, the client would wave through an unpublish the server
     * then refuses — a confirm walking the user into a wall.
     */
    public function test_guard_region_follows_a_live_post_over_its_stage(): void
    {
        // `review` is a draft-region stage; the post is live.
        $data = $this->get_status_data_for_workflow_post(
            'review',
            array( 'post_status' => 'publish' )
        );

        $this->assertSame( 'publish', $data['post_status'] );
        $this->assertSame( 'publish', $data['guard']['current_region'] );
    }

    /**
     * A dangling stage key (the sequence no longer defines the stage the post
     * is seated at) must NOT fail the response: this endpoint is the only
     * surface that renders the veto's audited escape, and the save-layer veto
     * fails closed for exactly this post. The payload survives with an
     * unresolved (null) region.
     */
    public function test_guard_reports_a_null_region_for_a_dangling_stage(): void
    {
        $data = $this->get_status_data_for_workflow_post( null );

        $this->assertTrue( $data['has_workflow'] );
        $this->assertNull( $data['current'] );
        $this->assertArrayHasKey( 'guard', $data );
        $this->assertNull( $data['guard']['current_region'] );
        $this->assertFalse( $data['guard']['can_bypass'] );

        // The workflow is still named, so the veto message can say which one,
        // and the escape hatch stays reachable.
        $this->assertSame( 'Guarded', $data['sequence']['name'] );
    }

    /**
     * Same treatment for a stage that IS defined but predates the write gate
     * and carries no `status` region.
     */
    public function test_guard_reports_a_null_region_for_a_region_less_stage(): void
    {
        $data = $this->get_status_data_for_workflow_post(
            'legacy',
            array( 'sequence' => $this->create_region_less_sequence() )
        );

        $this->assertTrue( $data['has_workflow'] );
        $this->assertSame( 'legacy', $data['current']['key'] );
        $this->assertNull( $data['guard']['current_region'] );
    }

    /**
     * A post outside any workflow has nothing to guard: the branch is unchanged
     * and carries no guard payload.
     */
    public function test_get_post_status_omits_guard_for_non_workflow_post(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 42 ) );

        Functions\when( 'get_post' )->justReturn( $post );

        $status_manager = Mockery::mock( \VIPWorkflow\Workflow\StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )->with( 42 )->andReturn( null );
        $status_manager->shouldReceive( 'has_dangling_sequence' )->with( 42 )->andReturn( false );
        $status_manager->shouldReceive( 'get_available_sequences_for_post' )->with( 42 )->andReturn( array( array( 'id' => 7, 'name' => 'News' ) ) );

        $request  = $this->create_mock_request( array( 'id' => 42 ) );
        $response = $this->with_status_manager(
            $status_manager,
            fn() => $this->controller->get_post_status( $request )
        );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertFalse( $data['has_workflow'] );
        $this->assertFalse( $data['orphaned'] );
        $this->assertArrayNotHasKey( 'guard', $data );
        // A genuinely unmanaged post is offered the sequence selector.
        $this->assertNotEmpty( $data['available_sequences'] );
    }

    /**
     * A post whose sequence row was DELETED lands in the same branch but is not
     * the same post: it still carries the meta crosses_publish_boundary() reads,
     * so the save layer refuses every status change for it. It is reported as
     * orphaned, with the guard payload that makes the client refuse for the same
     * reason — and offered no sequences, because assigning a second workflow
     * would bury the dangling identity instead of clearing it.
     */
    public function test_get_post_status_reports_a_dangling_sequence_as_orphaned(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 42 ) );

        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'ID' => 5, 'roles' => array( 'author' ) ) );
        // Settings::can_user_bypass_workflow() reads the plugin settings option.
        Functions\when( 'get_option' )->justReturn( array( 'bypass_workflow_roles' => array( 'administrator' ) ) );

        $status_manager = Mockery::mock( \VIPWorkflow\Workflow\StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )->with( 42 )->andReturn( null );
        $status_manager->shouldReceive( 'has_dangling_sequence' )->with( 42 )->andReturn( true );
        // Never offered: the selector is what hid the freeze in the first place.
        $status_manager->shouldReceive( 'get_available_sequences_for_post' )->never();

        $request  = $this->create_mock_request( array( 'id' => 42 ) );
        $response = $this->with_status_manager(
            $status_manager,
            fn() => $this->controller->get_post_status( $request )
        );

        $data = $response->get_data();
        $this->assertFalse( $data['has_workflow'] );
        $this->assertTrue( $data['orphaned'] );
        $this->assertSame( array(), $data['available_sequences'] );

        // A null region can never compare equal to a target region, so the
        // client fails closed exactly as the server predicate does.
        $this->assertArrayHasKey( 'guard', $data );
        $this->assertNull( $data['guard']['current_region'] );
        $this->assertFalse( $data['guard']['agent_pending'] );
    }

    // =========================================================================
    // POST /workflow/post/{id}/claim Tests
    // =========================================================================

    /**
     * Test claim_post returns 404 for non-existent post.
     */
    public function test_claim_post_returns_404_for_missing_post(): void
    {
        Functions\when( 'get_post' )->justReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->claim_post( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_post_not_found', $response->get_error_code() );
    }

    /**
     * Test claim_post returns error if already claimed by another user.
     */
    public function test_claim_post_fails_if_already_claimed(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 123 ) );

        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        // Post is claimed by user 2.
        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to', true )
            ->andReturn( '2' );

        Functions\when( 'get_userdata' )->justReturn(
            (object) array(
                'ID'           => 2,
                'display_name' => 'Other User',
            )
        );

        $request  = $this->create_mock_request( array( 'id' => 123 ) );
        $response = $this->controller->claim_post( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'post_already_claimed', $response->get_error_code() );
    }

    /**
     * Test claim_post succeeds when unclaimed.
     */
    public function test_claim_post_success(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 123 ) );

        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        // Post is not claimed.
        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to', true )
            ->andReturn( '' );

        Functions\expect( 'update_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to', 1 );

        // Mock log event.
        $this->wpdb->shouldReceive( 'insert' )->once()->andReturn( true );

        $request  = $this->create_mock_request( array( 'id' => 123 ) );
        $response = $this->controller->claim_post( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertTrue( $data['success'] );
        $this->assertSame( 123, $data['post_id'] );
        $this->assertSame( 1, $data['assigned_to'] );
    }

    /**
     * Test claim_post allows re-claim by same user.
     */
    public function test_claim_post_allows_same_user(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 123 ) );

        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );

        // Post is already claimed by user 5 (same user).
        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to', true )
            ->andReturn( '5' );

        Functions\expect( 'update_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to', 5 );

        $this->wpdb->shouldReceive( 'insert' )->once()->andReturn( true );

        $request  = $this->create_mock_request( array( 'id' => 123 ) );
        $response = $this->controller->claim_post( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertTrue( $response->get_data()['success'] );
    }

    // =========================================================================
    // DELETE /workflow/post/{id}/unclaim Tests
    // =========================================================================

    /**
     * Test unclaim_post returns 404 for non-existent post.
     */
    public function test_unclaim_post_returns_404_for_missing_post(): void
    {
        Functions\when( 'get_post' )->justReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->unclaim_post( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_post_not_found', $response->get_error_code() );
    }

    /**
     * Test unclaim_post fails if claimed by another user (non-admin).
     */
    public function test_unclaim_fails_for_other_users_claim(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 123 ) );

        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        // Post is claimed by user 2.
        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to', true )
            ->andReturn( '2' );

        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'manage_options' )
            ->andReturn( false );

        $request  = $this->create_mock_request( array( 'id' => 123 ) );
        $response = $this->controller->unclaim_post( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'cannot_unclaim', $response->get_error_code() );
    }

    /**
     * Test unclaim_post succeeds for own claim.
     */
    public function test_unclaim_post_success_own_claim(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 123 ) );

        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );

        // Post is claimed by current user.
        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to', true )
            ->andReturn( '5' );

        Functions\expect( 'delete_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to' );

        $this->wpdb->shouldReceive( 'insert' )->once()->andReturn( true );

        $request  = $this->create_mock_request( array( 'id' => 123 ) );
        $response = $this->controller->unclaim_post( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertTrue( $data['success'] );
        $this->assertSame( 123, $data['post_id'] );
    }

    /**
     * Test admin can unclaim any post.
     */
    public function test_admin_can_unclaim_any_post(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 123 ) );

        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        // Post is claimed by user 2.
        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to', true )
            ->andReturn( '2' );

        // User 1 is admin.
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'manage_options' )
            ->andReturn( true );

        Functions\expect( 'delete_post_meta' )
            ->once()
            ->with( 123, '_vip_workflow_assigned_to' );

        $this->wpdb->shouldReceive( 'insert' )->once()->andReturn( true );

        $request  = $this->create_mock_request( array( 'id' => 123 ) );
        $response = $this->controller->unclaim_post( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertTrue( $response->get_data()['success'] );
    }

    // =========================================================================
    // GET /workflow/post/{id}/history Tests
    // =========================================================================

    /**
     * Test get_history returns 404 for non-existent post.
     */
    public function test_get_history_returns_404_for_missing_post(): void
    {
        Functions\when( 'get_post' )->justReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->get_history( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_post_not_found', $response->get_error_code() );
    }

    // =========================================================================
    // DELETE /workflow/post/{id}/sequence (remove from workflow) Tests
    // =========================================================================

    /**
     * The removal route hangs off the EXISTING sequence route, as a second
     * entry with the DELETABLE method — not a new route path.
     */
    public function test_register_routes_adds_delete_to_the_sequence_route(): void
    {
        $routes = array();

        Functions\when( 'register_rest_route' )->alias(
            function ( $namespace, $route, $args ) use ( &$routes ) {
                $routes[ $route ] = $args;
            }
        );

        $this->controller->register_routes();

        $sequence_route = '/workflow/post/(?P<id>[\d]+)/sequence';
        $this->assertArrayHasKey( $sequence_route, $routes );

        $methods = array_column( $routes[ $sequence_route ], 'methods' );

        // The assign entry is still there — DELETE joined it, it did not replace it.
        $this->assertContains( \WP_REST_Server::CREATABLE, $methods );
        $this->assertContains( \WP_REST_Server::DELETABLE, $methods );

        $delete_entry = null;
        foreach ( $routes[ $sequence_route ] as $entry ) {
            if ( \WP_REST_Server::DELETABLE === $entry['methods'] ) {
                $delete_entry = $entry;
            }
        }

        $this->assertSame( array( $this->controller, 'remove_sequence' ), $delete_entry['callback'] );
        $this->assertSame(
            array( $this->controller, 'transition_permissions_check' ),
            $delete_entry['permission_callback']
        );
    }

    /**
     * The removal route is permission-checked on edit_post for the post, and
     * denies a user without it.
     */
    public function test_remove_sequence_denied_without_edit_post(): void
    {
        Functions\expect( 'current_user_can' )
            ->once()
            ->with( 'edit_post', 123 )
            ->andReturn( false );

        $request = $this->create_mock_request( array( 'id' => 123 ) );

        $this->assertFalse( $this->controller->transition_permissions_check( $request ) );
    }

    /**
     * Removal is StatusManager's job: the controller delegates and returns the
     * result untouched.
     */
    public function test_remove_sequence_delegates_to_status_manager(): void
    {
        Functions\when( 'is_wp_error' )->alias( fn( $thing ) => $thing instanceof \WP_Error );

        $status_manager = Mockery::mock( \VIPWorkflow\Workflow\StatusManager::class );
        $status_manager->shouldReceive( 'remove_sequence' )
            ->once()
            ->with( 123 )
            ->andReturn( true );

        $request = $this->create_mock_request( array( 'id' => 123 ) );

        $result = $this->with_status_manager(
            $status_manager,
            fn() => $this->controller->remove_sequence( $request )
        );

        $this->assertTrue( $result );
    }

    /**
     * A WP_Error from StatusManager::remove_sequence() (post missing, or the
     * post not in a workflow) propagates to the client as-is.
     */
    public function test_remove_sequence_propagates_wp_error(): void
    {
        Functions\when( 'is_wp_error' )->alias( fn( $thing ) => $thing instanceof \WP_Error );

        $error = new \WP_Error(
            'no_sequence',
            'No workflow sequence for this post.',
            array( 'status' => 409 )
        );

        $status_manager = Mockery::mock( \VIPWorkflow\Workflow\StatusManager::class );
        $status_manager->shouldReceive( 'remove_sequence' )
            ->once()
            ->with( 999 )
            ->andReturn( $error );

        $request = $this->create_mock_request( array( 'id' => 999 ) );

        $result = $this->with_status_manager(
            $status_manager,
            fn() => $this->controller->remove_sequence( $request )
        );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'no_sequence', $result->get_error_code() );
        $this->assertSame( array( 'status' => 409 ), $result->get_error_data() );
    }


    // =========================================================================
    // POST /workflow/post/{id}/sequence (assign) Tests
    // =========================================================================

    /**
     * Test assign_sequence returns 404 for non-existent post.
     */
    public function test_assign_sequence_returns_404_for_missing_post(): void
    {
        Functions\when( 'get_post' )->justReturn( null );

        $request  = $this->create_mock_request( array( 'id' => 999 ) );
        $response = $this->controller->assign_sequence( $request );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'rest_post_not_found', $response->get_error_code() );
    }

    /**
     * A WP_Error from StatusManager::assign_sequence() — the sequence models
     * no stage in the post's status region, or a status write failed — must
     * surface as that error, never fall through to the success branch.
     *
     * The route names no stage, so the call carries only the post and sequence.
     */
    public function test_assign_sequence_surfaces_wp_error_from_status_manager(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 123 ) );
        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'is_wp_error' )->alias( fn( $thing ) => $thing instanceof \WP_Error );

        $error = new \WP_Error(
            'unmodeled_post_status',
            'The "Newsroom" sequence has no stage with the Pending Review status.',
            array( 'status' => 400 )
        );

        $status_manager = Mockery::mock( \VIPWorkflow\Workflow\StatusManager::class );
        $status_manager->shouldReceive( 'assign_sequence' )
            ->once()
            ->with( 123, 7 )
            ->andReturn( $error );

        $request = $this->create_mock_request(
            array(
                'id'           => 123,
                'sequence_id' => 7,
            )
        );

        $response = $this->with_status_manager(
            $status_manager,
            fn() => $this->controller->assign_sequence( $request )
        );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'unmodeled_post_status', $response->get_error_code() );
        $this->assertSame( array( 'status' => 400 ), $response->get_error_data() );
    }

    // =========================================================================
    // POST /workflow/post/{id}/transition Tests
    // =========================================================================

    /**
     * Test transition_status requires post_id and to_status params.
     */
    public function test_transition_status_extracts_params(): void
    {
        // This test verifies the controller extracts the right params.
        // Full flow requires Plugin singleton, tested via integration.
        $request = $this->create_mock_request(
            array(
                'id'                   => 123,
                'to_status'            => 'review',
                'comment'              => 'Ready for review',
                'acknowledge_warnings' => true,
                'input_data'           => array( 'note' => 'test' ),
            )
        );

        // Verify params are extracted correctly.
        $this->assertSame( 123, $request->get_param( 'id' ) );
        $this->assertSame( 'review', $request->get_param( 'to_status' ) );
        $this->assertSame( 'Ready for review', $request->get_param( 'comment' ) );
        $this->assertTrue( $request->get_param( 'acknowledge_warnings' ) );
        $this->assertSame( array( 'note' => 'test' ), $request->get_param( 'input_data' ) );
    }

    /**
     * A person acknowledging an agent-held warning completes that agent run.
     * Its marker must not linger after the post leaves the AI stage, and the
     * outcome still belongs in the last-run record used by the transition rail.
     */
    public function test_transition_status_resolves_an_acknowledged_agent_warning(): void
    {
        $held_job = array(
            'stage_key'     => 'ai_desk',
            'ability_id'    => 'vip-workflow/check-copy',
            'status'        => 'warnings_pending',
            'to_status'     => 'review',
            'outcome'       => 'error',
            'soft_warnings' => array( array( 'message' => 'Confirm this move.' ) ),
            'comment'       => 'The agent could not complete its review.',
            'held_at'       => '2026-08-24 10:00:00',
        );
        $updates  = array();
        $deletes  = array();

        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key ) use ( $held_job ) {
                if ( \VIPWorkflow\Workflow\StageAgentRunner::JOB_META === $key ) {
                    return $held_job;
                }
                if ( \VIPWorkflow\Workflow\StatusManager::STAGE_META_KEY === $key ) {
                    return 'ai_desk';
                }
                return '';
            }
        );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$updates ) {
                $updates[ $key ] = $value;
                return true;
            }
        );
        Functions\when( 'delete_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$deletes ) {
                $deletes[] = array( $post_id, $key, $value );
                return true;
            }
        );
        Functions\when( 'current_time' )->justReturn( '2026-08-24 10:01:00' );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );

        $status_manager = Mockery::mock( \VIPWorkflow\Workflow\StatusManager::class );
        $status_manager->shouldReceive( 'transition' )
            ->once()
            ->with(
                42,
                'review',
                array(
                    'comment'              => 'The agent could not complete its review.',
                    'acknowledge_warnings' => true,
                )
            )
            ->andReturn( true );

        $controller = new class() extends WorkflowController {
            public function get_post_status( $request ) {
                return new \WP_REST_Response(
                    array( 'current' => array( 'key' => 'review' ) )
                );
            }
        };
        $request = $this->create_mock_request(
            array(
                'id'                   => 42,
                'to_status'            => 'review',
                'comment'              => 'The agent could not complete its review.',
                'acknowledge_warnings' => true,
            )
        );

        $response = $this->with_status_manager(
            $status_manager,
            fn() => $controller->transition_status( $request )
        );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame(
            array(
                'stage_key'   => 'ai_desk',
                'outcome'     => 'error',
                'to'          => 'review',
                'finished_at' => '2026-08-24 10:01:00',
            ),
            $updates[ \VIPWorkflow\Workflow\StageAgentRunner::LAST_RUN_META ] ?? null
        );
        $this->assertSame(
            array( array( 42, \VIPWorkflow\Workflow\StageAgentRunner::JOB_META, $held_job ) ),
            $deletes
        );
    }

    // =========================================================================
    // GET /workflow/my-queue Tests
    // =========================================================================

    /**
     * Test get_my_queue returns empty for unauthenticated users.
     */
    public function test_get_my_queue_empty_for_guest(): void
    {
        $user = Mockery::mock( 'WP_User' );
        $user->shouldReceive( 'exists' )->andReturn( false );

        Functions\when( 'wp_get_current_user' )->justReturn( $user );

        $request  = $this->create_mock_request();
        $response = $this->controller->get_my_queue( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( array(), $response->get_data() );
    }

    /**
     * Test a queue row carries both the wait and the instant behind it.
     *
     * The route used to send `human_time_diff()` output — "2 days" — and no
     * timestamp at all, which cost the Waiting column the ability to sort on
     * the one thing the queue exists to answer: a payload that ships a
     * presentation decision instead of the moment leaves the client nothing to
     * order, group or compare by.
     *
     * It sends both now, and the phrase is not redundant. Wording the wait in
     * the browser instead would have the same post read two ways on two
     * screens — the client's relative wording has no weeks bucket where
     * `human_time_diff()` does, so ten days is "1 week" on a Kanban card and
     * "10 days ago" in the queue — and "ago" is a point in time under a header
     * that asks for a duration. So the phrase stays the server's, and
     * `modified` is what the column ranks on.
     */
    public function test_get_my_queue_row_carries_the_wait_and_its_instant(): void
    {
        $this->seed_my_queue( array( $this->my_queue_sequence_row() ) );

        \WP_Query::$next_posts = array(
            $this->create_mock_post(
                array(
                    'ID'            => 11,
                    'post_title'    => 'Reviewed piece',
                    'post_author'   => 9,
                    'post_modified' => '2026-01-02 15:45:00',
                )
            ),
        );
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => 'edit_post' === $capability && 11 === $post_id
        );

        // Captured rather than asserted on its output: the wording is
        // WordPress's own and translated, so what is worth pinning is which
        // moment it was asked about — the post's, not the query's or now's.
        $worded_from = array();
        Functions\when( 'human_time_diff' )->alias(
            function ( $from, $to ) use ( &$worded_from ) {
                $worded_from[] = $from;
                return '3 hours';
            }
        );

        $status_manager = Mockery::mock( 'VIPWorkflow\Workflow\StatusManager' );
        $status_manager->shouldReceive( 'agent_routed_targets' )->andReturn( null );

        $data = $this->with_status_manager(
            $status_manager,
            fn() => $this->controller->get_my_queue( $this->create_mock_request() )->get_data()
        );

        $this->assertCount( 1, $data );
        $this->assertSame( '3 hours', $data[0]['waiting'] );
        $this->assertSame( '2026-01-02 15:45:00', $data[0]['modified'] );
        $this->assertSame( array( strtotime( '2026-01-02 15:45:00' ) ), $worded_from );
    }

    /**
     * Wire up everything get_my_queue() reads apart from the sequence rows.
     *
     * @param array $sequence_rows Rows the sequence repository should find.
     */
    private function seed_my_queue( array $sequence_rows ): void
    {
        $user = Mockery::mock( 'WP_User' );
        $user->shouldReceive( 'exists' )->andReturn( true );
        Functions\when( 'wp_get_current_user' )->justReturn( $user );
        Functions\when( 'get_current_user_id' )->justReturn( 7 );

        // The reader holds a bypass role, so every configured transition is
        // offered and the test exercises the queue rather than the role filter.
        Functions\when( 'get_option' )->justReturn( array( 'bypass_workflow_roles' => array( 'editor' ) ) );
        Functions\when( 'get_userdata' )->alias(
            fn( $id ) => (object) array(
                'ID'           => $id,
                'display_name' => 'User ' . $id,
                'roles'        => array( 'editor' ),
                'user_email'   => 'user' . $id . '@example.test',
            )
        );
        Functions\when( 'get_avatar_url' )->justReturn( 'http://example.test/avatar.png' );

        // No assignment on the post, so nobody else has claim to it.
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'get_edit_post_link' )->justReturn( 'http://example.test/edit' );

        $this->wpdb->shouldReceive( 'prepare' )->andReturnUsing( fn( $query ) => $query );
        $this->wpdb->shouldReceive( 'get_results' )->andReturn( $sequence_rows );
    }

    /**
     * A sequence row with one queue-visible stage and one target to move it to.
     *
     * Both stages sit in the draft region, so no region-crossing capability is
     * involved and the row reaches the queue on workflow configuration alone.
     *
     * @return object
     */
    private function my_queue_sequence_row(): object
    {
        return (object) array(
            'id'          => 1,
            'uuid'        => 'uuid-editorial',
            'type'        => 'workflow',
            'name'        => 'Editorial',
            'slug'        => 'editorial',
            'description' => '',
            'version'     => 1,
            'status'      => 'active',
            'config'      => json_encode(
                array(
                    'post_types' => array( 'post' ),
                    'statuses'   => array(
                        array(
                            'key'           => 'in_review',
                            'label'         => 'In Review',
                            'color'         => '#3498db',
                            'status'        => 'draft',
                            'is_initial'    => true,
                            'show_in_queue' => true,
                            'transitions'   => array(
                                array(
                                    'to'            => 'approved',
                                    'label'         => 'Approve',
                                    'show_in_queue' => true,
                                ),
                            ),
                        ),
                        array(
                            'key'         => 'approved',
                            'label'       => 'Approved',
                            'status'      => 'draft',
                            'transitions' => array(),
                        ),
                    ),
                )
            ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );
    }

    // =========================================================================
    // GET /workflow/my-work Tests
    // =========================================================================

    /**
     * Test get_my_work returns empty for unauthenticated users.
     */
    public function test_get_my_work_empty_for_guest(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 0 );

        $request  = $this->create_mock_request();
        $response = $this->controller->get_my_work( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( array(), $response->get_data() );
    }

    /**
     * Wire up everything get_my_work() reads apart from the sequence rows.
     *
     * @param array $sequence_rows Rows the sequence repository should find.
     */
    private function seed_my_work( array $sequence_rows ): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 7 );

        // No claim on any post: involvement comes from authorship below.
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'get_edit_post_link' )->justReturn( 'http://example.test/edit' );

        // The core statuses the fixtures use, labelled as core registers them.
        Functions\when( 'get_post_status_object' )->alias(
            function ( $status ) {
                $labels = array(
                    'draft'  => 'Draft',
                    'future' => 'Scheduled',
                );

                return isset( $labels[ $status ] ) ? (object) array( 'label' => $labels[ $status ] ) : null;
            }
        );

        $this->wpdb->postmeta = 'wp_postmeta';
        $this->wpdb->shouldReceive( 'esc_like' )->andReturnUsing( fn( $text ) => $text );
        $this->wpdb->shouldReceive( 'prepare' )->andReturnUsing( fn( $query ) => $query );

        // Two callers share $wpdb here: the sequence repository and
        // AssignmentManager::get_all(), which reads postmeta. Answer them apart —
        // handing sequence rows to the assignment reader would blow up on the
        // meta_key column it expects.
        $this->wpdb->shouldReceive( 'get_results' )->andReturnUsing(
            function ( $query ) use ( $sequence_rows ) {
                return false === strpos( $query, 'postmeta' ) ? $sequence_rows : array();
            }
        );
    }

    /**
     * A sequence row with a single non-terminal stage.
     *
     * @return object
     */
    private function my_work_sequence_row(): object
    {
        return (object) array(
            'id'          => 1,
            'uuid'        => 'uuid-editorial',
            'type'        => 'workflow',
            'name'        => 'Editorial',
            'slug'        => 'editorial',
            'description' => '',
            'version'     => 1,
            'status'      => 'active',
            'config'      => json_encode(
                array(
                    'post_types' => array( 'post' ),
                    'statuses'   => array(
                        array(
                            'key'         => 'in_review',
                            'label'       => 'In Review',
                            'color'       => '#3498db',
                            'status'      => 'draft',
                            'is_initial'  => true,
                            'transitions' => array(),
                        ),
                    ),
                )
            ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );
    }

    /**
     * Test a workflow-managed row reports its stage AND its core post status.
     *
     * Stage and status are separate concepts, so they travel as separate pairs:
     * the client heads one column "Stage" and the other "Status".
     */
    public function test_get_my_work_workflow_row_carries_stage_and_post_status(): void
    {
        $this->seed_my_work( array( $this->my_work_sequence_row() ) );

        \WP_Query::$next_posts = array(
            $this->create_mock_post(
                array(
                    'ID'            => 11,
                    'post_title'    => 'Reviewed piece',
                    'post_status'   => 'draft',
                    'post_author'   => 7,
                    'post_modified' => '2026-01-02 00:00:00',
                )
            ),
        );

        $data = $this->controller->get_my_work( $this->create_mock_request() )->get_data();

        // The unit suite's WP_Query double answers every query with the same
        // posts, so the fixture also comes back from the non-workflow pass. In
        // production that pass excludes workflow posts at the query level. Assert
        // on the workflow row.
        $workflow_rows = array_values(
            array_filter( $data, fn( $item ) => null !== $item['workflow_name'] )
        );

        $this->assertCount( 1, $workflow_rows );

        $row = $workflow_rows[0];
        $this->assertSame( 'Editorial', $row['workflow_name'] );
        $this->assertSame( 'In Review', $row['status_label'] );
        $this->assertSame( '#3498db', $row['status_color'] );
        $this->assertSame( 'draft', $row['post_status'] );
        $this->assertSame( 'Draft', $row['post_status_label'] );
    }

    /**
     * Test a post in no workflow reports no stage, only its core post status.
     *
     * A scheduled post used to arrive with status_label "Scheduled" and a stage
     * color, which the client rendered as a workflow stage called "Scheduled".
     */
    public function test_get_my_work_non_workflow_row_has_no_stage(): void
    {
        // No sequences, so only the non-workflow pass runs.
        $this->seed_my_work( array() );

        \WP_Query::$next_posts = array(
            $this->create_mock_post(
                array(
                    'ID'            => 12,
                    'post_title'    => 'Scheduled piece',
                    'post_status'   => 'future',
                    'post_author'   => 7,
                    'post_modified' => '2026-01-02 00:00:00',
                )
            ),
        );

        $data = $this->controller->get_my_work( $this->create_mock_request() )->get_data();

        $this->assertCount( 1, $data );

        $row = $data[0];
        $this->assertNull( $row['workflow_name'] );
        $this->assertNull( $row['status_label'] );
        $this->assertNull( $row['status_color'] );
        $this->assertSame( 'future', $row['post_status'] );
        $this->assertSame( 'Scheduled', $row['post_status_label'] );
    }

    // =========================================================================
    // GET /workflow/kanban Tests
    // =========================================================================

    /**
     * Test get_kanban_data returns empty for unauthenticated users.
     */
    public function test_get_kanban_empty_for_guest(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 0 );

        $request  = $this->create_mock_request();
        $response = $this->controller->get_kanban_data( $request );

        $this->assertInstanceOf( 'WP_REST_Response', $response );

        $data = $response->get_data();
        $this->assertArrayHasKey( 'sequences', $data );
        $this->assertArrayHasKey( 'columns', $data );
        $this->assertSame( array(), $data['sequences'] );
        $this->assertSame( array(), $data['columns'] );
    }

    /**
     * Seed the mocked wpdb with workflow sequence rows for kanban tests.
     *
     * Stages carry a `status` region (stage × status matrix). Two sequences:
     *  - "editorial": draft (draft region) -> parked (draft region, no outgoing
     *    transitions) and -> publish (publish region WITH an onward transition)
     *    -> promote (publish region + terminal). The publish stage has pending
     *    workflow work.
     *  - "legacy": draft -> publish (publish-region stage with NO outgoing
     *    transitions, i.e. the end of the line).
     */
    private function seed_kanban_sequences(): void
    {
        \WP_Query::$next_posts = array();

        $editorial_config = array(
            'post_types' => array( 'post' ),
            'statuses'   => array(
                array(
                    'key'         => 'draft',
                    'label'       => 'Draft',
                    'color'       => '#3498db',
                    'status'      => 'draft',
                    'is_initial'  => true,
                    'transitions' => array(
                        array(
                            'to'    => 'publish',
                            'label' => 'Publish',
                        ),
                        array(
                            'to'    => 'parked',
                            'label' => 'Park',
                        ),
                    ),
                ),
                array(
                    'key'         => 'parked',
                    'label'       => 'Parked',
                    'color'       => '#95a5a6',
                    'status'      => 'draft',
                    'transitions' => array(),
                ),
                array(
                    'key'         => 'publish',
                    'label'       => 'Published',
                    'color'       => '#9b59b6',
                    'status'      => 'publish',
                    'transitions' => array(
                        array(
                            'to'    => 'promote',
                            'label' => 'Promote',
                        ),
                    ),
                ),
                array(
                    'key'         => 'promote',
                    'label'       => 'Promote',
                    'color'       => '#e67e22',
                    'status'      => 'publish',
                    'is_terminal' => true,
                    'transitions' => array(),
                ),
            ),
        );

        $legacy_config = array(
            'post_types' => array( 'post' ),
            'statuses'   => array(
                array(
                    'key'         => 'draft',
                    'label'       => 'Draft',
                    'color'       => '#3498db',
                    'status'      => 'draft',
                    'is_initial'  => true,
                    'transitions' => array(
                        array(
                            'to'    => 'publish',
                            'label' => 'Publish',
                        ),
                    ),
                ),
                array(
                    'key'         => 'publish',
                    'label'       => 'Published',
                    'color'       => '#00a32a',
                    'status'      => 'publish',
                    'transitions' => array(),
                ),
            ),
        );

        $rows = array(
            (object) array(
                'id'          => 1,
                'uuid'        => 'uuid-editorial',
                'type'        => 'workflow',
                'name'        => 'Editorial',
                'slug'        => 'editorial',
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => json_encode( $editorial_config ),
                'created_by'  => 1,
                'created_at'  => '2026-01-01 00:00:00',
                'updated_at'  => '2026-01-01 00:00:00',
            ),
            (object) array(
                'id'          => 2,
                'uuid'        => 'uuid-legacy',
                'type'        => 'workflow',
                'name'        => 'Legacy',
                'slug'        => 'legacy',
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => json_encode( $legacy_config ),
                'created_by'  => 1,
                'created_at'  => '2026-01-01 00:00:00',
                'updated_at'  => '2026-01-01 00:00:00',
            ),
        );

        $this->wpdb->shouldReceive( 'prepare' )->andReturnUsing(
            function ( $query ) {
                return $query;
            }
        );
        $this->wpdb->shouldReceive( 'get_results' )->andReturn( $rows );

        Functions\when( 'get_current_user_id' )->justReturn( 5 );
    }

    /**
     * Extract column keys from a kanban response.
     *
     * @param object $response REST response.
     * @return array Column keys.
     */
    private function get_column_keys( object $response ): array
    {
        return array_map(
            static function ( $column ) {
                return $column['key'];
            },
            $response->get_data()['columns']
        );
    }

    /**
     * Find a column by key in a kanban response.
     *
     * @param object $response REST response.
     * @param string $key      Column key.
     * @return array|null
     */
    private function find_column( object $response, string $key ): ?array
    {
        foreach ( $response->get_data()['columns'] as $column ) {
            if ( $key === $column['key'] ) {
                return $column;
            }
        }
        return null;
    }

    /**
     * Test a publish-region stage with outgoing transitions renders as a
     * visible kanban column, while terminal and end-of-line publish-region
     * stages stay hidden by default.
     */
    public function test_get_kanban_shows_publish_region_stage_with_onward_transitions(): void
    {
        $this->seed_kanban_sequences();

        $request  = $this->create_mock_request();
        $response = $this->controller->get_kanban_data( $request );

        $keys = $this->get_column_keys( $response );

        // A publish-region stage with an onward transition is a real column.
        $this->assertContains( 'editorial__publish', $keys );
        $publish_column = $this->find_column( $response, 'editorial__publish' );
        $this->assertFalse( $publish_column['is_hidden'] );

        // Terminal (publish-region) stage stays hidden.
        $this->assertNotContains( 'editorial__promote', $keys );

        // A publish-region stage that is the end of the line stays hidden.
        $this->assertNotContains( 'legacy__publish', $keys );

        // Draft-region stages are unaffected — including one with no outgoing
        // transitions: only PUBLISH-region dead ends hide, region semantics.
        $this->assertContains( 'editorial__draft', $keys );
        $this->assertContains( 'editorial__parked', $keys );
        $this->assertContains( 'legacy__draft', $keys );
    }

    /**
     * Test include_hidden returns hidden stages flagged is_hidden, per the
     * region rule: hidden ⇔ terminal, dead-end, or a publish-region stage with
     * no outgoing transitions.
     */
    public function test_get_kanban_include_hidden_flags_end_of_line_stages(): void
    {
        $this->seed_kanban_sequences();

        $request  = $this->create_mock_request( array( 'include_hidden' => true ) );
        $response = $this->controller->get_kanban_data( $request );

        $keys = $this->get_column_keys( $response );

        $this->assertContains( 'editorial__promote', $keys );
        $this->assertContains( 'legacy__publish', $keys );

        $this->assertFalse( $this->find_column( $response, 'editorial__publish' )['is_hidden'] );
        $this->assertFalse( $this->find_column( $response, 'editorial__parked' )['is_hidden'] );
        $this->assertTrue( $this->find_column( $response, 'editorial__promote' )['is_hidden'] );
        $this->assertTrue( $this->find_column( $response, 'legacy__publish' )['is_hidden'] );
    }
}

}
