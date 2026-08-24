<?php
/**
 * Quick Edit / Bulk Edit inline-script tests, including the
 * workflow side-effect guard).
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Admin\AdminStyles;
use VIPWorkflow\Admin\PostsColumns;
use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Workflow\StatusManager;

/**
 * The list-table surfaces of the workflow guard.
 *
 * The Quick Edit inline script must build the current-status display via DOM
 * APIs, never by concatenating dataset/response values into innerHTML; it must
 * leave the native Status control alone; and it must preflight both Quick Edit
 * and Bulk Edit through the shared decision module rather than a second copy of
 * the region table.
 */
class PostsColumnsQuickEditScriptTest extends TestCase
{
    /**
     * Post ID used by the column-rendering tests.
     */
    private const POST_ID = 42;

    /**
     * Arguments every wp_enqueue_script() call was made with.
     *
     * @var array<int, array>
     */
    private array $enqueued_scripts = array();

    /**
     * Handles wp_set_script_translations() was called for.
     *
     * @var array<int, string>
     */
    private array $translated_handles = array();

    /**
     * Arguments every wp_enqueue_style() call was made with.
     *
     * @var array<int, array>
     */
    private array $enqueued_styles = array();

    /**
     * A scratch plugin directory holding a built side-effect manifest.
     *
     * The enqueue takes the shared module's dependencies and version from the
     * generated manifest rather than a hardcoded list, so the tests have to
     * exercise it against one — otherwise they would only ever cover the
     * "plugin was never built" branch.
     *
     * @return string Absolute path, with a trailing slash.
     */
    private static function build_fixture_dir(): string
    {
        $dir = sys_get_temp_dir() . '/vipwf-posts-columns-build/';

        if ( ! is_dir( $dir . 'build' ) ) {
            mkdir( $dir . 'build', 0777, true );
        }

        file_put_contents(
            $dir . 'build/side-effect.asset.php',
            "<?php return array( 'dependencies' => array( 'wp-i18n' ), 'version' => 'manifest-version' );\n"
        );

        return $dir;
    }

    private function capture_script(): string
    {
        $captured = '';

        // The shared decision module is enqueued from the plugin's build
        // directory, so the entrypoint constants have to exist.
        if ( ! defined( 'VIP_WORKFLOW_PLUGIN_URL' ) ) {
            define( 'VIP_WORKFLOW_PLUGIN_URL', 'https://example.test/wp-content/plugins/vip-workflow/' );
        }
        if ( ! defined( 'VIP_WORKFLOW_PLUGIN_DIR' ) ) {
            define( 'VIP_WORKFLOW_PLUGIN_DIR', self::build_fixture_dir() );
        }
        if ( ! defined( 'VIP_WORKFLOW_VERSION' ) ) {
            define( 'VIP_WORKFLOW_VERSION', '0.0.1' );
        }

        $this->enqueued_scripts   = array();
        $this->translated_handles = array();
        $this->enqueued_styles    = array();

        Functions\when( 'wp_enqueue_style' )->alias(
            function ( ...$args ) {
                $this->enqueued_styles[] = $args;
                return true;
            }
        );
        Functions\when( 'wp_style_add_data' )->justReturn( true );
        Functions\when( 'wp_create_nonce' )->justReturn( 'nonce' );
        Functions\when( 'rest_url' )->justReturn( 'http://example.test/wp-json/vip-workflow/v1' );
        Functions\when( 'get_current_user_id' )->justReturn( 0 );
        Functions\when( 'wp_enqueue_script' )->alias(
            function ( ...$args ) {
                $this->enqueued_scripts[] = $args;
                return true;
            }
        );
        Functions\when( 'wp_set_script_translations' )->alias(
            function ( $handle ) {
                $this->translated_handles[] = $handle;
                return true;
            }
        );
        Functions\when( 'wp_add_inline_script' )->alias(
            function ( $handle, $script ) use ( &$captured ) {
                $captured = $script;
                return true;
            }
        );

        ( new PostsColumns() )->enqueue_quick_edit_assets( 'edit.php' );

        return $captured;
    }

