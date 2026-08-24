<?php
/**
 * Stub action handler for unimplemented actions.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Automation\Handlers;

use VIPWorkflow\Automation\ActionHandlerInterface;

/**
 * Stub handler that logs actions but doesn't execute them.
 * Used for action types that will be implemented in future phases.
 */
class StubHandler implements ActionHandlerInterface {


	/**
	 * Action type name.
	 *
	 * @var string
	 */
	private string $action_type;

	/**
	 * Constructor.
	 *
	 * @param string $action_type Action type name.
	 */
	public function __construct( string $action_type ) {
		$this->action_type = $action_type;
	}

	/**
	 * Execute the action (stub - just logs).
	 *
	 * @param  array $config  Action configuration.
	 * @param  array $context Execution context.
	 * @return array Result data.
	 */
	public function execute( array $config, array $context ): array {
		// Log that this action type is not yet implemented.
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- intentional debug logging, gated on WP_DEBUG.
			error_log(
				sprintf(
					'VIP Workflow: Action type "%s" is not yet implemented. Config: %s',
					$this->action_type,
					wp_json_encode( $config )
				)
			);
		}

		return array(
			'executed'    => false,
			'action_type' => $this->action_type,
			'reason'      => 'Not implemented in current phase',
			'config'      => $config,
		);
	}
}
