<?php
/**
 * Availability contract for the workflow-parsely bridge.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use VIPWorkflow\Abilities\Availability;
use Yoast\WPTestUtils\WPIntegration\TestCase;

class ParselyBridgeAvailabilityTest extends TestCase {

	/**
	 * wp-parsely's option key, as read by Parsely\Parsely::get_options().
	 */
	private const PARSELY_OPTION = 'parsely';

	/**
	 * Saved option, restored in tear_down.
	 *
	 * @var mixed
	 */
	private $saved_option = false;

	public function set_up(): void {
		parent::set_up();
		$this->saved_option = get_option( self::PARSELY_OPTION, false );
	}

	public function tear_down(): void {
		if ( false === $this->saved_option ) {
			delete_option( self::PARSELY_OPTION );
		} else {
			update_option( self::PARSELY_OPTION, $this->saved_option );
		}

		parent::tear_down();
	}

	/**
	 * Store a wp-parsely configuration with the given site id and secret.
	 *
	 * @param string $site_id Parse.ly site id (apikey).
	 * @param string $secret  Parse.ly API secret.
	 */
	private function configure_parsely( string $site_id, string $secret ): void {
		update_option(
			self::PARSELY_OPTION,
			array(
				'apikey'     => $site_id,
				'api_secret' => $secret,
			)
		);
	}

	public function test_bridge_plugin_is_loaded(): void {
		$this->assertTrue(
			function_exists( 'WorkflowParsely\check_availability' ),
			'workflow-parsely must be loaded for the rest of this suite to mean anything.'
		);
	}

	public function test_wp_parsely_is_present_in_this_environment(): void {
		$this->assertTrue(
			class_exists( \Parsely\Parsely::class ),
			'wp-parsely must be loaded; a bridge suite without it proves nothing.'
		);
	}

	public function test_reports_unavailable_when_parsely_is_unconfigured(): void {
		delete_option( self::PARSELY_OPTION );

		$this->assertInstanceOf(
			Availability::class,
			\WorkflowParsely\check_availability(),
			'An unconfigured Parse.ly must report unmet requirements, not boolean true.'
		);
	}

	public function test_names_the_missing_requirement_rather_than_failing_open(): void {
		delete_option( self::PARSELY_OPTION );

		$result = \WorkflowParsely\check_availability();

		$this->assertNotTrue( $result, 'Availability must not fail open when Parse.ly is unconfigured.' );
		$this->assertNotEmpty(
			$result->get_requirements(),
			'The unmet result must carry a requirement so the card can say what is missing.'
		);
	}

	public function test_site_id_without_secret_is_still_unavailable(): void {
		$this->configure_parsely( 'example.com', '' );

		$this->assertNotTrue(
			\WorkflowParsely\check_availability(),
			'A site id alone is not enough — the Content API needs the secret too.'
		);
	}

	public function test_secret_without_site_id_is_still_unavailable(): void {
		$this->configure_parsely( '', 'a-secret' );

		$this->assertNotTrue(
			\WorkflowParsely\check_availability(),
			'A secret alone is not enough — every call is scoped by site id.'
		);
	}

	public function test_reports_available_when_both_credentials_are_present(): void {
		$this->configure_parsely( 'example.com', 'a-secret' );

		$this->assertTrue(
			\WorkflowParsely\check_availability(),
			'Both credentials present must read as available.'
		);
	}

	/**
	 * Availability is read on every Agents-page load and several times per
	 * settings save. A network round trip there would make the admin crawl,
	 * which is why the *configured* check is deliberately separate from
	 * credential *validation*.
	 */
	public function test_configured_check_makes_no_http_request(): void {
		$this->configure_parsely( 'example.com', 'a-secret' );

		$requests = 0;
		$counter  = static function ( $preempt ) use ( &$requests ) {
			++$requests;
			return $preempt;
		};

		add_filter( 'pre_http_request', $counter );
		\WorkflowParsely\check_availability();
		remove_filter( 'pre_http_request', $counter );

		$this->assertSame( 0, $requests, 'check_availability() must not hit the network.' );
	}

	public function test_dependency_check_returns_a_bool_and_never_throws(): void {
		$this->assertIsBool(
			\WorkflowParsely\wp_parsely_is_active(),
			'The dependency check must return a plain bool so callers can branch safely.'
		);
	}

	/*
	 * The empty-manifest assertion that lived here was replaced when the first
	 * ability landed. Its successor is
	 * SmartLinkingAbilityTest::test_manifest_now_renders_exactly_one_parsely_card().
	 */
}
