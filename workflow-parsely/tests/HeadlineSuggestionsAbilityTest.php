<?php
/**
 * Headline suggestions from Parse.ly.
 *
 * Suggestions only — no score. Parse.ly's suggestion endpoint is generative
 * (persona and style), and its headline A/B results are not reachable from
 * wp-parsely, so the ability offers alternatives rather than rating the current
 * headline. See the plugin README for the interface inventory behind that.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use WP_Error;
use Yoast\WPTestUtils\WPIntegration\TestCase;

/**
 * Stands in for the Suggestions API service's headline half.
 *
 * Duck-typed rather than a subclass: the real service's constructor wants a
 * configured Parsely instance and would reach for the network.
 */
class FakeHeadlineService {

	/** @var mixed What get_title_suggestions() returns. */
	public $result;

	/** @var int Call count. */
	public int $calls = 0;

	/** @var string|null Content of the most recent call. */
	public ?string $last_content = null;

	/** @var array Options of the most recent call. */
	public array $last_options = array();

	public function __construct( $result ) {
		$this->result = $result;
	}

	public function get_title_suggestions( string $content, $options = array() ) {
		++$this->calls;
		$this->last_content = $content;
		$this->last_options = (array) $options;
		return $this->result;
	}
}

class HeadlineSuggestionsAbilityTest extends TestCase {

	private const ABILITY_ID = 'workflow-parsely/headline-suggestions';

	/** @var FakeHeadlineService|null */
	private $fake = null;

	public function set_up(): void {
		parent::set_up();

		wp_set_current_user(
			self::factory()->user->create( array( 'role' => 'administrator' ) )
		);

		update_option(
			'parsely',
			array(
				'apikey'     => 'example.com',
				'api_secret' => 'a-secret',
			)
		);
	}

	public function tear_down(): void {
		remove_all_filters( 'workflow_parsely_suggestions_service' );
		delete_option( 'parsely' );
		$this->fake = null;

		parent::tear_down();
	}

	/**
	 * @param mixed $result Value the fake returns.
	 */
	private function fake_service( $result ): FakeHeadlineService {
		$this->fake = new FakeHeadlineService( $result );
		add_filter( 'workflow_parsely_suggestions_service', fn() => $this->fake );

		return $this->fake;
	}

	private function make_post( string $content = 'A story about coffee futures and the Brazil harvest.', string $title = 'Original headline' ): int {
		return self::factory()->post->create(
			array(
				'post_content' => $content,
				'post_title'   => $title,
				'post_status'  => 'draft',
			)
		);
	}

	/**
	 * @param array $input Ability input.
	 * @return mixed
	 */
	private function execute( array $input ) {
		return \WorkflowParsely\Abilities\HeadlineSuggestions::execute( $input );
	}

	// ── Registration ─────────────────────────────────────────────────

	public function test_ability_is_registered(): void {
		$this->assertNotNull(
			wp_get_ability( self::ABILITY_ID ),
			'Headline suggestions must register on wp_abilities_api_init.'
		);
	}

	public function test_reachable_from_the_command_palette(): void {
		$meta = wp_get_ability( self::ABILITY_ID )->get_meta();

		$this->assertTrue(
			! empty( $meta['show_in_commands'] ),
			'A writer reaches this while typing a headline, so it belongs in the palette.'
		);
	}

	/**
	 * No verdict, so no gate — the same reasoning as the Smart Linking helper.
	 */
	public function test_is_not_transition_eligible(): void {
		$meta = wp_get_ability( self::ABILITY_ID )->get_meta();

		$this->assertFalse(
			! empty( $meta['transition_eligible'] ),
			'Suggestions carry no pass/fail, so there is nothing for a gate to read.'
		);
	}

	public function test_reports_unavailable_without_credentials(): void {
		delete_option( 'parsely' );

		$this->assertNotTrue(
			wp_get_ability( self::ABILITY_ID )->get_availability(),
			'The ability must not present as usable with Parse.ly unconfigured.'
		);
	}

	// ── Happy paths ──────────────────────────────────────────────────

