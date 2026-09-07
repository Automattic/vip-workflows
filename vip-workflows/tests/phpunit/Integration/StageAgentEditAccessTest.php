<?php
/**
 * Integration coverage for edit access on a workflow-managed post.
 *
 * The workflow used to revoke edit_post behind the user's back through a
 * map_meta_cap filter — once while a stage agent owned the post, once when the
 * user's role had no permitted transitions at the stage. Both locks are gone:
 * if a user holds core edit_post they can edit, full stop, and interrupting a
 * running agent is a warn/confirm rather than a lockout.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Workflow\StageAgentRunner;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Proves the workflow never silently revokes core edit_post.
 */
class StageAgentEditAccessTest extends TestCase
{
    /**
     * Create a non-bypass author sitting on their own workflow-managed draft.
     *
     * @return array{0: int, 1: int} User ID and post ID.
     */
    private function workflow_post_for_contributor(): array
    {
        // A contributor is not in the default bypass_workflow_roles, so the old
        // workflow edit restriction would have applied to them.
        $user_id = self::factory()->user->create( array( 'role' => 'contributor' ) );
        $post_id = self::factory()->post->create(
            array(
                'post_author' => $user_id,
                'post_status' => 'draft',
            )
        );

        update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, 999999 );

        wp_set_current_user( $user_id );

        return array( $user_id, $post_id );
    }

    /**
     * A workflow post that offers its author no transitions at all is still
     * editable by them — workflow configuration governs which buttons appear,
     * never whether the user may edit.
     */
    public function test_workflow_post_with_no_transitions_stays_editable(): void
    {
        list( $user_id, $post_id ) = $this->workflow_post_for_contributor();

        $this->assertTrue(
            user_can( $user_id, 'edit_post', $post_id ),
            'A workflow post must not revoke the core edit_post capability.'
        );
    }

    /**
     * A pending stage-agent job no longer locks humans out: anyone with edit
     * access can interrupt an agent working on their behalf.
     */
    public function test_pending_agent_job_does_not_revoke_edit_post(): void
    {
        list( $user_id, $post_id ) = $this->workflow_post_for_contributor();

        update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
        update_post_meta(
            $post_id,
            StageAgentRunner::JOB_META,
            array(
                'stage_key'  => 'ai_desk',
                'ability_id' => 'vip-workflows/fact-check',
                'status'     => 'pending',
                'queued_at'  => current_time( 'mysql' ),
            )
        );

        $this->assertTrue(
            user_can( $user_id, 'edit_post', $post_id ),
            'A running stage agent must not revoke the core edit_post capability.'
        );
    }
}
