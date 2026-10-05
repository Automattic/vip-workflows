<?php
/**
 * URLs supplied by a research provider, at the point ideation stores them.
 *
 * A research agent returns cards built from a provider's payload, and each card
 * can carry a link (`url`) and two image addresses (`image`, `thumbnail`). The
 * orchestrator keeps a run's cards in four places: the `vip_ideation_sources`
 * table, the per-assistant project meta, the one-hour provider cache, and the
 * result it returns to the screen. A URL that is not a web address must reach
 * none of them — and must not take the rest of its card with it, because one
 * bad field is no reason to discard a usable result.
 *
 * Unit rather than integration because the claim is about the values the
 * orchestrator hands to each store, which a recording double observes directly.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionMethod;
use VIPWorkflows\Ideation\Assistants\IdeationOrchestrator;

require_once __DIR__ . '/../../../includes/integrations/class-guideline-context-provider.php';
require_once __DIR__ . '/../../../includes/integrations/class-safe-url.php';
require_once __DIR__ . '/../../../includes/ideation/assistants/class-ideation-orchestrator.php';

/**
 * @covers \VIPWorkflows\Ideation\Assistants\IdeationOrchestrator
 */
class IdeationProviderUrlStorageTest extends TestCase {

	private const PROJECT_ID = 42;

	private const ASSISTANT = 'test/web-search';

	private const SCRIPT_URL = 'javascript:alert(1)';

	/**
	 * Hand back whatever `$wpdb` was, so the double cannot leak into a later test.
	 *
	 * @var mixed
	 */
	private $original_wpdb;

	/**
	 * The research agent the orchestrator finds for the run.
	 *
	 * @var object
	 */
	private object $agent;

	/**
	 * What the provider cache holds before the run; false for a cache miss.
	 *
	 * @var array|false
	 */
	private $cached = false;

	/**
	 * Every transient the run wrote, by key.
	 *
	 * @var array<string, mixed>
	 */
	private array $transients = array();

	/**
	 * Every post meta value the run wrote, by key.
	 *
	 * @var array<string, mixed>
	 */
	private array $meta = array();

	protected function set_up() {
		parent::set_up();

		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;

		global $wpdb;
		$wpdb = new class() {
			public string $prefix = 'wp_';

			public string $last_error = '';

			public int $insert_id = 0;

			/** @var array<int, array{table: string, row: array}> */
			public array $inserted = array();

			public function prepare( string $query, ...$args ): string {
				return $query;
			}

			// No row is ever on file, so every card reaches the insert.
			public function get_var( string $query ): string {
				return '0';
			}

			public function insert( string $table, array $row, $format = null ): int {
				$this->inserted[] = array(
					'table' => $table,
					'row'   => $row,
				);
				++$this->insert_id;

				return 1;
			}
		};

		Functions\when( 'is_wp_error' )->alias( fn( $thing ) => $thing instanceof \WP_Error );
		Functions\when( 'get_current_user_id' )->justReturn( 5 );
		Functions\when( 'get_post_meta' )->justReturn( '' );
		Functions\when( 'update_post_meta' )->alias(
			function ( $post_id, $key, $value ) {
				$this->meta[ $key ] = $value;

				return true;
			}
		);
		Functions\when( 'get_transient' )->alias( fn() => $this->cached );
		Functions\when( 'set_transient' )->alias(
			function ( $key, $value ) {
				$this->transients[ $key ] = $value;

				return true;
			}
		);
		Functions\when( 'wp_get_ability' )->alias( fn() => $this->agent );
	}

	protected function tear_down() {
		$GLOBALS['wpdb'] = $this->original_wpdb;

		parent::tear_down();
	}

	/**
	 * A web result, in the shape the Web Researcher builds from a search provider.
	 *
	 * @param  array $overrides Fields to replace.
	 * @return array
	 */
	private function article( array $overrides = array() ): array {
		return array_merge(
			array(
				'type'        => 'web-article',
				'source_type' => 'article',
				'origin'      => 'search',
				'title'       => 'Reservoir levels fall for a third year',
				'url'         => 'https://news.example.test/reservoirs',
				'domain'      => 'news.example.test',
				'excerpt'     => 'Levels are at a record low.',
				'content'     => 'Levels are at a record low after a dry winter.',
				'image'       => 'https://news.example.test/reservoirs.jpg',
				'date'        => '2026-09-30',
				'author'      => 'A. Reporter',
				'score'       => 0.91,
				'source'      => 'web-researcher',
			),
			$overrides
		);
	}

	/**
	 * A video result, in the shape the Media Scout builds from a media provider.
	 *
	 * @param  array $overrides Fields to replace.
	 * @return array
	 */
	private function video( array $overrides = array() ): array {
		return array_merge(
			array(
				'type'         => 'video',
				'source_type'  => 'video',
				'origin'       => 'search',
				'title'        => 'Reservoir flyover',
				'url'          => 'https://video.example.test/watch?v=abc',
				'image'        => 'https://video.example.test/poster.jpg',
				'thumbnail'    => 'https://video.example.test/poster.jpg',
				'domain'       => 'video.example.test',
				'duration'     => null,
				'provider'     => 'tavily-video',
				'is_generated' => false,
				'source'       => 'media-scout',
			),
			$overrides
		);
	}

