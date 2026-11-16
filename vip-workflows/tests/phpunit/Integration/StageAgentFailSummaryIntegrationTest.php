<?php
/**
 * Fail-summary persistence through real workflow transitions and post metadata.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\AbilityExecutor;
use VIPWorkflows\Abilities\AbilityResult;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StageAgentRunner;
use VIPWorkflows\Workflow\StatusManager;

class StageAgentFailSummaryIntegrationTest extends TestCase
{
    public const SUMMARY = 'The edit added 1 link. Nothing was written.';

    private function make_post( array $routing ): int
    {
        $author = self::factory()->user->create( array( 'role' => 'administrator' ) );
        wp_set_current_user( $author );
        $sequence_id = ( new SequenceRepository() )->create(
            'Agent summary flow',
            'agent-summary-flow',
            '',
            array(
                'post_types' => array( 'post' ),
                'statuses' => array(
                    array(
                        'key' => 'ai_desk',
                        'label' => 'AI desk',
                        'status' => 'draft',
                        'region_entry' => true,
                        'agent' => array(
                            'ability_id' => 'vip-workflows/test-summary-agent',
                            'routing' => $routing,
                        ),
                        'transitions' => array( array( 'to' => 'human_review' ) ),
                    ),
                    array(
                        'key' => 'human_review',
                        'label' => 'Human review',
                        'status' => 'draft',
                        'transitions' => array(),
                    ),
                ),
            ),
            $author
        );
        $this->assertIsInt( $sequence_id );
        $post_id = self::factory()->post->create( array( 'post_status' => 'draft', 'post_author' => $author ) );
        update_post_meta( $post_id, '_vip_workflows_sequence_id', $sequence_id );
        update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
        return $post_id;
    }

    private function run_failed_agent( int $post_id ): void
    {
        $executor = new class() extends AbilityExecutor {
            public function execute( string $ability_name, array $input = array(), string $context = '', string $source = 'rest' ): AbilityResult
            {
                return AbilityResult::success(
                    $ability_name,
                    array( 'status' => 'fail', 'summary' => StageAgentFailSummaryIntegrationTest::SUMMARY )
                );
            }
        };
        wp_set_current_user( 0 );
        ( new StageAgentRunner( $executor ) )->run_stage_agent( $post_id, 'ai_desk' );
    }

    public function test_routed_fail_summary_is_in_the_real_audit_event(): void
    {
        $post_id = $this->make_post( array( 'fail' => 'human_review' ) );
        $this->run_failed_agent( $post_id );

        $this->assertSame( 'human_review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
        $history = \VIPWorkflows\Plugin::get_instance()->get_status_manager()->get_transition_history( $post_id );
        $this->assertNotEmpty( $history );
        $this->assertSame( 'status_transition', $history[0]['event_type'] );
        $this->assertSame( self::SUMMARY, $history[0]['event_data']['comment'] );
    }

    public function test_unrouted_fail_summary_is_in_the_real_job_marker(): void
    {
        $post_id = $this->make_post( array() );
        $this->run_failed_agent( $post_id );

        $this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
        $marker = get_post_meta( $post_id, '_vip_workflows_agent_job', true );
        $this->assertIsArray( $marker );
        $this->assertSame( 'failed', $marker['status'] );
        $this->assertStringContainsString( self::SUMMARY, $marker['error'] );
    }
}
