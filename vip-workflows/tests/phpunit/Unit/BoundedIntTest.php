<?php
/**
 * Tests for the bounded integer reader the list tools share.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use function VIPWorkflows\Abilities\Tools\bounded_int;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/helpers.php';

/**
 * A tool reads each of its numbers with `bounded_int( $input, $key, $default,
 * $min, $max )`, and gets an integer between `$min` and `$max` whatever the
 * input holds.
 *
 * @covers \VIPWorkflows\Abilities\Tools\bounded_int
 */
class BoundedIntTest extends TestCase {

	/**
	 * @return array<string, array{0: array, 1: int}>
	 */
	public static function inputs(): array {
		return array(
			'inside the bounds'          => array( array( 'limit' => 7 ), 7 ),
			'the lowest value'           => array( array( 'limit' => 1 ), 1 ),
			'the highest value'          => array( array( 'limit' => 50 ), 50 ),
			'above the highest'          => array( array( 'limit' => 51 ), 50 ),
			'far above the highest'      => array( array( 'limit' => 500 ), 50 ),
			'zero'                       => array( array( 'limit' => 0 ), 1 ),
			'minus one'                  => array( array( 'limit' => -1 ), 1 ),
			'far below the lowest'       => array( array( 'limit' => -500 ), 1 ),
			'absent, so the default'     => array( array(), 20 ),
			'null, so the default'       => array( array( 'limit' => null ), 20 ),
			'another key, so the default' => array( array( 'days' => 3 ), 20 ),
			'a numeric string'           => array( array( 'limit' => '12' ), 12 ),
			'a float, truncated'         => array( array( 'limit' => 2.9 ), 2 ),
			'text, so the lowest value'  => array( array( 'limit' => 'all' ), 1 ),
		);
	}

	/**
	 * @dataProvider inputs
	 */
	public function test_the_value_read_is_between_the_bounds( array $input, int $expected ): void {
		$this->assertSame( $expected, bounded_int( $input, 'limit', 20, 1, 50 ) );
	}

	public function test_the_bounds_are_the_callers_own(): void {
		$this->assertSame( 30, bounded_int( array( 'days' => 31 ), 'days', 7, 1, 30 ) );
		$this->assertSame( 365, bounded_int( array( 'threshold_days' => 1000 ), 'threshold_days', 3, 1, 365 ) );
		$this->assertSame( 3, bounded_int( array(), 'threshold_days', 3, 1, 365 ) );
	}
}
