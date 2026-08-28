<?php
/**
 * Transition Post ability tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use WP_Error;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/transition-post.php';

/**
 * Tests for transition-post ability authorization.
 */
class TransitionPostToolTest extends TestCase
{
    public function test_execute_requires_edit_post_capability_for_target_post(): void
    {
        Functions\when( 'get_post' )->justReturn(
            (object) array(
                'ID'          => 123,
                'post_title'  => 'A post',
                'post_status' => 'draft',
            )
        );

        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => ! ( 'edit_post' === $capability && 123 === $post_id )
        );

        $result = \VIPWorkflow\Abilities\Tools\execute_transition_post(
            array(
                'post_id'   => 123,
                'to_status' => 'review',
            )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'forbidden', $result->get_error_code() );
    }
}
