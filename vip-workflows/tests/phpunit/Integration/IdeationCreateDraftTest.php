<?php
/**
 * The create-draft route's success path, end to end.
 *
 * The AI call runs for real through the AI Client and the vendored OpenAI
 * provider; only the HTTP reply is canned, through `pre_http_request`. So the
 * route, the prompt build, model resolution, JSON parsing and every write after
 * generation are the production code paths, and the test pins what a successful
 * Create Draft leaves behind: the draft itself, its link to the project and the
 * story, and its category.
 *
 * The model listing and the Responses call are the only canned layer; every
 * other HTTP request is refused, so nothing reaches the network. Set the reply
 * with `reply_with()`, call `dispatch_create_draft()`, and read the post back
 * with `created_post()`.
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
use VIPWorkflows\Story\Story;
use WP_REST_Request;
use WP_REST_Response;

/**
 * @covers \VIPWorkflows\API\IdeationController::create_draft
 */
class IdeationCreateDraftTest extends TestCase
{
    private const ROUTE = '/vip-workflows/v1/ideation/%d/create-draft';

    private const MODEL = 'gpt-4o';

    private const DRAFT_TITLE = 'Valley councils weigh rent caps';

    private const DRAFT_BODY = "Three councils will vote on rent caps this spring.\n\nTenant groups say the caps are overdue.";

    /**
     * The draft the canned provider reply carries.
     *
     * @var array{title: string, body: string}
     */
    private array $reply = array(
        'title' => self::DRAFT_TITLE,
        'body'  => self::DRAFT_BODY,
    );

    /**
     * HTTP requests the route made, in order, as "METHOD url".
     *
     * @var string[]
     */
    private array $requests = array();

    /**
     * PHP warnings and notices raised while the route ran.
     *
     * @var string[]
     */
    private array $php_errors = array();

    /**
     * Request authentication the OpenAI provider had before this test.
     *
     * @var mixed
     */
    private $previous_auth = null;

    /**
     * Whether set_up replaced the OpenAI provider's authentication, so
     * tear-down knows there is something to put back.
     *
     * @var bool
     */
    private bool $auth_replaced = false;

    public function set_up(): void
    {
        parent::set_up();

        // The phase gate in create_draft requires an active phase sequence
        // offering ideation -> editorial, and phase sequences require the
        // ideation experiment.
        Plugin::get_instance()->get_experiment_registry()->enable( 'ideation' );

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
        $this->create_phase_sequence();

        // An OpenAI key and model, as an administrator would configure them.
        Credentials::get_instance()->set_backend( $this->backend_with_openai_key() );
        update_option( 'vip_workflows_ai_provider', 'openai' );
        update_option( 'vip_workflows_ai_models', array( 'openai' => self::MODEL ) );

        // The plugin authenticates providers once, at boot, from the keys it
        // finds then. This test's key arrives later, so it is applied the same way.
        // Tear-down puts the old authentication back through the client's
        // private properties, so check they are all there before changing it.
        $registry = \WordPress\AiClient\AiClient::defaultRegistry();
        $this->require_restorable_provider_state( $registry );

        $this->previous_auth = $registry->getProviderRequestAuthentication( 'openai' );
        $registry->setProviderRequestAuthentication(
            'openai',
            new \WordPress\AiClient\Providers\Http\DTO\ApiKeyRequestAuthentication( 'test-key' )
        );
        $this->auth_replaced = true;

        add_filter( 'pre_http_request', array( $this, 'answer_provider' ), 10, 3 );
    }

    public function tear_down(): void
    {
        remove_filter( 'pre_http_request', array( $this, 'answer_provider' ), 10 );

        // A failed restore still reports, but never skips the rest of tear-down.
        try {
            if ( $this->auth_replaced ) {
                $this->auth_replaced = false;
                $this->restore_provider_auth();
            }
        } finally {
            Credentials::get_instance()->set_backend( null );
            delete_option( 'vip_workflows_ai_provider' );
            delete_option( 'vip_workflows_ai_models' );

            parent::tear_down();
        }
    }

