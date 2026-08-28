<?php
/**
 * Restarting an ideation project's seed analysis.
 *
 * Lives in the integration suite because every claim here is about persistence
 * and dispatch: what project meta survives a run that did not complete, what a
 * completed run replaces, and whether the route's permission gate holds. The
 * research-agent reset also needs a real registered `VIPWorkflow\Abilities\Ability`,
 * which `wp_register_ability()` can only produce while `wp_abilities_api_init`
 * is running.
 *
 * The Seed Analyst itself is left to report `unavailable` — the credential
 * backend is pinned empty, so no provider is configured and no network call is
 * made. That is exactly the state the feature exists to recover from, and it is
 * the only run outcome this suite can produce for real, so the completed-run
 * behaviour is asserted against the commit step it feeds.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use ReflectionMethod;
use VIPWorkflow\Abilities\AbilitySettings;
use VIPWorkflow\AI\CredentialBackend;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\API\IdeationController;
use VIPWorkflow\Ideation\Assistants\IdeationOrchestrator;
use VIPWorkflow\Ideation\Assistants\WebResearcher;
use WP_REST_Request;

/**
 * @covers \VIPWorkflow\Ideation\Assistants\IdeationOrchestrator::restart_analysis
 * @covers \VIPWorkflow\API\IdeationController::restart_analysis
 */
class IdeationRestartAnalysisTest extends TestCase
{
    private const POST_TYPE = 'vip_ideation';

    private const ANALYST = 'vip-workflow/seed-analyst';

    private const WEB_RESEARCHER = 'vip-workflow/web-researcher';

    private const META_SEED = '_vip_ideation_seed';

    private const META_SEED_ANALYSIS = '_vip_ideation_seed_analysis';

    private const META_BOARD_CARDS = '_vip_ideation_board_cards';

    private const META_PINNED = '_vip_ideation_pinned_cards';

    private const META_DISMISSED = '_vip_ideation_dismissed_cards';

    private const META_STATUSES = '_vip_ideation_assistant_statuses';

    /**
     * A board card id minted by an earlier analysis.
     */
    private const OLD_BOARD_ID = 'board-oldcard';

    /**
     * A source id — a bare alphanumeric row key in `vip_ideation_sources`.
     */
    private const SOURCE_ID = 'aBcDeFgHiJkL';

    /**
     * Register the Web Researcher and pin generation to an unconfigured state.
     *
     * Abilities can only be registered while `wp_abilities_api_init` is running,
     * so the hook is fired again with every other listener detached —
     * WP_UnitTestCase restores `$wp_filter` afterwards. Registration is global and
     * outlives the test, hence the guard.
     */
    public function set_up(): void
    {
        parent::set_up();

        $registered = array_map(
            static function ( $ability ): string {
                return $ability->get_name();
            },
            wp_get_abilities()
        );

        remove_all_actions( 'wp_abilities_api_init' );
        add_action(
            'wp_abilities_api_init',
            static function () use ( $registered ): void {
                if ( ! in_array( self::WEB_RESEARCHER, $registered, true ) ) {
                    WebResearcher::register_ability();
                }
            }
        );
        do_action( 'wp_abilities_api_init' );

        Credentials::get_instance()->set_backend( $this->backend_without_keys() );

        // Per-ability settings are cached on a singleton that outlives the
        // rolled-back transaction, so a sibling test that disabled an agent would
        // otherwise leave it disabled here and the research reset would find
        // nothing to requeue.
        AbilitySettings::get_instance()->clear_cache();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

        $GLOBALS['wp_rest_server'] = null;
    }

