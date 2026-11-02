<?php
/**
 * Validate transition input before sanitization can turn malformed values into IDs.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use WP_REST_Request;

/**
 * Real WordPress request validation against the registered transition route.
 */
class TransitionInputSchemaTest extends TestCase {

	/**
	 * Build a JSON request with the production route's argument definitions.
	 *
	 * Validation precedes sanitization and callback execution in REST dispatch.
	 * Running those two real request methods directly tests that boundary without
	 * calling the transition handler or changing any post state.
	 *
	 * @param mixed $value Submitted assignment value.
	 * @return WP_REST_Request Request ready for core parameter validation.
	 */
	private function request_with_assignee( $value ): WP_REST_Request {
		$routes  = rest_get_server()->get_routes();
		$route   = '/vip-workflows/v1/workflow/post/(?P<id>[\d]+)/transition';
		$request = new WP_REST_Request( 'POST', '/vip-workflows/v1/workflow/post/42/transition' );
		$request->set_attributes( $routes[ $route ][0] );
		$request->set_url_params( array( 'id' => 42 ) );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body(
			(string) wp_json_encode(
				array(
					'to_status'  => 'ready',
					'input_data' => array( 'reviewer' => $value ),
				)
			)
		);
		return $request;
	}

	/**
	 * Values that sanitize_text_field would otherwise coerce or erase.
	 *
	 * @return array Malformed assignment values.
	 */
	public static function malformed_values(): array {
		return array(
			'true would become user 1'  => array( true ),
			'false would become empty'  => array( false ),
			'list would become empty'   => array( array( 7 ) ),
			'object would become empty' => array( (object) array( 'id' => 7 ) ),
			'fraction is not a user ID' => array( 7.5 ),
		);
	}

	/**
	 * Core must reject malformed values before they reach the transition callback.
	 *
	 * @dataProvider malformed_values
	 * @param mixed $value Malformed submitted value.
	 */
	public function test_malformed_values_are_rejected_before_sanitization( $value ): void {
		$request = $this->request_with_assignee( $value );
		$before  = $request->get_param( 'input_data' );
		$result  = $request->has_valid_params();

		$this->assertWPError( $result );
		$this->assertSame( 'rest_invalid_param', $result->get_error_code() );
		$this->assertSame( 400, $result->get_error_data()['status'] );
		$this->assertArrayHasKey( 'input_data', $result->get_error_data()['params'] );
		$this->assertSame( $before, $request->get_param( 'input_data' ) );
	}

	/**
	 * Existing picker IDs and optional-assignment clear values remain accepted.
	 *
	 * @return array Submitted and sanitized assignment values.
	 */
	public static function accepted_values(): array {
		return array(
			'integer user ID' => array( 7, '7' ),
			'string user ID'  => array( '7', '7' ),
			'null clear'      => array( null, '' ),
			'empty clear'     => array( '', '' ),
		);
	}

	/**
	 * The route's existing sanitization still runs for supported input shapes.
	 *
	 * @dataProvider accepted_values
	 * @param mixed  $value Submitted assignment value.
	 * @param string $expected Expected sanitized value.
	 */
	public function test_supported_values_pass_validation_and_sanitization( $value, string $expected ): void {
		$request = $this->request_with_assignee( $value );
		$this->assertTrue( $request->has_valid_params() );
		$this->assertTrue( $request->sanitize_params() );
		$this->assertSame( $expected, $request->get_param( 'input_data' )['reviewer'] );
	}
}
