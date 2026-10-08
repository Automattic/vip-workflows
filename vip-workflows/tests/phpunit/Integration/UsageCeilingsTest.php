<?php
/**
 * The hourly ceilings on discovery search and image generation.
 *
 * Each of the two routes spends an external service on every call: a search
 * that the cache cannot answer calls the discovery provider, and an image
 * request calls the generative provider. Each has a ceiling per account and
 * per hour, image generation one per project as well, and a call over the
 * ceiling is refused with a 429 before the service is called. A site sets the
 * ceilings with the `vip_workflows_{action}_hourly_limit` filters.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\API\DiscoveryController;
use VIPWorkflows\API\IdeationController;
use VIPWorkflows\Discovery\DiscoveryProviderRegistry;
use VIPWorkflows\Ideation\Research\IdeationPostTypes;
use WP_REST_Request;

/**
 * @covers \VIPWorkflows\Integrations\HourlyLimit
 * @covers \VIPWorkflows\API\DiscoveryController::search
 * @covers \VIPWorkflows\API\IdeationController::generate_image
 */
class UsageCeilingsTest extends TestCase {

	private const PROVIDER = 'test-ceilings';

	/**
	 * How many times the test provider's search callback ran.
	 *
	 * @var int
	 */
	public static int $searches = 0;

	/**
	 * Ceilings this test sets, keyed by filter tag.
	 *
	 * @var array<string, int>
	 */
	private array $ceilings = array();

	/**
	 * Every `vip_workflows_hourly_limit_reached` action, as [ action, subject, limit ].
	 *
	 * @var array<int, array>
	 */
	private array $reached = array();

	/**
	 * A word of this test's own, so its searches share no cache entry with another test's.
	 *
	 * @var string
	 */
	private string $token;

	public function set_up(): void {
		parent::set_up();

		self::$searches = 0;
		$this->ceilings = array();
		$this->reached  = array();
		$this->token    = uniqid( 't' );

		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		// No generative provider is configured, so an image request that gets
		// past the ceiling answers with the provider error, and spends nothing.
		Credentials::get_instance()->set_backend(
			new class() implements CredentialBackend {
				public function get_api_key( string $service ): string {
					return '';
				}
			}
		);

		// The registry lives for the whole run, and keeps the first registration
		// of a slug, so this provider has a slug of its own.
		DiscoveryProviderRegistry::get_instance()->register(
			self::PROVIDER,
			array(
				'label'     => 'Searchable',
				'features'  => array( 'recommend', 'search' ),
				'callbacks' => array(
					'recommend' => array( self::class, 'prompts' ),
					'search'    => array( self::class, 'search' ),
					'filters'   => array( self::class, 'filters' ),
					'seed'      => array( self::class, 'seed' ),
				),
			)
		);

		foreach ( array( 'discovery_search', 'image_generation', 'project_image_generation' ) as $action ) {
			add_filter(
				"vip_workflows_{$action}_hourly_limit",
				fn( int $limit ): int => $this->ceilings[ $action ] ?? $limit
			);
		}
		add_action(
			'vip_workflows_hourly_limit_reached',
			function ( string $action, int $subject, int $limit ): void {
				$this->reached[] = array( $action, $subject, $limit );
			},
			10,
			3
		);

		// The routes are wired on `rest_api_init`, which only fires when the
		// server is built; a server from an earlier test would answer 404.
		$GLOBALS['wp_rest_server'] = null;
		rest_get_server();
		( new DiscoveryController() )->register_routes();
		( new IdeationController() )->register_routes();
	}

	public function tear_down(): void {
		global $wpdb;

		// Counts and cached searches live in transients, outside the transaction.
		$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '%vip_workflows_%_rate_%' OR option_name LIKE '%vip_discovery_search_%'" ); // phpcs:ignore WordPress.DB

		$GLOBALS['wp_rest_server'] = null;

		parent::tear_down();
	}

	// ─── The test provider ──────────────────────────────────────

	/**
	 * @return array<int, array>
	 */
	public static function prompts(): array {
		return array( array( 'id' => 'p1', 'title' => 'A prompt' ) );
	}

	/**
	 * @return array<int, array>
	 */
	public static function search(): array {
		++self::$searches;

		return self::prompts();
	}

	/**
	 * @return array<int, array>
	 */
	public static function filters(): array {
		return array();
	}

	public static function seed( array $prompt ): string {
		return (string) ( $prompt['title'] ?? '' );
	}

	// ─── Requests ───────────────────────────────────────────────

	private function search_for( string $text ): \WP_REST_Response {
		$request = new WP_REST_Request( 'GET', '/vip-workflows/v1/discovery/search' );
		$request->set_query_params(
			array(
				'provider' => self::PROVIDER,
				'text'     => $this->token . ' ' . $text,
			)
		);

		return rest_get_server()->dispatch( $request );
	}

