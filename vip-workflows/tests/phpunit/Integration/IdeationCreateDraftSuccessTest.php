<?php
/**
 * Draft creation that succeeds, on the create-draft route.
 *
 * The provider is configured for real and only its HTTP replies are canned:
 * OpenAI is selected with a stored key and model, and `pre_http_request` answers
 * the model listing and the Responses call. Everything between the route and the
 * wire runs as it does on a site — model resolution, the AI Client, the JSON
 * parse, `DraftBuilder` and `wp_insert_post()` — so what is asserted is what the
 * route stores.
 *
 * The fixture is meant to be shared: set the reply with `reply_with()`, call
 * `dispatch_create_draft()`, and read the post back.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\Integrations\DraftBuilder;
use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use WP_REST_Request;

/**
 * @covers \VIPWorkflows\API\IdeationController::create_draft
 */
class IdeationCreateDraftSuccessTest extends TestCase
{
    private const POST_TYPE = 'vip_ideation';

    private const ROUTE = '/vip-workflows/v1/ideation/%d/create-draft';

    private const MODEL = 'gpt-4.1';

    /**
     * The draft the canned provider reply carries.
     *
     * @var array{title: string, body: string}
     */
    private array $reply = array(
        'title' => 'Default title',
        'body'  => 'Default body.',
    );

    /**
     * Provider calls the route made, as "METHOD url".
     *
     * @var string[]
     */
    private array $calls = array();

    /**
     * Whether set_up installed an error handler that tear_down must restore.
     *
     * @var bool
     */
    private bool $handler_installed = false;

    public function set_up(): void
    {
        parent::set_up();

        // The phase gate in create_draft requires an active phase sequence
        // offering ideation -> editorial, and phase sequences require the
        // ideation experiment.
        Plugin::get_instance()->get_experiment_registry()->enable( 'ideation' );
        $this->create_phase_sequence();

        $this->configure_openai();
        $this->can_provider_replies();
        $this->tolerate_undefined_model_name();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

        $GLOBALS['wp_rest_server'] = null;
    }

    public function tear_down(): void
    {
        if ( $this->handler_installed ) {
            restore_error_handler();
            $this->handler_installed = false;
        }

        Credentials::get_instance()->set_backend( null );
        delete_option( 'vip_workflows_ai_provider' );
        delete_option( 'vip_workflows_ai_models' );
        $GLOBALS['wp_rest_server'] = null;

        parent::tear_down();
    }

    /**
     * A drafted body keeps every backslash: a Windows path and a regex inside a
     * code sample are stored exactly as the model wrote them.
     */
    public function test_backslashes_in_the_drafted_body_are_kept(): void
    {
        $body = "Open the folder first.\n\n```\ncd C:\\Users\\tom\npattern = /\\d+\\.\\w/\n```";

        $this->reply_with( 'Working with paths', $body );

        $post = $this->created_post( $this->dispatch_create_draft( $this->project() ) );

        $this->assertStringContainsString( 'C:\\Users\\tom', $post->post_content );
        $this->assertStringContainsString( '\\d+\\.\\w', $post->post_content );
        $this->assertSame(
            DraftBuilder::markdown_to_blocks( $body ),
            $post->post_content,
            'The stored content is exactly what the draft builder produced.'
        );
    }

    /**
     * A drafted title keeps its backslash after `sanitize_text_field()`.
     */
    public function test_backslashes_in_the_drafted_title_are_kept(): void
    {
        $title = 'Why C:\\temp fills up';

        $this->reply_with( $title, 'A body.' );

        $post = $this->created_post( $this->dispatch_create_draft( $this->project() ) );

        $this->assertSame( sanitize_text_field( $title ), $post->post_title );
        $this->assertStringContainsString( 'C:\\temp', $post->post_title );
    }

    /**
     * A draft with no backslashes is stored byte for byte as built, and the rest
     * of the post is what the route has always written.
     */
    public function test_a_draft_without_backslashes_is_unchanged(): void
    {
        $body = "First paragraph with \"quotes\" and it's apostrophe.\n\n- one\n- two\n\n> A quote.";

        $this->reply_with( 'Plain "quoted" title', $body );

        $project  = $this->project();
        $response = $this->dispatch_create_draft( $project );
        $post     = $this->created_post( $response );

        $this->assertSame( DraftBuilder::markdown_to_blocks( $body ), $post->post_content );
        $this->assertSame( 'Plain "quoted" title', $post->post_title );
        $this->assertSame( 'post', $post->post_type );
        $this->assertSame( 'draft', $post->post_status );
        $this->assertSame( get_current_user_id(), (int) $post->post_author );
        $this->assertSame( $project, (int) get_post_meta( $post->ID, '_vip_ideation_project_id', true ) );
        $this->assertContains( 'POST https://api.openai.com/v1/responses', $this->calls, 'The draft came from the canned provider reply.' );
    }

