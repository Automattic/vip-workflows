<?php
/**
 * Keeps scores ahead of a fast-moving feed.
 *
 * Scoring used to happen only when someone loaded the ideation screen: the
 * decorator noticed unscored items and queued them. That works for a diary that
 * turns over daily. It does not work for a newsroom running in near real time,
 * where the feed refreshes every minute or two and an editor arriving at it sees
 * whatever has not been scored yet — which is precisely the newest items, and,
 * because unscored items sort last, precisely the ones buried.
 *
 * So discovery is polled on a schedule instead, and anything new is queued
 * shortly after it appears rather than the next time somebody looks.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not rescore. A score is cached for a day, `queue_prompts()` skips
 * anything already cached, and the warmer checks again before spending a call.
 * So the steady-state cost of a poll is a call for each genuinely new headline
 * and nothing else — a handful an hour, not a feed's worth per tick.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely\Discovery;

use VIPWorkflow\Discovery\DiscoveryProviderRegistry;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Polls discovery providers and queues whatever has not been scored.
 */
class DiscoveryPoller {

	/**
	 * Recurring hook.
	 */
	public const POLL_HOOK = 'workflow_parsely_poll_discovery';

	/**
	 * Schedule name for the poll interval.
	 */
	private const SCHEDULE = 'workflow_parsely_poll';

	/**
	 * How often the poll runs by default.
	 *
	 * Fifteen minutes, which is WordPress's own floor for a recurring schedule
	 * and the shortest interval the platform treats as ordinary. A minute was a
	 * demo setting: it is roughly what a newsroom watching a wire wants, but it
	 * is fifteen times the request volume against Parse.ly for a feed that does
	 * not move fifteen times as often.
	 */
	private const DEFAULT_INTERVAL = 15 * MINUTE_IN_SECONDS;

	/**
	 * The shortest interval the filter can ask for.
	 *
	 * A site with a real system cron and a genuinely fast feed can turn this
	 * down, but not to a number that would poll every provider continuously. One
	 * minute is already the busiest this is ever intended to be.
	 */
	private const MINIMUM_INTERVAL = MINUTE_IN_SECONDS;

	/**
	 * Register the schedule and the poll.
	 */
	public static function register(): void {
		// phpcs:ignore WordPress.WP.CronInterval.ChangeDetected -- The interval is filterable, so the sniff cannot read it; interval() clamps it at MINIMUM_INTERVAL.
		add_filter( 'cron_schedules', array( self::class, 'add_schedule' ) );
		add_action( self::POLL_HOOK, array( self::class, 'poll' ) );
		add_action( 'init', array( self::class, 'ensure_scheduled' ) );
	}

	/**
	 * How many seconds between polls.
	 *
	 * Read fresh on every cron reschedule rather than baked into the event, so
	 * changing the filter takes effect without anything having to be
	 * re-scheduled.
	 *
	 * @return int Seconds, never below MINIMUM_INTERVAL.
	 */
	public static function interval(): int {
		/**
		 * Filters how often discovery is polled for unscored items.
		 *
		 * Clamped to a minimum of one minute.
		 *
		 * @param int $interval Seconds between polls.
		 */
		$interval = (int) apply_filters( 'workflow_parsely_poll_interval', self::DEFAULT_INTERVAL );

		return max( self::MINIMUM_INTERVAL, $interval );
	}

	/**
	 * Add the poll interval.
	 *
	 * @param array $schedules Cron schedules.
	 * @return array
	 */
	public static function add_schedule( $schedules ): array {
		$schedules = is_array( $schedules ) ? $schedules : array();

		$schedules[ self::SCHEDULE ] = array(
			'interval' => self::interval(),
			'display'  => __( 'Parse.ly discovery poll', 'workflow-parsely' ),
		);

		return $schedules;
	}

