<?php
/**
 * Provider-supplied URLs in the stores that are post meta.
 *
 * A selected story prompt and a research run's result are both kept on the
 * project as JSON, and so are the board and the analysis that the Seed Analyst
 * leaves. Integration rather than unit because the claim is about what
 * WordPress holds after the write: `update_post_meta()` removes backslashes
 * from a value before it stores it, so a JSON string that is not slashed first
 * loses the escape on every double quote. Text after a quote is then read as
 * more keys, and a later `url` key replaces the one that was checked. A
 * recording double does not do that, so only the real store shows whether the
 * value that was checked is the value that is read back.
 *
 * Each test reads through the code that reads the store in production.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use ReflectionMethod;
use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\API\DiscoveryController;
use VIPWorkflows\API\WorkflowController;
use VIPWorkflows\Discovery\DiscoveryProviderRegistry;
use VIPWorkflows\Ideation\Assistants\IdeationOrchestrator;
use VIPWorkflows\Ideation\Research\IdeationPostTypes;
use WP_REST_Request;

/**
 * @covers \VIPWorkflows\API\DiscoveryController::select_prompt
 * @covers \VIPWorkflows\Ideation\Assistants\IdeationOrchestrator::update_assistant_meta
 * @covers \VIPWorkflows\Ideation\Assistants\IdeationOrchestrator::commit_seed_analysis
 */
class ProviderUrlMetaStorageTest extends TestCase {

	private const PROVIDER = 'test-url-storage';

	private const AGENT = 'vip-workflows-tests/url-storage';

	/**
	 * Text that ends its own JSON string and starts a second `url` key, once
	 * the backslashes that escape its double quotes are gone.
	 */
	private const TEXT = 'x","url":"javascript:alert(1)","y":"';

	/**
	 * Cards the research agent registered by this test returns.
	 *
	 * Static because the abilities registry outlives a test, and so does the
	 * callback it holds.
	 *
	 * @var array<int, array>
	 */
	private static array $cards = array();

	private static bool $agent_registered = false;

	public function set_up(): void {
		parent::set_up();

		wp_set_current_user(
			(int) self::factory()->user->create( array( 'role' => 'administrator' ) )
		);

		// No AI provider is configured, so the Seed Analyst that a selection
		// starts reports `unavailable` and makes no network call.
		Credentials::get_instance()->set_backend(
			new class() implements CredentialBackend {
				public function get_api_key( string $service ): string {
					return '';
				}
			}
		);

		DiscoveryProviderRegistry::get_instance()->register(
			self::PROVIDER,
			array(
				'label'     => 'URL storage',
				'features'  => array( 'recommend' ),
				'callbacks' => array(
					'recommend' => static fn(): array => array(),
					'seed'      => static fn( array $prompt ): string => 'Seed for ' . ( $prompt['id'] ?? '' ),
				),
			)
		);
	}

	// ─── The selected story prompt ───────────────────────────────

	/**
	 * Select a prompt through the route, as the ideation screen does.
	 *
	 * The controller is only wired during `rest_api_init` while the ideation
	 * experiment is enabled. What is under test is what the route stores, not
	 * the experiment gate, so the routes go directly onto the server.
	 *
	 * @param  array $prompt The prompt in the request body.
	 * @return int The project the selection started.
	 */
	private function select( array $prompt ): int {
		rest_get_server();
		( new DiscoveryController() )->register_routes();

		$request = new WP_REST_Request( 'POST', '/vip-workflows/v1/discovery/select' );
		$request->set_param( 'provider', self::PROVIDER );
		$request->set_param( 'prompt', $prompt );

		$response = rest_do_request( $request );

		$this->assertSame( 201, $response->get_status() );

		return (int) $response->get_data()['project_id'];
	}

