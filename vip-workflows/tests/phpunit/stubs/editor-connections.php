<?php
/**
 * Test double for VIP Real-Time Collaboration's editor connection count.
 *
 * CoEditing reads the count from `EditorConnections::get_count()` when that
 * plugin is loaded. Loaded once from bootstrap.php, unit branch only, so every
 * suite sees the same class. Tests set the count through
 * TestCase::stub_editor_connections(), and TestCase resets it between tests.
 *
 * @package VIPWorkflows\Tests
 */

declare( strict_types=1 );

namespace VIPRealTimeCollaboration\Presence {
    if ( ! class_exists( EditorConnections::class, false ) ) {
        final class EditorConnections
        {
            /** @var int Count get_count() reports for every post. */
            public static int $connections = 0;

            /** @var int How many times get_count() has been called. */
            public static int $asked = 0;

            public static function get_count( int $post_id ): int
            {
                unset( $post_id );
                ++self::$asked;
                return self::$connections;
            }
        }
    }
}
