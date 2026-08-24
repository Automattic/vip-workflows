<?php
/**
 * JobsController route-contract unit tests.
 *
 * The file uses BRACKETED namespace blocks: register_routes() reads
 * WP_REST_Server's HTTP-method constants and the unit suite boots no
 * WordPress, so the route-registration tests need a constants-only double in
 * the GLOBAL namespace — which PHP only allows when every namespace in the
 * file is bracketed. The test body is otherwise ordinary.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace {
    if ( ! class_exists( 'WP_REST_Server' ) ) {
        /**
         * Minimal WP_REST_Server double: only the HTTP-method constants the
         * controller's route registration reads. Under the integration suite the
         * real core class exists and this is a no-op.
         */
        class WP_REST_Server {
            const READABLE   = 'GET';
            const CREATABLE  = 'POST';
            const EDITABLE   = 'POST, PUT, PATCH';
            const DELETABLE  = 'DELETE';
            const ALLMETHODS = 'GET, POST, PUT, PATCH, DELETE';
        }
    }
}

namespace VIPWorkflow\Tests\Unit {

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\API\JobsController;
use VIPWorkflow\Jobs\Job;
use VIPWorkflow\Jobs\JobScheduler;
use WP_REST_Request;
use WP_REST_Response;

/**
 * A job ID is whatever a Job subclass returns from get_id(). Nothing validates
 * it at registration, so the routes are where the shape is actually decided —
 * and they used to decide it twice, differently: /run matched `[a-z_]+` while
 * /settings matched `[a-z0-9_-]+`. Any job whose ID carried a digit or a hyphen
 * was therefore configurable but not runnable. These tests pin both routes to
 * one pattern and pin that pattern to the character class `sanitize_key()`
 * produces, which is the only normalization the plugin declares for a job ID.
 */
class JobsControllerRoutesTest extends TestCase
{
    /**
     * Route paths captured from register_rest_route(), keyed by path.
     *
     * @var array<string, array<mixed>>
     */
    private array $routes = array();

    private JobsController $controller;

    protected function set_up()
    {
        parent::set_up();

        $this->routes     = array();
        $this->controller = new JobsController();

        Functions\when( 'register_rest_route' )->alias(
            function ( $namespace, $route, $args ) {
                $this->routes[ $route ] = $args;
            }
        );

        $this->controller->register_routes();
    }

    /**
     * The regression this file exists for: one pattern, used by both
     * parameterized routes. A job that can be configured can be run.
     */
    public function test_run_and_settings_routes_share_one_job_id_pattern(): void
    {
        $this->assertSame(
            $this->job_id_pattern_of( '/run' ),
            $this->job_id_pattern_of( '/settings' ),
            'The /run and /settings routes must capture the job ID with the same pattern.'
        );
    }

    /**
     * The pattern is the `sanitize_key()` character class: lowercase ASCII
     * letters, digits, underscore, hyphen. `airtable_daily_stats` is a real
     * extension-plugin job ID; the digit and hyphen cases are the ones the
     * narrower /run pattern used to reject.
     *
     * Matched with `i`, because that is how the route is actually consulted:
     * `WP_REST_Server::dispatch()` builds `@^{route}$@i`. So the character
     * class is a lowercase one but the ROUTE is not case-sensitive, and an
     * uppercase id reaches the callback rather than 404ing at the router.
     * What refuses it is registration -- `JobScheduler::register_job()` round
     * trips through `sanitize_key()`, which is case-sensitive -- so the job
     * never exists to be looked up. Asserting the route rejects it would be
     * asserting a defence that is not there.
     *
     * @dataProvider provide_job_ids
     *
     * @param string $job_id   Candidate job ID.
     * @param bool   $expected Whether the routes should accept it.
     */
    public function test_job_id_pattern_matches_the_sanitize_key_contract( string $job_id, bool $expected ): void
    {
        $pattern = $this->job_id_pattern_of( '/run' );

        $this->assertSame(
            $expected,
            1 === preg_match( '#^' . $pattern . '$#i', $job_id ),
            sprintf( 'Job ID "%s" was matched against %s with the wrong result.', $job_id, $pattern )
        );
    }

    /**
     * @return array<string, array{0: string, 1: bool}>
     */
    public static function provide_job_ids(): array
    {
        return array(
            'shipped: cleanup'         => array( 'cleanup', true ),
            'shipped: sla_check'       => array( 'sla_check', true ),
            'extension plugin ID'      => array( 'airtable_daily_stats', true ),
            'digit in the middle'      => array( 'oauth2_refresh', true ),
            'digit at the end'         => array( 's3sync2', true ),
            'hyphenated'               => array( 'airtable-daily-stats', true ),
            'uppercase (router admits it; registration refuses it)' => array( 'SlaCheck', true ),
            'dotted'                   => array( 'sla.check', false ),
            'path separator'           => array( 'sla/check', false ),
            'empty'                    => array( '', false ),
        );
    }

