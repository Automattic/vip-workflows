<?php
/**
 * The agent exit transition must be authorised against a real identity.
 *
 * Invariant A: no unauthenticated actor may transition the state of any post
 * type. The stage-agent runner borrows the post author's identity to execute
 * the ability, restores the previous user, and only then writes the state — so
 * under cron the write happens at uid 0. `agent_actor` then switches off the
 * capability gates, so nothing evaluates a capability anywhere in the request.
 *
 * These tests pin the contract at the enforcement point: `agent_actor` may
 * waive the workflow's own configuration rules (sequence role table,
 * requires_assignment), but never core capabilities.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Workflow\StatusManager;

class AgentTransitionAuthorityTest extends TestCase
{
    /**
     * Reflectively invoke the private region-crossing check for a given user.
     *
     * @param  StatusManager $sm      Status manager.
     * @param  \WP_Post      $post    Post double.
     * @param  string        $from    From region.
     * @param  string        $to      To region.
     * @param  int           $user_id Actor to evaluate against.
     * @return bool
     */
    private function can_cross( StatusManager $sm, $post, string $from, string $to, int $user_id ): bool
    {
        $m = new \ReflectionMethod( StatusManager::class, 'user_can_cross_region' );
        return (bool) $m->invoke( $sm, $post, $from, $to, $user_id );
    }

    /**
     * The region-crossing check must answer for a NAMED user, not for whoever
     * happens to be current. Under cron the current user is 0, so a check that
     * reads ambient state cannot protect the publish boundary.
     */
    public function test_region_crossing_is_evaluated_against_a_named_user(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 42, 'post_type' => 'post' ) );

        Functions\when( 'get_post_type_object' )->justReturn(
            (object) array(
                'cap' => (object) array(
                    'publish_posts'        => 'publish_posts',
                    'edit_published_posts' => 'edit_published_posts',
                ),
            )
        );

        // User 7 may publish; user 9 may not. Nobody is "current" — uid 0.
        Functions\when( 'user_can' )->alias(
            function ( $uid, $cap ) {
                return 7 === $uid && 'publish_posts' === $cap;
            }
        );
        Functions\when( 'current_user_can' )->justReturn( false );
        Functions\when( 'get_current_user_id' )->justReturn( 0 );

        $sm = Mockery::mock( StatusManager::class )->makePartial();

        $this->assertTrue(
            $this->can_cross( $sm, $post, 'draft', 'publish', 7 ),
            'a user holding publish_posts may cross into the publish region'
        );

        $this->assertFalse(
            $this->can_cross( $sm, $post, 'draft', 'publish', 9 ),
            'a user without publish_posts must not cross into the publish region, '
                . 'even when the transition is driven by an agent'
        );

        $this->assertFalse(
            $this->can_cross( $sm, $post, 'draft', 'publish', 0 ),
            'uid 0 — the cron context — must never cross the publish boundary'
        );
    }

    /**
     * An unregistered post type must still fail closed for a named user, the
     * same way it already does for the current user.
     */
    public function test_unresolvable_post_type_fails_closed(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 42, 'post_type' => 'gone' ) );

        // error_log is not stubbed: phpunit.xml routes it away, and the repo's
        // convention (see SequenceTest) is to capture it rather than patch it.
        Functions\when( 'get_post_type_object' )->justReturn( null );
        Functions\when( 'user_can' )->justReturn( true );

        $sm = Mockery::mock( StatusManager::class )->makePartial();

        $this->assertFalse(
            $this->can_cross( $sm, $post, 'draft', 'publish', 7 ),
            'an unresolvable post type fails closed'
        );
    }
}
