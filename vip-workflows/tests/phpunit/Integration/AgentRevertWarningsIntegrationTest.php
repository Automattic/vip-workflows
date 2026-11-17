<?php
/**
 * Integration coverage: Go back from a failed AI stage, held for soft warnings.
 *
 * A failed AI stage usually has an authored edge back to its origin, and Go
 * back runs that edge's required tools. When one of them reports a soft
 * warning, the agent-revert route answers the way the transition route does:
 * 200 with `warnings_pending` and the warnings, nothing moved, and the failed
 * state put back. Asking again with `acknowledge_warnings` completes the move.
 *
 * Integration, not unit: the gate resolves tools out of Core's ability registry,
 * which only accepts registrations during `wp_abilities_api_init`.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StageAgentRunner;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Real-WordPress tests for agent-revert's warnings answer.
 */
class AgentRevertWarningsIntegrationTest extends TestCase
{
	/**
	 * Runs, and reports one non-blocking issue.
	 */
	private const WARNING_TOOL = 'vip-workflows/revert-warning-fixture';

	/**
	 * Returns a WP_Error, so the gate blocks.
	 */
	private const FAILING_TOOL = 'vip-workflows/revert-failure-fixture';

	/**
	 * What the warning fixture has to say about the post.
	 */
	private const WARNING_MESSAGE = 'Readability is low';