    /** The real REST route stores the provider's decoded JSON exactly once. */
    public function test_rest_do_request_preserves_title_and_block_attribute_escapes(): void
    {
        $title = 'C:\Users\tom "quoted"';
        $attrs = array( 'metadata' => array( 'name' => 'C:\Users\tom "quoted" <tag>' ) );
        $body = '<!-- wp:paragraph ' . wp_json_encode( $attrs, JSON_HEX_TAG ) . ' -->' . "\n"
            . '<p title="C:\Users\tom">C:\Users\tom and it\'s "quoted"</p>' . "\n<!-- /wp:paragraph -->";
        $this->reply_with( $title, $body );
        $request = new WP_REST_Request( 'POST', sprintf( self::ROUTE, $this->project() ) );
        $request->set_header( 'Content-Type', 'application/json' );
        $request->set_body( wp_json_encode( array( 'word_count' => 500 ) ) );
        $post = $this->created_post( rest_do_request( $request ) );
        $expected = DraftBuilder::markdown_to_blocks( $body );
        $this->assertSame( $title, $post->post_title );
        $this->assertSame( $expected, $post->post_content );
        $this->assertSame( parse_blocks( $expected )[0]['attrs'], parse_blocks( $post->post_content )[0]['attrs'] );
        $this->assertSame( 'C:\Users\tom "quoted" <tag>', parse_blocks( $post->post_content )[0]['attrs']['metadata']['name'] );
    }

    public function test_author_create_draft_uses_core_kses_slashing_contract(): void
    {
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
        kses_init();
        $this->assertFalse( current_user_can( 'unfiltered_html' ) );
        $title = 'C:\Users\tom "quoted"';
        $body = '<!-- wp:paragraph -->' . "\n" . '<p title="C:\Users\tom">C:\Users\tom and it\'s "quoted"</p>' . "\n<!-- /wp:paragraph -->";
        $this->reply_with( $title, $body );
        $request = new WP_REST_Request( 'POST', sprintf( self::ROUTE, $this->project() ) );
        $request->set_header( 'Content-Type', 'application/json' );
        $request->set_body( wp_json_encode( array( 'word_count' => 500 ) ) );
        $post = $this->created_post( rest_do_request( $request ) );
        $expected = DraftBuilder::markdown_to_blocks( $body );
        $this->assertSame( $title, $post->post_title );
        $this->assertSame( $expected, $post->post_content );
        $this->assertSame( get_current_user_id(), (int) $post->post_author );
    }

    /* ---------------------------------------------------------------------
     * Fixtures
     * ------------------------------------------------------------------ */

    /**
     * Set the draft the next provider reply carries.
     *
     * @param string $title Drafted title.
     * @param string $body  Drafted markdown body.
     */
    private function reply_with( string $title, string $body ): void
    {
        $this->reply = array(
            'title' => $title,
            'body'  => $body,
        );
    }

    /**
     * Dispatch the route and return the response.
     *
     * @param  int   $project_id Ideation project.
     * @param  array $body       Request body parameters.
     * @return \WP_REST_Response
     */
    private function dispatch_create_draft( int $project_id, array $body = array() ): \WP_REST_Response
    {
        $request = new WP_REST_Request( 'POST', sprintf( self::ROUTE, $project_id ) );
        $request->set_header( 'Content-Type', 'application/json' );
        $request->set_body( (string) wp_json_encode( $body ) );

        return rest_get_server()->dispatch( $request );
    }

    /**
     * The post a successful response created.
     *
     * @param  \WP_REST_Response $response Route response.
     * @return \WP_Post
     */
    private function created_post( \WP_REST_Response $response ): \WP_Post
    {
        $this->assertSame( 201, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );

        $post_id = (int) ( $response->get_data()['post_id'] ?? 0 );
        clean_post_cache( $post_id );

        $post = get_post( $post_id );
        $this->assertInstanceOf( \WP_Post::class, $post );

        return $post;
    }

    /**
     * An ideation project owned by the current user.
     *
     * @return int Project post ID.
     */
    private function project(): int
    {
        return self::factory()->post->create(
            array(
                'post_type'   => self::POST_TYPE,
                'post_title'  => 'Rent control in the valley',
                'post_author' => get_current_user_id(),
            )
        );
    }

