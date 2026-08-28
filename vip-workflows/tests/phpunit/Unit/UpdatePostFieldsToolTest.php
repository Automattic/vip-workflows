<?php
/**
 * Update Post Fields ability tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use WP_Error;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/update-post-fields.php';

/**
 * Tests for update-post-fields authorship-reassignment gating.
 */
class UpdatePostFieldsToolTest extends TestCase
{
    /**
     * Stub a post the current user can edit, authored by user 1.
     */
    private function stub_editable_post(): void
    {
        Functions\when( 'get_post' )->justReturn(
            (object) array(
                'ID'          => 123,
                'post_title'  => 'A post',
                'post_status' => 'draft',
                'post_author' => 1,
            )
        );
        Functions\when( 'get_post_field' )->justReturn( 1 );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'ID' => 2 ) );
    }

    public function test_author_reassignment_denied_without_edit_others_posts(): void
    {
        $this->stub_editable_post();

        // Can edit this post, but lacks edit_others_posts.
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => 'edit_post' === $capability && 123 === $post_id
        );

        $result = \VIPWorkflow\Abilities\Tools\execute_update_post_fields(
            array(
                'post_id' => 123,
                'fields'  => array( 'author' => 2 ),
            )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'forbidden_author_reassign', $result->get_error_code() );
    }

    public function test_author_reassignment_allowed_with_edit_others_posts(): void
    {
        $this->stub_editable_post();

        // Editor: can edit this post AND has edit_others_posts.
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => in_array( $capability, array( 'edit_post', 'edit_others_posts' ), true )
        );

        $result = \VIPWorkflow\Abilities\Tools\execute_update_post_fields(
            array(
                'post_id' => 123,
                'fields'  => array( 'author' => 2 ),
            )
        );

        // Not blocked — returns a confirmation preview, not a WP_Error.
        $this->assertIsArray( $result );
        $this->assertArrayHasKey( 'requires_confirmation', $result );
    }

    public function test_non_author_field_update_is_unaffected(): void
    {
        $this->stub_editable_post();

        // Contributor: can edit own post, no edit_others_posts. Updating title only
        // must not trip the author gate.
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => 'edit_post' === $capability && 123 === $post_id
        );

        $result = \VIPWorkflow\Abilities\Tools\execute_update_post_fields(
            array(
                'post_id' => 123,
                'fields'  => array( 'title' => 'New Title' ),
            )
        );

        $this->assertIsArray( $result );
        $this->assertArrayHasKey( 'requires_confirmation', $result );
    }
}
