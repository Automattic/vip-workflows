<?php
/**
 * Unit tests for IdeationController image-source analysis.
 *
 * Exercises the image-source analysis flow end-to-end through the public REST
 * callback `IdeationController::pin_card()` — no private method is invoked
 * directly. When an image source is pinned, the controller routes through
 * `maybe_summarize_source()` → `analyze_image_source()` → `save_source_analysis()`,
 * persisting the Vision result into the source row's `ai_analysis` JSON payload.
 *
 * Coverage (all driven via the public `pin_card()` surface):
 *   - Attachment-based image source → persisted `ai_analysis.summary`,
 *     `analyzed_at`, and `analysis_method` ('vision').
 *   - Persistence merges into (not clobbers) any pre-existing `ai_analysis` keys.
 *   - Failure branches write NO analysis data: AI unconfigured, AI exception,
 *     and missing attachment file.
 *   - Already-summarized sources short-circuit (no AI call, no write).
 *
 * Deferred / not covered here: the URL-download branch and its temp-file
 * cleanup. `analyze_image_source()` reaches that branch via the static
 * `SsrfGuard::download_validated_no_redirects()`, which performs real DNS
 * resolution against a hard-coded openai-only host allowlist before any
 * download. That static call cannot be stubbed from the public surface
 * (Brain\Monkey mocks functions, not static methods), so the URL-download
 * success path is unreachable without a production seam or the DB-backed
 * integration suite. The SSRF validation
 * logic itself is covered by tests/phpunit/Unit/SsrfGuardTest.php.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit {

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\AI\CorePrompts;
use VIPWorkflow\AI\PromptRegistry;
use VIPWorkflow\API\IdeationController;
use WordPress\AiClient\AiClient;
use WP_Post;

// This file's paths need a resolvable OpenAI key (a constant takes priority over
// the backend in Credentials::api_key(), keeping Credentials::model() answerable
// without real DB/encryption). That constant is declared for the whole unit suite
// in tests/phpunit/bootstrap.php — it is process-wide and irreversible, so
// declaring it here made the suite's environment depend on file load order.

/**
 * @group ideation-image-analysis
 */
class IdeationImageAnalysisTest extends TestCase
{
    private IdeationController $controller;

    /**
     * Mock global $wpdb.
     *
     * @var object
     */
    private $wpdb;

    /**
     * Captured `$wpdb->update()` call from save_source_analysis(), if any.
     *
     * @var array{table:string, data:array, where:array}|null
     */
    private ?array $captured_update = null;

    /**
     * Isolated uploads directory for attachment-backed image fixtures.
     */
    private string $uploads_dir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->uploads_dir = sys_get_temp_dir() . '/vipwf-ideation-uploads-' . uniqid( '', true );
        mkdir( $this->uploads_dir );

        // The analysis path resolves its instruction through PromptRegistry, which
        // in production is filled on the `vip_workflow_register_prompts` action.
        // `do_action` is a no-op in the unit suite, so the registry stays empty
        // unless a test fills it: register the core prompts this file's code path
        // reads. Without this the registry only happened to be populated by
        // whichever earlier test file had seeded it.
        CorePrompts::register( PromptRegistry::get_instance() );

        $this->captured_update = null;

        // Mock global $wpdb. A single mock satisfies the whole pin_card() chain:
        // get_row (maybe_summarize_source), get_results (get_state assistant meta
        // + cards), and update (save_source_analysis). prepare/esc_like pass
        // through. Per-test overrides refine get_row / update expectations.
        global $wpdb;
        $this->wpdb          = Mockery::mock( 'wpdb' );
        $this->wpdb->prefix  = 'wp_';
        $this->wpdb->postmeta = 'wp_postmeta';
        $wpdb                = $this->wpdb;

        $this->wpdb->shouldReceive( 'prepare' )->andReturnUsing( fn( $query ) => $query );
        $this->wpdb->shouldReceive( 'esc_like' )->andReturnUsing( fn( $text ) => $text );
        // get_state() reads assistant meta + cards; empty results keep it inert.
        $this->wpdb->shouldReceive( 'get_results' )->andReturn( array() );

        // get_state() also asks the abilities registry to name each stored
        // assistant. Nothing is registered in this process, and these tests store
        // no assistant meta, so an empty registry keeps that read inert too.
        Functions\when( 'wp_get_abilities' )->justReturn( array() );

