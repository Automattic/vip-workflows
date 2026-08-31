<?php
/**
 * Attaches performance history to other providers' story prompts.
 *
 * The lens already answers "how has comparable coverage done" once an editor has
 * picked a seed. This puts the same answer on the cards *before* they pick — so
 * a diary of forty upcoming events can be read as "these three reliably produce
 * strong stories for us" rather than as forty equivalent options.
 *
 * WHY IT NEVER SCORES DURING THE REQUEST
 * --------------------------------------
 * Scoring one candidate costs a search plus up to five measurement calls. A
 * Foresight diary of sixteen prompts would therefore cost around ninety requests
 * on every load of the ideation landing page, which the page waits on. Measured
 * warm, a single candidate takes ~4 seconds; sixteen would be over a minute.
 *
 * So this reads cache only. A prompt with no cached score gets `null` and the
 * card simply shows nothing, and warming happens on a scheduled event after the
 * response has gone out. The first visit to a new diary is unscored, the next
 * one is scored, and nothing ever blocks.
 *
 * Parse.ly's own trending provider is skipped: its prompts are already the
 * site's top-performing published stories, so telling an editor they performed
 * well is not a finding.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely\Discovery;

use WorkflowParsely\PerformanceLens;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Decorates discovery prompts with cached performance signals.
 */
class PromptScorer {

	/**
	 * Cron hook for warming scores after a response has been sent.
	 */
	public const WARM_HOOK = 'workflow_parsely_warm_prompt_scores';

	/**
	 * How long a prompt's score stays usable.
	 *
	 * A day: the underlying archive barely moves, and a diary event is typically
	 * looked at repeatedly over the days before it happens.
	 */
	private const SCORE_TTL = DAY_IN_SECONDS;

	/**
	 * How long a *failed* lookup is held.
	 *
	 * Short, and deliberately not SCORE_TTL. A failure summarizes to the same
	 * shape as a genuine no-precedent result, so caching one for a day tells an
	 * editor the newsroom has never covered this — a positive editorial claim —
	 * on the strength of one 502. Long enough to stop a re-queue loop, short
	 * enough to self-heal.
	 */
	private const ERROR_TTL = 15 * MINUTE_IN_SECONDS;

	/**
	 * Prompts warmed per scheduled run.
	 *
	 * Small on purpose. Warming is a background courtesy, not a batch job, and a
	 * run that fans out across a whole diary would hammer Parse.ly from cron.
	 */
	private const WARM_BATCH = 4;

	/**
	 * Where the work waiting to be warmed is kept.
	 *
	 * The queue lives in one option keyed by candidate cache key, and the cron
	 * event carries no payload at all. That is what makes the queue dedupe: an
	 * event scheduled with its candidate list as an argument only matches an
	 * existing event whose arguments serialize identically, so with a list that
	 * differs per request `wp_next_scheduled()` never matched, one event was added
	 * per page load, and each carried its whole candidate payload into the cron
	 * option.
	 */
	private const QUEUE_OPTION = 'workflow_parsely_prompt_warm_queue';

	/**
	 * Most candidates the queue will hold.
	 *
	 * A ceiling on the option's size, not a throughput limit — the queue drains
	 * four at a time and refills from whatever is still unscored on the next page
	 * load, so anything dropped here comes back. Sized well above a normal diary
	 * so it is only ever reached by a provider returning an implausible feed.
	 */
	private const QUEUE_LIMIT = 200;

	/**
	 * Seconds between a batch being queued and the run that drains it.
	 */
	private const WARM_DELAY = 30;

	/**
	 * Providers whose prompts are not worth scoring.
	 */
	/**
	 * Providers whose items are another provider's, restated.
	 *
	 * Public because the discovery poll applies the same list — a merged feed
	 * should not queue everything twice under a second name.
	 */
	public const SKIP_PROVIDERS = array( 'parsely-trending' );

	/**
	 * Register the decorator and its warmer.
	 */
	public static function register(): void {
		add_filter( 'vip_workflows_discovery_prompts', array( self::class, 'decorate' ) );
		add_action( self::WARM_HOOK, array( self::class, 'warm' ) );
	}

