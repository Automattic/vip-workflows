<?php
/**
 * Agent revision attribution under real WordPress.
 *
 * The unit test mocks the meta functions, which is how a real-WordPress
 * behavior hid: update_post_meta() redirects a revision ID to its parent post,
 * so the tag landed on the post and no revision was ever labelled.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Workflow\StageAgentRunner;

class StageAgentRevisionAttributionIntegrationTest extends TestCase
{
    /**
     * Set the runner's acting ability, as run_stage_agent() does around execution.
     * Integration\TestCase::set_up() resets it before every test.
     *
     * @param string $ability_id Ability ID, or '' for a human edit.
     */
    private function set_acting_ability( string $ability_id ): void
    {
        ( new \ReflectionProperty( StageAgentRunner::class, 'acting_ability_id' ) )->setValue( null, $ability_id );
    }

    public function test_an_agent_write_tags_the_revision_not_the_post(): void
    {
        $post_id = self::factory()->post->create( array( 'post_content' => '<p>Original copy.</p>' ) );

        $this->set_acting_ability( 'workflow-agent-copy-edit/copy-edit' );
        wp_update_post(
            array(
                'ID'           => $post_id,
                'post_content' => '<p>Edited copy.</p>',
            )
        );
        $this->set_acting_ability( '' );

        $revisions = wp_get_post_revisions( $post_id );
        $this->assertNotEmpty( $revisions );
        $latest = reset( $revisions );

        $this->assertSame( 'workflow-agent-copy-edit/copy-edit', get_post_meta( $latest->ID, StageAgentRunner::AGENT_REVISION_META, true ) );
        $this->assertSame( '', get_post_meta( $post_id, StageAgentRunner::AGENT_REVISION_META, true ), 'The tag belongs on the revision, not the post.' );
    }

    public function test_a_human_write_tags_nothing(): void
    {
        $post_id = self::factory()->post->create( array( 'post_content' => '<p>Original copy.</p>' ) );
        wp_update_post(
            array(
                'ID'           => $post_id,
                'post_content' => '<p>Edited copy.</p>',
            )
        );

        $revisions = wp_get_post_revisions( $post_id );
        $this->assertNotEmpty( $revisions );
        $latest = reset( $revisions );

        $this->assertSame( '', get_post_meta( $latest->ID, StageAgentRunner::AGENT_REVISION_META, true ) );
    }

	/**
	 * The revisions screen reads `author.name`, so the relabelled author must
	 * still be core's object, as it comes through the screen's own data path.
	 */
	public function test_the_revisions_screen_shows_the_agent_as_author(): void
	{
		require_once ABSPATH . 'wp-admin/includes/revision.php';
		// An ability that is never registered, so the name lookup warns and
		// falls back to the id on every branch. The label's shape is what's
		// under test.
		$this->setExpectedIncorrectUsage( 'WP_Abilities_Registry::get_registered' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$post_id = self::factory()->post->create( array( 'post_content' => '<p>Original copy.</p>' ) );
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => '<p>Human edit.</p>',
			)
		);
		$this->set_acting_ability( 'test-extension/unregistered-agent' );
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => '<p>Agent edit.</p>',
			)
		);
		$this->set_acting_ability( '' );

		$revisions = wp_get_post_revisions( $post_id );
		$agent_rev = (int) reset( $revisions )->ID;
		$prepared  = wp_prepare_revisions_for_js( get_post( $post_id ), $agent_rev );
		$by_id     = array_column( $prepared['revisionData'], 'author', 'id' );
		$latest    = $by_id[ $agent_rev ];

		$this->assertIsArray( $latest );
		$this->assertArrayHasKey( 'avatar', $latest );
		$this->assertStringEndsWith( ' (agent)', $latest['name'] );
	}
}
