<?php
/**
 * WorkflowRequirementGuard unit tests.
 *
 * Covers the save-layer required-workflow rule: with the enforcement mode set
 * to "require", a non-override user can't publish or schedule a post that has
 * no workflow, while drafts, pending, private, override roles, system contexts
 * and posts no sequence will take pass through untouched.
 *
 * The integration suite (RequiredWorkflowPublishTest) runs the same rule
 * through real WordPress save paths.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use ReflectionProperty;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\PostTypeManager;
use VIPWorkflows\Workflow\StatusManager;
use VIPWorkflows\Workflow\WorkflowRequirementGuard;

/**
 * Tests for the required-workflow save-layer rule.
 */
class WorkflowRequirementGuardTest extends TestCase
{
    /**
     * Post ID used throughout.
     */
    private const POST_ID = 42;

    /**
     * Guard under test.
     *
     * @var WorkflowRequirementGuard
     */
    private WorkflowRequirementGuard $guard;

    /**
     * Post type manager mock (the eligibility authority).
     *
     * @var PostTypeManager|Mockery\MockInterface
     */
    private $post_type_manager;

    /**
     * Settings option value served to Settings::get_settings().
     *
     * @var array<string, mixed>
     */
    private array $settings = array(
        'workflow_enforcement'      => true,
        'workflow_enforcement_mode' => 'require',
    );

    /**
     * Roles of the current user.
     *
     * @var string[]
     */
    private array $roles = array( 'author' );

    /**
     * Current user ID (0 = nobody logged in).
     *
     * @var int
     */
    private int $user_id = 5;

    /**
     * Sequence meta value of the stored post ('' = no workflow).
     *
     * @var string
     */
    private string $sequence_meta = '';

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

        $this->post_type_manager = Mockery::mock( PostTypeManager::class );
        $this->post_type_manager->shouldReceive( 'get_sequences_for_post' )->andReturn( array( 1 ) )->byDefault();

        $status_manager = new StatusManager( Mockery::mock( SequenceRepository::class ), $this->post_type_manager );
        $this->guard    = new WorkflowRequirementGuard( $status_manager, $this->post_type_manager );

