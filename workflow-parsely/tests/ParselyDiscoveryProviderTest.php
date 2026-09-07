<?php
/**
 * Parse.ly as a story discovery provider.
 *
 * The fixtures here mirror a real `/analytics/posts` response, captured from the
 * live API rather than written from the endpoint's type declaration. Three bugs
 * in this integration came from fixtures that encoded what the boundary was
 * expected to return instead of what it does — most recently a `NO_LINKS` error
 * mocked as an empty array, which made a shipped failure path look green.
 *
 * Two details from that capture drive tests below and would not be guessed:
 * every row's `url` carries an `itm_source=parsely-api` tracking parameter, and
 * `metrics` holds only the keys implied by the requested sort, so `visitors` and
 * `avg_engaged` are frequently absent.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use VIPWorkflows\Discovery\DiscoveryProviderRegistry;
use WorkflowParsely\Discovery\ParselyDiscoveryProvider;
use WP_Error;
use Yoast\WPTestUtils\WPIntegration\TestCase;

/**
 * Stands in for the Content API service's posts half.
 *
 * Duck-typed rather than a subclass, for the same reason as the other fakes in
 * this suite: the real service's constructor wants a configured Parsely instance
 * and would reach for the network.
 */
class FakePostsService {

	/** @var mixed What get_posts() returns. */
	public $result;

	/** @var int Call count. */
	public int $calls = 0;

	/** @var array Params of the most recent call. */
	public array $last_params = array();

	public function __construct( $result ) {
		$this->result = $result;
	}

	public function get_posts( array $params = array() ) {
		++$this->calls;
		$this->last_params = $params;
		return $this->result;
	}
}

class ParselyDiscoveryProviderTest extends TestCase {

	private const SLUG = 'parsely-trending';

	/** @var FakePostsService|null */
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
		remove_all_filters( 'workflow_parsely_content_service' );
		delete_option( 'parsely' );
		$this->fake = null;