	/**
	 * Make sure the poll is scheduled, and only once.
	 */
	public static function ensure_scheduled(): void {
		$settings = self::provider_settings();

		if ( ! self::parsely_is_enabled( $settings ) ) {
			self::unschedule();
			return;
		}

		if ( ! \WorkflowParsely\is_configured() ) {
			return;
		}

		if ( wp_next_scheduled( self::POLL_HOOK ) ) {
			return;
		}

		wp_schedule_event( time() + self::interval(), self::SCHEDULE, self::POLL_HOOK );
	}

	/**
	 * Stop polling.
	 *
	 * Called on deactivation so a disabled plugin does not leave a recurring
	 * event behind firing at an action nobody handles.
	 */
	public static function unschedule(): void {
		$next = wp_next_scheduled( self::POLL_HOOK );

		while ( $next ) {
			wp_unschedule_event( $next, self::POLL_HOOK );
			$next = wp_next_scheduled( self::POLL_HOOK );
		}
	}

	/**
	 * Ask every available provider what it has, and queue anything unscored.
	 */
	public static function poll(): void {
		$settings = self::provider_settings();

		if ( ! self::parsely_is_enabled( $settings ) ) {
			return;
		}

		if ( ! \WorkflowParsely\is_configured() ) {
			return;
		}

		if ( ! class_exists( DiscoveryProviderRegistry::class ) ) {
			return;
		}

		$registry = DiscoveryProviderRegistry::get_instance();

		$prompts = array();

		foreach ( $registry->get_available_by_feature( 'recommend' ) as $slug => $provider ) {
			// A provider an admin has switched off is not worth paying to score.
			if ( ! ( $settings[ $slug ]['enabled'] ?? true ) ) {
				continue;
			}

			/*
			 * Providers that only ever restate another provider's items are
			 * skipped, so a merged feed does not queue everything twice under a
			 * second name. The decorator keeps the same list for the same reason.
			 */
			if ( in_array( $slug, PromptScorer::SKIP_PROVIDERS, true ) ) {
				continue;
			}

			try {
				$result = $registry->execute( $slug, 'recommend', self::config_for( $slug ) );
			} catch ( \Throwable $e ) {
				/*
				 * One provider being down is not a reason to skip the others.
				 * Logged at most hourly per provider: a recurring job would
				 * otherwise either flood the log or, if it stayed silent, leave a
				 * permanently broken provider invisible — the poll would just
				 * quietly stop producing.
				 */
				$notice_key = 'wf_parsely_poll_err_' . md5( $slug );

				if ( false === get_transient( $notice_key ) ) {
					set_transient( $notice_key, 1, HOUR_IN_SECONDS );
					// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
					error_log( sprintf( 'Workflow Parse.ly: discovery poll failed for provider "%s": %s', $slug, $e->getMessage() ) );
				}

				continue;
			}

			if ( is_array( $result ) ) {
				$prompts = array_merge( $prompts, $result );
			}
		}

		if ( array() === $prompts ) {
			return;
		}

		PromptScorer::queue_prompts( $prompts );
	}

	/**
	 * Stored discovery-provider enablement settings.
	 *
	 * @return array<string, array>
	 */
	private static function provider_settings(): array {
		$settings = get_option( 'vip_discovery_provider_settings', array() );

		return is_array( $settings ) ? $settings : array();
	}

	/**
	 * Whether the Parse.ly integration is enabled.
	 *
	 * The unified Agents toggle writes through to Parse.ly's discovery-provider
	 * setting, so that provider is the persisted source of truth here too.
	 *
	 * @param array<string, array> $settings Discovery-provider settings.
	 * @return bool
	 */
	private static function parsely_is_enabled( array $settings ): bool {
		return (bool) ( $settings[ ParselyDiscoveryProvider::SLUG ]['enabled'] ?? true );
	}

	/**
	 * A provider's stored configuration.
	 *
	 * @param string $slug Provider slug.
	 * @return array
	 */
	private static function config_for( string $slug ): array {
		$config = get_option( 'vip_discovery_provider_' . $slug, array() );

		return is_array( $config ) ? $config : array();
	}
}
