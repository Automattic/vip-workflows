<?php
/**
 * The maths behind the performance signal.
 *
 * These are the parts that can be wrong without anything looking broken: a
 * percentile off by one band, a confidence label that generalizes from a single
 * article, a lift figure computed from noise. Every case here is a claim the
 * signal makes to an editor.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use WorkflowParsely\PerformanceLens;
use Yoast\WPTestUtils\WPIntegration\TestCase;

class PerformanceLensTest extends TestCase {

	// ── median ───────────────────────────────────────────────────────

	public function test_median_of_odd_count_is_the_middle_value(): void {
		$this->assertSame( 96400.0, PerformanceLens::median( array( 412886, 180220, 96400, 71905, 58140 ) ) );
	}

	public function test_median_of_even_count_averages_the_middle_pair(): void {
		$this->assertSame( 138310.0, PerformanceLens::median( array( 412886, 180220, 96400, 71905 ) ) );
	}

	public function test_median_of_empty_set_is_zero_rather_than_a_warning(): void {
		$this->assertSame( 0.0, PerformanceLens::median( array() ) );
	}

	public function test_median_does_not_depend_on_input_order(): void {
		$this->assertSame(
			PerformanceLens::median( array( 5, 1, 4, 2, 3 ) ),
			PerformanceLens::median( array( 1, 2, 3, 4, 5 ) )
		);
	}

	// ── geometric mean ───────────────────────────────────────────────

	public function test_geometric_mean_of_a_clean_progression(): void {
		// 1, 10, 100 -> exp( (0 + 2.302 + 4.605) / 3 ) = 10.
		$this->assertEqualsWithDelta( 10.0, PerformanceLens::geometric_mean( array( 1, 10, 100 ) ), 0.001 );
	}

	/**
	 * The property that makes it the right statistic here: one runaway article
	 * moves it far less than it moves an arithmetic mean.
	 */
	public function test_geometric_mean_resists_a_single_outlier(): void {
		$ordinary = array( 1000, 1200, 900, 1100, 1000 );
		$spiked   = array( 1000, 1200, 900, 1100, 500000 );

		$geo_shift  = PerformanceLens::geometric_mean( $spiked ) / PerformanceLens::geometric_mean( $ordinary );
		$mean_shift = ( array_sum( $spiked ) / 5 ) / ( array_sum( $ordinary ) / 5 );

		$this->assertLessThan( 4.0, $geo_shift );
		$this->assertGreaterThan( 40.0, $mean_shift );
	}

	public function test_geometric_mean_floors_at_one_rather_than_taking_log_of_zero(): void {
		$this->assertGreaterThan( 0.0, PerformanceLens::geometric_mean( array( 0, 0, 100 ) ) );
	}

	public function test_geometric_mean_of_empty_set_is_zero(): void {
		$this->assertSame( 0.0, PerformanceLens::geometric_mean( array() ) );
	}

	// ── tiers ────────────────────────────────────────────────────────

	/**
	 * The bounds are inclusive at both ends, which is what the setting labels
	 * promise: "Tier 1 at or above", "Tier 3 at or below".
	 */
	public function test_tier_bounds_are_inclusive(): void {
		$config = PerformanceLens::get_config();

		$this->assertSame( 1, PerformanceLens::tier( 2.0, $config ) );
		$this->assertSame( 1, PerformanceLens::tier( 9.9, $config ) );
		$this->assertSame( 2, PerformanceLens::tier( 1.9, $config ) );
		$this->assertSame( 2, PerformanceLens::tier( 0.9, $config ) );
		$this->assertSame( 3, PerformanceLens::tier( 0.8, $config ) );
		$this->assertSame( 3, PerformanceLens::tier( 0.0, $config ) );
	}

	public function test_no_multiple_means_no_tier(): void {
		$this->assertNull( PerformanceLens::tier( null, PerformanceLens::get_config() ) );
	}

	/**
	 * Inverted bounds would put every result in both bands. The floor is nudged
	 * above the ceiling rather than the two being silently swapped, because
	 * inverted input is a configuration mistake and guessing at the intent hides
	 * it.
	 */
	public function test_inverted_bounds_are_separated_rather_than_swapped(): void {
		$invert = static function ( array $config ): array {
			$config['tier_1_min'] = 0.5;
			$config['tier_3_max'] = 3.0;
			return $config;
		};

		add_filter( 'workflow_parsely_performance_lens_config', $invert );

		$config = PerformanceLens::get_config();

		remove_filter( 'workflow_parsely_performance_lens_config', $invert );

		$this->assertGreaterThan( $config['tier_3_max'], $config['tier_1_min'] );
		$this->assertSame( 3, PerformanceLens::tier( 1.0, $config ) );
	}

	/**
	 * Renaming one tier must not disturb the others. The filter passes a single
	 * label and its tier number for exactly that reason.
	 */
	public function test_a_tier_label_can_be_renamed_on_its_own(): void {
		$rename = static fn( string $label, int $tier ): string => 1 === $tier ? 'Strong' : $label;

		add_filter( 'workflow_parsely_tier_label', $rename, 10, 2 );

		$one   = PerformanceLens::tier_label( 1 );
		$two   = PerformanceLens::tier_label( 2 );
		$three = PerformanceLens::tier_label( 3 );

		remove_filter( 'workflow_parsely_tier_label', $rename, 10 );

		$this->assertSame( 'Strong', $one );
		$this->assertSame( 'Tier 2', $two );
		$this->assertSame( 'Tier 3', $three );
	}

	public function test_a_thin_sample_has_no_tier_either(): void {
		$computed = PerformanceLens::calculate(
			array(
				'matches'   => array(
					array( 'value' => 100.0, 'tags' => array(), 'pub_date' => '2026-01-01' ),
				),
				'reference' => array( 50.0, 100.0, 150.0 ),
			)
		);

		$this->assertArrayNotHasKey( 'tier', $computed );
	}

	// ── percentile ───────────────────────────────────────────────────

	public function test_percentile_counts_the_share_of_the_population_below_the_value(): void {
		$population = range( 1, 100 );

		$this->assertSame( 49, PerformanceLens::percentile( 50.0, $population ) );
	}

	public function test_percentile_of_a_value_above_everything_is_100(): void {
		$this->assertSame( 100, PerformanceLens::percentile( 999.0, array( 1, 2, 3 ) ) );
	}

	public function test_percentile_of_a_value_below_everything_is_zero(): void {
		$this->assertSame( 0, PerformanceLens::percentile( 0.5, array( 1, 2, 3 ) ) );
	}

	/**
	 * An empty reference set must not silently read as "worse than everything".
	 * score() only reports a percentile when the reference set is non-empty; this
	 * pins the floor in case that guard is ever removed.
	 */
	public function test_percentile_against_an_empty_population_is_zero(): void {
		$this->assertSame( 0, PerformanceLens::percentile( 100.0, array() ) );
	}

	public function test_percentile_is_unaffected_by_reference_sample_size(): void {
		$small = array( 10, 20, 30, 40 );
		$large = array();

		foreach ( $small as $value ) {
			$large = array_merge( $large, array_fill( 0, 25, $value ) );
		}

		$this->assertSame( 75, PerformanceLens::percentile( 35.0, $small ) );
		$this->assertSame(
			75,
			PerformanceLens::percentile( 35.0, $large ),
			'A percentile against the same distribution should not move with sample size.'
		);
	}

	// ── confidence ───────────────────────────────────────────────────

	public function test_no_matches_reports_no_precedent(): void {
		$this->assertSame( 'no_precedent', PerformanceLens::confidence( 0 ) );
	}

	/**
	 * One comparable article is an anecdote, and a
	 * signal that generalizes from it is wrong in a way the reader cannot see.
	 */
	public function test_a_single_comparable_article_is_only_ever_low_confidence(): void {
		$this->assertSame( 'low', PerformanceLens::confidence( 1 ) );
	}

	public function test_confidence_rises_with_evidence(): void {
		$this->assertSame( 'medium', PerformanceLens::confidence( 2 ) );
		$this->assertSame( 'medium', PerformanceLens::confidence( 4 ) );
		$this->assertSame( 'high', PerformanceLens::confidence( 5 ) );
		$this->assertSame( 'high', PerformanceLens::confidence( 50 ) );
	}

	// ── query construction ───────────────────────────────────────────

	public function test_query_drops_stopwords_and_keeps_content_words(): void {
		$query = PerformanceLens::build_query(
			array( 'title' => 'Ofgem confirms the next quarterly energy price cap' )
		);

		$this->assertStringContainsString( 'ofgem', $query );
		$this->assertStringContainsString( 'energy', $query );
		$this->assertStringNotContainsString( ' the ', " $query " );
		$this->assertStringNotContainsString( 'confirms', $query );
	}

	/**
	 * The leading pair is quoted to anchor relevance. Without it the API ORs
	 * every term and returns anything sharing one common word.
	 */
	public function test_query_anchors_on_a_quoted_leading_bigram(): void {
		$query = PerformanceLens::build_query( array( 'title' => 'Bank of England interest rate decision' ) );

		$this->assertStringContainsString( '"bank england"', $query );
	}

	public function test_query_folds_in_tags(): void {
		$query = PerformanceLens::build_query(
			array(
				'title' => 'Ofgem price cap',
				'tags'  => array( 'cost of living' ),
			)
		);

		$this->assertStringContainsString( 'cost', $query );
		$this->assertStringContainsString( 'living', $query );
	}

	public function test_query_does_not_repeat_a_term(): void {
		$query = PerformanceLens::build_query(
			array(
				'title' => 'Energy price cap',
				'tags'  => array( 'energy' ),
			)
		);

		$terms = array_filter(
			explode( ' ', $query ),
			static fn( string $term ): bool => 'energy' === $term
		);

		$this->assertCount( 1, $terms );
	}

	public function test_a_title_of_only_stopwords_produces_no_query(): void {
		$this->assertSame( '', PerformanceLens::build_query( array( 'title' => 'and the of it' ) ) );
	}

	public function test_a_missing_title_produces_no_query(): void {
		$this->assertSame( '', PerformanceLens::build_query( array() ) );
	}

	/**
	 * score() short-circuits on an empty query rather than asking the API to
	 * search for nothing, which would match the whole archive.
	 */
	public function test_scoring_an_empty_candidate_reports_an_error_without_calling_the_api(): void {
		$result = PerformanceLens::score( array( 'title' => '' ) );

		$this->assertNotNull( $result['error'] );
		$this->assertSame( 0, $result['count'] );
		$this->assertSame( 'no_precedent', $result['confidence'] );
		$this->assertNull( $result['score'] );
	}

	// ── configuration ────────────────────────────────────────────────

	/**
	 * The defaults are load-bearing and were previously unpinned.
	 *
	 * Each of these is a value the class docblocks justify at length from live
	 * measurement — the retention bound, the relevance floor, the measurement
	 * window. Changing any of them silently changes every number the feature
	 * reports, so they are asserted rather than assumed.
	 */
	public function test_defaults_are_what_the_reasoning_assumes(): void {
		$config = PerformanceLens::get_config();

		$this->assertSame( 30, $config['match_limit'] );
		$this->assertSame( 12, $config['measure_limit'] );
		$this->assertSame( 5, $config['min_matches_to_report'] );
		$this->assertSame( 2.0, $config['tier_1_min'] );
		$this->assertSame( 0.8, $config['tier_3_max'] );
		$this->assertSame( 'views', $config['metric'] );
		$this->assertSame( 30, $config['window_days'] );
		$this->assertSame( 365, $config['lookback_days'] );
		$this->assertSame( 365, $config['retention_days'] );
		$this->assertSame( 2, $config['min_term_overlap'] );
		$this->assertSame( 5, $config['reference_days'] );
		$this->assertSame( 120, $config['reference_max_age_days'] );
	}

	public function test_an_unknown_metric_falls_back_to_the_default(): void {
		add_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_bogus_metric' ) );

		$this->assertSame( 'views', PerformanceLens::get_config()['metric'] );

		remove_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_bogus_metric' ) );
	}

	public function test_a_known_metric_is_honoured(): void {
		add_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_engaged_minutes' ) );

		$this->assertSame( 'engaged_minutes', PerformanceLens::get_config()['metric'] );

		remove_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_engaged_minutes' ) );
	}

	/**
	 * Measuring more matches than were retrieved would silently do nothing; the
	 * clamp keeps the two in step so the cost of a call is predictable.
	 */
	public function test_measure_limit_cannot_exceed_match_limit(): void {
		add_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_oversized_measure_limit' ) );

		$config = PerformanceLens::get_config();

		/*
		 * Pinned to the expected value, not to an inequality against a sibling
		 * field. Asserting only `measure_limit <= match_limit` is satisfied by a
		 * sanitizer that collapses everything to 1, so it passes through the
		 * mutation it exists to catch.
		 */
		$this->assertSame( 5, $config['match_limit'] );
		$this->assertSame( 5, $config['measure_limit'] );

		remove_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_oversized_measure_limit' ) );
	}

	/**
	 * A reference post younger than the measurement window has an incomplete
	 * window, which would drag the comparison down for everyone.
	 */
	public function test_reference_posts_are_always_older_than_the_measurement_window(): void {
		add_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_short_reference_age' ) );

		$config = PerformanceLens::get_config();

		/*
		 * Strictly older than one window, not merely as old as one. A post aged
		 * exactly `window_days` is still inside its own measurement period — its
		 * first-N-days figures finish accruing today — so its cohort is not the
		 * closed history day_cohort() caches for a month. The boundary is pinned
		 * rather than asserted as `>= window_days`, which the incomplete-window
		 * case this test exists to catch would still satisfy.
		 */
		$this->assertSame( 30, $config['window_days'] );
		$this->assertSame( 31, $config['reference_min_age_days'] );

		remove_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_short_reference_age' ) );
	}

	/**
	 * Parse.ly answers for old windows with a near-zero value rather than an
	 * error, so an unmeasurable article enters the sample as a flop. Never
	 * asking is the only safe handling.
	 */
	public function test_lookback_cannot_exceed_retention(): void {
		add_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_lookback_beyond_retention' ) );

		$this->assertSame( 365, PerformanceLens::get_config()['lookback_days'] );

		remove_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_lookback_beyond_retention' ) );
	}

	public function test_reference_days_is_bounded(): void {
		add_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_absurd_reference_days' ) );

		$this->assertSame( 30, PerformanceLens::get_config()['reference_days'] );

		remove_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_absurd_reference_days' ) );
	}

	// ── reference days ───────────────────────────────────────────────

	/**
	 * The days a comparison is measured against, for a given configuration.
	 *
	 * Private in production because nothing outside the lens picks reference days.
	 * Reached here through reflection rather than widened, because the property
	 * being pinned — that the days do not move every night — is invisible from
	 * anything public: it shows up only as cohort transients that are never reused.
	 *
	 * @param array $config Resolved configuration.
	 * @return string[]
	 */
	private function reference_days( array $config ): array {
		$method = new \ReflectionMethod( PerformanceLens::class, 'reference_days' );
		$method->setAccessible( true );

		return $method->invoke( null, $config );
	}

	/**
	 * Apply a configuration overlay for one call.
	 *
	 * @param callable $overlay Filter callback.
	 * @return array Resolved configuration.
	 */
	private function config_with( callable $overlay ): array {
		add_filter( 'workflow_parsely_performance_lens_config', $overlay );

		$config = PerformanceLens::get_config();

		remove_filter( 'workflow_parsely_performance_lens_config', $overlay );

		return $config;
	}

	/**
	 * The days are anchored to a weekly boundary rather than counted from today.
	 *
	 * Counted from today, every date moved at midnight, so all five cohort
	 * transients were cold every morning and the month-long cohort cache — which
	 * exists because a closed cohort's figures can never change — never survived a
	 * day. The expensive census was re-fetched daily for numbers already held under
	 * yesterday's key.
	 */
	public function test_reference_days_sit_on_a_weekly_grid(): void {
		$days = $this->reference_days( PerformanceLens::get_config() );

		$this->assertCount( 5, $days, 'The configured number of distinct days must still come back.' );

		$newest = strtotime( $days[0] . ' 00:00:00 UTC' );

		$this->assertSame(
			0,
			$newest % ( 7 * DAY_IN_SECONDS ),
			'The most recent reference day must land on the weekly grid, or the keys rotate nightly again.'
		);
	}

	/**
	 * The same property, stated as what it buys: the day list survives midnight.
	 *
	 * A day passing is simulated by shifting both age bounds back by one, which is
	 * exactly what tomorrow does to a range measured from today. Over seven
	 * consecutive days the grid may turn over once, so at most two distinct lists
	 * are expected — where counting from today produced seven.
	 */
	public function test_reference_days_do_not_change_at_midnight(): void {
		$lists = array();

		for ( $day = 0; $day < 7; $day++ ) {
			$shift = static function ( array $config ) use ( $day ): array {
				$config['reference_min_age_days'] = 40 - $day;
				$config['reference_max_age_days'] = 120 - $day;
				return $config;
			};

			$lists[] = implode( ',', $this->reference_days( $this->config_with( $shift ) ) );
		}

		$this->assertLessThanOrEqual(
			2,
			count( array_unique( $lists ) ),
			'A week of consecutive days may turn the grid over once, and no more.'
		);
	}

	/**
	 * Snapping moves a day older, never newer, so the newest cohort stays outside
	 * its own measurement window — and the oldest stays inside retention.
	 */
	public function test_reference_days_stay_within_their_bounds(): void {
		$config = PerformanceLens::get_config();
		$days   = $this->reference_days( $config );

		$today = strtotime( gmdate( 'Y-m-d' ) . ' 00:00:00 UTC' );

		foreach ( $days as $day ) {
			$age = (int) round( ( $today - strtotime( $day . ' 00:00:00 UTC' ) ) / DAY_IN_SECONDS );

			$this->assertGreaterThan(
				$config['window_days'],
				$age,
				'A cohort inside its own measurement window is still accruing, and would be cached as if closed.'
			);
			$this->assertLessThanOrEqual(
				$config['retention_days'],
				$age,
				'Parse.ly answers for days beyond retention with near-zero rather than an error.'
			);
		}
	}

	/**
	 * The relevance floor is what stops /search's best-effort results from being
	 * read as precedent. A floor of zero would admit everything.
	 */
	public function test_term_overlap_floor_is_at_least_one(): void {
		add_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_zero_overlap' ) );

		$this->assertSame( 1, PerformanceLens::get_config()['min_term_overlap'] );

		remove_filter( 'workflow_parsely_performance_lens_config', array( $this, 'set_zero_overlap' ) );
	}

	public function set_lookback_beyond_retention( array $config ): array {
		$config['lookback_days']  = 3000;
		$config['retention_days'] = 365;
		return $config;
	}

	public function set_absurd_reference_days( array $config ): array {
		$config['reference_days'] = 5000;
		return $config;
	}

	public function set_zero_overlap( array $config ): array {
		$config['min_term_overlap'] = 0;
		return $config;
	}

	/**
	 * A listener may return only the keys it wants to change.
	 *
	 * Three surfaces index this shape directly, so a partial return has to fold
	 * back into a complete one rather than reaching them with keys missing.
	 */
	public function test_a_partial_filter_return_keeps_the_rest_of_the_signal(): void {
		$partial = static fn( array $result, array $raw ): array => array( 'multiplier' => 42.0 );

		add_filter( 'workflow_parsely_performance_signal', $partial, 10, 2 );

		$result = PerformanceLens::score( array( 'title' => '' ) );

		remove_filter( 'workflow_parsely_performance_signal', $partial, 10 );

		$this->assertArrayHasKey( 'confidence', $result );
		$this->assertArrayHasKey( 'count', $result );
		$this->assertArrayHasKey( 'query', $result );
	}

	/**
	 * A listener returning something that is not an array leaves the signal alone.
	 */
	public function test_a_non_array_filter_return_is_ignored(): void {
		$junk = static fn( $result, $raw ) => 'not an array';

		add_filter( 'workflow_parsely_performance_signal', $junk, 10, 2 );

		$result = PerformanceLens::score( array( 'title' => '' ) );

		remove_filter( 'workflow_parsely_performance_signal', $junk, 10 );

		$this->assertIsArray( $result );
		$this->assertSame( 'no_precedent', $result['confidence'] );
	}

	/**
	 * calculate() is public so a listener can start from the default arithmetic
	 * rather than reimplementing it.
	 */
	public function test_calculate_is_callable_on_raw_material(): void {
		$computed = PerformanceLens::calculate(
			array(
				// Five, because fewer than that reports evidence without a number.
				'matches'   => array(
					array( 'value' => 100.0, 'tags' => array(), 'pub_date' => '2026-01-01' ),
					array( 'value' => 300.0, 'tags' => array(), 'pub_date' => '2026-01-02' ),
					array( 'value' => 200.0, 'tags' => array(), 'pub_date' => '2026-01-03' ),
					array( 'value' => 400.0, 'tags' => array(), 'pub_date' => '2026-01-04' ),
					array( 'value' => 500.0, 'tags' => array(), 'pub_date' => '2026-01-05' ),
				),
				'reference' => array( 50.0, 100.0, 150.0 ),
			)
		);

		$this->assertSame( 5, $computed['count'] );
		$this->assertSame( 500.0, $computed['best'] );

		// Geometric mean of 100..500 is ~261, against a census median of 100.
		$this->assertEqualsWithDelta( 260.52, $computed['typical'], 0.5 );
		$this->assertEqualsWithDelta( 2.6, $computed['multiplier'], 0.05 );
	}

	/**
	 * Below the floor there is evidence but no number.
	 *
	 * Measured by resampling real topics: ordering between them is right 80% of
	 * the time at three comparable articles and 84% at five, while the
	 * multiplier's spread at five is still wider than the value itself. So the
	 * floor exists to stop a figure being quoted that cannot carry its own
	 * precision — the matches and the count still go back.
	 */
	public function test_a_thin_sample_reports_evidence_but_no_multiplier(): void {
		$computed = PerformanceLens::calculate(
			array(
				'matches'   => array(
					array( 'value' => 100.0, 'tags' => array(), 'pub_date' => '2026-01-01' ),
					array( 'value' => 300.0, 'tags' => array(), 'pub_date' => '2026-01-02' ),
				),
				'reference' => array( 50.0, 100.0, 150.0 ),
			)
		);

		$this->assertArrayNotHasKey( 'multiplier', $computed );
		$this->assertSame( 2, $computed['count'] );
		$this->assertCount( 2, $computed['matches'] );
		$this->assertIsArray( $computed['reference'] );
	}

	public function test_the_floor_is_the_point_a_number_appears(): void {
		$rows = array();

		for ( $i = 1; $i <= 5; $i++ ) {
			$rows[] = array(
				'value'    => 100.0 * $i,
				'tags'     => array(),
				'pub_date' => '2026-01-0' . $i,
			);
		}

		$computed = PerformanceLens::calculate(
			array(
				'matches'   => $rows,
				'reference' => array( 50.0, 100.0, 150.0 ),
			)
		);

		$this->assertSame( 5, $computed['count'] );
		$this->assertEqualsWithDelta( 2.6, $computed['multiplier'], 0.05 );
	}

	public function set_bogus_metric( array $config ): array {
		$config['metric'] = 'not_a_metric';
		return $config;
	}

	public function set_engaged_minutes( array $config ): array {
		$config['metric'] = 'engaged_minutes';
		return $config;
	}

	public function set_oversized_measure_limit( array $config ): array {
		$config['match_limit']   = 5;
		$config['measure_limit'] = 40;
		return $config;
	}

	public function set_short_reference_age( array $config ): array {
		$config['window_days']            = 30;
		$config['reference_min_age_days'] = 2;
		return $config;
	}
}
