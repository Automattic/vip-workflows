<?php
/**
 * Test double for VIP Real-Time Collaboration's room presence.
 *
 * CoEditing reads the number of users actively editing a post from
 * `RoomPresence::count_users()` when that plugin is loaded. Loaded once from
 * bootstrap.php, unit branch only, so every suite sees the same class. Tests
 * set the count through TestCase::stub_room_presence_users(), and TestCase
 * resets it between tests.
 *
 * @package VIPWorkflows\Tests
 */

declare( strict_types=1 );

namespace VIPRealTimeCollaboration\Presence {
    if ( ! class_exists( RoomPresence::class, false ) ) {
        final class RoomPresence
        {
            /** @var int Users count_users() reports for every post. */
            public static int $users = 0;

            /** @var int How many times count_users() has been called. */
            public static int $asked = 0;

            public static function count_users( int $post_id ): int
            {
                unset( $post_id );
                ++self::$asked;
                return self::$users;
            }
        }
    }
}