        // Orchestrator pin_card()/get_state() use post meta + get_post only.
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'update_post_meta' )->justReturn( true );
        Functions\when( 'wp_get_attachment_url' )->justReturn( '' );
        Functions\when( 'get_post' )->alias(
            function ( int $id ) {
                return new WP_Post(
                    array(
                        'ID'          => $id,
                        'post_type'   => 'vip_ideation',
                        'post_title'  => 'Test project',
                        'post_status' => 'active',
                        'post_date'   => '2026-01-01 00:00:00',
                    )
                );
            }
        );

        // Analysis-flow function boundaries.
        Functions\when( 'current_time' )->justReturn( '2026-01-01 00:00:00' );
        Functions\when( 'apply_filters' )->returnArg( 2 );
        Functions\when( 'wp_json_encode' )->alias( 'json_encode' );
        Functions\when( 'get_post_mime_type' )->justReturn( 'image/jpeg' );
        Functions\when( 'get_attached_file' )->justReturn( false );
        Functions\when( 'wp_get_upload_dir' )->justReturn( array( 'basedir' => $this->uploads_dir ) );
        Functions\when( 'wp_check_filetype' )->justReturn( array( 'type' => 'image/jpeg' ) );
        Functions\when( 'wp_delete_file' )->justReturn( null );

        // Credentials resolves keys through whichever backend the environment
        // selects, and `function_exists( 'wp_get_connector' )` can be true here
        // because another test file in this process defined it. An empty connector
        // makes that path answer "no key" deterministically instead of throwing,
        // without disturbing the OpenAI key this file supplies by constant.
        Functions\when( 'wp_get_connector' )->justReturn( array() );

        // An unmet credential resolves its destination against the active backend,
        // which links to an admin screen when one exists.
        Functions\when( 'admin_url' )->alias(
            static fn( string $path = '' ): string => 'https://example.test/wp-admin/' . $path
        );

        // Credentials::model() reads this option.
        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                if ( 'vip_workflow_ai_model' === $option ) {
                    return 'gpt-4o';
                }
                return $default;
            }
        );

        $this->controller = new IdeationController();
    }

    protected function tearDown(): void
    {
        @rmdir( $this->uploads_dir );
        parent::tearDown();
    }

    // =========================================================================
    // Success / persistence paths
    // =========================================================================

    /**
     * @test
     * Pinning an attachment-backed image source runs Vision analysis and
     * persists summary + analyzed_at + analysis_method('vision') to ai_analysis.
     */
    public function attachment_image_pin_persists_vision_analysis(): void
    {
        $tmp = $this->create_temp_file();
        Functions\when( 'get_attached_file' )->justReturn( $tmp );
        AiClient::$generatedText = 'A photo of a press conference podium.';

        $this->expect_source_row_then_capture_update(
            $this->make_image_source( array( 'attachment_id' => 42 ) )
        );

        try {
            $this->controller->pin_card( $this->make_request( 101, 'src-1' ) );

            $this->assertNotNull( $this->captured_update, 'save_source_analysis() must persist an update.' );
            $payload = json_decode( $this->captured_update['data']['ai_analysis'], true );
            $this->assertSame( 'A photo of a press conference podium.', $payload['summary'] );
            $this->assertSame( '2026-01-01 00:00:00', $payload['analyzed_at'] );
            $this->assertSame( 'vision', $payload['analysis_method'] );
            $this->assertSame( 101, $this->captured_update['where']['project_id'] );
            $this->assertSame( 'src-1', $this->captured_update['where']['source_id'] );
        } finally {
            @unlink( $tmp );
        }
    }

    /**
     * @test
     * save_source_analysis() merges into existing ai_analysis rather than
     * replacing it: unrelated keys survive, analysis keys are (over)written.
     */
    public function persisted_analysis_preserves_existing_ai_analysis_keys(): void
    {
        $tmp = $this->create_temp_file();
        Functions\when( 'get_attached_file' )->justReturn( $tmp );
        AiClient::$generatedText = 'Updated description.';

        $existing = wp_json_encode( array( 'assistant' => 'media-scout', 'score' => 7 ) );
        $this->expect_source_row_then_capture_update(
            $this->make_image_source(
                array(
                    'attachment_id' => 42,
                    'ai_analysis'   => $existing,
                )
            )
        );

        try {
            $this->controller->pin_card( $this->make_request( 101, 'src-1' ) );

            $payload = json_decode( $this->captured_update['data']['ai_analysis'], true );
            // Pre-existing keys preserved.
            $this->assertSame( 'media-scout', $payload['assistant'] );
            $this->assertSame( 7, $payload['score'] );
            // Analysis keys added.
            $this->assertSame( 'Updated description.', $payload['summary'] );
            $this->assertSame( 'vision', $payload['analysis_method'] );
        } finally {
            @unlink( $tmp );
        }
    }

    // =========================================================================
    // Failure branches — must NOT write invalid analysis data
    // =========================================================================

    /**
     * @test
     * When AI is not configured, analyze_image_source() returns before any file
     * I/O or persistence.
     *
     * "Not configured" now means the *selected* provider is unusable, which is
     * what the analysis path actually depends on — it resolves its model through
     * `AiInference`. Selecting Anthropic with no key and no model stored is the
     * shortest honest way to model that. Setting `AiClient::$configured = false`
     * no longer models anything: the gate stopped asking the AI Client whether a
     * hardcoded OpenAI was configured, which is precisely the bug that made this
     * path skip image analysis on every non-OpenAI site.
     */
    public function unconfigured_ai_writes_no_analysis(): void
    {
        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflow_ai_provider' === $option ? 'anthropic' : $default;
            }
        );

        $this->expect_source_row_no_update(
            $this->make_image_source( array( 'attachment_id' => 42 ) )
        );

        $this->controller->pin_card( $this->make_request( 101, 'src-1' ) );

        $this->assertNull( $this->captured_update );
    }

    /**
     * @test
     * An exception from the Vision call is swallowed and no analysis is
     * persisted (failure branches do not write invalid data).
     */
    public function ai_exception_writes_no_analysis(): void
    {
        $tmp = $this->create_temp_file();
        Functions\when( 'get_attached_file' )->justReturn( $tmp );
        AiClient::$throwMessage = 'Vision API quota exceeded';

        $this->expect_source_row_no_update(
            $this->make_image_source( array( 'attachment_id' => 42 ) )
        );

        try {
            $this->controller->pin_card( $this->make_request( 101, 'src-1' ) );

            $this->assertNull( $this->captured_update );
        } finally {
            @unlink( $tmp );
        }
    }

    /**
     * @test
     * When the attachment resolves to a missing file, the flow bails at the
     * file_exists() guard without calling the AI or persisting.
     */
    public function missing_attachment_file_writes_no_analysis(): void
    {
        Functions\when( 'get_attached_file' )->justReturn( '/nonexistent/path/image.jpg' );

        $this->expect_source_row_no_update(
            $this->make_image_source( array( 'attachment_id' => 42 ) )
        );

        $this->controller->pin_card( $this->make_request( 101, 'src-1' ) );

        $this->assertNull( $this->captured_update );
        $this->assertSame( '', AiClient::$lastPrompt, 'AI must not be invoked when the file is missing.' );
    }

    /**
     * @test
     * An attachment path outside WordPress's uploads directory must never be
     * read or sent to the configured AI provider.
     */
    public function attachment_outside_uploads_writes_no_analysis(): void
    {
        $outside = tempnam( sys_get_temp_dir(), 'vipwf-outside-uploads-' );
        file_put_contents( $outside, 'test image bytes' );
        Functions\when( 'get_attached_file' )->justReturn( $outside );

        $this->expect_source_row_no_update(
            $this->make_image_source( array( 'attachment_id' => 42 ) )
        );

        try {
            $this->controller->pin_card( $this->make_request( 101, 'src-1' ) );

            $this->assertNull( $this->captured_update );
            $this->assertSame( '', AiClient::$lastPrompt, 'AI must not receive files outside the uploads directory.' );
        } finally {
            @unlink( $outside );
        }
    }

    /**
     * @test
     * A source already carrying an ai_analysis.summary short-circuits in
     * maybe_summarize_source(): no AI call, no write.
     */
    public function already_summarized_source_skips_analysis(): void
    {
        $already = wp_json_encode( array( 'summary' => 'Previously analyzed.' ) );
        $this->expect_source_row_no_update(
            $this->make_image_source(
                array(
                    'attachment_id' => 42,
                    'ai_analysis'   => $already,
                )
            )
        );

        $this->controller->pin_card( $this->make_request( 101, 'src-1' ) );

        $this->assertNull( $this->captured_update );
        $this->assertSame( '', AiClient::$lastPrompt, 'AI must not be invoked for an already-summarized source.' );
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Build an image-source row as returned by $wpdb->get_row(..., ARRAY_A).
     *
     * @param array $overrides Keys to override on the default row.
     */
    private function make_image_source( array $overrides = array() ): array
    {
        return array_merge(
            array(
                'project_id'    => 101,
                'source_id'     => 'src-1',
                'source_type'   => 'image',
                'attachment_id' => null,
                'image'         => 'https://example.com/image.jpg',
                'url'           => 'https://example.com/image.jpg',
                'ai_analysis'   => null,
            ),
            $overrides
        );
    }

    /**
     * Mock a WP_REST_Request returning the given pin_card() params.
     */
    private function make_request( int $project_id, string $source_id ): object
    {
        $request = Mockery::mock( 'WP_REST_Request' );
        $request->shouldReceive( 'get_param' )->andReturnUsing(
            function ( $key ) use ( $project_id, $source_id ) {
                return array(
                    'id'        => $project_id,
                    'source_id' => $source_id,
                )[ $key ] ?? null;
            }
        );
        return $request;
    }

    /**
     * Expect the source lookup to return $row and capture the persistence write.
     */
    private function expect_source_row_then_capture_update( array $row ): void
    {
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $row );
        $this->wpdb->shouldReceive( 'update' )->andReturnUsing(
            function ( $table, $data, $where ) {
                $this->captured_update = array(
                    'table' => $table,
                    'data'  => $data,
                    'where' => $where,
                );
                return 1;
            }
        );
    }

    /**
     * Expect the source lookup to return $row and assert no persistence write.
     */
    private function expect_source_row_no_update( array $row ): void
    {
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $row );
        $this->wpdb->shouldReceive( 'update' )->never();
    }

    /**
     * Create a small temp file and return its path. Caller unlinks in finally.
     */
    private function create_temp_file(): string
    {
        $path = tempnam( $this->uploads_dir, 'vipwf-int-' );
        file_put_contents( $path, 'test image bytes' );
        return $path;
    }
}

} // namespace VIPWorkflow\Tests\Unit
