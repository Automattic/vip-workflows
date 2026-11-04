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
 * The count lives in the persistent object cache when there is one, and in the
 * options table otherwise. Every behaviour is checked against both, through
 * doubles that keep the semantics of `wp_cache_incr()` / `wp_cache_decr()` and
 * of the single SQL statements the database counter runs. Neither double
 * offers a plain read, so a read-then-write count cannot pass these tests.
 *
 * @covers \VIPWorkflows\Integrations\HourlyLimit
 */
class HourlyLimitTest extends TestCase {

	/**
	 * Whether the test runs with a persistent object cache.
	 *
	 * @var bool
	 */
	private bool $persistent = true;

	/**
	 * The object cache, keyed by "group:key", each with its value and expiration.
	 *
	 * @var array<string, array{value: int, expiration: int}>
	 */
	private array $cache = array();

	/**
	 * Called between `wp_cache_add()` and `wp_cache_incr()`, to stand in for
	 * another request that counts in between.
	 *
	 * @var callable|null
	 */
	private $between = null;

	/**
	 * The options table double.
	 *
	 * @var object
	 */
	private $wpdb;

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

		$this->persistent = true;
		$this->cache      = array();
		$this->between    = null;
		$this->ceilings   = array();
		$this->actions    = array();
		$this->wpdb       = self::options_table();

		$GLOBALS['wpdb'] = $this->wpdb;

		Functions\when( 'get_current_user_id' )->justReturn( 7 );
		Functions\when( 'wp_using_ext_object_cache' )->alias( fn() => $this->persistent );