	/**
	 * Register a research agent whose provider returns the given cards.
	 *
	 * @param array $cards Cards the agent returns.
	 */
	private function provider_returns( array $cards ): void {
		$this->agent = new class( $cards ) {
			public int $runs = 0;

			public function __construct( private array $cards ) {}

			public function execute( array $input ): array {
				++$this->runs;

				return array(
					'cards'   => $this->cards,
					'summary' => 'Found sources.',
				);
			}
		};
	}

	/**
	 * Run the agent's first pass for the project, as the ideation screen does.
	 *
	 * @return array The result the REST route hands back to the screen.
	 */
	private function run_agent(): array {
		return ( new IdeationOrchestrator() )->run_initial_assistant( self::PROJECT_ID, self::ASSISTANT );
	}

	/**
	 * Rows the run inserted into the sources table.
	 *
	 * @return array<int, array>
	 */
	private function stored_sources(): array {
		global $wpdb;

		$rows = array();
		foreach ( $wpdb->inserted as $insert ) {
			if ( 'wp_vip_ideation_sources' === $insert['table'] ) {
				$rows[] = $insert['row'];
			}
		}

		return $rows;
	}

	/**
	 * The run result the orchestrator kept in project meta, still encoded.
	 *
	 * @return string
	 */
	private function stored_result(): string {
		return (string) $this->meta[ '_vip_ideation_asst_' . str_replace( '/', '__', self::ASSISTANT ) ];
	}

	// ─── The sources table ───────────────────────────────────────

	public function test_a_script_url_is_not_stored_and_the_rest_of_the_card_is(): void {
		$this->provider_returns( array( $this->article( array( 'url' => self::SCRIPT_URL ) ) ) );

		$this->run_agent();

		$rows = $this->stored_sources();

		$this->assertCount( 1, $rows );
		$this->assertNull( $rows[0]['url'] );
		$this->assertSame( 'Reservoir levels fall for a third year', $rows[0]['title'] );
		$this->assertSame( 'Levels are at a record low.', $rows[0]['excerpt'] );
		$this->assertSame( 'https://news.example.test/reservoirs.jpg', $rows[0]['image'] );
	}

	public function test_a_url_that_a_browser_reads_as_script_is_not_stored(): void {
		// A browser discards the tab before it reads the scheme.
		$this->provider_returns( array( $this->article( array( 'url' => "\tjavascript:alert(1)" ) ) ) );

		$this->run_agent();

		$this->assertNull( $this->stored_sources()[0]['url'] );
	}

	public function test_a_script_image_is_not_stored(): void {
		$this->provider_returns(
			array( $this->article( array( 'image' => 'data:text/html,<script>alert(1)</script>' ) ) )
		);

		$this->run_agent();

		$rows = $this->stored_sources();

		$this->assertNull( $rows[0]['image'] );
		$this->assertSame( 'https://news.example.test/reservoirs', $rows[0]['url'] );
	}

	public function test_a_web_thumbnail_stands_in_for_a_script_image(): void {
		// The image column takes the thumbnail when the card has no image.
		$this->provider_returns( array( $this->video( array( 'image' => self::SCRIPT_URL ) ) ) );

		$this->run_agent();

		$this->assertSame( 'https://video.example.test/poster.jpg', $this->stored_sources()[0]['image'] );
	}

	public function test_a_script_thumbnail_is_not_stored(): void {
		// The Media Scout sends a video's poster as both fields.
		$this->provider_returns(
			array(
				$this->video(
					array(
						'image'     => self::SCRIPT_URL,
						'thumbnail' => self::SCRIPT_URL,
					)
				),
			)
		);

		$this->run_agent();

		$rows = $this->stored_sources();

		$this->assertNull( $rows[0]['image'] );
		$this->assertArrayNotHasKey( 'thumbnail', json_decode( $rows[0]['ai_analysis'], true ) );
		$this->assertSame( 'tavily-video', json_decode( $rows[0]['ai_analysis'], true )['provider'] );
	}

	public function test_web_addresses_are_stored_as_the_provider_sent_them(): void {
		$this->provider_returns( array( $this->video() ) );

		$this->run_agent();

		$rows = $this->stored_sources();

		$this->assertSame( 'https://video.example.test/watch?v=abc', $rows[0]['url'] );
		$this->assertSame( 'https://video.example.test/poster.jpg', $rows[0]['image'] );
		$this->assertSame(
			'https://video.example.test/poster.jpg',
			json_decode( $rows[0]['ai_analysis'], true )['thumbnail']
		);
	}

