<?php
/**
 * Scores a story candidate against how comparable past coverage actually did.
 *
 * WHAT IT DOES, IN FOUR STEPS
 * ---------------------------
 * 1. Pull topics and keywords out of the candidate.                 build_query()
 * 2. Find the best-performing recent archive matches.               measure_matches()
 * 3. Work out what an ordinary story does.                          reference_set()
 * 4. Report step 2 as a multiple of step 3.                         score()
 *
 * That is the whole idea. The length below is three corrections, each of which
 * exists because the simple version returned a confidently wrong answer against
 * live data: the measure has to be normalized (or old articles look like flops),
 * the lookback has to stop at Parse.ly's retention (or unmeasurable articles
 * enter the sample as failures), and matches have to clear a relevance floor (or
 * a physics story scores well against articles about road tunnels).
 *
 * Deliberately knows nothing about ideation, discovery providers, or where the
 * candidate came from. It takes a title and returns a score plus the evidence
 * behind it, so a diary event, a wire item and a draft headline all score the
 * same way. The ideation assistant is one caller; it should not be the only one.
 *
 * THE MEASURE
 * -----------
 * Performance is defined once and applied identically everywhere:
 *
 *     P(article) = <metric> accrued between publication and publication + D days
 *
 * This matters more than it looks. `get_post_details()` defaults to the last 90
 * days of traffic, so asking it about a 2019 article returns residual trickle
 * rather than how that article did when it ran. First-30-days is comparable
 * across a piece from 2019 and one from last month; last-90-days is not.
 *
 * WHAT "ORDINARY" IS MEASURED AGAINST
 * -----------------------------------
 * To say a number is good you need to know what ordinary looks like, and every
 * Parse.ly analytics endpoint *ranks* — so any sample drawn from one is the head
 * of a long tail. Measured on The Sun, the median of the top 100 posts in a
 * window is 177k views; of the top 500, 87k; of the top 1000, 60k. An "average"
 * that moves by a factor of three with the row count is not an average.
 *
 * The way out is to stop sampling and take a census: pin the publication window
 * to a single day, and the top-N ranking becomes every article published that
 * day. See reference_set() for the mechanics.
 *
 * WHY RANKING IS DONE HERE RATHER THAN BY THE API
 * -----------------------------------------------
 * Parse.ly's `/search` accepts a `boost` metric that re-ranks relevant results
 * by performance. Measured against the live API it is real but weak and
 * inconsistent: on one query it reordered nothing at all, on another it moved
 * results substantially, and across every query tested the top result never
 * changed. Since this class fetches true metric values anyway, it sorts by those
 * and treats `boost` as a retrieval nudge rather than as the signal.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely;

use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Turns a story candidate into a performance signal with its evidence.
 */
class PerformanceLens {

	/**
	 * Where the configuration is stored.
	 */
	public const OPTION_KEY = 'workflow_parsely_performance_lens';

	/**
	 * Metrics Parse.ly accepts for `sort` and `boost`.
	 *
	 * Validated here rather than at the API, which answers 422 for an unknown
	 * value and fails the whole call.
	 */
	public const METRICS = array(
		'views',
		'mobile_views',
		'tablet_views',
		'desktop_views',
		'visitors',
		'visitors_new',
		'visitors_returning',
		'engaged_minutes',
		'avg_engaged',
		'avg_engaged_new',
		'avg_engaged_returning',
		'social_interactions',
		'fb_interactions',
		'pi_interactions',
		'social_referrals',
		'fb_referrals',
		'tw_referrals',
		'pi_referrals',
		'search_refs',
	);

	/**
	 * Confidence bands, keyed by the minimum measured-article count that earns them.
	 *
	 * A single comparable article is reported as `low` and never generalized
	 * from — one article is an anecdote, and a signal that presents it as a
	 * finding will be wrong in a way an editor cannot see.
	 */
	private const CONFIDENCE_BANDS = array(
		5 => 'high',
		2 => 'medium',
		1 => 'low',
	);

	/**
	 * Default configuration. Override per site via the option, or per call.
	 */
	public const DEFAULTS = array(

		// Which stat defines "performed well". Any value from self::METRICS.
		'metric'                 => 'views',

		// Days after publication over which performance is measured.
		'window_days'            => 30,

		/*
		 * How far back comparable articles may have been published.
		 *
		 * Bounded by retention_days below, and for a hard reason. Parse.ly stops
		 * answering for old windows by returning *near-zero* rather than an
		 * error: measured against The Sun, an article from 11 months ago reported
		 * 13,077 views in its first 30 days, one from 16 months ago reported 1,
		 * and everything past ~2 years reported none at all.
		 *
		 * A missing value is handled safely — measure() returns null and the
		 * article is skipped. A value of 1 is not: it is indistinguishable from a
		 * genuine flop, so a well-read 2019 article silently enters the sample as
		 * a failure and drags the median down. The only safe fix is to never ask
		 * about articles we cannot measure, which is what the clamp does.
		 */
		'lookback_days'          => 365,

		/*
		 * Observed limit of useful historical data, not a documented one. Raise
		 * it for a publisher with longer retention; lower it if old windows start
		 * returning suspiciously small numbers.
		 */
		'retention_days'         => 365,

		/*
		 * Archive matches retrieved. Deeper than the measured sample on purpose,
		 * so there is a range to spread the sample across rather than a head to
		 * take it from.
		 */
		'match_limit'            => 30,

		/*
		 * How many of those are measured. Each costs one API call.
		 *
		 * Five was too few: a median of five moves by tens of percent on nothing,
		 * which is what made the same topic read 1.3x one day and 3.6x the next.
		 * Twelve roughly halves that swing for seven more calls, which is
		 * affordable now that warming drains its own queue.
		 */
		'measure_limit'          => 12,

		/*
		 * How many of the candidate's own terms a match must share before it
		 * counts as comparable coverage.
		 *
		 * `/search` always returns its best effort, never nothing, so without a
		 * floor every candidate looks like it has precedent. A live run scored
		 * "Quantum tunnelling breakthrough at CERN" as high-confidence against
		 * five articles about *road tunnels* — the correct answer there is no
		 * precedent, and this is what produces it.
		 *
		 * Two is deliberately lenient. It is tuned against a handful of queries,
		 * not a corpus, so it is exposed here rather than buried: raise it if
		 * unrelated matches get through, lower it if genuine ones are dropped.
		 */
		'min_term_overlap'       => 2,

		/*
		 * Tier boundaries.
		 *
		 * Tier 1 is everything at or above `tier_1_min`, tier 3 everything at or
		 * below `tier_3_max`, tier 2 the band between them.
		 *
		 * Bands rather than the raw figure because bands are what the measurement
		 * supports. Ordering between topics is right 97% of the time at twelve
		 * comparable articles while the multiplier's own spread is about as wide
		 * as the multiplier — so "clearly above" and "clearly below" survive that
		 * uncertainty and "3.4" does not. A band also cannot be aimed at, which
		 * a decimal invites.
		 *
		 * The defaults are a starting point, not a finding. What counts as a
		 * strong topic differs by newsroom, which is the whole reason these are
		 * configurable.
		 */
		'tier_1_min'             => 2.0,
		'tier_3_max'             => 0.8,

		/*
		 * Fewest comparable articles that will produce a number at all.
		 *
		 * Below this the signal still reports what it found — the matches, the
		 * count, a low confidence — but no multiplier, so the card shows nothing
		 * rather than a figure that cannot carry its own precision.
		 *
		 * Five is measured, not chosen. Resampling real Sun topics, the share of
		 * topic pairs that sort correctly against their full-sample ranking is
		 * 80% at three articles, 84% at five, 91% at eight and 94% at twelve. Five
		 * is where ordering becomes more useful than not; three is close to a coin
		 * flip on anything but the widest gaps.
		 *
		 * Precision is worse than ordering and stays worse: at five articles the
		 * multiplier's 10th-90th percentile spread is still larger than the value
		 * itself. So a number at this floor ranks reliably and quotes badly, which
		 * is the right trade for a feed and the wrong one for a headline figure.
		 */
		'min_matches_to_report'  => 5,

		/*
		 * How many whole publication days to pool for the comparison.
		 *
		 * Five days of Sun output is roughly 1,500 articles, which is a far
		 * larger and less biased comparison than any per-article sample, at five
		 * API calls rather than 1,500. Days are spread across the eligible range
		 * rather than taken consecutively — see reference_days().
		 */
		'reference_days'         => 5,

		/*
		 * Reference posts must be old enough to have a complete window and
		 * recent enough to reflect current audience behaviour.
		 */
		'reference_min_age_days' => 30,
		'reference_max_age_days' => 120,

		/*
		 * A closed cohort is immutable — its first-N-days figures cannot change
		 * once N days have passed — so this is cached for a month rather than
		 * hours. Re-fetching could only return the same numbers.
		 */
		'cohort_cache_days'      => 30,
	);

