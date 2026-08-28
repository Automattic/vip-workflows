<?php
/**
 * Minimal WP_REST_Controller base-class double for the unit suite.
 *
 * The plugin's REST controllers (VIPWorkflow\API\*) all `extends
 * WP_REST_Controller`. Their handler logic — permission checks, 404 handling,
 * response shaping — is pure and unit-testable once WordPress *functions* are
 * mocked via Brain\Monkey, but the class can't even be loaded without a base
 * class to extend. This double provides just that: the properties the
 * controllers assign (`$namespace`, `$rest_base`, `$schema`) and the inherited
 * methods they call (`get_collection_params()`,
 * `add_additional_fields_schema()`). Route registration goes through the
 * `register_rest_route()` function, which the tests mock separately.
 *
 * Loaded only for the non-integration suite. Under integration the real
 * WP_REST_Controller from WordPress core is used instead; the class_exists
 * guard makes this a no-op there.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

if ( ! class_exists( 'WP_REST_Controller' ) ) {
    abstract class WP_REST_Controller {
        protected $namespace = '';
        protected $rest_base = '';

        /**
         * Memoized item schema, assigned by `get_item_schema()` implementations.
         *
         * @var array<string, mixed>|null
         */
        protected $schema;

        /**
         * @return array<string, mixed>
         */
        public function get_collection_params(): array {
            return array();
        }

        /**
         * Real WP merges schemas contributed via `register_rest_field()`. Nothing
         * registers one in the unit suite — no WordPress is loaded to register it
         * with — so the honest double for "no additional fields" is the schema
         * unchanged, rather than a stub that would let a test disagree with what
         * core actually returns here.
         *
         * @param array<string, mixed> $schema Item schema.
         * @return array<string, mixed>
         */
        protected function add_additional_fields_schema( $schema ): array {
            return $schema;
        }
    }
}
