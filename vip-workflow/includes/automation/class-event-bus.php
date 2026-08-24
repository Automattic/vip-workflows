<?php
/**
 * Event bus.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Automation;

use VIPWorkflow\Database\Schema;
use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Plugin;

/**
 * Central event bus for workflow automation.
 */
class EventBus {


	/**
	 * Event registry.
	 *
	 * @var EventRegistry
	 */
	private EventRegistry $registry;

	/**
	 * Action dispatcher.
	 *
	 * @var ActionDispatcher
	 */
	private ActionDispatcher $dispatcher;

	/**
	 * Constructor.
	 *
	 * @param EventRegistry $registry Event registry.
	 */
	public function __construct( EventRegistry $registry ) {
		$this->registry   = $registry;
		$this->dispatcher = new ActionDispatcher();
	}

	/**
	 * Emit an event.
	 *
	 * @param string $event_type Event type.
	 * @param array  $event_data Event data.
	 * @param array  $context    Execution context.
	 */
	public function emit( string $event_type, array $event_data, array $context = array() ): void {
		// Store the event.
		$event_id = $this->store_event( $event_type, $event_data, $context );

		// Find matching automation flows.
		$flows = $this->find_matching_flows( $event_type, $event_data, $context );

		// Execute flows.
		foreach ( $flows as $flow ) {
			$this->schedule_flow_execution( $flow, $event_id, $event_data, $context );
		}

		/**
		 * Fires when an event is emitted.
		 *
		 * @param string $event_type Event type.
		 * @param array  $event_data Event data.
		 * @param int    $event_id   Stored event ID.
		 */
		do_action( 'vip_workflow_event_emitted', $event_type, $event_data, $event_id );
	}

	/**
	 * Store an event in the database.
	 *
	 * @param  string $event_type Event type.
	 * @param  array  $event_data Event data.
	 * @param  array  $context    Context.
	 * @return int Event ID.
	 */
	private function store_event( string $event_type, array $event_data, array $context ): int {
		global $wpdb;

		$wpdb->insert(
			Schema::get_table_name( 'workflow_events' ),
			array(
				'post_id'    => $context['post_id'] ?? null,
				'event_type' => $event_type,
				'event_data' => wp_json_encode( $event_data ),
				'actor_id'   => $context['actor_id'] ?? get_current_user_id(),
				'actor_type' => $context['actor_type'] ?? 'user',
				'created_at' => current_time( 'mysql' ),
			)
		);

		return $wpdb->insert_id;
	}

	/**
	 * Find automation flows matching an event.
	 *
	 * @param  string $event_type Event type.
	 * @param  array  $event_data Event data.
	 * @param  array  $context    Context.
	 * @return array Matching flows.
	 */
	private function find_matching_flows( string $event_type, array $event_data, array $context ): array {
		$flows = array();

		// Check sequence-level automations if we have a post context.
		if ( ! empty( $context['post_id'] ) ) {
			$status_manager = Plugin::get_instance()->get_status_manager();
			$sequence      = $status_manager ? $status_manager->get_sequence_for_post( $context['post_id'] ) : null;

			if ( $sequence ) {
				$automations = $sequence->get_automations();

				foreach ( $automations as $automation ) {
					if ( $this->event_matches( $event_type, $automation['trigger_events'] ?? array( $automation['trigger'] ?? '' ) ) ) {
						$flows[] = array(
							'source'     => 'sequence',
							'id'         => $automation['id'] ?? uniqid(),
							'name'       => $automation['name'] ?? 'Unnamed automation',
							'conditions' => $automation['conditions'] ?? array(),
							'actions'    => $automation['actions'] ?? array( $automation ),
						);
					}
				}
			}
		}

		// Check global automations from the database.
		$global_flows = $this->get_global_flows( $event_type );
		$flows        = array_merge( $flows, $global_flows );

		return $flows;
	}

