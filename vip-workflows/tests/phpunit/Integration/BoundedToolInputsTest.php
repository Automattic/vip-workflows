<?php
/**
 * The numeric inputs of the list tools, and the page sizes of the list routes,
 * have a lowest and a highest value.
 *
 * A list tool answers with between 1 and 50 rows, whatever its caller asks for.
 * The input schema states the bounds, so `WP_Ability::execute()` refuses a value
 * outside them before the callback runs, and a REST or MCP client or the model
 * behind an agent gets a validation error that names the bound. The callback
 * applies the same bounds again, for a PHP caller that reaches it directly.
 *
 * A REST route's `minimum` and `maximum` only act through a `validate_callback`:
 * an argument with its own `sanitize_callback` gets no default validation. So
 * the three list routes that take a page size are asked for one outside their
 * bounds, through the server.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\API\IdeationController;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

use function VIPWorkflows\Abilities\Tools\execute_get_posts_by_status;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-posts-by-status.php';

/**
 * @covers \VIPWorkflows\Abilities\Tools\bounded_int
 * @covers \VIPWorkflows\Abilities\Tools\execute_get_posts_by_status
 */
class BoundedToolInputsTest extends TestCase {

	/**
	 * Sequence the posts belong to.
	 *
	 * @var int
	 */
	private int $sequence_id;

