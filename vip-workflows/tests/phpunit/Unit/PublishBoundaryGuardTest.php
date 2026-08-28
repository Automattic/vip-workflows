<?php
/**
 * PublishBoundaryGuard unit tests.
 *
 * Covers the save-layer veto: a non-bypass user's post_status change into or
 * out of the publish region on a workflow-managed post is refused, while bypass
 * users, non-publish region crosses, and every system context pass through
 * untouched.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use ReflectionProperty;
use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\PostTypeManager;
use VIPWorkflow\Workflow\PublishBoundaryGuard;
use VIPWorkflow\Workflow\StatusManager;

/**
 * Tests for the publish-boundary save-layer veto.
 */
class PublishBoundaryGuardTest extends TestCase
{
    /**
     * Post ID used throughout.
     */
    private const POST_ID = 42;

    /**
     * Sequence repository mock.
     *
     * @var SequenceRepository|Mockery\MockInterface
     */
    private $sequence_repository;

    /**
     * Status manager (real, so the boundary predicate is the shipped one).
     *
     * @var StatusManager
     */
    private StatusManager $status_manager;

    /**
     * Guard under test.
     *
     * @var PublishBoundaryGuard
     */
    private PublishBoundaryGuard $guard;

    /**
     * Sequence spanning the draft, pending, and publish regions.
     *
     * @var Sequence
     */
    private Sequence $sequence;

    /**
     * Transients written during the test, keyed by transient name.
     *
     * @var array<string, mixed>
     */
    private array $transients = array();

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->sequence_repository = Mockery::mock( SequenceRepository::class );

        $this->status_manager = new StatusManager(
            $this->sequence_repository,
            Mockery::mock( PostTypeManager::class )
        );

        $this->guard     = new PublishBoundaryGuard( $this->status_manager );
        $this->sequence = $this->create_test_sequence();