    /**
     * Render the workflow column for a post seated at the given stage.
     *
     * @param  string $stage_key   Stage the post is seated at.
     * @param  string $post_status Committed post_status.
     * @return string Rendered column markup.
     */
    private function render_column_for_stage( string $stage_key, string $post_status = 'draft' ): string
    {
        $sequence = $this->create_test_sequence();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->with( self::POST_ID )
            ->andReturn( $sequence );
        $status_manager->shouldReceive( 'get_current_status' )
            ->with( self::POST_ID )
            ->andReturn( $sequence->get_status( $stage_key ) );

        // The row's region comes from boundary_region(), the one authority the
        // server predicate also uses — the double reproduces its rule rather
        // than letting the column read the stage directly.
        $status_manager->shouldReceive( 'boundary_region' )
            ->andReturnUsing(
                fn( $post_id, $stage_region ) => in_array( $post_status, array( 'publish', 'future' ), true )
                    ? 'publish'
                    : $stage_region
            );

        Functions\when( 'get_post_status' )->justReturn( $post_status );

        return $this->with_status_manager(
            $status_manager,
            function () {
                ob_start();
                ( new PostsColumns() )->render_column( 'workflow_status', self::POST_ID );
                return (string) ob_get_clean();
            }
        );
    }

    /**
     * Run a callback with the Plugin singleton's status manager replaced.
     *
     * @param  object   $status_manager Status manager double.
     * @param  callable $callback       Code to run with the double installed.
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

    /**
     * Sequence spanning the draft and publish regions.
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
                    'color'        => '#111111',
                    'region_entry' => true,
                    'transitions'  => array( array( 'to' => 'review' ) ),
                ),
                array(
                    'key'         => 'review',
                    'label'       => 'In Review',
                    'status'      => 'pending',
                    'color'       => '#222222',
                    'transitions' => array( array( 'to' => 'published' ) ),
                ),
                array(
                    'key'          => 'published',
                    'label'        => 'Published',
                    'status'       => 'publish',
                    'color'        => '#333333',
                    'region_entry' => true,
                    'is_terminal'  => true,
                    'transitions'  => array(),
                ),
            ),
        );

        $row = (object) array(
            'id'          => 7,
            'uuid'        => 'test-uuid-7',
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

    public function test_status_display_uses_dom_helper_not_innerhtml(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'renderCurrentStatus(', $script );
        $this->assertStringContainsString( 'labelSpan.textContent', $script );
        // The status label/color no longer flow into an innerHTML string.
        $this->assertStringNotContainsString(
            'currentEl.innerHTML = \'<span class="vip-workflow-quick-edit__dot"',
            $script
        );
    }

    public function test_no_script_emitted_off_the_posts_list(): void
    {
        $called = false;
        Functions\when( 'wp_add_inline_script' )->alias(
            function () use ( &$called ) {
                $called = true;
                return true;
            }
        );

        ( new PostsColumns() )->enqueue_quick_edit_assets( 'post.php' );

        $this->assertFalse( $called );
    }

    /**
     * The column dot, the "Live" pill and the Quick Edit box are styled by a
     * real stylesheet, and the list table loads none of the plugin's built
     * admin assets — so the enqueue has to happen here, on `edit.php`, or the
     * markup renders unstyled.
     */
    public function test_classic_stylesheet_is_enqueued_on_the_posts_list(): void
    {
        $this->capture_script();

        $handles = array_column( $this->enqueued_styles, 0 );

        $this->assertContains( AdminStyles::CLASSIC_HANDLE, $handles );

        $classic = null;
        foreach ( $this->enqueued_styles as $args ) {
            if ( AdminStyles::CLASSIC_HANDLE === $args[0] ) {
                $classic = $args;
            }
        }

        $this->assertSame( VIP_WORKFLOW_PLUGIN_URL . 'build/classic-admin.css', $classic[1] );

        // Every value in that stylesheet is a --wpds-* token, and nothing else on
        // this screen declares them.
        $this->assertSame( array( AdminStyles::TOKENS_HANDLE ), $classic[2] );
        $this->assertContains( AdminStyles::TOKENS_HANDLE, $handles );
    }