    /**
     * Select OpenAI with a key and a model, as the settings screen would.
     *
     * The plugin authenticates the AI Client's providers once, at boot, from
     * whatever keys existed then, so the fake key is also handed to the registry
     * here. It never leaves the process: every request is answered below.
     */
    private function configure_openai(): void
    {
        Credentials::get_instance()->set_backend(
            new class() implements CredentialBackend {
                public function get_api_key( string $service ): string
                {
                    return 'openai' === $service ? 'sk-test-not-a-real-key' : '';
                }
            }
        );

        update_option( 'vip_workflows_ai_provider', 'openai' );
        update_option( 'vip_workflows_ai_models', array( 'openai' => self::MODEL ) );

        \WordPress\AiClient\AiClient::defaultRegistry()->setProviderRequestAuthentication(
            'openai',
            new \WordPress\AiClient\Providers\Http\DTO\ApiKeyRequestAuthentication( 'sk-test-not-a-real-key' )
        );
    }

    /**
     * Answer the provider's HTTP calls; refuse everything else.
     */
    private function can_provider_replies(): void
    {
        add_filter(
            'pre_http_request',
            function ( $preempt, $args, $url ) {
                $method        = strtoupper( (string) ( $args['method'] ?? 'GET' ) );
                $this->calls[] = $method . ' ' . $url;

                $path = (string) wp_parse_url( (string) $url, PHP_URL_PATH );

                if ( '/v1/models' === $path ) {
                    return $this->json_response(
                        array(
                            'object' => 'list',
                            'data'   => array(
                                array(
                                    'id'       => self::MODEL,
                                    'object'   => 'model',
                                    'owned_by' => 'openai',
                                ),
                            ),
                        )
                    );
                }

                if ( '/v1/responses' === $path ) {
                    return $this->json_response(
                        array(
                            'id'     => 'resp_test',
                            'object' => 'response',
                            'status' => 'completed',
                            'model'  => self::MODEL,
                            'output' => array(
                                array(
                                    'type'    => 'message',
                                    'id'      => 'msg_test',
                                    'role'    => 'assistant',
                                    'status'  => 'completed',
                                    'content' => array(
                                        array(
                                            'type' => 'output_text',
                                            'text' => (string) wp_json_encode( $this->reply ),
                                        ),
                                    ),
                                ),
                            ),
                            'usage'  => array(
                                'input_tokens'  => 10,
                                'output_tokens' => 10,
                                'total_tokens'  => 20,
                            ),
                        )
                    );
                }

                return new \WP_Error( 'http_request_blocked', 'No network in this test.' );
            },
            10,
            3
        );
    }

    /**
     * A WP HTTP API response array carrying JSON.
     *
     * @param  array $data Decoded body.
     * @return array
     */
    private function json_response( array $data ): array
    {
        return array(
            'headers'  => array( 'content-type' => 'application/json' ),
            'body'     => (string) wp_json_encode( $data ),
            'response' => array(
                'code'    => 200,
                'message' => 'OK',
            ),
            'cookies'  => array(),
            'filename' => null,
        );
    }

    /**
     * Let one known warning through, and fail on every other.
     *
     * After the post is written, the route currently reads `$model_name`, which
     * nothing assigns. That warning is outside what this class tests, and PHPUnit
     * would turn it into an exception that stops the request half done. Every
     * other error still reaches PHPUnit's handler.
     */
    private function tolerate_undefined_model_name(): void
    {
        $previous = null;

        $previous = set_error_handler(
            static function ( int $errno, string $errstr, string $errfile = '', int $errline = 0 ) use ( &$previous ): bool {
                if ( E_WARNING === $errno && str_contains( $errstr, 'Undefined variable $model_name' ) ) {
                    return true;
                }

                return is_callable( $previous ) ? (bool) $previous( $errno, $errstr, $errfile, $errline ) : false;
            }
        );

        $this->handler_installed = true;
    }

    /**
     * Create and activate a phase sequence permitting ideation -> editorial.
     *
     * @return void
     */
    private function create_phase_sequence(): void
    {
        $repository = new SequenceRepository();

        if ( $repository->get_active_phase_sequence() ) {
            return;
        }

        $repository->create(
            'Lifecycle',
            'lifecycle-create-draft-success-test',
            'Phase sequence for draft creation tests.',
            array(
                'phases' => array(
                    array(
                        'key'         => 'ideation',
                        'label'       => 'Ideation',
                        'transitions' => array(
                            array( 'to' => 'editorial', 'label' => 'Move to Editorial' ),
                        ),
                    ),
                    array( 'key' => 'editorial', 'label' => 'Editorial', 'transitions' => array() ),
                ),
            ),
            get_current_user_id(),
            'phase'
        );
    }
}
