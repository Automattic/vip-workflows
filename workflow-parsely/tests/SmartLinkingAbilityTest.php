<?php
/**
 * Smart Linking ability.
 *
 * Exercises the adapter, not wp-parsely's HTTP parsing. The Suggestions API
 * service is swapped for a fake through the `workflow_parsely_suggestions_service`
 * filter, so these assertions are about what this plugin does with a result:
 * shape it, record it, and fail safely. Whether wp-parsely correctly deserializes
 * Parse.ly's wire format is wp-parsely's own concern and its own test suite.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use WP_Error;
use Yoast\WPTestUtils\WPIntegration\TestCase;

/**
 * Stands in for Parsely\Services\Suggestions_API\Suggestions_API_Service.
 *
 * Not a subclass: the real service's constructor requires a configured Parsely
 * instance and would reach for the network. Duck typing is enough because the
 * adapter only ever calls get_smart_links().
 */
class FakeSuggestionsService {

	/** @var mixed What get_smart_links() hands back. */
	public $result;

	/** @var int How many times get_smart_links() was called. */
	public int $calls = 0;

	/** @var string|null Content of the most recent call. */
	public ?string $last_content = null;

	public function __construct( $result ) {
		$this->result = $result;
	}

	public function get_smart_links( string $content, $options = array() ) {
		++$this->calls;
		$this->last_content = $content;
		return $this->result;
	}
}

/**
 * A Smart_Link-shaped double exposing the to_array() the adapter reads.
 */
class FakeSmartLink {

	/** @var array */
	private array $data;

	public function __construct( array $data ) {
		$this->data = $data;
	}

	public function to_array(): array {
		return $this->data;
	}
}

class SmartLinkingAbilityTest extends TestCase {

	private const ABILITY_ID = 'workflow-parsely/smart-linking';

	/** @var FakeSuggestionsService|null */
	private $fake = null;

