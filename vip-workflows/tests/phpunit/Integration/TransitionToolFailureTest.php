<?php
/**
 * A required transition tool that could not run has not passed.
 *
 * Three ways it fails to run — returns a WP_Error, throws, or is switched off —
 * and none produces an opinion about the post. All three used to be soft
 * warnings, which the same request could waive with `acknowledge_warnings`: to
 * remove a gate you only had to break its tool. A caller may accept a check
 * that ran and complained, not one that never ran.
 *
 * The remedy for a broken tool is deliberately the loud one: take it out of the
 * sequence's `required_tools`.
 *
 * Integration, not unit: the gate resolves tools out of Core's ability registry,
 * which only accepts registrations during `wp_abilities_api_init`.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Abilities\AbilitySettings;
use VIPWorkflow\Workflow\StatusManager;

/**
 * @covers \VIPWorkflow\Workflow\StatusManager::run_transition_tools
 */
class TransitionToolFailureTest extends TestCase {

	/**
	 * Returns a WP_Error carrying a reason.
	 */
	private const FAILING_TOOL = 'vip-workflow/transition-failure-fixture';

	/**
	 * Returns a WP_Error carrying no reason at all.
	 */
	private const SILENT_FAILURE_TOOL = 'vip-workflow/transition-silent-failure-fixture';

	/**
	 * Runs, and finds nothing to report.
	 */
	private const PASSING_TOOL = 'vip-workflow/transition-passing-fixture';

	/**
	 * Runs, and reports one non-blocking issue.
	 */
	private const WARNING_TOOL = 'vip-workflow/transition-warning-fixture';

	/**
	 * Throws out of its execute callback.
	 */
	private const THROWING_TOOL = 'vip-workflow/transition-throwing-fixture';

	/**
	 * Never registered, so resolving it throws before any callback runs.
	 */
	private const UNREGISTERED_TOOL = 'vip-workflow/transition-unregistered-fixture';

	/**
	 * The reason the failing fixture hands back.
	 */
	private const FAILURE_REASON = 'The fixture check could not reach its service.';

	/**
	 * The message the throwing fixture throws with.
	 */
	private const THROWN_MESSAGE = 'The fixture check exploded mid-run.';

	/**
	 * What the warning fixture has to say about the post.
	 */
	private const WARNING_MESSAGE = 'The fixture would prefer a shorter headline.';

	/**
	 * Post the gate is run against.
	 *
	 * @var int
	 */
	private int $post_id;

	/**
	 * Register the fixture tools and create the post the gate runs against.
	 *
	 * Abilities can only be registered while `wp_abilities_api_init` is running,
	 * so the hook is fired again with every other listener detached —
	 * WP_UnitTestCase restores `$wp_filter` afterwards. Registration is global and
	 * outlives the test, hence the guards.
	 */
	public function set_up(): void {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$this->post_id = (int) self::factory()->post->create();

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
					self::FAILING_TOOL        => static function (): \WP_Error {
						return new \WP_Error( 'fixture_unreachable', self::FAILURE_REASON );
					},
					self::SILENT_FAILURE_TOOL => static function (): \WP_Error {
						return new \WP_Error( 'fixture_unreachable', '' );
					},
					self::PASSING_TOOL        => static function (): array {
						return array( 'issues' => array() );
					},
					self::WARNING_TOOL        => static function (): array {
						return array(
							'issues' => array(
								array(
									'check_key' => 'headline_length',
									'message'   => self::WARNING_MESSAGE,
									'severity'  => 'warning',
								),
							),
						);
					},
					self::THROWING_TOOL       => static function (): array {
						throw new \RuntimeException( self::THROWN_MESSAGE );
					},
				);