    /**
     * Fail before the test changes anything when a private property that
     * restore_provider_auth() relies on is missing, for example after an AI
     * Client update renames it.
     *
     * @param \WordPress\AiClient\Providers\ProviderRegistry $registry Default registry.
     */
    private function require_restorable_provider_state( $registry ): void
    {
        $this->require_property( $registry, 'providerAuthenticationInstances' );

        foreach ( $this->provider_objects_holding_auth( $registry->getProviderClassName( 'openai' ) ) as $holder ) {
            $this->require_property( $holder, 'requestAuthentication' );
            $this->require_property( $holder, 'httpTransporter' );
        }
    }

    /**
     * Put the OpenAI provider's authentication back as this test found it.
     *
     * When there was none, the registry has no setter for "none", so its
     * entry is removed and the key is cleared from the provider objects it
     * was forwarded to. Those objects are kept rather than rebuilt, so they
     * keep the HTTP transporter the registry gave them at registration.
     */
    private function restore_provider_auth(): void
    {
        $registry = \WordPress\AiClient\AiClient::defaultRegistry();

        if ( null !== $this->previous_auth ) {
            $registry->setProviderRequestAuthentication( 'openai', $this->previous_auth );
        } else {
            $class_name = $registry->getProviderClassName( 'openai' );

            $instances = $this->require_property( $registry, 'providerAuthenticationInstances' );
            $map       = $instances->getValue( $registry );
            unset( $map[ $class_name ] );
            $instances->setValue( $registry, $map );

            foreach ( $this->provider_objects_holding_auth( $class_name ) as $holder ) {
                $this->clear_request_authentication( $holder );
            }
        }

        $this->assertSame( $this->previous_auth, $registry->getProviderRequestAuthentication( 'openai' ) );

        $class_name = $registry->getProviderClassName( 'openai' );
        foreach ( $this->provider_objects_holding_auth( $class_name ) as $holder ) {
            $this->assertSame( $this->previous_auth, $this->read_property( $holder, 'requestAuthentication' ) );
            $this->assertSame( $registry->getHttpTransporter(), $this->read_property( $holder, 'httpTransporter' ) );
        }
    }

    /**
     * The provider's model directory, and the one its availability check
     * wraps, when they take request authentication.
     *
     * @param  string $class_name Provider class.
     * @return object[]
     */
    private function provider_objects_holding_auth( string $class_name ): array
    {
        $candidates   = array( $class_name::modelMetadataDirectory() );
        $availability = $class_name::availability();
        if ( $this->find_property( $availability, 'modelMetadataDirectory' ) ) {
            $candidates[] = $this->read_property( $availability, 'modelMetadataDirectory' );
        }

        $holders = array();
        foreach ( $candidates as $candidate ) {
            if ( $candidate instanceof \WordPress\AiClient\Providers\Http\Contracts\WithRequestAuthenticationInterface && ! in_array( $candidate, $holders, true ) ) {
                $holders[] = $candidate;
            }
        }
        return $holders;
    }

    /**
     * Unset an object's request authentication, which has no public unsetter.
     *
     * @param object $holder Object using the request authentication trait.
     */
    private function clear_request_authentication( object $holder ): void
    {
        $this->require_property( $holder, 'requestAuthentication' )->setValue( $holder, null );
    }

    /**
     * Read a property declared anywhere in an object's class hierarchy.
     *
     * @param  object $holder Object.
     * @param  string $name   Property name.
     * @return mixed
     */
    private function read_property( object $holder, string $name )
    {
        return $this->require_property( $holder, $name )->getValue( $holder );
    }

    /**
     * Find a property declared anywhere in an object's class hierarchy, and
     * fail the test naming it when it is not there.
     *
     * @param  object $holder Object.
     * @param  string $name   Property name.
     * @return \ReflectionProperty
     */
    private function require_property( object $holder, string $name ): \ReflectionProperty
    {
        $property = $this->find_property( $holder, $name );
        if ( null === $property ) {
            $this->fail( sprintf( 'The AI Client no longer has %s::$%s, which this test resets after each run.', get_class( $holder ), $name ) );
        }
        return $property;
    }

