<?php
/**
 * SLA Check Job.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Jobs;

use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\PostTypeManager;

/**
 * Checks for SLA violations and sends notifications.
 */
class SlaCheckJob extends Job {


	/**
	 * Get the unique job ID.
	 *
	 * @return string
	 */
	public function get_id(): string {
		return 'sla_check';
	}

	/**
	 * Get the job name.
	 *
	 * @return string
	 */
	public function get_name(): string {
		return __( 'SLA Check', 'vip-workflow' );
	}

	/**
	 * Get the job description.
	 *
	 * @return string
	 */
	public function get_description(): string {
		return __( 'Monitors posts for SLA breaches and warnings based on time in stage.', 'vip-workflow' );
	}

	/**
	 * Get the run interval.
	 *
	 * @return int Interval in seconds.
	 */
	public function get_interval(): int {
		return 15 * MINUTE_IN_SECONDS; // Every 15 minutes.
	}

	/**
	 * Run the SLA check.
	 *
	 * @return array Results summary.
	 */
	public function run(): array {
		$repository = new SequenceRepository();
		$sequences = $repository->get_active();

		$results = array(
			'checked'   => 0,
			'warnings'  => 0,
			'breaches'  => 0,
			'notified'  => 0,
		);

		foreach ( $sequences as $sequence ) {
			$statuses = $sequence->get_statuses();

			foreach ( $statuses as $status ) {
				$target_duration = $status['target_duration'] ?? 0;
				if ( $target_duration <= 0 ) {
					continue;
				}

				if ( ! empty( $status['is_terminal'] ) ) {
					continue;
				}

				$posts = get_posts(
					\VIPWorkflow\Workflow\StageQuery::in_stage(
						$sequence,
						$status['key'],
						array(
							'posts_per_page' => 500,
							'fields'         => 'ids',
						)
					)
				);

				if ( empty( $posts ) ) {
					continue;
				}

				$times = $this->get_times_in_status_batch( $posts, $status['key'] );
				$warning_threshold = $target_duration * 0.8;

				foreach ( $posts as $post_id ) {
					$results['checked']++;

					$time_in_status = $times[ $post_id ] ?? $this->get_time_in_status_fallback( $post_id );

					if ( $time_in_status >= $target_duration ) {
						$results['breaches']++;
						$this->handle_breach( $post_id, $sequence, $status, $time_in_status );
						$results['notified']++;
					} elseif ( $time_in_status >= $warning_threshold ) {
						$results['warnings']++;
						$this->handle_warning( $post_id, $sequence, $status, $time_in_status, $target_duration );
					}
				}
			}
		}

		return $results;
	}

