<?php
/**
 * Reporting a missing Suggestions API entitlement as a requirement.
 *
 * Parse.ly entitles its analytics endpoints and its Suggestions endpoints
 * separately on the same Site ID. A key can have full analytics access and no
 * Suggestions access at all, and four real Site IDs were tested during this
 * work: only one had Suggestions.
 *
 * Nothing surfaced that. `is_configured()` checks only that a Site ID and secret
 * are *present*, so a key with the wrong entitlements looked identical to a
 * working one until a writer clicked a tool — at which point they were shown
 * Parse.ly's own words, "Suggestions API access not enabled for this site."
 *
 * Entitlement cannot be read locally; it is only knowable from a response. So
 * the first refusal is remembered, and availability tells the truth from then on.
 *
 * `get_check_auth()` is not used for this, despite existing for the purpose: it
 * returns a 403 body as a *success* (`{"code":403,"message":"Forbidden"}`, a
 * plain array rather than a WP_Error), so the one method meant to answer this
 * question answers yes when the answer is no.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use VIPWorkflow\Abilities\Availability;
use WorkflowParsely\Entitlement;
use WorkflowParsely\ParselyClient;
use WP_Error;
use Yoast\WPTestUtils\WPIntegration\TestCase;

/**
 * A Suggestions service that refuses the way Parse.ly refuses.
 */
class FakeRefusingService {

	/** @var mixed What every method returns. */
	public $result;

	/** @var int Call count. */
	public int $calls = 0;

	public function __construct( $result ) {
		$this->result = $result;
	}

	public function get_smart_links( string $content, $options = array() ) {
		++$this->calls;
		return $this->result;
	}

	public function get_title_suggestions( string $content, $options = array() ) {
		++$this->calls;
		return $this->result;
	}
}

class SuggestionsEntitlementTest extends TestCase {

	private const SITE_ID = 'example.com';

	public function set_up(): void {
		parent::set_up();

		wp_set_current_user(
			self::factory()->user->create( array( 'role' => 'administrator' ) )
		);

		$this->set_site_id( self::SITE_ID );
	}

	public function tear_down(): void {
		remove_all_filters( 'workflow_parsely_suggestions_service' );
		Entitlement::forget_suggestions_denial();
		delete_option( 'parsely' );

		parent::tear_down();
	}

	private function set_site_id( string $site_id ): void {
		update_option(
			'parsely',
			array(
				'apikey'     => $site_id,
				'api_secret' => 'a-secret',
			)
		);
	}

	/**
	 * Parse.ly's actual refusal, code and wording.
	 */
	private function refusal(): WP_Error {
		return new WP_Error(
			'NO_AUTHORIZATION',
			'Suggestions API access not enabled for this site.'
		);
	}

	/**
	 * @param mixed $result What the service returns.
	 */
	private function fake_service( $result ): FakeRefusingService {
		$fake = new FakeRefusingService( $result );
		add_filter( 'workflow_parsely_suggestions_service', fn() => $fake );

		return $fake;
	}

	// ── Recording the refusal ────────────────────────────────────────

	public function test_a_refusal_is_remembered(): void {
		$this->fake_service( $this->refusal() );

		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertTrue( Entitlement::suggestions_denied() );
	}