	/**
	 * Row cap on /analytics/posts, and the line between a census and a head.
	 *
	 * A publication day returning fewer rows than this is every article
	 * published that day. A day returning this many has been truncated, and is
	 * discarded rather than pooled.
	 */
	private const COHORT_LIMIT = 2000;

	/**
	 * The grid the reference days are snapped to, in days.
	 *
	 * See reference_days() for why the days are snapped at all.
	 */
	private const REFERENCE_GRID_DAYS = 7;

	/**
	 * How many of a candidate's tags are folded into the search query.
	 *
	 * Tags are the weakest part of the query — two terms each, ORed in behind the
	 * headline — so past a handful they add query length rather than relevance.
	 * Publications also use the tag field for layout and syndication directives,
	 * and a post carrying dozens of them is carrying machinery, not topics.
	 */
	private const QUERY_TAG_LIMIT = 8;

	/**
	 * Longest query, in characters, that will be sent to `/search`.
	 *
	 * A backstop on the request rather than a tuning knob: the tag limit above is
	 * what normally bounds the query, and this catches a single pathological term
	 * or tag getting through it.
	 */
	private const QUERY_MAX_LENGTH = 512;

	/**
	 * Resolved configuration.
	 *
	 * @return array
	 */
	public static function get_config(): array {
		$stored = get_option( self::OPTION_KEY, array() );
		$config = array_merge( self::DEFAULTS, is_array( $stored ) ? $stored : array() );

		/**
		 * Filters the Performance Lens configuration.
		 *
		 * @param array $config Merged defaults and stored settings.
		 */
		$config = (array) apply_filters( 'workflow_parsely_performance_lens_config', $config );

		return self::sanitize_config( $config );
	}

	/**
	 * Clamp configuration to what the API and the maths will tolerate.
	 *
	 * @param array $config Raw configuration.
	 * @return array
	 */
	private static function sanitize_config( array $config ): array {
		$config = array_merge( self::DEFAULTS, $config );

		if ( ! in_array( $config['metric'], self::METRICS, true ) ) {
			$config['metric'] = self::DEFAULTS['metric'];
		}

		$config['window_days']    = max( 1, (int) $config['window_days'] );
		$config['retention_days'] = max( 1, (int) $config['retention_days'] );

		// Never look further back than we can measure. See DEFAULTS for why.
		$config['lookback_days'] = min(
			$config['retention_days'],
			max( 1, (int) $config['lookback_days'] )
		);

		/*
		 * The measurement window has to fit inside the lookback.
		 *
		 * score() searches for matches published between `lookback_days` ago and
		 * `window_days` ago, so a window as wide as the lookback puts the range's
		 * end on or before its start. Parse.ly answers an inverted range with zero
		 * rows rather than an error, and every candidate then reports "no
		 * comparable coverage" — a positive editorial claim produced by a
		 * configuration mistake. Clamped so there is always at least one eligible
		 * day.
		 */
		$config['window_days']    = max( 1, min( $config['window_days'], $config['lookback_days'] - 1 ) );
		$config['match_limit']    = min( 50, max( 1, (int) $config['match_limit'] ) );
		$config['measure_limit']  = min( (int) $config['match_limit'], max( 1, (int) $config['measure_limit'] ) );
		$config['reference_days'] = min( 30, max( 1, (int) $config['reference_days'] ) );

		/*
		 * Old enough for a complete window, but never older than we can measure.
		 * Without the retention bound, a lowered retention_days left the
		 * reference days outside it, Parse.ly answered with near-zero, and
		 * dividing by that produced a five-figure multiplier on every card.
		 *
		 * Strictly older than one window, not equal to it: a cohort exactly
		 * `window_days` old has its measurement window ending today, so its
		 * first-N-days figures are still accruing. That is not closed history, and
		 * cohort_cache_days caches it for a month as though it were.
		 */
		$config['reference_min_age_days'] = min(
			$config['retention_days'],
			max( (int) $config['window_days'] + 1, (int) $config['reference_min_age_days'] )
		);
		$config['reference_max_age_days'] = max( $config['reference_min_age_days'] + 1, (int) $config['reference_max_age_days'] );
		$config['cohort_cache_days']      = max( 1, (int) $config['cohort_cache_days'] );
		$config['min_term_overlap']       = max( 1, (int) $config['min_term_overlap'] );
		$config['min_matches_to_report']  = max( 1, (int) $config['min_matches_to_report'] );
		$config['tier_3_max']             = max( 0.0, (float) $config['tier_3_max'] );

		/*
		 * Tier 1 must sit above tier 3 or the bands overlap and every result is
		 * both. Inverted bounds are a configuration mistake, so the floor is
		 * nudged above the ceiling rather than silently swapping them.
		 */
		$config['tier_1_min'] = max( $config['tier_3_max'] + 0.1, (float) $config['tier_1_min'] );

		return $config;
	}

