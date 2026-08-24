<?php
/**
 * SLA monitor.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Monitoring;

use VIPWorkflow\Automation\EventBus;

/**
 * Monitors SLA compliance and emits warning/breach events.
 *
 * TODO: Implement for post-status-based model using workflow_events table
 * to track time in each status.
 */
class SLAMonitor {


	/**
	 * Event bus.
	 *
	 * @var EventBus
	 */
	private EventBus $event_bus;

	/**
	 * Constructor.
	 *
	 * @param EventBus $event_bus Event bus.
	 */
	public function __construct( EventBus $event_bus ) {
		$this->event_bus = $event_bus;
	}

	/**
	 * Check for SLA warnings and breaches.
	 *
	 * TODO: Implement for post-status model.
	 */
	public function check_breaches(): void {
		// Placeholder - will be implemented in Phase 3.
	}

	/**
	 * Get SLA status summary.
	 *
	 * @return array{on_track: int, at_risk: int, breached: int}
	 */
	public function get_status_summary(): array {
		return array(
			'on_track' => 0,
			'at_risk'  => 0,
			'breached' => 0,
		);
	}
}
