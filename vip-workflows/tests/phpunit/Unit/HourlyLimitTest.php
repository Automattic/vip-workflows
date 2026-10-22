<?php
/**
 * Tests for the hourly ceiling that the rate-limited actions share.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Integrations\HourlyLimit;

require_once dirname( __DIR__, 3 ) . '/includes/integrations/class-hourly-limit.php';

if ( ! defined( 'MINUTE_IN_SECONDS' ) ) {
	define( 'MINUTE_IN_SECONDS', 60 );
}
if ( ! defined( 'HOUR_IN_SECONDS' ) ) {
	define( 'HOUR_IN_SECONDS', 3600 );
}

/**
 * `HourlyLimit::spend( $action, $default, $reached )` counts one use of an
 * action for the current user, or for a subject the caller names, against a
 * ceiling per clock hour. The ceiling is the action's default, or what the
 * filter `vip_workflows_{action}_hourly_limit` makes of it; 0 switches it off.
 *
 * @covers \VIPWorkflows\Integrations\HourlyLimit
 */
class HourlyLimitTest extends TestCase {

	/**
	 * The transients, keyed by name, each with its value and expiration.
	 *
	 * @var array<string, array{value: mixed, expiration: int}>
	 */
	private array $store = array();

	/**
	 * Ceilings the filter answers with, keyed by filter tag.
	 *
	 * @var array<string, int>
	 */
	private array $ceilings = array();

	/**
	 * Every action fired, as [ tag, ...args ].
	 *
	 * @var array<int, array>
	 */
	private array $actions = array();

	protected function setUp(): void {
		parent::setUp();

		$this->store    = array();
		$this->ceilings = array();
		$this->actions  = array();

		Functions\when( 'get_current_user_id' )->justReturn( 7 );

		Functions\when( 'get_transient' )->alias(
			fn( $key ) => $this->store[ $key ]['value'] ?? false
		);
		Functions\when( 'set_transient' )->alias(
			function ( $key, $value, $expiration = 0 ) {
				$this->store[ $key ] = array(
					'value'      => $value,
					'expiration' => $expiration,
				);
				return true;
			}
		);
		Functions\when( 'apply_filters' )->alias(
			fn( $tag, $value = null ) => $this->ceilings[ $tag ] ?? $value
		);
		Functions\when( 'do_action' )->alias(
			function ( ...$args ) {
				$this->actions[] = $args;
			}
		);
	}

	/**
	 * Spend one use of the test action.
	 *
	 * @param  int      $default Default ceiling.
	 * @param  int|null $subject Subject, or null for the current user.
	 * @return true|\WP_Error
	 */
	private function spend( int $default = 3, ?int $subject = null ) {
		return HourlyLimit::spend( 'test_action', $default, 'The ceiling for the test action is reached.', $subject );
	}

	// ─── The ceiling ────────────────────────────────────────────

	public function test_the_default_ceiling_allows_that_many_uses_then_refuses(): void {
		$this->assertTrue( $this->spend( 3 ) );
		$this->assertTrue( $this->spend( 3 ) );
		$this->assertTrue( $this->spend( 3 ) );

		$refused = $this->spend( 3 );

		$this->assertInstanceOf( \WP_Error::class, $refused );
		$this->assertSame( 'vip_workflows_test_action_rate_limited', $refused->get_error_code() );
		$this->assertSame( 429, $refused->get_error_data()['status'] );
	}