	/**
	 * Score a candidate against comparable past coverage.
	 *
	 * @param array $candidate {
	 *     The story candidate.
	 *
	 *     @type string   $title   Required. Headline, event title, or wire slug.
	 *     @type string   $text    Optional. Body text, used for term extraction.
	 *     @type string[] $tags    Optional. Topic labels, folded into the query.
	 *     @type string   $section Optional. Restricts matching and the reference set.
	 * }
	 * @param array $overrides Per-call configuration overrides. `metric` most
	 *                         usefully, so one feed can score on engaged minutes
	 *                         while another uses views.
	 * @return array The signal and its evidence. See build_result() for the shape.
	 */
	public static function score( array $candidate, array $overrides = array() ): array {
		$config  = self::sanitize_config( array_merge( self::get_config(), $overrides ) );
		$metric  = $config['metric'];
		$section = trim( (string) ( $candidate['section'] ?? '' ) );
		$query   = self::build_query( $candidate );

		$result = self::build_result( $config, $query );

		if ( '' === $query ) {
			$result['error'] = __( 'The candidate produced no usable search terms.', 'workflow-parsely' );
			return $result;
		}

		$pub_date_start = gmdate( 'Y-m-d', strtotime( '-' . $config['lookback_days'] . ' days' ) );

		/*
		 * Nothing younger than one measurement window.
		 *
		 * P() is defined as the metric accrued in an article's first N days, and an
		 * article published three days ago has only three days of it. Measured
		 * anyway it enters the sample as a genuine low figure and drags the median
		 * down — and topical candidates are exactly the ones whose best keyword
		 * matches are days old.
		 *
		 * reference_min_age_days already guards the denominator this way. This is
		 * the same guard for the numerator.
		 */
		$pub_date_end = gmdate( 'Y-m-d', strtotime( '-' . $config['window_days'] . ' days' ) );

		/*
		 * sanitize_config() keeps the window inside the lookback, so this range
		 * cannot invert through configuration. If it has anyway, the request is
		 * built from something this class does not control and Parse.ly would
		 * answer it with zero rows — which reads as "we have never covered this"
		 * rather than as a fault.
		 */
		if ( $pub_date_start >= $pub_date_end ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log(
				sprintf(
					'[Workflow Parse.ly] Refusing to search an inverted publication range: %1$s to %2$s, from lookback_days=%3$d and window_days=%4$d.',
					$pub_date_start,
					$pub_date_end,
					(int) $config['lookback_days'],
					(int) $config['window_days']
				)
			);

			$result['error'] = __( 'The configured measurement window leaves no eligible publication dates to search.', 'workflow-parsely' );

			return $result;
		}

		$matches = ParselyClient::search(
			array(
				'q'              => $query,
				'sort'           => 'score',

				/*
				 * No `boost`.
				 *
				 * The API accepts a metric here and re-ranks relevant results by
				 * it. Measured against the live API it changed nothing: boosted
				 * and unboosted top-6 produced identical medians on every topic
				 * tested, and on an earlier sweep the top result never moved on
				 * any query. Since this class fetches true values and sorts on
				 * them anyway, boosting bought an undocumented dependency on
				 * remote ranking behaviour for no measurable effect.
				 */
				'limit'          => $config['match_limit'],
				'pub_date_start' => $pub_date_start,
				'pub_date_end'   => $pub_date_end,
				'section'        => $section,
			)
		);

		if ( $matches instanceof WP_Error ) {
			$result['error'] = $matches->get_error_message();
			return $result;
		}

		/*
		 * Deduplicated on the stem, not the word. term_overlap() counts one per
		 * candidate term, and tags routinely echo a headline word — so without
		 * this a single shared word counted twice and cleared a floor of two on
		 * its own, which is the failure the floor exists to prevent.
		 *
		 * On the stem because that is what the comparison compares. Collapsing
		 * raw words leaves "payment" and "payments" as two terms that both match
		 * the same word in a headline, which clears a floor of two for one shared
		 * concept — the same failure the raw dedup was added to stop.
		 */
		$candidate_terms = self::collapse_by_stem(
			self::significant_terms(
				(string) ( $candidate['title'] ?? '' ) . ' ' . implode( ' ', (array) ( $candidate['tags'] ?? array() ) )
			)
		);

		$measured = self::measure_matches(
			(array) $matches,
			$config,
			$candidate_terms,
			self::clean_url( (string) ( $candidate['exclude_url'] ?? '' ) )
		);

		$reference = array() === $measured ? array() : self::reference_set( $section, $config );

		/*
		 * Everything gathered, before any arithmetic is done to it.
		 *
		 * This is the seam. Collection is the expensive, Parse.ly-specific half —
		 * finding comparable articles, measuring each over its own first N days,
		 * and building a census to compare them against. The arithmetic that turns
		 * those numbers into a multiplier is one opinion about what "performed
		 * well" means, and a newsroom may hold a different one.
		 */
		$raw = array(
			'candidate'   => $candidate,
			'query'       => $query,
			'metric'      => $metric,
			'window_days' => $config['window_days'],
			'section'     => $section,

			// Every comparable article we measured, with its value.
			'matches'     => $measured,

			// Every value in the census the matches are compared against.
			'reference'   => $reference,

			'config'      => $config,
		);

		$result = array_merge( $result, self::calculate( $raw ) );

		/**
		 * Filters the finished performance signal, with everything it was derived from.
		 *
		 * The second argument carries the raw material: each measured article and
		 * its value, and the full census distribution. That is enough to compute a
		 * different answer entirely — a trimmed mean instead of a median, a
		 * weighting by recency or section, a comparison against something else
		 * altogether — or to ignore what is here, make further calls, and return a
		 * signal of your own.
		 *
		 * Note that `reference` can hold tens of thousands of floats. Do not
		 * serialize it into a response or store it; it is passed for computation.
		 *
		 * The return value is normalized before use: keys this class does not
		 * recognize are dropped, and anything missing falls back to what the
		 * default arithmetic produced. Returning a non-array leaves the signal
		 * untouched. So a listener can safely return only the keys it wants to
		 * change.
		 *
		 * @param array $result The computed signal.
		 * @param array $raw    What it was computed from: candidate, query, metric,
		 *                      window_days, section, matches, reference, config.
		 */
		$filtered = apply_filters( 'workflow_parsely_performance_signal', $result, $raw );

		return self::normalize_result( $filtered, $result );
	}

