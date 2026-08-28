<?php
/**
 * Ideation controller authorization tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\API\IdeationController;

/**
 * Project-scoped reads and the mentor write are gated by ownership (the gate
 * get_state/get_summary/run_mentor now use), and author=all can't leak every
 * user's projects.
 */
class IdeationControllerPermissionTest extends TestCase
{
    private function controller(): IdeationController
    {
        return ( new \ReflectionClass( IdeationController::class ) )->newInstanceWithoutConstructor();
    }

    private function request( array $params ): object
    {
        $request = Mockery::mock( 'WP_REST_Request' );
        $request->shouldReceive( 'get_param' )->andReturnUsing( fn( $key ) => $params[ $key ] ?? null );
        return $request;
    }

    private function stub_project_owned_by( int $author ): void
    {
        Functions\when( 'get_post' )->justReturn(
            (object) array( 'ID' => 7, 'post_author' => $author )
        );
    }

    public function test_edit_check_denies_non_owner_without_edit_others_posts(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 9 );
        Functions\when( 'current_user_can' )->alias( fn( $capability ) => 'edit_posts' === $capability );
        $this->stub_project_owned_by( 2 );

        $this->assertFalse(
            $this->controller()->edit_permissions_check( $this->request( array( 'id' => 7 ) ) )
        );
    }

    public function test_edit_check_allows_owner(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 9 );
        Functions\when( 'current_user_can' )->alias( fn( $capability ) => 'edit_posts' === $capability );
        $this->stub_project_owned_by( 9 );

        $this->assertTrue(
            $this->controller()->edit_permissions_check( $this->request( array( 'id' => 7 ) ) )
        );
    }

    public function test_edit_check_allows_edit_others_posts(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 9 );
        Functions\when( 'current_user_can' )->alias(
            fn( $capability ) => in_array( $capability, array( 'edit_posts', 'edit_others_posts' ), true )
        );
        $this->stub_project_owned_by( 2 );

        $this->assertTrue(
            $this->controller()->edit_permissions_check( $this->request( array( 'id' => 7 ) ) )
        );
    }

    /**
     * Capture the query args list_projects passes to get_posts.
     */
    private function captured_list_query( string $author, bool $can_edit_others ): array
    {
        Functions\when( 'get_current_user_id' )->justReturn( 9 );
        Functions\when( 'current_user_can' )->justReturn( $can_edit_others );

        $captured = array();
        Functions\when( 'get_posts' )->alias(
            function ( $args ) use ( &$captured ) {
                $captured = $args;
                return array();
            }
        );

        global $wpdb;
        $wpdb = (object) array( 'prefix' => 'wp_' );

        $this->controller()->list_projects( $this->request( array( 'per_page' => 10, 'author' => $author ) ) );

        return $captured;
    }

    public function test_author_all_without_cap_is_scoped_to_current_user(): void
    {
        $args = $this->captured_list_query( 'all', false );
        $this->assertSame( 9, $args['author'] );
    }

    public function test_author_all_with_cap_lists_every_project(): void
    {
        $args = $this->captured_list_query( 'all', true );
        $this->assertArrayNotHasKey( 'author', $args );
    }

    public function test_author_me_is_scoped_to_current_user(): void
    {
        $args = $this->captured_list_query( 'me', false );
        $this->assertSame( 9, $args['author'] );
    }
}
