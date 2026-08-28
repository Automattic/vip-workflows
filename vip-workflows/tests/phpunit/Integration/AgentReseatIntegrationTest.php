<?php
/**
 * Integration coverage: a core-driven checkpoint reseat cancels an in-flight
 * stage-agent job for the departed stage — the run abandons cleanly (result
 * discarded, no spurious failure), while the new entry stage's own dispatch
 * (cause 'core') proceeds normally, exactly once.
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
 * Real-WordPress tests for the reseat × stage-agent race.
 */
class AgentReseatIntegrationTest extends TestCase
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

		// Two AI-owned stages in different regions: a core status change into
		// the draft region reseats at ai_intake (the region's entry stage),
		// which is itself AI-owned so the reseat dispatches its agent. Each
		// region here holds one stage, so each is its own region's checkpoint —
		// which is what makes every crossing below a legal one.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Agent Reseat Flow',
			'agent-reseat-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'ai_intake',
						'label'       => 'AI Intake',
						'status'      => 'draft',
						'agent'       => array(
							'ability_id' => 'test/intake-agent',
							'routing'    => array( 'error' => 'ai_desk' ),
						),
						// The ai_intake → review edge exists ON PURPOSE: without
						// the post-execution re-check, a stale ai_desk run whose
						// pass route is 'review' would find this valid edge from
						// the reseated stage and visibly move the post — the
						// mid-execution test discriminates on exactly that.
						//
						// Which is why `review` gets a region of its own (below):
						// a region can only be entered through its checkpoint, so
						// a stage reachable from BOTH ai_intake (draft) and
						// ai_desk (pending) has to be the checkpoint of a third
						// region — being its only stage, it is.
						'transitions' => array(
							array(
								'to'    => 'ai_desk',
								'label' => 'Advance',
							),
							array(
								'to'    => 'review',
								'label' => 'Review',
							),
						),
					),
					array(
						'key'         => 'ai_desk',
						'label'       => 'AI Desk',
						'status'      => 'pending',
						'agent'       => array(
							'ability_id' => 'test/desk-agent',
							'routing'    => array(
								'pass'  => 'review',
								'error' => 'review',
							),
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
						'status'      => 'private',
						'transitions' => array(),
					),
				),
			),
			get_current_user_id()
		);
	}

	/**
	 * Create a workflow post sitting at ai_desk (pending region) with a
	 * pending agent job for that stage.
	 *
	 * @return int Post ID.
	 */
	private function make_ai_desk_post(): int
	{
		$post_id = self::factory()->post->create(
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
	 * A core status change reseats the post at the new region's entry stage
	 * and dispatches that stage's agent (cause 'core', exactly one pending
	 * job); the old stage's stale cron run then abandons without executing,
	 * without recording a failure, and without touching the new job.
	 */
	public function test_reseat_before_stale_run_replaces_job_and_run_abandons(): void
	{
		$post_id = $this->make_ai_desk_post();

		// Core-driven status change (quick edit / REST / CLI): pending → draft
		// crosses a region boundary, so the reconcile reseats the stage.
		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'draft',
			)
		);

		$this->assertSame( 'ai_intake', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'The reseat seats the post at the draft region entry stage.' );

		// Exactly ONE pending job exists, owned by the new stage, cause 'core'.
		$jobs = get_post_meta( $post_id, StageAgentRunner::JOB_META );
		$this->assertCount( 1, $jobs );
		$this->assertSame( 'pending', $jobs[0]['status'] );
		$this->assertSame( 'ai_intake', $jobs[0]['stage_key'] );
		$this->assertSame( 'core', $jobs[0]['cause'] );

		// The departed stage's cron run arrives late: it must abandon without
		// executing anything and without touching the new stage's job.
		$executor = new class() extends AbilityExecutor {
			/**
			 * Whether execute() ran.
			 *
			 * @var bool
			 */
			public bool $called = false;

			public function execute( string $ability_name, array $input = array(), string $context = '' ): AbilityResult {
				$this->called = true;
				return new AbilityResult();
			}
		};

		( new StageAgentRunner( $executor ) )->run_stage_agent( $post_id, 'ai_desk' );

		$this->assertFalse( $executor->called, 'The stale run must not execute the agent.' );

		$job = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$this->assertSame( 'pending', $job['status'], 'No spurious failure may be recorded.' );
		$this->assertSame( 'ai_intake', $job['stage_key'], 'The new stage\'s job survives the stale run.' );
		$this->assertSame( 'ai_intake', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * A reseat landing MID-EXECUTION cancels the completed run: the result is
	 * discarded (no exit transition, no completed action, no failure marker)
	 * and the new stage's freshly dispatched job survives untouched.
	 */
	public function test_reseat_mid_execution_discards_result_and_keeps_new_job(): void
	{
		$post_id = $this->make_ai_desk_post();

		$completed = array();
		$listener  = function ( $listener_post_id ) use ( &$completed ) {
			$completed[] = $listener_post_id;
		};
		add_action( 'vip_workflow_agent_completed', $listener );

		// The agent "runs" and, mid-execution, a core-driven status change
		// lands (pending → draft crosses a region boundary → reseat).
		$executor = new class() extends AbilityExecutor {
			public function execute( string $ability_name, array $input = array(), string $context = '' ): AbilityResult {
				wp_update_post(
					array(
						'ID'          => (int) $input['post_id'],
						'post_status' => 'draft',
					)
				);

				$result          = new AbilityResult();
				$result->success = true;
				$result->output  = array( 'status' => 'pass' );
				return $result;
			}
		};

		( new StageAgentRunner( $executor ) )->run_stage_agent( $post_id, 'ai_desk' );

		remove_action( 'vip_workflow_agent_completed', $listener );

		// The reseat won: the post sits at the new entry stage, never at the
		// stale run's pass route — discriminating, because ai_intake HAS a
		// valid edge to 'review', so a run that finished against the reseated
		// stage would have moved the post there.
		$this->assertSame( 'ai_intake', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'The abandoned run must not route its exit transition from the reseated stage.' );
		$this->assertSame( 'draft', get_post_status( $post_id ), 'The abandoned run must not fire its exit transition.' );
		$this->assertSame( array(), $completed, 'The discarded result must not fire vip_workflow_agent_completed.' );

		// Abandon-specific observable: the loop-guard chain was restored — an
		// abandoned run never transitioned, so it does not count toward MAX_CHAIN.
		$this->assertSame( 0, (int) get_post_meta( $post_id, StageAgentRunner::CHAIN_META, true ), 'An abandoned run must not count toward the agent chain.' );

		// Exactly one pending job, owned by the new stage (cause 'core') — the
		// abandoned run neither cleared nor overwrote it.
		$jobs = get_post_meta( $post_id, StageAgentRunner::JOB_META );
		$this->assertCount( 1, $jobs );
		$this->assertSame( 'pending', $jobs[0]['status'] );
		$this->assertSame( 'ai_intake', $jobs[0]['stage_key'] );
		$this->assertSame( 'core', $jobs[0]['cause'] );
	}
}