	/**
	 * The default arithmetic: what the collected numbers mean.
	 *
	 * Deliberately separate from collection, and deliberately doing nothing a
	 * caller could not do for themselves from `$raw`. Everything here is one
	 * defensible choice among several — the median rather than the mean, a ratio
	 * against the census median, a confidence band keyed to how many articles the
	 * answer rests on. A newsroom that wants different arithmetic replaces this
	 * through `workflow_parsely_performance_signal` rather than forking the class.
	 *
	 * @param array $raw Collected material. See score().
	 * @return array The computed fields of a signal.
	 */
	public static function calculate( array $raw ): array {
		$measured = (array) ( $raw['matches'] ?? array() );

		/*
		 * No comparable coverage is a finding, not a failure. An editor learning
		 * the newsroom has never covered this is being told something useful, and
		 * it is the honest answer for a genuinely new story.
		 */
		if ( array() === $measured ) {
			return array(
				'count'      => 0,
				'matches'    => array(),
				'confidence' => 'no_precedent',
			);
		}

		$values = array_column( $measured, 'value' );

		$computed = array(
			'count'      => count( $measured ),
			'matches'    => $measured,
			'best'       => max( $values ),

			/*
			 * Geometric, not the median.
			 *
			 * Measured by resampling real topics, a geometric mean sorted pairs
			 * correctly 83% of the time at three comparable articles against the
			 * median's 80%, 88% against 84% at five, and 97% against 94% at
			 * twelve — better at every sample size. It uses every value instead of
			 * discarding all but the middle one, which is what buys the stability,
			 * while staying multiplicative so a single runaway article cannot drag
			 * it the way a mean would.
			 */
			'typical'    => self::geometric_mean( $values ),
			'recency'    => self::most_recent( $measured ),
			'angles'     => self::tag_lift( $measured ),
			'confidence' => self::confidence( count( $measured ) ),
		);

		$reference = (array) ( $raw['reference'] ?? array() );

		if ( array() === $reference ) {
			return $computed;
		}

		$config  = (array) ( $raw['config'] ?? self::get_config() );
		$minimum = (int) ( $config['min_matches_to_report'] ?? self::DEFAULTS['min_matches_to_report'] );

		/*
		 * Too thin to put a number on. The evidence still goes back — an editor
		 * seeing two comparable articles and their values is better served than
		 * one seeing a confident multiple derived from them.
		 */
		if ( count( $measured ) < $minimum ) {
			$computed['reference'] = array(
				'size'        => count( $reference ),
				'median'      => self::median( $reference ),
				'section'     => (string) ( $raw['section'] ?? '' ),
				'description' => self::describe_reference( count( $reference ), (string) ( $raw['section'] ?? '' ), $config ),
			);

			return $computed;
		}

		$reference_median = self::median( $reference );

		$computed['score'] = self::percentile( $computed['typical'], $reference );

		/*
		 * The headline number — and the thing most likely to be misused.
		 *
		 * It ranks well and quotes badly. Resampling real topics, the ordering
		 * between them is right 97% of the time at twelve comparable articles,
		 * while the value's own 10th-90th spread is still roughly as wide as the
		 * value itself. So "this topic tends to do better than that one" is
		 * supported; "this topic does 3.4x" is not, and "get this story to 3.4x"
		 * is not a thing the number can mean at all.
		 *
		 * It is a description of what already happened, not a target. Anything
		 * built on top of it — a threshold, a gate, an objective — inherits an
		 * uncertainty band wider than most of the differences it would be used to
		 * judge.
		 *
		 * Safe as a ratio only because the denominator is a census rather than a
		 * top-N list: against a ranked sample it would move by a factor of three
		 * on the row count alone.
		 */
		if ( $reference_median > 0 ) {
			$computed['multiplier'] = round( $computed['typical'] / $reference_median, 1 );
		}

		$computed['tier'] = self::tier( $computed['multiplier'] ?? null, $config );

		// Resolved here so every surface shows the same words for the same band.
		$computed['tier_label'] = self::tier_label( $computed['tier'] );

		$computed['reference'] = array(
			'size'        => count( $reference ),
			'median'      => $reference_median,
			'section'     => (string) ( $raw['section'] ?? '' ),
			'description' => self::describe_reference( count( $reference ), (string) ( $raw['section'] ?? '' ), $config ),
		);

		return $computed;
	}

	/**
	 * Which band a multiple falls in.
	 *
	 * @param float|null $multiplier The computed multiple, or null when there is none.
	 * @param array      $config     Resolved configuration.
	 * @return int|null 1, 2 or 3, or null when there is nothing to band.
	 */
	public static function tier( ?float $multiplier, array $config ): ?int {
		if ( null === $multiplier ) {
			return null;
		}

		if ( $multiplier >= (float) $config['tier_1_min'] ) {
			return 1;
		}

		if ( $multiplier <= (float) $config['tier_3_max'] ) {
			return 3;
		}

		return 2;
	}

	/**
	 * Reader-facing name for a tier.
	 *
	 * Filterable because "Tier 1" is a number, not a word an editor thinks in. A
	 * newsroom that wants "Strong", "Typical" and "Soft" — or its own desk
	 * vocabulary — should not have to fork anything to get it.
	 *
	 * @param int|null $tier Tier number.
	 * @return string
	 */
	public static function tier_label( ?int $tier ): string {
		if ( null === $tier ) {
			return '';
		}

		$labels = array(
			1 => __( 'Tier 1', 'workflow-parsely' ),
			2 => __( 'Tier 2', 'workflow-parsely' ),
			3 => __( 'Tier 3', 'workflow-parsely' ),
		);

		/**
		 * Filters one tier's label.
		 *
		 * Deliberately one label at a time rather than the whole map. Handing over
		 * an array keyed 1, 2, 3 invites `array_merge()` to override a single
		 * entry, and `array_merge()` renumbers integer keys — so the obvious way
		 * to rename Tier 1 silently renames all three.
		 *
		 * @param string $label The default label.
		 * @param int    $tier  Tier number: 1, 2 or 3.
		 */
		return (string) apply_filters(
			'workflow_parsely_tier_label',
			$labels[ $tier ] ?? '',
			$tier
		);
	}

	/**
	 * Reader-facing name for a Parse.ly metric.
	 *
	 * Lives beside METRICS rather than on whichever surface happens to render a
	 * metric, so every surface says the same words for the same key. Anything not
	 * named here falls back to the key with its underscores opened out, which is
	 * readable for the rest of METRICS.
	 *
	 * @param string $metric Metric key.
	 * @return string
	 */
	public static function metric_label( string $metric ): string {
		$labels = array(
			'views'               => __( 'views', 'workflow-parsely' ),
			'visitors'            => __( 'visitors', 'workflow-parsely' ),
			'engaged_minutes'     => __( 'engaged minutes', 'workflow-parsely' ),
			'avg_engaged'         => __( 'average engaged minutes', 'workflow-parsely' ),
			'social_interactions' => __( 'social interactions', 'workflow-parsely' ),
			'search_refs'         => __( 'search referrals', 'workflow-parsely' ),
		);

		return $labels[ $metric ] ?? str_replace( '_', ' ', $metric );
	}

	/**
	 * Fold a filtered signal back into the shape every consumer expects.
	 *
	 * Three surfaces read this — the ideation cards, the transition check, and the
	 * stream's ranking — and each indexes keys directly. A listener that returns a
	 * partial array, or drops a key, would otherwise reach them as a missing-index
	 * warning or a card rendering nothing, in a request the ideation screen waits
	 * on. Unknown keys are dropped for the same reason: the shape is a contract,
	 * and silently widening it makes it impossible to change later.
	 *
	 * @param mixed $filtered What the filter returned.
	 * @param array $fallback The signal as computed before filtering.
	 * @return array
	 */
	private static function normalize_result( $filtered, array $fallback ): array {
		if ( ! is_array( $filtered ) ) {
			return $fallback;
		}

		$normalized = array();

		foreach ( $fallback as $key => $value ) {
			$normalized[ $key ] = array_key_exists( $key, $filtered ) ? $filtered[ $key ] : $value;
		}

		return $normalized;
	}

	/**
	 * The empty result, so every return path has the same shape.
	 *
	 * @param array  $config Resolved configuration.
	 * @param string $query  The query that was built, shown even on failure.
	 * @return array
	 */
	private static function build_result( array $config, string $query ): array {
		return array(

			// What was asked, so any number below can be interrogated.
			'metric'      => $config['metric'],
			'window_days' => $config['window_days'],
			'query'       => $query,

			// How much to trust it.
			'confidence'  => 'no_precedent',
			'count'       => 0,

			// The evidence.
			'matches'     => array(),
			'best'        => null,
			'typical'     => null,
			'recency'     => null,

			// The summary, and what it is measured against.
			'multiplier'  => null,
			'tier'        => null,
			'tier_label'  => null,
			'score'       => null,
			'reference'   => null,

			// Which framings did best among the matches.
			'angles'      => array(),

			'error'       => null,
		);
	}

