<?php
/**
 * Audience resonance and article angle, as one ideation research assistant.
 *
 * Resonance and angle were specified as two separate signals. They resolve to one
 * computation, in a way worth recording:
 *
 * `get_related_posts_with_url()` returns related articles but no metrics, and
 * metrics come from `/analytics/post/detail`. So both signals resolve to the
 * same two calls over the same set of articles, and differ only in what they say
 * about the result. Building them as two assistants would mean running that work
 * twice and putting two cards on the board sourced from one computation.
 *
 * They stay two *outputs*: resonance answers "has this landed here before, and
 * how well", angle answers "which framings did best". One card each on the mood
 * board, one API round of work behind them.
 *
 * The maths lives in PerformanceLens, which knows nothing about ideation. This
 * class turns an ideation seed into a candidate and the result into cards.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely\Abilities;

use VIPWorkflows\Abilities\Availability;
use WorkflowParsely\PerformanceLens;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Research assistant reporting how comparable past coverage performed.
 */
class PerformanceSignals {

	/**
	 * Ability id.
	 */
	public const ABILITY_ID = 'workflow-parsely/performance-signals';

	/**
	 * Register the ability.
	 *
	 * Registered through the VIP Workflows wrapper rather than core's
	 * wp_register_ability(): only the wrapper sets ability_class, and only a
	 * VIPWorkflows\Abilities\Ability consults availability_callback.
	 *
	 * Meta `type` of `research` is the entire contract for contributing to
	 * ideation — IdeationOrchestrator::get_research_abilities() selects on it,
	 * so no core change is needed.
	 */
	public static function register(): void {
		if ( ! function_exists( 'vip_workflows_register_ability' ) ) {
			return;
		}

		vip_workflows_register_ability(
			self::ABILITY_ID,
			array(
				'label'               => __( 'Past Performance', 'workflow-parsely' ),
				'description'         => __( 'How this newsroom\'s comparable past coverage performed, and which angles did best.', 'workflow-parsely' ),
				'category'            => 'research',
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'seed'          => array( 'type' => 'string' ),
						'seed_analysis' => array( 'type' => 'object' ),
						'project_id'    => array( 'type' => 'integer' ),
						'query'         => array( 'type' => 'string' ),
						'brand_context' => array( 'type' => 'array' ),
					),
					'required'   => array( 'seed' ),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'cards'   => array(
							'type'        => 'array',
							'description' => __( 'Resonance and angle cards for the mood board.', 'workflow-parsely' ),
						),
						'summary' => array(
							'type'        => 'string',
							'description' => __( 'One-line result.', 'workflow-parsely' ),
						),
					),
				),
				'execute_callback'    => array( self::class, 'execute' ),
				'permission_callback' => array( self::class, 'can_execute' ),
				'meta'                => array(
					'type'                  => 'research',
					'display_order'         => 20,
					'show_in_rest'          => true,
					'show_in_commands'      => false,
					'transition_eligible'   => false,
					'icon'                  => 'chart-bar',
					'thinking_message'      => __( 'Checking how similar stories performed...', 'workflow-parsely' ),
					'success_message'       => __( 'Found comparable coverage.', 'workflow-parsely' ),
					'annotations'           => array(
						'readonly'    => true,
						'destructive' => false,
						'idempotent'  => true,
					),
					'availability_callback' => array( self::class, 'check_availability' ),
				),
			)
		);
	}

	/**
	 * Whether Parse.ly is set up.
	 *
	 * @return bool|Availability True when configured, otherwise the unmet requirement.
	 */
	public static function check_availability(): bool|Availability {
		return \WorkflowParsely\check_availability();
	}

	/**
	 * Who may run it.
	 */
	public static function can_execute(): bool {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Score the seed and return cards for the mood board.
	 *
	 * @param array $input Ability input; requires seed.
	 * @return array{cards: array, summary: string}
	 */
	public static function execute( array $input ): array {
		$candidate = self::candidate_from_input( $input );

		if ( '' === $candidate['title'] ) {
			return array(
				'cards'   => array(),
				'summary' => __( 'No topic to look up.', 'workflow-parsely' ),
			);
		}

		$signal = PerformanceLens::score( $candidate );

		if ( null !== $signal['error'] ) {
			return array(
				'cards'   => array(),
				'summary' => $signal['error'],
			);
		}

		if ( 'no_precedent' === $signal['confidence'] ) {
			return array(
				'cards'   => array( self::no_precedent_card( $signal ) ),
				'summary' => __( 'No comparable coverage found — this would be new ground.', 'workflow-parsely' ),
			);
		}

		$cards = array( self::resonance_card( $signal ) );
		$angle = self::angle_card( $signal );

		if ( null !== $angle ) {
			$cards[] = $angle;
		}

		return array(
			'cards'   => $cards,
			'summary' => sprintf(
				/* translators: %d: number of comparable articles found. */
				_n(
					'Found %d comparable article in your archive.',
					'Found %d comparable articles in your archive.',
					$signal['count'],
					'workflow-parsely'
				),
				$signal['count']
			),
		);
	}

	/**
	 * Turn ideation input into a lens candidate.
	 *
	 * Prefers an explicit query, then the seed. Topics and entities from the
	 * seed analysis become tags, which widen the archive query without
	 * overwhelming the headline terms.
	 *
	 * @param array $input Ability input.
	 * @return array{title: string, text: string, tags: string[], section: string}
	 */
	private static function candidate_from_input( array $input ): array {
		$title = trim( (string) ( $input['query'] ?? '' ) );

		if ( '' === $title ) {
			$title = trim( (string) ( $input['seed'] ?? '' ) );
		}

		$analysis = (array) ( $input['seed_analysis'] ?? array() );

		return array(
			'title'   => $title,
			'text'    => (string) ( $input['seed'] ?? '' ),
			'tags'    => self::extract_labels( $analysis ),

			/*
			 * No section: the seed analyzer's label is not Parse.ly's
			 * vocabulary, and an unrecognized section returns zero rows rather
			 * than an error — emptying both the matches and the reference set.
			 */
			'section' => '',
		);
	}

	/**
	 * Pull topic and entity names out of a seed analysis.
	 *
	 * The analysis shape varies by producer — entities arrive as strings, as
	 * lists, or as objects with a `name` — so every form is flattened rather than
	 * assuming one.
	 *
	 * @param array $analysis Seed analysis.
	 * @return string[] Up to six labels.
	 */
	private static function extract_labels( array $analysis ): array {
		$labels = array();

		foreach ( array( 'topics', 'entities' ) as $key ) {
			foreach ( (array) ( $analysis[ $key ] ?? array() ) as $value ) {
				if ( is_string( $value ) && '' !== $value ) {
					$labels[] = $value;
					continue;
				}

				if ( is_array( $value ) ) {
					if ( isset( $value['name'] ) && is_string( $value['name'] ) ) {
						$labels[] = $value['name'];
						continue;
					}

					foreach ( $value as $item ) {
						if ( is_string( $item ) && '' !== $item ) {
							$labels[] = $item;
						}
					}
				}
			}
		}

		return array_slice( array_values( array_unique( $labels ) ), 0, 6 );
	}

	/**
	 * The resonance card: has this landed here before, and how well.
	 *
	 * Leads with absolute numbers because they can be read directly and do not
	 * move when a parameter changes. The percentile follows, with its sample
	 * named, because a number without its denominator invites the wrong reading.
	 *
	 * @param array $signal Lens result.
	 * @return array Mood board card.
	 */
	private static function resonance_card( array $signal ): array {
		$lines = array();

		/*
		 * The multiplier leads because it is the one number an editor can act on
		 * without translating anything. The absolutes follow so it can be
		 * checked, and the percentile stays in meta for anyone who wants it.
		 */
		if ( null !== $signal['multiplier'] ) {
			$lines[] = sprintf(
				/* translators: 1: multiplier, 2: metric name. */
				__( 'Comparable stories run %1$s× a typical piece on %2$s.', 'workflow-parsely' ),
				number_format_i18n( (float) $signal['multiplier'], 1 ),
				PerformanceLens::metric_label( $signal['metric'] )
			);
		}

		$lines[] = sprintf(
			/* translators: 1: number of articles, 2: metric name, 3: typical value, 4: window in days. */
			_n(
				'%1$d comparable article, %3$s %2$s in its first %4$d days.',
				'%1$d comparable articles, typically %3$s %2$s in their first %4$d days.',
				$signal['count'],
				'workflow-parsely'
			),
			$signal['count'],
			PerformanceLens::metric_label( $signal['metric'] ),
			number_format_i18n( (float) $signal['typical'] ),
			$signal['window_days']
		);

		$lines[] = sprintf(
			/* translators: 1: best value, 2: metric name. */
			__( 'Best comparable: %1$s %2$s.', 'workflow-parsely' ),
			number_format_i18n( (float) $signal['best'] ),
			PerformanceLens::metric_label( $signal['metric'] )
		);

		if ( is_array( $signal['reference'] ) ) {
			$lines[] = sprintf(
				/* translators: 1: median value, 2: metric name, 3: description of the comparison sample. */
				__( 'Typical is %1$s %2$s, measured across %3$s', 'workflow-parsely' ),
				number_format_i18n( (float) $signal['reference']['median'] ),
				PerformanceLens::metric_label( $signal['metric'] ),
				$signal['reference']['description']
			);
		}

		return array(
			'type'        => 'insight',
			'source_type' => 'insight',
			'origin'      => 'parsely-performance',
			'source'      => 'parsely-performance',
			'title'       => __( 'Audience resonance', 'workflow-parsely' ),
			'excerpt'     => implode( ' ', $lines ),
			'content'     => self::evidence_block( $signal ),
			'domain'      => 'parse.ly',
			'meta'        => array(
				'confidence' => $signal['confidence'],
				'score'      => $signal['score'],
				'multiplier' => $signal['multiplier'],
				'metric'     => $signal['metric'],
				'query'      => $signal['query'],
			),
		);
	}

	/**
	 * The angle card: which framings did best.
	 *
	 * Returns null rather than an empty card when the matched set is too small to
	 * say anything about framing. Three articles cannot establish which angle
	 * worked, and a card asserting otherwise is worse than no card.
	 *
	 * Angles are named, never quantified. The lift figures behind them come from
	 * a five-article sample; printing "1.6x" would dress noise as measurement.
	 *
	 * @param array $signal Lens result.
	 * @return array|null Mood board card, or null when there is nothing to say.
	 */
	private static function angle_card( array $signal ): ?array {
		if ( array() === $signal['angles'] || 'low' === $signal['confidence'] ) {
			return null;
		}

		$tags = array_slice( array_column( $signal['angles'], 'tag' ), 0, 3 );
		$best = $signal['matches'][0] ?? null;

		$excerpt = sprintf(
			/* translators: %s: comma-separated list of topic labels. */
			__( 'The strongest comparable pieces led on %s.', 'workflow-parsely' ),
			implode( ', ', $tags )
		);

		if ( is_array( $best ) ) {
			$excerpt .= ' ' . sprintf(
				/* translators: 1: headline, 2: value, 3: metric name. */
				__( 'Best performer: "%1$s" — %2$s %3$s.', 'workflow-parsely' ),
				$best['title'],
				number_format_i18n( (float) $best['value'] ),
				PerformanceLens::metric_label( $signal['metric'] )
			);
		}

		return array(
			'type'        => 'insight',
			'source_type' => 'insight',
			'origin'      => 'parsely-performance',
			'source'      => 'parsely-performance',
			'title'       => __( 'Angles that landed', 'workflow-parsely' ),
			'excerpt'     => $excerpt,
			'content'     => self::evidence_block( $signal ),
			'url'         => is_array( $best ) ? $best['url'] : '',
			'domain'      => 'parse.ly',
			'meta'        => array(
				'confidence' => $signal['confidence'],
				'angles'     => $signal['angles'],
				'query'      => $signal['query'],
			),
		);
	}

	/**
	 * The card shown when the archive has nothing comparable.
	 *
	 * An explicit finding, not a failure — knowing the newsroom has never covered
	 * this is useful, and it is the honest answer for genuinely new ground.
	 *
	 * @param array $signal Lens result.
	 * @return array Mood board card.
	 */
	private static function no_precedent_card( array $signal ): array {
		return array(
			'type'        => 'insight',
			'source_type' => 'insight',
			'origin'      => 'parsely-performance',
			'source'      => 'parsely-performance',
			'title'       => __( 'No precedent', 'workflow-parsely' ),
			'excerpt'     => __( 'No comparable coverage found in the archive, so there is no performance history to judge this against. That may make it genuinely new ground.', 'workflow-parsely' ),
			'content'     => sprintf(
				/* translators: %s: the search query used. */
				__( 'Searched the archive for: %s', 'workflow-parsely' ),
				$signal['query']
			),
			'domain'      => 'parse.ly',
			'meta'        => array(
				'confidence' => 'no_precedent',
				'query'      => $signal['query'],
			),
		);
	}

	/**
	 * The evidence, as text the editor can check.
	 *
	 * Every card carries this. A signal an editor cannot audit will be either
	 * believed blindly or ignored, and both are worse than one they can argue
	 * with.
	 *
	 * @param array $signal Lens result.
	 * @return string
	 */
	private static function evidence_block( array $signal ): string {
		$lines = array();

		foreach ( $signal['matches'] as $match ) {
			$lines[] = sprintf(
				'%s — %s %s (%s)',
				$match['title'],
				number_format_i18n( (float) $match['value'] ),
				PerformanceLens::metric_label( $signal['metric'] ),
				substr( $match['pub_date'], 0, 10 )
			);
		}

		$lines[] = '';
		$lines[] = sprintf(
			/* translators: %s: the search query used. */
			__( 'Archive query: %s', 'workflow-parsely' ),
			$signal['query']
		);

		if ( is_array( $signal['reference'] ) ) {
			$lines[] = sprintf(
				/* translators: %s: description of the comparison sample. */
				__( 'Compared against: %s', 'workflow-parsely' ),
				$signal['reference']['description']
			);
		}

		return implode( "\n", $lines );
	}
}
