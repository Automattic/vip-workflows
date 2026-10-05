<?php
/**
 * URLs in a story prompt, at the point discovery stores the prompt.
 *
 * Selecting a story prompt starts an ideation project and keeps the prompt on
 * it as project meta. The prompt arrives in the request body: the screen sends
 * back what a discovery provider returned, and the route accepts any object
 * from any user who can edit posts. Its `url` is later shown as a link beside
 * the post the project led to, and `meta.links` is the list the prompt preview
 * renders — so neither may be stored unless it is a web address.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionProperty;
use VIPWorkflows\API\DiscoveryController;
use VIPWorkflows\Discovery\DiscoveryProviderRegistry;
use VIPWorkflows\Ideation\Assistants\IdeationOrchestrator;
use WP_REST_Request;

require_once __DIR__ . '/../../../includes/integrations/class-guideline-context-provider.php';
require_once __DIR__ . '/../../../includes/integrations/class-safe-url.php';
require_once __DIR__ . '/../../../includes/ideation/assistants/class-ideation-orchestrator.php';

/**
 * @covers \VIPWorkflows\API\DiscoveryController::select_prompt
 */
class DiscoveryPromptUrlStorageTest extends TestCase {

	private const PROVIDER = 'wire';

	private const PROJECT_ID = 77;

	private const SCRIPT_URL = 'javascript:alert(1)';

	/**
	 * The prompt the provider's seed callback was given.
	 *
	 * @var mixed
	 */
	private $seeded_with;

	/**
	 * Every post meta value the request wrote, by key.
	 *
	 * @var array<string, mixed>
	 */
	private array $meta = array();

	protected function set_up() {
		parent::set_up();

		Functions\when( 'is_wp_error' )->alias( fn( $thing ) => $thing instanceof \WP_Error );
		Functions\when( 'get_current_user_id' )->justReturn( 5 );
		Functions\when( 'update_post_meta' )->alias(
			function ( $post_id, $key, $value ) {
				$this->meta[ $key ] = $value;

				return true;
			}
		);

		DiscoveryProviderRegistry::get_instance()->register(
			self::PROVIDER,
			array(
				'label'     => 'Wire',
				'features'  => array( 'recommend' ),
				'callbacks' => array(
					'recommend' => fn() => array(),
					'seed'      => function ( $prompt ) {
						$this->seeded_with = $prompt;

						return 'Reservoir authority publishes annual levels.';
					},
				),
			)
		);
	}

	/**
	 * A story prompt in the shape every discovery provider returns.
	 *
	 * @return array
	 */
	private function prompt(): array {
		return array(
			'id'          => 'wire-703721',
			'provider'    => self::PROVIDER,
			'title'       => 'Reservoir authority publishes annual levels',
			'description' => 'The authority publishes its yearly figures.',
			'url'         => 'https://wire.example.test/events/703721',
			'date'        => '2026-10-12T09:00:00+00:00',
			'date_end'    => null,
			'tags'        => array( 'Environment' ),
			'importance'  => 'normal',
			'meta'        => array(
				'event_type'   => 'Publication',
				'is_embargoed' => false,
				'links'        => array(
					array(
						'url'         => 'https://authority.example.test/agenda',
						'description' => 'Agenda',
					),
					array(
						'url'         => 'https://authority.example.test/report',
						'description' => 'Last year\'s report',
					),
				),
				'contacts'     => array(),
			),
		);
	}

	/**
	 * Select a prompt, as the ideation screen does.
	 *
	 * Starting the project is replaced: it creates posts and runs the Seed
	 * Analyst against an AI provider. Everything the route itself does is real.
	 *
	 * @param  mixed $prompt The prompt in the request body.
	 * @return \WP_REST_Response|\WP_Error
	 */
	private function select( $prompt ) {
		$controller = new DiscoveryController();

		( new ReflectionProperty( DiscoveryController::class, 'orchestrator' ) )->setValue(
			$controller,
			new class() extends IdeationOrchestrator {
				public function create_from_seed( string $seed, int $user_id ): int|\WP_Error {
					return 77;
				}

				public function get_state( int $project_id ): array {
					return array( 'project_id' => $project_id );
				}
			}
		);

		$request = new WP_REST_Request();
		$request->set_param( 'provider', self::PROVIDER );
		$request->set_param( 'prompt', $prompt );

		return $controller->select_prompt( $request );
	}