    /**
     * Find a property declared anywhere in an object's class hierarchy.
     *
     * @param  object $holder Object.
     * @param  string $name   Property name.
     * @return \ReflectionProperty|null
     */
    private function find_property( object $holder, string $name ): ?\ReflectionProperty
    {
        for ( $class = new \ReflectionClass( $holder ); $class; $class = $class->getParentClass() ) {
            if ( $class->hasProperty( $name ) && $class->getProperty( $name )->getDeclaringClass()->getName() === $class->getName() ) {
                return $class->getProperty( $name );
            }
        }
        return null;
    }

    /**
     * Canned OpenAI replies: the model list, and one draft carrying
     * `$this->reply`. Every other request is refused.
     *
     * @param  false|array $preempt Whether to preempt the request.
     * @param  array       $args    Request arguments.
     * @param  string      $url     Request URL.
     * @return array|\WP_Error
     */
    public function answer_provider( $preempt, $args, $url )
    {
        $method           = strtoupper( (string) ( $args['method'] ?? 'GET' ) );
        $this->requests[] = $method . ' ' . $url;

        $host = (string) wp_parse_url( (string) $url, PHP_URL_HOST );
        $path = (string) wp_parse_url( (string) $url, PHP_URL_PATH );

        if ( 'api.openai.com' !== $host ) {
            return new \WP_Error( 'http_request_blocked', 'No network in this test.' );
        }

        if ( '/v1/models' === $path ) {
            return $this->json_response(
                array(
                    'object' => 'list',
                    'data'   => array(
                        array(
                            'id'     => self::MODEL,
                            'object' => 'model',
                        ),
                    ),
                )
            );
        }

        if ( '/v1/responses' === $path ) {
            return $this->json_response(
                array(
                    'id'     => 'resp_test',
                    'status' => 'completed',
                    'output' => array(
                        array(
                            'type'    => 'message',
                            'role'    => 'assistant',
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
                        'output_tokens' => 20,
                        'total_tokens'  => 30,
                    ),
                )
            );
        }

        return new \WP_Error( 'http_request_blocked', 'No network in this test.' );
    }

    /**
     * A successful draft is a draft post by the current user, holding the
     * generated title and the body converted to blocks, and pointing back at
     * its project.
     */
    public function test_creates_the_draft_from_the_generated_reply(): void
    {
        $project_id = $this->project();

        $response = $this->dispatch_create_draft( $project_id );

        $this->assertSame( 201, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );

        $post_id = (int) $response->get_data()['post_id'];
        $post    = get_post( $post_id );

        $this->assertNotNull( $post );
        $this->assertSame( 'post', $post->post_type );
        $this->assertSame( 'draft', $post->post_status );
        $this->assertSame( get_current_user_id(), (int) $post->post_author );
        $this->assertSame( self::DRAFT_TITLE, $post->post_title );
        $this->assertSame( DraftBuilder::markdown_to_blocks( self::DRAFT_BODY ), $post->post_content );
        $this->assertSame( (string) $project_id, get_post_meta( $post_id, '_vip_ideation_project_id', true ) );
        $this->assertSame( get_edit_post_link( $post_id, 'raw' ), $response->get_data()['edit_url'] );

        $this->assertSame(
            array( 'POST https://api.openai.com/v1/responses' ),
            array_values( array_filter( $this->requests, static fn ( string $request ): bool => str_ends_with( $request, '/responses' ) ) ),
            'Exactly one generation request is made.'
        );
    }

    /**
     * The draft joins the project's story, and the story moves to editorial.
     */
    public function test_links_the_draft_to_the_story_and_moves_it_to_editorial(): void
    {
        $project_id = $this->project();
        $story      = Story::for_object( $project_id );
        $this->assertNotNull( $story );

        $response = $this->dispatch_create_draft( $project_id );
        $this->assertSame( 201, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );

        $post_id = (int) $response->get_data()['post_id'];
        $story   = Story::get( $story->get_post_id() );

        $this->assertSame( Story::STATUS_EDITORIAL, $story->get_status() );
        $this->assertSame( $story->get_post_id(), Story::for_object( $post_id )?->get_post_id() );
        $this->assertContains(
            $post_id,
            array_map( 'intval', array_column( $story->get_objects( 'post' ), 'object_id' ) )
        );
    }

    /**
     * The project's category is applied to the draft.
     */
    public function test_applies_the_project_category(): void
    {
        $category_id = self::factory()->category->create( array( 'name' => 'Housing' ) );
        $project_id  = $this->project();
        update_post_meta( $project_id, '_vip_ideation_category_id', $category_id );

        $response = $this->dispatch_create_draft( $project_id );
        $this->assertSame( 201, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );

        $this->assertSame( array( $category_id ), wp_get_post_categories( (int) $response->get_data()['post_id'] ) );
    }

    /**
     * The draft carries no record of the AI call, and the route raises no PHP
     * warning or notice on the way.
     */
    public function test_writes_no_ai_record_and_raises_no_php_warning(): void
    {
        $project_id = $this->project();

        set_error_handler(
            function ( int $errno, string $errstr, string $errfile = '', int $errline = 0 ): bool {
                $this->php_errors[] = sprintf( '%s at %s:%d', $errstr, $errfile, $errline );
                return true;
            },
            E_WARNING | E_NOTICE | E_USER_WARNING | E_USER_NOTICE
        );
        try {
            $response = $this->dispatch_create_draft( $project_id );
        } finally {
            restore_error_handler();
        }

        $this->assertSame( array(), $this->php_errors );
        $this->assertSame( 201, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );

        $post_id = (int) $response->get_data()['post_id'];
        $this->assertSame( '', get_post_meta( $post_id, 'vip_draft_ai_context', true ) );
        $this->assertFalse( metadata_exists( 'post', $post_id, 'vip_draft_ai_context' ) );
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
        $this->assertContains( 'POST https://api.openai.com/v1/responses', $this->requests, 'The draft came from the canned provider reply.' );
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
     * @return WP_REST_Response
     */
    private function dispatch_create_draft( int $project_id, array $body = array( 'word_count' => 300 ) ): WP_REST_Response
    {
        $request = new WP_REST_Request( 'POST', sprintf( self::ROUTE, $project_id ) );
        $request->set_header( 'Content-Type', 'application/json' );
        $request->set_body( (string) wp_json_encode( $body ) );

        return rest_get_server()->dispatch( $request );
    }

    /**
     * The post a successful response created.
     *
     * @param  WP_REST_Response $response Route response.
     * @return \WP_Post
     */
    private function created_post( WP_REST_Response $response ): \WP_Post
    {
        $this->assertSame( 201, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );

        $post_id = (int) ( $response->get_data()['post_id'] ?? 0 );
        clean_post_cache( $post_id );

        $post = get_post( $post_id );
        $this->assertInstanceOf( \WP_Post::class, $post );

        return $post;
    }

    /**
     * An ideation project owned by the current user, with a seed and a story,
     * as the orchestrator creates one.
     *
     * @return int Project post ID.
     */
    private function project(): int
    {
        $project_id = self::factory()->post->create(
            array(
                'post_type'   => 'vip_ideation',
                'post_title'  => 'Rent control in the valley',
                'post_author' => get_current_user_id(),
            )
        );
        update_post_meta( $project_id, '_vip_ideation_seed', 'Rent control in the valley' );

        $story = Story::create( 'Rent control in the valley', Story::STATUS_IDEATION );
        $this->assertNotWPError( $story );
        $story->add_object( $project_id, 'ideation' );

        return $project_id;
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

    /**
     * A credential backend holding an OpenAI key only.
     *
     * @return CredentialBackend
     */
    private function backend_with_openai_key(): CredentialBackend
    {
        return new class() implements CredentialBackend {
            public function get_api_key( string $service ): string
            {
                return 'openai' === $service ? 'test-key' : '';
            }
        };
    }

    /**
     * A WordPress HTTP API response carrying JSON.
     *
     * @param  array $data Response body.
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
}
