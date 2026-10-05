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
 * A card that a built-in agent makes from the site's own content — a generated
 * image, a post in the archive — carries an address that WordPress made, and
 * such an address can be valid with no scheme or no host. It is stored as an
 * absolute address, not dropped.
 *
 * Unit rather than integration because most of the claim is about the values
 * the orchestrator hands to each store, which a recording double observes
 * directly. Project meta is the exception: WordPress changes a meta value on
 * its way in, so that double does the same, and `ProviderUrlMetaStorageTest`
 * makes the claims that depend on it against the real store.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionMethod;
use VIPWorkflows\AI\CorePrompts;
use VIPWorkflows\AI\PromptRegistry;
use VIPWorkflows\Ideation\Assistants\AiImageProvider;
use VIPWorkflows\Ideation\Assistants\ArchiveScout;
use VIPWorkflows\Ideation\Assistants\IdeationOrchestrator;
use VIPWorkflows\Ideation\Assistants\MediaProviderInterface;
use WordPress\AiClient\AiClient;

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
	 * What the provider cache holds before the run, under whichever key the run
	 * asks for; false for a cache miss.
	 *
	 * @var array|false
	 */
	private $cached = false;

	/**
	 * Every transient the run wrote, by key. A later read of the same key gets
	 * the value back, as it would from WordPress.
	 *
	 * @var array<string, mixed>
	 */
	private array $transients = array();

	/**
	 * The lifetime, in seconds, each transient was written with, by key.
	 *
	 * @var array<string, int>
	 */
	private array $lifetimes = array();

	/**
	 * The project's seed text, which the provider cache is keyed on.
	 *
	 * @var string
	 */
	private string $seed = 'Reservoir levels';

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

			// Every row that was inserted, in the order it was inserted.
			public function get_results( string $query, $output = null ): array {
				return array_column( $this->inserted, 'row' );
			}
		};

		Functions\when( 'is_wp_error' )->alias( fn( $thing ) => $thing instanceof \WP_Error );
		Functions\when( 'get_current_user_id' )->justReturn( 5 );
		Functions\when( 'get_post_meta' )->alias(
			fn( $post_id, $key = '', $single = false ) => '_vip_ideation_seed' === $key ? $this->seed : ''
		);

		/*
		 * WordPress removes the backslashes from a meta value before it stores
		 * it, and `wp_slash()` is how a caller keeps the ones that belong to the
		 * value. The base class makes `wp_slash()` return its argument, which is
		 * only right beside a store that removes nothing. Both behave here as
		 * they do in WordPress, so `$this->meta` holds what the database would.
		 * The table and the transient do not remove backslashes, and neither do
		 * their doubles.
		 */
		Functions\when( 'wp_slash' )->alias( fn( $value ) => is_string( $value ) ? addslashes( $value ) : $value );
		Functions\when( 'update_post_meta' )->alias(
			function ( $post_id, $key, $value ) {
				$this->meta[ $key ] = is_string( $value ) ? stripslashes( $value ) : $value;

				return true;
			}
		);
		Functions\when( 'get_transient' )->alias( fn( $key ) => $this->transients[ $key ] ?? $this->cached );
		Functions\when( 'set_transient' )->alias(
			function ( $key, $value, $expiration = 0 ) {
				$this->transients[ $key ] = $value;
				$this->lifetimes[ $key ]  = $expiration;

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

	public function test_an_empty_address_is_kept_as_the_provider_sent_it(): void {
		// An empty string is how a provider writes "no link" or "no image". It is
		// not an address that failed the check, so nothing about it changes — the
		// thumbnail does not take the place of an image that was sent as empty.
		$this->provider_returns(
			array(
				$this->video(
					array(
						'url'   => '',
						'image' => '',
					)
				),
			)
		);

		$result = $this->run_agent();
		$rows   = $this->stored_sources();

		$this->assertSame( '', $result['cards'][0]['url'] );
		$this->assertSame( '', $result['cards'][0]['image'] );
		$this->assertSame( '', $rows[0]['url'] );
		$this->assertSame( '', $rows[0]['image'] );
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

	// ─── Every card, on every path ───────────────────────────────

	public function test_every_card_of_a_run_is_checked_not_only_the_first(): void {
		$this->provider_returns(
			array(
				$this->article(),
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
		$stored = json_decode( $this->stored_result(), true );
		$cached = array_values( $this->transients )[0];

		$this->assertSame( 'https://news.example.test/reservoirs', $result['cards'][0]['url'] );
		$this->assertNull( $result['cards'][1]['url'] );
		$this->assertNull( $stored['cards'][1]['url'] );
		$this->assertNull( $cached['cards'][1]['url'] );
		$this->assertNull( $this->stored_sources()[1]['url'] );
	}

	public function test_the_storage_step_checks_the_image_and_the_thumbnail_for_every_caller(): void {
		$this->store(
			array(
				$this->video(
					array(
						'image'     => self::SCRIPT_URL,
						'thumbnail' => 'data:text/html,<script>alert(1)</script>',
					)
				),
			)
		);

		$rows = $this->stored_sources();

		$this->assertNull( $rows[0]['image'] );
		$this->assertArrayNotHasKey( 'thumbnail', json_decode( $rows[0]['ai_analysis'], true ) );
		$this->assertSame( 'https://video.example.test/watch?v=abc', $rows[0]['url'] );
	}

	public function test_a_generated_image_is_stored_through_the_same_check(): void {
		// Image generation does not go through a run: it takes its one card from
		// a media provider and hands it to the storage step itself. A generator
		// can return the image inline, as a data: address, which is not stored.
		$generator = new class() implements MediaProviderInterface {
			public function get_id(): string {
				return 'test-generator';
			}

			public function get_name(): string {
				return 'Test generator';
			}

			public function is_configured(): bool {
				return true;
			}

			public function is_generative(): bool {
				return true;
			}

			public function search_media( string $query, int $max_results = 8, array $context = array() ) {
				return array(
					array(
						'url'          => 'data:image/png;base64,iVBORw0KGgo=',
						'title'        => $query,
						'media_type'   => 'image',
						'provider'     => 'test-generator',
						'is_generated' => true,
					),
				);
			}
		};

		Functions\when( 'apply_filters' )->alias(
			fn( $hook, $value ) => 'vip_workflows_media_providers' === $hook ? array( $generator ) : $value
		);

		$card = ( new IdeationOrchestrator() )->generate_image( self::PROJECT_ID, 'A reservoir at dawn' );
		$rows = $this->stored_sources();

		$this->assertCount( 1, $rows );
		$this->assertSame( 'A reservoir at dawn', $rows[0]['title'] );
		$this->assertNull( $rows[0]['url'] );
		$this->assertNull( $rows[0]['image'] );
		$this->assertSame( $rows[0], $card, 'The route answers with the row that was stored.' );
	}

	// ─── Addresses that WordPress made ───────────────────────────

	/**
	 * The built-in image generator, with its write to the media library replaced.
	 *
	 * The write loads WordPress's own image functions from a file, which this
	 * suite does not have. Everything after the write is the generator's own
	 * code: it asks WordPress for the address of the attachment it stored.
	 *
	 * @return AiImageProvider
	 */
	private function image_generator(): AiImageProvider {
		return new class() extends AiImageProvider {
			private int $attachment_id = 100;

			protected function save_to_media_library( string $data, string $filename, string $mime_type ): int|\WP_Error {
				return ++$this->attachment_id;
			}
		};
	}

	public function test_a_generated_image_keeps_its_address_on_a_site_with_relative_upload_addresses(): void {
		// WordPress makes the address of the stored image from the site's own
		// settings, and here those leave the host out. The address is the site's
		// own, so it is completed. It is not dropped, as a provider's relative
		// address is: without it the card has no image and nothing to tell it
		// from the next image that the same prompt generates.
		$generator = $this->image_generator();

		AiClient::$generatedImage = new class() {
			public function getBase64Data(): ?string {
				return 'iVBORw0KGgo=';
			}

			public function getUrl(): ?string {
				return null;
			}

			public function getMimeType(): string {
				return 'image/png';
			}
		};

		Functions\when( 'apply_filters' )->alias(
			fn( $hook, $value ) => 'vip_workflows_media_providers' === $hook ? array( $generator ) : $value
		);
		Functions\when( 'wp_generate_password' )->justReturn( 'abc12345' );
		Functions\when( 'wp_get_attachment_url' )->alias(
			fn( int $attachment_id ): string => '/wp-content/uploads/2026/10/ideation-ai-' . $attachment_id . '.png'
		);
		Functions\when( 'site_url' )->justReturn( 'https://newsroom.example.test' );

		$orchestrator = new IdeationOrchestrator();
		$orchestrator->generate_image( self::PROJECT_ID, 'A reservoir at dawn' );
		$orchestrator->generate_image( self::PROJECT_ID, 'A reservoir at dawn' );

		$rows = $this->stored_sources();

		$this->assertCount( 2, $rows );
		$this->assertSame( 'https://newsroom.example.test/wp-content/uploads/2026/10/ideation-ai-101.png', $rows[0]['url'] );
		$this->assertSame( 'https://newsroom.example.test/wp-content/uploads/2026/10/ideation-ai-101.png', $rows[0]['image'] );
		$this->assertSame( 'https://newsroom.example.test/wp-content/uploads/2026/10/ideation-ai-102.png', $rows[1]['url'] );
		$this->assertNotSame(
			$rows[0]['source_id'],
			$rows[1]['source_id'],
			'Two generated images are two sources, although their prompt is the same.'
		);
	}

	/**
	 * Make the built-in Archive Scout the research agent of the run, with one
	 * published post for its search to find.
	 *
	 * The scout asks the AI client to put what it found in order of relevance.
	 * The client's double answers with the one post.
	 */
	private function the_archive_holds_one_post(): void {
		Functions\when( 'get_option' )->alias(
			fn( $name, $fallback = false ) => 'vip_workflows_ai_model' === $name ? 'gpt-4o-mini' : $fallback
		);
		CorePrompts::register( PromptRegistry::get_instance() );
		AiClient::$generatedText = '[0]';

		Functions\when( 'get_posts' )->justReturn(
			array(
				new \WP_Post(
					array(
						'ID'           => 7,
						'post_title'   => 'Reservoir levels fell in 2025',
						'post_excerpt' => 'Levels fell for a second year.',
						'post_date'    => '2025-03-02 09:00:00',
						'post_author'  => 3,
					)
				),
			)
		);
		Functions\when( 'get_the_author_meta' )->justReturn( 'A. Reporter' );

		$this->agent = new class() {
			public function execute( array $input ): array {
				return ArchiveScout::execute( $input );
			}
		};
	}

	public function test_an_archive_article_keeps_its_link_and_thumbnail_on_a_site_with_relative_addresses(): void {
		// This site serves its pages and WordPress from two hosts, which shows
		// what completes what: the link of a post belongs to the pages, and the
		// address of an upload to WordPress.
		$this->the_archive_holds_one_post();
		Functions\when( 'get_permalink' )->justReturn( '/2025/03/reservoir-levels/' );
		Functions\when( 'get_the_post_thumbnail_url' )->justReturn( '/wp-content/uploads/2025/03/reservoir-300x200.jpg' );
		Functions\when( 'home_url' )->justReturn( 'https://www.newsroom.example.test' );
		Functions\when( 'site_url' )->justReturn( 'https://cms.newsroom.example.test' );

		$this->run_agent();

		$rows = $this->stored_sources();

		$this->assertCount( 1, $rows );
		$this->assertSame( 'Reservoir levels fell in 2025', $rows[0]['title'] );
		$this->assertSame( 'https://www.newsroom.example.test/2025/03/reservoir-levels/', $rows[0]['url'] );
		// An archive card has no image of its own, so the column takes the thumbnail.
		$this->assertSame(
			'https://cms.newsroom.example.test/wp-content/uploads/2025/03/reservoir-300x200.jpg',
			$rows[0]['image']
		);
	}

	public function test_an_archive_article_with_no_image_is_stored_with_none_and_nothing_is_logged(): void {
		// WordPress answers `false` for a post with no featured image. That is
		// "no image", not an address that was refused, so the run logs nothing.
		$this->the_archive_holds_one_post();
		Functions\when( 'get_permalink' )->justReturn( 'https://www.newsroom.example.test/2025/03/reservoir-levels/' );
		Functions\when( 'get_the_post_thumbnail_url' )->justReturn( false );
		Functions\when( 'home_url' )->justReturn( 'https://www.newsroom.example.test' );
		Functions\when( 'site_url' )->justReturn( 'https://cms.newsroom.example.test' );

		$log  = $this->log_of( fn() => $this->run_agent() );
		$rows = $this->stored_sources();

		$this->assertCount( 1, $rows );
		$this->assertSame( 'https://www.newsroom.example.test/2025/03/reservoir-levels/', $rows[0]['url'] );
		$this->assertNull( $rows[0]['image'] );
		$this->assertSame( '', $log );
	}

	// ─── The record that an address was removed ──────────────────

	public function test_a_run_that_removed_addresses_says_so_once_in_the_log(): void {
		// A card that lost its link looks the same on the board as a card that
		// never had one, so the log is the only place that shows the provider
		// sent addresses that were not kept. One line for the run: the run checks
		// its cards, and the storage step checks them again.
		$this->provider_returns(
			array(
				$this->article( array( 'url' => self::SCRIPT_URL ) ),
				$this->video(
					array(
						'url'   => 'data:text/html,<script>alert(1)</script>',
						'image' => self::SCRIPT_URL,
					)
				),
			)
		);

		$log = $this->log_of( fn() => $this->run_agent() );

		$this->assertSame( 1, substr_count( $log, '[VIP Workflows]' ) );
		$this->assertStringContainsString( self::ASSISTANT, $log, 'The log names the agent whose provider sent the addresses.' );
		$this->assertStringContainsString( 'project ' . self::PROJECT_ID, $log );
		$this->assertStringContainsString( 'url: 2', $log );
		$this->assertStringContainsString( 'image: 1', $log );
		$this->assertStringNotContainsString( 'alert', $log, 'The addresses are the part that was not trusted, and stay out of the log.' );
	}

	public function test_the_storage_step_says_so_when_it_removed_an_address(): void {
		// Image generation reaches the storage step without a run before it.
		$log = $this->log_of(
			fn() => $this->store( array( $this->article( array( 'image' => self::SCRIPT_URL ) ) ) )
		);

		$this->assertSame( 1, substr_count( $log, '[VIP Workflows]' ) );
		$this->assertStringContainsString( 'vip-workflows/media-scout', $log );
		$this->assertStringContainsString( 'image: 1', $log );
	}

	public function test_a_run_that_removed_nothing_writes_nothing_to_the_log(): void {
		// A web address is kept, and an empty string is not an address at all.
		$this->provider_returns( array( $this->article(), $this->video( array( 'image' => '' ) ) ) );

		$this->assertSame( '', $this->log_of( fn() => $this->run_agent() ) );
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

	public function test_text_in_a_card_cannot_replace_its_checked_url_in_project_meta(): void {
		// A double quote ends a JSON string. If the stored JSON loses the
		// backslash before it, the text after the quote is read as more keys of
		// the card, and the last `url` key is the one a reader gets.
		$text = 'x","url":"javascript:alert(1)","y":"';
		$this->provider_returns( array( $this->article( array( 'excerpt' => $text ) ) ) );

		$this->run_agent();

		$stored = json_decode( $this->stored_result(), true );

		$this->assertSame( 'https://news.example.test/reservoirs', $stored['cards'][0]['url'] );
		$this->assertSame( $text, $stored['cards'][0]['excerpt'] );
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

	public function test_a_second_run_for_the_same_seed_is_served_from_the_cache(): void {
		$this->provider_returns( array( $this->article() ) );

		$this->run_agent();
		$this->run_agent();

		$this->assertSame( 1, $this->agent->runs, 'The second run did not read what the first run cached.' );
	}

	public function test_a_run_for_a_different_seed_is_not_served_from_the_cache(): void {
		$this->provider_returns( array( $this->article() ) );

		$this->run_agent();
		$this->seed = 'Flood defences';
		$this->run_agent();

		$this->assertSame( 2, $this->agent->runs, 'One seed was answered with the sources found for another.' );
	}

	public function test_the_cached_output_is_kept_for_an_hour(): void {
		// With no lifetime a transient never expires, and the provider would
		// not be asked about this seed again.
		$this->provider_returns( array( $this->article() ) );

		$this->run_agent();

		$this->assertSame( array( 3600 ), array_values( $this->lifetimes ) );
	}

	public function test_a_run_that_found_nothing_is_not_cached(): void {
		$this->provider_returns( array() );

		$this->run_agent();

		$this->assertSame( array(), $this->transients );
	}
}
