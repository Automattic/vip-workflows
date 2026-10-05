<?php
/**
 * URLs in a story prompt, at the point discovery stores the prompt.
 *
 * Selecting a story prompt starts an ideation project and keeps the prompt on
 * it as project meta. The prompt arrives in the request body: the screen sends
 * back what a discovery provider returned, and the route accepts any object
 * from any user who can edit posts. Its `url` is later shown as a link beside
 * the post the project led to. `meta.links` is stored with it; nothing reads
 * the stored list today, and it is checked so that a reader added later does
 * not have to. Neither may be stored unless it is a web address.
 *
 * The project's meta is a double here. WordPress changes a meta value on its
 * way in, so the double does the same, and `ProviderUrlMetaStorageTest` makes
 * the claims that depend on it against the real store.
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

	/**
	 * The post each meta value was written to, by key.
	 *
	 * @var array<string, int>
	 */
	private array $meta_post = array();

	protected function set_up() {
		parent::set_up();

		Functions\when( 'is_wp_error' )->alias( fn( $thing ) => $thing instanceof \WP_Error );
		Functions\when( 'get_current_user_id' )->justReturn( 5 );

		/*
		 * WordPress removes the backslashes from a meta value before it stores
		 * it, and `wp_slash()` is how a caller keeps the ones that belong to the
		 * value. The base class makes `wp_slash()` return its argument, which is
		 * only right beside a store that removes nothing. Both behave here as
		 * they do in WordPress, so `$this->meta` holds what the database would.
		 */
		Functions\when( 'wp_slash' )->alias( fn( $value ) => is_string( $value ) ? addslashes( $value ) : $value );
		Functions\when( 'update_post_meta' )->alias(
			function ( $post_id, $key, $value ) {
				$this->meta[ $key ]      = is_string( $value ) ? stripslashes( $value ) : $value;
				$this->meta_post[ $key ] = $post_id;

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
			new class( self::PROJECT_ID ) extends IdeationOrchestrator {
				public function __construct( private int $project_id ) {}

				public function create_from_seed( string $seed, int $user_id ): int|\WP_Error {
					return $this->project_id;
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

	public function test_text_in_another_field_cannot_replace_the_checked_url(): void {
		// A double quote ends a JSON string. If the stored JSON loses the
		// backslash before it, the text after the quote is read as more keys of
		// the prompt, and the last `url` key is the one a reader gets. The client
		// chooses the order of the keys, so the text goes after `url`.
		$text   = 'x","url":"javascript:alert(1)","y":"';
		$prompt = $this->prompt();
		unset( $prompt['description'] );
		$prompt['description'] = $text;

		$this->select( $prompt );

		$this->assertSame( 'https://wire.example.test/events/703721', $this->stored_prompt()['url'] );
		$this->assertSame( $text, $this->stored_prompt()['description'] );
	}

	public function test_the_prompt_is_kept_on_the_project_the_selection_started(): void {
		$response = $this->select( $this->prompt() );

		$this->assertSame( self::PROJECT_ID, $this->meta_post['_vip_discovery_prompt'] );
		$this->assertSame( array( 'project_id' => self::PROJECT_ID ), $response->get_data() );
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

	public function test_an_empty_url_is_kept_as_the_provider_sent_it(): void {
		// An empty string is how a provider writes "no link". It is not an
		// address that failed the check, so the seed callback and the project
		// get the string the provider sent, not a null in its place.
		$prompt                            = $this->prompt();
		$prompt['url']                     = '';
		$prompt['meta']['links'][0]['url'] = '';

		$this->select( $prompt );

		$this->assertSame( '', $this->seeded_with['url'] );
		$this->assertSame( '', $this->stored_prompt()['url'] );
		$this->assertSame( '', $this->stored_prompt()['meta']['links'][0]['url'] );
	}

	/**
	 * Everything an action wrote to the error log.
	 *
	 * Captured rather than patched, as elsewhere in this suite: phpunit.xml sends
	 * `error_log()` to /dev/null, so the destination is pointed at a file for the
	 * length of the action.
	 *
	 * @param  callable $action What to run.
	 * @return string
	 */
	private function log_of( callable $action ): string {
		$log_file = tempnam( sys_get_temp_dir(), 'vipwf-log-' );
		$previous = ini_set( 'error_log', $log_file );

		try {
			$action();
		} finally {
			ini_set( 'error_log', $previous );
		}

		$log = (string) file_get_contents( $log_file );
		unlink( $log_file );

		return $log;
	}

	public function test_a_selection_that_removed_addresses_says_so_once_in_the_log(): void {
		// The stored prompt shows a missing link the same way whether the
		// provider sent none or sent one that was not kept, so the log is the
		// only place that tells the two apart.
		$prompt                            = $this->prompt();
		$prompt['url']                     = self::SCRIPT_URL;
		$prompt['meta']['links'][1]['url'] = 'data:text/html,<script>alert(1)</script>';

		$log = $this->log_of( fn() => $this->select( $prompt ) );

		$this->assertSame( 1, substr_count( $log, '[VIP Workflows]' ) );
		$this->assertStringContainsString( 'Removed 2 ', $log );
		$this->assertStringContainsString( self::PROVIDER, $log, 'The log names the provider the prompt came from.' );
		$this->assertStringNotContainsString( 'alert', $log, 'The addresses are the part that was not trusted, and stay out of the log.' );
	}

	public function test_a_selection_that_removed_nothing_writes_nothing_to_the_log(): void {
		// A web address is kept, and an empty string is not an address at all.
		$prompt                            = $this->prompt();
		$prompt['meta']['links'][0]['url'] = '';

		$this->assertSame( '', $this->log_of( fn() => $this->select( $prompt ) ) );
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
	public static function prompts_without_the_documented_link_shape(): array {
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