	/**
	 * Queue prompts for scoring after the response.
	 *
	 * Public so another plugin can ask for prompts to be scored without
	 * reimplementing the cache key or the batching.
	 *
	 * @param array[] $prompts Story prompts.
	 */
	public static function queue_prompts( array $prompts ): void {
		if ( ! \WorkflowParsely\is_configured() ) {
			return;
		}

		$candidates = array();

		foreach ( $prompts as $prompt ) {
			if ( ! is_array( $prompt ) ) {
				continue;
			}

			$candidate = self::candidate_from_prompt( $prompt );

			if ( '' === $candidate['title'] ) {
				continue;
			}

			if ( false !== get_transient( self::cache_key( $candidate ) ) ) {
				continue;
			}

			$candidates[] = $candidate;
		}

		if ( array() !== $candidates ) {
			self::schedule_warm( $candidates );
		}
	}

	/**
	 * Attach cached scores, and queue anything missing.
	 *
	 * @param array $grouped Prompts grouped by provider.
	 * @return array
	 */
	public static function decorate( array $grouped ): array {
		if ( ! \WorkflowParsely\is_configured() ) {
			return $grouped;
		}

		$unscored = array();

		foreach ( $grouped as $group_index => $group ) {
			$slug = (string) ( $group['provider']['slug'] ?? '' );

			if ( in_array( $slug, self::SKIP_PROVIDERS, true ) ) {
				continue;
			}

			foreach ( (array) ( $group['prompts'] ?? array() ) as $prompt_index => $prompt ) {
				$candidate = self::candidate_from_prompt( $prompt );

				if ( '' === $candidate['title'] ) {
					continue;
				}

				$cached = get_transient( self::cache_key( $candidate ) );

				if ( is_array( $cached ) ) {
					$grouped[ $group_index ]['prompts'][ $prompt_index ]['performance'] = $cached;
					continue;
				}

				$grouped[ $group_index ]['prompts'][ $prompt_index ]['performance'] = null;

				$unscored[] = $candidate;
			}
		}

		if ( array() !== $unscored ) {
			self::schedule_warm( $unscored );
		}

		return $grouped;
	}

	/**
	 * Score a batch of candidates from the queue and cache the results.
	 *
	 * Takes WARM_BATCH off the queue and reschedules itself while any remain, so
	 * one queued event drains the whole list rather than needing a page load per
	 * batch.
	 *
	 * The batch is removed and the queue saved *before* any scoring, so a run that
	 * dies partway through does not leave its candidates queued forever. Anything
	 * lost that way is unscored, and decorate() queues it again on the next load.
	 */
	public static function warm(): void {
		$queue = self::queue();
		$batch = array_slice( $queue, 0, self::WARM_BATCH, true );

		foreach ( array_keys( $batch ) as $cache_key ) {
			unset( $queue[ $cache_key ] );
		}

		self::save_queue( $queue );

		foreach ( $batch as $cache_key => $candidate ) {
			if ( ! is_array( $candidate ) || '' === (string) ( $candidate['title'] ?? '' ) ) {
				continue;
			}

			// Another run may have got there first.
			if ( false !== get_transient( $cache_key ) ) {
				continue;
			}

			$signal = PerformanceLens::score( $candidate );
			$failed = null !== $signal['error'];

			/*
			 * Failures are cached too — without it a candidate that always errors
			 * is re-queued on every page load forever — but only briefly, and
			 * carrying the error so the two outcomes stay distinguishable.
			 */
			set_transient(
				$cache_key,
				self::summarize( $signal ),
				$failed ? self::ERROR_TTL : self::SCORE_TTL
			);
		}

		/*
		 * Carry the rest forward.
		 *
		 * Without this, warming only advanced when someone reloaded the ideation
		 * screen: a batch was scheduled, the remainder discarded, and the next
		 * four queued only on the next request. A 24-item feed took ten reloads
		 * and roughly ten minutes to warm, and a feed that churns faster than
		 * that never finished at all — leaving the newest items permanently
		 * unscored and, because unscored items sort last, permanently buried.
		 */
		if ( array() !== $queue ) {
			self::schedule_drain();
		}
	}

	/**
	 * Reduce a full lens result to what a card needs.
	 *
	 * The card shows a multiplier and a confidence, not five articles and a
	 * query. The full evidence is a click away in ideation, and putting it here
	 * would bloat a response that carries forty of these.
	 *
	 * @param array $signal Lens result.
	 * @return array
	 */
	private static function summarize( array $signal ): array {
		return array(
			'error'      => $signal['error'],
			'multiplier' => $signal['multiplier'],
			'tier'       => $signal['tier'] ?? null,
			'tier_label' => $signal['tier_label'] ?? null,
			'score'      => $signal['score'],
			'confidence' => $signal['confidence'],
			'count'      => $signal['count'],
			'metric'     => $signal['metric'],
			'best'       => $signal['best'],
			'typical'    => $signal['typical'],
		);
	}