    /**
     * Off the posts list there is no column and no Quick Edit box, so nothing
     * is loaded for them.
     */
    public function test_no_styles_enqueued_off_the_posts_list(): void
    {
        $this->enqueued_styles = array();

        Functions\when( 'wp_enqueue_style' )->alias(
            function ( ...$args ) {
                $this->enqueued_styles[] = $args;
                return true;
            }
        );

        ( new PostsColumns() )->enqueue_quick_edit_assets( 'post.php' );

        $this->assertSame( array(), $this->enqueued_styles );
    }

    /**
     * The native Status control stays: the workflow warns about a status
     * change, it never takes the control away.
     */
    public function test_native_status_control_is_not_hidden(): void
    {
        $script = $this->capture_script();

        $this->assertStringNotContainsString( 'inline-edit-status', $script );
        $this->assertStringNotContainsString( 'statusField', $script );
    }

    /**
     * Both preflights read the row's stage region, so the check costs no request.
     */
    public function test_row_data_carries_the_stage_region(): void
    {
        $markup = $this->render_column_for_stage( 'review' );

        $this->assertStringContainsString( 'class="vip-workflow-data"', $markup );
        $this->assertStringContainsString( 'data-workflow="1"', $markup );
        $this->assertStringContainsString( 'data-stage-region="pending"', $markup );
        // The veto copy names the workflow, so the row carries its name too.
        $this->assertStringContainsString( 'data-sequence-name="Test Workflow"', $markup );
    }

    /**
     * The cell carries no styling of its own beyond the one thing a stylesheet
     * cannot know: the stage's color, which comes from sequence config and
     * arrives as a custom property.
     */
    public function test_the_column_styles_itself_by_class_and_one_custom_property(): void
    {
        $markup = $this->render_column_for_stage( 'review' );

        $this->assertStringContainsString( 'class="vip-workflow-column__dot"', $markup );
        $this->assertStringContainsString( '--vip-workflow-stage-color: #222222', $markup );
        // The label is addressable by class because the Quick Edit script
        // rewrites it after a transition.
        $this->assertStringContainsString( 'class="vip-workflow-column__label"', $markup );

        $this->assertStringNotContainsString( 'display:inline-flex', $markup );
        $this->assertStringNotContainsString( 'border-radius', $markup );
    }

    /**
     * "Live" is a semantic state, styled by the stylesheet off a WPDS success
     * token — not an inline green.
     */
    public function test_the_live_pill_carries_no_inline_styling(): void
    {
        $markup = $this->render_column_for_stage( 'published', 'publish' );

        $this->assertStringContainsString( '<span class="vip-workflow-column__live">', $markup );
        $this->assertStringNotContainsString( '#00a32a', $markup );
    }

    /**
     * The committed core status rides along with the region: only a genuine
     * status CHANGE can cross a boundary, and the two values legitimately
     * differ (this row is seated at a `pending`-region stage while core holds
     * it as `draft`).
     */
    public function test_row_data_carries_the_committed_post_status(): void
    {
        $markup = $this->render_column_for_stage( 'review' );

        $this->assertStringContainsString( 'data-post-status="draft"', $markup );
        $this->assertStringContainsString( 'data-stage-region="pending"', $markup );
    }

