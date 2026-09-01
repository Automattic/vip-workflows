<?php
/**
 * Integration coverage for object authorization on the ability run route.
 *
 * The route used to authorize one object and execute against another: the
 * permission callback read the top-level `post_id`, then the handler let
 * `options` overwrite it before execution. These tests drive the real REST
 * stack with real users and posts, because the unit suite mocks
 * `current_user_can()` and so cannot prove either that the route is wired to
 * the check or that `map_meta_cap` resolves the way the check assumes.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\AbilityResultRepository;
use VIPWorkflows\Ideation\Research\IdeationPostTypes;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Proves the run route authorizes the object it actually runs against.
 */
class AbilityRunContextAuthorizationTest extends TestCase
{
    private const ABILITY = 'vip-workflows-test/echo';
    private const ROUTE   = '/vip-workflows/v1/abilities/' . self::ABILITY . '/run';

    /**
     * Whether the stand-in ability has been registered in this process.
     *
     * The abilities registry outlives the per-test rollback, so registration
     * happens once for the class rather than once per test.
     *
     * @var bool
     */
    private static bool $ability_registered = false;

    /**
     * Private draft owned by someone else.
     *
     * @var int
     */
    private int $victim_post;

    /**
     * Draft owned by the calling contributor.
     *
     * @var int
     */
    private int $own_post;

    /**
     * The calling contributor.
     *
     * @var int
     */
    private int $contributor;

    public function set_up(): void
    {
        parent::set_up();

        $this->contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );

        $this->own_post = self::factory()->post->create(
            array(
                'post_author' => $this->contributor,
                'post_status' => 'draft',
            )
        );

        $this->victim_post = self::factory()->post->create(
            array(
                'post_author' => self::factory()->user->create( array( 'role' => 'author' ) ),
                'post_status' => 'private',
                'post_title'  => 'Embargoed',
            )
        );

