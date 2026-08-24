<?php
/**
 * Minimal WP_Query double for the unit suite.
 *
 * Production code under unit test (e.g. WorkflowController::get_kanban_data()
 * and the ability tool functions) instantiates `\WP_Query` inline to fetch
 * posts. Tests seed results via the static `WP_Query::$next_posts` property;
 * each instance snapshots it into `->posts` on construction.
 *
 * This mirrors the per-file doubles that ListAbilityPermissionFilterTest and
 * SequenceAbilityOutputKeysTest declare behind class_exists guards — loading
 * the shared copy here makes the contract available suite-wide (those guarded
 * declarations become no-ops). It is loaded only for the non-integration
 * suite; under integration the real WP_Query from WordPress core is used and
 * the class_exists guard makes this a no-op there.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

if ( ! class_exists( 'WP_Query' ) ) {
    class WP_Query {
        /**
         * Posts returned by the next query instance. Reset per-test as needed.
         *
         * @var array
         */
        public static array $next_posts = array();

        /**
         * Query args this instance was constructed with.
         *
         * @var array<string, mixed>
         */
        public array $query_vars = array();

        /**
         * Queried posts.
         *
         * @var array
         */
        public array $posts;

        /**
         * Found post count.
         *
         * @var int
         */
        public int $found_posts;

        /**
         * @param array<string, mixed> $args WP_Query args.
         */
        public function __construct( array $args = array() ) {
            $this->query_vars  = $args;
            $this->posts       = self::$next_posts;
            $this->found_posts = count( $this->posts );
        }
    }
}
