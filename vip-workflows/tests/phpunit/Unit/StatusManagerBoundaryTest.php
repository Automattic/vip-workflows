<?php
/**
 * StatusManager boundary-predicate unit tests.
 *
 * Covers the shared region map and the two side-effect predicates the workflow
 * side-effect guard is built on — status_to_region(), crosses_publish_boundary(),
 * would_reseat() — plus remove_sequence(), the audited escape hatch that takes a
 * post out of its workflow without touching post_status.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\PostTypeManager;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Tests for StatusManager's region map, boundary predicates, and removal.
 */
class StatusManagerBoundaryTest extends TestCase
{
    /**
     * Sequence repository mock.
     *
     * @var SequenceRepository|Mockery\MockInterface
     */
    private $sequence_repository;

    /**
     * Post type manager mock.
     *
     * @var PostTypeManager|Mockery\MockInterface
     */
    private $post_type_manager;

    /**
     * Status manager under test.
     *
     * @var StatusManager
     */
    private StatusManager $status_manager;

    /**
     * Sample sequence spanning the draft, pending, and publish regions.
     *
     * @var Sequence
     */
    private Sequence $sequence;

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->sequence_repository = Mockery::mock( SequenceRepository::class );
        $this->post_type_manager    = Mockery::mock( PostTypeManager::class );

        $this->status_manager = new StatusManager(
            $this->sequence_repository,
            $this->post_type_manager
        );

