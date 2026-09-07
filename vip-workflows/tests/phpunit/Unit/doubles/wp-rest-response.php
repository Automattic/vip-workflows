<?php
/**
 * Minimal WP_REST_Response value-object double for the unit suite.
 *
 * WP_REST_Response is a behavior-free response container: data + status code +
 * headers, with simple accessors. The plugin's REST controllers return
 * `new WP_REST_Response( $data, $status )`, and the controller unit tests read
 * the result back via get_data()/get_status() and assert `instanceof
 * WP_REST_Response`. Providing this double lets those handler tests run without
 * booting WordPress.
 *
 * Only the surface the plugin and its tests actually use is implemented
 * (constructor, get/set data, get/set status, header). Loaded only for the
 * non-integration suite; under integration the real core class is used and the
 * class_exists guard makes this a no-op.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

if ( ! class_exists( 'WP_REST_Response' ) ) {
    class WP_REST_Response {
        protected $data;
        protected int $status = 200;
        /** @var array<string, string> */
        protected array $headers = array();

        /**
         * @param mixed                 $data    Response data.
         * @param int                   $status  HTTP status code.
         * @param array<string, string> $headers Response headers.
         */
        public function __construct( $data = null, int $status = 200, array $headers = array() ) {
            $this->data    = $data;
            $this->status  = $status;
            $this->headers = $headers;
        }

        public function get_data() {
            return $this->data;
        }

        public function set_data( $data ): void {
            $this->data = $data;
        }

        public function get_status(): int {
            return $this->status;
        }

        public function set_status( int $status ): void {
            $this->status = $status;
        }

        public function header( string $key, string $value, bool $replace = true ): void {
            if ( $replace || ! isset( $this->headers[ $key ] ) ) {
                $this->headers[ $key ] = $value;
            }
        }

        /**
         * @return array<string, string>
         */
        public function get_headers(): array {
            return $this->headers;
        }
    }
}