	/**
	 * The article the project was started from, as the editor panel reads it.
	 *
	 * @param  int $project_id Ideation project.
	 * @return array|null
	 */
	private function ideation_source( int $project_id ): ?array {
		$method = new ReflectionMethod( WorkflowController::class, 'ideation_source' );

		return $method->invoke( null, $project_id );
	}

	public function test_text_in_a_selected_prompt_cannot_replace_its_checked_url(): void {
		// The client chooses the order of the keys, so the text goes after `url`.
		$project_id = $this->select(
			array(
				'id'          => 'wire-1',
				'provider'    => self::PROVIDER,
				'title'       => 'Reservoir authority publishes annual levels',
				'url'         => 'https://wire.example.test/events/1',
				'description' => self::TEXT,
			)
		);

		$this->assertSame( 'https://wire.example.test/events/1', $this->ideation_source( $project_id )['url'] );
	}

	public function test_a_selected_prompt_with_a_quoted_word_is_read_back_whole(): void {
		$project_id = $this->select(
			array(
				'id'       => 'wire-2',
				'provider' => self::PROVIDER,
				'title'    => 'Mayor says "no" to the café budget',
				'url'      => 'https://wire.example.test/events/2',
			)
		);

		$source = $this->ideation_source( $project_id );

		$this->assertSame( 'Mayor says "no" to the café budget', $source['title'] );
		$this->assertSame( 'https://wire.example.test/events/2', $source['url'] );
	}

	// ─── The result of a research run ────────────────────────────

	/**
	 * Register a research agent that returns `self::$cards`.
	 *
	 * Abilities can only be registered while `wp_abilities_api_init` is running,
	 * so the hook is fired again with every other listener detached —
	 * WP_UnitTestCase restores `$wp_filter` afterwards. The registry is
	 * process-wide and outlives the per-test rollback, so this registers once.
	 */
	private function register_agent(): void {
		wp_get_abilities();

		// Tracked here rather than asked of the registry: a lookup for an
		// unregistered ability is itself flagged as incorrect usage.
		if ( self::$agent_registered ) {
			return;
		}

		remove_all_actions( 'wp_abilities_api_init' );
		add_action(
			'wp_abilities_api_init',
			static function (): void {
				wp_register_ability(
					self::AGENT,
					array(
						'label'               => 'URL storage',
						'description'         => 'Returns the cards the test gives it.',
						'category'            => 'vip-workflows',
						'input_schema'        => array(
							'type'                 => 'object',
							'additionalProperties' => true,
						),
						'execute_callback'    => static fn( array $input ): array => array(
							'cards'   => self::$cards,
							'summary' => 'Found sources.',
						),
						'permission_callback' => '__return_true',
					)
				);
			}
		);
		do_action( 'wp_abilities_api_init' );

		self::$agent_registered = true;
	}

	/**
	 * Run the agent for a new project, then read the project's state as the
	 * ideation screen does.
	 *
	 * @param  array $card The one card the agent's provider returns.
	 * @return array The card as the state holds it in the agent's result.
	 */
	private function card_after_a_run( array $card ): array {
		$this->register_agent();
		self::$cards = array( $card );

		$project_id = self::factory()->post->create(
			array(
				'post_type'  => IdeationPostTypes::POST_TYPE,
				'post_title' => 'Reservoir levels',
			)
		);
		update_post_meta( $project_id, '_vip_ideation_seed', 'Reservoir levels' );

		$orchestrator = new IdeationOrchestrator();
		$result       = $orchestrator->run_initial_assistant( $project_id, self::AGENT );

		$this->assertSame( 'completed', $result['status'] );

		$assistants = $orchestrator->get_state( $project_id )['assistants'];

		$this->assertArrayHasKey( self::AGENT, $assistants, 'The stored result of the run could not be read back.' );

		return $assistants[ self::AGENT ]['cards'][0];
	}

