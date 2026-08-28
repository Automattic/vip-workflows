<?php
/**
 * Regression tests for MediaProcessor.
 *
 * Targets pure helpers and dispatch behavior. AiClient-backed code paths
 * (image vision, PDF processing, transcription, summarization) are out of
 * scope here — they require integration-level fakes for the AiClient
 * static facade.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Integrations\MediaProcessor;
use WP_Error;

/**
 * @group media-processor
 */
class MediaProcessorTest extends TestCase
{
    private MediaProcessor $processor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->processor = new MediaProcessor();
    }

    /**
     * @test
     * The static MAX_WHISPER_SIZE constant is part of the public API and
     * must stay at 25MB to match the OpenAI Whisper limit.
     */
    public function max_whisper_size_is_25mb(): void
    {
        $this->assertSame( 25 * 1024 * 1024, MediaProcessor::MAX_WHISPER_SIZE );
    }

    /**
     * @test
     * Documented mime-type catalog. Locks in the four supported groups
     * and their canonical mime-type lists.
     */
    public function get_supported_types_returns_documented_groups(): void
    {
        $supported = MediaProcessor::get_supported_types();

        $this->assertSame(
            array( 'image', 'audio', 'video', 'document' ),
            array_keys( $supported )
        );

        $this->assertContains( 'image/jpeg', $supported['image'] );
        $this->assertContains( 'image/png', $supported['image'] );
        $this->assertContains( 'image/gif', $supported['image'] );
        $this->assertContains( 'image/webp', $supported['image'] );

        $this->assertContains( 'audio/mpeg', $supported['audio'] );
        $this->assertContains( 'audio/wav', $supported['audio'] );

        $this->assertContains( 'video/mp4', $supported['video'] );
        $this->assertContains( 'video/webm', $supported['video'] );

        $this->assertSame( array( 'application/pdf' ), $supported['document'] );
    }

    /**
     * @test
     * is_supported() returns true only for mime types in get_supported_types().
     */
    public function is_supported_returns_true_for_known_mime_types(): void
    {
        $this->assertTrue( MediaProcessor::is_supported( 'image/jpeg' ) );
        $this->assertTrue( MediaProcessor::is_supported( 'audio/mpeg' ) );
        $this->assertTrue( MediaProcessor::is_supported( 'video/mp4' ) );
        $this->assertTrue( MediaProcessor::is_supported( 'application/pdf' ) );
    }

    /**
     * @test
     * Unknown mime types return false.
     */
    public function is_supported_returns_false_for_unknown_mime_types(): void
    {
        $this->assertFalse( MediaProcessor::is_supported( 'text/plain' ) );
        $this->assertFalse( MediaProcessor::is_supported( 'application/zip' ) );
        $this->assertFalse( MediaProcessor::is_supported( '' ) );
    }

    /**
     * @test
     * get_source_type() maps mime prefixes to the documented type slug.
     */
    public function get_source_type_maps_known_prefixes(): void
    {
        $this->assertSame( 'image', MediaProcessor::get_source_type( 'image/jpeg' ) );
        $this->assertSame( 'image', MediaProcessor::get_source_type( 'image/heic' ) ); // prefix match
        $this->assertSame( 'audio', MediaProcessor::get_source_type( 'audio/wav' ) );
        $this->assertSame( 'video', MediaProcessor::get_source_type( 'video/quicktime' ) );
        $this->assertSame( 'document', MediaProcessor::get_source_type( 'application/pdf' ) );
    }

    /**
     * @test
     * Unknown mimes fall through to 'document'. This was the documented
     * default before the refactor.
     */
    public function get_source_type_falls_back_to_document_for_unknown_mimes(): void
    {
        $this->assertSame( 'document', MediaProcessor::get_source_type( 'text/plain' ) );
        $this->assertSame( 'document', MediaProcessor::get_source_type( 'application/zip' ) );
        $this->assertSame( 'document', MediaProcessor::get_source_type( '' ) );
    }

    /**
     * @test
     * transcribe_audio_video() refuses files larger than the 25MB Whisper
     * limit with a WP_Error coded `file_too_large` — the wording is
     * MediaProcessor's own ("File is too large…").
     */
    public function transcribe_audio_video_rejects_files_over_25mb(): void
    {
        $tmp_path = $this->create_sparse_file( 26 * 1024 * 1024 );

        try {
            $result = $this->processor->transcribe_audio_video( $tmp_path );

            $this->assertInstanceOf( WP_Error::class, $result );
            $this->assertSame( 'file_too_large', $result->get_error_code() );
            $this->assertStringContainsString( '25', $result->get_error_message() );
        } finally {
            @unlink( $tmp_path );
        }
    }

    /**
     * Create a sparse file at the requested logical size.
     */
    private function create_sparse_file( int $size_bytes ): string
    {
        $path = tempnam( sys_get_temp_dir(), 'vipwf-' );
        $fp   = fopen( $path, 'w' );
        fseek( $fp, $size_bytes - 1 );
        fwrite( $fp, "\0" );
        fclose( $fp );
        return $path;
    }
}