		Functions\when( 'wp_cache_add' )->alias(
			function ( $key, $value, $group = '', $expire = 0 ) {
				if ( isset( $this->cache[ "$group:$key" ] ) ) {
					return false;
				}
				$this->cache[ "$group:$key" ] = array(
					'value'      => (int) $value,
					'expiration' => (int) $expire,
				);
				return true;
			}
		);
		Functions\when( 'wp_cache_incr' )->alias(
			function ( $key, $offset = 1, $group = '' ) {
				if ( null !== $this->between ) {
					( $this->between )();
				}
				if ( ! isset( $this->cache[ "$group:$key" ] ) ) {
					return false;
				}
				$this->cache[ "$group:$key" ]['value'] += $offset;
				return $this->cache[ "$group:$key" ]['value'];
			}
		);
		Functions\when( 'wp_cache_decr' )->alias(
			function ( $key, $offset = 1, $group = '' ) {
				if ( ! isset( $this->cache[ "$group:$key" ] ) ) {
					return false;
				}
				$this->cache[ "$group:$key" ]['value'] = max( 0, $this->cache[ "$group:$key" ]['value'] - $offset );
				return $this->cache[ "$group:$key" ]['value'];
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

	protected function tearDown(): void {
		unset( $GLOBALS['wpdb'] );

		parent::tearDown();
	}

	/**
	 * A double of the options table that runs the counter's three statements
	 * with the semantics MySQL gives them, and reports affected rows as MySQL
	 * does for `INSERT ... ON DUPLICATE KEY UPDATE`: 1 inserted, 2 changed, 0
	 * left as it was.
	 */
	private static function options_table(): object {
		return new class() {
			/** @var string */
			public $options = 'wp_options';

			/** @var array<string, string> */
			public array $rows = array();

			/** @var bool */
			public bool $fails = false;

			/** @var array<int, string> */
			public array $statements = array();

			public function esc_like( string $text ): string {
				return addcslashes( $text, '_%\\' );
			}

			public function prepare( string $query, ...$args ): string {
				return (string) json_encode( array( $query, $args ) );
			}

			public function query( string $prepared ) {
				list( $query, $args ) = json_decode( $prepared, true );
				$this->statements[]   = $query;

				if ( $this->fails ) {
					return false;
				}

				if ( str_starts_with( $query, 'INSERT INTO wp_options' ) ) {
					list( $name, $limit ) = $args;
					if ( ! isset( $this->rows[ $name ] ) ) {
						$this->rows[ $name ] = '1';
						return 1;
					}
					if ( (int) $this->rows[ $name ] < $limit ) {
						$this->rows[ $name ] = (string) ( (int) $this->rows[ $name ] + 1 );
						return 2;
					}
					return 0;
				}

				if ( str_starts_with( $query, 'UPDATE wp_options SET option_value = option_value - 1' ) ) {
					list( $name ) = $args;
					if ( isset( $this->rows[ $name ] ) && (int) $this->rows[ $name ] > 0 ) {
						$this->rows[ $name ] = (string) ( (int) $this->rows[ $name ] - 1 );
						return 1;
					}
					return 0;
				}

				if ( str_starts_with( $query, 'DELETE FROM wp_options WHERE option_name LIKE' ) ) {
					list( $like, $below ) = $args;
					$prefix               = stripslashes( rtrim( $like, '%' ) );
					$deleted              = 0;
					foreach ( array_keys( $this->rows ) as $name ) {
						if ( str_starts_with( $name, $prefix ) && strcmp( $name, $below ) < 0 ) {
							unset( $this->rows[ $name ] );
							++$deleted;
						}
					}
					return $deleted;
				}

				throw new \LogicException( "Unexpected statement: $query" );
			}
		};
	}

	/**
	 * @return array<string, array{0: bool}>
	 */
	public static function backends(): array {
		return array(
			'object cache' => array( true ),
			'database'     => array( false ),
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

	/**
	 * The current count of an action for a subject, in whichever backend is in use.
	 */
	private function count_of( string $action = 'test_action', int $subject = 7 ): int {
		$hour = intdiv( time(), HOUR_IN_SECONDS );

		if ( $this->persistent ) {
			return $this->cache[ "vip_workflows_hourly_limit:{$hour}_{$action}_{$subject}" ]['value'] ?? 0;
		}

		return (int) ( $this->wpdb->rows[ HourlyLimit::OPTION_PREFIX . "{$hour}_{$action}_{$subject}" ] ?? 0 );
	}

	/**
	 * Whether anything has been counted in either backend.
	 */
	private function nothing_is_stored(): bool {
		return array() === $this->cache && array() === $this->wpdb->rows && array() === $this->wpdb->statements;
	}

	// ─── The ceiling ────────────────────────────────────────────

	/**
	 * @dataProvider backends
	 */
	public function test_the_default_ceiling_allows_that_many_uses_then_refuses( bool $persistent ): void {
		$this->persistent = $persistent;

		$this->assertTrue( $this->spend( 3 ) );
		$this->assertTrue( $this->spend( 3 ) );
		$this->assertTrue( $this->spend( 3 ), 'the use that reaches the ceiling exactly is allowed' );
		$this->assertSame( 3, $this->count_of() );

		$refused = $this->spend( 3 );

		$this->assertInstanceOf( \WP_Error::class, $refused );
		$this->assertSame( 'vip_workflows_test_action_rate_limited', $refused->get_error_code() );
		$this->assertSame( 429, $refused->get_error_data()['status'] );
	}

	/**
	 * @dataProvider backends
	 */
	public function test_a_refusal_leaves_the_count_at_the_ceiling( bool $persistent ): void {
		$this->persistent                                         = $persistent;
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 2;

		$this->spend( 3 );
		$this->spend( 3 );
		$this->spend( 3 );
		$this->spend( 3 );

		$this->assertSame( 2, $this->count_of(), 'an over-limit use is rolled back, or never counted' );
	}

	/**
	 * @dataProvider backends
	 */
	public function test_the_filter_can_raise_the_ceiling( bool $persistent ): void {
		$this->persistent                                         = $persistent;
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 5;

		for ( $i = 0; $i < 5; $i++ ) {
			$this->assertTrue( $this->spend( 3 ), "use $i" );
		}

		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3 ) );
	}

	/**
	 * @dataProvider backends
	 */
	public function test_the_filter_can_lower_the_ceiling( bool $persistent ): void {
		$this->persistent                                         = $persistent;
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->assertTrue( $this->spend( 3 ) );
		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3 ) );
	}

	/**
	 * @return array<string, array{0: int, 1: bool}>
	 */
	public static function values_that_switch_the_ceiling_off(): array {
		return array(
			'zero, object cache'     => array( 0, true ),
			'negative, object cache' => array( -5, true ),
			'zero, database'         => array( 0, false ),
			'negative, database'     => array( -5, false ),
		);
	}

	/**
	 * @dataProvider values_that_switch_the_ceiling_off
	 */
	public function test_a_ceiling_of_zero_or_less_switches_the_limit_off( int $ceiling, bool $persistent ): void {
		$this->persistent                                         = $persistent;
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = $ceiling;

		for ( $i = 0; $i < 50; $i++ ) {
			$this->assertTrue( $this->spend( 3 ), "use $i" );
		}

		$this->assertTrue( $this->nothing_is_stored(), 'nothing is counted when the limit is off' );
	}

