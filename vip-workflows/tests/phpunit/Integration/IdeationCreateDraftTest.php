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
     * URLs the canned HTTP layer answered, in order.
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
     * Canned OpenAI replies: the model list, and one draft.
     *
     * @param  false|array $preempt Whether to preempt the request.
     * @param  array       $args    Request arguments.
     * @param  string      $url     Request URL.
     * @return false|array
     */
    public function answer_provider( $preempt, $args, $url )
    {
        $host = (string) wp_parse_url( $url, PHP_URL_HOST );
        $path = (string) wp_parse_url( $url, PHP_URL_PATH );

        if ( 'api.openai.com' !== $host ) {
            return $preempt;
        }

        $this->requests[] = $url;

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
                                    'text' => (string) wp_json_encode(
                                        array(
                                            'title' => self::DRAFT_TITLE,
                                            'body'  => self::DRAFT_BODY,
                                        )
                                    ),
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

        return $preempt;
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
            array( 'https://api.openai.com/v1/responses' ),
            array_values( array_filter( $this->requests, static fn ( string $url ): bool => str_ends_with( $url, '/responses' ) ) ),
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
     * Dispatch the route and return the response.
     *
     * @param  int $project_id Ideation project.
     * @return WP_REST_Response
     */
    private function dispatch_create_draft( int $project_id ): WP_REST_Response
    {
        $request = new WP_REST_Request( 'POST', sprintf( self::ROUTE, $project_id ) );
        $request->set_header( 'Content-Type', 'application/json' );
        $request->set_body( (string) wp_json_encode( array( 'word_count' => 300 ) ) );

        return rest_get_server()->dispatch( $request );
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