    public function tear_down(): void
    {
        Credentials::get_instance()->set_backend( null );
        AbilitySettings::get_instance()->clear_cache();
        $GLOBALS['wp_rest_server'] = null;

        parent::tear_down();
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

    /**
     * An ideation project carrying a prior analysis, board, and selections.
     *
     * @param  int|null $author Post author, or null for the current user.
     * @return int Project post ID.
     */
    private function project_with_prior_analysis( ?int $author = null ): int
    {
        $project_id = self::factory()->post->create(
            array(
                'post_type'   => self::POST_TYPE,
                'post_title'  => 'Rent control in the valley',
                'post_author' => $author ?? get_current_user_id(),
            )
        );

        update_post_meta( $project_id, self::META_SEED, 'Rent control in the valley' );
        update_post_meta( $project_id, self::META_SEED_ANALYSIS, (string) wp_json_encode( $this->prior_analysis() ) );
        update_post_meta( $project_id, self::META_BOARD_CARDS, (string) wp_json_encode( $this->prior_board() ) );
        update_post_meta(
            $project_id,
            self::META_PINNED,
            (string) wp_json_encode( array( self::OLD_BOARD_ID, self::SOURCE_ID ) )
        );
        update_post_meta(
            $project_id,
            self::META_DISMISSED,
            (string) wp_json_encode( array( 'board-dismissed', 'zYxWvUtSrQpO' ) )
        );

        return $project_id;
    }

    /**
     * The analysis a project already holds.
     *
     * @return array
     */
    private function prior_analysis(): array
    {
        return array(
            'tags'            => array( 'housing' ),
            'news_angle'      => 'The prior angle.',
            'suggested_title' => 'The prior title',
        );
    }

    /**
     * The board a project already holds.
     *
     * @return array
     */
    private function prior_board(): array
    {
        return array(
            array(
                'type'    => 'news-angle',
                'title'   => 'News Angle',
                'content' => 'The prior angle.',
                'card_id' => self::OLD_BOARD_ID,
            ),
        );
    }

    /**
     * Decode a JSON-encoded meta value.
     *
     * @param  int    $project_id Project post ID.
     * @param  string $meta_key   Meta key.
     * @return mixed
     */
    private function decoded_meta( int $project_id, string $meta_key )
    {
        return json_decode( (string) get_post_meta( $project_id, $meta_key, true ), true );
    }

    /**
     * Invoke a private orchestrator method.
     *
     * @param  string $name Method name.
     * @param  mixed  ...$args Arguments.
     * @return mixed
     */
    private function invoke( string $name, ...$args )
    {
        $method = new ReflectionMethod( IdeationOrchestrator::class, $name );

        return $method->invokeArgs( new IdeationOrchestrator(), $args );
    }

    /**
     * A completed Seed Analyst result.
     *
     * @return array
     */
    private function completed_result(): array
    {
        return array(
            'status'  => 'completed',
            'summary' => 'Extracted 2 topics and 1 entity from your seed.',
            'meta'    => array(
                'tags'            => array( 'zoning', 'tenants' ),
                'news_angle'      => 'The fresh angle.',
                'suggested_title' => 'The fresh title',
            ),
            'cards'   => array(
                array(
                    'type'    => 'news-angle',
                    'title'   => 'News Angle',
                    'content' => 'The fresh angle.',
                ),
                array(
                    'type'  => 'tag-cloud',
                    'title' => 'Topics',
                    'tags'  => array( 'zoning', 'tenants' ),
                ),
            ),
        );
    }

    // ─── A run that did not complete ─────────────────────────────

    public function test_an_unavailable_rerun_keeps_the_prior_seed_analysis_and_board(): void
    {
        $project_id = $this->project_with_prior_analysis();

        $result = ( new IdeationOrchestrator() )->restart_analysis( $project_id );

        $this->assertSame( 'unavailable', $result['status'] );
        $this->assertSame( $this->prior_analysis(), $this->decoded_meta( $project_id, self::META_SEED_ANALYSIS ) );
        $this->assertSame( $this->prior_board(), $this->decoded_meta( $project_id, self::META_BOARD_CARDS ) );
    }

    public function test_an_unavailable_rerun_keeps_every_pin_and_dismissal(): void
    {
        // Reconciling against a board that was never replaced would drop the
        // board-card pin for nothing.
        $project_id = $this->project_with_prior_analysis();

        ( new IdeationOrchestrator() )->restart_analysis( $project_id );

        $this->assertSame(
            array( self::OLD_BOARD_ID, self::SOURCE_ID ),
            $this->decoded_meta( $project_id, self::META_PINNED )
        );
        $this->assertSame(
            array( 'board-dismissed', 'zYxWvUtSrQpO' ),
            $this->decoded_meta( $project_id, self::META_DISMISSED )
        );
    }

    public function test_an_unavailable_rerun_records_why_against_the_analyst(): void
    {
        $project_id = $this->project_with_prior_analysis();

        $result = ( new IdeationOrchestrator() )->restart_analysis( $project_id );

        $stored = $this->decoded_meta( $project_id, '_vip_ideation_asst_vip-workflow__seed-analyst' );

        $this->assertSame( 'unavailable', $stored['status'] );
        // Register-neutral: requirement identity is stored, never a rendered
        // destination or an "ask an administrator" line.
        $this->assertNotEmpty( $stored['requirements'] );
        $this->assertStringNotContainsString( '/wp-admin/', (string) wp_json_encode( $stored['requirements'] ) );
        $this->assertNotEmpty( $result['error'] );

        $statuses = $this->decoded_meta( $project_id, self::META_STATUSES );
        $this->assertSame( 'unavailable', $statuses[ self::ANALYST ]['status'] );
    }

    public function test_an_unavailable_rerun_does_not_requeue_the_research_agents(): void
    {
        // Requeuing would have the frontend re-run every agent — and duplicate
        // their sources — for an analysis that never happened.
        $project_id = $this->project_with_prior_analysis();
        update_post_meta(
            $project_id,
            '_vip_ideation_asst_vip-workflow__web-researcher',
            (string) wp_json_encode( array( 'status' => 'completed', 'card_count' => 4 ) )
        );

        ( new IdeationOrchestrator() )->restart_analysis( $project_id );

        $stored = $this->decoded_meta( $project_id, '_vip_ideation_asst_vip-workflow__web-researcher' );
        $this->assertSame( 'completed', $stored['status'] );
    }

    public function test_a_project_without_a_seed_is_reported_as_an_error(): void
    {
        $project_id = $this->project_with_prior_analysis();
        delete_post_meta( $project_id, self::META_SEED );

        $result = ( new IdeationOrchestrator() )->restart_analysis( $project_id );

        $this->assertWPError( $result );
        $this->assertSame( 'missing_seed', $result->get_error_code() );
        $this->assertSame( $this->prior_analysis(), $this->decoded_meta( $project_id, self::META_SEED_ANALYSIS ) );
    }

    // ─── A run that completed ────────────────────────────────────

    public function test_a_completed_run_replaces_the_seed_analysis_and_board(): void
    {
        $project_id = $this->project_with_prior_analysis();

        $this->invoke( 'commit_seed_analysis', $project_id, $this->completed_result() );

        $analysis = $this->decoded_meta( $project_id, self::META_SEED_ANALYSIS );
        $this->assertSame( 'The fresh angle.', $analysis['news_angle'] );
        $this->assertSame( array( 'zoning', 'tenants' ), $analysis['tags'] );

        $board = $this->decoded_meta( $project_id, self::META_BOARD_CARDS );
        $this->assertCount( 2, $board );
        $this->assertSame( array( 'news-angle', 'tag-cloud' ), wp_list_pluck( $board, 'type' ) );
        $this->assertSame( 'The fresh title', get_post_meta( $project_id, '_vip_ideation_suggested_title', true ) );

        foreach ( $board as $card ) {
            $this->assertStringStartsWith( 'board-', $card['card_id'] );
            $this->assertNotSame( self::OLD_BOARD_ID, $card['card_id'] );
        }
    }

    public function test_a_completed_run_drops_board_pins_and_keeps_source_pins(): void
    {
        // The two populations share one list: board ids are minted per run and
        // live in meta that was just rewritten, while source ids key rows in
        // `vip_ideation_sources` that no analysis touches.
        $project_id = $this->project_with_prior_analysis();

        $this->invoke( 'commit_seed_analysis', $project_id, $this->completed_result() );

        $this->assertSame( array( self::SOURCE_ID ), $this->decoded_meta( $project_id, self::META_PINNED ) );
        $this->assertSame( array( 'zYxWvUtSrQpO' ), $this->decoded_meta( $project_id, self::META_DISMISSED ) );
    }

    public function test_a_completed_run_drops_a_pin_that_named_a_board_card_by_type(): void
    {
        // Board cards written before ids existed were selected by card type, which
        // `get_state()` still resolves. Those dangle just the same.
        $project_id = $this->project_with_prior_analysis();
        update_post_meta(
            $project_id,
            self::META_PINNED,
            (string) wp_json_encode( array( 'tag-cloud', self::SOURCE_ID ) )
        );

        $this->invoke( 'commit_seed_analysis', $project_id, $this->completed_result() );

        $this->assertSame( array( self::SOURCE_ID ), $this->decoded_meta( $project_id, self::META_PINNED ) );
    }

    public function test_research_agents_are_put_back_to_pending(): void
    {
        $this->assertContains(
            self::WEB_RESEARCHER,
            ( new IdeationOrchestrator() )->get_queryable_assistants(),
            'The Web Researcher has to be registered and enabled for there to be anything to requeue.'
        );

        $project_id = $this->project_with_prior_analysis();
        update_post_meta(
            $project_id,
            '_vip_ideation_asst_vip-workflow__web-researcher',
            (string) wp_json_encode( array( 'status' => 'completed', 'card_count' => 4 ) )
        );

        $this->invoke( 'reset_research_assistants', $project_id );

        $stored = $this->decoded_meta( $project_id, '_vip_ideation_asst_vip-workflow__web-researcher' );
        $this->assertSame( 'pending', $stored['status'] );
        $this->assertSame( array(), $stored['cards'] );

        $statuses = $this->decoded_meta( $project_id, self::META_STATUSES );
        $this->assertSame( 'pending', $statuses[ self::WEB_RESEARCHER ]['status'] );
    }

    // ─── The route ───────────────────────────────────────────────

    /**
     * Register the ideation routes on a live server.
     *
     * The controller is only wired during `rest_api_init` while the ideation
     * experiment is enabled, and what is under test is the controller's own gate
     * rather than the experiment gate, so the routes are registered directly onto
     * the server this test builds.
     */
    private function register_ideation_routes(): void
    {
        rest_get_server();
        ( new IdeationController() )->register_routes();
    }

    /**
     * Dispatch the restart route.
     *
     * @param  int $project_id Project post ID.
     * @return \WP_REST_Response
     */
    private function dispatch_restart( int $project_id ): \WP_REST_Response
    {
        $this->register_ideation_routes();

        return rest_get_server()->dispatch(
            new WP_REST_Request( 'POST', '/vip-workflow/v1/ideation/' . $project_id . '/restart-analysis' )
        );
    }

    public function test_route_rejects_a_user_who_cannot_edit_the_project(): void
    {
        $project_id = $this->project_with_prior_analysis(
            self::factory()->user->create( array( 'role' => 'author' ) )
        );

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

        $response = $this->dispatch_restart( $project_id );

        $this->assertSame( 403, $response->get_status() );
        // Nothing ran on the way to being refused.
        $this->assertSame( $this->prior_analysis(), $this->decoded_meta( $project_id, self::META_SEED_ANALYSIS ) );
    }

    public function test_route_rejects_a_user_without_edit_posts(): void
    {
        $project_id = $this->project_with_prior_analysis();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

        $this->assertSame( 403, $this->dispatch_restart( $project_id )->get_status() );
    }

    public function test_route_404s_for_a_post_that_is_not_an_ideation_project(): void
    {
        $post_id = self::factory()->post->create();

        $response = $this->dispatch_restart( $post_id );

        $this->assertSame( 404, $response->get_status() );
    }

    public function test_route_reports_a_run_that_replaced_nothing(): void
    {
        // The author is allowed through the gate; the analysis then cannot run,
        // and the route says so rather than returning a state it did not change.
        $project_id = $this->project_with_prior_analysis();

        $response = $this->dispatch_restart( $project_id );

        $this->assertSame( 500, $response->get_status() );
        $this->assertSame( 'restart_failed', $response->get_data()['code'] );
        $this->assertSame( $this->prior_analysis(), $this->decoded_meta( $project_id, self::META_SEED_ANALYSIS ) );
        $this->assertSame( $this->prior_board(), $this->decoded_meta( $project_id, self::META_BOARD_CARDS ) );
    }
}
