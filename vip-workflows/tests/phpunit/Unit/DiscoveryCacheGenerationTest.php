<?php
/**
 * Discovery cache generation unit tests.
 *
 * Saving a provider's settings used to clear its cache by deleting
 * `_transient_vip_discovery_*` rows from `wp_options`. On VIP transients live in
 * the persistent object cache, so that delete matched nothing, and the filters
 * cache was never cleared on any host. The cache is now cleared by bumping a
 * per-provider generation that every discovery cache key carries.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\API\DiscoveryController;
use VIPWorkflows\Assistants\AssistantRegistry;
use VIPWorkflows\Discovery\DiscoveryProviderRegistry;
use WP_REST_Request;

class DiscoveryCacheGenerationTest extends TestCase
{
	/**
	 * In-memory options, keyed by option name.
	 *
	 * @var array<string, mixed>
	 */
	private array $options = array();

	/**
	 * Autoload flag passed to each update_option() call, keyed by option name.
	 *
	 * @var array<string, mixed>
	 */
	private array $autoload = array();

	/**
	 * Transient names read by the controller, in order.
	 *
	 * @var string[]
	 */
	private array $transient_reads = array();

	protected function setUp(): void
	{
		parent::setUp();

		// The controller reads these WordPress time constants; unit tests run
		// without WordPress loaded.
		defined( 'MINUTE_IN_SECONDS' ) || define( 'MINUTE_IN_SECONDS', 60 );
		defined( 'DAY_IN_SECONDS' ) || define( 'DAY_IN_SECONDS', 86400 );

		$this->options         = array();
		$this->autoload        = array();
		$this->transient_reads = array();

		Functions\when( 'get_option' )->alias(
			fn( $name, $default = false ) => $this->options[ $name ] ?? $default
		);
		Functions\when( 'update_option' )->alias(
			function ( $name, $value, $autoload = null ) {
				$this->options[ $name ]  = $value;
				$this->autoload[ $name ] = $autoload;
				return true;
			}
		);
		Functions\when( 'wp_get_abilities' )->justReturn( array() );
		Functions\when( 'wp_json_encode' )->alias( 'json_encode' );
		Functions\when( 'get_transient' )->alias(
			function ( $name ) {
				$this->transient_reads[] = $name;
				return false;
			}
		);
		Functions\when( 'set_transient' )->justReturn( true );

		$this->reset_singleton( AssistantRegistry::class );
		$this->reset_singleton( DiscoveryProviderRegistry::class );
	}

	public function test_saving_provider_settings_bumps_only_that_providers_generation(): void
	{
		$this->register_provider( 'alpha' );
		$this->register_provider( 'beta' );
		$registry = AssistantRegistry::get_instance();
		$registry->register(
			'alpha-card',
			array(
				'label'          => 'Alpha',
				'provider_slugs' => array( 'alpha' ),
			)
		);

		$this->assertSame( 0, AssistantRegistry::discovery_cache_generation( 'alpha' ) );

		$this->assertTrue( $registry->update_settings( 'alpha-card', array( 'options' => array( 'cache_minutes' => 5 ) ) ) );

		$this->assertSame( 1, AssistantRegistry::discovery_cache_generation( 'alpha' ) );
		$this->assertSame( 0, AssistantRegistry::discovery_cache_generation( 'beta' ) );

		$registry->update_settings( 'alpha-card', array( 'enabled' => false ) );

		$this->assertSame( 2, AssistantRegistry::discovery_cache_generation( 'alpha' ) );
		$this->assertSame( 0, AssistantRegistry::discovery_cache_generation( 'beta' ) );
		$this->assertFalse( $this->autoload['vip_discovery_cache_generation'], 'The generation map is read only on the discovery routes, so it must not autoload.' );
	}

	public function test_each_cache_key_changes_when_the_generation_changes(): void
	{
		$this->register_provider( 'alpha', true );
		$controller = $this->controller();

		$before = $this->keys_for_one_pass( $controller );

		AssistantRegistry::bump_discovery_cache_generation( 'alpha' );

		$after = $this->keys_for_one_pass( $controller );

		$this->assertCount( 3, $before, 'Recommend, search and filters should each read one cache key.' );
		$this->assertCount( 3, $after );

		foreach ( array( 'recommend', 'search', 'filters' ) as $kind ) {
			$old = $this->key_of_kind( $before, $kind );
			$new = $this->key_of_kind( $after, $kind );

			$this->assertNotSame( $old, $new, "The {$kind} key must change when the generation does." );
			$this->assertLessThanOrEqual( 172, strlen( $new ), 'WordPress transient names are limited to 172 characters.' );
		}

		$this->assertStringContainsString( 'vip_discovery_filters_alpha_0', $this->key_of_kind( $before, 'filters' ) );
		$this->assertStringContainsString( 'vip_discovery_filters_alpha_1', $this->key_of_kind( $after, 'filters' ) );
	}

	public function test_clearing_the_cache_makes_no_database_query(): void
	{
		$wpdb = Mockery::mock( 'wpdb' );
		$wpdb->options = 'wp_options';
		$wpdb->shouldNotReceive( 'query' );
		$wpdb->shouldNotReceive( 'prepare' );
		$GLOBALS['wpdb'] = $wpdb;

		try {
			$method = new \ReflectionMethod( AssistantRegistry::class, 'clear_discovery_cache' );
			$method->invoke( AssistantRegistry::get_instance(), 'alpha' );
		} finally {
			unset( $GLOBALS['wpdb'] );
		}

		$this->assertSame( 1, AssistantRegistry::discovery_cache_generation( 'alpha' ) );
	}

	public function test_a_stored_option_that_is_not_an_array_reads_as_generation_zero(): void
	{
		foreach ( array( 'garbage', 7, null, false ) as $stored ) {
			$this->options['vip_discovery_cache_generation'] = $stored;

			$this->assertSame( 0, AssistantRegistry::discovery_cache_generation( 'alpha' ) );
		}

		$this->options['vip_discovery_cache_generation'] = 'garbage';
		AssistantRegistry::bump_discovery_cache_generation( 'alpha' );

		$this->assertSame( array( 'alpha' => 1 ), $this->options['vip_discovery_cache_generation'], 'Bumping over a corrupt value starts a fresh map.' );
	}

	/**
	 * Run recommend, search and filters once and return the transient names read.
	 *
	 * @param DiscoveryController $controller Controller under test.
	 * @return string[]
	 */
	private function keys_for_one_pass( DiscoveryController $controller ): array
	{
		$this->transient_reads = array();

		$controller->get_recommendations( $this->request( array( 'provider' => 'alpha' ) ) );
		$controller->search( $this->request( array( 'provider' => 'alpha', 'text' => 'bikes' ) ) );
		$controller->get_filters( $this->request( array( 'provider' => 'alpha' ) ) );

		return $this->transient_reads;
	}

	/**
	 * @param string[] $keys Transient names.
	 */
	private function key_of_kind( array $keys, string $kind ): string
	{
		foreach ( $keys as $key ) {
			if ( str_starts_with( $key, 'vip_discovery_' . $kind . '_' ) ) {
				return $key;
			}
		}

		$this->fail( "No {$kind} cache key was read." );
	}

	private function controller(): DiscoveryController
	{
		$controller = ( new \ReflectionClass( DiscoveryController::class ) )->newInstanceWithoutConstructor();
		$property   = new \ReflectionProperty( DiscoveryController::class, 'registry' );
		$property->setValue( $controller, DiscoveryProviderRegistry::get_instance() );

		return $controller;
	}

	private function request( array $params ): object
	{
		$request = Mockery::mock( WP_REST_Request::class );
		$request->shouldReceive( 'get_param' )->andReturnUsing( fn( $key ) => $params[ $key ] ?? null );
		return $request;
	}

	private function register_provider( string $slug, bool $searchable = false ): void
	{
		$callbacks = array(
			'recommend' => static fn() => array(),
			'seed'      => static fn() => array(),
		);
		$features  = array( 'recommend' );

		if ( $searchable ) {
			$callbacks['search']  = static fn() => array();
			$callbacks['filters'] = static fn() => array();
			$features[]           = 'search';
		}

		DiscoveryProviderRegistry::get_instance()->register(
			$slug,
			array(
				'label'     => 'Test Provider',
				'features'  => $features,
				'callbacks' => $callbacks,
			)
		);
	}

	private function reset_singleton( string $class_name ): void
	{
		$property = new \ReflectionProperty( $class_name, 'instance' );
		$property->setValue( null, null );
	}
}