	// ── Matching ─────────────────────────────────────────────────────

	/**
	 * Measure the leading matches and sort by what they actually did.
	 *
	 * Only `measure_limit` of them: each measurement is one API call, and this is
	 * the only place in the flow that fans out. The lookup shortcut you might
	 * expect — reading values out of a top-content sample — does not work here,
	 * because comparable articles are typically years old while any such sample
	 * covers recent weeks.
	 *
	 * @param array    $matches         Raw `/search` records.
	 * @param array    $config          Resolved configuration.
	 * @param string[] $candidate_terms Significant terms from the candidate.
	 * @param string   $exclude_url     URL to keep out of its own comparison.
	 * @return array[] Measured matches, best first.
	 */
	private static function measure_matches( array $matches, array $config, array $candidate_terms, string $exclude_url = '' ): array {
		$eligible = array();

		// First pass: no API calls. Decide what is comparable before paying for it.
		foreach ( $matches as $match ) {
			if ( ! is_array( $match ) ) {
				continue;
			}

			$url      = self::clean_url( (string) ( $match['url'] ?? $match['link'] ?? '' ) );
			$pub_date = (string) ( $match['pub_date'] ?? '' );

			if ( '' === $url || '' === $pub_date ) {
				continue;
			}

			/*
			 * A published post is its own best keyword match, so checking one
			 * from the editor puts it at the top of its own comparison and
			 * measures it against itself. Excluded by slug rather than by full
			 * URL, since neither host nor section survives a change of
			 * environment.
			 */
			if ( '' !== $exclude_url && self::same_article( $url, $exclude_url ) ) {
				continue;
			}

			$title = (string) ( $match['title'] ?? '' );
			$tags  = self::clean_tags( (array) ( $match['tags'] ?? array() ) );

			$overlap = self::term_overlap( $candidate_terms, $title . ' ' . implode( ' ', $tags ) );

			if ( $overlap < $config['min_term_overlap'] ) {
				continue;
			}

			$eligible[] = array(
				'title'    => $title,
				'url'      => $url,
				'pub_date' => $pub_date,
				'section'  => (string) ( $match['section'] ?? '' ),
				'tags'     => $tags,
				'overlap'  => $overlap,
			);
		}

		$measured = array();

		// Second pass: measure a spread of the eligible set, not its head.
		foreach ( self::spread( $eligible, (int) $config['measure_limit'] ) as $row ) {
			$value = self::measure( $row['url'], $row['pub_date'], $config );

			if ( null === $value ) {
				continue;
			}

			$row['value'] = $value;
			$measured[]   = $row;
		}

		usort( $measured, static fn( array $a, array $b ): int => $b['value'] <=> $a['value'] );

		return $measured;
	}

	/**
	 * Take `$count` items spread evenly across a list rather than from its head.
	 *
	 * Search returns its results ranked, so measuring the first N samples one end
	 * of whatever that ranking correlates with. Taking a spread costs exactly the
	 * same number of API calls and describes the topic rather than its top.
	 *
	 * Measured against the live API the effect is smaller than expected — with a
	 * `boost` applied and without it, the head produced identical medians, and
	 * spreading moved the result in both directions across topics rather than
	 * consistently downward. So this is a variance and construction improvement,
	 * not the correction of a demonstrated inflation. It is the honest sampling
	 * either way, and it is free.
	 *
	 * @param array[] $items List to sample.
	 * @param int     $count How many to take.
	 * @return array[]
	 */
	private static function spread( array $items, int $count ): array {
		$total = count( $items );

		if ( $total <= $count || $count < 1 ) {
			return $items;
		}

		$step   = $total / $count;
		$picked = array();

		for ( $i = 0; $i < $count; $i++ ) {
			$picked[] = $items[ (int) floor( $i * $step ) ];
		}

		return $picked;
	}

	/**
	 * Metric accrued by one article in its first `window_days`.
	 *
	 * @param string $url      Canonical URL.
	 * @param string $pub_date Publication date as Parse.ly reports it.
	 * @param array  $config   Resolved configuration.
	 * @return float|null The value, or null when Parse.ly has nothing usable.
	 */
	private static function measure( string $url, string $pub_date, array $config ): ?float {
		$published = strtotime( $pub_date );

		if ( false === $published ) {
			return null;
		}

		$service = ParselyClient::content();

		if ( $service instanceof WP_Error ) {
			return null;
		}

		$details = $service->get_post_details(
			$url,
			gmdate( 'Y-m-d', $published ),
			gmdate( 'Y-m-d', $published + ( $config['window_days'] * DAY_IN_SECONDS ) )
		);

		if ( $details instanceof WP_Error || ! is_array( $details ) ) {
			return null;
		}

		$row = $details[0] ?? $details;

		if ( ! is_array( $row ) ) {
			return null;
		}

		$metrics = is_array( $row['metrics'] ?? null ) ? $row['metrics'] : $row;

		return isset( $metrics[ $config['metric'] ] ) ? (float) $metrics[ $config['metric'] ] : null;
	}

	// ── Reference set ────────────────────────────────────────────────

	/**
	 * Performance of ordinary output, pooled from whole publication days.
	 *
	 * THE TRICK
	 * ---------
	 * Every Parse.ly analytics endpoint ranks, so any sample drawn from one is
	 * the head of a long tail — which is why a ratio against a top-N median is
	 * meaningless. But pin `pub_date_start` and `pub_date_end` to the *same day*
	 * and the ranking stops mattering: The Sun publishes a few hundred articles a
	 * day, well under the endpoint's 2000-row cap, so "the top 2000 published
	 * that day" is simply every article published that day. A census, with its
	 * tail intact.
	 *
	 * Measured live, a single day returns 208-431 rows with minimums of 1 and 3
	 * view. Their median lands at 3-7k against 60-177k for the top-N head the
	 * earlier implementation used — a factor of twenty, all of it bias.
	 *
	 * Pinning the traffic window to that same day plus `window_days` means each
	 * row is measured over exactly its own first N days, which is the lens's P().
	 * So one call yields a complete, correctly-measured cohort — where sampling
	 * articles individually cost one call each.
	 *
	 * WHY IT CACHES ALMOST FOREVER
	 * ----------------------------
	 * A day's first-N-days figures stop changing once N days have passed. Every
	 * cohort gathered here is closed history, so re-fetching it can only return
	 * the same numbers. That also makes this safe to accumulate slowly: each day
	 * fetched is permanent, and pooling more of them only sharpens the
	 * distribution.
	 *
	 * @param string $section Section to scope to, or '' for site-wide.
	 * @param array  $config  Resolved configuration.
	 * @return float[] Pooled values, unordered.
	 */
	private static function reference_set( string $section, array $config ): array {
		$values = array();

		foreach ( self::reference_days( $config ) as $day ) {
			$values = array_merge( $values, self::day_cohort( $day, $section, $config ) );
		}

		return $values;
	}