        $this->stub_environment();
    }

    /**
     * Clear the request-scoped transition guard between tests (it is static).
     */
    protected function tearDown(): void
    {
        $property = new ReflectionProperty( StatusManager::class, 'transition_in_progress' );
        $property->setValue( null, array() );

        parent::tearDown();
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
                    'transitions' => array( array( 'to' => 'approval' ) ),
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

        $row = (object) array(
            'id'          => 1,
            'uuid'        => 'test-uuid-1',
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => 'Test Workflow',
            'slug'        => 'test-workflow',
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
     * Stub the ambient WordPress surface the guard touches: a non-bypass editor,
     * no system context, and a transient store backed by an array.
     */
    private function stub_environment(): void
    {
        Functions\when( 'wp_doing_cron' )->justReturn( false );
        Functions\when( 'wp_is_post_autosave' )->justReturn( false );
        Functions\when( 'wp_is_post_revision' )->justReturn( false );

        Functions\when( 'set_transient' )->alias(
            function ( $key, $value ) {
                $this->transients[ $key ] = $value;
                return true;
            }
        );
        Functions\when( 'get_transient' )->alias(
            function ( $key ) {
                return $this->transients[ $key ] ?? false;
            }
        );
        Functions\when( 'delete_transient' )->alias(
            function ( $key ) {
                unset( $this->transients[ $key ] );
                return true;
            }
        );

        $this->stub_current_user_roles( array( 'editor' ) );
    }

    /**
     * Stub the current user with the given roles. Settings defaults the bypass
     * role list to ['administrator'], so 'editor' is a non-bypass user.
     *
     * @param string[] $roles Role slugs.
     */
    private function stub_current_user_roles( array $roles ): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'roles' => $roles ) );
        Functions\when( 'get_option' )->justReturn( array() );
    }

    /**
     * Seat the post in the workflow at a stage, with a committed post_status.
     *
     * @param string $stage       Current stage key.
     * @param string $post_status Committed post_status.
     */
    private function stub_workflow_post( string $stage, string $post_status ): void
    {
        Functions\when( 'get_post' )->justReturn(
            $this->create_mock_post(
                array(
                    'ID'          => self::POST_ID,
                    'post_title'  => 'Test Post',
                    'post_status' => $post_status,
                )
            )
        );

        // The committed status is an INPUT to the boundary predicate, not just to
        // the "is this a genuine change" check: a post core has published is on
        // the publish side whatever its stage says, which is what stops a live
        // post at a draft-region stage being silently unpublishable.
        Functions\when( 'get_post_status' )->justReturn( $post_status );

        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key = '', $single = false ) use ( $stage ) {
                if ( StatusManager::SEQUENCE_META_KEY === $key ) {
                    return '1';
                }
                if ( StatusManager::STAGE_META_KEY === $key ) {
                    return $stage;
                }
                return '';
            }
        );

        $this->sequence_repository->shouldReceive( 'find' )->with( 1 )->andReturn( $this->sequence );
    }

    /**
     * Stub a post that exists but carries no workflow meta.
     *
     * @param string $post_status Committed post_status.
     */
    private function stub_unmanaged_post( string $post_status = 'draft' ): void
    {
        Functions\when( 'get_post' )->justReturn(
            $this->create_mock_post(
                array(
                    'ID'          => self::POST_ID,
                    'post_status' => $post_status,
                )
            )
        );
        Functions\when( 'get_post_status' )->justReturn( $post_status );
        Functions\when( 'get_post_meta' )->justReturn( '' );
    }

    /**
     * Run the universal backstop filter for a status change on the fixture post.
     *
     * @param  string $target_status Status the write would set.
     * @return array Filtered post data.
     */
    private function filter_data( string $target_status ): array
    {
        return $this->guard->veto_post_data(
            array(
                'post_status' => $target_status,
                'post_type'   => 'post',
            ),
            array( 'ID' => self::POST_ID )
        );
    }

    /**
     * Run the REST filter for a status change on the fixture post.
     *
     * @param  string $target_status Status the write would set.
     * @return \stdClass|\WP_Error
     */
    private function filter_rest( string $target_status )
    {
        $prepared = (object) array(
            'ID'          => self::POST_ID,
            'post_status' => $target_status,
        );

        return $this->guard->veto_rest_insert( $prepared, null );
    }

    // =========================================================================
    // The veto fires
    // =========================================================================

    /**
     * Into publish: a non-bypass user's draft-region post cannot be published
     * directly; the write lands with the stored status instead.
     */
    public function test_vetoes_publish_for_non_bypass_user(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'draft', $data['post_status'] );
    }

    /**
     * Out of publish: the boundary is symmetric — unpublishing is vetoed too.
     */
    public function test_vetoes_unpublish_for_non_bypass_user(): void
    {
        $this->stub_workflow_post( 'promote', 'publish' );

        $data = $this->filter_data( 'draft' );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    /**
     * Scheduling is a delayed publish: `future` is publish-side for the veto, so
     * a non-bypass user cannot schedule a workflow post out of a non-publish
     * region (and let the exempt cron publish it for them).
     */
    public function test_vetoes_scheduling_out_of_a_non_publish_region(): void
    {
        $this->stub_workflow_post( 'approval', 'pending' );

        $data = $this->filter_data( 'future' );

        $this->assertSame( 'pending', $data['post_status'] );
    }

    /**
     * The veto queues the classic-path notice, naming the post, the workflow,
     * and both ways through.
     */
    public function test_veto_queues_an_admin_notice_with_the_escape_copy(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );

        $this->filter_data( 'publish' );

        $this->assertCount( 1, $this->transients );

        $message = (string) reset( $this->transients );
        $this->assertStringContainsString( "'Test Post'", $message );
        $this->assertStringContainsString( "'Test Workflow'", $message );
        $this->assertStringContainsString( 'remove it from the workflow (this is logged)', $message );
        $this->assertStringContainsString( 'move it through the workflow to a published stage', $message );
    }

    /**
     * The queued notice renders once on the next admin page load for that post.
     */
    public function test_queued_notice_renders_and_is_consumed(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );
        $this->filter_data( 'publish' );

        $this->expectOutputRegex( '/notice notice-error.*Test Workflow/s' );

        $this->guard->render_veto_notice();

        // Consumed: a second render emits nothing (the regex above would fail if
        // the notice were printed twice).
        $this->guard->render_veto_notice();
        $this->assertSame( array(), $this->transients );
    }

    // =========================================================================
    // The veto does not fire
    // =========================================================================

    /**
     * A bypass user (default: administrator) is warned on the client, never
     * vetoed on the server.
     */
    public function test_does_not_veto_a_bypass_user(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );
        $this->stub_current_user_roles( array( 'administrator' ) );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
        $this->assertSame( array(), $this->transients );
    }

    /**
     * A region cross that does not touch publish (draft -> pending) stays on
     * warn/reseat for everyone.
     */
    public function test_does_not_veto_a_non_publish_region_cross(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );

        $data = $this->filter_data( 'pending' );

        $this->assertSame( 'pending', $data['post_status'] );
    }

    /**
     * Trash is an overlay: it suspends the workflow in place and is explicitly
     * unaffected by the publish boundary.
     */
    public function test_does_not_veto_trashing_a_published_workflow_post(): void
    {
        $this->stub_workflow_post( 'promote', 'publish' );

        $data = $this->filter_data( 'trash' );

        $this->assertSame( 'trash', $data['post_status'] );
    }

    /**
     * Coming back OUT of the Trash is not a crossing either. The stage still
     * records the region the post was working in when it was trashed, so reading
     * it as the current side of the boundary would make every restore of a
     * published workflow post an out-of-publish crossing — and wp_untrash_post()
     * reads the truthy return of the reverted write as success, leaving the post
     * trashed, stripped of its trash bookkeeping meta, and reported as restored.
     */
    public function test_does_not_veto_restoring_a_post_from_the_trash(): void
    {
        // Trashed while seated in the publish region — exactly what core's
        // Restore (and the block editor's, which writes status=draft over REST)
        // asks for next.
        $this->stub_workflow_post( 'promote', 'trash' );

        $data = $this->filter_data( 'draft' );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( array(), $this->transients );
    }

    /**
     * The block editor and the posts DataView restore by writing status=draft
     * over REST rather than calling wp_untrash_post(), so the REST surface must
     * pass a restore through as well.
     */
    public function test_rest_insert_passes_a_restore_from_the_trash_through(): void
    {
        $this->stub_workflow_post( 'promote', 'trash' );

        $result = $this->filter_rest( 'draft' );

        $this->assertNotInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'draft', $result->post_status );
    }

    /**
     * A post that was already published when it was trashed is seated in the
     * publish region, so restoring it to `publish` compares publish to publish
     * and crosses nothing.
     */
    public function test_does_not_veto_restoring_a_published_post_to_publish(): void
    {
        $this->stub_workflow_post( 'promote', 'trash' );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
        $this->assertSame( array(), $this->transients );
    }

    /**
     * The Trash must not be a laundry for the publish veto. A post seated in the
     * draft region could otherwise be trashed and then written straight to
     * `publish` — every surface that restores does so by writing a status over
     * REST — and land live without ever meeting the boundary.
     */
    public function test_vetoes_publishing_straight_out_of_the_trash(): void
    {
        $this->stub_workflow_post( 'draft', 'trash' );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'trash', $data['post_status'] );
        $this->assertNotSame( array(), $this->transients );
    }

    /**
     * `future` -> `publish` is core's own coercion of a due scheduled post, not
     * a user's crossing: wp_insert_post() rewrites the status before the filter
     * runs, so an ordinary save of a due post would otherwise be vetoed and
     * reverted to `future` on every attempt.
     */
    public function test_does_not_veto_core_publishing_a_due_scheduled_post(): void
    {
        $this->stub_workflow_post( 'draft', 'future' );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
        $this->assertSame( array(), $this->transients );
    }

    /**
     * Reverting the status alone is not enough: wp_insert_post() derives the
     * slug and the GMT date from the status BEFORE this filter runs, so a
     * refused publish would otherwise leave a draft carrying a public slug and a
     * future date that a later legitimate publish silently coerces back to
     * `future`.
     */
    public function test_veto_reverts_the_slug_and_dates_core_shaped_for_the_refused_status(): void
    {
        $this->stub_workflow_post( 'draft', 'draft' );

        $data = $this->guard->veto_post_data(
            array(
                'post_status'   => 'future',
                'post_type'     => 'post',
                'post_name'     => 'a-freshly-generated-public-slug',
                'post_date'     => '2099-01-01 00:00:00',
                'post_date_gmt' => '2099-01-01 00:00:00',
            ),
            array( 'ID' => self::POST_ID )
        );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( 'test-post', $data['post_name'] );
        $this->assertSame( '2026-01-01 00:00:00', $data['post_date'] );
        $this->assertSame( '2026-01-01 00:00:00', $data['post_date_gmt'] );
    }

    /**
     * A save that does not change post_status is not a status change at all —
     * even on a post whose stage and status have drifted apart.
     */
    public function test_does_not_veto_a_save_that_keeps_the_same_status(): void
    {
        // Stage is draft-region, but core already committed `publish`.
        $this->stub_workflow_post( 'review', 'publish' );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    /**
     * A post with no sequence is not workflow-managed.
     */
    public function test_does_not_veto_an_unmanaged_post(): void
    {
        $this->stub_unmanaged_post();

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    /**
     * A brand-new post (no ID) carries no workflow yet.
     */
    public function test_does_not_veto_an_insert_with_no_post_id(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );

        $data = $this->guard->veto_post_data(
            array( 'post_status' => 'publish' ),
            array()
        );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    // =========================================================================
    // System contexts are exempt
    // =========================================================================

    /**
     * Cron is exempt — the exemption that matters most. `future` is publish-side
     * for the boundary predicate, so without this every scheduled post on the
     * site would be reverted to its old status instead of going live.
     */
    public function test_cron_publishing_a_scheduled_post_is_exempt(): void
    {
        $this->stub_workflow_post( 'review', 'future' );
        Functions\when( 'wp_doing_cron' )->justReturn( true );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
        $this->assertSame( array(), $this->transients );
    }

    /**
     * Cron is exempt in the other direction too: nothing about the boundary is
     * evaluated in a cron context.
     */
    public function test_cron_is_exempt_for_any_crossing(): void
    {
        $this->stub_workflow_post( 'promote', 'publish' );
        Functions\when( 'wp_doing_cron' )->justReturn( true );

        $data = $this->filter_data( 'draft' );

        $this->assertSame( 'draft', $data['post_status'] );
    }

    /**
     * Autosaves are core bookkeeping, not an editorial decision.
     */
    public function test_autosave_is_exempt(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );
        Functions\when( 'wp_is_post_autosave' )->justReturn( true );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    /**
     * Revisions carry their parent's content, never its workflow.
     */
    public function test_revision_is_exempt(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );
        Functions\when( 'wp_is_post_revision' )->justReturn( true );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    /**
     * A post whose post_type is `revision` is exempt even when the revision
     * helpers say nothing.
     */
    public function test_revision_post_type_is_exempt(): void
    {
        Functions\when( 'get_post' )->justReturn(
            $this->create_mock_post(
                array(
                    'ID'          => self::POST_ID,
                    'post_type'   => 'revision',
                    'post_status' => 'draft',
                )
            )
        );
        Functions\when( 'get_post_meta' )->justReturn( '' );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    /**
     * A plugin-driven workflow commit is the workflow moving the post itself —
     * StatusManager's own crossing write must not be vetoed by the guard.
     */
    public function test_in_flight_workflow_commit_is_exempt(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );

        $property = new ReflectionProperty( StatusManager::class, 'transition_in_progress' );
        $property->setValue( null, array( self::POST_ID => true ) );

        $this->assertTrue( StatusManager::is_transition_in_progress( self::POST_ID ) );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    /**
     * A userless write (WP-CLI, seeder, importer) is a trusted system actor: the
     * veto describes a person's role, and there is no person here.
     */
    public function test_userless_context_is_exempt(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );
        Functions\when( 'get_current_user_id' )->justReturn( 0 );

        $data = $this->filter_data( 'publish' );

        $this->assertSame( 'publish', $data['post_status'] );
    }

    // =========================================================================
    // REST surface
    // =========================================================================

    /**
     * REST writes get a real error (the block editor saves this way), not a
     * silent revert.
     */
    public function test_rest_insert_returns_an_error_on_a_vetoed_crossing(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );

        $result = $this->filter_rest( 'publish' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'vip_workflow_publish_boundary', $result->get_error_code() );
        $this->assertStringContainsString( "'Test Workflow'", $result->get_error_message() );
        $this->assertSame( 409, $result->get_error_data()['status'] );
    }

    /**
     * Out of publish over REST is refused too.
     */
    public function test_rest_insert_returns_an_error_on_unpublish(): void
    {
        $this->stub_workflow_post( 'promote', 'publish' );

        $result = $this->filter_rest( 'draft' );

        $this->assertInstanceOf( \WP_Error::class, $result );
    }

    /**
     * An allowed change passes the prepared post through untouched.
     */
    public function test_rest_insert_passes_allowed_changes_through(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );

        $result = $this->filter_rest( 'pending' );

        $this->assertIsObject( $result );
        $this->assertNotInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'pending', $result->post_status );
    }

    /**
     * A bypass user's REST write is not refused.
     */
    public function test_rest_insert_passes_a_bypass_user_through(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );
        $this->stub_current_user_roles( array( 'administrator' ) );

        $result = $this->filter_rest( 'publish' );

        $this->assertNotInstanceOf( \WP_Error::class, $result );
    }

    /**
     * The REST guard registers for every post type exposed to REST, not only the
     * ones an ACTIVE sequence currently maps. A post assigned to a sequence
     * that was later deactivated is still vetoed by the wp_insert_post_data
     * backstop, so the REST surface must cover it too — otherwise that write is
     * silently reverted with no message.
     */
    public function test_registers_the_rest_guard_for_every_rest_post_type(): void
    {
        $registered = array();

        Functions\when( 'get_post_types' )->alias(
            function ( $args = array() ) {
                if ( true !== ( $args['show_in_rest'] ?? null ) ) {
                    return array();
                }
                return array( 'post' => 'post', 'page' => 'page', 'vip_story' => 'vip_story' );
            }
        );
        Functions\when( 'add_filter' )->alias(
            function ( $hook ) use ( &$registered ) {
                $registered[] = $hook;
                return true;
            }
        );

        $this->guard->register_rest_guards();

        $this->assertSame(
            array( 'rest_pre_insert_post', 'rest_pre_insert_page', 'rest_pre_insert_vip_story' ),
            $registered
        );
    }

    /**
     * A REST write that names no status changes none.
     */
    public function test_rest_insert_without_a_status_is_untouched(): void
    {
        $this->stub_workflow_post( 'review', 'draft' );

        $prepared = (object) array( 'ID' => self::POST_ID );
        $result   = $this->guard->veto_rest_insert( $prepared, null );

        $this->assertSame( $prepared, $result );
    }
}
