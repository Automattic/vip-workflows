<?php
/**
 * Integration coverage: the transition-post ability and the warnings protocol.
 *
 * `StatusManager::transition()` can answer a `warnings_pending` ARRAY rather
 * than committing — a required tool that soft-failed, or a stage agent that is
 * mid-run and would be stopped. The ability only branched on `is_wp_error()`,
 * so it fell through and reported `success: true` for a transition that never
 * happened. Once the agent-interrupt warning joined that protocol, that meant
 * one AI agent could silently kill another and report success.
 *
 * Driven end to end (real sequence, real post, real StatusManager) because the
 * ability constructs its own StatusManager and there is nothing to inject.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StageAgentRunner;
use VIPWorkflows\Workflow\StatusManager;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/helpers.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/transition-post.php';

/**
 * Real-WordPress tests for transition-post's warnings_pending handling.
 */
class TransitionPostAbilityWarningsIntegrationTest extends TestCase
{
	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Admin user ID.
	 *
	 * @var int
	 */
	private int $admin_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->admin_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->admin_id );

		// Both stages sit in the `pending` region on purpose: the move is
		// same-region, so it writes no post_status and the test is isolated to
		// the warnings protocol rather than the publish boundary.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Agent Warning Flow',
			'agent-warning-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'ai_desk',
						'label'       => 'AI Desk',
						'status'      => 'pending',
						'agent'       => array(
							'ability_id' => 'test/desk-agent',
							'routing'    => array( 'error' => 'review' ),
						),
						'transitions' => array(
							array(
								'to'    => 'review',
								'label' => 'Review',
							),
						),
					),
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'status'      => 'pending',
						'transitions' => array(),
					),
				),
			),
			get_current_user_id()
		);
	}

	/**
	 * A workflow post at ai_desk with a fresh pending agent job for that stage.
	 *
	 * @return int Post ID.
	 */
	private function make_post_with_running_agent(): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'pending',
				'post_author' => $this->admin_id,
			)
		);

		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		update_post_meta(
			$post_id,
			StageAgentRunner::JOB_META,
			array(
				'stage_key'  => 'ai_desk',
				'ability_id' => 'test/desk-agent',
				'status'     => 'pending',
				'queued_at'  => current_time( 'mysql' ),
				'cause'      => 'workflow',
			)
		);

		return $post_id;
	}

	/**
	 * The ability reports the warning and moves NOTHING.
	 *
	 * Note the actor is an administrator — a workflow-bypass role. Bypassing the
	 * workflow is not the same as being told an agent is mid-run, so the warning
	 * still fires; it deliberately sits outside the tool-check bypass.
	 */
	public function test_pending_agent_warns_instead_of_reporting_success(): void
	{
		$post_id = $this->make_post_with_running_agent();

		$result = \VIPWorkflows\Abilities\Tools\execute_transition_post(
			array(
				'post_id'   => $post_id,
				'to_status' => 'review',
			)
		);

		$this->assertIsArray( $result );
		$this->assertFalse( $result['success'], 'A transition that did not happen must not report success.' );
		$this->assertTrue( $result['warnings_pending'] );
		$this->assertSame( 'agent_in_progress', $result['warnings'][0]['type'] );
		$this->assertSame(
			'An AI agent is working on this post — continuing will stop it.',
			$result['warnings'][0]['message']
		);

		// The origin is the STAGE left, not post_status — symmetric with
		// to_status, which is a stage key.
		$this->assertSame( 'ai_desk', $result['from_status'] );

		// Nothing was committed.
		$this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * Re-invoking with acknowledge_warnings performs the move: interrupting the
	 * agent is the caller's decision to make, it just has to be made explicitly.
	 */
	public function test_acknowledged_call_performs_the_transition(): void
	{
		$post_id = $this->make_post_with_running_agent();

		$result = \VIPWorkflows\Abilities\Tools\execute_transition_post(
			array(
				'post_id'              => $post_id,
				'to_status'            => 'review',
				'acknowledge_warnings' => true,
			)
		);

		$this->assertIsArray( $result );
		$this->assertTrue( $result['success'] );
		$this->assertArrayNotHasKey( 'warnings_pending', $result );
		$this->assertSame( 'ai_desk', $result['from_status'] );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * A post with no agent running is not warned — the ordinary path is
	 * untouched, and this is what proves the warning above came from the agent
	 * rather than from the stage being AI-owned at all.
	 */
	public function test_no_pending_agent_transitions_normally(): void
	{
		$post_id = $this->make_post_with_running_agent();
		delete_post_meta( $post_id, StageAgentRunner::JOB_META );

		$result = \VIPWorkflows\Abilities\Tools\execute_transition_post(
			array(
				'post_id'   => $post_id,
				'to_status' => 'review',
			)
		);

		$this->assertTrue( $result['success'] );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}
}
