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

use Brain\Monkey\Functions;
use VIPWorkflows\Abilities\Requirement;
use VIPWorkflows\AI\ConnectorsCredentialBackend;
use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\AI\LegacyCredentialBackend;
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
     * @test
     * Transcription is available whenever an OpenAI key resolves, even when it
     * comes only from the `VIP_WORKFLOWS_OPENAI_KEY` constant and the backend
     * holds nothing. The unit bootstrap defines that constant, so the keyless
     * case is covered by the integration suite, where it is not defined.
     */
    public function transcription_is_available_with_only_the_openai_constant(): void
    {
        $this->assertTrue( defined( 'VIP_WORKFLOWS_OPENAI_KEY' ) );

        Credentials::get_instance()->set_backend(
            new class() implements CredentialBackend {
                public function get_api_key( string $service ): string
                {
                    return '';
                }
            }
        );

        try {
            $this->assertTrue( MediaProcessor::transcription_available() );
        } finally {
            Credentials::get_instance()->set_backend( null );
        }
    }

    /**
     * @test
     * An administrator on the Connectors backend is told where the key goes,
     * in the words every other missing-credential gate uses.
     */
    public function transcription_unavailable_message_sends_an_administrator_to_connectors(): void
    {
        Functions\when( 'admin_url' )->alias(
            static fn( string $path = '' ): string => 'https://example.test/wp-admin/' . $path
        );
        Functions\when( 'current_user_can' )->justReturn( true );
        Credentials::get_instance()->set_backend( new ConnectorsCredentialBackend() );

        try {
            $this->assert_copy(
                'OpenAI transcribes audio and video. OpenAI is not connected. Add its API key in Settings → Connectors.',
                MediaProcessor::transcription_unavailable_message()
            );
        } finally {
            Credentials::get_instance()->set_backend( null );
        }
    }

    /**
     * @test
     * An install with no credential screen names the constant instead, and the
     * longest variant still fits the copy standard's ceiling.
     */
    public function transcription_unavailable_message_names_the_constant_without_a_credential_screen(): void
    {
        Functions\when( 'current_user_can' )->justReturn( true );
        Credentials::get_instance()->set_backend( new LegacyCredentialBackend() );

        try {
            $this->assert_copy(
                'OpenAI transcribes audio and video. OpenAI is not connected. Set the VIP_WORKFLOWS_OPENAI_KEY constant in wp-config.php.',
                MediaProcessor::transcription_unavailable_message()
            );
        } finally {
            Credentials::get_instance()->set_backend( null );
        }
    }

    /**
     * @test
     * A reader who cannot reach either is told who can fix it, never a screen,
     * whichever backend is installed.
     */
    public function transcription_unavailable_message_sends_an_editor_to_an_administrator(): void
    {
        Functions\when( 'admin_url' )->alias(
            static fn( string $path = '' ): string => 'https://example.test/wp-admin/' . $path
        );
        Functions\when( 'current_user_can' )->justReturn( false );
        Credentials::get_instance()->set_backend( new ConnectorsCredentialBackend() );

        try {
            $this->assert_copy(
                'OpenAI transcribes audio and video. OpenAI is not connected. Ask an administrator to connect it.',
                MediaProcessor::transcription_unavailable_message()
            );
        } finally {
            Credentials::get_instance()->set_backend( null );
        }
    }

    /**
     * @test
     * A caller with no current user, such as the job, names the register
     * itself rather than being silently given one.
     */
    public function transcription_unavailable_message_takes_an_explicit_register(): void
    {
        Functions\expect( 'current_user_can' )->never();
        Credentials::get_instance()->set_backend( new LegacyCredentialBackend() );

        try {
            $this->assert_copy(
                'OpenAI transcribes audio and video. OpenAI is not connected. Ask an administrator to connect it.',
                MediaProcessor::transcription_unavailable_message( Requirement::REGISTER_USER )
            );
        } finally {
            Credentials::get_instance()->set_backend( null );
        }
    }

    /**
     * @test
     * Audio and video are transcribed; nothing else is.
     */
    public function needs_transcription_is_audio_and_video_only(): void
    {
        $this->assertTrue( MediaProcessor::needs_transcription( 'audio/mpeg' ) );
        $this->assertTrue( MediaProcessor::needs_transcription( 'video/mp4' ) );
        $this->assertFalse( MediaProcessor::needs_transcription( 'image/png' ) );
        $this->assertFalse( MediaProcessor::needs_transcription( 'application/pdf' ) );
        $this->assertFalse( MediaProcessor::needs_transcription( '' ) );
    }

    /**
     * Assert the exact message, and that it fits the copy standard's ceiling.
     */
    private function assert_copy( string $expected, string $actual ): void
    {
        $this->assertSame( $expected, $actual );
        $this->assertLessThanOrEqual( 120, mb_strlen( $actual ) );
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
