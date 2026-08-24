<?php
/**
 * Minimal WP_Post value-object double for the unit suite.
 *
 * WP_Post is a stable, behavior-free value object: a bag of public post
 * columns. Several unit tests construct one (e.g. the media/ideation prompt
 * coverage) because production code is type-hinted on `\WP_Post` and reads
 * columns such as `->ID`, `->post_type`, `->post_title`, and `->post_content`.
 *
 * Real WP_Post's constructor takes an object and fronts magic accessors; this
 * double accepts a plain array of columns instead, which is all the unit tests
 * need. It is loaded only for the non-integration suite. Under integration the
 * real WP_Post from WordPress core is used instead; the class_exists guard
 * makes this a no-op there.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

if ( ! class_exists( 'WP_Post' ) ) {
    #[\AllowDynamicProperties]
    class WP_Post {
        public int $ID                  = 0;
        public int $post_author         = 0;
        public string $post_date        = '';
        public string $post_content     = '';
        public string $post_title       = '';
        public string $post_excerpt     = '';
        public string $post_status      = 'publish';
        public string $post_name        = '';
        public int $post_parent         = 0;
        public string $guid             = '';
        public int $menu_order          = 0;
        public string $post_type        = 'post';
        public string $post_mime_type   = '';
        public int $comment_count       = 0;

        /**
         * @param array<string, mixed> $data Post columns to seed the object with.
         */
        public function __construct( array $data = array() ) {
            foreach ( $data as $key => $value ) {
                $this->$key = $value;
            }
        }
    }
}
