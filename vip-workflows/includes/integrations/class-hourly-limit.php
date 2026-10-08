<?php
/**
 * A ceiling on how often one subject may do one action in an hour.
 *
 * @package VIPWorkflows
 */

declare( strict_types=1 );

namespace VIPWorkflows\Integrations;

use VIPWorkflows\Telemetry\Tracker;

/**
 * Counts the uses of an action that spends an external service, per subject
 * and per hour, and refuses the use that would go over the ceiling.
 *
 * Each action names its default ceiling where it calls `spend()`. A site
 * changes it with the filter `vip_workflows_{action}_hourly_limit`, and
 * switches it off with 0. The hour starts at the subject's first use and the
 * count is dropped when it ends, so a subject that is refused knows when to
 * try again, and the count never carries over from one hour to the next.
 *
 * The subject is the current user unless the caller names one, such as the
 * project a request is for. A subject of 0 is nobody, and is never counted.
 */
final class HourlyLimit {

	/**
	 * Count one use of an action for a subject, or refuse it at the ceiling.
	 *
	 * @param string   $action  Action key, such as `image_generation`.
	 * @param int      $default Ceiling per subject and per hour. 0 or less is no ceiling.
	 * @param string   $reached Sentence for the error when the ceiling is reached.
	 * @param int|null $subject Subject to count against; null for the current user.
	 * @return true|\WP_Error True when the use is allowed, WP_Error with status 429 at the ceiling.
	 */
	public static function spend( string $action, int $default, string $reached, ?int $subject = null ) {
		$subject = $subject ?? get_current_user_id();
		if ( $subject <= 0 ) {
			return true;
		}

		/**
		 * Filters the ceiling on an action per subject and per hour.
		 *
		 * The dynamic part of the hook name, `$action`, is the action key, such
		 * as `discovery_search`, `image_generation`, `project_image_generation`
		 * or `ai`.
		 *
		 * @param int $limit   Uses per hour. 0 or less switches the ceiling off.
		 * @param int $subject User ID, or the project ID for a per-project action.
		 */
		$limit = (int) apply_filters( "vip_workflows_{$action}_hourly_limit", $default, $subject );
		if ( $limit <= 0 ) {
			return true;
		}

		$key   = "vip_workflows_{$action}_rate_{$subject}";
		$now   = time();
		$entry = get_transient( $key );

		if ( ! is_array( $entry ) || (int) ( $entry['until'] ?? 0 ) <= $now ) {
			$entry = array(
				'count' => 0,
				'until' => $now + HOUR_IN_SECONDS,
			);
		}

		$remaining = max( 1, (int) $entry['until'] - $now );

		if ( (int) $entry['count'] >= $limit ) {
			/**
			 * Fires when a subject is refused because its hourly ceiling is reached.
			 *
			 * @param string $action  Action key.
			 * @param int    $subject User ID, or the project ID for a per-project action.
			 * @param int    $limit   The ceiling.
			 */
			do_action( 'vip_workflows_hourly_limit_reached', $action, $subject, $limit );

			Tracker::record(
				'hourly_limit_reached',
				array(
					'action'    => $action,
					'limit'     => $limit,
					'initiator' => 'user',
				)
			);

			$minutes = (int) ceil( $remaining / MINUTE_IN_SECONDS );

			return new \WP_Error(
				"vip_workflows_{$action}_rate_limited",
				$reached . ' ' . sprintf(
					/* translators: %d: number of minutes. */
					_n( 'Try again in %d minute.', 'Try again in %d minutes.', $minutes, 'vip-workflows' ),
					$minutes
				),
				array(
					'status'      => 429,
					'retry_after' => $remaining,
				)
			);
		}

		++$entry['count'];
		set_transient( $key, $entry, $remaining );

		return true;
	}
}