    /**
     * A post whose stage does not resolve is still workflow-managed, and the
     * row has to say so — the server predicate reads the sequence meta, not
     * the stage, and would refuse a crossing the client never even looked at.
     */
    public function test_row_data_is_emitted_for_an_unresolvable_stage(): void
    {
        $sequence = $this->create_test_sequence();

        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->with( self::POST_ID )
            ->andReturn( $sequence );
        $status_manager->shouldReceive( 'get_current_status' )
            ->with( self::POST_ID )
            ->andReturn( null );

        Functions\when( 'get_post_status' )->justReturn( 'draft' );

        $markup = $this->with_status_manager(
            $status_manager,
            function () {
                ob_start();
                ( new PostsColumns() )->render_column( 'workflow_status', self::POST_ID );
                return (string) ob_get_clean();
            }
        );

        $this->assertStringContainsString( 'data-workflow="1"', $markup );
        // The empty region is what makes the client fail closed on this row.
        $this->assertStringContainsString( 'data-stage-region=""', $markup );
        $this->assertStringContainsString( 'data-post-status="draft"', $markup );
        // And no destination to name: resolve_managed_stage() drops this post
        // before any reseat is considered, so nothing moves whatever the
        // sequence models.
        $this->assertStringContainsString( 'data-seated-region=""', $markup );
        $this->assertStringContainsString( 'data-entry-stages="{}"', $markup );
    }

    /**
     * A post whose sequence row was deleted has no workflow left to move it
     * through, so the row names no destination either.
     */
    public function test_row_data_for_an_orphaned_post_names_no_entry_stages(): void
    {
        $status_manager = Mockery::mock( StatusManager::class );
        $status_manager->shouldReceive( 'get_sequence_for_post' )
            ->with( self::POST_ID )
            ->andReturn( null );
        $status_manager->shouldReceive( 'has_dangling_sequence' )
            ->with( self::POST_ID )
            ->andReturn( true );

        Functions\when( 'get_post_status' )->justReturn( 'draft' );
        Functions\when( 'get_post_meta' )->justReturn( 7 );

        $markup = $this->with_status_manager(
            $status_manager,
            function () {
                ob_start();
                ( new PostsColumns() )->render_column( 'workflow_status', self::POST_ID );
                return (string) ob_get_clean();
            }
        );

        $this->assertStringContainsString( 'data-orphaned="1"', $markup );
        $this->assertStringContainsString( 'data-seated-region=""', $markup );
        $this->assertStringContainsString( 'data-entry-stages="{}"', $markup );
    }

    /**
     * The confirm names the stage a status change would land on, so the row
     * carries every region's checkpoint label. The map is rendered rather than
     * fetched because the preflight is request-free by contract.
     */
    public function test_row_data_carries_the_entry_stage_labels(): void
    {
        $markup = $this->render_column_for_stage( 'review' );

        $this->assertStringContainsString( '"draft":"Draft"', $markup );
        $this->assertStringContainsString( '"publish":"Published"', $markup );
        // `review` is the fixture's only pending-region stage and carries no
        // checkpoint. Sequence::get_region_entry_stage() throws on that, and
        // StatusManager::resolve_reseat_stage() treats the throw as "nothing
        // moves" — so the region is left out rather than guessed at.
        $this->assertStringNotContainsString( '"pending":', $markup );
    }

    /**
     * The stage's OWN region rides alongside the boundary region, because only
     * the stage decides whether a status change re-seats anything.
     *
     * They come apart on exactly the row that caused the bug: a live post
     * stranded at a draft-region stage reports `publish` for the boundary, while
     * unpublishing it back to `draft` re-seats nothing at all.
     */
    public function test_row_data_carries_the_stages_own_region(): void
    {
        $markup = $this->render_column_for_stage( 'draft', 'publish' );

        $this->assertStringContainsString( 'data-stage-region="publish"', $markup );
        $this->assertStringContainsString( 'data-seated-region="draft"', $markup );
    }

    /**
     * The region is the stage's when the committed status has no publish-side
     * pull of its own — a publish-region stage on a post core still holds at
     * `draft` renders `publish`.
     */
    public function test_stage_region_follows_the_stage(): void
    {
        $this->assertStringContainsString(
            'data-stage-region="publish"',
            $this->render_column_for_stage( 'published', 'draft' )
        );
    }

