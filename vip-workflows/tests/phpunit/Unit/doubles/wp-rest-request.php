<?php
/**
 * Minimal WP_REST_Request value-object double for the unit suite.
 *
 * WP_REST_Request is a behavior-free request container. The plugin's REST
 * handlers type-hint it (e.g. `update_settings( WP_REST_Request $request )`)
 * and read it via get_param()/get_json_params(). Controller unit tests pass a
 * lightweight subclass of this double so the type hint is satisfied without
 * booting WordPress. Only the surface the plugin and tests use is implemented.
 *
 * Loaded only for the non-integration suite; under integration the real core
 * class is used and the class_exists guard makes this a no-op.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

if ( ! class_exists( 'WP_REST_Request' ) ) {
    class WP_REST_Request {
        /** @var array<string, mixed> */
        protected array $params = array();
        /** @var mixed */
        protected $body;

        /**
         * @param string               $method     HTTP method.
         * @param string               $route      Route.
         * @param array<string, mixed> $attributes Route attributes.
         */
        public function __construct( string $method = '', string $route = '', array $attributes = array() ) {
        }

        /**
         * @param string $key Param name.
         * @return mixed
         */
        public function get_param( $key ) {
            return $this->params[ $key ] ?? null;
        }

        /**
         * @param string $key   Param name.
         * @param mixed  $value Param value.
         */
        public function set_param( $key, $value ): void {
            $this->params[ $key ] = $value;
        }

        /**
         * @return mixed
         */
        public function get_json_params() {
            return $this->body;
        }
    }
}