	public function test_the_filter_can_raise_the_ceiling(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 5;

		for ( $i = 0; $i < 5; $i++ ) {
			$this->assertTrue( $this->spend( 3 ), "use $i" );
		}

		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3 ) );
	}

	public function test_the_filter_can_lower_the_ceiling(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->assertTrue( $this->spend( 3 ) );
		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3 ) );
	}

	/**
	 * @return array<string, array{0: int}>
	 */
	public static function values_that_switch_the_ceiling_off(): array {
		return array(
			'zero'     => array( 0 ),
			'negative' => array( -5 ),
		);
	}

	/**
	 * @dataProvider values_that_switch_the_ceiling_off
	 */
	public function test_a_ceiling_of_zero_or_less_switches_the_limit_off( int $ceiling ): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = $ceiling;

		for ( $i = 0; $i < 50; $i++ ) {
			$this->assertTrue( $this->spend( 3 ), "use $i" );
		}

		$this->assertSame( array(), $this->store, 'nothing is counted when the limit is off' );
	}

	public function test_a_default_of_zero_switches_the_limit_off(): void {
		for ( $i = 0; $i < 50; $i++ ) {
			$this->assertTrue( $this->spend( 0 ), "use $i" );
		}

		$this->assertSame( array(), $this->store );
	}

	public function test_the_filter_receives_the_default_and_the_subject(): void {
		$seen = array();
		Functions\when( 'apply_filters' )->alias(
			function ( $tag, $value = null, ...$args ) use ( &$seen ) {
				$seen = array_merge( array( $tag, $value ), $args );
				return $value;
			}
		);

		$this->spend( 3, 42 );

		$this->assertSame( array( 'vip_workflows_test_action_hourly_limit', 3, 42 ), $seen );
	}

	// ─── The subject ────────────────────────────────────────────

	public function test_each_subject_has_its_own_count(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->assertTrue( $this->spend( 3, 1 ) );
		$this->assertTrue( $this->spend( 3, 2 ) );
		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3, 1 ) );
		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3, 2 ) );
	}

	public function test_the_subject_is_the_current_user_unless_one_is_named(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->assertTrue( $this->spend( 3 ) );

		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3, 7 ), 'user 7 is the current user' );
		$this->assertTrue( $this->spend( 3, 8 ) );
	}

	/**
	 * @return array<string, array{0: int}>
	 */
	public static function subjects_that_are_nobody(): array {
		return array(
			'no user'    => array( 0 ),
			'a negative' => array( -1 ),
		);
	}

	/**
	 * @dataProvider subjects_that_are_nobody
	 */
	public function test_nobody_is_never_refused_or_counted( int $subject ): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		for ( $i = 0; $i < 10; $i++ ) {
			$this->assertTrue( $this->spend( 3, $subject ), "use $i" );
		}

		$this->assertSame( array(), $this->store );
	}

	public function test_a_logged_out_caller_is_never_refused_or_counted(): void {
		Functions\when( 'get_current_user_id' )->justReturn( 0 );
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		for ( $i = 0; $i < 10; $i++ ) {
			$this->assertTrue( $this->spend( 3 ), "use $i" );
		}

		$this->assertSame( array(), $this->store );
	}

	// ─── The hour ───────────────────────────────────────────────

	public function test_the_count_starts_again_when_its_hour_is_over(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->assertTrue( $this->spend( 3 ) );
		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3 ) );

		// The hour that the first use started passes.
		$key = array_key_first( $this->store );
		$this->store[ $key ]['value']['until'] = time() - 1;

		$this->assertTrue( $this->spend( 3 ) );
		$this->assertSame( 1, $this->store[ $key ]['value']['count'], 'a new hour starts from one' );
	}

	public function test_the_count_expires_with_its_hour_whatever_the_pattern_of_use(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 5;

		$this->spend( 3 );
		$key   = array_key_first( $this->store );
		$until = $this->store[ $key ]['value']['until'];

		$this->assertEqualsWithDelta( time() + HOUR_IN_SECONDS, $until, 5, 'the hour starts at the first use' );

		// Later uses in the same hour do not move its end, and the transient
		// expires with it.
		$later = time() + 600;

		$this->store[ $key ]['value']['until'] = $later;
		$this->spend( 3 );

		$this->assertSame( $later, $this->store[ $key ]['value']['until'] );
		$this->assertEqualsWithDelta( 600, $this->store[ $key ]['expiration'], 5 );
	}

	// ─── What a refusal says ────────────────────────────────────

	public function test_a_refusal_says_when_to_try_again(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->spend( 3 );
		$refused = $this->spend( 3 );

		$this->assertStringStartsWith( 'The ceiling for the test action is reached.', $refused->get_error_message() );
		$this->assertMatchesRegularExpression( '/Try again in 60 minutes\.$/', $refused->get_error_message() );
		$this->assertEqualsWithDelta( HOUR_IN_SECONDS, $refused->get_error_data()['retry_after'], 5 );
	}

	public function test_a_refusal_fires_an_action_that_names_the_action_subject_and_ceiling(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->spend( 3, 42 );
		$this->assertSame( array(), $this->actions, 'an allowed use fires nothing' );

		$this->spend( 3, 42 );

		$this->assertSame(
			array( array( 'vip_workflows_hourly_limit_reached', 'test_action', 42, 1 ) ),
			$this->actions
		);
	}

	public function test_a_refusal_is_not_counted(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->spend( 3 );
		$this->spend( 3 );
		$this->spend( 3 );

		$key = array_key_first( $this->store );
		$this->assertSame( 1, $this->store[ $key ]['value']['count'] );
	}
}