	/**
	 * Publication days to pool, spread across the eligible range.
	 *
	 * Spread rather than consecutive: a single week can be distorted by one big
	 * story, and adjacent days share whatever was happening that week. The range
	 * starts at `reference_min_age_days` so every cohort has a complete window,
	 * and ends at `reference_max_age_days` so nothing strays out of retention.
	 *
	 * WHY THE DAYS SIT ON A GRID
	 * --------------------------
	 * The dates are anchored to a fixed weekly boundary rather than counted back
	 * from today. Counted back from today, every date moved at midnight — so the
	 * five cohort transients keyed on those dates were all cold every morning, and
	 * day_cohort()'s month-long cache, which exists because a closed cohort's
	 * figures can never change, never survived a day. The expensive census was
	 * re-fetched daily for numbers it already had under a different key.
	 *
	 * Snapping to whole weeks makes the same five dates be asked for all week, so
	 * the cache is used. A week is the coarsest grid that costs nothing: cohorts
	 * are a month or more old, so a few days either way changes what "ordinary
	 * output" looks like not at all, and it is the natural period for a newsroom's
	 * own rhythm anyway.
	 *
	 * Snapping only ever moves a date *older*, so the newest cohort stays strictly
	 * older than one measurement window. The oldest end reserves the grid's width
	 * against `retention_days` below, so the drift cannot push a day out of what
	 * Parse.ly can still answer for.
	 *
	 * @param array $config Resolved configuration.
	 * @return string[] Dates as Y-m-d.
	 */
	private static function reference_days( array $config ): array {
		$oldest = min(
			(int) $config['reference_max_age_days'],
			(int) $config['retention_days'] - ( self::REFERENCE_GRID_DAYS - 1 )
		);

		/*
		 * Strictly older than one window. A day exactly `window_days` old is still
		 * inside its own measurement period — its first-N-days figures finish
		 * accruing today — so it is not the closed history day_cohort() caches for
		 * a month on the assumption that re-fetching could only return the same
		 * numbers.
		 */
		$newest = max( $config['reference_min_age_days'], $config['window_days'] + 1 );
		$count  = max( 1, (int) $config['reference_days'] );

		/*
		 * No eligible range means no reference set, not a day picked from
		 * outside it. Every caller already handles an absent multiplier; none
		 * handles a denominator Parse.ly cannot answer for.
		 */
		if ( $oldest <= $newest ) {
			return array();
		}

		/*
		 * One grid boundary for the whole set, with the days placed at fixed
		 * offsets behind it. Snapping each day on its own would work too, but this
		 * keeps the spacing exactly as the step arithmetic intends — and keeps the
		 * days as distinct from each other as they were before the grid existed,
		 * which independent snapping would collapse whenever the step is shorter
		 * than a week.
		 */
		$anchor = self::grid_boundary_at_or_before( $newest );

		// Divided by count-1 so the span is inclusive of both ends.
		$step = $count > 1 ? ( $oldest - $newest ) / ( $count - 1 ) : 0;
		$days = array();

		for ( $index = 0; $index < $count; $index++ ) {
			$offset = (int) round( $step * $index );
			$days[] = gmdate( 'Y-m-d', $anchor - ( $offset * DAY_IN_SECONDS ) );
		}

		return array_values( array_unique( $days ) );
	}

	/**
	 * The most recent grid boundary that is at least `$age` days old.
	 *
	 * Anchored on the Unix epoch rather than on a weekday name, so it is the same
	 * instant for every site regardless of locale or start-of-week setting, and it
	 * moves exactly once a week.
	 *
	 * @param int $age Minimum age in days.
	 * @return int Timestamp of the boundary.
	 */
	private static function grid_boundary_at_or_before( int $age ): int {
		$grid   = self::REFERENCE_GRID_DAYS * DAY_IN_SECONDS;
		$target = time() - ( $age * DAY_IN_SECONDS );

		return $target - ( $target % $grid );
	}

	/**
	 * Every article published on one day, measured over its own first N days.
	 *
	 * @param string $day     Publication date, Y-m-d.
	 * @param string $section Section to scope to, or ''.
	 * @param array  $config  Resolved configuration.
	 * @return float[] Metric values for that day's cohort.
	 */
	private static function day_cohort( string $day, string $section, array $config ): array {
		$cache_key = 'wf_parsely_cohort_' . md5(
			(string) wp_json_encode( array( $day, $section, $config['metric'], $config['window_days'] ) )
		);

		$cached = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$service = ParselyClient::content();

		if ( $service instanceof WP_Error ) {
			return array();
		}

		$window_end = strtotime( $day ) + ( $config['window_days'] * DAY_IN_SECONDS );

		$posts = $service->get_posts(
			array(
				'pub_date_start' => $day,
				'pub_date_end'   => $day,
				'period_start'   => $day,
				'period_end'     => gmdate( 'Y-m-d', $window_end ),
				'sort'           => $config['metric'],
				'limit'          => self::COHORT_LIMIT,
				'section'        => $section,
			)
		);

		if ( $posts instanceof WP_Error || ! is_array( $posts ) ) {
			return array();
		}

		/*
		 * A day at the row cap is a head again, not a census, and pooling it
		 * would quietly reintroduce the bias this whole approach exists to
		 * remove. Dropped rather than trusted — a smaller honest distribution
		 * beats a larger skewed one.
		 */
		if ( count( $posts ) >= self::COHORT_LIMIT ) {
			/*
			 * Cached as empty. Truncation is a property of that day's volume and
			 * will never change, so re-asking costs a 2000-row response to learn
			 * the same thing. A publisher above the cap would otherwise pay five
			 * heavy calls on every single score, forever, and never see a
			 * multiplier.
			 */
			set_transient( $cache_key, array(), $config['cohort_cache_days'] * DAY_IN_SECONDS );

			return array();
		}

		$values = array();

		foreach ( $posts as $post ) {
			if ( ! is_array( $post ) ) {
				continue;
			}

			$metrics = is_array( $post['metrics'] ?? null ) ? $post['metrics'] : array();

			if ( isset( $metrics[ $config['metric'] ] ) ) {
				$values[] = (float) $metrics[ $config['metric'] ];
			}
		}

		set_transient( $cache_key, $values, $config['cohort_cache_days'] * DAY_IN_SECONDS );

		return $values;
	}

	/**
	 * Say in words what the reference set is, so the score can be read honestly.
	 *
	 * @param int    $size    Sample size actually measured.
	 * @param string $section Section scope, or ''.
	 * @param array  $config  Resolved configuration.
	 * @return string
	 */
	private static function describe_reference( int $size, string $section, array $config ): string {
		$days = count( self::reference_days( $config ) );

		if ( '' !== $section ) {
			return sprintf(
				/* translators: 1: article count, 2: section name, 3: number of days sampled, 4: window in days. */
				__( 'every %2$s article published on %3$d sample days (%1$d in all), each measured over its own first %4$d days.', 'workflow-parsely' ),
				$size,
				$section,
				$days,
				$config['window_days']
			);
		}

		return sprintf(
			/* translators: 1: article count, 2: number of days sampled, 3: window in days. */
			__( 'every article published on %2$d sample days (%1$d in all), each measured over its own first %3$d days.', 'workflow-parsely' ),
			$size,
			$days,
			$config['window_days']
		);
	}

	// ── Angles ───────────────────────────────────────────────────────