		parent::tear_down();
	}

	/**
	 * @param mixed $result Value the fake returns.
	 */
	private function fake_service( $result ): FakePostsService {
		$this->fake = new FakePostsService( $result );
		add_filter( 'workflow_parsely_content_service', fn() => $this->fake );

		return $this->fake;
	}

	/**
	 * One row shaped exactly like the live API returns.
	 *
	 * @param array $overrides Keys to replace or, with a null value, remove.
	 * @return array
	 */
	private function post_row( array $overrides = array() ): array {
		$row = array(
			'title'                   => 'Coffee Futures Spike as Brazil Harvest Falters',
			'url'                     => 'https://example.com/coffee-futures/?itm_source=parsely-api',
			'link'                    => 'https://example.com/coffee-futures/?itm_source=parsely-api',
			'author'                  => 'Jane Doe',
			'authors'                 => array( 'Jane Doe' ),
			'section'                 => 'Business',
			'tags'                    => array( 'Commodities', 'Brazil' ),
			'pub_date'                => '2026-07-30T09:30:03',
			'image_url'               => 'https://example.com/coffee.jpg',
			'thumb_url_medium'        => 'https://images.parsely.com/abc/85x85/smart/coffee.jpg',
			'metrics'                 => array(
				'views'               => 1240,
				'recirculation_rate'  => 0.12,
			),
			'full_content_word_count' => 820,
			'metadata'                => '',
			'_hits'                   => 1240,
		);

		foreach ( $overrides as $key => $value ) {
			if ( null === $value ) {
				unset( $row[ $key ] );
				continue;
			}

			$row[ $key ] = $value;
		}

		return $row;
	}

	/**
	 * @param array $rows Rows the fake API returns.
	 * @return array Normalized prompts.
	 */
	private function recommend( array $rows, array $config = array() ): array {
		$this->fake_service( $rows );

		return ParselyDiscoveryProvider::recommend( $config );
	}

	// ── Registration ─────────────────────────────────────────────────

	public function test_provider_is_registered(): void {
		$this->assertNotNull(
			DiscoveryProviderRegistry::get_instance()->get( self::SLUG ),
			'The provider must register on vip_workflows_register_discovery_providers.'
		);
	}

	public function test_declares_recommend(): void {
		$provider = DiscoveryProviderRegistry::get_instance()->get( self::SLUG );

		$this->assertContains( 'recommend', $provider['features'] );
	}

	/**
	 * The analytics endpoint ranks content; it does not answer a text query. The
	 * discovery spec allows recommend-only providers precisely so this does not
	 * have to be faked with client-side filtering that would look like search
	 * and behave nothing like it.
	 */
	public function test_does_not_declare_search(): void {
		$provider = DiscoveryProviderRegistry::get_instance()->get( self::SLUG );

		$this->assertNotContains( 'search', $provider['features'] );
	}

	public function test_has_a_seed_callback(): void {
		$provider = DiscoveryProviderRegistry::get_instance()->get( self::SLUG );

		$this->assertIsCallable( $provider['callbacks']['seed'] ?? null );
	}

	public function test_is_claimed_by_the_parsely_assistant_card(): void {
		// get_all() returns a list of entries, not a slug-keyed map.
		$entries = \VIPWorkflows\Assistants\AssistantRegistry::get_instance()->get_all();

		$parsely = array_values(
			array_filter( $entries, static fn( array $e ) => 'parsely' === $e['slug'] )
		);

		$this->assertNotEmpty( $parsely, 'The Parse.ly card must be present.' );
		$this->assertContains(
			self::SLUG,
			$parsely[0]['provider_slugs'],
			'An unclaimed provider gets its own auto-generated card, splitting Parse.ly across two.'
		);
	}

	/**
	 * The other half of the claim: exactly one card, not a claimed one plus an
	 * auto-generated twin.
	 */
	public function test_does_not_also_appear_as_its_own_card(): void {
		$entries = \VIPWorkflows\Assistants\AssistantRegistry::get_instance()->get_all();

		$slugs = array_column( $entries, 'slug' );

		$this->assertNotContains( self::SLUG, $slugs );
	}

	public function test_reports_unavailable_without_credentials(): void {
		delete_option( 'parsely' );

		$this->assertFalse(
			DiscoveryProviderRegistry::get_instance()->is_available( self::SLUG ),
			'The provider must not offer cards it cannot fill.'
		);
	}

	public function test_reports_available_with_credentials(): void {
		$this->assertTrue(
			DiscoveryProviderRegistry::get_instance()->is_available( self::SLUG )
		);
	}

	// ── Normalization ────────────────────────────────────────────────

	public function test_returns_a_prompt_per_post(): void {
		$prompts = $this->recommend(
			array(
				$this->post_row(),
				$this->post_row( array( 'title' => 'Second Story' ) ),
			)
		);

		$this->assertCount( 2, $prompts );
	}

	public function test_prompt_carries_the_required_fields(): void {
		$prompt = $this->recommend( array( $this->post_row() ) )[0];

		// id, provider and title are the discovery framework's required three.
		$this->assertNotEmpty( $prompt['id'] );
		$this->assertSame( self::SLUG, $prompt['provider'] );
		$this->assertSame( 'Coffee Futures Spike as Brazil Harvest Falters', $prompt['title'] );
	}

	public function test_prompt_ids_are_unique_across_the_set(): void {
		$prompts = $this->recommend(
			array(
				$this->post_row(),
				$this->post_row(
					array(
						'title' => 'Second Story',
						'url'   => 'https://example.com/second/?itm_source=parsely-api',
					)
				),
			)
		);

		$ids = array_column( $prompts, 'id' );

		$this->assertSame(
			$ids,
			array_unique( $ids ),
			'Duplicate ids make React collapse cards and break selection.'
		);
	}

	/**
	 * Every row the live API returns carries this parameter. Left in place it
	 * would be shown to the editor, saved into the seed, and eventually
	 * published as a link to our own site with Parse.ly's tracking on it.
	 */
	public function test_the_parsely_tracking_parameter_is_stripped_from_the_url(): void {
		$prompt = $this->recommend( array( $this->post_row() ) )[0];

		$this->assertStringNotContainsString( 'itm_source', $prompt['url'] );
		$this->assertSame( 'https://example.com/coffee-futures/', $prompt['url'] );
	}

	public function test_other_query_parameters_are_preserved(): void {
		$prompt = $this->recommend(
			array(
				$this->post_row(
					array( 'url' => 'https://example.com/story/?page=2&itm_source=parsely-api' )
				),
			)
		)[0];

		$this->assertStringContainsString( 'page=2', $prompt['url'] );
		$this->assertStringNotContainsString( 'itm_source', $prompt['url'] );
	}

	/**
	 * Parse.ly has no description or excerpt field, so the card's second line has
	 * to be composed. An empty one leaves a title floating on a blank card.
	 */
	public function test_description_is_composed_from_what_parsely_does_return(): void {
		$prompt = $this->recommend( array( $this->post_row() ) )[0];

		$this->assertNotEmpty( $prompt['description'] );
		$this->assertStringContainsString( 'Business', $prompt['description'] );
		$this->assertStringContainsString( '1,240', $prompt['description'] );
	}

	public function test_tags_and_publication_date_carry_through(): void {
		$prompt = $this->recommend( array( $this->post_row() ) )[0];

		$this->assertSame( array( 'Commodities', 'Brazil' ), $prompt['tags'] );
		$this->assertSame( '2026-07-30T09:30:03', $prompt['date'] );
	}

	public function test_metrics_are_kept_in_meta_for_the_seed_and_the_card(): void {
		$prompt = $this->recommend( array( $this->post_row() ) )[0];

		$this->assertSame( 1240, $prompt['meta']['views'] );
		$this->assertSame( 'Jane Doe', $prompt['meta']['author'] );
		$this->assertSame( 'Business', $prompt['meta']['section'] );
	}

	/**
	 * Provider-defined, per the discovery spec. Rank is the only signal Parse.ly
	 * gives us, and the response is already sorted.
	 */
	public function test_the_leading_posts_are_marked_as_top_stories(): void {
		$prompts = $this->recommend(
			array(
				$this->post_row( array( 'title' => 'First' ) ),
				$this->post_row( array( 'title' => 'Second' ) ),
				$this->post_row( array( 'title' => 'Third' ) ),
				$this->post_row( array( 'title' => 'Fourth' ) ),
				$this->post_row( array( 'title' => 'Fifth' ) ),
			)
		);

		$this->assertSame( 'top_story', $prompts[0]['importance'] );
		$this->assertSame( 'normal', $prompts[4]['importance'] );
	}

	// ── Request shaping ──────────────────────────────────────────────

	public function test_requests_a_traffic_window_and_a_sort(): void {
		$fake = $this->fake_service( array( $this->post_row() ) );

		ParselyDiscoveryProvider::recommend( array() );

		$this->assertSame( 1, $fake->calls );
		$this->assertNotEmpty( $fake->last_params['period_start'] ?? '' );
		$this->assertNotEmpty( $fake->last_params['sort'] ?? '' );
	}

	public function test_the_configured_limit_and_window_are_honoured(): void {
		$fake = $this->fake_service( array( $this->post_row() ) );

		ParselyDiscoveryProvider::recommend(
			array(
				'limit'       => 4,
				'period_days' => 3,
			)
		);

		$this->assertSame( 4, $fake->last_params['limit'] ?? null );
		$this->assertSame( '3d', $fake->last_params['period_start'] ?? null );
	}

	// ── Edge cases ───────────────────────────────────────────────────

	public function test_no_trending_content_is_an_empty_result_not_an_error(): void {
		$prompts = $this->recommend( array() );

		$this->assertSame( array(), $prompts );
	}

	/**
	 * The dev site returns rows with no tags and no author at all. A card that
	 * cannot be built from a thin row is worse than a plainer card.
	 */
	public function test_a_row_missing_optional_fields_still_yields_a_valid_prompt(): void {
		$prompt = $this->recommend(
			array(
				$this->post_row(
					array(
						'tags'             => array(),
						'author'           => '',
						'authors'          => array(),
						'section'          => '',
						'image_url'        => null,
						'thumb_url_medium' => null,
					)
				),
			)
		)[0];

		$this->assertNotEmpty( $prompt['title'] );
		$this->assertNotEmpty( $prompt['id'] );
		$this->assertIsString( $prompt['description'] );
	}

	/**
	 * `metrics` only carries the keys implied by the requested sort. Reading a
	 * missing one must not emit a notice or print an empty figure on the card.
	 */
	public function test_absent_metrics_do_not_break_the_prompt(): void {
		$prompt = $this->recommend(
			array( $this->post_row( array( 'metrics' => array() ) ) )
		)[0];

		$this->assertIsString( $prompt['description'] );
		$this->assertSame( 0, $prompt['meta']['views'] );
	}

	public function test_a_row_with_no_title_is_dropped(): void {
		$prompts = $this->recommend(
			array(
				$this->post_row( array( 'title' => '' ) ),
				$this->post_row( array( 'title' => 'Has A Title' ) ),
			)
		);

		$this->assertCount( 1, $prompts );
		$this->assertSame( 'Has A Title', $prompts[0]['title'] );
	}

	public function test_a_non_list_payload_yields_no_prompts(): void {
		$this->assertSame( array(), $this->recommend( array( 'unexpected' => 'shape' ) ) );
	}

	// ── Error paths ──────────────────────────────────────────────────

	/**
	 * The discovery controller catches throwables per provider and coerces a
	 * non-array to empty, so a failure here degrades this section alone. Return
	 * the empty array directly rather than relying on that: a WP_Error escaping
	 * into the REST response would be serialized into the ideation screen.
	 */
	public function test_a_parsely_error_yields_no_prompts_rather_than_propagating(): void {
		$this->fake_service( new WP_Error( 'parsely_api_error', 'Parse.ly rejected the request.' ) );

		$this->assertSame( array(), ParselyDiscoveryProvider::recommend( array() ) );
	}

	public function test_missing_credentials_yields_no_prompts(): void {
		delete_option( 'parsely' );

		$this->assertSame( array(), ParselyDiscoveryProvider::recommend( array() ) );
	}

	// ── Seed generation ──────────────────────────────────────────────

	public function test_seed_names_the_story_it_came_from(): void {
		$prompt = $this->recommend( array( $this->post_row() ) )[0];

		$seed = ParselyDiscoveryProvider::seed( $prompt );

		$this->assertStringContainsString(
			'Coffee Futures Spike as Brazil Harvest Falters',
			$seed
		);
	}

	/**
	 * The seed is what ideation actually works from. A bare headline gives the
	 * assistants nothing to distinguish "write this story" from "this story
	 * already ran and did well — find the next one".
	 */
	public function test_seed_frames_the_story_as_already_published(): void {
		$prompt = $this->recommend( array( $this->post_row() ) )[0];

		$seed = ParselyDiscoveryProvider::seed( $prompt );

		$this->assertMatchesRegularExpression(
			'/published|already ran|follow|performed/i',
			$seed,
			'Without this framing the seed reads as a commission for a story we ran last week.'
		);
	}

	/**
	 * Found by running the provider against the live API, where the dev site's
	 * top post had exactly one view: "It has drawn 1 views in Uncategorized."
	 * Every fixture here carried a comfortable four-figure count, so no test
	 * could have caught it. A new site's first days are all single digits.
	 */
	public function test_a_single_view_reads_as_singular_everywhere(): void {
		$prompt = $this->recommend(
			array( $this->post_row( array( 'metrics' => array( 'views' => 1 ) ) ) )
		)[0];

		$this->assertStringNotContainsString( '1 views', $prompt['description'] );
		$this->assertStringNotContainsString(
			'1 views',
			ParselyDiscoveryProvider::seed( $prompt )
		);
	}

	public function test_seed_survives_a_prompt_with_only_a_title(): void {
		$seed = ParselyDiscoveryProvider::seed(
			array(
				'id'       => 'parsely-trending-abc',
				'provider' => self::SLUG,
				'title'    => 'A Bare Headline',
			)
		);

		$this->assertStringContainsString( 'A Bare Headline', $seed );
	}
}