	/**
	 * The guard must not swallow or reshape what it inspects. Every caller still
	 * needs the WP_Error it would have received.
	 */
	public function test_the_refusal_still_reaches_the_caller_unchanged(): void {
		$this->fake_service( $this->refusal() );

		$result = ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'NO_AUTHORIZATION', $result->get_error_code() );
	}

	public function test_a_successful_result_passes_through_untouched(): void {
		$this->fake_service( array( 'a link', 'another link' ) );

		$result = ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertSame( array( 'a link', 'another link' ), $result );
		$this->assertFalse( Entitlement::suggestions_denied() );
	}

	/**
	 * NO_DATA means "we have access but nothing to say", which is the state of
	 * any site with a thin archive. Recording it would report a permanent
	 * entitlement problem for a temporary emptiness.
	 */
	public function test_a_no_data_response_is_not_treated_as_a_refusal(): void {
		$this->fake_service(
			new WP_Error( 'NO_DATA', 'Unable to retrieve related content.' )
		);

		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertFalse( Entitlement::suggestions_denied() );
	}

	public function test_an_unrelated_error_is_not_treated_as_a_refusal(): void {
		$this->fake_service( new WP_Error( 'http_request_failed', 'Timed out.' ) );

		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertFalse( Entitlement::suggestions_denied() );
	}

	public function test_every_suggestions_method_is_watched_not_just_one(): void {
		$this->fake_service( $this->refusal() );

		ParselyClient::suggestions()->get_title_suggestions( 'Some content.' );

		$this->assertTrue(
			Entitlement::suggestions_denied(),
			'A writer may reach headline suggestions before smart linking.'
		);
	}

	public function test_the_call_still_reaches_the_service(): void {
		$fake = $this->fake_service( array() );

		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertSame( 1, $fake->calls, 'The guard forwards; it does not intercept.' );
	}

	// ── Scoped to the Site ID ────────────────────────────────────────

	/**
	 * A denial describes one Site ID's entitlements. Swapping the key is exactly
	 * how someone fixes this, and the fix must take effect without them having to
	 * know a cache exists.
	 */
	public function test_a_denial_does_not_follow_a_changed_site_id(): void {
		$this->fake_service( $this->refusal() );
		ParselyClient::suggestions()->get_smart_links( 'Some content.' );
		$this->assertTrue( Entitlement::suggestions_denied() );

		$this->set_site_id( 'a-different-site.com' );

		$this->assertFalse(
			Entitlement::suggestions_denied(),
			'The new key has not been asked yet, so nothing is known about it.'
		);
	}

	public function test_returning_to_a_denied_site_id_recalls_the_denial(): void {
		$this->fake_service( $this->refusal() );
		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->set_site_id( 'a-different-site.com' );
		$this->set_site_id( self::SITE_ID );

		$this->assertTrue( Entitlement::suggestions_denied() );
	}

	// ── What availability reports ────────────────────────────────────

	public function test_suggestions_availability_is_met_before_any_refusal(): void {
		$this->assertTrue( \WorkflowParsely\check_suggestions_availability() );
	}

	public function test_suggestions_availability_is_unmet_after_a_refusal(): void {
		$this->fake_service( $this->refusal() );
		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$availability = \WorkflowParsely\check_suggestions_availability();

		$this->assertInstanceOf( Availability::class, $availability );
		$this->assertFalse( $availability->is_available() );
	}

	/**
	 * The reason is what makes this worth doing. "Unavailable" with no
	 * explanation sends an administrator to check a Site ID that is correct.
	 */
	/**
	 * Serialized the way the Agents surface receives it, rather than by encoding
	 * the object — `Availability` is not JsonSerializable, so a bare
	 * `wp_json_encode()` inspects `{}` and passes regardless of the wording.
	 *
	 * @return string
	 */
	private function serialized_reason(): string {
		return (string) wp_json_encode(
			\VIPWorkflow\API\AvailabilitySerializer::serialize(
				\WorkflowParsely\check_suggestions_availability()
			)
		);
	}

	public function test_the_reason_names_the_missing_access(): void {
		$this->fake_service( $this->refusal() );
		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertMatchesRegularExpression(
			'/Suggestions API|Content Helper/i',
			$this->serialized_reason()
		);
	}

	/**
	 * The distinction that saves an afternoon: the credential is right, the
	 * entitlement is missing. Without it an administrator re-checks a correct
	 * Site ID.
	 */
	public function test_the_reason_does_not_blame_the_credentials(): void {
		$this->fake_service( $this->refusal() );
		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertMatchesRegularExpression(
			'/are correct|is correct/i',
			$this->serialized_reason()
		);
	}

	/**
	 * Parse.ly's own sentence is written for whoever called the API, not for a
	 * writer in an editor. The same reasoning as the NO_DATA wording fix.
	 */
	public function test_parselys_own_wording_is_not_repeated_to_the_user(): void {
		$this->fake_service( $this->refusal() );
		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertStringNotContainsString(
			'not enabled for this site',
			$this->serialized_reason()
		);
	}

	// ── The Content API is a separate entitlement ────────────────────

	/**
	 * The whole reason this exists: analytics and Suggestions are entitled
	 * separately. Trending topics keeps working on a key that cannot smart-link,
	 * and reporting otherwise would hide a feature that works.
	 */
	public function test_the_discovery_provider_is_unaffected_by_a_suggestions_refusal(): void {
		$this->fake_service( $this->refusal() );
		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$this->assertTrue(
			\WorkflowParsely\Discovery\ParselyDiscoveryProvider::check_availability(),
			'The Content API was never refused.'
		);
	}

	// ── Through the registered abilities ─────────────────────────────

	/**
	 * @return array<int, array<int, string>>
	 */
	public static function suggestions_ability_ids(): array {
		return array(
			array( 'workflow-parsely/smart-linking' ),
			array( 'workflow-parsely/headline-suggestions' ),
			array( 'workflow-parsely/smart-linking-check' ),
		);
	}

	/**
	 * @dataProvider suggestions_ability_ids
	 *
	 * @param string $ability_id Ability id.
	 */
	public function test_a_suggestions_ability_reports_unavailable_after_a_refusal( string $ability_id ): void {
		$this->fake_service( $this->refusal() );
		ParselyClient::suggestions()->get_smart_links( 'Some content.' );

		$ability = wp_get_ability( $ability_id );
		$this->assertNotNull( $ability, $ability_id . ' must be registered.' );

		$this->assertNotTrue(
			$ability->get_availability(),
			$ability_id . ' must not present as usable when Parse.ly refuses it.'
		);
	}

	/**
	 * @dataProvider suggestions_ability_ids
	 *
	 * @param string $ability_id Ability id.
	 */
	public function test_a_suggestions_ability_is_available_before_a_refusal( string $ability_id ): void {
		$this->assertTrue(
			wp_get_ability( $ability_id )->get_availability()->is_available(),
			$ability_id . ' must work on a configured key that has not been refused.'
		);
	}

	// ── Still honest about missing credentials ───────────────────────

	public function test_missing_credentials_still_reports_unmet(): void {
		delete_option( 'parsely' );

		$this->assertNotTrue( \WorkflowParsely\check_suggestions_availability() );
	}
}