    /**
     * A LIVE post renders `publish` even when its stage is draft-region.
     *
     * The two disagree when a core publish had no publish-region stage to
     * re-seat at. The row data is what the Quick Edit and Bulk Edit preflights
     * compare against, so a row that reported the stranded stage would let the
     * client wave through an unpublish the server refuses.
     */
    public function test_stage_region_follows_a_live_post_over_its_stage(): void
    {
        $markup = $this->render_column_for_stage( 'draft', 'publish' );

        $this->assertStringContainsString( 'data-stage-region="publish"', $markup );
        $this->assertStringContainsString( 'data-post-status="publish"', $markup );
    }

    /**
     * Quick Edit's apply goes through the guard before core saves.
     */
    public function test_quick_edit_apply_is_preflighted(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'inlineEditPost.save = function(id)', $script );
        $this->assertStringContainsString( 'quickEditAllowed(postId)', $script );
        // A refusal returns false instead of delegating to core's save.
        $this->assertStringContainsString( 'origSave.apply(this, arguments)', $script );
    }

    /**
     * Bulk Edit is all-or-nothing: the preflight runs in the capture phase, so
     * it can stop core's own #bulk_edit handler before any request goes out, and
     * a single vetoed post fails the whole apply.
     */
    public function test_bulk_preflight_rejects_a_mixed_selection_wholesale(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( "document.addEventListener('click'", $script );
        $this->assertStringContainsString( "target.closest('#bulk_edit')", $script );
        $this->assertStringContainsString( 'bulkEditAllowed()', $script );
        // Capture phase + stopImmediatePropagation is what makes the rejection
        // wholesale rather than a race with core's handler.
        $this->assertStringContainsString( 'e.stopImmediatePropagation();', $script );
        $this->assertStringContainsString( '}, true);', $script );
        // One vetoed post aborts before the loop's result is ever applied.
        $this->assertStringContainsString( 'if (vetoed.length) {', $script );
        $this->assertStringContainsString(
            'Deselect them, or remove them from their workflows first.',
            $script
        );
    }

    /**
     * The bulk copy names only the affected subset and its count, never the
     * whole selection.
     */
    public function test_bulk_copy_scopes_to_the_affected_subset(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'vetoed.length, checked.length, vetoed.join', $script );
        $this->assertStringContainsString( 'warned.length, checked.length, warned.join', $script );
    }

    /**
     * The decision table lives in the shared module. A second copy of the region
     * map here is exactly how the surfaces drift apart.
     */
    public function test_decision_table_is_not_reimplemented(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'window.vipWorkflowSideEffect', $script );
        $this->assertStringContainsString( 'api.evaluateStatusChange(', $script );
        $this->assertStringContainsString( 'api.getPublishVetoMessage(', $script );
        $this->assertStringContainsString( 'api.getStatusChangeWarning(', $script );
        // The warn copy names a stage, so the row's entry-stage map and the
        // stage's own region go with it — and resolving the checkpoint stays
        // the shared module's job, not this script's.
        $this->assertStringContainsString( 'stageRegion: data.dataset.seatedRegion', $script );
        $this->assertStringContainsString( 'entryStageLabels: entryStages', $script );
        // The region aliases are the shared module's business, not this script's.
        $this->assertStringNotContainsString( "'future'", $script );
        $this->assertStringNotContainsString( "'auto-draft'", $script );
    }

    /**
     * The bypass flag is a server answer, embedded once per request.
     */
    public function test_bypass_flag_is_embedded_for_the_current_user(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( '"canBypass":false', $script );
    }

    /**
     * A guard that cannot answer fails closed — it never lets the save through.
     */
    public function test_guard_fails_closed_when_it_cannot_answer(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'function blockUnavailable()', $script );
        $this->assertStringContainsString( 'return blockUnavailable();', $script );
        $this->assertStringContainsString( 'guard.strings.guardUnavailable', $script );
    }

    /**
     * A broken sequence is not a transient failure: reloading re-renders the
     * same broken config, so it gets copy that names the real cause.
     */
    public function test_a_misconfigured_stage_gets_its_own_message(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'function blockMisconfigured()', $script );
        $this->assertStringContainsString( 'return blockMisconfigured();', $script );
        $this->assertStringContainsString( 'guard.strings.stageMisconfigured', $script );
        $this->assertStringContainsString( 'ask an administrator to fix', $script );
    }

    /**
     * A save that changes no status crosses nothing, and is never refused —
     * the same early return PublishBoundaryGuard::resolve_veto() makes. Without
     * it a headline fix on a post whose stage and status have drifted apart
     * (scheduling reseats nothing) would be blocked forever.
     */
    public function test_a_save_that_changes_no_status_is_not_preflighted(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'function isStatusChange(data, targetStatus)', $script );
        $this->assertStringContainsString( 'data.dataset.postStatus', $script );
        $this->assertStringContainsString(
            "return targetStatus !== '' && targetStatus !== committed;",
            $script
        );
        // Quick Edit returns before it ever consults the decision module.
        $this->assertStringContainsString( 'if (!isStatusChange(data, targetStatus)) return true;', $script );
        // Bulk Edit skips such a post rather than counting it as affected.
        $this->assertStringContainsString( 'if (!isStatusChange(data, targetStatus)) continue;', $script );
    }

    /**
     * An unselected `_status` select is core's own "this save names no status"
     * (there is no `private` option in single-row Quick Edit, and core removes
     * `publish` for a future-dated post). Only a missing control is a failure.
     */
    public function test_only_a_missing_status_control_is_treated_as_a_failure(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'if (targetStatus === null) {', $script );
        // The old truthiness test swept the empty-value case in with it.
        $this->assertStringNotContainsString( 'if (!targetStatus) {', $script );
    }

    /**
     * The publish boundary is symmetric, so the bulk veto copy is too: a user
     * un-publishing was never trying to publish.
     */
    public function test_bulk_veto_copy_is_direction_aware(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString( 'guard.strings.bulkVetoPublish', $script );
        $this->assertStringContainsString( 'guard.strings.bulkVetoUnpublish', $script );
        // Direction comes from the shared region map, never a second copy of it.
        $this->assertStringContainsString( "api.statusToRegion(targetStatus) === 'publish'", $script );
        $this->assertStringContainsString( 'published status can\'t be changed directly', $script );
    }

    /**
     * An inline workflow transition moves the stage, and may commit a new
     * post_status with it. Both preflight inputs have to move too, or the next
     * Quick Edit is judged against a stage the post has already left.
     */
    public function test_a_transition_refreshes_the_preflight_row_data(): void
    {
        $script = $this->capture_script();

        $this->assertStringContainsString(
            "dataInput.dataset.stageRegion = (resp.guard && resp.guard.current_region) || '';",
            $script
        );
        // The stage's own region moves too — it is what decides whether the
        // next status change re-seats the post or leaves it put.
        $this->assertStringContainsString(
            "dataInput.dataset.seatedRegion = resp.current.status || '';",
            $script
        );
        $this->assertStringContainsString( 'dataInput.dataset.postStatus = resp.current.wp_status;', $script );
    }

    /**
     * Dependencies and version come from the generated manifest, and the
     * module's own strings are localized — one dialog flow, one language.
     */
    public function test_shared_module_is_enqueued_from_its_build_manifest(): void
    {
        $this->capture_script();

        $side_effect = null;
        foreach ( $this->enqueued_scripts as $args ) {
            if ( 'vip-workflow-side-effect' === $args[0] ) {
                $side_effect = $args;
            }
        }

        $this->assertNotNull( $side_effect, 'The shared decision module was never enqueued.' );
        $this->assertSame( VIP_WORKFLOW_PLUGIN_URL . 'build/side-effect.js', $side_effect[1] );
        $this->assertSame( array( 'wp-i18n' ), $side_effect[2] );
        $this->assertSame( 'manifest-version', $side_effect[3] );
        $this->assertContains( 'vip-workflow-side-effect', $this->translated_handles );
    }
}