        $this->sequence = $this->create_test_sequence();
    }

    // =========================================================================
    // Fixtures
    // =========================================================================

    /**
     * Sequence spanning the draft, pending, and publish regions.
     *
     * draft(draft*) -> review(draft) -> approval(pending*) -> published(publish*) -> promote(publish).
     * Asterisks mark region entry stages.
     *
     * @return Sequence
     */
    private function create_test_sequence(): Sequence
    {
        $config = array(
            'statuses' => array(
                array(
                    'key'          => 'draft',
                    'label'        => 'Draft',
                    'status'       => 'draft',
                    'region_entry' => true,
                    'transitions'  => array( array( 'to' => 'review' ) ),
                ),
                array(
                    'key'         => 'review',
                    'label'       => 'In Review',
                    'status'      => 'draft',
                    'transitions' => array( array( 'to' => 'approval' ), array( 'to' => 'published' ) ),
                ),
                array(
                    'key'          => 'approval',
                    'label'        => 'Approval',
                    'status'       => 'pending',
                    'region_entry' => true,
                    'transitions'  => array( array( 'to' => 'published' ) ),
                ),
                array(
                    'key'          => 'published',
                    'label'        => 'Published',
                    'status'       => 'publish',
                    'region_entry' => true,
                    'transitions'  => array( array( 'to' => 'promote' ) ),
                ),
                array(
                    'key'         => 'promote',
                    'label'       => 'Promote',
                    'status'      => 'publish',
                    'is_terminal' => true,
                    'transitions' => array(),
                ),
            ),
        );

        return $this->sequence_from_config( $config, 1, 'test-workflow', 'Test Workflow' );
    }

    /**
     * Sequence modelling only the draft and publish regions.
     *
     * @return Sequence
     */
    private function create_no_pending_sequence(): Sequence
    {
        $config = array(
            'statuses' => array(
                array(
                    'key'          => 'writing',
                    'label'        => 'Writing',
                    'status'       => 'draft',
                    'region_entry' => true,
                    'transitions'  => array( array( 'to' => 'live' ) ),
                ),
                array(
                    'key'          => 'live',
                    'label'        => 'Live',
                    'status'       => 'publish',
                    'region_entry' => true,
                    'is_terminal'  => true,
                    'transitions'  => array(),
                ),
            ),
        );

        return $this->sequence_from_config( $config, 2, 'no-pending', 'No Pending' );
    }

    /**
     * Sequence whose stage carries no `status` region — the data-integrity
     * condition Sequence::get_stage_status() throws on.
     *
     * @return Sequence
     */
    private function create_regionless_sequence(): Sequence
    {
        $config = array(
            'statuses' => array(
                array(
                    'key'         => 'orphan',
                    'label'       => 'Orphan',
                    'transitions' => array(),
                ),
            ),
        );

        return $this->sequence_from_config( $config, 3, 'regionless', 'Regionless' );
    }

    /**
     * Build a Sequence entity from a config array.
     *
     * @param array  $config Sequence config.
     * @param int    $id     Sequence ID.
     * @param string $slug   Slug.
     * @param string $name   Name.
     * @return Sequence
     */
    private function sequence_from_config( array $config, int $id, string $slug, string $name ): Sequence
    {
        $row = (object) array(
            'id'          => $id,
            'uuid'        => 'test-uuid-' . $id,
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => $name,
            'slug'        => $slug,
            'description' => '',
            'version'     => 1,
            'status'      => 'active',
            'config'      => json_encode( $config ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        return Sequence::from_row( $row );
    }

    // =========================================================================
    // Stub helpers
    // =========================================================================

    /**
     * Stub get_post_meta with a key => value map (missing keys return '').
     *
     * @param array $map Meta map.
     */
    private function stub_meta( array $map ): void
    {
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key = '', $single = false ) use ( $map ) {
                return $map[ $key ] ?? '';
            }
        );
    }

    /**
     * Seat a post in a workflow: a post double, sequence meta, stage meta, and
     * a repository that resolves the sequence.
     *
     * The committed status defaults to `draft` — a status with no publish-side
     * pull, so it leaves the stage's region as the sole input and these cases
     * keep testing what they were written to test. Pass it explicitly to cover a
     * post whose committed status and stage region DISAGREE.
     *
     * @param string         $stage       Current stage meta.
     * @param Sequence|null $sequence   Sequence the repository returns (default: the main fixture).
     * @param string         $post_status Committed post_status.
     */
    private function stub_workflow_post( string $stage, ?Sequence $sequence = null, string $post_status = 'draft' ): void
    {
        $sequence = $sequence ?? $this->sequence;

        Functions\when( 'get_post' )->justReturn( $this->create_mock_post( array( 'ID' => 1 ) ) );
        Functions\when( 'get_post_status' )->justReturn( $post_status );
        $this->stub_meta(
            array(
                StatusManager::SEQUENCE_META_KEY => (string) $sequence->id,
                StatusManager::STAGE_META_KEY     => $stage,
            )
        );
        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( $sequence->id )
            ->andReturn( $sequence );
    }

    /**
     * Stub a post that exists but carries no workflow meta.
     */
    private function stub_unmanaged_post(): void
    {
        Functions\when( 'get_post' )->justReturn( $this->create_mock_post( array( 'ID' => 1 ) ) );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );
        $this->stub_meta( array() );
    }

    /**
     * Mock the global $wpdb, capturing audit-log inserts.
     *
     * @param array $inserts Capture target (by reference); each entry is the inserted row.
     */
    private function mock_wpdb( array &$inserts ): void
    {
        global $wpdb;
        $wpdb         = Mockery::mock( 'wpdb' );
        $wpdb->prefix = 'wp_';
        $wpdb->shouldReceive( 'insert' )->andReturnUsing(
            function ( $table, $data ) use ( &$inserts ) {
                $inserts[] = $data;
                return true;
            }
        );
        $wpdb->insert_id = 1;
    }

    // =========================================================================
    // status_to_region() — the shared region map
    // =========================================================================

    /**
     * `future` is publish-side for boundary math: scheduling is "publish, delayed".
     */
    public function test_status_to_region_maps_future_to_publish(): void
    {
        $this->assertSame( 'publish', $this->status_manager->status_to_region( 'future' ) );
    }

    /**
     * `auto-draft` is core's embryo of a draft.
     */
    public function test_status_to_region_maps_auto_draft_to_draft(): void
    {
        $this->assertSame( 'draft', $this->status_manager->status_to_region( 'auto-draft' ) );
    }

    /**
     * Every other status maps to itself.
     *
     * @dataProvider identity_status_provider
     *
     * @param string $status Status that is its own region.
     */
    public function test_status_to_region_is_identity_elsewhere( string $status ): void
    {
        $this->assertSame( $status, $this->status_manager->status_to_region( $status ) );
    }

    /**
     * Statuses whose region is themselves.
     *
     * @return array<string, array{0: string}>
     */
    public static function identity_status_provider(): array
    {
        return array(
            'draft'   => array( 'draft' ),
            'pending' => array( 'pending' ),
            'private' => array( 'private' ),
            'publish' => array( 'publish' ),
            'trash'   => array( 'trash' ),
        );
    }

    // =========================================================================
    // crosses_publish_boundary()
    // =========================================================================

    /**
     * Into publish: a draft-region stage moving to `publish` crosses.
     */
    public function test_crosses_publish_boundary_into_publish(): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'publish' ) );
    }

    /**
     * Out of publish: the boundary is symmetric — unpublishing crosses too.
     */
    public function test_crosses_publish_boundary_out_of_publish(): void
    {
        $this->stub_workflow_post( 'promote' );

        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'draft' ) );
    }

    /**
     * Scheduling a non-publish-region post is an into-publish crossing:
     * `future` maps to the publish region.
     */
    public function test_crosses_publish_boundary_scheduling_counts_as_publish(): void
    {
        $this->stub_workflow_post( 'approval' );

        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'future' ) );
    }

    /**
     * Re-scheduling a post already seated in the publish region is same-region
     * and crosses nothing.
     */
    public function test_crosses_publish_boundary_rescheduling_published_post_is_silent(): void
    {
        $this->stub_workflow_post( 'published' );

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, 'future' ) );
    }

    /**
     * `auto-draft` maps to the draft region: a draft-region stage crosses nothing.
     */
    public function test_crosses_publish_boundary_auto_draft_is_draft_region(): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, 'auto-draft' ) );
    }

    /**
     * A region cross that does not touch publish (draft -> pending) is not a
     * publish crossing.
     */
    public function test_crosses_publish_boundary_non_publish_cross_is_false(): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, 'pending' ) );
    }

    /**
     * Same region, no cross.
     */
    public function test_crosses_publish_boundary_same_region_is_false(): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, 'draft' ) );
    }

    /**
     * The current side comes from the STAGE, not post_status: a post core has
     * already published but whose stage still sits in the draft region is
     * evaluated from the stage.
     */
    public function test_crosses_publish_boundary_takes_whichever_side_is_publish(): void
    {
        // A LIVE post whose stage is draft-region. The two normally agree; they
        // come apart when the reseat had nowhere to go — a sequence that models
        // no publish-region stage leaves the stage alone when core publishes the
        // post.
        $this->stub_workflow_post( 'review', null, 'publish' );

        // Reading the boundary from the STAGE alone answered "draft to draft, no
        // crossing" here, so a non-bypass user could UNPUBLISH a live post with
        // no veto — the exact act the boundary is symmetric in order to prevent.
        // The committed status pulls the current side to publish.
        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'draft' ) );

        // And the post is already publish-side, so re-publishing crosses nothing.
        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, 'publish' ) );
    }

    /**
     * The same rule covers the sibling case: a live post being future-dated.
     * Both sides are publish-side, so scheduling an already-live post is silent
     * rather than a way to take it down unremarked.
     */
    public function test_crosses_publish_boundary_future_dating_a_live_post_is_not_a_crossing(): void
    {
        $this->stub_workflow_post( 'review', null, 'publish' );

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, 'future' ) );
    }

    /**
     * The stage still decides when the committed status has no publish-side
     * pull — the change is strictly a narrowing, not a replacement.
     */
    public function test_crosses_publish_boundary_still_reads_the_stage_when_the_post_is_not_live(): void
    {
        // Stage is publish-region while core holds the post at `draft`: the stage
        // is what makes moving to `draft` a crossing.
        $this->stub_workflow_post( 'promote', null, 'draft' );

        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'draft' ) );
    }

    /**
     * Trashing is an overlay in BOTH directions: it suspends the workflow in
     * place and is explicitly unaffected by the publish boundary. A live
     * workflow post moving to `trash` is not an out-of-publish crossing.
     *
     * @dataProvider overlay_target_status_provider
     *
     * @param string $target_status Status that never crosses the boundary.
     */
    public function test_crosses_publish_boundary_false_from_publish_region( string $target_status ): void
    {
        $this->stub_workflow_post( 'promote' );

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, $target_status ) );
    }

    /**
     * The same overlays from the draft side.
     *
     * @dataProvider overlay_target_status_provider
     *
     * @param string $target_status Status that never crosses the boundary.
     */
    public function test_crosses_publish_boundary_false_from_draft_region( string $target_status ): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, $target_status ) );
    }

    /**
     * Targets that are not editorial regions at all: `trash` suspends the
     * workflow in place, `inherit` is core-internal (revisions, attachments).
     *
     * @return array<string, array{0: string}>
     */
    public static function overlay_target_status_provider(): array
    {
        return array(
            'trash'   => array( 'trash' ),
            'inherit' => array( 'inherit' ),
        );
    }

    /**
     * A post with no sequence is not workflow-managed and crosses nothing.
     */
    public function test_crosses_publish_boundary_no_sequence_is_false(): void
    {
        $this->stub_unmanaged_post();

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, 'publish' ) );
    }

    /**
     * Stage meta naming an undefined stage is a data-integrity condition on a
     * post that IS workflow-managed. The predicate is the sole authority for
     * the publish veto, so it fails closed rather than waving the crossing
     * through unrecorded.
     */
    public function test_crosses_publish_boundary_dangling_stage_fails_closed(): void
    {
        $this->stub_workflow_post( 'ghost' );

        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'publish' ) );
    }

    /**
     * Missing stage meta on a managed post fails closed for the same reason.
     */
    public function test_crosses_publish_boundary_missing_stage_meta_fails_closed(): void
    {
        $this->stub_workflow_post( '' );

        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'publish' ) );
    }

    /**
     * A stage config with no `status` region (written around the write gate)
     * fails closed too — get_stage_status() throws and the predicate refuses to
     * guess a side.
     */
    public function test_crosses_publish_boundary_regionless_stage_fails_closed(): void
    {
        $this->stub_workflow_post( 'orphan', $this->create_regionless_sequence() );

        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'publish' ) );
    }

    /**
     * The overlay carve-out runs BEFORE the fail-closed branch: trashing a post
     * whose workflow meta is corrupt is still silent.
     */
    public function test_crosses_publish_boundary_trash_is_silent_on_corrupt_meta(): void
    {
        $this->stub_workflow_post( 'ghost' );

        $this->assertFalse( $this->status_manager->crosses_publish_boundary( 1, 'trash' ) );
    }

    // =========================================================================
    // would_reseat()
    // =========================================================================

    /**
     * A region cross the sequence models moves the stage.
     */
    public function test_would_reseat_on_region_cross(): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertTrue( $this->status_manager->would_reseat( 1, 'publish' ) );
        $this->assertTrue( $this->status_manager->would_reseat( 1, 'pending' ) );
    }

    /**
     * Out of publish reseats too (the reconcile layer is direction-agnostic).
     */
    public function test_would_reseat_out_of_publish(): void
    {
        $this->stub_workflow_post( 'promote' );

        $this->assertTrue( $this->status_manager->would_reseat( 1, 'draft' ) );
    }

    /**
     * Overlay statuses never move the stage — `future` here is an overlay, the
     * opposite of its publish-side mapping in crosses_publish_boundary().
     */
    public function test_would_reseat_false_for_overlays(): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertFalse( $this->status_manager->would_reseat( 1, 'future' ) );
        $this->assertFalse( $this->status_manager->would_reseat( 1, 'trash' ) );
    }

    /**
     * The same target that crosses the publish boundary as a scheduling move is
     * an overlay for the reseat: the two mappings are deliberately different.
     */
    public function test_future_crosses_the_boundary_but_never_reseats(): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertTrue( $this->status_manager->crosses_publish_boundary( 1, 'future' ) );
        $this->assertFalse( $this->status_manager->would_reseat( 1, 'future' ) );
    }

    /**
     * Core-internal statuses are never matrix members.
     */
    public function test_would_reseat_false_for_core_internal_statuses(): void
    {
        $this->stub_workflow_post( 'review' );

        $this->assertFalse( $this->status_manager->would_reseat( 1, 'auto-draft' ) );
        $this->assertFalse( $this->status_manager->would_reseat( 1, 'inherit' ) );
    }

    /**
     * A target region the stage already lives in moves nothing.
     */
    public function test_would_reseat_false_when_already_in_target_region(): void
    {
        $this->stub_workflow_post( 'promote' );

        $this->assertFalse( $this->status_manager->would_reseat( 1, 'publish' ) );
    }

    /**
     * A region the sequence does not model has no entry stage: tolerated, the
     * stage stays.
     */
    public function test_would_reseat_false_for_unmodelled_region(): void
    {
        $this->stub_workflow_post( 'writing', $this->create_no_pending_sequence() );

        $this->assertFalse( $this->status_manager->would_reseat( 1, 'pending' ) );
    }

    /**
     * A post with no sequence has no stage to move.
     */
    public function test_would_reseat_false_without_sequence(): void
    {
        $this->stub_unmanaged_post();

        $this->assertFalse( $this->status_manager->would_reseat( 1, 'publish' ) );
    }

    /**
     * would_reseat() and on_status_transition() answer from the same decision:
     * every case the predicate calls true actually reseats.
     */
    public function test_would_reseat_agrees_with_the_reconcile_layer(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'publish',
            )
        );
        $this->stub_workflow_post( 'review' );
        Functions\when( 'get_post' )->justReturn( $post );
        Functions\when( 'get_post_status' )->justReturn( 'publish' );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Test' ) );

        $inserts = array();
        $this->mock_wpdb( $inserts );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );

        $this->assertTrue( $this->status_manager->would_reseat( 1, 'publish' ) );

        $this->status_manager->on_status_transition( 'publish', 'draft', $post );

        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'published' ), $meta_writes );
    }

    // =========================================================================
    // remove_sequence() — the escape hatch
    // =========================================================================

    /**
     * Removal deletes both meta keys and writes no post_status.
     */
    public function test_remove_sequence_deletes_meta_and_writes_no_status(): void
    {
        $this->stub_workflow_post( 'approval' );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );

        $inserts = array();
        $this->mock_wpdb( $inserts );

        $deletes = array();
        Functions\when( 'delete_post_meta' )->alias(
            function ( $post_id, $key ) use ( &$deletes ) {
                $deletes[] = $key;
                return true;
            }
        );

        Functions\expect( 'wp_update_post' )->never();
        Functions\expect( 'wp_insert_post' )->never();

        $result = $this->status_manager->remove_sequence( 1 );

        $this->assertTrue( $result );
        $this->assertContains( StatusManager::SEQUENCE_META_KEY, $deletes );
        $this->assertContains( StatusManager::STAGE_META_KEY, $deletes );
    }

    /**
     * Removal is audited as `workflow.removed`, recording the sequence it left
     * and the stage it was removed from.
     */
    public function test_remove_sequence_logs_the_audit_event(): void
    {
        $this->stub_workflow_post( 'approval' );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'delete_post_meta' )->justReturn( true );

        $inserts = array();
        $this->mock_wpdb( $inserts );

        $this->status_manager->remove_sequence( 1 );

        $this->assertCount( 1, $inserts );
        $this->assertSame( 'workflow.removed', $inserts[0]['event_type'] );
        $this->assertSame( 1, $inserts[0]['post_id'] );
        $this->assertSame( 5, $inserts[0]['actor_id'] );

        $data = json_decode( $inserts[0]['event_data'], true );
        $this->assertSame( 1, $data['sequence_id'] );
        $this->assertSame( 'Test Workflow', $data['sequence_name'] );
        $this->assertSame( 'approval', $data['removed_stage'] );
        $this->assertSame( 'workflow', $data['cause'] );
    }

    /**
     * Removing a post that is not in a workflow is a caller error, not a
     * silent success.
     */
    public function test_remove_sequence_without_sequence_is_an_error(): void
    {
        $this->stub_unmanaged_post();

        Functions\expect( 'delete_post_meta' )->never();

        $result = $this->status_manager->remove_sequence( 1 );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'no_sequence', $result->get_error_code() );
    }

    /**
     * A post that does not exist cannot be removed from a workflow.
     */
    public function test_remove_sequence_invalid_post_is_an_error(): void
    {
        Functions\when( 'get_post' )->justReturn( null );

        Functions\expect( 'delete_post_meta' )->never();

        $result = $this->status_manager->remove_sequence( 999 );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'invalid_post', $result->get_error_code() );
    }

    /**
     * A sequence id naming a sequence that no longer exists still removes:
     * refusing would strand the post in a workflow it can never escape.
     */
    public function test_remove_sequence_removes_a_dangling_reference(): void
    {
        Functions\when( 'get_post' )->justReturn( $this->create_mock_post( array( 'ID' => 1 ) ) );
        $this->stub_meta(
            array(
                StatusManager::SEQUENCE_META_KEY => '404',
                StatusManager::STAGE_META_KEY     => 'approval',
            )
        );
        $this->sequence_repository->shouldReceive( 'find' )->with( 404 )->andReturn( null );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );

        $deletes = array();
        Functions\when( 'delete_post_meta' )->alias(
            function ( $post_id, $key ) use ( &$deletes ) {
                $deletes[] = $key;
                return true;
            }
        );

        $inserts = array();
        $this->mock_wpdb( $inserts );

        $result = $this->status_manager->remove_sequence( 1 );

        $this->assertTrue( $result );
        $this->assertContains( StatusManager::SEQUENCE_META_KEY, $deletes );
        $this->assertContains( StatusManager::STAGE_META_KEY, $deletes );

        $data = json_decode( $inserts[0]['event_data'], true );
        $this->assertSame( 404, $data['sequence_id'] );
        $this->assertSame( '', $data['sequence_name'] );
    }
}
