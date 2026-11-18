<?php
/**
 * Audio and video uploads, with and without an OpenAI key.
 *
 * Audio and video sources are transcribed by OpenAI whatever provider the site
 * selected. Without an OpenAI key they still upload: the source is stored and
 * queued like any other, and the job then fails it with the shared sentence,
 * sending nothing. Once a key is added, the source's retry transcribes it.
 * The Ideation screens warn before the upload; that is covered in Jest.
 *
 * Integration rather than unit because the claims are about the real upload
 * path: `media_handle_upload()` creating the attachment, the row in
 * `vip_ideation_sources`, the Action Scheduler job and the job's handler. No
 * key constant is defined in this suite, so the keyless case is reachable here
 * and not in the unit suite.
 *
 * The routes are registered directly onto the server this test builds; the
 * ideation experiment gate that wires them in production is not under test.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\AiAvailability;
use VIPWorkflows\Admin\IdeationAdmin;
use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\API\IdeationSourcesController;
use VIPWorkflows\Ideation\Research\IdeationPostTypes;
use VIPWorkflows\Ideation\Research\SourceProcessingJob;
use VIPWorkflows\Integrations\MediaProcessor;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

require_once dirname( __DIR__ ) . '/fixtures/transcription-upload.php';

/**
 * @covers \VIPWorkflows\API\IdeationSourcesController::upload_source
 * @covers \VIPWorkflows\API\IdeationSourcesController::retry_source
 * @covers \VIPWorkflows\Ideation\Research\SourceProcessingJob::process
 * @covers \VIPWorkflows\Integrations\MediaProcessor::transcription_available
 */
class IdeationSourcesTranscriptionUploadTest extends TestCase
{
    /**
     * What the job stores on the source. It runs with nobody behind it and the
     * row is read by editors too, so it names who can fix it rather than where.
     */
    private const MESSAGE = 'OpenAI transcribes audio and video. OpenAI is not connected. Ask an administrator to connect it.';

    private const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private int $project_id;

    /**
     * Temporary files this test wrote.
     *
     * @var string[]
     */
    private array $temp_files = array();

    /**
     * Outbound requests attempted. Every one is blocked.
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
                'post_title'  => 'Transcription uploads',
                'post_author' => get_current_user_id(),
            )
        );

        /*
         * The files here were never really uploaded, so core's
         * is_uploaded_file() test and move_uploaded_file() would refuse them.
         * The test adapter (fixtures/transcription-upload.php) selects a custom
         * action, so core uses is_readable() for the first, and this filter
         * copies instead of moving; every other check media_handle_upload()
         * makes still runs. Neither overrides MIME detection.
         */
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

