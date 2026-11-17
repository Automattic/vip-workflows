<?php
/**
 * Audio and video uploads on a site with no OpenAI key.
 *
 * Audio and video sources are transcribed by OpenAI whatever provider the site
 * selected. Without an OpenAI key the upload route refuses them up front
 * instead of storing the file, queueing the job and failing it later. Images,
 * PDFs and documents must behave exactly as before, whatever the key state.
 *
 * Integration rather than unit because the claims are about the real upload
 * path: `wp_check_filetype_and_ext()` resolving the file's type from its
 * contents, `media_handle_upload()` creating (or not creating) an attachment,
 * the row in `vip_ideation_sources`, and the Action Scheduler job. No key
 * constant is defined in this suite, so the keyless case is reachable here and
 * not in the unit suite.
 *
 * The routes are registered directly onto the server this test builds; the
 * ideation experiment gate that wires them in production is not under test.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Admin\IdeationAdmin;
use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\API\IdeationSourcesController;
use VIPWorkflows\Ideation\Research\IdeationPostTypes;
use VIPWorkflows\Integrations\MediaProcessor;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

require_once dirname( __DIR__ ) . '/fixtures/transcription-upload.php';

/**
 * @covers \VIPWorkflows\API\IdeationSourcesController::upload_source
 * @covers \VIPWorkflows\Integrations\MediaProcessor::transcription_available
 */
class IdeationSourcesTranscriptionGuardTest extends TestCase
{
    private const MESSAGE = 'Audio and video need an OpenAI key for transcription. Ask an administrator to add one.';

    private const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private int $project_id;

    /**
     * Temporary files this test wrote.
     *
     * @var string[]
     */
    private array $temp_files = array();

    /**
     * Outbound requests attempted, which must be none in every test here.
     *
     * @var string[]
     */
    private array $fetched = array();

    public function set_up(): void
    {
        parent::set_up();

        $this->assertFalse(
            defined( 'VIP_WORKFLOWS_OPENAI_KEY' ),
            'A defined key constant outranks every backend, so it would make the keyless cases unreachable.'
        );

        $this->use_backend( array() );

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

        $this->project_id = self::factory()->post->create(
            array(
                'post_type'   => IdeationPostTypes::POST_TYPE,
                'post_title'  => 'Transcription guard',
                'post_author' => get_current_user_id(),
            )
        );

        /*
         * The files here were never really uploaded, so core's
         * is_uploaded_file() test and move_uploaded_file() would refuse them.
         * The test adapter selects a custom action, using is_readable()
         * for the first, and this filter copies instead of moving; every other check
         * media_handle_upload() makes still runs. The adapter never overrides MIME
         * detection or the route's refusal.
         */
        add_filter(
            'vip_transcription_fixture_overrides',
            static fn( $overrides ) => array_merge( (array) $overrides, array( 'test_form' => false ) )
        );
        add_filter(
            'pre_move_uploaded_file',
            static fn( $move, $file, $new_file ) => copy( $file['tmp_name'], $new_file ),
            10,
            3
        );

        add_filter(
            'pre_http_request',
            function ( $preempt, $args, $url ) {
                $this->fetched[] = (string) $url;

                return new WP_Error( 'http_request_blocked', 'No network in this test.' );
            },
            10,
            3
        );

        $GLOBALS['wp_rest_server'] = null;
        rest_get_server();
        ( new IdeationSourcesController() )->register_routes();
    }

