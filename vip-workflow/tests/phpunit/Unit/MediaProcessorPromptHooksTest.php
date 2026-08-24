<?php
/**
 * Prompt-hook coverage for MediaProcessor call sites.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit {

use Brain\Monkey\Functions;
use VIPWorkflow\AI\CorePrompts;
use VIPWorkflow\AI\PromptRegistry;
use VIPWorkflow\AI\PromptSettings;
use VIPWorkflow\API\IdeationController;
use VIPWorkflow\Ideation\Research\SourceProcessingJob;
use VIPWorkflow\Integrations\MediaProcessor;
use WP_Post;
use WordPress\AiClient\AiClient;

class MediaProcessorPromptHooksTest extends TestCase
{
    /**
     * Stored prompt overrides, keyed by prompt id (option vip_workflow_prompts).
     *
     * @var array<string, string>
     */
    private array $prompt_overrides = array();

    protected function setUp(): void
    {
        parent::setUp();

        AiClient::$configured    = true;
        AiClient::$generatedText = 'Generated analysis';
        AiClient::$throwMessage  = null;
        AiClient::$lastPrompt    = '';

        $this->prompt_overrides = array();

        // Temp fixture files live under the system temp dir; treat it as the
        // uploads dir so MediaProcessor::process_file()'s path check accepts them.
        Functions\when( 'wp_get_upload_dir' )->justReturn( array( 'basedir' => sys_get_temp_dir() ) );

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                if ( 'vip_workflow_ai_model' === $option ) {
                    return 'gpt-4o-mini';
                }

                if ( 'vip_workflow_prompts' === $option ) {
                    return $this->prompt_overrides;
                }

                return $default;
            }
        );
        Functions\when( 'update_option' )->alias(
            function ( string $option, $value ) {
                if ( 'vip_workflow_prompts' === $option ) {
                    $this->prompt_overrides = $value;
                }
                return true;
            }
        );
        Functions\when( '_doing_it_wrong' )->justReturn( null );

        // The bootstrap action isn't wired in unit tests, so register the core
        // prompts directly and start from a clean registry/cache each test.
        PromptRegistry::get_instance()->reset();
        PromptSettings::get_instance()->clear_cache();
        CorePrompts::register( PromptRegistry::get_instance() );

        Functions\when( 'apply_filters' )->alias(
            function ( string $tag, $value, ...$args ) {
                if ( 'vip_workflow_ai_image_prompt' === $tag ) {
                    return 'FILTERED IMAGE PROMPT';
                }

                if ( 'vip_workflow_ai_summary_prompt' === $tag ) {
                    return sprintf( 'FILTERED SUMMARY PROMPT (%s)', $args[0] ?? 'unknown' );
                }

                return $value;
            }
        );

        Functions\when( 'get_post' )->alias(
            function ( int $id ) {
                return new WP_Post(
                    array(
                        'ID'        => $id,
                        'post_type' => 'vip_ideation',
                    )
                );
            }
        );
    }

    public function test_media_processor_summary_path_applies_summary_filter(): void
    {
        AiClient::$generatedText = 'Generated summary';

        // summarize_text() is private; invoke via reflection (same approach as the
        // analyze_image_source() coverage below) to unit-test the summary-prompt filter.
        $processor = new MediaProcessor();
        $method    = new \ReflectionMethod( $processor, 'summarize_text' );
        $summary   = $method->invoke( $processor, 'Transcript text', 'transcript' );

        $this->assertSame( 'Generated summary', $summary );
        $this->assertSame( 'FILTERED SUMMARY PROMPT (transcript)', AiClient::$lastPrompt );
    }

    public function test_ideation_controller_image_source_uses_filtered_image_prompt(): void
    {
        $tmp_path = $this->create_temp_file();
        $wpdb     = new class() {
            public array $updates = array();

            public function update( string $table, array $data, array $where ): int
            {
                $this->updates[] = compact( 'table', 'data', 'where' );
                return 1;
            }
        };

        Functions\when( 'get_attached_file' )->justReturn( $tmp_path );
        Functions\when( 'get_post_mime_type' )->justReturn( 'image/jpeg' );

        $source = array(
            'project_id'     => 7,
            'source_id'      => 'source-1',
            'attachment_id'  => 22,
            'ai_analysis'    => '',
        );

        try {
            $controller = ( new \ReflectionClass( IdeationController::class ) )->newInstanceWithoutConstructor();
            $GLOBALS['wpdb'] = $wpdb;
            $invoke = \Closure::bind(
                function ( array $source, string $table ): void {
                    $this->analyze_image_source( $source, $table );
                },
                $controller,
                IdeationController::class
            );

            $invoke( $source, 'wp_vip_ideation_sources' );

            $this->assertSame( 'FILTERED IMAGE PROMPT', AiClient::$lastPrompt );
            $this->assertCount( 1, $wpdb->updates );

            $ai_analysis = json_decode( $wpdb->updates[0]['data']['ai_analysis'], true );
            $this->assertSame( 'Generated analysis', $ai_analysis['summary'] );
            $this->assertSame( 'vision', $ai_analysis['analysis_method'] );
        } finally {
            @unlink( $tmp_path );
        }
    }

    public function test_source_processing_job_image_path_uses_filtered_image_prompt(): void
    {
        $tmp_path = $this->create_temp_file();
        $wpdb     = new class() {
            public string $prefix = 'wp_';
            public string $last_error = '';
            public array $updates = array();

            public function prepare( string $query, string $table, int $project_id, string $source_id ): string
            {
                return $query;
            }

            public function get_row( string $query, string $output ): array
            {
                return array(
                    'project_id'         => 7,
                    'source_id'          => 'source-1',
                    'processing_status'  => 'pending',
                    'attachment_id'      => 22,
                    'file_type'          => 'image/jpeg',
                );
            }

            public function update( string $table, array $data, array $where, array $format = array(), array $where_format = array() ): int
            {
                $this->updates[] = compact( 'table', 'data', 'where' );
                return 1;
            }
        };

        Functions\when( 'get_attached_file' )->justReturn( $tmp_path );
        Functions\when( 'get_post_mime_type' )->justReturn( 'image/jpeg' );

        try {
            $GLOBALS['wpdb'] = $wpdb;

            $job = new SourceProcessingJob();
            $job->process( 7, 'source-1' );

            $this->assertSame( 'FILTERED IMAGE PROMPT', AiClient::$lastPrompt );
            $this->assertCount( 2, $wpdb->updates );
            $final_update = $wpdb->updates[1]['data'];

            $this->assertSame( 'Generated analysis', $final_update['content'] );
            $this->assertSame( 'Generated analysis', $final_update['excerpt'] );

            $ai_analysis = json_decode( $final_update['ai_analysis'], true );
            $this->assertSame( 'Generated analysis', $ai_analysis['summary'] );
            $this->assertSame( 'image', $ai_analysis['type'] );
        } finally {
            @unlink( $tmp_path );
        }
    }

    // --- Prompts resolve through the registry ------------------------------

    /**
     * With no override and a pass-through filter, analyze_image() sends the
     * registry default byte-for-byte.
     */
    public function test_image_default_resolves_byte_identical_through_filter(): void
    {
        Functions\when( 'apply_filters' )->alias( fn( string $tag, $value, ...$args ) => $value );

        $expected = "Analyze this image for editorial research. Provide:\n\n"
            . "DESCRIPTION:\n"
            . "A detailed description of what is shown (people, objects, setting, context).\n\n"
            . "KEY DETAILS:\n"
            . "- Any text visible in the image\n"
            . "- Notable elements or data points\n"
            . "- The mood/tone/style\n\n"
            . "EDITORIAL NOTES:\n"
            . "- How this image might be relevant for research\n"
            . "- Any potential concerns (sensitive content, rights issues)\n\n"
            . 'Be thorough but concise.';

        $tmp_path = $this->create_temp_file();
        try {
            ( new MediaProcessor() )->analyze_image( $tmp_path, 'image/jpeg' );
            $this->assertStringStartsWith( $expected, AiClient::$lastPrompt );
        } finally {
            @unlink( $tmp_path );
        }
    }

    /**
     * With no override and a pass-through filter, process_pdf() sends the
     * registry default byte-for-byte.
     */
    public function test_pdf_default_resolves_byte_identical_through_filter(): void
    {
        Functions\when( 'apply_filters' )->alias( fn( string $tag, $value, ...$args ) => $value );

        $expected = "Analyze this PDF document for editorial research. Provide:\n\n"
            . "SUMMARY:\n"
            . 'A concise 2-3 paragraph summary of the document covering the main points, '
            . "key findings, and conclusions.\n\n"
            . "EXTRACTED TEXT:\n"
            . "The full text content of the document, preserving structure and headings where possible.\n\n"
            . "Write the labels SUMMARY: and EXTRACTED TEXT: exactly as shown, on their own "
            . "lines, not as markdown headings.\n\n"
            . 'Be thorough and accurate.';

        $tmp_path = $this->create_temp_file();
        try {
            ( new MediaProcessor() )->process_pdf( $tmp_path, 'application/pdf' );
            $this->assertStringStartsWith( $expected, AiClient::$lastPrompt );
        } finally {
            @unlink( $tmp_path );
        }
    }

    /**
     * With no override and a pass-through filter, summarize_text() sends the
     * registry instruction plus the appended content byte-for-byte.
     */
    public function test_summary_default_resolves_byte_identical_through_filter(): void
    {
        Functions\when( 'apply_filters' )->alias( fn( string $tag, $value, ...$args ) => $value );
        AiClient::$generatedText = 'Generated summary';

        $instruction = 'Summarize this transcript in 2-3 concise paragraphs. '
            . 'Focus on the key points, main topics, and important conclusions or insights.';

        $processor = new MediaProcessor();
        $method    = new \ReflectionMethod( $processor, 'summarize_text' );
        $method->invoke( $processor, 'Transcript text', 'transcript' );

        // The call site appends the content after the resolved instruction, and
        // resolution appends the markdown output contract to that instruction — so
        // the contract lands between the two rather than at the end. Both halves
        // must still be present and in order.
        $this->assertStringStartsWith( $instruction, AiClient::$lastPrompt );
        $this->assertStringEndsWith( "Content:\nTranscript text", AiClient::$lastPrompt );
    }

    /**
     * An admin override flows through (with {content_type} substituted) and the
     * existing filter still post-processes it with its $content_type argument.
     */
    public function test_summary_override_flows_through_and_filter_receives_content_type(): void
    {
        PromptSettings::get_instance()->set_override(
            'media/text-summary',
            'Custom {content_type} summary instruction.'
        );

        $filter_args = array();
        Functions\when( 'apply_filters' )->alias(
            function ( string $tag, $value, ...$args ) use ( &$filter_args ) {
                if ( 'vip_workflow_ai_summary_prompt' === $tag ) {
                    $filter_args = $args;
                }
                return $value;
            }
        );

        $processor = new MediaProcessor();
        $method    = new \ReflectionMethod( $processor, 'summarize_text' );
        $method->invoke( $processor, 'Video transcript text', 'video transcript' );

        $this->assertStringStartsWith( 'Custom video transcript summary instruction.', AiClient::$lastPrompt );
        $this->assertStringEndsWith( "Content:\nVideo transcript text", AiClient::$lastPrompt );
        $this->assertSame( array( 'video transcript' ), $filter_args );
    }

    /**
     * The content-type variable is substituted distinctly per call.
     */
    public function test_summary_content_type_variable_substituted(): void
    {
        Functions\when( 'apply_filters' )->alias( fn( string $tag, $value, ...$args ) => $value );

        $processor = new MediaProcessor();
        $method    = new \ReflectionMethod( $processor, 'summarize_text' );

        $method->invoke( $processor, 'x', 'audio transcript' );
        $this->assertStringStartsWith( 'Summarize this audio transcript in', AiClient::$lastPrompt );

        $method->invoke( $processor, 'x', 'video transcript' );
        $this->assertStringStartsWith( 'Summarize this video transcript in', AiClient::$lastPrompt );
    }

    /**
     * IdeationController's source image analysis resolves its
     * (distinct, shorter) default through the registry, then the filter.
     */
    public function test_ideation_source_image_default_resolves_through_registry(): void
    {
        Functions\when( 'apply_filters' )->alias( fn( string $tag, $value, ...$args ) => $value );

        $tmp_path = $this->create_temp_file();
        $wpdb     = new class() {
            public array $updates = array();
            public function update( string $table, array $data, array $where ): int
            {
                $this->updates[] = compact( 'table', 'data', 'where' );
                return 1;
            }
        };

        Functions\when( 'get_attached_file' )->justReturn( $tmp_path );
        Functions\when( 'get_post_mime_type' )->justReturn( 'image/jpeg' );

        try {
            $controller      = ( new \ReflectionClass( IdeationController::class ) )->newInstanceWithoutConstructor();
            $GLOBALS['wpdb'] = $wpdb;
            $invoke          = \Closure::bind(
                function ( array $source, string $table ): void {
                    $this->analyze_image_source( $source, $table );
                },
                $controller,
                IdeationController::class
            );

            $invoke( array( 'project_id' => 7, 'source_id' => 'source-1', 'attachment_id' => 22, 'ai_analysis' => '' ), 'wp_vip_ideation_sources' );

            $this->assertStringStartsWith(
                'Analyze this image for editorial research. Describe what is shown, any text visible, and key details relevant for journalism/editorial use. Be thorough.',
                AiClient::$lastPrompt
            );
        } finally {
            @unlink( $tmp_path );
        }
    }

    /**
     * Proves the call site actually resolves through the registry (not an inline
     * literal): an admin override for the prompt id flows to the AI request.
     * Reverting analyze_image_source() to a hardcoded string would fail this.
     */
    public function test_ideation_source_image_override_flows_through_registry(): void
    {
        Functions\when( 'apply_filters' )->alias( fn( string $tag, $value, ...$args ) => $value );
        PromptSettings::get_instance()->set_override( 'ideation/image-source-analysis', 'Custom source-image instruction.' );

        $tmp_path = $this->create_temp_file();
        $wpdb     = new class() {
            public array $updates = array();
            public function update( string $table, array $data, array $where ): int
            {
                $this->updates[] = compact( 'table', 'data', 'where' );
                return 1;
            }
        };

        Functions\when( 'get_attached_file' )->justReturn( $tmp_path );
        Functions\when( 'get_post_mime_type' )->justReturn( 'image/jpeg' );

        try {
            $controller      = ( new \ReflectionClass( IdeationController::class ) )->newInstanceWithoutConstructor();
            $GLOBALS['wpdb'] = $wpdb;
            $invoke          = \Closure::bind(
                function ( array $source, string $table ): void {
                    $this->analyze_image_source( $source, $table );
                },
                $controller,
                IdeationController::class
            );

            $invoke( array( 'project_id' => 7, 'source_id' => 'source-1', 'attachment_id' => 22, 'ai_analysis' => '' ), 'wp_vip_ideation_sources' );

            $this->assertStringStartsWith( 'Custom source-image instruction.', AiClient::$lastPrompt );
        } finally {
            @unlink( $tmp_path );
        }
    }

    private function create_temp_file(): string
    {
        $path = tempnam( sys_get_temp_dir(), 'vipwf-' );
        file_put_contents( $path, 'test' );

        return $path;
    }
}
}