	/**
	 * Get time-in-status for a batch of post IDs in one query.
	 *
	 * @param  int[]  $post_ids   Array of post IDs.
	 * @param  string $status_key Status key.
	 * @return array<int, int> Map of post_id => seconds in status.
	 */
	private function get_times_in_status_batch( array $post_ids, string $status_key ): array {
		global $wpdb;

		if ( empty( $post_ids ) ) {
			return array();
		}

		$placeholders = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
		$params       = array_merge( array( $wpdb->prefix . 'vip_workflow_events' ), $post_ids );
		$params[]     = $status_key;

		// Get the most recent transition TO this status for each post.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is a list of %d built via array_fill above.
				"SELECT post_id, MAX(created_at) AS entered_at FROM %i WHERE post_id IN ({$placeholders})
                AND event_type = 'status_transition'
                AND JSON_EXTRACT(event_data, '$.to_status') = %s
                GROUP BY post_id",
				...$params
			)
		);

		$now    = time();
		$result = array();

		foreach ( $rows as $row ) {
			$result[ (int) $row->post_id ] = $now - strtotime( $row->entered_at );
		}

		// Fill in missing posts with fallback to post_modified.
		foreach ( $post_ids as $post_id ) {
			if ( ! isset( $result[ $post_id ] ) ) {
				$result[ $post_id ] = $this->get_time_in_status_fallback( $post_id );
			}
		}

		return $result;
	}

	/**
	 * Fallback: compute time-in-status from post_modified.
	 *
	 * @param  int $post_id Post ID.
	 * @return int Seconds in status.
	 */
	private function get_time_in_status_fallback( int $post_id ): int {
		$post       = get_post( $post_id );
		$entered_at = $post ? $post->post_modified : current_time( 'mysql' );

		return time() - strtotime( $entered_at );
	}

	/**
	 * Handle an SLA breach.
	 *
	 * @param int    $post_id      Post ID.
	 * @param object $sequence    Sequence.
	 * @param array  $status       Status config.
	 * @param int    $time_elapsed Seconds in status.
	 */
	private function handle_breach( int $post_id, $sequence, array $status, int $time_elapsed ): void {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return;
		}

		// Check if we already notified for this breach (avoid spam).
		$last_breach_notification = get_post_meta( $post_id, '_vip_sla_breach_notified', true );
		if ( $last_breach_notification && ( time() - (int) $last_breach_notification ) < 3600 ) {
			return; // Already notified within the last hour.
		}

		// Update notification timestamp.
		update_post_meta( $post_id, '_vip_sla_breach_notified', time() );

		// Log the event.
		$this->log_sla_event( $post_id, 'breach', $status['key'], $time_elapsed );

		// Emit event for notification handlers.
		do_action(
			'vip_workflow_sla_breached',
			array(
				'post_id'       => $post_id,
				'post_title'    => $post->post_title,
				'sequence_id'  => $sequence->id,
				'sequence'     => $sequence->name,
				'status_key'    => $status['key'],
				'status_label'  => $status['label'],
				'time_elapsed'  => $time_elapsed,
				'target'        => $status['target_duration'],
				'author_id'     => $post->post_author,
				'edit_url'      => get_edit_post_link( $post_id, 'raw' ),
			)
		);
	}

	/**
	 * Handle an SLA warning.
	 *
	 * @param int    $post_id         Post ID.
	 * @param object $sequence       Sequence.
	 * @param array  $status          Status config.
	 * @param int    $time_elapsed    Seconds in status.
	 * @param int    $target_duration Target duration.
	 */
	private function handle_warning( int $post_id, $sequence, array $status, int $time_elapsed, int $target_duration ): void {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return;
		}

		// Check if we already warned for this (avoid spam).
		$last_warning = get_post_meta( $post_id, '_vip_sla_warning_notified', true );
		if ( $last_warning && ( time() - (int) $last_warning ) < 3600 ) {
			return;
		}

		update_post_meta( $post_id, '_vip_sla_warning_notified', time() );

		$this->log_sla_event( $post_id, 'warning', $status['key'], $time_elapsed );

		do_action(
			'vip_workflow_sla_warning',
			array(
				'post_id'        => $post_id,
				'post_title'     => $post->post_title,
				'sequence_id'   => $sequence->id,
				'sequence'      => $sequence->name,
				'status_key'     => $status['key'],
				'status_label'   => $status['label'],
				'time_elapsed'   => $time_elapsed,
				'target'         => $target_duration,
				'time_remaining' => $target_duration - $time_elapsed,
				'author_id'      => $post->post_author,
				'edit_url'       => get_edit_post_link( $post_id, 'raw' ),
			)
		);
	}

	/**
	 * Log an SLA event.
	 *
	 * @param int    $post_id      Post ID.
	 * @param string $event_type   'warning' or 'breach'.
	 * @param string $status_key   Status key.
	 * @param int    $time_elapsed Seconds elapsed.
	 */
	private function log_sla_event( int $post_id, string $event_type, string $status_key, int $time_elapsed ): void {
		global $wpdb;

		$wpdb->insert(
			$wpdb->prefix . 'vip_workflow_events',
			array(
				'post_id'    => $post_id,
				'event_type' => 'sla_' . $event_type,
				'event_data' => wp_json_encode(
					array(
						'status_key'   => $status_key,
						'time_elapsed' => $time_elapsed,
					)
				),
				'created_by' => 0, // System.
				'created_at' => current_time( 'mysql' ),
			),
			array( '%d', '%s', '%s', '%d', '%s' )
		);
	}

	/**
	 * Format duration for display.
	 *
	 * @param  int $seconds Duration in seconds.
	 * @return string Human-readable duration.
	 */
	public static function format_duration( int $seconds ): string {
		if ( $seconds < 3600 ) {
			$minutes = ceil( $seconds / 60 );
			/* translators: %d: number of minutes. */
			return sprintf( _n( '%d minute', '%d minutes', $minutes, 'vip-workflow' ), $minutes );
		}

		if ( $seconds < 86400 ) {
			$hours = round( $seconds / 3600, 1 );
			/* translators: %s: number of hours. */
			return sprintf( _n( '%s hour', '%s hours', (int) $hours, 'vip-workflow' ), $hours );
		}

		$days = round( $seconds / 86400, 1 );
		/* translators: %s: number of days. */
		return sprintf( _n( '%s day', '%s days', (int) $days, 'vip-workflow' ), $days );
	}
}
