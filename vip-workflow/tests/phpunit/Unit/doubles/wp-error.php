<?php
/**
 * Minimal WP_Error value-object double for the unit suite.
 *
 * WP_Error is a stable, behavior-free value object (constructor + accessors,
 * unchanged since WP 2.1). Several genuinely pure-logic unit tests — SSRF
 * guard, content/URL extraction — exercise production code that returns
 * `new WP_Error(...)` as its error type. Those tests are fast and
 * security-relevant and must run on every push, so we provide a tiny double
 * here rather than booting WordPress for them.
 *
 * This is intentionally NOT in bootstrap.php (which is now stub-free) and is
 * loaded only for the non-integration suite. Under integration the real
 * WP_Error from WordPress core is used instead; the class_exists guard makes
 * this a no-op there.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

if ( ! class_exists( 'WP_Error' ) ) {
    class WP_Error {
        private string $code;
        private string $message;
        private $data;

        public function __construct( string $code = '', string $message = '', $data = '' ) {
            $this->code    = $code;
            $this->message = $message;
            $this->data    = $data;
        }

        public function get_error_code(): string {
            return $this->code;
        }

        public function get_error_message(): string {
            return $this->message;
        }

        public function get_error_data() {
            return $this->data;
        }
    }
}