	public function set_up(): void {
		parent::set_up();

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
	 * Install a fake Suggestions API service returning $result.
	 *
	 * @param mixed $result Value the fake returns from get_smart_links().
	 */
	private function fake_service( $result ): FakeSuggestionsService {
		$this->fake = new FakeSuggestionsService( $result );

		add_filter(
			'workflow_parsely_suggestions_service',
			fn() => $this->fake
		);

		return $this->fake;
	}

	/**
	 * Build a Smart_Link-shaped double.
	 */
	private function smart_link( string $text, string $href ): FakeSmartLink {
		return new FakeSmartLink(
			array(
				'uid'    => md5( $text . $href ),
				'href'   => array(
					'raw' => $href,
					'itm' => $href,
				),
				'title'  => 'Destination',
				'text'   => $text,
				'offset' => 0,
			)
		);
	}

	private function make_post( string $content ): int {
		return self::factory()->post->create(
			array(
				'post_content' => $content,
				'post_status'  => 'draft',
			)
		);
	}

	/**
	 * Run the ability and return its result array.
	 *
	 * @param array $input Ability input.
	 * @return mixed
	 */
	private function execute( array $input ) {
		return \WorkflowParsely\Abilities\SmartLinking::execute( $input );
	}

	// ── Registration ─────────────────────────────────────────────────

	public function test_ability_is_registered(): void {
		$this->assertNotNull(
			wp_get_ability( self::ABILITY_ID ),
			'Smart Linking must be registered on wp_abilities_api_init.'
		);
	}

	/**
	 * One Parse.ly card, now that a stage agent exists to earn it.
	 *
	 * AssistantRegistry::should_collect_agent_ability() admits an ability only
	 * when its category is `research`, or when it declares `supports: ['stage']`
	 * with `stage_eligible`. The helper ability is neither, so on its own it
	 * rendered no card — correctly, since the Integrations page lists research
	 * assistants and stage agents, not every tool a plugin contributes.
	 *
	 * The Smart Linking Check agent is stage-eligible, so the card now appears.
	 * The count matters more than its presence: both capabilities are named in
	 * one manifest and must group into a single card rather than each spawning
	 * its own.
	 */
	public function test_capabilities_group_into_exactly_one_integrations_card(): void {
		$parsely = array_filter(
			\VIPWorkflow\Assistants\AssistantRegistry::get_instance()->get_all(),
			static fn( $entry ) => 'parsely' === ( $entry['slug'] ?? '' )
		);

		$this->assertCount(
			1,
			$parsely,
			'Every Parse.ly capability belongs on one card, not one card each.'
		);
	}

	public function test_ability_reports_unavailable_without_credentials(): void {
		delete_option( 'parsely' );

		$ability = wp_get_ability( self::ABILITY_ID );

		$this->assertNotTrue(
			$ability->get_availability(),
			'The ability must not present as usable when Parse.ly is unconfigured.'
		);
	}

	// ── Happy paths ──────────────────────────────────────────────────

	public function test_returns_suggested_links_for_linkable_content(): void {
		$this->fake_service(
			array(
				$this->smart_link( 'coffee futures', 'https://example.com/coffee' ),
				$this->smart_link( 'Brazil harvest', 'https://example.com/brazil' ),
			)
		);

		$post_id = $this->make_post( 'A story about coffee futures and the Brazil harvest.' );
		$result  = $this->execute( array( 'post_id' => $post_id ) );

		$this->assertIsArray( $result );
		$this->assertCount( 2, $result['links'], 'Both suggested links must survive adaptation.' );
		$this->assertSame( 'coffee futures', $result['links'][0]['text'] );
		$this->assertSame( 'https://example.com/coffee', $result['links'][0]['href'] );
	}

	public function test_passes_post_content_through_to_parsely(): void {
		$fake    = $this->fake_service( array() );
		$content = 'The content that should reach Parse.ly.';

		$this->execute( array( 'post_id' => $this->make_post( $content ) ) );

		$this->assertSame( 1, $fake->calls, 'Exactly one call per execution.' );
		$this->assertStringContainsString(
			'should reach Parse.ly',
			(string) $fake->last_content,
			'The post body must be what gets analysed.'
		);
	}

	/**
	 * The editor renders from `suggestions`, not `links`.
	 *
	 * HelperResultModal builds its body from a small set of known keys. An
	 * ability returning only structured data contributes none of them and draws
	 * an empty modal while reporting success — which is what shipped, with four
	 * links found and nothing on screen.
	 */
	public function test_result_carries_display_strings_for_the_editor(): void {
		$this->fake_service(
			array(
				$this->smart_link( 'coffee futures', 'https://example.com/coffee' ),
				$this->smart_link( 'Brazil harvest', 'https://example.com/brazil' ),
			)
		);

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Coffee and Brazil.' ) ) );

		$this->assertCount( 2, $result['suggestions'] );
		$this->assertSame( 'coffee futures', $result['suggestions'][0]['label'] );
		$this->assertSame( 'https://example.com/coffee', $result['suggestions'][0]['href'] );
	}

	/**
	 * The destination reads as a page title, not a raw URL.
	 *
	 * Flattening both into one string put five wrapped URLs in front of the
	 * reader, which is what the row shape exists to avoid.
	 */
	public function test_destination_is_named_rather_than_printed_as_a_url(): void {
		$this->fake_service( array( $this->smart_link( 'coffee futures', 'https://example.com/coffee' ) ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Coffee.' ) ) );

		$this->assertSame(
			'Destination',
			$result['suggestions'][0]['meta'],
			"The destination's title belongs in the row, with the URL behind it."
		);
	}

	/**
	 * Some destination beats none when Parse.ly supplies no title.
	 */
	public function test_falls_back_to_the_url_when_the_destination_has_no_title(): void {
		$this->fake_service(
			array(
				new FakeSmartLink(
					array(
						'text'  => 'coffee futures',
						'title' => '',
						'href'  => array( 'raw' => 'https://example.com/coffee' ),
					)
				),
			)
		);

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Coffee.' ) ) );

		$this->assertSame(
			'https://example.com/coffee',
			$result['suggestions'][0]['meta']
		);
	}

	public function test_result_carries_a_one_line_summary(): void {
		$this->fake_service( array( $this->smart_link( 'one', 'https://example.com/1' ) ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( 'one' ) ) );

		$this->assertNotEmpty( $result['summary'] );
		$this->assertStringContainsString( '1', $result['summary'] );
	}

	public function test_empty_result_still_says_something(): void {
		$this->fake_service(
			new WP_Error( 'NO_LINKS', 'Found related content but could not generate a suitable link.' )
		);

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Nothing linkable.' ) ) );

		$this->assertSame( array(), $result['suggestions'] );
		$this->assertNotEmpty(
			$result['summary'],
			'An empty result must still explain itself rather than rendering as a blank modal.'
		);
	}

	/**
	 * Structured links survive alongside the display strings — an agent calling
	 * this ability needs the URLs as data, not as prose.
	 */
	public function test_structured_links_are_kept_for_programmatic_callers(): void {
		$this->fake_service( array( $this->smart_link( 'coffee futures', 'https://example.com/coffee' ) ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Coffee.' ) ) );

		$this->assertSame( 'coffee futures', $result['links'][0]['text'] );
		$this->assertSame( 'https://example.com/coffee', $result['links'][0]['href'] );
	}

	public function test_reports_the_number_of_links_found(): void {
		$this->fake_service( array( $this->smart_link( 'one', 'https://example.com/1' ) ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( 'one' ) ) );

		$this->assertSame( 1, $result['count'], 'The count must match the links returned.' );
	}

	// ── Edge cases ───────────────────────────────────────────────────

	/**
	 * The real API signals "nothing to link" as WP_Error( 'NO_LINKS' ), not as
	 * an empty array. Verified against the live service — an earlier version of
	 * this fixture returned array() and passed while the shipped code would
	 * have reported a failed tool on perfectly healthy content.
	 */
	public function test_no_suitable_link_is_an_empty_result_not_an_error(): void {
		$this->fake_service(
			new WP_Error(
				'NO_LINKS',
				'Found related content but could not generate a suitable link for this passage.'
			)
		);

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Nothing linkable here.' ) ) );

		$this->assertNotInstanceOf(
			WP_Error::class,
			$result,
			'A post with no suitable destination is an ordinary outcome, not a failure.'
		);
		$this->assertSame( array(), $result['links'] );
		$this->assertSame( 0, $result['count'] );
	}

	/**
	 * An empty array is still handled, in case the contract ever softens.
	 */
	public function test_empty_link_list_is_an_empty_result(): void {
		$this->fake_service( array() );

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Nothing linkable here.' ) ) );

		$this->assertNotInstanceOf( WP_Error::class, $result );
		$this->assertSame( 0, $result['count'] );
	}

	/**
	 * NO_DATA stays an error on purpose.
	 *
	 * It means either "this site has not covered the topic" (ordinary) or "there
	 * is no usable data for this site at all" (a wrong Site ID, an untracked
	 * domain). Those are indistinguishable from the code, and reporting the
	 * second as "0 links found" would hide a broken setup behind a healthy
	 * answer. Observed live against a local post on a topic the tracked site
	 * has never published.
	 */
	public function test_no_data_stays_an_error_rather_than_reading_as_empty(): void {
		$this->fake_service(
			new WP_Error( 'NO_DATA', 'Unable to retrieve related content. Please check data availability.' )
		);

		$result = $this->execute( array( 'post_id' => $this->make_post( 'A topic this site has never covered.' ) ) );

		$this->assertInstanceOf(
			WP_Error::class,
			$result,
			'NO_DATA must not be mistaken for an empty result — it can mean a misconfigured site.'
		);
	}

	/**
	 * Parse.ly's own "check data availability" means nothing to a writer, so the
	 * message is replaced with one that serves both the ordinary and the
	 * misconfigured reading.
	 */
	public function test_no_data_message_is_rewritten_for_a_human(): void {
		$this->fake_service(
			new WP_Error( 'NO_DATA', 'Unable to retrieve related content. Please check data availability.' )
		);

		$result = $this->execute( array( 'post_id' => $this->make_post( 'A topic this site has never covered.' ) ) );

		$this->assertStringNotContainsString(
			'check data availability',
			$result->get_error_message(),
			"Parse.ly's raw wording should not reach the editor."
		);
		$this->assertStringContainsString(
			'Site ID',
			$result->get_error_message(),
			'The message must point at the setup cause for the case where it is one.'
		);
	}

	/**
	 * The returned WP_Error must carry no data, or it stops being a failure.
	 *
	 * AbilityExecutor converts a WP_Error whose data is an array into a success
	 * result whose output is that data. An earlier version attached
	 * `parsely_code` for debugging, which flipped this error into a success with
	 * no renderable output and produced a blank modal in the editor. The
	 * ability-level assertions above all still passed, because the conversion
	 * happens a layer up — which is exactly why this one exists.
	 */
	public function test_no_data_error_carries_no_array_data(): void {
		$this->fake_service(
			new WP_Error( 'NO_DATA', 'Unable to retrieve related content. Please check data availability.' )
		);

		$result = $this->execute( array( 'post_id' => $this->make_post( 'A topic this site has never covered.' ) ) );

		$this->assertFalse(
			is_array( $result->get_error_data() ),
			'Array error data would be reinterpreted as a successful result by AbilityExecutor.'
		);
	}

	/**
	 * Everything beyond the two known codes must still fail loudly, or a genuine
	 * outage would look like a post with nothing to link.
	 */
	public function test_other_error_codes_are_not_swallowed(): void {
		$this->fake_service( new WP_Error( 'PARSELY_UNAVAILABLE', 'Service unavailable.' ) );

		$this->assertInstanceOf(
			WP_Error::class,
			$this->execute( array( 'post_id' => $this->make_post( 'Some content.' ) ) ),
			'A real failure must not be mistaken for an empty result.'
		);
	}

	public function test_empty_post_body_returns_empty_without_calling_parsely(): void {
		$fake = $this->fake_service( array( $this->smart_link( 'x', 'https://example.com/x' ) ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( '' ) ) );

		$this->assertSame( 0, $fake->calls, 'An empty body must short-circuit before the network.' );
		$this->assertSame( array(), $result['links'] );
	}

	public function test_whitespace_only_body_returns_empty_without_calling_parsely(): void {
		$fake = $this->fake_service( array( $this->smart_link( 'x', 'https://example.com/x' ) ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( "   \n\t  " ) ) );

		$this->assertSame( 0, $fake->calls, 'Whitespace is not content.' );
		$this->assertSame( array(), $result['links'] );
	}

	// ── Error paths ──────────────────────────────────────────────────

	public function test_parsely_error_surfaces_as_wp_error_with_a_usable_message(): void {
		$this->fake_service( new WP_Error( 'parsely_api_error', 'Parse.ly rejected the request.' ) );

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Some content.' ) ) );

		$this->assertInstanceOf( WP_Error::class, $result, 'A Parse.ly failure must not be swallowed.' );
		$this->assertNotEmpty( $result->get_error_message(), 'The message must say something actionable.' );
	}

	public function test_missing_post_is_an_error_not_a_fatal(): void {
		$this->fake_service( array() );

		$result = $this->execute( array( 'post_id' => 99999999 ) );

		$this->assertInstanceOf(
			WP_Error::class,
			$result,
			'A post_id that does not resolve is a data-integrity error, reported not fataled.'
		);
	}

	public function test_missing_credentials_is_an_error_not_a_fatal(): void {
		delete_option( 'parsely' );

		$result = $this->execute( array( 'post_id' => $this->make_post( 'Some content.' ) ) );

		$this->assertInstanceOf(
			WP_Error::class,
			$result,
			'Executing without credentials must fail the ability, not the request.'
		);
	}

	/**
	 * Required input is required — the repo rule, asserted rather than assumed.
	 */
	public function test_absent_post_id_is_an_error(): void {
		$this->fake_service( array() );

		$this->assertInstanceOf(
			WP_Error::class,
			$this->execute( array() ),
			'A missing post_id must be reported, not defaulted.'
		);
	}
}