	/**
	 * Add candidates to the queue and make sure something is coming to drain it.
	 *
	 * Keyed by cache key, so the same subject arriving twice in one request, or
	 * again on the next page load, occupies one slot.
	 *
	 * @param array $candidates Unscored candidates.
	 */
	private static function schedule_warm( array $candidates ): void {
		$queue = self::queue();
		$added = false;

		foreach ( $candidates as $candidate ) {
			if ( count( $queue ) >= self::QUEUE_LIMIT ) {
				break;
			}

			$cache_key = self::cache_key( $candidate );

			if ( isset( $queue[ $cache_key ] ) ) {
				continue;
			}

			$queue[ $cache_key ] = $candidate;
			$added               = true;
		}

		if ( ! $added ) {
			return;
		}

		self::save_queue( $queue );
		self::schedule_drain();
	}

	/**
	 * Ensure exactly one drain event is in flight.
	 *
	 * Single event rather than a recurring schedule: the work is defined by what
	 * a particular diary happens to contain, which changes daily. Argument-free so
	 * that `wp_next_scheduled()` can recognize the event already waiting — an
	 * event scheduled with a payload only matches arguments that serialize
	 * identically, which a per-request candidate list never does.
	 */
	private static function schedule_drain(): void {
		if ( false !== wp_next_scheduled( self::WARM_HOOK ) ) {
			return;
		}

		wp_schedule_single_event( time() + self::WARM_DELAY, self::WARM_HOOK );
	}

	/**
	 * Candidates waiting to be scored, keyed by cache key.
	 *
	 * @return array<string, array>
	 */
	private static function queue(): array {
		$queue = get_option( self::QUEUE_OPTION, array() );

		return is_array( $queue ) ? $queue : array();
	}

	/**
	 * Persist the queue, removing the option entirely once it is empty.
	 *
	 * Never autoloaded: it is read only by the two paths that touch it, and it can
	 * hold a couple of hundred candidates.
	 *
	 * @param array<string, array> $queue The queue.
	 */
	private static function save_queue( array $queue ): void {
		if ( array() === $queue ) {
			delete_option( self::QUEUE_OPTION );
			return;
		}

		update_option( self::QUEUE_OPTION, $queue, false );
	}

	/**
	 * Turn a story prompt into a lens candidate.
	 *
	 * Providers normalize to the same prompt shape, so this works for a Foresight
	 * diary event, a wire item, or anything else registered later.
	 *
	 * @param array $prompt Story prompt.
	 * @return array{title: string, tags: string[]}
	 */
	private static function candidate_from_prompt( $prompt ): array {
		if ( ! is_array( $prompt ) ) {
			return array(
				'title' => '',
				'tags'  => array(),
			);
		}

		/*
		 * No section, deliberately.
		 *
		 * A prompt's section belongs to whatever taxonomy its provider uses, and
		 * Parse.ly's section filter only recognizes this site's. They are not the
		 * same vocabulary and a near-miss is silent: Currents files football
		 * under "Sports" while The Sun's section is "Sport", and searching
		 * Parse.ly for section=Sports returns nothing at all rather than an
		 * error. Every Currents prompt on the board reported "no precedent" for
		 * exactly that reason, on topics the paper covers constantly.
		 *
		 * The lens still accepts a section from callers that have a real one —
		 * PerformanceCheck passes the post's own category. A discovery provider
		 * does not, so it passes none and searches the whole archive.
		 */
		return array(
			'title' => trim( (string) ( $prompt['title'] ?? '' ) ),
			'tags'  => array_values(
				array_filter(
					(array) ( $prompt['tags'] ?? array() ),
					static fn( $tag ): bool => is_string( $tag ) && '' !== $tag
				)
			),
		);
	}

	/**
	 * Cache key for a candidate.
	 *
	 * Keyed on the candidate rather than the prompt id so the same subject
	 * arriving from two providers — a diary event and a wire item about the same
	 * announcement — resolves to one score and one lookup.
	 *
	 * @param array $candidate Candidate.
	 * @return string
	 */
	private static function cache_key( array $candidate ): string {
		return 'wf_parsely_prompt_' . md5(
			(string) wp_json_encode(
				array(
					strtolower( $candidate['title'] ),
					PerformanceLens::get_config()['metric'],
				)
			)
		);
	}
}
