<?php
/**
 * The address of a source an editor adds by hand.
 *
 * A manual source is identified by its address, the same way a research card
 * is, so that adding an address that is already on the board returns the
 * stored source. The address is checked before that identity is derived: one
 * that is not an absolute `http` or `https` address with a host is refused
 * before the table is read, before the address is fetched, and before anything
 * is written. One that passes is identified exactly as the card path
 * identifies it.
 *
 * Unit rather than integration because each claim is about what the handler
 * asks of `$wpdb` and the network, which a recording double observes directly.
 * `IdeationManualSourceUrlIntegrationTest` makes the same claims against the
 * real table.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use ReflectionMethod;
use VIPWorkflows\API\IdeationSourcesController;
use VIPWorkflows\Ideation\Assistants\IdeationOrchestrator;

require_once __DIR__ . '/../../../includes/integrations/class-guideline-context-provider.php';
require_once __DIR__ . '/../../../includes/integrations/class-safe-url.php';
require_once __DIR__ . '/../../../includes/ideation/assistants/class-ideation-orchestrator.php';

/**
 * @covers \VIPWorkflows\API\IdeationSourcesController::add_source
 */
class IdeationManualSourceUrlTest extends TestCase {

	private const PROJECT_ID = 42;

	/**
	 * Hand back whatever `$wpdb` was, so the double cannot leak into a later test.
	 *
	 * @var mixed
	 */
	private $original_wpdb;

	/**
	 * The recording `$wpdb` double.
	 *
	 * @var object
	 */
	private object $db;

	protected function set_up() {
		parent::set_up();

		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;

		$this->db = new class() {
			public string $prefix = 'wp_';

			/**
			 * The `source_id` of every row the handler looked up.
			 *
			 * @var string[]
			 */
			public array $looked_up = array();

			/**
			 * Every row the handler inserted.
			 *
			 * @var array[]
			 */
			public array $inserted = array();

			/**
			 * The rows the table holds, by `source_id`.
			 *
			 * @var array<string, array>
			 */
			public array $rows = array();

			public function prepare( $query, ...$args ) {
				return $args;
			}

			public function get_row( $prepared, $output = null ) {
				$source_id         = (string) $prepared[2];
				$this->looked_up[] = $source_id;

				return $this->rows[ $source_id ] ?? null;
			}

			public function insert( $table, $data, $format = null ) {
				$this->inserted[] = $data;

				return 1;
			}
		};

		$GLOBALS['wpdb'] = $this->db;

		// Fetching the address is a network request. No test here may reach it.
		Functions\when( 'wp_remote_get' )->alias(
			function () {
				$this->fail( 'The address was fetched.' );
			}
		);
		Functions\when( 'wp_safe_remote_get' )->alias(
			function () {
				$this->fail( 'The address was fetched.' );
			}
		);
	}

	protected function tear_down() {
		$GLOBALS['wpdb'] = $this->original_wpdb;

		parent::tear_down();
	}

	/**
	 * Post an address to the add-source handler.
	 *
	 * @param string $url Address as the editor typed it.
	 * @return mixed
	 */
	private function add( string $url ) {
		$params  = array(
			'id'  => self::PROJECT_ID,
			'url' => $url,
		);
		$request = Mockery::mock( 'WP_REST_Request' );
		$request->shouldReceive( 'get_param' )->andReturnUsing( fn( $key ) => $params[ $key ] ?? null );

		$controller = ( new \ReflectionClass( IdeationSourcesController::class ) )->newInstanceWithoutConstructor();

		return $controller->add_source( $request );
	}

	/**
	 * The identity the card path gives a card that carries this address.
	 *
	 * The card path first reduces the card's address fields and then derives the
	 * identity from the result; both steps are taken here as it takes them. A
	 * manual source is scoped to no ability.
	 *
	 * @param string $url Address as a provider sent it.
	 * @return string
	 */
	private function card_path_identity( string $url ): string {
		$reduce = new ReflectionMethod( IdeationOrchestrator::class, 'card_with_web_urls' );
		$card   = $reduce->invoke( null, array( 'type' => 'article', 'url' => $url, 'title' => 'A title' ) );

		return IdeationOrchestrator::card_identity( self::PROJECT_ID, null, $card );
	}

	/**
	 * Assert the handler refused the address before it touched anything.
	 *
	 * @param mixed $result What the handler returned.
	 */
	private function assert_refused_untouched( $result ): void {
		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'rest_invalid_param', $result->get_error_code() );
		$this->assertSame( array( 'status' => 400 ), $result->get_error_data() );
		$this->assertSame( array(), $this->db->looked_up, 'The table was read for an address that was refused.' );
		$this->assertSame( array(), $this->db->inserted, 'A row was written for an address that was refused.' );
	}

	/**
	 * An address with no host would have been the identity of every such source
	 * on the project, so the first one stored would answer for all the rest.
	 *
	 * @dataProvider hostless_addresses
	 *
	 * @param string $url Address that starts with a web scheme and names no host.
	 */
	public function test_an_address_with_no_host_is_refused( string $url ): void {
		$this->assert_refused_untouched( $this->add( $url ) );
	}

	/**
	 * @return array<string, array{string}>
	 */
	public static function hostless_addresses(): array {
		return array(
			'scheme only'        => array( 'https://' ),
			'three slashes'      => array( 'https:///path' ),
			'query, no host'     => array( 'http://?x=1' ),
			'port, no host'      => array( 'https://:80' ),
		);
	}

	/**
	 * @dataProvider other_schemes
	 *
	 * @param string $url Address in a scheme other than `http` or `https`.
	 */
	public function test_an_address_in_another_scheme_is_refused( string $url ): void {
		$this->assert_refused_untouched( $this->add( $url ) );
	}

	/**
	 * @return array<string, array{string}>
	 */
	public static function other_schemes(): array {
		return array(
			'ftp'        => array( 'ftp://example.test/a' ),
			'javascript' => array( 'javascript:alert(1)' ),
			'data'       => array( 'data:text/html,<p>x</p>' ),
			'relative'   => array( '/wp-admin/' ),
		);
	}

	/**
	 * An address that passes is identified as the card path identifies it, so
	 * adding one that a card already stored under this scope returns that row
	 * rather than fetching the address and writing a second one. The address is
	 * written the way a browser would still read it, so the two paths agree only
	 * if both reduce it the same way before the identity is taken.
	 */
	public function test_an_accepted_address_has_the_identity_the_card_path_gives_it(): void {
		$url      = " https://example.test/a\t?b=1\n";
		$expected = $this->card_path_identity( $url );

		$this->assertSame(
			IdeationOrchestrator::card_identity( self::PROJECT_ID, null, array( 'url' => 'https://example.test/a?b=1' ) ),
			$expected,
			'The card path no longer reduces the address as this test assumes.'
		);

		$this->db->rows[ $expected ] = array(
			'source_id' => $expected,
			'url'       => 'https://example.test/a?b=1',
		);

		$result = $this->add( $url );

		$this->assertInstanceOf( \WP_REST_Response::class, $result );
		$this->assertSame( 200, $result->get_status() );
		$this->assertSame( array( $expected ), $this->db->looked_up );
		$this->assertSame( array(), $this->db->inserted );
	}
}