	/**
	 * Which tags are over-represented among the better-performing matches.
	 *
	 * Splits the measured set at its own median and compares each tag's share
	 * above the split with its share overall. A tag appearing in one article of
	 * five carries no information about anything, so the floor of two occurrences
	 * matters more than the lift threshold.
	 *
	 * The lift value is returned for callers that want to sort by it, but the
	 * sample is far too small to render as a number to an editor. Present these
	 * as "the ones that did best led on X", never as "X: 1.6x".
	 *
	 * @param array[] $measured Measured matches.
	 * @return array[] Tags with lift above 1.2 and at least two occurrences, strongest first.
	 */
	private static function tag_lift( array $measured ): array {
		if ( count( $measured ) < 3 ) {
			return array();
		}

		$median = self::median( array_column( $measured, 'value' ) );
		$top    = array_filter( $measured, static fn( array $m ): bool => $m['value'] >= $median );

		if ( array() === $top ) {
			return array();
		}

		$overall_counts = self::count_tags( $measured );
		$top_counts     = self::count_tags( $top );

		$angles = array();

		foreach ( $top_counts as $tag => $top_count ) {
			$overall_count = $overall_counts[ $tag ] ?? 0;

			if ( $overall_count < 2 ) {
				continue;
			}

			$lift = ( $top_count / count( $top ) ) / ( $overall_count / count( $measured ) );

			if ( $lift <= 1.2 ) {
				continue;
			}

			$angles[] = array(
				'tag'   => $tag,
				'lift'  => round( $lift, 2 ),
				'count' => $overall_count,
			);
		}

		usort( $angles, static fn( array $a, array $b ): int => $b['lift'] <=> $a['lift'] );

		return $angles;
	}

	/**
	 * Tag occurrence counts across a set of measured matches.
	 *
	 * @param array[] $measured Measured matches.
	 * @return array<string, int>
	 */
	private static function count_tags( array $measured ): array {
		$counts = array();

		foreach ( $measured as $match ) {
			foreach ( $match['tags'] as $tag ) {
				$counts[ $tag ] = ( $counts[ $tag ] ?? 0 ) + 1;
			}
		}

		return $counts;
	}

	/**
	 * Drop tags that are not editorial angles.
	 *
	 * Parse.ly's tag list mixes three things: the publisher's own tags, machine
	 * labels its crawler adds (`parsely_smart:entity:…`, `parsely_smart:iab:…`),
	 * and structural ones mirroring the section (`Section: Money:News Money`).
	 * Only the first kind describes an angle.
	 *
	 * Left in, the others win the lift calculation by sheer ubiquity — the first
	 * live run surfaced "Section: Money:News Money" as this signal's top
	 * editorial insight, which is a section name wearing a hat.
	 *
	 * @param array $tags Raw tag list.
	 * @return string[]
	 */
	private static function clean_tags( array $tags ): array {
		$prefixes = array( 'parsely_smart:', 'section:', 'author:', 'iab:' );

		$clean = array();

		foreach ( $tags as $tag ) {
			if ( ! is_string( $tag ) || '' === trim( $tag ) ) {
				continue;
			}

			$lower   = strtolower( trim( $tag ) );
			$skipped = false;

			foreach ( $prefixes as $prefix ) {
				if ( str_starts_with( $lower, $prefix ) ) {
					$skipped = true;
					break;
				}
			}

			if ( ! $skipped ) {
				$clean[] = trim( $tag );
			}
		}

		return array_values( array_unique( $clean ) );
	}

	// ── Query construction ───────────────────────────────────────────

	/**
	 * Build a Parse.ly search query from a candidate.
	 *
	 * A whole headline matches loosely, because the terms are ORed. Stopwords
	 * come out, the leading pair of significant terms goes in as a quoted phrase
	 * to anchor relevance, and tag words follow as weaker signal.
	 *
	 * Returned verbatim on the result so anyone can see what was actually asked.
	 *
	 * Bounded here rather than by callers. Tag counts are the caller's data, not
	 * the caller's choice — a post carrying two hundred tags would otherwise fold
	 * into a four-hundred-term query, and the limit that keeps the request sane
	 * belongs with the code that decides what the query is.
	 *
	 * @param array $candidate Candidate as passed to score().
	 * @return string The query, or '' when nothing usable could be extracted.
	 */
	public static function build_query( array $candidate ): string {
		$terms = self::significant_terms( (string) ( $candidate['title'] ?? '' ) );

		if ( array() === $terms ) {
			return '';
		}

		$parts = array();

		if ( count( $terms ) >= 2 ) {
			$parts[] = '"' . $terms[0] . ' ' . $terms[1] . '"';
		}

		$parts = array_merge( $parts, array_slice( $terms, 0, 6 ) );

		$tags = array_slice( (array) ( $candidate['tags'] ?? array() ), 0, self::QUERY_TAG_LIMIT );

		foreach ( $tags as $tag ) {
			$parts = array_merge( $parts, array_slice( self::significant_terms( (string) $tag ), 0, 2 ) );
		}

		return self::join_within_limit( array_unique( $parts ) );
	}

	/**
	 * Join query parts, stopping before the length cap rather than cutting through a term.
	 *
	 * Ordered by usefulness already — the anchoring phrase, then title terms, then
	 * tag terms — so dropping from the end drops the weakest signal first.
	 *
	 * @param string[] $parts Query parts, strongest first.
	 * @return string
	 */
	private static function join_within_limit( array $parts ): string {
		$query = '';

		foreach ( $parts as $part ) {
			$candidate = '' === $query ? $part : $query . ' ' . $part;

			if ( mb_strlen( $candidate ) > self::QUERY_MAX_LENGTH ) {
				break;
			}

			$query = $candidate;
		}

		return $query;
	}

	/**
	 * How many of the candidate's terms appear in a match.
	 *
	 * Compared on a five-character prefix so ordinary inflections count as the
	 * same word — "payment"/"payments", "tunnel"/"tunnels". That is cruder than
	 * stemming and occasionally over-matches, which is the right direction for a
	 * floor: it lets a borderline match through rather than discarding genuine
	 * coverage on a plural.
	 *
	 * @param string[] $candidate_terms Significant terms from the candidate.
	 * @param string   $text            Match title plus its tags.
	 * @return int Distinct candidate terms found.
	 */
	private static function term_overlap( array $candidate_terms, string $text ): int {
		$haystack = self::significant_terms( $text );

		if ( array() === $haystack ) {
			return 0;
		}

		$stems = array_map( self::stem( ... ), $haystack );
		$found = 0;

		foreach ( $candidate_terms as $term ) {
			if ( in_array( self::stem( $term ), $stems, true ) ) {
				++$found;
			}
		}

		return $found;
	}

	/**
	 * Crude stem for overlap comparison. See term_overlap() for why not more.
	 *
	 * @param string $word Word to reduce.
	 * @return string
	 */
	private static function stem( string $word ): string {
		return mb_substr( $word, 0, 5 );
	}

	/**
	 * One term per stem, keeping the first spelling of each.
	 *
	 * The unit the relevance floor counts in. Two spellings of one concept are
	 * one term to term_overlap(), so they have to be one term here too or the
	 * floor can be cleared by a single shared idea.
	 *
	 * @param string[] $terms Significant terms, in order.
	 * @return string[]
	 */
	private static function collapse_by_stem( array $terms ): array {
		$by_stem = array();

		foreach ( $terms as $term ) {
			$stem = self::stem( $term );

			if ( ! isset( $by_stem[ $stem ] ) ) {
				$by_stem[ $stem ] = $term;
			}
		}

		return array_values( $by_stem );
	}

