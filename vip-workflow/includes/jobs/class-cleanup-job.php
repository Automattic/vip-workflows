<?php
/**
 * Cleanup Job.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Jobs;

/**
 * Cleans up old data from the database.
 */
class CleanupJob extends Job {


	/**
	 * Get the unique job ID.
	 *
	 * @return string
	 */
	public function get_id(): string {
		return 'cleanup';
	}

	/**
	 * Get the job name.
	 *
	 * @return string
	 */
	public function get_name(): string {
		return __( 'Cleanup', 'vip-workflow' );
	}

	/**
	 * Get the job description.
	 *
	 * @return string
	 */
	public function get_description(): string {
		return __( 'Removes old ability results and workflow events to keep the database clean.', 'vip-workflow' );
	}

	/**
	 * Get the run interval.
	 *
	 * @return int Interval in seconds.
	 */
	public function get_interval(): int {
		return DAY_IN_SECONDS;
	}

	/**
	 * Get the scheduled time.
	 *
	 * @return string Run at 2am.
	 */
	public function get_scheduled_time(): ?string {
		return '02:00:00';
	}

	/**
	 * Run the cleanup.
	 *
	 * @return array Results summary.
	 */
	public function run(): array {
		global $wpdb;

		$results = array(
			'ability_results_deleted' => 0,
			'events_deleted'          => 0,
		);

		// Delete old ability results (older than 90 days).
		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->prefix}vip_ability_results WHERE created_at < %s",
				wp_date( 'Y-m-d H:i:s', strtotime( '-90 days' ) )
			)
		);
		$results['ability_results_deleted'] = $deleted ? $deleted : 0;

		// Delete old workflow events (older than 1 year).
		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->prefix}vip_workflow_events WHERE created_at < %s",
				wp_date( 'Y-m-d H:i:s', strtotime( '-1 year' ) )
			)
		);
		$results['events_deleted'] = $deleted ? $deleted : 0;

		return $results;
	}
}