	/**
	 * Check if an event type matches a list of trigger events.
	 *
	 * @param  string $event_type     Event type.
	 * @param  array  $trigger_events List of trigger event patterns.
	 * @return bool
	 */
	private function event_matches( string $event_type, array $trigger_events ): bool {
		foreach ( $trigger_events as $trigger ) {
			if ( empty( $trigger ) ) {
				continue;
			}

			// Exact match.
			if ( $trigger === $event_type ) {
				return true;
			}

			// Pattern match (e.g., status.*.entered).
			if ( str_contains( $trigger, '*' ) ) {
				$pattern = str_replace( '.*.', '\.[^.]+\.', preg_quote( $trigger, '/' ) );
				$pattern = str_replace( '\*', '[^.]+', $pattern );
				if ( preg_match( '/^' . $pattern . '$/', $event_type ) ) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Get global automation flows for an event type.
	 *
	 * @param  string $event_type Event type.
	 * @return array
	 */
	private function get_global_flows( string $event_type ): array {
		$cache_key    = 'vip_automation_active_global_flows';
		$active_flows = wp_cache_get( $cache_key, 'vip_automation' );

		if ( false === $active_flows ) {
			global $wpdb;

			$table = Schema::get_table_name( 'automation_flows' );

			$active_flows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM %i WHERE status = 'active' AND sequence_id IS NULL ORDER BY priority ASC",
					$table
				)
			);

			wp_cache_set( $cache_key, $active_flows, 'vip_automation' );
		}

		$flows = array();

		foreach ( $active_flows as $row ) {
			$trigger_events = json_decode( $row->trigger_events, true ) ?? array();

			if ( $this->event_matches( $event_type, $trigger_events ) ) {
				$flows[] = array(
					'source'     => 'global',
					'id'         => (int) $row->id,
					'name'       => $row->name,
					'conditions' => json_decode( $row->conditions, true ) ?? array(),
					'actions'    => json_decode( $row->actions, true ) ?? array(),
				);
			}
		}

		return $flows;
	}

	/**
	 * Schedule flow execution via ActionScheduler.
	 *
	 * @param array $flow       Flow configuration.
	 * @param int   $event_id   Event ID.
	 * @param array $event_data Event data.
	 * @param array $context    Context.
	 */
	private function schedule_flow_execution( array $flow, int $event_id, array $event_data, array $context ): void {
		// For Phase 1, execute immediately if conditions pass.
		$evaluator = new ConditionEvaluator( $event_data, $context );

		if ( ! $evaluator->evaluate( $flow['conditions'] ) ) {
			return; // Conditions not met.
		}

		// Execute actions.
		$execution_id = $this->start_execution( $flow, $event_id, $context );

		try {
			$results = $this->dispatcher->dispatch(
				$flow['actions'],
				array_merge(
					$context,
					array(
						'event_data' => $event_data,
					)
				)
			);

			$this->complete_execution( $execution_id, 'completed', $results );

		} catch ( \Exception $e ) {
			$this->complete_execution(
				$execution_id,
				'failed',
				array(
					'error' => $e->getMessage(),
				)
			);
		}
	}

	/**
	 * Handle flow execution (called by ActionScheduler for async).
	 *
	 * @param int   $flow_id    Flow ID.
	 * @param int   $event_id   Event ID.
	 * @param array $event_data Event data.
	 * @param array $context    Context.
	 * @throws \Exception If flow execution fails.
	 */
	public function handle_flow_execution( int $flow_id, int $event_id, array $event_data, array $context ): void {
		global $wpdb;

		$table = Schema::get_table_name( 'automation_flows' );
		$row   = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$table} WHERE id = %d", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$flow_id
			)
		);

		if ( ! $row ) {
			return;
		}

		$flow = array(
			'source'     => 'global',
			'id'         => (int) $row->id,
			'name'       => $row->name,
			'conditions' => json_decode( $row->conditions, true ) ?? array(),
			'actions'    => json_decode( $row->actions, true ) ?? array(),
		);

		$evaluator = new ConditionEvaluator( $event_data, $context );

		if ( ! $evaluator->evaluate( $flow['conditions'] ) ) {
			return;
		}

		$execution_id = $this->start_execution( $flow, $event_id, $context );

		try {
			$results = $this->dispatcher->dispatch(
				$flow['actions'],
				array_merge(
					$context,
					array(
						'event_data' => $event_data,
					)
				)
			);

			$this->complete_execution( $execution_id, 'completed', $results );

		} catch ( \Exception $e ) {
			$this->complete_execution(
				$execution_id,
				'failed',
				array(
					'error' => $e->getMessage(),
				)
			);

			throw $e; // Re-throw for ActionScheduler retry logic.
		}
	}

	/**
	 * Start execution tracking.
	 *
	 * @param  array $flow     Flow configuration.
	 * @param  int   $event_id Event ID.
	 * @param  array $context  Context.
	 * @return int Execution ID.
	 */
	private function start_execution( array $flow, int $event_id, array $context ): int {
		global $wpdb;

		$wpdb->insert(
			Schema::get_table_name( 'automation_executions' ),
			array(
				'flow_id'          => is_int( $flow['id'] ) ? $flow['id'] : null,
				'post_id'          => $context['post_id'] ?? null,
				'trigger_event_id' => $event_id,
				'status'           => 'running',
				'started_at'       => current_time( 'mysql' ),
				'execution_data'   => wp_json_encode(
					array(
						'flow_source' => $flow['source'],
						'flow_name'   => $flow['name'],
					)
				),
			)
		);

		return $wpdb->insert_id;
	}

	/**
	 * Complete execution tracking.
	 *
	 * @param int    $execution_id Execution ID.
	 * @param string $status       Final status.
	 * @param array  $data         Result data.
	 */
	private function complete_execution( int $execution_id, string $status, array $data ): void {
		global $wpdb;

		$update_data = array(
			'status'       => $status,
			'completed_at' => current_time( 'mysql' ),
		);

		if ( 'failed' === $status ) {
			$update_data['error_data'] = wp_json_encode( $data );
		} else {
			$update_data['execution_data'] = wp_json_encode( $data );
		}

		$wpdb->update(
			Schema::get_table_name( 'automation_executions' ),
			$update_data,
			array( 'id' => $execution_id )
		);
	}

	/**
	 * Get the event registry.
	 *
	 * @return EventRegistry
	 */
	public function get_registry(): EventRegistry {
		return $this->registry;
	}
}