	/**
	 * Reduce a string to its content-bearing words, in order.
	 *
	 * @param string $text Source text.
	 * @return string[]
	 */
	private static function significant_terms( string $text ): array {
		static $stopwords = array(
			'a',
			'about',
			'after',
			'again',
			'against',
			'all',
			'an',
			'and',
			'announces',
			'any',
			'are',
			'as',
			'at',
			'back',
			'be',
			'been',
			'before',
			'begins',
			'being',
			'between',
			'both',
			'but',
			'by',
			'can',
			'confirms',
			'could',
			'delivers',
			'did',
			'do',
			'does',
			'during',
			'each',
			'first',
			'for',
			'from',
			'further',
			'had',
			'has',
			'have',
			'he',
			'her',
			'here',
			'hers',
			'him',
			'his',
			'how',
			'if',
			'in',
			'into',
			'is',
			'it',
			'its',
			'just',
			'latest',
			'make',
			'makes',
			'more',
			'most',
			'new',
			'next',
			'no',
			'nor',
			'not',
			'now',
			'of',
			'off',
			'on',
			'once',
			'only',
			'or',
			'other',
			'our',
			'out',
			'over',
			'own',
			'past',
			'publishes',
			'released',
			'returns',
			'said',
			'same',
			'says',
			'set',
			'she',
			'should',
			'so',
			'some',
			'such',
			'takes',
			'than',
			'that',
			'the',
			'their',
			'them',
			'then',
			'there',
			'these',
			'they',
			'this',
			'those',
			'through',
			'to',
			'too',
			'under',
			'until',
			'up',
			'very',
			'was',
			'we',
			'were',
			'what',
			'when',
			'where',
			'which',
			'while',
			'who',
			'whom',
			'why',
			'will',
			'with',
			'would',
			'you',
			'your',
		);

		$words = preg_split( '/[^\p{L}\p{N}]+/u', strtolower( wp_strip_all_tags( $text ) ), -1, PREG_SPLIT_NO_EMPTY );

		if ( ! is_array( $words ) ) {
			return array();
		}

		return array_values(
			array_filter(
				$words,
				static fn( string $word ): bool => mb_strlen( $word ) > 2 && ! in_array( $word, $stopwords, true )
			)
		);
	}

	// ── Statistics ───────────────────────────────────────────────────

	/**
	 * Typical value of a list, computed multiplicatively.
	 *
	 * The right centre for traffic figures, which span orders of magnitude: the
	 * difference between 1,000 and 10,000 views is the same *kind* of difference
	 * as between 10,000 and 100,000, and only a log-space average treats it that
	 * way. An arithmetic mean is dominated by whichever article went viral; a
	 * median throws away every value but one.
	 *
	 * Values below 1 are floored there rather than dropped — an article with no
	 * traffic is a real data point about the topic, and log(0) is not a number.
	 *
	 * @param float[] $values Values.
	 * @return float
	 */
	public static function geometric_mean( array $values ): float {
		if ( array() === $values ) {
			return 0.0;
		}

		$logs = array_map( static fn( $value ): float => log( max( 1.0, (float) $value ) ), $values );

		return exp( array_sum( $logs ) / count( $logs ) );
	}

	/**
	 * Middle value of a non-empty list.
	 *
	 * Still used for the census denominator. That side has thousands of values,
	 * so it has no variance problem for a geometric mean to solve, and a median is
	 * the more intuitive anchor: half the newsroom's output did better than this.
	 *
	 * The two sides therefore use different statistics, which is deliberate and
	 * measured — the ordering figures above come from exactly this pairing. Making
	 * the denominator geometric too would scale every multiplier by about 1.35 and
	 * change no ordering at all, so it remains available as a presentation choice
	 * rather than an accuracy one.
	 *
	 * @param float[] $values Values.
	 * @return float
	 */
	public static function median( array $values ): float {
		if ( array() === $values ) {
			return 0.0;
		}

		sort( $values );

		$count  = count( $values );
		$middle = intdiv( $count, 2 );

		if ( 0 === $count % 2 ) {
			return ( (float) $values[ $middle - 1 ] + (float) $values[ $middle ] ) / 2;
		}

		return (float) $values[ $middle ];
	}

	/**
	 * Where a value sits in a distribution, as a percentage below it.
	 *
	 * @param float   $value      Value to place.
	 * @param float[] $population Reference sample.
	 * @return int 0-100.
	 */
	public static function percentile( float $value, array $population ): int {
		if ( array() === $population ) {
			return 0;
		}

		$below = count( array_filter( $population, static fn( $item ): bool => (float) $item < $value ) );

		return (int) round( ( $below / count( $population ) ) * 100 );
	}

	/**
	 * How much weight the signal has earned.
	 *
	 * @param int $count Measured articles.
	 * @return string One of no_precedent, low, medium, high.
	 */
	public static function confidence( int $count ): string {
		foreach ( self::CONFIDENCE_BANDS as $minimum => $band ) {
			if ( $count >= $minimum ) {
				return $band;
			}
		}

		return 'no_precedent';
	}

	/**
	 * Publication date of the most recent measured match.
	 *
	 * @param array[] $measured Measured matches.
	 * @return string|null
	 */
	private static function most_recent( array $measured ): ?string {
		$dates = array_filter( array_column( $measured, 'pub_date' ) );

		if ( array() === $dates ) {
			return null;
		}

		rsort( $dates );

		return $dates[0];
	}

	/**
	 * Whether two URLs point at the same article.
	 *
	 * Compared on the final path segment — the slug — because nothing else about
	 * the URL survives a change of environment. Parse.ly reports the canonical
	 * production URL while `get_permalink()` returns whatever the current site
	 * serves, so the hosts differ; and the section can differ too, since a
	 * staging or development copy rarely carries production's exact category
	 * structure. Measured on a Sun development copy the same article was
	 * `/uk-news/39990056/family-breaks-silence…` locally and
	 * `/news/39990056/family-breaks-silence…` in Parse.ly.
	 *
	 * The slug is the one part that is stable, and comparing it is what stops a
	 * post ranking first among its own comparable articles.
	 *
	 * Two different articles could in principle share a slug under different
	 * sections. The cost if that happens is one comparable dropped from a set of
	 * five, which is a far smaller error than measuring a post against itself.
	 *
	 * @param string $left  First URL.
	 * @param string $right Second URL.
	 * @return bool
	 */
	private static function same_article( string $left, string $right ): bool {
		$left_slug  = self::url_slug( $left );
		$right_slug = self::url_slug( $right );

		return '' !== $left_slug && $left_slug === $right_slug;
	}

	/**
	 * Final path segment of a URL.
	 *
	 * @param string $url URL to reduce.
	 * @return string The slug, or '' when there isn't one.
	 */
	private static function url_slug( string $url ): string {
		$path     = (string) wp_parse_url( $url, PHP_URL_PATH );
		$segments = array_values( array_filter( explode( '/', $path ) ) );

		return (string) end( $segments );
	}

	/**
	 * Strip Parse.ly's attribution parameter from a URL.
	 *
	 * `/search` appends `itm_source=parsely-api` to everything it returns, and
	 * `/analytics/post/detail` answers with zero rows if it is left on.
	 *
	 * @param string $url Raw URL.
	 * @return string
	 */
	private static function clean_url( string $url ): string {
		return trim( remove_query_arg( 'itm_source', $url ) );
	}
}