	/**
	 * @dataProvider backends
	 */
	public function test_a_default_of_zero_switches_the_limit_off( bool $persistent ): void {
		$this->persistent = $persistent;

		for ( $i = 0; $i < 50; $i++ ) {
			$this->assertTrue( $this->spend( 0 ), "use $i" );
		}

		$this->assertTrue( $this->nothing_is_stored() );
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

	// ─── Concurrency ────────────────────────────────────────────

	public function test_a_use_taken_by_another_request_between_create_and_increment_is_not_taken_twice(): void {
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 2;

		$this->assertTrue( $this->spend( 3 ) );

		// Another request takes the last use after this one created the
		// counter and before it increments. A read-then-write count would see
		// 1 and allow; the increment returns 3, which is over the ceiling.
		$key           = 'vip_workflows_hourly_limit:' . intdiv( time(), HOUR_IN_SECONDS ) . '_test_action_7';
		$this->between = function () use ( $key ) {
			$this->between = null;
			++$this->cache[ $key ]['value'];
		};

		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3 ) );
		$this->assertSame( 2, $this->count_of(), 'the refused use is given back' );
	}

	public function test_the_object_cache_counter_expires_after_the_clock_hour(): void {
		$this->spend( 3 );

		$entry     = reset( $this->cache );
		$remaining = ( intdiv( time(), HOUR_IN_SECONDS ) + 1 ) * HOUR_IN_SECONDS - time();

		$this->assertSame( 1, $entry['value'] );
		$this->assertEqualsWithDelta( $remaining + MINUTE_IN_SECONDS, $entry['expiration'], 2 );
	}

	public function test_an_evicted_cache_counter_refuses_rather_than_counting_nothing(): void {
		// The counter is evicted between its creation and its increment.
		$this->between = function () {
			$this->cache = array();
		};

		$refused = $this->spend( 3 );

		$this->assertInstanceOf( \WP_Error::class, $refused );
		$this->assertSame( 'vip_workflows_hourly_limit_unavailable', $refused->get_error_code() );
		$this->assertSame( 503, $refused->get_error_data()['status'] );
	}

	public function test_the_database_counter_is_raised_by_one_conditional_statement(): void {
		$this->persistent                                         = false;
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->spend( 3 );
		$this->wpdb->statements = array();
		$this->spend( 3 );

		$this->assertCount( 1, $this->wpdb->statements, 'a refused use is one statement and no rollback' );
		$this->assertStringContainsString( 'ON DUPLICATE KEY UPDATE option_value = IF( option_value + 0 < %d', $this->wpdb->statements[0] );
	}

	public function test_a_failed_database_statement_refuses(): void {
		$this->persistent  = false;
		$this->wpdb->fails = true;

		$refused = $this->spend( 3 );

		$this->assertInstanceOf( \WP_Error::class, $refused );
		$this->assertSame( 'vip_workflows_hourly_limit_unavailable', $refused->get_error_code() );
	}

	// ─── The subject ────────────────────────────────────────────

	/**
	 * @dataProvider backends
	 */
	public function test_each_subject_has_its_own_count( bool $persistent ): void {
		$this->persistent                                         = $persistent;
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->assertTrue( $this->spend( 3, 1 ) );
		$this->assertTrue( $this->spend( 3, 2 ) );
		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3, 1 ) );
		$this->assertInstanceOf( \WP_Error::class, $this->spend( 3, 2 ) );
	}

	/**
	 * @dataProvider backends
	 */
	public function test_the_subject_is_the_current_user_unless_one_is_named( bool $persistent ): void {
		$this->persistent                                         = $persistent;
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

		foreach ( array( true, false ) as $persistent ) {
			$this->persistent = $persistent;
			for ( $i = 0; $i < 10; $i++ ) {
				$this->assertTrue( $this->spend( 3, $subject ), "use $i" );
			}
		}

		$this->assertTrue( $this->nothing_is_stored() );
	}

	public function test_a_logged_out_caller_is_never_refused_or_counted(): void {
		Functions\when( 'get_current_user_id' )->justReturn( 0 );
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		for ( $i = 0; $i < 10; $i++ ) {
			$this->assertTrue( $this->spend( 3 ), "use $i" );
		}

		$this->assertTrue( $this->nothing_is_stored() );
	}

	// ─── The hour ───────────────────────────────────────────────

	/**
	 * @dataProvider backends
	 */
	public function test_the_count_starts_again_in_the_next_clock_hour( bool $persistent ): void {
		$this->persistent                                         = $persistent;
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;
		$hour = intdiv( time(), HOUR_IN_SECONDS );

		// The previous hour is spent.
		if ( $persistent ) {
			$this->cache[ 'vip_workflows_hourly_limit:' . ( $hour - 1 ) . '_test_action_7' ] = array(
				'value'      => 1,
				'expiration' => 60,
			);
		} else {
			$this->wpdb->rows[ HourlyLimit::OPTION_PREFIX . ( $hour - 1 ) . '_test_action_7' ] = '1';
		}

		$this->assertTrue( $this->spend( 3 ) );
		$this->assertSame( 1, $this->count_of(), 'a new hour starts from one' );
	}

	public function test_the_first_database_use_in_an_hour_removes_earlier_hours_only(): void {
		$this->persistent = false;
		$hour             = intdiv( time(), HOUR_IN_SECONDS );
		$earlier          = HourlyLimit::OPTION_PREFIX . ( $hour - 1 ) . '_other_action_9';
		$current          = HourlyLimit::OPTION_PREFIX . $hour . '_other_action_9';

		$this->wpdb->rows[ $earlier ]               = '4';
		$this->wpdb->rows[ $current ]               = '2';
		$this->wpdb->rows['vip_workflows_settings'] = 'kept';

		$this->spend( 3 );

		$this->assertArrayNotHasKey( $earlier, $this->wpdb->rows );
		$this->assertSame( '2', $this->wpdb->rows[ $current ] );
		$this->assertSame( 'kept', $this->wpdb->rows['vip_workflows_settings'] );
	}

	// ─── What a refusal says ────────────────────────────────────

	/**
	 * @dataProvider backends
	 */
	public function test_a_refusal_says_when_to_try_again( bool $persistent ): void {
		$this->persistent                                         = $persistent;
		$this->ceilings['vip_workflows_test_action_hourly_limit'] = 1;

		$this->spend( 3 );
		$refused   = $this->spend( 3 );
		$remaining = ( intdiv( time(), HOUR_IN_SECONDS ) + 1 ) * HOUR_IN_SECONDS - time();
		$minutes   = (int) ceil( $remaining / MINUTE_IN_SECONDS );

		$this->assertStringStartsWith( 'The ceiling for the test action is reached.', $refused->get_error_message() );
		$this->assertMatchesRegularExpression( '/Try again in \d+ minutes?\.$/', $refused->get_error_message() );
		$this->assertStringContainsString( (string) $minutes, $refused->get_error_message() );
		$this->assertEqualsWithDelta( $remaining, $refused->get_error_data()['retry_after'], 2 );
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

	// ─── Several limits for one request ─────────────────────────

	/**
	 * Spend the account and the project limits of one request together.
	 *
	 * @return true|\WP_Error
	 */
	private function spend_both( int $project = 99 ) {
		return HourlyLimit::spend_all(
			array(
				array( 'account_action', 5, 'The account is at its ceiling.' ),
				array( 'project_action', 5, 'The project is at its ceiling.', $project ),
			)
		);
	}

	/**
	 * @dataProvider backends
	 */
	public function test_spend_all_counts_one_use_of_each_limit( bool $persistent ): void {
		$this->persistent = $persistent;

		$this->assertTrue( $this->spend_both() );

		$this->assertSame( 1, $this->count_of( 'account_action', 7 ) );
		$this->assertSame( 1, $this->count_of( 'project_action', 99 ) );
	}

	/**
	 * @dataProvider backends
	 */
	public function test_a_refused_second_limit_gives_back_the_first( bool $persistent ): void {
		$this->persistent                                            = $persistent;
		$this->ceilings['vip_workflows_project_action_hourly_limit'] = 1;

		$this->assertTrue( $this->spend_both() );

		for ( $i = 0; $i < 10; $i++ ) {
			$refused = $this->spend_both();
			$this->assertSame( 'vip_workflows_project_action_rate_limited', $refused->get_error_code(), "request $i" );
		}

		$this->assertSame( 1, $this->count_of( 'account_action', 7 ), 'refused requests spend no account use' );
		$this->assertSame( 1, $this->count_of( 'project_action', 99 ) );

		// So the account can still spend in another project.
		$this->assertTrue( $this->spend_both( 100 ) );
		$this->assertSame( 2, $this->count_of( 'account_action', 7 ) );
	}

	/**
	 * @dataProvider backends
	 */
	public function test_a_refused_first_limit_never_reaches_the_second( bool $persistent ): void {
		$this->persistent                                            = $persistent;
		$this->ceilings['vip_workflows_account_action_hourly_limit'] = 1;

		$this->assertTrue( $this->spend_both( 1 ) );

		$refused = $this->spend_both( 2 );

		$this->assertSame( 'vip_workflows_account_action_rate_limited', $refused->get_error_code() );
		$this->assertSame( 0, $this->count_of( 'project_action', 2 ) );
		$this->assertSame(
			array( array( 'vip_workflows_hourly_limit_reached', 'account_action', 7, 1 ) ),
			$this->actions
		);
	}
}
