<?php
/**
 * Action dispatcher.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Automation;

use VIPWorkflow\Automation\Handlers\NotificationHandler;

/**
 * Dispatches actions for automation flows.
 */
class ActionDispatcher {


	/**
	 * Registered action handlers.
	 *
	 * @var array<string, ActionHandlerInterface>
	 */
	private array $handlers = array();

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->register_default_handlers();
	}

	/**
	 * Register default action handlers.
	 */
	private function register_default_handlers(): void {
		// Phase 1: Only notification handler.
		$this->register( 'notification', new NotificationHandler() );

		// Stub handlers for future phases - they log but don't execute.
		$this->register( 'state_change', new Handlers\StubHandler( 'state_change' ) );
		$this->register( 'task_create', new Handlers\StubHandler( 'task_create' ) );
		$this->register( 'ability_execute', new Handlers\StubHandler( 'ability_execute' ) );
		$this->register( 'webhook', new Handlers\StubHandler( 'webhook' ) );
	}

	/**
	 * Register an action handler.
	 *
	 * @param string                 $action_type Action type.
	 * @param ActionHandlerInterface $handler     Handler instance.
	 */
	public function register( string $action_type, ActionHandlerInterface $handler ): void {
		$this->handlers[ $action_type ] = $handler;
	}

	/**
	 * Dispatch a sequence of actions.
	 *
	 * @param  array $actions Actions to dispatch.
	 * @param  array $context Execution context.
	 * @return array Results from each action.
	 * @throws \Exception If an action fails and on_failure is 'stop'.
	 */
	public function dispatch( array $actions, array $context ): array {
		$results = array();

		foreach ( $actions as $action ) {
			$action_type = $action['type'] ?? '';

			if ( ! isset( $this->handlers[ $action_type ] ) ) {
				$results[] = array(
					'action_type' => $action_type,
					'status'      => 'skipped',
					'reason'      => 'Unknown action type',
				);
				continue;
			}

			$handler = $this->handlers[ $action_type ];

			try {
				$result    = $handler->execute( $action['config'] ?? array(), $context );
				$results[] = array(
					'action_type' => $action_type,
					'status'      => 'success',
					'result'      => $result,
				);

			} catch ( \Exception $e ) {
				$on_failure = $action['on_failure'] ?? 'continue';

				$results[] = array(
					'action_type' => $action_type,
					'status'      => 'failed',
					'error'       => $e->getMessage(),
				);

				if ( 'stop' === $on_failure ) {
					throw $e;
				}
				// 'continue' - keep going with next action.
			}
		}

		return $results;
	}

	/**
	 * Get registered handler types.
	 *
	 * @return string[]
	 */
	public function get_registered_types(): array {
		return array_keys( $this->handlers );
	}
}
