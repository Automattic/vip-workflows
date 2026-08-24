<?php
/**
 * Action handler interface.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Automation;

/**
 * Interface for action handlers.
 */
interface ActionHandlerInterface {


	/**
	 * Execute the action.
	 *
	 * @param  array $config  Action configuration.
	 * @param  array $context Execution context.
	 * @return array Result data.
	 * @throws \Exception If action fails.
	 */
	public function execute( array $config, array $context ): array;
}