    /**
     * Both parameterized routes declare the path parameter under the name the
     * capture group uses, so the callbacks and the schema agree.
     */
    public function test_parameterized_routes_declare_the_id_arg(): void
    {
        foreach ( array( '/run', '/settings' ) as $suffix ) {
            $args = $this->routes[ $this->route_ending_in( $suffix ) ]['args'];

            $this->assertArrayHasKey( 'id', $args, $suffix . ' must declare an "id" argument.' );
            $this->assertArrayNotHasKey( 'name', $args, $suffix . ' must not declare a "name" argument.' );
            $this->assertSame( 'sanitize_key', $args['id']['sanitize_callback'] );
            $this->assertTrue( $args['id']['required'] );
        }
    }

    /**
     * Run reads the path parameter under its registered name — the check that
     * would fail if the route were renamed without the callback following.
     */
    public function test_run_job_reads_the_id_path_param(): void
    {
        $scheduler = Mockery::mock( JobScheduler::class );
        $scheduler->shouldReceive( 'run_now' )->once()->with( 'airtable_daily_stats' )->andReturn( true );

        $request = new WP_REST_Request();
        $request->set_param( 'id', 'airtable_daily_stats' );

        $response = $this->with_job_scheduler( $scheduler, fn() => $this->controller->run_job( $request ) );

        $this->assertInstanceOf( WP_REST_Response::class, $response );
        $this->assertTrue( $response->get_data()['success'] );
    }

    /**
     * Same check for the settings read: the job is looked up by the `id` param.
     */
    public function test_get_job_settings_reads_the_id_path_param(): void
    {
        $job = Mockery::mock( Job::class );
        $job->shouldReceive( 'to_array' )->andReturn( array( 'id' => 'airtable-daily-stats' ) );
        $job->shouldReceive( 'get_settings' )->andReturn( array( 'base' => 'appXYZ' ) );

        $scheduler = Mockery::mock( JobScheduler::class );
        $scheduler->shouldReceive( 'init' );
        $scheduler->shouldReceive( 'get_job' )->once()->with( 'airtable-daily-stats' )->andReturn( $job );

        $request = new WP_REST_Request();
        $request->set_param( 'id', 'airtable-daily-stats' );

        $response = $this->with_job_scheduler( $scheduler, fn() => $this->controller->get_job_settings( $request ) );

        $this->assertInstanceOf( WP_REST_Response::class, $response );
        $this->assertSame( array( 'base' => 'appXYZ' ), $response->get_data()['settings'] );
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * The registered route path ending in the given suffix.
     *
     * @param  string $suffix Route suffix, e.g. '/run'.
     * @return string Full route path.
     */
    private function route_ending_in( string $suffix ): string
    {
        foreach ( array_keys( $this->routes ) as $route ) {
            if ( str_ends_with( $route, $suffix ) ) {
                return $route;
            }
        }

        $this->fail( 'No route ending in ' . $suffix . ' was registered.' );
    }

    /**
     * The named-capture group a parameterized route uses for the job ID.
     *
     * @param  string $suffix Route suffix, e.g. '/run'.
     * @return string The capture group, e.g. '(?P<id>[a-z0-9_-]+)'.
     */
    private function job_id_pattern_of( string $suffix ): string
    {
        $route = $this->route_ending_in( $suffix );

        $this->assertSame(
            1,
            preg_match( '#(\(\?P<[^>]+>[^)]+\))#', $route, $matches ),
            'Route ' . $route . ' has no named capture group.'
        );

        return $matches[1];
    }

    /**
     * Plugin hands the scheduler to the controller, so a double has to be
     * injected there. Restores the previous value afterwards so other tests in
     * this process see the original state.
     *
     * @param  object   $scheduler Job scheduler double.
     * @param  callable $callback  Code to run with the double installed.
     * @return mixed The callback's return value.
     */
    private function with_job_scheduler( object $scheduler, callable $callback )
    {
        $plugin   = \VIPWorkflow\Plugin::get_instance();
        $property = new \ReflectionProperty( \VIPWorkflow\Plugin::class, 'job_scheduler' );
        $previous = $property->getValue( $plugin );
        $property->setValue( $plugin, $scheduler );

        try {
            return $callback();
        } finally {
            $property->setValue( $plugin, $previous );
        }
    }
}

}