	private function a_project(): int {
		return (int) self::factory()->post->create(
			array(
				'post_type'   => IdeationPostTypes::POST_TYPE,
				'post_author' => get_current_user_id(),
			)
		);
	}

	private function generate_image_for( int $project_id ): \WP_REST_Response {
		$request = new WP_REST_Request( 'POST', '/vip-workflows/v1/ideation/' . $project_id . '/generate-image' );
		$request->set_body_params( array( 'prompt' => 'A reservoir at dawn' ) );

		return rest_get_server()->dispatch( $request );
	}

	private function assertRefused( \WP_REST_Response $response, string $code ): void {
		$this->assertSame( 429, $response->get_status() );
		$this->assertSame( $code, $response->get_data()['code'] );
		$this->assertStringContainsString( 'Try again in', $response->get_data()['message'] );
	}

	// ─── Discovery search ───────────────────────────────────────

	public function test_a_search_over_the_ceiling_is_refused_before_the_provider_is_called(): void {
		$this->ceilings['discovery_search'] = 2;

		$this->assertSame( 200, $this->search_for( 'reservoir' )->get_status() );
		$this->assertSame( 200, $this->search_for( 'drought' )->get_status() );

		$this->assertRefused( $this->search_for( 'rainfall' ), 'vip_workflows_discovery_search_rate_limited' );

		$this->assertSame( 2, self::$searches );
		$this->assertSame( array( array( 'discovery_search', get_current_user_id(), 2 ) ), $this->reached );
	}

	public function test_a_search_the_cache_answers_does_not_count_and_is_still_answered_over_the_ceiling(): void {
		$this->ceilings['discovery_search'] = 2;

		$this->search_for( 'reservoir' );
		$this->search_for( 'reservoir' );
		$this->assertSame( 1, self::$searches, 'the second search was answered from the cache' );

		$this->search_for( 'drought' );
		$this->assertRefused( $this->search_for( 'rainfall' ), 'vip_workflows_discovery_search_rate_limited' );

		$this->assertSame( 200, $this->search_for( 'reservoir' )->get_status(), 'a cached search costs nothing, so it is answered' );
		$this->assertSame( 2, self::$searches );
	}

	public function test_the_default_search_ceiling_is_high_enough_for_a_working_session(): void {
		for ( $i = 0; $i < 60; $i++ ) {
			$this->assertSame( 200, $this->search_for( "query $i" )->get_status(), "search $i" );
		}
	}

	public function test_a_search_text_longer_than_the_bound_is_refused(): void {
		$response = $this->search_for( str_repeat( 'a', 501 ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'rest_invalid_param', $response->get_data()['code'] );
		$this->assertSame( 0, self::$searches );
	}

	// ─── Image generation ───────────────────────────────────────

	public function test_an_image_request_over_the_account_ceiling_is_refused(): void {
		$this->ceilings['image_generation'] = 2;
		$project                            = $this->a_project();

		// Under the ceiling the request reaches the provider, which is not configured.
		$this->assertSame( 'no_provider', $this->generate_image_for( $project )->get_data()['code'] );
		$this->assertSame( 'no_provider', $this->generate_image_for( $this->a_project() )->get_data()['code'] );

		$this->assertRefused( $this->generate_image_for( $project ), 'vip_workflows_image_generation_rate_limited' );
		$this->assertSame( array( array( 'image_generation', get_current_user_id(), 2 ) ), $this->reached );
	}

	public function test_an_image_request_over_the_project_ceiling_is_refused_while_another_project_is_not(): void {
		$this->ceilings['project_image_generation'] = 1;
		$project                                    = $this->a_project();

		$this->assertSame( 'no_provider', $this->generate_image_for( $project )->get_data()['code'] );

		$this->assertRefused( $this->generate_image_for( $project ), 'vip_workflows_project_image_generation_rate_limited' );
		$this->assertSame( 'no_provider', $this->generate_image_for( $this->a_project() )->get_data()['code'] );

		$this->assertSame( array( array( 'project_image_generation', $project, 1 ) ), $this->reached );
	}

	public function test_a_ceiling_of_zero_switches_an_image_limit_off(): void {
		$this->ceilings['image_generation']         = 0;
		$this->ceilings['project_image_generation'] = 0;
		$project                                    = $this->a_project();

		for ( $i = 0; $i < 25; $i++ ) {
			$this->assertSame( 'no_provider', $this->generate_image_for( $project )->get_data()['code'], "request $i" );
		}

		$this->assertSame( array(), $this->reached );
	}
}
