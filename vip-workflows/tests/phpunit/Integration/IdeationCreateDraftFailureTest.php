<?php
/**
 * Draft generation failures on the create-draft route.
 *
 * Lives in the integration suite because both claims are about the REST route as
 * dispatched: what a caller receives when the AI provider refuses the request,
 * and whether the requested length is bounded before it reaches the prompt.
 *
 * The provider failure is produced for real rather than mocked. With no
 * credentials configured, `AiInference::model()` resolves to null and the AI
 * Client's `usingModel()` rejects it, which is exactly the class of throw this
 * route previously let escape: it was the only AI call in the controller with no
 * handler, so the response was WordPress's generic critical-error page carrying
 * no message at all.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Plugin;
use WP_REST_Request;

/**
 * @covers \VIPWorkflows\API\IdeationController::create_draft
 */
class IdeationCreateDraftFailureTest extends TestCase
{
    private const POST_TYPE = 'vip_ideation';

    private const ROUTE = '/vip-workflows/v1/ideation/%d/create-draft';

    public function set_up(): void
    {
        parent::set_up();

        // The phase gate in create_draft requires an active phase sequence
        // offering ideation -> editorial, and phase sequences require the
        // ideation experiment.
        Plugin::get_instance()->get_experiment_registry()->enable( 'ideation' );
        $this->create_phase_sequence();

        // No provider key, so model resolution fails and generation cannot run.
        Credentials::get_instance()->set_backend( $this->backend_without_keys() );

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

        $GLOBALS['wp_rest_server'] = null;
    }

    public function tear_down(): void
    {
        Credentials::get_instance()->set_backend( null );
        $GLOBALS['wp_rest_server'] = null;

        parent::tear_down();
    }

    /**
     * Expect the resolver's own diagnostic.
     *
     * These fixtures configure no credentials, which is now a state `AiInference`
     * names before it reaches the AI Client: with nothing keyed there is no
     * provider to derive and none was chosen, so it reports that and resolves
     * nothing. The route failure the tests assert on is unchanged; only the
     * reason it fails is now stated rather than discovered at authentication.
     */
    private function expect_unresolved_provider_notice(): void
    {
        $this->setExpectedIncorrectUsage( 'VIPWorkflows\\AI\\AiInference::model' );
    }

    /**
     * A provider that refuses the request must reach the caller as an error it
     * can act on, not as an uncaught throw.
     */
    public function test_provider_failure_returns_an_actionable_error(): void
    {
        $this->expect_unresolved_provider_notice();

        $response = $this->dispatch_create_draft( $this->project(), array() );

        $this->assertSame( 500, $response->get_status() );

        $data = $response->get_data();
        $this->assertSame( 'ai_error', $data['code'] );
        $this->assertNotEmpty( $data['message'], 'The failure must carry a message; a fatal carries none.' );
    }

    /**
     * No post is created when generation never produced a draft.
     */
    public function test_provider_failure_creates_no_post(): void
    {
        $this->expect_unresolved_provider_notice();

        $before = wp_count_posts( 'post' )->draft;

        $this->dispatch_create_draft( $this->project(), array() );

        $this->assertSame( $before, wp_count_posts( 'post' )->draft );
    }

    /**
     * A word count the 4000-token ceiling could not deliver is refused before it
     * reaches the prompt.
     */
    public function test_word_count_beyond_the_bound_is_rejected(): void
    {
        $response = $this->dispatch_create_draft( $this->project(), array( 'word_count' => 5000 ) );

        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'rest_invalid_param', $response->get_data()['code'] );
    }

    /**
     * The bound itself is accepted — it fails later, at generation, not in
     * validation.
     */
    public function test_word_count_at_the_bound_passes_validation(): void
    {
        $this->expect_unresolved_provider_notice();

        $response = $this->dispatch_create_draft( $this->project(), array( 'word_count' => 2000 ) );

        $this->assertSame( 500, $response->get_status() );
        $this->assertSame( 'ai_error', $response->get_data()['code'] );
    }

    /**
     * Dispatch the route and return the response.
     *
     * @param  int   $project_id Ideation project.
     * @param  array $body       Request body parameters.
     * @return \WP_REST_Response
     */
    private function dispatch_create_draft( int $project_id, array $body ): \WP_REST_Response
    {
        $request = new WP_REST_Request( 'POST', sprintf( self::ROUTE, $project_id ) );
        $request->set_header( 'Content-Type', 'application/json' );
        $request->set_body( (string) wp_json_encode( $body ) );

        return rest_get_server()->dispatch( $request );
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
            'lifecycle-create-draft-test',
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
                    array( 'key' => 'editorial', 'label' => 'Editorial' ),
                ),
            ),
            get_current_user_id(),
            'phase'
        );
    }

    /**
     * A credential backend that reports nothing as connected.
     *
     * @return CredentialBackend
     */
    private function backend_without_keys(): CredentialBackend
    {
        return new class() implements CredentialBackend {
            public function get_api_key( string $service ): string
            {
                return '';
            }
        };
    }
}