	public function test_returns_the_suggested_headlines(): void {
		$this->fake_service(
			array(
				'Coffee Futures Spike as Brazil Harvest Falters',
				'Brazil Harvest Shortfall Drives Coffee Prices Up',
			)
		);

		$result = $this->execute( array( 'post_id' => $this->make_post() ) );

		$this->assertSame(
			array(
				'Coffee Futures Spike as Brazil Harvest Falters',
				'Brazil Harvest Shortfall Drives Coffee Prices Up',
			),
			$result['suggestions'],
			'The editor renders from `suggestions`; the strings must arrive intact.'
		);
		$this->assertSame( 2, $result['count'] );
	}

	public function test_result_carries_a_one_line_summary(): void {
		$this->fake_service( array( 'One suggestion' ) );

		$result = $this->execute( array( 'post_id' => $this->make_post() ) );

		$this->assertNotEmpty(
			$result['summary'],
			'A summary keeps the modal from rendering an unexplained list.'
		);
	}

	public function test_sends_the_post_content_for_context(): void {
		$fake = $this->fake_service( array( 'A headline' ) );

		$this->execute(
			array( 'post_id' => $this->make_post( 'The body text Parse.ly should read.' ) )
		);

		$this->assertSame( 1, $fake->calls );
		$this->assertStringContainsString(
			'Parse.ly should read',
			(string) $fake->last_content
		);
	}

	public function test_passes_the_configured_persona_style_and_count(): void {
		$fake = $this->fake_service( array( 'A headline' ) );

		$this->execute(
			array(
				'post_id'   => $this->make_post(),
				'persona'   => 'editor',
				'style'     => 'provocative',
				'max_items' => 4,
			)
		);

		$this->assertSame( 'editor', $fake->last_options['persona'] ?? null );
		$this->assertSame( 'provocative', $fake->last_options['style'] ?? null );
		$this->assertSame( 4, $fake->last_options['max_items'] ?? null );
	}

	// ── Edge cases ───────────────────────────────────────────────────

	public function test_empty_post_body_returns_empty_without_calling_parsely(): void {
		$fake = $this->fake_service( array( 'Should not be reached' ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( '' ) ) );

		$this->assertSame( 0, $fake->calls, 'There is nothing to suggest a headline for.' );
		$this->assertSame( array(), $result['suggestions'] );
	}

	public function test_whitespace_only_body_returns_empty_without_calling_parsely(): void {
		$fake = $this->fake_service( array( 'Should not be reached' ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( "  \n\t " ) ) );

		$this->assertSame( 0, $fake->calls );
		$this->assertSame( array(), $result['suggestions'] );
	}

	public function test_no_suggestions_is_an_empty_result_not_an_error(): void {
		$this->fake_service( array() );

		$result = $this->execute( array( 'post_id' => $this->make_post() ) );

		$this->assertNotInstanceOf( WP_Error::class, $result );
		$this->assertSame( 0, $result['count'] );
		$this->assertNotEmpty(
			$result['summary'],
			'An empty result must still explain itself rather than rendering blank.'
		);
	}

	/**
	 * Parse.ly returns plain strings today. Anything else must not reach the
	 * editor as a stringified array or an object.
	 */
	public function test_non_string_entries_are_discarded(): void {
		$this->fake_service( array( 'A real headline', array( 'nested' ), 42, '' ) );

		$result = $this->execute( array( 'post_id' => $this->make_post() ) );

		$this->assertSame( array( 'A real headline' ), $result['suggestions'] );
	}

	// ── Error paths ──────────────────────────────────────────────────

	public function test_parsely_error_surfaces_as_an_error(): void {
		$this->fake_service( new WP_Error( 'parsely_api_error', 'Parse.ly rejected the request.' ) );

		$result = $this->execute( array( 'post_id' => $this->make_post() ) );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertNotEmpty( $result->get_error_message() );
	}

	public function test_missing_post_is_an_error(): void {
		$this->fake_service( array() );

		$this->assertInstanceOf(
			WP_Error::class,
			$this->execute( array( 'post_id' => 99999999 ) )
		);
	}

	public function test_absent_post_id_is_an_error(): void {
		$this->fake_service( array() );

		$this->assertInstanceOf( WP_Error::class, $this->execute( array() ) );
	}

	public function test_missing_credentials_is_an_error(): void {
		delete_option( 'parsely' );

		$this->assertInstanceOf(
			WP_Error::class,
			$this->execute( array( 'post_id' => $this->make_post() ) )
		);
	}
}