	public function set_up(): void {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$sequence_id = ( new SequenceRepository() )->create(
			'Bounded Flow',
			'bounded-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
					array( 'key' => 'review', 'label' => 'Review', 'status' => 'pending' ),
				),
			),
			get_current_user_id()
		);

		$this->assertNotFalse( $sequence_id, 'The sequence the posts belong to was created.' );
		$this->sequence_id = $sequence_id;
	}

	/**
	 * Put a number of posts at the draft stage of the sequence.
	 *
	 * @param int $count How many.
	 */
	private function drafts( int $count ): void {
		for ( $i = 0; $i < $count; $i++ ) {
			$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
			update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
			update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );
		}
	}

	/**
	 * Run a tool the way every client does: through the registered ability,
	 * which validates the input against the schema first.
	 *
	 * @param  string $ability_id Ability ID.
	 * @param  array  $input      Input.
	 * @return mixed Result, or WP_Error.
	 */
	private function run_tool( string $ability_id, array $input ) {
		$this->assertTrue( wp_has_ability( $ability_id ), "$ability_id is registered" );

		return wp_get_ability( $ability_id )->execute( $input );
	}

	// ─── The schema is the bound every client sees ──────────────

	/**
	 * Each row: the ability, an input with one number outside its bounds, and
	 * the name of that number.
	 *
	 * @return array<string, array{0: string, 1: array, 2: string}>
	 */
	public static function inputs_outside_the_bounds(): array {
		$rows = array();

		$limits = array(
			'vip-workflows/get-my-assignments'     => array(),
			'vip-workflows/get-posts-by-status'    => array( 'status' => 'draft' ),
			'vip-workflows/get-stale-posts'        => array(),
			'vip-workflows/get-recent-activity'    => array(),
			'vip-workflows/get-transition-history' => array( 'post_id' => 1 ),
		);

		foreach ( $limits as $ability_id => $required ) {
			$tool = substr( $ability_id, strlen( 'vip-workflows/' ) );
			foreach ( array( -1, 0, 51 ) as $limit ) {
				$rows[ "$tool, limit $limit" ] = array( $ability_id, $required + array( 'limit' => $limit ), 'limit' );
			}
		}

		foreach ( array( -1, 0, 31 ) as $days ) {
			$rows[ "get-recent-activity, days $days" ] = array( 'vip-workflows/get-recent-activity', array( 'days' => $days ), 'days' );
		}

		foreach ( array( -1, 0, 366 ) as $days ) {
			$rows[ "get-stale-posts, threshold_days $days" ] = array( 'vip-workflows/get-stale-posts', array( 'threshold_days' => $days ), 'threshold_days' );
		}

		return $rows;
	}

	/**
	 * @dataProvider inputs_outside_the_bounds
	 */
	public function test_a_number_outside_the_bounds_is_refused_before_the_tool_runs( string $ability_id, array $input, string $name ): void {
		$result = $this->run_tool( $ability_id, $input );

		$this->assertWPError( $result );
		$this->assertSame( 'ability_invalid_input', $result->get_error_code() );
		$this->assertStringContainsString( "input[$name]", $result->get_error_message(), 'The refused number is the one outside its bounds.' );
	}

	/**
	 * The control for the rows above: the same tools, with each number at a
	 * bound, run and answer.
	 *
	 * @return array<string, array{0: string, 1: array}>
	 */
	public static function inputs_at_the_bounds(): array {
		return array(
			'get-posts-by-status, limit 1'        => array( 'vip-workflows/get-posts-by-status', array( 'status' => 'draft', 'limit' => 1 ) ),
			'get-posts-by-status, limit 50'       => array( 'vip-workflows/get-posts-by-status', array( 'status' => 'draft', 'limit' => 50 ) ),
			'get-my-assignments, limit 1'         => array( 'vip-workflows/get-my-assignments', array( 'limit' => 1 ) ),
			'get-my-assignments, limit 50'        => array( 'vip-workflows/get-my-assignments', array( 'limit' => 50 ) ),
			'get-stale-posts, threshold_days 1'   => array( 'vip-workflows/get-stale-posts', array( 'threshold_days' => 1, 'limit' => 50 ) ),
			'get-stale-posts, threshold_days 365' => array( 'vip-workflows/get-stale-posts', array( 'threshold_days' => 365, 'limit' => 1 ) ),
			'get-recent-activity, days 1'         => array( 'vip-workflows/get-recent-activity', array( 'days' => 1, 'limit' => 50 ) ),
			'get-recent-activity, days 30'        => array( 'vip-workflows/get-recent-activity', array( 'days' => 30, 'limit' => 1 ) ),
		);
	}

	/**
	 * @dataProvider inputs_at_the_bounds
	 */
	public function test_a_number_at_a_bound_is_accepted( string $ability_id, array $input ): void {
		$result = $this->run_tool( $ability_id, $input );

		$this->assertIsArray( $result );
	}

	/**
	 * The same control for the tool whose required input is a post that must
	 * exist, which a static provider cannot create.
	 */
	public function test_transition_history_accepts_a_limit_at_each_bound(): void {
		$post_id = self::factory()->post->create();

		foreach ( array( 1, 50 ) as $limit ) {
			$result = $this->run_tool( 'vip-workflows/get-transition-history', array( 'post_id' => $post_id, 'limit' => $limit ) );

			$this->assertIsArray( $result, "limit $limit" );
		}
	}

	// ─── The callback bounds the value again ────────────────────

	/**
	 * @return array<string, array{0: int}>
	 */
	public static function limits_below_the_lowest(): array {
		return array(
			'-1'   => array( -1 ),
			'-500' => array( -500 ),
			'0'    => array( 0 ),
		);
	}

	/**
	 * @dataProvider limits_below_the_lowest
	 */
	public function test_the_callback_answers_one_row_for_a_limit_below_one( int $limit ): void {
		$this->drafts( 3 );

		$result = execute_get_posts_by_status( array( 'status' => 'draft', 'limit' => $limit ) );

		$this->assertIsArray( $result );
		$this->assertCount( 1, $result['posts'] );
	}

	public function test_the_callback_answers_at_most_fifty_rows(): void {
		$this->drafts( 51 );

		$result = execute_get_posts_by_status( array( 'status' => 'draft', 'limit' => 500 ) );

		$this->assertIsArray( $result );
		$this->assertCount( 50, $result['posts'] );
	}

	// ─── The list routes ────────────────────────────────────────

	/**
	 * Ask a route for a page, through the server, so the route's own argument
	 * rules apply.
	 *
	 * The ideation controller is only wired during `rest_api_init` while the
	 * ideation experiment is enabled, so its routes go onto the server directly.
	 *
	 * @param  string $route  Route, under the plugin namespace.
	 * @param  array  $params Query parameters.
	 * @return \WP_REST_Response
	 */
	private function get( string $route, array $params ): \WP_REST_Response {
		rest_get_server();
		( new IdeationController() )->register_routes();

		$request = new WP_REST_Request( 'GET', '/vip-workflows/v1' . $route );
		$request->set_query_params( $params );

		return rest_do_request( $request );
	}

	/**
	 * Each row: a route, and query parameters with one number outside its bounds.
	 *
	 * @return array<string, array{0: string, 1: array}>
	 */
	public static function pages_outside_the_bounds(): array {
		return array(
			'ideation, per_page 0'           => array( '/ideation', array( 'per_page' => 0 ) ),
			'ideation, per_page 51'          => array( '/ideation', array( 'per_page' => 51 ) ),
			'ideation, per_page 500'         => array( '/ideation', array( 'per_page' => 500 ) ),
			'assignable users, per_page 0'   => array( '/assignable-users', array( 'per_page' => 0 ) ),
			'assignable users, per_page 101' => array( '/assignable-users', array( 'per_page' => 101 ) ),
			'history, per_page 0'            => array( '/workflow/post/%d/history', array( 'per_page' => 0 ) ),
			'history, per_page 101'          => array( '/workflow/post/%d/history', array( 'per_page' => 101 ) ),
			'history, page 0'                => array( '/workflow/post/%d/history', array( 'page' => 0 ) ),
		);
	}

	/**
	 * @dataProvider pages_outside_the_bounds
	 */
	public function test_a_list_route_refuses_a_page_outside_its_bounds( string $route, array $params ): void {
		$response = $this->get( sprintf( $route, self::factory()->post->create() ), $params );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'rest_invalid_param', $response->get_data()['code'] );
	}

	/**
	 * The control: each route, asked for a page at each of its bounds. The
	 * editor itself asks for at most 50 (ideation, users) or 5 (history).
	 *
	 * @return array<string, array{0: string, 1: array}>
	 */
	public static function pages_at_the_bounds(): array {
		return array(
			'ideation, per_page 1'           => array( '/ideation', array( 'per_page' => 1 ) ),
			'ideation, per_page 50'          => array( '/ideation', array( 'per_page' => 50 ) ),
			'assignable users, per_page 1'   => array( '/assignable-users', array( 'per_page' => 1 ) ),
			'assignable users, per_page 100' => array( '/assignable-users', array( 'per_page' => 100 ) ),
			'history, per_page 1, page 1'    => array( '/workflow/post/%d/history', array( 'per_page' => 1, 'page' => 1 ) ),
			'history, per_page 100, page 1'  => array( '/workflow/post/%d/history', array( 'per_page' => 100, 'page' => 1 ) ),
		);
	}

	/**
	 * @dataProvider pages_at_the_bounds
	 */
	public function test_a_list_route_answers_a_page_at_a_bound( string $route, array $params ): void {
		$response = $this->get( sprintf( $route, self::factory()->post->create() ), $params );

		$this->assertSame( 200, $response->get_status() );
	}
}
