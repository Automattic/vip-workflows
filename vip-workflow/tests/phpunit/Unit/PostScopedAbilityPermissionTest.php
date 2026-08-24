<?php
/**
 * Post-scoped ability permission tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use WP_Error;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-available-transitions.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-transition-history.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/keyword-check.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/readability.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/seo-check.php';

/**
 * Tests for post-level read authorization in ability execution callbacks.
 */
class PostScopedAbilityPermissionTest extends TestCase
{
    public function test_get_available_transitions_requires_edit_post_capability(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        $this->mock_existing_post_without_edit_permission( 123 );

        $result = \VIPWorkflow\Abilities\Tools\execute_get_available_transitions(
            array(
                'post_id' => 123,
            )
        );

        $this->assertForbiddenResult( $result );
    }

    public function test_get_transition_history_requires_edit_post_capability(): void
    {
        $this->mock_existing_post_without_edit_permission( 456 );

        $result = \VIPWorkflow\Abilities\Tools\execute_get_transition_history(
            array(
                'post_id' => 456,
            )
        );

        $this->assertForbiddenResult( $result );
    }

    public function test_keyword_check_requires_edit_post_capability_for_post_content(): void
    {
        $this->mock_existing_post_without_edit_permission( 789 );

        $result = \VIPWorkflow\Abilities\Tools\execute_keyword_check(
            array(
                'post_id' => 789,
            )
        );

        $this->assertForbiddenResult( $result );
    }

    public function test_readability_requires_edit_post_capability_for_post_content(): void
    {
        $this->mock_existing_post_without_edit_permission( 790 );

        $result = \VIPWorkflow\Abilities\Tools\execute_readability(
            array(
                'post_id' => 790,
            )
        );

        $this->assertForbiddenResult( $result );
    }

    public function test_seo_check_requires_edit_post_capability_for_post_content(): void
    {
        $this->mock_existing_post_without_edit_permission( 791 );

        $result = \VIPWorkflow\Abilities\Tools\execute_seo_check(
            array(
                'post_id' => 791,
            )
        );

        $this->assertForbiddenResult( $result );
    }

    private function mock_existing_post_without_edit_permission( int $post_id ): void
    {
        Functions\when( 'get_post' )->justReturn(
            (object) array(
                'ID'          => $post_id,
                'post_title'  => 'A post',
                'post_status' => 'draft',
            )
        );

        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $checked_post_id = null ) => ! ( 'edit_post' === $capability && $post_id === $checked_post_id )
        );
    }

    private function assertForbiddenResult( $result ): void
    {
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'forbidden', $result->get_error_code() );
    }
}