    public function tear_down(): void
    {
        $GLOBALS['wp_rest_server'] = null;
        unset( $_FILES['file'] );

        foreach ( $this->temp_files as $path ) {
            if ( file_exists( $path ) ) {
                unlink( $path );
            }
        }

        foreach ( get_posts( array( 'post_type' => 'attachment', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids' ) ) as $attachment_id ) {
            wp_delete_attachment( (int) $attachment_id, true );
        }

        Credentials::get_instance()->set_backend( null );
        delete_option( 'vip_workflows_ai_provider' );

        parent::tear_down();
    }

    /* ---------------------------------------------------------------------
     * Fixtures
     * ------------------------------------------------------------------ */

    /**
     * Install a backend holding the given keys.
     *
     * @param array<string, string> $keys Service id => key.
     */
    private function use_backend( array $keys ): void
    {
        Credentials::get_instance()->set_backend(
            new class( $keys ) implements CredentialBackend {
                /**
                 * @param array<string, string> $keys Service id => key.
                 */
                public function __construct( private array $keys ) {}

                public function get_api_key( string $service ): string
                {
                    return $this->keys[ $service ] ?? '';
                }
            }
        );
    }

    /**
     * Bytes that file's content sniffing reads as each type.
     *
     * @param string $kind mp3|mp4|png|pdf.
     * @return string File contents.
     */
    private static function bytes( string $kind ): string
    {
        switch ( $kind ) {
            case 'mp3':
                return "ID3\x03\x00\x00\x00\x00\x00\x00" . "\xFF\xFB\x90\x64" . str_repeat( "\x00", 400 );
            case 'mp4':
                return "\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41" . str_repeat( "\x00", 400 );
            case 'png':
                // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- fixture bytes.
                return (string) base64_decode( self::PNG_BASE64 );
            case 'pdf':
                return "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
        }

        throw new \InvalidArgumentException( $kind );
    }

    /**
     * Upload a file through the REST route, as the browser does.
     *
     * @param string $name        File name, which decides the extension.
     * @param string $bytes       File contents.
     * @param string $client_type The type the client claims.
     * @return WP_REST_Response
     */
    private function upload( string $name, string $bytes, string $client_type, int $error = UPLOAD_ERR_OK ): WP_REST_Response
    {
        $tmp                = wp_tempnam( $name );
        $this->temp_files[] = $tmp;
        file_put_contents( $tmp, $bytes ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents

        $file = array(
            'name'     => $name,
            'type'     => $client_type,
            'tmp_name' => $tmp,
            'error'    => $error,
            'size'     => strlen( $bytes ),
            '_transcription_fixture' => true,
        );

        // media_handle_upload() reads $_FILES; the route's own guard reads the request.
        $_FILES['file'] = $file;

        $request = new WP_REST_Request( 'POST', '/vip-workflows/v1/ideation/' . $this->project_id . '/sources/upload' );
        $request->set_file_params( array( 'file' => $file ) );

        return rest_get_server()->dispatch( $request );
    }

    private function row_count(): int
    {
        global $wpdb;

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        return (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(*) FROM {$wpdb->prefix}vip_ideation_sources WHERE project_id = %d",
                $this->project_id
            )
        );
    }

    private function attachment_count(): int
    {
        return count(
            get_posts(
                array(
                    'post_type'   => 'attachment',
                    'post_status' => 'any',
                    'numberposts' => -1,
                    'fields'      => 'ids',
                )
            )
        );
    }

    private function assert_refused_untouched( WP_REST_Response $response ): void
    {
        $this->assertSame( 422, $response->get_status() );
        $this->assertSame( 'rest_transcription_unavailable', $response->get_data()['code'] ?? null );
        $this->assertSame( self::MESSAGE, $response->get_data()['message'] ?? null );
        $this->assertSame( 0, $this->attachment_count(), 'An attachment was created for a refused upload.' );
        $this->assertSame( 0, $this->row_count(), 'A source row was written for a refused upload.' );
        $this->assertFalse(
            as_has_scheduled_action( 'vip_workflows_process_source', null, 'vip-workflows' ),
            'A processing job was queued for a refused upload.'
        );
    }

    private function assert_accepted_and_queued( WP_REST_Response $response, string $mime_prefix ): void
    {
        $this->assertSame( 201, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );

        $data = $response->get_data();
        $this->assertSame( 'pending', $data['processing_status'] ?? null );
        $this->assertStringStartsWith( $mime_prefix, (string) ( $data['file_type'] ?? '' ) );
        $this->assertSame( 1, $this->row_count() );
        $this->assertTrue(
            as_has_scheduled_action(
                'vip_workflows_process_source',
                array( $this->project_id, $data['source_id'] ),
                'vip-workflows'
            )
        );
    }

    /* ---------------------------------------------------------------------
     * The refusal
     * ------------------------------------------------------------------ */

    public function test_audio_without_an_openai_key_is_refused_before_upload(): void
    {
        $this->assert_refused_untouched( $this->upload( 'song.mp3', self::bytes( 'mp3' ), 'audio/mpeg' ) );
        $this->assertSame( array(), $this->fetched );
    }

    public function test_video_without_an_openai_key_is_refused_before_upload(): void
    {
        $this->assert_refused_untouched( $this->upload( 'clip.mp4', self::bytes( 'mp4' ), 'video/mp4' ) );
    }

    /**
     * The selected provider doesn't transcribe, so a working Anthropic setup
     * doesn't make audio acceptable.
     */
    public function test_a_keyed_non_openai_provider_does_not_make_audio_acceptable(): void
    {
        $this->use_backend( array( 'anthropic' => 'sk-ant-test' ) );
        update_option( 'vip_workflows_ai_provider', 'anthropic' );

        $this->assert_refused_untouched( $this->upload( 'song.mp3', self::bytes( 'mp3' ), 'audio/mpeg' ) );
    }

    /**
     * The guard asks WordPress what the file is, not the client: an audio file
     * that claims to be an image is still refused.
     */
    public function test_audio_claiming_an_image_type_is_still_refused(): void
    {
        $this->assert_refused_untouched( $this->upload( 'song.mp3', self::bytes( 'mp3' ), 'image/png' ) );
    }

    public function test_audio_with_an_openai_key_is_accepted_and_queued(): void
    {
        $this->use_backend( array( 'openai' => 'sk-test' ) );

        $this->assert_accepted_and_queued(
            $this->upload( 'song.mp3', self::bytes( 'mp3' ), 'audio/mpeg' ),
            'audio/'
        );
        $this->assertSame( array(), $this->fetched, 'Uploading only queues the job; nothing is sent yet.' );
    }

    /* ---------------------------------------------------------------------
     * Images and PDFs: unchanged
     * ------------------------------------------------------------------ */

    /**
     * The regression this change must not cause: on a keyless site whose
     * selected provider works, images and PDFs upload and queue as before.
     *
     * @dataProvider provide_non_transcribed_files
     *
     * @param string $name        File name.
     * @param string $kind        Fixture kind.
     * @param string $client_type Type the client claims.
     * @param string $mime_prefix Expected stored type prefix.
     */
    public function test_images_and_pdfs_upload_as_before_without_an_openai_key( string $name, string $kind, string $client_type, string $mime_prefix ): void
    {
        $this->use_backend( array( 'anthropic' => 'sk-ant-test' ) );
        update_option( 'vip_workflows_ai_provider', 'anthropic' );

        $this->assert_accepted_and_queued( $this->upload( $name, self::bytes( $kind ), $client_type ), $mime_prefix );
    }

    public static function provide_non_transcribed_files(): array
    {
        return array(
            'png' => array( 'photo.png', 'png', 'image/png', 'image/' ),
            'pdf' => array( 'report.pdf', 'pdf', 'application/pdf', 'application/pdf' ),
        );
    }

    /**
     * The client-sent type is ignored in both directions: an image that
     * claims to be audio is still an image, and is accepted.
     */
    public function test_an_image_claiming_an_audio_type_is_accepted(): void
    {
        $this->assert_accepted_and_queued( $this->upload( 'photo.png', self::bytes( 'png' ), 'audio/mpeg' ), 'image/' );
    }

    /**
     * Image bytes under an `.mp3` name don't resolve to any type, so the guard
     * leaves the file to media_handle_upload(), which refuses it with core's
     * own type error, as it did before this change.
     */
    public function test_a_file_whose_contents_contradict_its_name_gets_cores_refusal(): void
    {
        $response = $this->upload( 'photo.mp3', self::bytes( 'png' ), 'audio/mpeg' );

        $this->assertSame( 400, $response->get_status() );
        $this->assertNotSame( 'rest_transcription_unavailable', $response->get_data()['code'] ?? null );
        $this->assertSame( 0, $this->row_count() );
    }

    /* ---------------------------------------------------------------------
     * The shared answer
     * ------------------------------------------------------------------ */

    public function test_transcription_availability_follows_the_openai_key_alone(): void
    {
        $this->assertFalse( MediaProcessor::transcription_available() );

        $this->use_backend( array( 'anthropic' => 'sk-ant-test' ) );
        update_option( 'vip_workflows_ai_provider', 'anthropic' );
        $this->assertFalse( MediaProcessor::transcription_available(), 'The selected provider must not count.' );

        $this->use_backend( array( 'openai' => 'sk-test', 'anthropic' => 'sk-ant-test' ) );
        $this->assertTrue( MediaProcessor::transcription_available(), 'An OpenAI key counts whatever provider is selected.' );
    }

    /**
     * The job keeps its own check, so a file that reaches it without a key
     * fails with the same sentence and nothing is sent.
     */
    public function test_the_job_fails_a_keyless_transcription_with_the_shared_sentence(): void
    {
        $path               = wp_tempnam( 'song.mp3' );
        $this->temp_files[] = $path;
        file_put_contents( $path, self::bytes( 'mp3' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents

        $result = ( new MediaProcessor() )->transcribe_audio_video( $path );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'no_api_key', $result->get_error_code() );
        $this->assertSame( self::MESSAGE, $result->get_error_message() );
        $this->assertSame( array(), $this->fetched );
    }

    /**
     * The Ideation screen reads the same answer. `wp_localize_script()` casts
     * top-level booleans to strings, so the page receives '1' or ''.
     */
    public function test_the_ideation_screen_is_told_whether_transcription_is_available(): void
    {
        $this->assertSame( '', $this->localized_transcription_flag() );

        $this->use_backend( array( 'openai' => 'sk-test' ) );
        $this->assertSame( '1', $this->localized_transcription_flag() );
    }


    /** A genuine capability bypass, as used by sites allowing unfiltered uploads. */
    private function allow_unfiltered_upload(): void
    {
        add_filter( 'map_meta_cap', static function ( $caps, $cap ) {
            return 'unfiltered_upload' === $cap ? array( 'exist' ) : $caps;
        }, 10, 2 );
        $this->assertTrue( current_user_can( 'unfiltered_upload' ) );
    }

    public function test_unfiltered_mp4_named_png_is_refused_before_storage(): void
    {
        $this->allow_unfiltered_upload();
        $response = $this->upload( 'clip.png', self::bytes( 'mp4' ), 'video/mp4' );
        if ( 201 === $response->get_status() ) {
            $this->assert_accepted_and_queued( $response, 'video/' );
            $data = $response->get_data();
            $result = ( new MediaProcessor() )->transcribe_audio_video( get_attached_file( $data['attachment_id'] ) );
            $this->assertSame( 'no_api_key', $result->get_error_code() );
            $this->assertSame( array(), $this->fetched );
        }
        $this->assert_refused_untouched( $response );
    }

    public function test_unfiltered_png_named_mp4_is_refused_before_storage(): void
    {
        $this->allow_unfiltered_upload();
        $response = $this->upload( 'image.mp4', self::bytes( 'png' ), 'video/mp4' );
        if ( 201 === $response->get_status() ) {
            $this->assert_accepted_and_queued( $response, 'video/' );
        }
        $this->assert_refused_untouched( $response );
    }

    /** @dataProvider provide_names */
    public function test_media_names_are_refused( string $name, string $kind ): void
    {
        $this->assert_refused_untouched( $this->upload( $name, self::bytes( $kind ), 'image/png' ) );
    }

    public static function provide_names(): array
    {
        return array(
            array( 'song.MP3', 'mp3' ),
            array( 'clip.mov', 'mp4' ),
            array( 'sound.m4a', 'mp3' ),
            array( 'sound.wav', 'mp3' ),
            array( 'sound.ogg', 'mp3' ),
            array( 'clip.webm', 'mp4' ),
            array( 'clip.3gp', 'mp4' ),
        );
    }

    /** @dataProvider provide_mismatches */
    public function test_mismatch_is_a_core_400_for_an_editor( string $name, string $kind ): void
    {
        $response = $this->upload( $name, self::bytes( $kind ), 'video/mp4' );
        $this->assertSame( 400, $response->get_status(), wp_json_encode( $response->get_data() ) );
        $this->assertSame( 0, $this->row_count() );
    }

    public static function provide_mismatches(): array
    {
        return array( array( 'clip.png', 'mp4' ), array( 'clip.pdf', 'mp4' ),
            array( 'photo.mp4', 'png' ), array( 'song.mp3.png', 'mp3' ) );
    }

    public function test_upload_mimes_audio_extension_is_refused(): void
    {
        add_filter( 'upload_mimes', static fn( $mimes ) => array_merge( $mimes, array( 'customaudio' => 'audio/mpeg' ) ) );
        $this->assert_refused_untouched( $this->upload( 'song.customaudio', self::bytes( 'mp3' ), 'image/png' ) );
    }

    public function test_binary_mp4_is_refused(): void
    {
        $this->assert_refused_untouched( $this->upload( 'clip.mp4', str_repeat( "\x00", 100 ), 'video/mp4' ) );
    }

    public function test_empty_mp3_keeps_the_core_400(): void
    {
        $response = $this->upload( 'empty.mp3', '', 'audio/mpeg' );
        $this->assertSame( 400, $response->get_status() );
    }

    /** @dataProvider provide_transport_errors */
    public function test_transport_error_never_stores_media( int $error ): void
    {
        $response = $this->upload( 'transport.mp3', self::bytes( 'mp3' ), 'audio/mpeg', $error );
        if ( 201 === $response->get_status() ) {
            $this->assert_accepted_and_queued( $response, 'audio/mpeg' );
            $this->assertSame( 1, $this->attachment_count() );
        }
        $this->assertNotSame( 201, $response->get_status(), wp_json_encode( $response->get_data() ) );
        $this->assertSame( 0, $this->attachment_count() );
        $this->assertSame( 0, $this->row_count() );
        $this->assertFalse( as_has_scheduled_action( 'vip_workflows_process_source', null, 'vip-workflows' ) );
    }

    public static function provide_transport_errors(): array
    {
        return array_map( static fn( $error ) => array( $error ), array( 1, 2, 3, 4, 6, 7, 8, -1, -7 ) );
    }

    /** @dataProvider provide_unfiltered_nonmedia */
    public function test_unfiltered_nonmedia_preserves_core_type( string $name, string $kind, string $client, string $stored ): void
    {
        $this->allow_unfiltered_upload();
        $this->assert_accepted_and_queued( $this->upload( $name, self::bytes( $kind ), $client ), $stored );
    }

    public static function provide_unfiltered_nonmedia(): array
    {
        return array(
            array( 'photo.png', 'png', 'video/mp4', 'image/png' ),
            array( 'report.pdf', 'pdf', 'audio/mpeg', 'application/pdf' ),
            array( 'photo.unknown', 'png', 'image/png', 'image/png' ),
            array( 'report.unknown', 'pdf', 'application/pdf', 'application/pdf' ),
            array( 'photo.mp4', 'png', 'image/png', 'image/png' ),
            array( 'report.mp3', 'pdf', 'application/pdf', 'application/pdf' ),
        );
    }

    /** @dataProvider provide_sanitized_media_types */
    public function test_unfiltered_sanitized_media_is_refused( string $client ): void
    {
        $this->allow_unfiltered_upload();
        $this->use_backend( array( 'anthropic' => 'sk-ant-test' ) );
        update_option( 'vip_workflows_ai_provider', 'anthropic' );
        $response = $this->upload( 'clip.unknown', self::bytes( 'mp4' ), $client );
        if ( 201 === $response->get_status() ) {
            $this->assert_accepted_and_queued( $response, sanitize_mime_type( $client ) );
            $data = $response->get_data();
            $result = ( new MediaProcessor() )->transcribe_audio_video( get_attached_file( $data['attachment_id'] ) );
            $this->assertWPError( $result );
            $this->assertSame( 'no_api_key', $result->get_error_code() );
            $this->assertSame( self::MESSAGE, $result->get_error_message() );
            $this->assertSame( array(), $this->fetched );
        }
        $this->assert_refused_untouched( $response );
    }

    public static function provide_sanitized_media_types(): array
    {
        return array( array( 'vi deo/mp4' ), array( 'au dio/mpeg' ), array( ' video/mp4' ), array( 'video/mp4' ), array( 'audio/mpeg' ) );
    }

    public function test_partial_audio_keeps_the_core_400(): void
    {
        $response = $this->upload( 'partial.mp3', self::bytes( 'mp3' ), 'audio/mpeg', UPLOAD_ERR_PARTIAL );
        $this->assertSame( 400, $response->get_status() );
    }

    /** @dataProvider provide_other_files */
    public function test_other_uploads_still_queue( string $name, string $fixture, string $mime ): void
    {
        $bytes = 'plain text' === $fixture ? 'A source document.' : file_get_contents( DIR_TESTDATA . '/images/' . $fixture );
        $this->assert_accepted_and_queued( $this->upload( $name, $bytes, $mime ), $mime );
    }

    public static function provide_other_files(): array
    {
        return array(
            array( 'photo.jpg', 'test-image.jpg', 'image/jpeg' ),
            array( 'photo.webp', 'test-image.webp', 'image/webp' ),
            array( 'photo.gif', 'test-image.gif', 'image/gif' ),
            array( 'notes.txt', 'plain text', 'text/plain' ),
        );
    }

    public function test_docx_still_queues(): void
    {
        $path = wp_tempnam( 'review.docx' );
        $this->temp_files[] = $path;
        $zip = new \ZipArchive();
        $zip->open( $path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE );
        $zip->addFromString( '[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' );
        $zip->addFromString( 'word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Source</w:t></w:r></w:p></w:body></w:document>' );
        $zip->close();
        $mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        $this->assert_accepted_and_queued( $this->upload( 'source.docx', file_get_contents( $path ), $mime ), $mime );
    }

    /** @dataProvider provide_keys */
    public function test_real_backends_and_job_agree( string $backend, string $key ): void
    {
        $credentials = Credentials::get_instance();
        $env_name = '';
        if ( 'legacy' === $backend ) {
            $iv = str_repeat( 'a', 16 );
            $encrypted = base64_encode( $iv . openssl_encrypt( $key, 'aes-256-cbc', wp_salt( 'auth' ), OPENSSL_RAW_DATA, $iv ) );
            update_option( 'vip_workflows_api_keys', array( 'openai_key' => $encrypted ) );
            $credentials->set_backend( new \VIPWorkflows\AI\LegacyCredentialBackend() );
        } else {
            $connector = wp_get_connector( 'openai' );
            $this->assertIsArray( $connector );
            $auth = $connector['authentication'];
            $env_name = $auth['env_var_name'];
            putenv( $env_name );
            update_option( $auth['setting_name'], 'env' === $backend ? '' : $key );
            if ( 'env' === $backend ) {
                putenv( $env_name . '=' . $key );
            }
            $credentials->set_backend( new \VIPWorkflows\AI\ConnectorsCredentialBackend() );
        }
        try {
            $resolved = 'connectors' === $backend ? trim( $key ) : $key;
            $this->assertSame( $resolved, $credentials->api_key( 'openai' ) );
            $available = MediaProcessor::transcription_available();
            $this->assertSame( '' !== $resolved, $available );
            $path = wp_tempnam( 'song.mp3' );
            $this->temp_files[] = $path;
            file_put_contents( $path, self::bytes( 'mp3' ) );
            $result = ( new MediaProcessor() )->transcribe_audio_video( $path );
            $this->assertSame( $available, ! ( is_wp_error( $result ) && 'no_api_key' === $result->get_error_code() ), 'The guard and job disagree.' );
            $this->assertCount( $available ? 1 : 0, $this->fetched );
            $credentials->set_backend( new \VIPWorkflows\AI\LegacyCredentialBackend() );
            $this->assertSame( $credentials->has_key( 'openai' ), '' !== $credentials->api_key( 'openai' ) );
            $credentials->set_backend( new \VIPWorkflows\AI\ConnectorsCredentialBackend() );
            $this->assertSame( $credentials->has_key( 'openai' ), '' !== $credentials->api_key( 'openai' ) );
        } finally {
            if ( '' !== $env_name ) {
                putenv( $env_name );
            }
        }
    }

    public static function provide_keys(): array
    {
        $cases = array();
        foreach ( array( 'connectors', 'env', 'legacy' ) as $backend ) {
            foreach ( array( '', '   ', '0', 'sk-review-test' ) as $key ) {
                $cases[ $backend . ':' . var_export( $key, true ) ] = array( $backend, $key );
            }
        }
        return $cases;
    }

    /**
     * The `transcriptionAvailable` value localized onto the admin script.
     *
     * @return mixed The value as the page receives it.
     */
    private function localized_transcription_flag()
    {
        wp_deregister_script( 'vip-workflows-admin' );
        wp_register_script( 'vip-workflows-admin', false, array(), '1', true );

        ( new IdeationAdmin() )->localize_ideation_data( 'toplevel_page_vip-workflows' );

        $data = (string) wp_scripts()->get_data( 'vip-workflows-admin', 'data' );
        $this->assertMatchesRegularExpression( '/var vipWorkflowsIdeation = (\{.*\});/s', $data );
        preg_match( '/var vipWorkflowsIdeation = (\{.*\});/s', $data, $matches );

        $decoded = json_decode( $matches[1], true );
        $this->assertIsArray( $decoded );
        $this->assertArrayHasKey( 'transcriptionAvailable', $decoded );

        return $decoded['transcriptionAvailable'];
    }
}