        Functions\when( 'wp_is_post_autosave' )->justReturn( false );
        Functions\when( 'wp_is_post_revision' )->justReturn( false );
        Functions\when( 'wp_unslash' )->returnArg();
        Functions\when( 'get_option' )->alias(
            function () {
                return $this->settings;
            }
        );
        Functions\when( 'get_current_user_id' )->alias(
            function () {
                return $this->user_id;
            }
        );
        Functions\when( 'get_userdata' )->alias(
            function () {
                return (object) array( 'roles' => $this->roles );
            }
        );
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key = '' ) {
                return StatusManager::SEQUENCE_META_KEY === $key ? $this->sequence_meta : '';
            }
        );
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

        $this->stub_stored_post( 'draft' );
    }

    /**
     * Clear the request-scoped transition guard between tests (it is static).
     */
    protected function tearDown(): void
    {
        ( new ReflectionProperty( StatusManager::class, 'transition_in_progress' ) )->setValue( null, array() );

        parent::tearDown();
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Serve a stored post with the given status.
     *
     * @param string $post_status Stored post_status.
     * @param array  $extra       Extra columns.
     */
    private function stub_stored_post( string $post_status, array $extra = array() ): void
    {
        $post = $this->create_mock_post(
            array_merge(
                array(
                    'ID'            => self::POST_ID,
                    'post_title'    => 'Test Post',
                    'post_status'   => $post_status,
                    'post_name'     => 'draft' === $post_status ? '' : 'test-post',
                    'post_date'     => '2026-01-01 09:00:00',
                    'post_date_gmt' => 'draft' === $post_status ? '0000-00-00 00:00:00' : '2026-01-01 09:00:00',
                ),
                $extra
            )
        );

        Functions\when( 'get_post' )->justReturn( $post );
    }

    /**
     * Run the backstop filter for an update of the fixture post.
     *
     * @param  string $target_status Status the write would set.
     * @return array Filtered post data.
     */
    private function filter_update( string $target_status ): array
    {
        return $this->guard->filter_post_data(
            array(
                'post_status'   => $target_status,
                'post_type'     => 'post',
                'post_title'    => 'Edited title',
                'post_name'     => 'edited-title',
                'post_date'     => '2026-12-01 09:00:00',
                'post_date_gmt' => '2026-12-01 09:00:00',
            ),
            array( 'ID' => self::POST_ID )
        );
    }

    /**
     * Run the backstop filter for an insert of a brand-new post.
     *
     * @param  string $target_status Status the write would set.
     * @param  array  $postarr       Raw insert args.
     * @return array Filtered post data.
     */
    private function filter_insert( string $target_status, array $postarr = array() ): array
    {
        return $this->guard->filter_post_data(
            array(
                'post_status'   => $target_status,
                'post_type'     => 'post',
                'post_title'    => 'Brand new',
                'post_name'     => 'brand-new',
                'post_date'     => '2026-12-01 09:00:00',
                'post_date_gmt' => '2026-12-01 09:00:00',
            ),
            $postarr
        );
    }

    /**
     * Run the REST filter for a write on the fixture post (or a new post).
     *
     * @param  string $target_status Status the write would set.
     * @param  int    $post_id       Post ID (0 for a create).
     * @return \stdClass|\WP_Error
     */
    private function filter_rest( string $target_status, int $post_id = self::POST_ID )
    {
        $prepared = (object) array(
            'post_status' => $target_status,
            'post_type'   => 'post',
            'post_title'  => 'Brand new',
        );
        if ( $post_id > 0 ) {
            $prepared->ID = $post_id;
        }

        return $this->guard->filter_rest_insert( $prepared, null );
    }

    // =========================================================================
    // Refused
    // =========================================================================

    /**
     * Publishing an unassigned draft keeps its stored status, slug and dates;
     * the rest of the save (the title) lands.
     */
    public function test_refuses_publishing_an_unassigned_post(): void
    {
        $data = $this->filter_update( 'publish' );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( '', $data['post_name'] );
        $this->assertSame( '2026-01-01 09:00:00', $data['post_date'] );
        $this->assertSame( '0000-00-00 00:00:00', $data['post_date_gmt'] );
        $this->assertSame( 'Edited title', $data['post_title'] );
    }

    /**
     * Scheduling is publishing.
     */
    public function test_refuses_scheduling_an_unassigned_post(): void
    {
        $data = $this->filter_update( 'future' );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( '0000-00-00 00:00:00', $data['post_date_gmt'] );
    }

    /**
     * A pending or private post can't be published either.
     */
    public function test_refuses_publishing_from_pending_and_private(): void
    {
        $this->stub_stored_post( 'pending' );
        $this->assertSame( 'pending', $this->filter_update( 'publish' )['post_status'] );

        $this->stub_stored_post( 'private' );
        $this->assertSame( 'private', $this->filter_update( 'publish' )['post_status'] );
    }

    /**
     * A new post is written the way core writes a draft: no slug, floating GMT date.
     */
    public function test_refused_new_post_is_written_as_a_draft(): void
    {
        $data = $this->filter_insert( 'publish' );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( '', $data['post_name'] );
        $this->assertSame( '0000-00-00 00:00:00', $data['post_date_gmt'] );
        $this->assertSame( '2026-12-01 09:00:00', $data['post_date'] );
    }

    /**
     * A slug or GMT date the caller named is kept, as core keeps it for a draft.
     */
    public function test_refused_new_post_keeps_a_requested_slug_and_gmt_date(): void
    {
        $data = $this->filter_insert(
            'publish',
            array(
                'post_name'     => 'Chosen Slug',
                'post_date_gmt' => '2026-12-01 09:00:00',
            )
        );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( 'chosen-slug', $data['post_name'] );
        $this->assertSame( '2026-12-01 09:00:00', $data['post_date_gmt'] );
    }

    /**
     * An auto-draft (the block or classic editor's new post) becomes a draft,
     * not an auto-draft that core would later delete.
     */
    public function test_refused_auto_draft_becomes_a_draft(): void
    {
        $this->stub_stored_post( 'auto-draft' );

        $data = $this->filter_update( 'publish' );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( '', $data['post_name'] );
        $this->assertSame( '0000-00-00 00:00:00', $data['post_date_gmt'] );
    }

    /**
     * Restoring from the Trash straight to publish lands as a draft, not back
     * in the Trash (core has already removed the trash bookkeeping).
     */
    public function test_refused_restore_from_trash_lands_as_a_draft(): void
    {
        $this->stub_stored_post( 'trash' );

        $data = $this->filter_update( 'publish' );

        $this->assertSame( 'draft', $data['post_status'] );
        $this->assertSame( 'edited-title', $data['post_name'] );
        $this->assertSame( '2026-01-01 09:00:00', $data['post_date'] );
    }

    /**
     * A refused existing post queues the classic-editor notice, shown once.
     */
    public function test_refusal_queues_a_notice_rendered_once(): void
    {
        $this->filter_update( 'publish' );

        $this->assertSame(
            array( 'vip_workflows_workflow_required_5_42' => '“Test Post” can’t be published without a workflow. Choose one, then move the post through it to a published stage.' ),
            $this->transients
        );

        ob_start();
        $this->guard->render_notice();
        $first = (string) ob_get_clean();

        ob_start();
        $this->guard->render_notice();
        $second = (string) ob_get_clean();

        $this->assertStringContainsString( 'can’t be published without a workflow', $first );
        $this->assertSame( '', $second );
    }

    /**
     * A refused new post has no ID to scope a notice to, so none is queued.
     */
    public function test_refused_new_post_queues_no_notice(): void
    {
        $this->filter_insert( 'publish' );

        $this->assertSame( array(), $this->transients );
    }

    /**
     * REST create and update get a 409 with the message and post id.
     */
    public function test_rest_refusal_is_a_409(): void
    {
        $result = $this->filter_rest( 'publish', 0 );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( WorkflowRequirementGuard::ERROR_CODE, $result->get_error_code() );
        $this->assertSame( array( 'status' => 409, 'post_id' => 0 ), $result->get_error_data() );
        $this->assertSame( '“Brand new” can’t be published without a workflow. Choose one, then move the post through it to a published stage.', $result->get_error_message() );

        $update = $this->filter_rest( 'future' );
        $this->assertInstanceOf( \WP_Error::class, $update );
        $this->assertSame( array( 'status' => 409, 'post_id' => self::POST_ID ), $update->get_error_data() );
    }

    /**
     * An untitled post gets a sentence without empty quotes.
     */
    public function test_untitled_message(): void
    {
        $this->assertSame(
            'This post can’t be published without a workflow. Choose one, then move the post through it to a published stage.',
            WorkflowRequirementGuard::message( '  ' )
        );
    }

    /**
     * The eligibility filter sees a new post's fields.
     */
    public function test_new_post_eligibility_receives_the_incoming_post(): void
    {
        $seen = null;
        $this->post_type_manager->shouldReceive( 'get_sequences_for_post' )->andReturnUsing(
            function ( $post ) use ( &$seen ) {
                $seen = $post;
                return array( 1 );
            }
        );

        $this->filter_rest( 'publish', 0 );

        $this->assertInstanceOf( \WP_Post::class, $seen );
        $this->assertSame( 0, $seen->ID );
        $this->assertSame( 'post', $seen->post_type );
        $this->assertSame( 'Brand new', $seen->post_title );
    }

    // =========================================================================
    // Allowed
    // =========================================================================

    /**
     * Drafts, pending and private are not publishing.
     */
    public function test_allows_non_publish_targets(): void
    {
        foreach ( array( 'draft', 'pending', 'private', 'trash' ) as $status ) {
            $this->assertSame( $status, $this->filter_update( $status )['post_status'], $status );
            $this->assertSame( $status, $this->filter_insert( $status )['post_status'], $status );
            $this->assertNotInstanceOf( \WP_Error::class, $this->filter_rest( $status ), $status );
        }
    }

    /**
     * Recommend mode and enforcement off don't refuse.
     */
    public function test_allows_when_mode_is_not_require(): void
    {
        $this->settings = array(
            'workflow_enforcement'      => true,
            'workflow_enforcement_mode' => 'recommend',
        );
        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );

        $this->settings = array(
            'workflow_enforcement'      => false,
            'workflow_enforcement_mode' => 'require',
        );
        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
    }

    /**
     * A post with a workflow is PublishBoundaryGuard's to judge.
     */
    public function test_allows_a_post_with_a_workflow(): void
    {
        $this->sequence_meta = '7';

        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
    }

    /**
     * A post no sequence will take (post type not covered, or the eligibility
     * filter removed every sequence) is never trapped.
     */
    public function test_allows_a_post_no_sequence_will_take(): void
    {
        $this->post_type_manager->shouldReceive( 'get_sequences_for_post' )->andReturn( array() );

        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
        $this->assertSame( 'publish', $this->filter_insert( 'publish' )['post_status'] );
    }

    /**
     * An already-live or scheduled post: re-save, reschedule, go live.
     */
    public function test_allows_posts_already_on_the_publish_side(): void
    {
        $this->stub_stored_post( 'publish' );
        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
        $this->assertSame( 'future', $this->filter_update( 'future' )['post_status'] );

        $this->stub_stored_post( 'future' );
        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
    }

    /**
     * Override roles may publish without a workflow.
     */
    public function test_allows_override_roles(): void
    {
        $this->roles = array( 'administrator' );

        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
        $this->assertNotInstanceOf( \WP_Error::class, $this->filter_rest( 'publish', 0 ) );
    }

    /**
     * A write with no logged-in user is a system actor.
     */
    public function test_allows_userless_writes(): void
    {
        $this->user_id = 0;

        $this->assertSame( 'publish', $this->filter_insert( 'publish' )['post_status'] );
    }

    /**
     * Cron is exempt, through the filterable function.
     */
    public function test_allows_cron(): void
    {
        Functions\when( 'wp_doing_cron' )->justReturn( true );

        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
    }

    /**
     * Autosaves, revisions and a workflow commit in progress are exempt.
     */
    public function test_allows_autosaves_revisions_and_workflow_commits(): void
    {
        Functions\when( 'wp_is_post_revision' )->justReturn( 7 );
        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );

        Functions\when( 'wp_is_post_revision' )->justReturn( false );
        $this->stub_stored_post( 'draft', array( 'post_type' => 'revision' ) );
        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );

        $this->stub_stored_post( 'draft' );
        ( new ReflectionProperty( StatusManager::class, 'transition_in_progress' ) )->setValue( null, array( self::POST_ID => true ) );
        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
    }

    /**
     * WP-CLI is exempt, even as a logged-in non-override user.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_allows_wp_cli(): void
    {
        define( 'WP_CLI', true );

        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
        $this->assertSame( 'publish', $this->filter_insert( 'publish' )['post_status'] );
    }

    /**
     * The DOING_CRON constant exempts cron even when wp_doing_cron() is filtered off.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_allows_the_doing_cron_constant(): void
    {
        define( 'DOING_CRON', true );

        $this->assertSame( 'publish', $this->filter_update( 'publish' )['post_status'] );
    }

    /**
     * A write that names no status is left alone, and nothing else is read.
     */
    public function test_ignores_writes_without_a_status(): void
    {
        $this->post_type_manager->shouldNotReceive( 'get_sequences_for_post' );

        $this->assertSame( '', $this->filter_update( '' )['post_status'] );
    }
}