				foreach ( $fixtures as $name => $callback ) {
					if ( in_array( $name, $registered, true ) ) {
						continue;
					}

					wp_register_ability( $name, self::ability_args( $callback ) );
				}
			}
		);
		do_action( 'wp_abilities_api_init' );
	}

	public function tear_down(): void {
		delete_option( 'vip_workflow_ability_settings' );
		AbilitySettings::get_instance()->clear_cache();

		parent::tear_down();
	}

	/**
	 * Registration args for a transition-gate fixture tool.
	 *
	 * @param  callable $execute_callback What the tool does when run.
	 * @return array
	 */
	private static function ability_args( callable $execute_callback ): array {
		return array(
			'label'               => 'Transition Gate Fixture',
			'description'         => 'A required tool used to exercise the transition gate.',
			'category'            => 'research',
			'execute_callback'    => $execute_callback,
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
		);
	}

	/**
	 * Drive the private gate for a set of required tools.
	 *
	 * Named for what it answers rather than `run()`, which would collide with
	 * PHPUnit's own TestCase::run().
	 *
	 * @param  array $required_tools       Tool IDs the transition requires.
	 * @param  bool  $acknowledge_warnings Whether the caller already accepted the warnings.
	 * @return true|array|\WP_Error Whatever the gate answered.
	 */
	private function check_transition( array $required_tools, bool $acknowledge_warnings = false ) {
		$method = new \ReflectionMethod( StatusManager::class, 'run_transition_tools' );

		return $method->invoke(
			new StatusManager(),
			$this->post_id,
			array(
				'to'             => 'review',
				'required_tools' => $required_tools,
			),
			$acknowledge_warnings
		);
	}

	/**
	 * The only hard failure in a blocked gate answer.
	 *
	 * @param  mixed $answer What the gate returned.
	 * @return array
	 */
	private function only_hard_failure( $answer ): array {
		$this->assertInstanceOf(
			\WP_Error::class,
			$answer,
			'A tool that could not run must block the transition, not hold it for acknowledgement.'
		);
		$this->assertSame( 'tool_check_failed', $answer->get_error_code() );

		$data = $answer->get_error_data();
		$this->assertSame( 422, $data['status'] );
		$this->assertCount( 1, $data['hard_failures'] );

		return $data['hard_failures'][0];
	}

	/**
	 * The only soft warning in a held gate answer.
	 *
	 * @param  mixed $answer What the gate returned.
	 * @return array
	 */
	private function only_warning( $answer ): array {
		$this->assertIsArray( $answer, 'An issue the tool raised must hold the transition for acknowledgement.' );
		$this->assertTrue( $answer['warnings_pending'] );
		$this->assertCount( 1, $answer['soft_warnings'] );

		return $answer['soft_warnings'][0];
	}

	/**
	 * The regression: a returned WP_Error is a failure, and failures block.
	 *
	 * Before the fix this was a soft warning, which the same request could waive.
	 */
	public function test_tool_returning_wp_error_blocks_the_transition(): void {
		$failure = $this->only_hard_failure( $this->check_transition( array( self::FAILING_TOOL ) ) );

		$this->assertSame(
			array(
				'tool'     => self::FAILING_TOOL,
				'key'      => 'execution_error',
				'message'  => self::FAILURE_REASON,
				'severity' => 'hard',
			),
			$failure
		);
	}

	/**
	 * A failure that named no reason still says something a human can read.
	 *
	 * Nothing obliges a tool to explain itself, and a blank line next to a blocked
	 * transition is worse than no line at all — the editor would be stopped with
	 * no description of what stopped them.
	 */
	public function test_failure_without_a_reason_still_carries_a_message(): void {
		$failure = $this->only_hard_failure( $this->check_transition( array( self::SILENT_FAILURE_TOOL ) ) );

		$this->assertSame( self::SILENT_FAILURE_TOOL, $failure['tool'] );
		$this->assertSame( 'execution_error', $failure['key'] );
		$this->assertSame( 'hard', $failure['severity'] );
		$this->assertNotSame( '', trim( $failure['message'] ) );
	}

	/**
	 * A tool that ran and found nothing still passes.
	 *
	 * This is what proves the assertions above come from the failure and not
	 * from merely having a required tool on the transition.
	 */
	public function test_tool_that_runs_clean_lets_the_transition_through(): void {
		$this->assertTrue( $this->check_transition( array( self::PASSING_TOOL ) ) );
	}

	/**
	 * The throwing channel blocks too, and keeps the tool's own words.
	 *
	 * The abilities layer turns a thrown callback into a WP_Error naming the
	 * ability and quoting the exception, and that reason travels through
	 * unaltered — a blocked editor needs to know which tool stopped them.
	 */
	public function test_tool_that_throws_blocks_the_transition(): void {
		$failure = $this->only_hard_failure( $this->check_transition( array( self::THROWING_TOOL ) ) );

		$this->assertSame( self::THROWING_TOOL, $failure['tool'] );
		$this->assertSame( 'execution_error', $failure['key'] );
		$this->assertSame( 'hard', $failure['severity'] );
		$this->assertStringContainsString( self::THROWN_MESSAGE, $failure['message'] );
	}

	/**
	 * A required tool that no longer exists blocks, rather than being ignored.
	 *
	 * A sequence naming a tool whose plugin was deactivated is exactly the case
	 * that must not read as "checks passed".
	 */
	public function test_unregistered_required_tool_blocks_the_transition(): void {
		// Core notices the miss on the way past; the point is what the gate does
		// with it, not that the registry stayed quiet.
		$this->setExpectedIncorrectUsage( 'WP_Abilities_Registry::get_registered' );

		$failure = $this->only_hard_failure( $this->check_transition( array( self::UNREGISTERED_TOOL ) ) );

		$this->assertSame( self::UNREGISTERED_TOOL, $failure['tool'] );
		$this->assertSame( 'execution_error', $failure['key'] );
		$this->assertSame( 'hard', $failure['severity'] );
		$this->assertStringContainsString( 'not found', $failure['message'] );
	}

	/**
	 * Acknowledgement cannot waive a check that never ran.
	 *
	 * This is the defect in one line. `acknowledge_warnings` is how an editor says
	 * "I have read what the check said and I am proceeding anyway". A check that
	 * could not run said nothing, so there is nothing to have read — and letting
	 * the flag through here is what made every required tool optional the moment
	 * it broke.
	 */
	public function test_acknowledging_cannot_waive_a_check_that_never_ran(): void {
		$failure = $this->only_hard_failure( $this->check_transition( array( self::FAILING_TOOL ), true ) );

		$this->assertSame( 'hard', $failure['severity'] );
	}

	/**
	 * A disabled required tool blocks rather than vanishing.
	 *
	 * Disabling an ability is a site-wide switch; `required_tools` is a per-
	 * transition contract. Letting the switch silently empty the contract meant a
	 * gate could be removed from every sequence at once, with nothing recorded
	 * anywhere. The sequence is where a required tool is added, so the sequence
	 * is where it has to be removed.
	 */
	public function test_disabled_required_tool_blocks_rather_than_vanishing(): void {
		AbilitySettings::get_instance()->update( self::FAILING_TOOL, array( 'enabled' => false ) );

		$failure = $this->only_hard_failure( $this->check_transition( array( self::FAILING_TOOL ) ) );

		$this->assertSame( self::FAILING_TOOL, $failure['tool'] );
		$this->assertSame( 'tool_disabled', $failure['key'] );
		$this->assertSame( 'hard', $failure['severity'] );
	}

	/**
	 * A disabled tool blocks even when it would otherwise have passed.
	 *
	 * Proves the block comes from the tool being off rather than from the
	 * fixture's own failure — the two are separate reasons and only one of them
	 * is being asserted above.
	 */
	public function test_disabled_passing_tool_also_blocks(): void {
		AbilitySettings::get_instance()->update( self::PASSING_TOOL, array( 'enabled' => false ) );

		$failure = $this->only_hard_failure( $this->check_transition( array( self::PASSING_TOOL ) ) );

		$this->assertSame( 'tool_disabled', $failure['key'] );
	}

	/**
	 * An issue raised by a tool that ran still holds for acknowledgement.
	 *
	 * The counterweight to everything above: the fix must not turn every warning
	 * into a block. A tool that reached its service and formed an opinion is
	 * exactly the case `acknowledge_warnings` exists for.
	 */
	public function test_issue_from_a_tool_that_ran_holds_for_acknowledgement(): void {
		$warning = $this->only_warning( $this->check_transition( array( self::WARNING_TOOL ) ) );

		$this->assertSame( self::WARNING_TOOL, $warning['tool'] );
		$this->assertSame( 'headline_length', $warning['key'] );
		$this->assertSame( 'soft', $warning['severity'] );
		$this->assertSame( self::WARNING_MESSAGE, $warning['message'] );
	}

	/**
	 * And acknowledging that issue proceeds, as it always did.
	 */
	public function test_acknowledged_issue_from_a_tool_that_ran_proceeds(): void {
		$this->assertTrue( $this->check_transition( array( self::WARNING_TOOL ), true ) );
	}
}
