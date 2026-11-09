<?php
/**
 * Integration coverage for StageAgent::write_content()'s concurrent-edit guard.
 *
 * A stage agent reads the post, waits on the model, then writes, all in one
 * request. A save made by anyone else during that wait lands in another
 * process, which never touches this request's copy of the post. These tests
 * stand in for that other process by writing straight to the posts table, so
 * the agent's request keeps whatever copy it already holds, exactly as it
 * would in production.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

/**
 * Tests that an agent write never overwrites a save made while it was working.
 */
class StageAgentConcurrentEditTest extends TestCase
{
    public function set_up(): void
    {
        parent::set_up();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    /**
     * Save the post the way another request would: in the database, without
     * touching this request's copy of it.
     *
     * @param int                  $post_id Post ID.
     * @param array<string,string> $fields  Columns to change.
     */
    private function save_elsewhere( int $post_id, array $fields ): void
    {
        global $wpdb;

        $fields['post_modified_gmt'] = '2030-01-01 00:00:00';
        $fields['post_modified']     = '2030-01-01 00:00:00';

        $wpdb->update( $wpdb->posts, $fields, array( 'ID' => $post_id ) );
    }

    public function test_a_save_made_while_the_agent_worked_is_not_overwritten(): void
    {
        $post_id = self::factory()->post->create( array( 'post_content' => 'Original.' ) );

        $read = StageAgent::read_post( $post_id );
        $this->assertIsArray( $read );

        $this->save_elsewhere( $post_id, array( 'post_content' => 'Human edit.' ) );

        $result = StageAgent::write_content( $post_id, '<p>Agent rewrite.</p>', $read['modified'] );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'concurrent_edit', $result->get_error_code() );

        clean_post_cache( $post_id );
        $this->assertSame( 'Human edit.', get_post_field( 'post_content', $post_id ), 'The human edit must survive the agent write.' );
    }

    public function test_an_untouched_post_is_written(): void
    {
        $post_id = self::factory()->post->create( array( 'post_content' => 'Original.' ) );

        $read = StageAgent::read_post( $post_id );
        $this->assertIsArray( $read );

        $this->assertTrue( StageAgent::write_content( $post_id, '<p>Agent rewrite.</p>', $read['modified'] ) );

        clean_post_cache( $post_id );
        $this->assertSame( '<p>Agent rewrite.</p>', get_post_field( 'post_content', $post_id ) );
    }

    public function test_the_write_does_not_revert_fields_the_agent_did_not_set(): void
    {
        $post_id = self::factory()->post->create(
            array(
                'post_title'   => 'Original title',
                'post_excerpt' => 'Original excerpt',
                'post_content' => 'Original.',
            )
        );

        // Load the post into this request, as read_post() does.
        $this->assertIsArray( StageAgent::read_post( $post_id ) );

        $this->save_elsewhere(
            $post_id,
            array(
                'post_title'   => 'Human title',
                'post_excerpt' => 'Human excerpt',
            )
        );

        // No expected timestamp, so the write goes ahead: what's under test is
        // which title and excerpt it carries with it.
        $this->assertTrue( StageAgent::write_content( $post_id, '<p>Agent rewrite.</p>' ) );

        clean_post_cache( $post_id );
        $post = get_post( $post_id );
        $this->assertSame( 'Human title', $post->post_title );
        $this->assertSame( 'Human excerpt', $post->post_excerpt );
        $this->assertSame( '<p>Agent rewrite.</p>', $post->post_content );
    }
}