        $this->register_echo_ability();
    }

    public function test_a_conflicting_reserved_key_is_refused_and_nothing_runs(): void
    {
        wp_set_current_user( $this->contributor );

        $response = $this->dispatch_run(
            array(
                'post_id' => $this->own_post,
                'options' => array( 'post_id' => $this->victim_post ),
            )
        );

        $this->assertSame( 400, $response->get_status() );
        $this->assertSame( 'ability_context_conflict', $response->get_data()['code'] );
        $this->assertSame( array(), $this->stored_results_for( $this->own_post ) );
        $this->assertSame( array(), $this->stored_results_for( $this->victim_post ) );
    }

    public function test_an_options_only_identifier_is_authorized_and_refused(): void
    {
        wp_set_current_user( $this->contributor );

        $response = $this->dispatch_run( array( 'options' => array( 'post_id' => $this->victim_post ) ) );

        $this->assertSame( 403, $response->get_status() );
        $this->assertSame( array(), $this->stored_results_for( $this->victim_post ) );
    }

    public function test_a_caller_may_still_run_against_their_own_post(): void
    {
        wp_set_current_user( $this->contributor );

        $response = $this->dispatch_run( array( 'post_id' => $this->own_post ) );

        $this->assertSame( 200, $response->get_status() );

        // The run is attributed to the object that was authorized, which is what
        // makes the stored row and the audit event trustworthy.
        $stored = $this->stored_results_for( $this->own_post );
        $this->assertCount( 1, $stored );
        $this->assertSame( $this->own_post, $stored[0]->post_id );
    }

    /**
     * The gate is the capability, not which parameter carried the identifier.
     */
    public function test_an_editor_may_target_another_authors_post_through_options(): void
    {
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

        $response = $this->dispatch_run( array( 'options' => array( 'post_id' => $this->victim_post ) ) );

        $this->assertSame( 200, $response->get_status() );

        $stored = $this->stored_results_for( $this->victim_post );
        $this->assertCount( 1, $stored );
        $this->assertSame( $this->victim_post, $stored[0]->post_id );
    }

    /**
     * `project_id` outranks `post_id` when the executor decides which object a
     * run belongs to, so it needs the same gate. Ideation projects register with
     * `capability_type => 'post'` and `map_meta_cap`, which is what lets one
     * `edit_post` check cover both identifier kinds — provable only against real
     * WordPress.
     */
    public function test_an_options_only_project_identifier_is_authorized_and_refused(): void
    {
        // Ideation sits behind an experiment that is off on a clean test
        // database, so the post type it declares is absent and `map_meta_cap`
        // would fall back to generic post handling. Register just the post type
        // rather than enabling the whole surface.
        ( new IdeationPostTypes() )->register_post_type();

        $project = self::factory()->post->create(
            array(
                'post_type'   => IdeationPostTypes::POST_TYPE,
                'post_author' => self::factory()->user->create( array( 'role' => 'author' ) ),
            )
        );

        wp_set_current_user( $this->contributor );

        $response = $this->dispatch_run( array( 'options' => array( 'project_id' => $project ) ) );

        $this->assertSame( 403, $response->get_status() );
        $this->assertSame( array(), $this->stored_results_for( $project ) );
    }

    public function test_an_identifier_that_resolves_to_nothing_is_refused_without_confirming_it(): void
    {
        wp_set_current_user( $this->contributor );

        $response = $this->dispatch_run( array( 'options' => array( 'post_id' => 99999999 ) ) );

        // 403 rather than 404: a 404 here would tell an unauthorized caller
        // which IDs exist.
        $this->assertSame( 403, $response->get_status() );
    }

    /**
     * Dispatch a run request through the real REST server.
     *
     * Named for the route rather than as a bare `run()`, which would collide
     * with PHPUnit's own public TestCase::run() and fatal at class declaration.
     *
     * @param array $body Request body.
     * @return WP_REST_Response
     */
    private function dispatch_run( array $body ): WP_REST_Response
    {
        $request = new WP_REST_Request( 'POST', self::ROUTE );
        foreach ( $body as $key => $value ) {
            $request->set_param( $key, $value );
        }

        return rest_get_server()->dispatch( $request );
    }

    /**
     * Stored ability results attributed to an object.
     *
     * @param int $post_id Object ID.
     * @return array
     */
    private function stored_results_for( int $post_id ): array
    {
        return ( new AbilityResultRepository() )->find_by_post( $post_id, self::ABILITY );
    }

    /**
     * Register a do-nothing ability, so these tests exercise authorization
     * rather than any particular ability's behavior.
     *
     * The registry is materialized first, which fires the init hook normally and
     * puts every real ability in place. Only then is the hook cleared and
     * re-fired with this listener alone attached: registering outside the hook
     * is a no-op, and re-firing it with the plugin's own listeners still
     * attached would re-register abilities that are already there.
     * WP_UnitTestCase restores `$wp_filter` afterwards.
     *
     * The abilities registry is process-wide and outlives the per-test
     * rollback, so this registers once and every later test reuses it.
     */
    private function register_echo_ability(): void
    {
        wp_get_abilities();

        // Tracked on the class rather than asked of the registry: a lookup for
        // an unregistered ability is itself flagged as incorrect usage, so the
        // question cannot be asked without failing the test that asks it.
        if ( self::$ability_registered ) {
            return;
        }

        remove_all_actions( 'wp_abilities_api_init' );
        add_action(
            'wp_abilities_api_init',
            static function (): void {
                wp_register_ability(
                    self::ABILITY,
                    array(
                        'label'               => 'Echo',
                        'description'         => 'Returns a fixed payload.',
                        'category'            => 'vip-workflows',
                        'input_schema'        => array(
                            'type'                 => 'object',
                            'additionalProperties' => true,
                            'properties'           => array(
                                'post_id'    => array( 'type' => 'integer' ),
                                'project_id' => array( 'type' => 'integer' ),
                            ),
                        ),
                        'output_schema'       => array(
                            'type'       => 'object',
                            'required'   => array( 'ok' ),
                            'properties' => array( 'ok' => array( 'type' => 'boolean' ) ),
                        ),
                        'execute_callback'    => static fn( array $input ): array => array( 'ok' => true ),
                        'permission_callback' => '__return_true',
                    )
                );
            }
        );
        do_action( 'wp_abilities_api_init' );

        self::$ability_registered = true;
    }
}