	/**
	 * Call the storage step on its own, as image generation does.
	 *
	 * @param array $cards Cards to store.
	 */
	private function store( array $cards ): void {
		$store = new ReflectionMethod( IdeationOrchestrator::class, 'store_cards_as_sources' );

		$store->invoke( new IdeationOrchestrator(), self::PROJECT_ID, $cards, 5, 'vip-workflows/media-scout' );
	}

	public function test_the_storage_step_checks_the_url_for_every_caller(): void {
		// Not every card reaches the table through a run, so the step cannot
		// rely on the run to have checked it.
		$this->store( array( $this->article( array( 'url' => self::SCRIPT_URL ) ) ) );

		$rows = $this->stored_sources();

		$this->assertCount( 1, $rows );
		$this->assertNull( $rows[0]['url'] );
	}

	public function test_two_cards_that_differ_only_in_a_url_that_was_not_stored_are_one_source(): void {
		// With no URL left, a card is identified by its title and body — so the
		// table does not gain two rows that read the same.
		$this->store(
			array(
				$this->article( array( 'url' => 'javascript:alert(1)' ) ),
				$this->article( array( 'url' => 'javascript:alert(2)' ) ),
			)
		);

		$this->assertCount( 1, $this->stored_sources() );
	}

	// ─── Project meta ────────────────────────────────────────────

	public function test_the_result_kept_in_project_meta_carries_no_script_url(): void {
		$this->provider_returns(
			array(
				$this->video(
					array(
						'url'       => self::SCRIPT_URL,
						'image'     => self::SCRIPT_URL,
						'thumbnail' => self::SCRIPT_URL,
					)
				),
			)
		);

		$this->run_agent();

		$stored = json_decode( $this->stored_result(), true );

		$this->assertStringNotContainsString( 'javascript:', $this->stored_result() );
		$this->assertSame( 'completed', $stored['status'] );
		$this->assertSame( 'Reservoir flyover', $stored['cards'][0]['title'] );
		$this->assertNull( $stored['cards'][0]['url'] );
	}

	// ─── The result returned to the screen ───────────────────────

	public function test_the_result_returned_to_the_screen_carries_no_script_url(): void {
		$this->provider_returns(
			array(
				$this->video(
					array(
						'url'       => self::SCRIPT_URL,
						'image'     => self::SCRIPT_URL,
						'thumbnail' => self::SCRIPT_URL,
					)
				),
			)
		);

		$result = $this->run_agent();

		$this->assertSame( 1, $result['card_count'] );
		$this->assertSame( 'Reservoir flyover', $result['cards'][0]['title'] );
		$this->assertNull( $result['cards'][0]['url'] );
		$this->assertNull( $result['cards'][0]['image'] );
		$this->assertNull( $result['cards'][0]['thumbnail'] );
	}

	public function test_the_result_returned_to_the_screen_keeps_web_addresses(): void {
		$this->provider_returns( array( $this->video() ) );

		$result = $this->run_agent();

		$this->assertSame( 'https://video.example.test/watch?v=abc', $result['cards'][0]['url'] );
		$this->assertSame( 'https://video.example.test/poster.jpg', $result['cards'][0]['image'] );
		$this->assertSame( 'https://video.example.test/poster.jpg', $result['cards'][0]['thumbnail'] );
	}

	// ─── The provider cache ──────────────────────────────────────

	public function test_the_cached_provider_output_carries_no_script_url(): void {
		$this->provider_returns( array( $this->article( array( 'url' => self::SCRIPT_URL ) ) ) );

		$this->run_agent();

		$this->assertCount( 1, $this->transients );

		$cached = array_values( $this->transients )[0];

		$this->assertNull( $cached['cards'][0]['url'] );
		$this->assertSame( 'Reservoir levels fall for a third year', $cached['cards'][0]['title'] );
		$this->assertSame( 'Found sources.', $cached['summary'] );
	}

	public function test_output_cached_before_the_check_existed_is_checked_when_it_is_read(): void {
		$this->cached = array(
			'cards'   => array( $this->article( array( 'url' => self::SCRIPT_URL ) ) ),
			'summary' => 'Found sources.',
		);
		$this->provider_returns( array() );

		$result = $this->run_agent();

		$this->assertSame( 0, $this->agent->runs, 'The run did not use the cached output.' );
		$this->assertNull( $this->stored_sources()[0]['url'] );
		$this->assertNull( $result['cards'][0]['url'] );
		$this->assertStringNotContainsString( 'javascript:', $this->stored_result() );
	}

	public function test_reading_the_cache_does_not_write_it_again(): void {
		// Writing it back on a hit would restart the hour on every run, and the
		// provider would never be asked again.
		$this->cached = array(
			'cards'   => array( $this->article() ),
			'summary' => 'Found sources.',
		);
		$this->provider_returns( array() );

		$this->run_agent();

		$this->assertSame( array(), $this->transients );
	}

	public function test_a_run_that_found_nothing_is_not_cached(): void {
		$this->provider_returns( array() );

		$this->run_agent();

		$this->assertSame( array(), $this->transients );
	}
}
