<?php
/**
 * Ideation source-upload permission tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\API\IdeationSourcesController;
use VIPWorkflows\Ideation\Research\IdeationPostTypes;

/**
 * The source-upload route must require the standard upload_files capability, not
 * just edit access to the project.
 */
class IdeationSourcesUploadPermissionTest extends TestCase
{
    private function controller(): IdeationSourcesController
    {
        return ( new \ReflectionClass( IdeationSourcesController::class ) )->newInstanceWithoutConstructor();
    }

    private function request( array $params ): object
    {
        $request = Mockery::mock( 'WP_REST_Request' );
        $request->shouldReceive( 'get_param' )->andReturnUsing( fn( $key ) => $params[ $key ] ?? null );
        return $request;
    }

    private function stub_owned_project(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 9 );
        Functions\when( 'get_post' )->justReturn(
            (object) array(
                'ID'          => 5,
                'post_type'   => IdeationPostTypes::POST_TYPE,
                'post_author' => 9,
            )
        );
    }

    public function test_upload_denied_without_upload_files_capability(): void
    {
        $this->stub_owned_project();

        // Owns the project (edit_posts) but lacks upload_files.
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => 'edit_posts' === $capability
        );

        $this->assertFalse(
            $this->controller()->upload_permissions_check( $this->request( array( 'id' => 5 ) ) )
        );
    }

    public function test_upload_allowed_with_upload_files_and_ownership(): void
    {
        $this->stub_owned_project();

        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => in_array( $capability, array( 'edit_posts', 'upload_files' ), true )
        );

        $this->assertTrue(
            $this->controller()->upload_permissions_check( $this->request( array( 'id' => 5 ) ) )
        );
    }
}