	/**
	 * The prompt kept on the project, decoded.
	 *
	 * @return array
	 */
	private function stored_prompt(): array {
		return json_decode( (string) $this->meta['_vip_discovery_prompt'], true )['prompt'];
	}

	public function test_a_script_url_is_not_stored_and_the_rest_of_the_prompt_is(): void {
		$prompt        = $this->prompt();
		$prompt['url'] = self::SCRIPT_URL;

		$response = $this->select( $prompt );

		$this->assertSame( 201, $response->get_status() );
		$this->assertStringNotContainsString( 'javascript:', (string) $this->meta['_vip_discovery_prompt'] );
		$this->assertNull( $this->stored_prompt()['url'] );
		$this->assertSame( 'Reservoir authority publishes annual levels', $this->stored_prompt()['title'] );
		$this->assertSame( 'https://authority.example.test/report', $this->stored_prompt()['meta']['links'][1]['url'] );
	}

	public function test_a_url_that_a_browser_reads_as_script_is_not_stored(): void {
		// A browser discards the tab before it reads the scheme.
		$prompt        = $this->prompt();
		$prompt['url'] = "\tjavascript:alert(1)";

		$this->select( $prompt );

		$this->assertNull( $this->stored_prompt()['url'] );
	}

	public function test_a_script_url_in_any_prompt_link_is_not_stored_and_the_link_text_is(): void {
		// The preview renders every link of a prompt, not only the first.
		$prompt                    = $this->prompt();
		$prompt['meta']['links'][] = array(
			'url'         => 'data:text/html,<script>alert(1)</script>',
			'description' => 'Live stream',
		);

		$prompt['meta']['links'][0]['url'] = self::SCRIPT_URL;

		$this->select( $prompt );

		$this->assertSame(
			array(
				array(
					'url'         => null,
					'description' => 'Agenda',
				),
				array(
					'url'         => 'https://authority.example.test/report',
					'description' => 'Last year\'s report',
				),
				array(
					'url'         => null,
					'description' => 'Live stream',
				),
			),
			$this->stored_prompt()['meta']['links']
		);
	}

	public function test_web_addresses_in_the_prompt_are_stored_as_sent(): void {
		$this->select( $this->prompt() );

		$this->assertSame(
			array(
				'provider' => self::PROVIDER,
				'prompt'   => $this->prompt(),
			),
			json_decode( (string) $this->meta['_vip_discovery_prompt'], true )
		);
	}

	public function test_the_provider_composes_the_seed_from_the_checked_prompt(): void {
		// A provider may quote the link in the seed text, which is stored too.
		$prompt        = $this->prompt();
		$prompt['url'] = self::SCRIPT_URL;

		$this->select( $prompt );

		$this->assertNull( $this->seeded_with['url'] );
		$this->assertSame( 'wire-703721', $this->seeded_with['id'] );
	}

	/**
	 * @return array<string, array{0: array}>
	 */
	public function prompts_without_the_documented_link_shape(): array {
		return array(
			'no url and no meta'        => array( array( 'title' => 'A title' ) ),
			'meta that is not a map'    => array(
				array(
					'title' => 'A title',
					'meta'  => 'see the wire',
				),
			),
			'links that are not a list' => array(
				array(
					'title' => 'A title',
					'meta'  => array( 'links' => 'see the wire' ),
				),
			),
			'links that are not maps'   => array(
				array(
					'title' => 'A title',
					'meta'  => array( 'links' => array( 'see the wire', null, 7 ) ),
				),
			),
			'a link with no url'        => array(
				array(
					'title' => 'A title',
					'meta'  => array( 'links' => array( array( 'description' => 'Agenda' ) ) ),
				),
			),
		);
	}

	/**
	 * The body is whatever the client sent, so no part of the shape can be
	 * assumed while it is checked.
	 *
	 * @dataProvider prompts_without_the_documented_link_shape
	 *
	 * @param array $prompt A prompt that lacks some part of the link shape.
	 */
	public function test_a_prompt_without_the_documented_link_shape_is_stored_as_sent( array $prompt ): void {
		$response = $this->select( $prompt );

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( $prompt, $this->stored_prompt() );
	}
}