	public function test_text_in_a_card_cannot_replace_its_checked_url_in_project_meta(): void {
		$card = $this->card_after_a_run(
			array(
				'type'        => 'web-article',
				'source_type' => 'article',
				'origin'      => 'search',
				'title'       => 'Reservoir levels fall for a third year',
				'url'         => 'https://news.example.test/reservoirs',
				'excerpt'     => self::TEXT,
			)
		);

		$this->assertSame( 'https://news.example.test/reservoirs', $card['url'] );
		$this->assertSame( self::TEXT, $card['excerpt'] );
	}

	public function test_a_card_with_a_quoted_word_is_read_back_whole(): void {
		$card = $this->card_after_a_run(
			array(
				'type'        => 'web-article',
				'source_type' => 'article',
				'origin'      => 'search',
				'title'       => 'Mayor says "no" to the café budget',
				'url'         => 'https://news.example.test/budget',
			)
		);

		$this->assertSame( 'Mayor says "no" to the café budget', $card['title'] );
		$this->assertSame( 'https://news.example.test/budget', $card['url'] );
	}

	// ─── The board and the analysis of a seed ────────────────────

	/**
	 * Commit a completed seed analysis to a new project, then read the
	 * project's state as the ideation screen does.
	 *
	 * The Seed Analyst needs an AI provider to finish, and none is configured
	 * here, so its result goes to the commit step that a finished run feeds. The
	 * result has the shape that `SeedAnalyst::run()` returns, and each card has
	 * its keys in the order the analyst writes them.
	 *
	 * @param  string $news_angle The news angle the model wrote.
	 * @return array The project's state.
	 */
	private function state_after_an_analysis( string $news_angle ): array {
		$project_id = self::factory()->post->create(
			array(
				'post_type'  => IdeationPostTypes::POST_TYPE,
				'post_title' => 'Reservoir levels',
			)
		);
		update_post_meta( $project_id, '_vip_ideation_seed', 'Reservoir levels' );

		$orchestrator = new IdeationOrchestrator();
		$commit       = new ReflectionMethod( IdeationOrchestrator::class, 'commit_seed_analysis' );

		$commit->invoke(
			$orchestrator,
			$project_id,
			array(
				'status'  => 'completed',
				'cards'   => array(
					array(
						'type'    => 'news-angle',
						'title'   => 'News angle',
						'content' => $news_angle,
						'source'  => 'seed-analyst',
					),
					array(
						'type'   => 'tag-cloud',
						'title'  => 'Topics',
						'tags'   => array( 'reservoirs' ),
						'source' => 'seed-analyst',
					),
				),
				'summary' => 'Extracted 1 topics and 0 entities from your seed.',
				'meta'    => array(
					'tags'            => array( 'reservoirs' ),
					'entities'        => array(
						'people'        => array(),
						'organizations' => array(),
						'places'        => array(),
					),
					'search_queries'  => array( 'reservoir levels' ),
					'news_angle'      => $news_angle,
					'suggested_title' => 'Reservoir levels',
				),
			)
		);

		return $orchestrator->get_state( $project_id );
	}

	public function test_text_in_a_news_angle_cannot_give_its_board_card_a_url(): void {
		// The state lists the cards of the board with the cards of the research
		// agents, and the screen picks how to show a card from its `type`. So the
		// text gives the card a type that is shown with a link, and then the link.
		$text = 'x","type":"article","url":"javascript:alert(1)","y":"';

		$card = $this->state_after_an_analysis( $text )['cards'][0];

		$this->assertSame( 'news-angle', $card['type'] );
		$this->assertSame( $text, $card['content'] );
		$this->assertArrayNotHasKey( 'url', $card );
	}

	public function test_an_analysis_with_a_quoted_phrase_leaves_a_state_that_can_be_read(): void {
		$angle = 'The mayor said "no" to the café budget';

		$state = $this->state_after_an_analysis( $angle );

		$this->assertSame( $angle, $state['cards'][0]['content'] );
		$this->assertSame( $angle, $state['seed_analysis']['news_angle'] );
	}
}
