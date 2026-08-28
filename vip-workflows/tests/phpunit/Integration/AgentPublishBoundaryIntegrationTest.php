<?php
/**
 * Integration coverage for Invariant A: a stage agent must not carry a post
 * across the publish boundary on behalf of someone who could not cross it.
 *
 * The runner borrows the post author's identity to execute the ability, then
 * restores the previous user BEFORE writing the exit transition — so under cron
 * the write lands at uid 0. `agent_actor` then waives the capability gates in
 * StatusManager::transition(), and nothing evaluates a capability anywhere in
 * the request.
 *
 * These tests run against real WordPress with real roles, so the capability
 * answers are core's own.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Abilities\AbilityExecutor;
use VIPWorkflow\Abilities\AbilityResult;
use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\StageAgentRunner;
use VIPWorkflow\Workflow\StatusManager;

/**
 * Real-WordPress tests for the agent publish boundary.
 */
class AgentPublishBoundaryIntegrationTest extends TestCase
{
	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * A user who may edit posts but may NOT publish them.
	 *
	 * @var int
	 */
	private int $contributor_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->contributor_id = (int) self::factory()->user->create( array( 'role' => 'contributor' ) );

		// An AI stage in the draft region whose `pass` route lands in a stage
		// declared in the publish region. This is ordinary, supported
		// configuration — SequencesController imposes no region constraint on
		// an agent's routing table.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Agent Publish Flow',
			'agent-publish-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'    => 'ai_desk',
						'label'  => 'AI Desk',
						'status' => 'draft',
						'agent'  => array(
							'ability_id' => 'vip-workflow/test-agent',
							'routing'    => array(
								'pass'  => 'live',
								'fail'  => 'ai_desk',
								'error' => 'ai_desk',
							),
						),
						'transitions' => array(
							array( 'to' => 'live' ),
							array( 'to' => 'ai_desk' ),
						),
					),
					array(
						'key'         => 'live',
						'label'       => 'Live',
						'status'      => 'publish',
						'transitions' => array(),
					),
				),

				// This file is about the capability layer. The separate policy that
				// holds agent-driven publication (StageAgentRunner::finish()) would
				// stop every run here before a capability was ever evaluated, so the
				// tests below would pass without proving anything. Opting in removes
				// the policy so the gate under test is the only thing left refusing.
				// The policy's own coverage is test_policy_holds_publication_* below.
				'settings'   => array( 'allow_agent_publish' => true ),
			),
			self::factory()->user->create( array( 'role' => 'administrator' ) )
		);
	}

	/**
	 * Seat a contributor-authored post at the AI stage.
	 *
	 * @return int Post ID.
	 */
	private function make_contributor_post(): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->contributor_id,
			)
		);

		update_post_meta( $post_id, '_vip_workflow_sequence_id', $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );

		return $post_id;
	}

	/**
	 * An executor whose ability always returns a passing verdict.
	 *
	 * @return AbilityExecutor
	 */
	private function passing_executor(): AbilityExecutor
	{
		return new class() extends AbilityExecutor {
			/**
			 * Return a passing result without touching the registry.
			 *
			 * @param  string $ability_name Ability name.
			 * @param  array  $input        Input.
			 * @param  string $context      Context.
			 * @return AbilityResult
			 */
			public function execute( string $ability_name, array $input = array(), string $context = '' ): AbilityResult {
				return AbilityResult::success( $ability_name, array( 'status' => 'pass' ) );
			}
		};
	}

	/**
	 * INVARIANT A. The agent runs in cron, where there is no current user. Its
	 * exit transition must not publish a post whose author cannot publish.
	 */
	public function test_agent_does_not_publish_for_an_author_who_cannot_publish(): void
	{
		$post_id = $this->make_contributor_post();

		// Cron: nobody is logged in. This is the real condition, not a contrivance.
		wp_set_current_user( 0 );

		( new StageAgentRunner( $this->passing_executor() ) )->run_stage_agent( $post_id, 'ai_desk' );

		$this->assertNotSame(
			'publish',
			get_post_status( $post_id ),
			'a contributor-authored post must not reach publish via an agent: '
				. 'the author holds edit_posts but not publish_posts, and the runner has no user at all'
		);

		$this->assertSame(
			'ai_desk',
			get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ),
			'the post stays in the AI stage when its exit transition is refused'
		);
	}

	/**
	 * A transition that names no actor is refused at the baseline capability.
	 *
	 * The other half of the contract, and the one that stops `agent_actor` being
	 * a bypass by another name: uid 0 holds nothing, so a call that claims to be
	 * an agent without saying who it acts for cannot write state. Asserted
	 * against transition() directly, because the runner always resolves an actor
	 * — this is the guarantee for any future caller that does not.
	 */
	public function test_agent_transition_naming_no_actor_is_refused(): void
	{
		$post_id = $this->make_contributor_post();
		wp_set_current_user( 0 );

		$result = \VIPWorkflow\Plugin::get_instance()->get_status_manager()->transition(
			$post_id,
			'live',
			array(
				'agent_actor'      => 'vip-workflow/test-agent',
				'agent_actor_user' => 0,
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'cannot_edit_post', $result->get_error_code() );
		$this->assertSame(
			'ai_desk',
			get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ),
			'nothing is written when no actor is named'
		);
	}

	/**
	 * The same run for an author who DOES hold publish_posts must still work —
	 * the fix must refuse the unauthorised crossing, not disable agents.
	 */
	public function test_agent_still_publishes_for_an_author_who_can_publish(): void
	{
		$author_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );

		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $author_id,
			)
		);
		update_post_meta( $post_id, '_vip_workflow_sequence_id', $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );

		wp_set_current_user( 0 );

		( new StageAgentRunner( $this->passing_executor() ) )->run_stage_agent( $post_id, 'ai_desk' );

		$this->assertSame(
			'live',
			get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ),
			'an editor-authored post still advances: the boundary check refuses '
				. 'the unauthorised crossing only'
		);
	}

	/**
	 * The policy layer, on a sequence that has NOT opted in.
	 *
	 * The author here holds publish_posts, so the capability gate would let this
	 * through — which is the point. Publication is held because a model verdict
	 * decided it, not because the actor lacked the right.
	 */
	public function test_policy_holds_publication_when_the_sequence_has_not_opted_in(): void
	{
		$sequence_id = $this->sequence_without_opt_in();
		$author_id   = (int) self::factory()->user->create( array( 'role' => 'editor' ) );

		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $author_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );

		wp_set_current_user( 0 );

		( new StageAgentRunner( $this->passing_executor() ) )->run_stage_agent( $post_id, 'ai_desk' );

		$this->assertSame(
			'ai_desk',
			get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ),
			'the post waits for a person even though its author could have published it'
		);
		$this->assertNotSame(
			'publish',
			get_post_status( $post_id ),
			'and the post is not live'
		);
	}

	/**
	 * The same sequence with the policy left at its default.
	 *
	 * @return int Sequence ID.
	 */
	private function sequence_without_opt_in(): int
	{
		return (int) ( new SequenceRepository() )->create(
			'Agent Publish Flow (default policy)',
			'agent-publish-flow-default',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'ai_desk',
						'label'       => 'AI Desk',
						'status'      => 'draft',
						'agent'       => array(
							'ability_id' => 'vip-workflow/test-agent',
							'routing'    => array( 'pass' => 'live', 'fail' => 'ai_desk', 'error' => 'ai_desk' ),
						),
						'transitions' => array(
							array( 'to' => 'live' ),
							array( 'to' => 'ai_desk' ),
						),
					),
					array(
						'key'         => 'live',
						'label'       => 'Live',
						'status'      => 'publish',
						'transitions' => array(),
					),
				),
			),
			self::factory()->user->create( array( 'role' => 'administrator' ) )
		);
	}
}