	/**
	 * An editor: not on the default tool-check bypass list.
	 *
	 * @var int
	 */
	private int $editor_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->editor_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $this->editor_id );

		$registered = array_map(
			static function ( $ability ): string {
				return $ability->get_name();
			},
			wp_get_abilities()
		);

		remove_all_actions( 'wp_abilities_api_init' );
		add_action(
			'wp_abilities_api_init',
			static function () use ( $registered ): void {
				$fixtures = array(
					self::WARNING_TOOL => static function (): array {
						return array(
							'issues' => array(
								array(
									'check_key' => 'readability',
									'message'   => self::WARNING_MESSAGE,
									'severity'  => 'warning',
								),
							),
						);
					},
					self::FAILING_TOOL => static function (): \WP_Error {
						return new \WP_Error( 'fixture_unreachable', 'The fixture check could not reach its service.' );
					},
				);

				foreach ( $fixtures as $name => $callback ) {
					if ( in_array( $name, $registered, true ) ) {
						continue;
					}

					wp_register_ability(
						$name,
						array(
							'label'               => 'Revert Gate Fixture',
							'description'         => 'A required tool on the edge back from a failed AI stage.',
							'category'            => 'research',
							'execute_callback'    => $callback,
							'permission_callback' => static function (): bool {
								return true;
							},
							'input_schema'        => array(
								'type'       => 'object',
								'properties' => array(
									'post_id' => array( 'type' => 'integer' ),
								),
								'required'   => array( 'post_id' ),
							),
						)
					);
				}
			}
		);
		do_action( 'wp_abilities_api_init' );
	}

	public function tear_down(): void
	{
		wp_clear_scheduled_hook( StageAgentRunner::RUN_HOOK );
		parent::tear_down();
	}

	/**
	 * A post whose agent failed in place at ai_desk, entered from drafting,
	 * in a sequence whose edge back runs the given tools.
	 *
	 * @param  array $required_tools Tools on the ai_desk -> drafting edge.
	 * @return int Post ID.
	 */
	private function make_failed_post( array $required_tools, string $origin_region = 'draft', string $agent_region = 'draft' ): int
	{
		$back = array(
			'to'    => 'drafting',
			'label' => 'Back',
		);
		if ( ! empty( $required_tools ) ) {
			$back['required_tools'] = $required_tools;
		}

		// Every stage in the draft region, so no crossing gets in the way.
		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Agent Revert Warnings Flow',
			'agent-revert-warnings-flow-' . wp_generate_password( 6, false ),
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'drafting',
						'label'       => 'Drafting',
						'status'      => $origin_region,
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
						'status'      => $agent_region,
						'agent'       => array(
							'ability_id' => 'test/desk-agent',
							'routing'    => array(
								'pass' => 'review',
								'fail' => 'drafting',
							),
						),
						'transitions' => array(
							array(
								'to'    => 'review',
								'label' => 'Review',
							),
							$back,
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
			get_current_user_id()
		);

		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => $agent_region,
				'post_author' => $this->editor_id,
			)
		);
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

		return $post_id;
	}

	/**
	 * POST agent-revert, optionally acknowledging warnings.
	 *
	 * @param  int  $post_id              Post ID.
	 * @param  bool $acknowledge_warnings Whether to send the acknowledgement.
	 * @return \WP_REST_Response
	 */
	private function go_back( int $post_id, bool $acknowledge_warnings = false ): \WP_REST_Response
	{
		$request = new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-revert" );
		if ( $acknowledge_warnings ) {
			$request->set_param( 'acknowledge_warnings', true );
		}

		return rest_do_request( $request );
	}

	/**
	 * The post's logged events of one type, decoded.
	 *
	 * @param  int    $post_id    Post ID.
	 * @param  string $event_type Event type.
	 * @return array<int, array>
	 */
	private function events( int $post_id, string $event_type ): array
	{
		global $wpdb;
		$table = \VIPWorkflows\Database\Schema::get_table_name( 'workflows_events' );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_col( $wpdb->prepare( "SELECT event_data FROM {$table} WHERE post_id = %d AND event_type = %s ORDER BY id ASC", $post_id, $event_type ) );

		return array_map(
			static function ( $row ): array {
				return (array) json_decode( (string) $row, true );
			},
			$rows
		);
	}

	/**
	 * A held Go back answers with the warnings and moves nothing; the failed
	 * state is back, so Run again and Go back are both still on offer.
	 */
	public function test_a_held_go_back_returns_the_warnings_and_moves_nothing(): void
	{
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );

		$response = $this->go_back( $post_id );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertTrue( $data['warnings_pending'] ?? false );
		$this->assertContains( self::WARNING_MESSAGE, array_column( $data['soft_warnings'], 'message' ) );
		$this->assertArrayNotHasKey( 'current', $data, 'A held Go back is not a status payload.' );

		$this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$marker = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$this->assertSame( 'failed', $marker['status'] ?? null, 'The failed marker is put back, not left reverting.' );
		$this->assertSame( array(), $this->events( $post_id, 'status_transition' ) );
	}

	/**
	 * Asking again with the acknowledgement completes the move and logs the
	 * warnings the person accepted.
	 */
	public function test_an_acknowledged_go_back_moves_the_post(): void
	{
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		$this->go_back( $post_id );

		$response = $this->go_back( $post_id, true );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertArrayNotHasKey( 'warnings_pending', $data );
		$this->assertSame( 'drafting', $data['current']['key'] ?? null );

		$this->assertSame( 'drafting', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( '', get_post_meta( $post_id, StageAgentRunner::JOB_META, true ), 'The marker is cleared.' );

		$this->assertCount( 1, $this->events( $post_id, 'tool_warnings' ) );
		$moves = $this->events( $post_id, 'status_transition' );
		$this->assertCount( 1, $moves );
		$this->assertTrue( $moves[0]['agent_revert'] ?? false );
	}

	/**
	 * An edge back with no required tools moves on the first request, as before.
	 */
	public function test_a_go_back_with_no_tools_moves_on_the_first_request(): void
	{
		$post_id = $this->make_failed_post( array() );

		$response = $this->go_back( $post_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'drafting', $response->get_data()['current']['key'] ?? null );
		$this->assertSame( 'drafting', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * A tool that fails outright still blocks, and the acknowledgement cannot
	 * waive it.
	 */
	public function test_a_hard_tool_failure_still_blocks(): void
	{
		$post_id = $this->make_failed_post( array( self::FAILING_TOOL ) );
		update_post_meta( $post_id, StageAgentRunner::CHAIN_META, 4 );

		foreach ( array( false, true ) as $acknowledge ) {
			$response = $this->go_back( $post_id, $acknowledge );

			$this->assertSame( 422, $response->get_status() );
			$this->assertSame( 'tool_check_failed', $response->get_data()['code'] ?? null );

			// The per-tool detail the editor's "Transition blocked" dialog
			// lists, in the same shape a blocked transition carries.
			$hard_failures = $response->get_data()['data']['hard_failures'] ?? null;
			$this->assertIsArray( $hard_failures );
			$this->assertCount( 1, $hard_failures );
			$this->assertSame( self::FAILING_TOOL, $hard_failures[0]['tool'] ?? null );
			$this->assertSame( 'hard', $hard_failures[0]['severity'] ?? null );
			$this->assertNotEmpty( $hard_failures[0]['message'] ?? '' );
			$this->assertIsArray( $response->get_data()['data']['soft_warnings'] ?? null );

			$this->assertSame( 4, (int) get_post_meta( $post_id, StageAgentRunner::CHAIN_META, true ) );
			$this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
			$this->assertSame( 'failed', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] ?? null );
		}
	}

	/**
	 * The acknowledgement doesn't make a Go back possible where there is no
	 * failed AI stage to go back from.
	 */
	public function test_an_acknowledged_go_back_without_a_failed_stage_is_refused(): void
	{
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		delete_post_meta( $post_id, StageAgentRunner::JOB_META );

		$response = $this->go_back( $post_id, true );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'no_agent_revert', $response->get_data()['code'] ?? null );
	}

	/** Extra REST options cannot impersonate an agent or inject input/comment. */
	public function test_rest_extra_options_are_ignored(): void {
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		$request = new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-revert" );
		foreach ( array( 'agent_actor' => 1, 'agent_actor_user' => 1, 'telemetry_user' => 1, 'input_data' => array( 'x' => 'y' ), 'comment' => 'smuggled' ) as $key => $value ) {
			$request->set_param( $key, $value );
		}
		$response = rest_do_request( $request );
		$this->assertTrue( $response->get_data()['warnings_pending'] ?? false );
		$this->assertSame( 'failed', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] );
		$request->set_param( 'acknowledge_warnings', true );
		$this->assertSame( 200, rest_do_request( $request )->get_status() );
		$events = $this->events( $post_id, 'status_transition' );
		$this->assertCount( 1, $events );
		// A Go back carries no comment at all, so the trail records null.
		$this->assertArrayHasKey( 'comment', $events[0] );
		$this->assertNull( $events[0]['comment'] );
	}

	/** A Run again between the hold and confirmation wins; Go back loses. */
	public function test_confirmation_loses_to_run_again(): void {
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		$this->assertTrue( $this->go_back( $post_id )->get_data()['warnings_pending'] );
		$rerun = rest_do_request( new \WP_REST_Request( 'POST', "/vip-workflows/v1/workflow/post/{$post_id}/agent-rerun" ) );
		$this->assertSame( 200, $rerun->get_status() );
		$this->assertSame( 409, $this->go_back( $post_id, true )->get_status() );
		$this->assertSame( 'ai_desk', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'pending', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] );
		$this->assertSame( array(), $this->events( $post_id, 'status_transition' ) );
	}

	/** Two confirmations cannot both commit the move. */
	public function test_confirmation_loses_to_another_go_back(): void {
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		$this->assertTrue( $this->go_back( $post_id )->get_data()['warnings_pending'] );
		$this->assertSame( 200, $this->go_back( $post_id, true )->get_status() );
		$this->assertSame( 409, $this->go_back( $post_id, true )->get_status() );
		$this->assertCount( 1, $this->events( $post_id, 'status_transition' ) );
		$this->assertSame( '', get_post_meta( $post_id, StageAgentRunner::JOB_META, true ) );
	}

	/** A dead revert is recovered before its retry is checked. */
	public function test_expired_reverting_marker_is_recovered_and_can_be_confirmed(): void {
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		$marker = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$marker['status'] = 'reverting';
		$marker['reverting_at'] = time() - StageAgentRunner::REVERTING_TTL - 1;
		update_post_meta( $post_id, StageAgentRunner::JOB_META, $marker );
		$this->assertTrue( $this->go_back( $post_id )->get_data()['warnings_pending'] );
		$this->assertSame( 'failed', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] );
		$this->assertSame( 200, $this->go_back( $post_id, true )->get_status() );
		$this->assertSame( 'drafting', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/** Disabled and throwing tools remain hard failures on both requests. */
	public function test_disabled_and_throwing_tools_cannot_be_acknowledged(): void {
		foreach ( array( 'disabled', 'throwing' ) as $mode ) {
			$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
			if ( 'disabled' === $mode ) {
				\VIPWorkflows\Abilities\AbilitySettings::get_instance()->update( self::WARNING_TOOL, array( 'enabled' => false ) );
			} else {
				add_filter( 'wp_pre_execute_ability', static function () { throw new \RuntimeException( 'Fixture exploded' ); } );
			}
			foreach ( array( false, true ) as $ack ) {
				$response = $this->go_back( $post_id, $ack );
				$this->assertSame( 422, $response->get_status() );
				$this->assertSame( 'tool_check_failed', $response->get_data()['code'] );
				$this->assertSame( 'failed', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] );
			}
			\VIPWorkflows\Abilities\AbilitySettings::get_instance()->update( self::WARNING_TOOL, array( 'enabled' => true ) );
			remove_all_filters( 'wp_pre_execute_ability' );
		}
	}

	/** Permission failures do not consume a failed marker. */
	public function test_permissions_are_not_waived_by_acknowledgement(): void {
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertSame( 403, $this->go_back( $post_id, true )->get_status() );
		$this->assertSame( 'failed', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] );
		wp_set_current_user( $this->editor_id );
		$this->assertSame( 403, $this->go_back( 999999999, true )->get_status(), 'REST permission callback rejects a missing post before the manager.' );
		$result = \VIPWorkflows\Plugin::get_instance()->get_status_manager()->transition( 999999999, 'drafting', array( 'acknowledge_warnings' => true ) );
		$this->assertSame( 'invalid_post', $result->get_error_code() );
	}

	/** Administrators bypass tool gates on the first request and record it. */
	public function test_admin_bypasses_and_records_tool_gate(): void {
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$telemetry = new class() {
			public array $events = array();
			public function record_event( $name, $properties ): bool {
				$this->events[] = array( $name, $properties );
				return true;
			}
		};
		\VIPWorkflows\Telemetry\Tracker::set_telemetry( $telemetry );
		try {
			$response = $this->go_back( $post_id );
			$this->assertSame( 'drafting', $response->get_data()['current']['key'] ?? null );
			$gates = array_filter( $telemetry->events, static fn( $event ) => 'transition_gate_finished' === $event[0] && 'tools' === ( $event[1]['gate'] ?? '' ) );
			$this->assertCount( 1, $gates );
			$this->assertSame( 'bypassed', array_values( $gates )[0][1]['result'] );
		} finally {
			\VIPWorkflows\Telemetry\Tracker::set_telemetry( null );
		}
	}


	/** A confirmed revert keeps the ordinary core region machinery. */
	public function test_warning_confirmation_crosses_publish_regions(): void {
		foreach ( array( array( 'draft', 'publish' ), array( 'publish', 'draft' ) ) as $regions ) {
			list( $origin, $agent ) = $regions;
			$post_id = $this->make_failed_post( array( self::WARNING_TOOL ), $origin, $agent );
			$this->assertTrue( $this->go_back( $post_id )->get_data()['warnings_pending'] ?? false );
			$this->assertSame( $agent, get_post_status( $post_id ) );
			$response = $this->go_back( $post_id, true );
			$this->assertSame( 200, $response->get_status() );
			$this->assertSame( $origin, $response->get_data()['current']['wp_status'] ?? null );
			$this->assertSame( $origin, get_post_status( $post_id ) );
			$this->assertSame( 'drafting', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		}
	}

	/** A held move should not consume the agent-loop guard on Cancel. */
	public function test_a_held_go_back_preserves_the_chain_guard(): void {
		$post_id = $this->make_failed_post( array( self::WARNING_TOOL ) );
		update_post_meta( $post_id, StageAgentRunner::CHAIN_META, 4 );
		$result = \VIPWorkflows\Plugin::get_instance()->get_status_manager()->revert_failed_agent_stage( $post_id );
		$this->assertTrue( $result['warnings_pending'] ?? false );
		$this->assertSame( 4, (int) get_post_meta( $post_id, StageAgentRunner::CHAIN_META, true ) );
		$this->assertSame( 200, $this->go_back( $post_id, true )->get_status() );
		$this->assertSame( '', get_post_meta( $post_id, StageAgentRunner::CHAIN_META, true ) );
	}

	/** Restoration also survives exceptions and preserves a newer writer's count. */
	public function test_chain_restoration_on_thrown_or_superseded_moves(): void {
		foreach ( array( false, true ) as $throws ) {
			foreach ( array( false, true ) as $newer_count ) {
				$post_id = $this->make_failed_post( array() );
				update_post_meta( $post_id, StageAgentRunner::CHAIN_META, 4 );
				$manager = $this->getMockBuilder( StatusManager::class )->onlyMethods( array( 'transition' ) )->getMock();
				$manager->expects( $this->once() )->method( 'transition' )->willReturnCallback(
					function () use ( $post_id, $throws, $newer_count ) {
						$this->assertSame( '', get_post_meta( $post_id, StageAgentRunner::CHAIN_META, true ) );
						if ( $newer_count ) {
							update_post_meta( $post_id, StageAgentRunner::CHAIN_META, 9 );
						}
						if ( $throws ) {
							throw new \RuntimeException( 'Transition fixture threw' );
						}
						return new \WP_Error( 'fixture_refused', 'Transition refused' );
					}
				);
				try {
					$result = $manager->revert_failed_agent_stage( $post_id );
					$this->assertFalse( $throws, 'The exception must propagate.' );
					$this->assertSame( 'fixture_refused', $result->get_error_code() );
				} catch ( \RuntimeException $error ) {
					$this->assertTrue( $throws );
					$this->assertSame( 'Transition fixture threw', $error->getMessage() );
				}
				$this->assertSame( $newer_count ? 9 : 4, (int) get_post_meta( $post_id, StageAgentRunner::CHAIN_META, true ) );
				$this->assertSame( 'failed', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] );
			}
		}
	}

}