        // media_handle_upload() reads $_FILES; the route reads the request.
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
    /**
     * The stored source row.
     *
     * @param string $source_id Source id.
     * @return array<string, mixed>
     */
    private function source_row( string $source_id ): array
    {
        global $wpdb;

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}vip_ideation_sources WHERE project_id = %d AND source_id = %s",
                $this->project_id,
                $source_id
            ),
            ARRAY_A
        );
        $this->assertIsArray( $row );

        return $row;
    }

    /* ---------------------------------------------------------------------
     * Without a key: uploaded, then failed by the job
     * ------------------------------------------------------------------ */

    /**
     * Audio and video upload without an OpenAI key, whatever provider is
     * selected, exactly as any other file does. Nothing is sent yet.
     *
     * @dataProvider provide_media
     *
     * @param string $name        File name.
     * @param string $kind        Fixture kind.
     * @param string $client_type Type the client claims.
     * @param string $mime_prefix Expected stored type prefix.
     * @param array  $keys        Keys the backend holds.
     */
    public function test_audio_and_video_upload_and_queue_without_an_openai_key( string $name, string $kind, string $client_type, string $mime_prefix, array $keys ): void
    {
        $this->use_backend( $keys );
        if ( isset( $keys['anthropic'] ) ) {
            update_option( 'vip_workflows_ai_provider', 'anthropic' );
        }

        $this->assert_accepted_and_queued( $this->upload( $name, self::bytes( $kind ), $client_type ), $mime_prefix );
        $this->assertSame( 1, $this->attachment_count() );
        $this->assertSame( array(), $this->fetched, 'Uploading only queues the job; nothing is sent yet.' );
    }

    public static function provide_media(): array
    {
        return array(
            'audio, no keys'               => array( 'song.mp3', 'mp3', 'audio/mpeg', 'audio/', array() ),
            'video, no keys'               => array( 'clip.mp4', 'mp4', 'video/mp4', 'video/', array() ),
            'audio, Anthropic keyed'       => array( 'song.mp3', 'mp3', 'audio/mpeg', 'audio/', array( 'anthropic' => 'sk-ant-test' ) ),
        );
    }

    /**
     * The job fails a keyless audio source with the shared sentence, which is
     * what the workspace card shows, and sends nothing. That holds whether or
     * not another provider is set up: with none, the missing OpenAI key is
     * still what the card names, not the provider configuration.
     *
     * @dataProvider provide_keyless_backends
     *
     * @param array $keys Keys the backend holds.
     */
    public function test_the_job_fails_a_keyless_upload_with_the_shared_sentence_and_sends_nothing( array $keys ): void
    {
        $this->use_backend( $keys );
        if ( isset( $keys['anthropic'] ) ) {
            update_option( 'vip_workflows_ai_provider', 'anthropic' );
        }

        $response = $this->upload( 'song.mp3', self::bytes( 'mp3' ), 'audio/mpeg' );
        $this->assertSame( 201, $response->get_status() );
        $source_id = (string) $response->get_data()['source_id'];

        ( new SourceProcessingJob() )->process( $this->project_id, $source_id );

        $row = $this->source_row( $source_id );
        $this->assertSame( 'error', $row['processing_status'] );
        $this->assertSame( array( 'error' => self::MESSAGE ), json_decode( (string) $row['ai_analysis'], true ) );
        $this->assertSame( array(), $this->fetched, 'A keyless transcription must not reach the network.' );
    }

    public static function provide_keyless_backends(): array
    {
        return array(
            'no provider set up'  => array( array() ),
            'Anthropic set up'    => array( array( 'anthropic' => 'sk-ant-test' ) ),
        );
    }

    /**
     * Once a key is added, the source's existing retry sends it to OpenAI. The
     * request is blocked here, so the source fails again, but with OpenAI's
     * answer rather than the missing-key sentence.
     */
    public function test_retry_after_a_key_is_added_sends_the_file_for_transcription(): void
    {
        $response  = $this->upload( 'song.mp3', self::bytes( 'mp3' ), 'audio/mpeg' );
        $source_id = (string) $response->get_data()['source_id'];
        ( new SourceProcessingJob() )->process( $this->project_id, $source_id );
        $this->assertSame( 'error', $this->source_row( $source_id )['processing_status'] );

        $this->use_backend( array( 'openai' => 'sk-test' ) );
        if ( ! AiAvailability::is_configured() ) {
            // process_file() asks about the selected provider before routing,
            // so the job can't reach transcription here.
            $this->markTestSkipped( 'OpenAI is not registered with the AI Client in this environment.' );
        }

        $retry = rest_get_server()->dispatch(
            new WP_REST_Request( 'POST', '/vip-workflows/v1/ideation/' . $this->project_id . '/sources/' . $source_id . '/retry' )
        );
        $this->assertSame( 200, $retry->get_status(), (string) wp_json_encode( $retry->get_data() ) );
        $this->assertSame( 'pending', $retry->get_data()['processing_status'] ?? null );

        ( new SourceProcessingJob() )->process( $this->project_id, $source_id );

        $this->assertCount( 1, $this->fetched );
        $this->assertStringContainsString( 'api.openai.com/v1/audio/transcriptions', $this->fetched[0] );
        $error = json_decode( (string) $this->source_row( $source_id )['ai_analysis'], true )['error'] ?? '';
        $this->assertNotSame( self::MESSAGE, $error );
    }

    /* ---------------------------------------------------------------------
     * With a key, and other files: unchanged
     * ------------------------------------------------------------------ */

    public function test_audio_with_an_openai_key_is_accepted_and_queued(): void
    {
        $this->use_backend( array( 'openai' => 'sk-test' ) );

        $this->assert_accepted_and_queued(
            $this->upload( 'song.mp3', self::bytes( 'mp3' ), 'audio/mpeg' ),
            'audio/'
        );
        $this->assertSame( array(), $this->fetched, 'Uploading only queues the job; nothing is sent yet.' );
    }

    /**
     * On a keyless site whose selected provider works, images and PDFs upload
     * and queue as before.
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
     * The Ideation screen reads the same answer to decide whether to warn.
     * `wp_localize_script()` casts top-level booleans to strings, so the page
     * receives '1' or ''.
     */
    public function test_the_ideation_screen_is_told_whether_transcription_is_available(): void
    {
        $this->assertSame( '', $this->localized_transcription_flag() );

        $this->use_backend( array( 'openai' => 'sk-test' ) );
        $this->assertSame( '1', $this->localized_transcription_flag() );
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
            $this->assertSame( $available, ! ( is_wp_error( $result ) && 'no_api_key' === $result->get_error_code() ), 'The screen and the job disagree.' );
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
        $decoded = $this->localized_ideation_data();
        $this->assertArrayHasKey( 'transcriptionAvailable', $decoded );

        return $decoded['transcriptionAvailable'];
    }

    /**
     * The `vipWorkflowsIdeation` object localized onto the admin script.
     *
     * @return array<string, mixed> The object as the page receives it.
     */
    private function localized_ideation_data(): array
    {
        wp_deregister_script( 'vip-workflows-admin' );
        wp_register_script( 'vip-workflows-admin', false, array(), '1', true );

        ( new IdeationAdmin() )->localize_ideation_data( 'toplevel_page_vip-workflows' );

        $data = (string) wp_scripts()->get_data( 'vip-workflows-admin', 'data' );
        $this->assertMatchesRegularExpression( '/var vipWorkflowsIdeation = (\{.*\});/s', $data );
        preg_match( '/var vipWorkflowsIdeation = (\{.*\});/s', $data, $matches );

        $decoded = json_decode( $matches[1], true );
        $this->assertIsArray( $decoded );

        return $decoded;
    }
}
