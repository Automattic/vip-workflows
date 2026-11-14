<?php
/**
 * Integration coverage: a stage agent acts as the person who moved the post
 * into its stage when that person can still edit the post, and only falls back
 * to the post author otherwise. A run nobody started never borrows anyone.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\AbilityExecutor;
use VIPWorkflows\Abilities\AbilityResult;
use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StageAgentRunner;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Real-WordPress tests for whom a stage agent acts as.
 */
class AgentRunsAsStarterIntegrationTest extends TestCase
{
	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * An editor, who may edit anyone's post.
	 *
	 * @var int
	 */
	private int $editor_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->editor_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $this->editor_id );

		// Every stage in the draft region, so no crossing or publication hold
		// gets in the way of the question under test.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Agent Runs As Flow',
			'agent-runs-as-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'drafting',
						'label'       => 'Drafting',
						'status'      => 'draft',
						'transitions' => array(
							array(
								'to'    => 'ai_desk',
								'label' => 'Send to agent',
							),
						),
					),
					array(
						'key'         => 'ai_desk',
						'label'       => 'AI Desk',
						'status'      => 'draft',
						'agent'       => array(
							'ability_id' => 'test/desk-agent',
							'routing'    => array( 'pass' => 'review' ),
						),
						'transitions' => array(
							array(
								'to'    => 'review',
								'label' => 'Review',
							),
							array(
								'to'    => 'drafting',
								'label' => 'Back',
							),
						),
					),
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'status'      => 'draft',
						'transitions' => array(
							array(
								'to'    => 'ai_desk',
								'label' => 'Back to the agent',
							),
						),
					),
				),
			),
			get_current_user_id()
		);
	}

	public function tear_down(): void
	{
		wp_clear_scheduled_hook( StageAgentRunner::RUN_HOOK );
		parent::tear_down();
	}

	/**
	 * A draft in Drafting, authored by a user with the given role.
	 *
	 * @param  string $author_role Role of the post's author.
	 * @return array{0:int,1:int} Post ID and author ID.
	 */
	private function make_post( string $author_role ): array
	{
		$author_id = (int) self::factory()->user->create( array( 'role' => $author_role ) );
		$post_id   = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $author_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'drafting' );

		return array( $post_id, $author_id );
	}

	/**
	 * An executor that records who it ran as and returns a pass verdict.
	 *
	 * @return AbilityExecutor
	 */
	private function recording_executor(): AbilityExecutor
	{
		return new class() extends AbilityExecutor {
			/**
			 * The current user while execute() ran, or null if it never did.
			 *
			 * @var int|null
			 */
			public ?int $ran_as = null;

			public function execute( string $ability_name, array $input = array(), string $context = '', string $source = 'rest' ): AbilityResult {
				$this->ran_as = get_current_user_id();

				$result          = new AbilityResult();
				$result->success = true;
				$result->output  = array( 'status' => 'pass' );
				return $result;
			}
		};
	}

	/**
	 * Run the queued agent the way cron does: with nobody logged in.
	 *
	 * @param AbilityExecutor $executor Executor to run with.
	 * @param int             $post_id  Post ID.
	 */
	private function run_as_cron( AbilityExecutor $executor, int $post_id ): void
	{
		wp_set_current_user( 0 );
		( new StageAgentRunner( $executor ) )->run_stage_agent( $post_id, 'ai_desk' );
	}

	/**
	 * An editor moves a subscriber's post into an AI stage: the run acts as the
	 * editor, executes, and routes on its verdict instead of stopping for want
	 * of a capable author.
	 */
	public function test_an_editors_move_runs_the_agent_as_the_editor(): void
	{
		list( $post_id ) = $this->make_post( 'subscriber' );

		$moved = Plugin::get_instance()->get_status_manager()->transition( $post_id, 'ai_desk' );
		$this->assertTrue( $moved, 'The editor may move the post into the AI stage.' );

		$job = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$this->assertSame( $this->editor_id, (int) $job['started_by'], 'The move records the editor as the run\'s starter.' );

		$executor = $this->recording_executor();
		$this->run_as_cron( $executor, $post_id );

		$this->assertSame( $this->editor_id, $executor->ran_as, 'The agent acts as the editor who moved the post in.' );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'The pass verdict routes the post on.' );
		$this->assertSame( 0, get_current_user_id(), 'The cron context is restored afterwards.' );
	}

	/**
	 * A starter who loses the right to edit the post before the run fires is not
	 * borrowed: the run falls back to an author who can edit posts.
	 */
	public function test_a_starter_who_lost_the_right_falls_back_to_the_author(): void
	{
		list( $post_id, $author_id ) = $this->make_post( 'author' );

		$this->assertTrue( Plugin::get_instance()->get_status_manager()->transition( $post_id, 'ai_desk' ) );

		// Demoted between the move and the run.
		( new \WP_User( $this->editor_id ) )->set_role( 'subscriber' );

		$executor = $this->recording_executor();
		$this->run_as_cron( $executor, $post_id );

		$this->assertSame( $author_id, $executor->ran_as, 'The run acts as the author, not the demoted starter.' );
	}

	/**
	 * A run nobody started, on a post whose author cannot edit posts, still
	 * refuses in place rather than borrowing anyone.
	 */
	public function test_a_run_nobody_started_still_refuses_for_an_incapable_author(): void
	{
		list( $post_id ) = $this->make_post( 'subscriber' );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		update_post_meta(
			$post_id,
			StageAgentRunner::JOB_META,
			array(
				'stage_key'  => 'ai_desk',
				'ability_id' => 'test/desk-agent',
				'status'     => 'pending',
				'queued_at'  => current_time( 'mysql' ),
				'cause'      => 'core',
				'from_stage' => 'drafting',
				'started_by' => 0,
			)
		);

		$executor = $this->recording_executor();
		$this->run_as_cron( $executor, $post_id );

		$this->assertNull( $executor->ran_as, 'The agent must not execute.' );
		$job = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$this->assertSame( 'failed', $job['status'] );
		$this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'It stops in place.' );
	}

	/**
	 * The failure above is fixed in place: an editor presses Run again, the post
	 * never leaves its stage, and the fresh run acts as the editor and routes on
	 * its verdict.
	 */
	public function test_run_again_by_an_editor_fixes_a_run_nobody_could_act_for(): void
	{
		list( $post_id ) = $this->make_post( 'subscriber' );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		update_post_meta(
			$post_id,
			StageAgentRunner::JOB_META,
			array(
				'stage_key'  => 'ai_desk',
				'ability_id' => 'test/desk-agent',
				'status'     => 'pending',
				'queued_at'  => current_time( 'mysql' ),
				'cause'      => 'core',
				'from_stage' => 'drafting',
				'started_by' => 0,
			)
		);
		$this->run_as_cron( $this->recording_executor(), $post_id );
		$this->assertSame( 'failed', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] );

		// The editor presses Run again, through the route the editor calls.
		wp_set_current_user( $this->editor_id );
		$request  = new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-rerun" );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( (bool) $response->get_data()['agent_pending'], 'The status payload shows the new run pending.' );
		$this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'The post never left its stage.' );
		$job = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$this->assertSame( $this->editor_id, $job['started_by'] );
		$this->assertSame( 'drafting', $job['from_stage'] );

		$executor = $this->recording_executor();
		$this->run_as_cron( $executor, $post_id );

		$this->assertSame( $this->editor_id, $executor->ran_as, 'The re-run acts as the editor who pressed it.' );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'And routes on its verdict.' );
	}

	/**
	 * Run again is refused when there is no failed run to retry.
	 */
	public function test_run_again_is_refused_without_a_failed_run(): void
	{
		list( $post_id ) = $this->make_post( 'editor' );

		$request  = new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-rerun" );
		$response = rest_do_request( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'no_agent_rerun', $response->get_data()['code'] );
	}

	/**
	 * Failed run in a stage, Go back, then a Run again request that read the
	 * failed marker before Go back deleted it. The stale write must not land:
	 * no marker is created and no run is queued, so re-entering the stage later
	 * cannot pick up a stale identity.
	 */
	public function test_a_stale_run_again_after_go_back_writes_and_queues_nothing(): void
	{
		list( $post_id ) = $this->make_post( 'subscriber' );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		$failed = array(
			'stage_key'  => 'ai_desk',
			'ability_id' => 'test/desk-agent',
			'status'     => 'failed',
			'error'      => 'x',
			'failed_at'  => current_time( 'mysql' ),
			'from_stage' => 'drafting',
		);
		update_post_meta( $post_id, StageAgentRunner::JOB_META, $failed );
		$stale = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );

		// Go back wins the race.
		$back = rest_do_request( new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-revert" ) );
		$this->assertSame( 200, $back->get_status() );
		$this->assertSame( '', get_post_meta( $post_id, StageAgentRunner::JOB_META, true ) );
		wp_clear_scheduled_hook( StageAgentRunner::RUN_HOOK );

		// The stale Run again now tries its conditional write.
		$dispatch = new \ReflectionMethod( StageAgentRunner::class, 'dispatch' );
		$written  = $dispatch->invoke( new StageAgentRunner(), $post_id, 'ai_desk', 'test/desk-agent', 'drafting', 'rerun', $this->editor_id, $stale );

		$this->assertFalse( $written );
		$this->assertSame( '', get_post_meta( $post_id, StageAgentRunner::JOB_META, true ), 'No marker was created.' );
		$this->assertFalse( wp_next_scheduled( StageAgentRunner::RUN_HOOK, array( $post_id, 'ai_desk' ) ), 'No run was queued.' );
	}

	/**
	 * Two Run again requests that read the same failed marker: one wins, the
	 * other is refused, against the real database.
	 */
	public function test_two_racing_run_agains_only_one_wins(): void
	{
		list( $post_id ) = $this->make_post( 'subscriber' );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		update_post_meta(
			$post_id,
			StageAgentRunner::JOB_META,
			array(
				'stage_key'  => 'ai_desk',
				'ability_id' => 'test/desk-agent',
				'status'     => 'failed',
				'error'      => 'x',
				'failed_at'  => current_time( 'mysql' ),
				'from_stage' => 'drafting',
			)
		);
		$read = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );

		$dispatch = new \ReflectionMethod( StageAgentRunner::class, 'dispatch' );
		$first    = $dispatch->invoke( new StageAgentRunner(), $post_id, 'ai_desk', 'test/desk-agent', 'drafting', 'rerun', $this->editor_id, $read );
		$second   = $dispatch->invoke( new StageAgentRunner(), $post_id, 'ai_desk', 'test/desk-agent', 'drafting', 'rerun', 1, $read );

		$this->assertTrue( $first );
		$this->assertFalse( $second );
		$job = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$this->assertSame( 'pending', $job['status'] );
		$this->assertSame( $this->editor_id, $job['started_by'], 'The first writer stands.' );
	}

	/**
	 * An abandoned entry's identity does not survive a re-entry. An editor moves
	 * a contributor's post into the AI stage, then confirms a move out before
	 * the run fires. The contributor moves it back in: the fresh marker, and
	 * the run, belong to the contributor.
	 */
	public function test_re_entry_replaces_an_abandoned_entrys_identity(): void
	{
		list( $post_id, $author_id ) = $this->make_post( 'contributor' );
		$status_manager              = Plugin::get_instance()->get_status_manager();

		$this->assertTrue( $status_manager->transition( $post_id, 'ai_desk' ) );
		$this->assertTrue(
			$status_manager->transition( $post_id, 'review', array( 'acknowledge_warnings' => true ) ),
			'The editor confirms a move out while the run is pending.'
		);
		$this->assertSame( $this->editor_id, (int) get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['started_by'], 'The abandoned marker is still there.' );

		wp_set_current_user( $author_id );
		$this->assertTrue( $status_manager->transition( $post_id, 'ai_desk' ), 'The contributor moves it back in.' );

		$job = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$this->assertSame( 'pending', $job['status'] );
		$this->assertSame( $author_id, (int) $job['started_by'], 'The re-entry records the contributor, not the editor.' );
		$this->assertSame( 'review', $job['from_stage'], 'Go back now leads where this entry came from.' );

		$executor = $this->recording_executor();
		$this->run_as_cron( $executor, $post_id );

		$this->assertSame( $author_id, $executor->ran_as, 'The run acts as the contributor.' );
	}

	/**
	 * Run again keeps the sequence's role rules. Only editors may move posts
	 * into the AI stage; after an editor's run fails, a contributor who can
	 * edit the post is still refused, and is not offered the button.
	 */
	public function test_run_again_keeps_the_entry_moves_role_rules(): void
	{
		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Editors Only Agent Flow',
			'editors-only-agent-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'drafting',
						'label'       => 'Drafting',
						'status'      => 'draft',
						'transitions' => array(
							array(
								'to'            => 'ai_desk',
								'label'         => 'Send to agent',
								'allowed_roles' => array( 'editor' ),
							),
						),
					),
					array(
						'key'         => 'ai_desk',
						'label'       => 'AI Desk',
						'status'      => 'draft',
						'agent'       => array(
							'ability_id' => 'test/desk-agent',
							'routing'    => array( 'pass' => 'review' ),
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
						'status'      => 'draft',
						'transitions' => array(),
					),
				),
			),
			$this->editor_id
		);

		list( $post_id, $author_id ) = $this->make_post( 'contributor' );
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		update_post_meta(
			$post_id,
			StageAgentRunner::JOB_META,
			array(
				'stage_key'  => 'ai_desk',
				'ability_id' => 'test/desk-agent',
				'status'     => 'failed',
				'error'      => 'x',
				'failed_at'  => current_time( 'mysql' ),
				'from_stage' => 'drafting',
			)
		);

		wp_set_current_user( $author_id );
		$status = rest_do_request( new \WP_REST_Request( 'GET', "/vip-workflows/v1/workflow/post/{$post_id}/status" ) );
		$this->assertSame( 200, $status->get_status() );
		$this->assertFalse( $status->get_data()['agent_job']['can_rerun'], 'The contributor is not offered Run again.' );

		$response = rest_do_request( new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-rerun" ) );
		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'forbidden_transition', $response->get_data()['code'] );
		$this->assertSame( 'failed', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'], 'Nothing was dispatched.' );

		// A reseat records the stage the post sat in, with no authored edge from
		// it into the AI stage: any authored move in decides, so the role rule
		// still holds rather than shutting everyone out.
		$sequence = ( new SequenceRepository() )->find( $sequence_id );
		$this->assertTrue( StageAgentRunner::user_can_rerun( $sequence, 'ai_desk', 'review', $this->editor_id ), 'After a reseat, an editor may run it again.' );
		$this->assertFalse( StageAgentRunner::user_can_rerun( $sequence, 'ai_desk', 'review', $author_id ), 'After a reseat, a contributor still may not.' );
		$admin_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->assertTrue( StageAgentRunner::user_can_rerun( $sequence, 'ai_desk', 'drafting', $admin_id ), 'The bypass list skips the role rule.' );

		wp_set_current_user( $this->editor_id );
		$status = rest_do_request( new \WP_REST_Request( 'GET', "/vip-workflows/v1/workflow/post/{$post_id}/status" ) );
		$this->assertTrue( $status->get_data()['agent_job']['can_rerun'], 'An editor is offered Run again.' );
		$this->assertSame( 200, rest_do_request( new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-rerun" ) )->get_status() );
	}

	/**
	 * Run again wins the race against a Go back that read the same failed
	 * marker: Go back is refused and the post stays at the AI stage with the
	 * new run pending, rather than landing at the origin with a run queued for
	 * the stage it left.
	 */
	public function test_go_back_loses_to_a_run_again_that_took_the_marker_first(): void
	{
		list( $post_id ) = $this->make_post( 'subscriber' );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		update_post_meta(
			$post_id,
			StageAgentRunner::JOB_META,
			array(
				'stage_key'  => 'ai_desk',
				'ability_id' => 'test/desk-agent',
				'status'     => 'failed',
				'error'      => 'x',
				'failed_at'  => current_time( 'mysql' ),
				'from_stage' => 'drafting',
			)
		);
		$stale = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );

		$this->assertSame( 200, rest_do_request( new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-rerun" ) )->get_status() );

		// Go back's own compare-and-delete, with the marker it read before.
		$this->assertFalse( StageAgentRunner::take_job_marker( $post_id, $stale ) );

		// And through the route: nothing failed is left to go back from.
		$back = rest_do_request( new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-revert" ) );
		$this->assertSame( 409, $back->get_status() );
		$this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'The post stays at the AI stage.' );
		$this->assertSame( 'pending', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'], 'With the new run pending.' );
	}

	/**
	 * A late cron can hold two run events for one post and stage. The one that
	 * fires after the first has already failed in place must not execute the
	 * agent again.
	 */
	public function test_a_second_event_does_not_run_against_a_resolved_marker(): void
	{
		list( $post_id ) = $this->make_post( 'editor' );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		$failed = array(
			'stage_key'  => 'ai_desk',
			'ability_id' => 'test/desk-agent',
			'status'     => 'failed',
			'error'      => 'x',
			'failed_at'  => current_time( 'mysql' ),
			'from_stage' => 'drafting',
		);
		update_post_meta( $post_id, StageAgentRunner::JOB_META, $failed );

		$executor = $this->recording_executor();
		$this->run_as_cron( $executor, $post_id );

		$this->assertNull( $executor->ran_as, 'The agent does not run again.' );
		$this->assertSame( $failed, get_post_meta( $post_id, StageAgentRunner::JOB_META, true ), 'The failed state is left as it was.' );
		$this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * Go back holds the marker as `reverting` while it moves the post, so a
	 * late run event firing in that window doesn't run the agent either.
	 */
	public function test_a_run_event_during_go_back_does_not_execute(): void
	{
		list( $post_id ) = $this->make_post( 'editor' );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'ai_desk' );
		update_post_meta(
			$post_id,
			StageAgentRunner::JOB_META,
			array(
				'stage_key'  => 'ai_desk',
				'ability_id' => 'test/desk-agent',
				'status'     => 'reverting',
				'from_stage' => 'drafting',
			)
		);

		$executor = $this->recording_executor();
		$this->run_as_cron( $executor, $post_id );

		$this->assertNull( $executor->ran_as );
	}
}
