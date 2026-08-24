<?php
/**
 * The performance signal as a tool and as a transition check.
 *
 * Same lens as the ideation assistant, different question. PerformanceSignals
 * asks "is this topic worth writing" against a seed; this asks "how does this
 * draft compare to what we have run before" against an actual post, and can be
 * reached three ways:
 *
 * - From the command palette, on demand, while writing.
 * - Attached to a transition, as a check before a post advances.
 * - By an agent, since it is an ordinary ability.
 *
 * IT REPORTS A BAND, NOT A NUMBER
 * -------------------------------
 * The comparison is expressed as one of three tiers, whose bounds are set on this
 * tool and used by every surface that shows the signal. Bands are what the
 * measurement supports: ordering between topics is reliable while the underlying
 * multiple's own spread is about as wide as the multiple, so "clearly above" and
 * "clearly below" survive that uncertainty and a decimal does not. A band is also
 * much harder to mistake for a target.
 *
 * IT SOFT-GATES ONLY ON A TRANSITION
 * -----------------------------------
 * No tier blocks a transition outright, and this check never returns a hard
 * failure on its own. But every outcome — a tier, "no precedent", or "still
 * being gathered" — IS a soft warning when the run came from a transition: the
 * point of comparing a draft against its own history is that someone weighs
 * it before the post moves, and a result nobody sees is not a judgment call,
 * it is a number nobody read. So a transition that names this tool always
 * stops on it, carrying the comparison as the warning's own message, and the
 * editor chooses Continue or Cancel. Every other caller — the command
 * palette, an agent, a direct call — gets the same result with `issues`
 * empty: the person is already looking straight at the answer there, so
 * there is nothing left to gate.
 *
 * IT NEVER STALLS A TRANSITION
 * ----------------------------
 * The comparison is expensive — a search, a measurement call per comparable
 * article, and a census call per reference day — and cold it takes tens of
 * seconds. That is time well spent when an editor asked for it and is
 * watching the spinner; it is not time an editor should wait just to be
 * offered a Continue button.
 *
 * So on a transition this reads its cache and nothing else: a hit gives the
 * real verdict as the warning, a miss queues a background warm and warns
 * `not_yet_computed` immediately rather than making the transition wait for
 * it. Every other caller computes, and leaves the answer in the cache for the
 * next transition to find already warm.
 *
 * IT NEVER HARD-BLOCKS ON ITS OWN
 * --------------------------------
 * The tier describes how comparable coverage performed in the past; it says
 * nothing about whether this story should run. Plenty of necessary journalism
 * lands in the weakest band — an obligation to cover, a court result, a
 * correction — so this reports and lets a person decide, rather than
 * enforcing a floor no number here can justify. A newsroom that wants a hard
 * floor should build it deliberately as its own check.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely\Abilities;

use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\AbilityExecutor;
use VIPWorkflow\Abilities\AbilitySettings;
use WorkflowParsely\PerformanceLens;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Compares a post against how similar past coverage performed.
 */
class PerformanceCheck {

	/**
	 * Ability id.
	 */
	public const ABILITY_ID = 'workflow-parsely/performance-check';

	/**
	 * Cron hook that computes the comparisons a transition asked for.
	 */
	public const WARM_HOOK = 'workflow_parsely_warm_performance_checks';

	/**
	 * The executor context that means "a transition is waiting on this".
	 */
	private const TRANSITION_CONTEXT = 'transition';

	/**
	 * How long a computed comparison stays usable.
	 *
	 * A day, as for discovery prompts: the archive it is measured against barely
	 * moves, and the key already carries the headline and tags, so the editing that
	 * would change the answer invalidates it directly rather than waiting for this.
	 */
	private const SIGNAL_TTL = DAY_IN_SECONDS;

	/**
	 * Where the posts waiting to be compared are kept.
	 *
	 * One non-autoloaded option keyed by post id, drained by an argument-free
	 * event — the same arrangement PromptScorer uses, and for the same reason: an
	 * event scheduled with a payload only matches arguments that serialize
	 * identically, so a per-post payload would schedule one event per transition
	 * instead of recognizing the one already waiting.
	 */
	private const QUEUE_OPTION = 'workflow_parsely_performance_check_queue';

	/**
	 * Posts compared per scheduled run.
	 *
	 * Two, because one comparison is tens of API calls. The run reschedules itself
	 * while any remain, so the queue still drains without a further transition.
	 */
	private const WARM_BATCH = 2;

	/**
	 * Most posts the queue will hold.
	 *
	 * Reached only by something transitioning posts in bulk. Anything dropped is
	 * queued again by the next transition that finds no cached comparison.
	 */
	private const QUEUE_LIMIT = 200;

	/**
	 * Seconds between a post being queued and the run that compares it.
	 */
	private const WARM_DELAY = 30;

	/**
	 * Register the ability.
	 */
	public static function register(): void {
		if ( ! function_exists( 'vip_workflow_register_ability' ) ) {
			return;
		}

		vip_workflow_register_ability(
			self::ABILITY_ID,
			array(
				'label'               => __( 'Compare to past performance', 'workflow-parsely' ),
				'description'         => __( 'Compare this post with how similar stories performed, using Parse.ly.', 'workflow-parsely' ),
				'category'            => 'vip-workflow',
				'input_schema'        => array(
					'type'                 => 'object',
					'additionalProperties' => false,
					'properties'           => array(
						'post_id'    => array(
							'type'        => 'integer',
							'description' => __( 'The post to compare.', 'workflow-parsely' ),
						),

						/*
						 * The tier bounds are declared here as well as in
						 * settings_schema because the executor merges an ability's
						 * saved settings into its input before the input is validated.
						 * A bound declared only as a setting becomes an undeclared
						 * input the moment it is saved, and every run then fails
						 * validation against additionalProperties.
						 */
						'tier_1_min' => array(
							'type'        => 'number',
							'description' => __( 'Multiple at or above which comparable coverage counts as Tier 1.', 'workflow-parsely' ),
							'minimum'     => 0.1,
							'maximum'     => 20,
						),
						'tier_3_max' => array(
							'type'        => 'number',
							'description' => __( 'Multiple at or below which comparable coverage counts as Tier 3.', 'workflow-parsely' ),
							'minimum'     => 0,
							'maximum'     => 20,
						),
					),
					'required'             => array( 'post_id' ),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'passed'      => array( 'type' => 'boolean' ),
						'status'      => array( 'type' => 'string' ),

						/*
						 * The machine-readable outcome. `status` is always "pass"
						 * because this check never gates, so this is the only field
						 * that distinguishes one result from another.
						 */
						'detail'      => array(
							'type'        => 'string',
							'enum'        => array( 'skipped', 'not_yet_computed', 'no_precedent', 'informational', 'tier_1', 'tier_2', 'tier_3', 'tier_none' ),
							'description' => __( 'Which outcome this is: no headline yet, the comparison still being gathered, no comparable coverage, evidence without a comparison, or the tier the comparison landed in.', 'workflow-parsely' ),
						),
						'issues'      => array(
							'type'        => 'array',
							'description' => __( 'Empty outside a transition. On a transition this always carries one soft warning naming the comparison, so an editor sees it and chooses whether to continue.', 'workflow-parsely' ),
						),
						'summary'     => array( 'type' => 'string' ),
						'count'       => array(
							'type'        => 'integer',
							'description' => __( 'How many comparable articles the result rests on.', 'workflow-parsely' ),
						),
						'multiplier'  => array( 'type' => array( 'number', 'null' ) ),
						'confidence'  => array( 'type' => 'string' ),
						'suggestions' => array(
							'type'        => 'array',
							'description' => __( 'Comparable articles and what they did.', 'workflow-parsely' ),
						),
					),
				),
				'execute_callback'    => array( self::class, 'execute' ),
				'permission_callback' => array( self::class, 'can_execute' ),
				'meta'                => array(
					'type'                  => 'check',

					/* Comparable articles and what each of them did. */
					'result_type'           => 'list',

					/*
					 * The tier bounds are set here and used everywhere. This tool
					 * is where an editor meets the comparison directly, so it is
					 * the honest home for deciding what counts as strong — and one
					 * place to set it beats the same two numbers on three screens.
					 * See register_config_bridge() for how they reach the lens.
					 */
					'settings_schema'       => array(
						'tier_1_min' => array(
							'type'        => 'number',
							'default'     => 2.0,
							'label'       => __( 'Tier 1 at or above', 'workflow-parsely' ),
							'description' => __( 'Comparable coverage at or above this multiple of a typical story counts as Tier 1.', 'workflow-parsely' ),
							'minimum'     => 0.1,
							'maximum'     => 20,
						),
						'tier_3_max' => array(
							'type'        => 'number',
							'default'     => 0.8,
							'label'       => __( 'Tier 3 at or below', 'workflow-parsely' ),
							'description' => __( 'Comparable coverage at or below this multiple counts as Tier 3. Everything between the two is Tier 2.', 'workflow-parsely' ),
							'minimum'     => 0,
							'maximum'     => 20,
						),
					),
					'supports'              => array( 'workflow' ),
					'show_in_rest'          => true,

					// The command palette surface.
					'show_in_commands'      => true,
					'transition_eligible'   => true,
					'icon'                  => 'chart-bar',
					'thinking_message'      => __( 'Comparing with past performance...', 'workflow-parsely' ),
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
	 * Make this tool's tier bounds the ones the lens uses.
	 *
	 * The settings live on the ability because that is where they are set, and
	 * the computation lives in the lens because that is where the multiple is.
	 * This filter is the join, and it is the reason the stream's sections and
	 * this tool's verdict can never disagree about what Tier 1 means.
	 */
	public static function register_config_bridge(): void {
		add_filter( 'workflow_parsely_performance_lens_config', array( self::class, 'apply_tier_settings' ) );
	}

	/**
	 * Overlay the stored tier bounds onto the lens configuration.
	 *
	 * @param array $config Lens configuration.
	 * @return array
	 */
	public static function apply_tier_settings( array $config ): array {
		if ( ! class_exists( AbilitySettings::class ) ) {
			return $config;
		}

		$options = AbilitySettings::get_instance()->get_options( self::ABILITY_ID );

		foreach ( array( 'tier_1_min', 'tier_3_max' ) as $key ) {
			if ( isset( $options[ $key ] ) && is_numeric( $options[ $key ] ) ) {
				$config[ $key ] = (float) $options[ $key ];
			}
		}

		return $config;
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
	 *
	 * Authorized against the post the run actually reads, not against posts in
	 * general: execute() sends that post's headline, excerpt, tags and permalink
	 * to Parse.ly, so `edit_posts` alone would let any contributor read out a
	 * colleague's unpublished draft.
	 *
	 * @param array $input Ability input; requires post_id.
	 * @return bool|WP_Error True when allowed, otherwise why not.
	 */
	public static function can_execute( array $input ): bool|WP_Error {
		$post_id = (int) ( $input['post_id'] ?? 0 );

		if ( $post_id <= 0 ) {
			return new WP_Error(
				'workflow_parsely_missing_post_id',
				__( 'A post ID is required.', 'workflow-parsely' )
			);
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error(
				'workflow_parsely_permission_denied',
				__( 'You do not have permission to compare this post.', 'workflow-parsely' )
			);
		}

		return true;
	}

	/**
	 * Compare a post with comparable past coverage.
	 *
	 * Computes for a caller that is waiting on the answer, and reads cache only for
	 * a transition, which is not. See the class docblock for why the two surfaces
	 * are answered differently, and AbilityExecutor::execute() for how the surface
	 * reaches an ability without passing through its input schema.
	 *
	 * @param array $input Ability input; requires post_id.
	 * @return array|WP_Error
	 */
	public static function execute( array $input ): array|WP_Error {
		$post_id = (int) ( $input['post_id'] ?? 0 );
		$post    = $post_id > 0 ? get_post( $post_id ) : null;

		if ( ! $post instanceof \WP_Post ) {
			return new WP_Error(
				'workflow_parsely_post_not_found',
				__( 'That post could not be found.', 'workflow-parsely' )
			);
		}

		$title = trim( (string) $post->post_title );

		/*
		 * An untitled draft is the normal state of a post a minute after it is
		 * created, so this is an ordinary outcome rather than a failure — and it
		 * passes, because there is nothing to judge yet.
		 */
		if ( '' === $title ) {
			return array(
				'passed'      => true,
				'status'      => 'pass',
				'detail'      => 'skipped',
				'issues'      => array(),
				'summary'     => __( 'No headline yet, so there is nothing to compare.', 'workflow-parsely' ),
				'count'       => 0,
				'multiplier'  => null,
				'confidence'  => 'no_precedent',
				'suggestions' => array(),
			);
		}

		$candidate = self::candidate_from_post( $post );
		$cache_key = self::cache_key( $post, $candidate );

		if ( self::TRANSITION_CONTEXT === AbilityExecutor::current_context() ) {
			$cached = get_transient( $cache_key );

			if ( is_array( $cached ) ) {
				return self::gate( self::verdict( $cached ) );
			}

			self::queue_warm( $post->ID );

			return self::gate( self::pending_verdict() );
		}

		$signal = PerformanceLens::score( $candidate );

		if ( null !== $signal['error'] ) {
			return new WP_Error( 'workflow_parsely_lookup_failed', $signal['error'] );
		}

		/*
		 * Cached on the way out, which is what makes the transition surface
		 * useful: an editor who ran the tool while writing has already paid for the
		 * comparison the transition would otherwise have had to wait for.
		 */
		set_transient( $cache_key, $signal, self::SIGNAL_TTL );

		return self::verdict( $signal );
	}

	/**
	 * Turn a report-only verdict into the soft warning a transition gates on.
	 *
	 * `passed` stays true and `status` stays `pass` — this still never returns
	 * a hard failure on its own — but `issues` picks up the same summary a
	 * direct caller would just read off the screen. That is the only change
	 * that matters: `run_transition_tools()` reads nothing from a required
	 * tool except `issues`, so this is what makes the comparison reach an
	 * editor moving a post, where every other verdict shape already reaches
	 * one sitting in the command palette.
	 *
	 * `check_key` gives the warning a stable identity while the issue itself
	 * remains soft.
	 *
	 * @param array $result Verdict shape from verdict()/pending_verdict().
	 * @return array The same shape, with `issues` carrying one soft warning.
	 */
	private static function gate( array $result ): array {
		$result['issues'] = array(
			array(
				'check_key' => 'performance_comparison',
				'severity'  => 'soft',
				'message'   => $result['summary'],
			),
		);

		return $result;
	}

	/**
	 * Register the background warmer.
	 *
	 * Not on an abilities hook, for the same reason register_config_bridge() is
	 * not: the drain runs from cron, nowhere near ability registration.
	 */
	public static function register_warmer(): void {
		add_action( self::WARM_HOOK, array( self::class, 'warm' ) );
	}

	/**
	 * Compute the comparisons queued by transitions, and cache them.
	 *
	 * The batch is taken off the queue and the queue saved before any scoring, so a
	 * run that dies partway through does not leave its posts queued forever. Any
	 * post lost that way is simply uncached, and the next transition queues it
	 * again.
	 */
	public static function warm(): void {
		$queue = self::queue();
		$batch = array_slice( $queue, 0, self::WARM_BATCH, true );

		foreach ( array_keys( $batch ) as $post_id ) {
			unset( $queue[ $post_id ] );
		}

		self::save_queue( $queue );

		foreach ( $batch as $post_id ) {
			self::warm_post( (int) $post_id );
		}

		// Carry the rest forward rather than waiting for another transition.
		if ( array() !== $queue ) {
			self::schedule_drain();
		}
	}

	/**
	 * Compute and cache one post's comparison.
	 *
	 * @param int $post_id Post to compare.
	 */
	private static function warm_post( int $post_id ): void {
		$post = get_post( $post_id );

		/*
		 * The post can be deleted between the transition that queued it and this
		 * run. That is an ordinary race rather than missing data, and there is
		 * nothing left to compare.
		 */
		if ( ! $post instanceof \WP_Post || '' === trim( (string) $post->post_title ) ) {
			return;
		}

		$candidate = self::candidate_from_post( $post );
		$cache_key = self::cache_key( $post, $candidate );

		// Another run, or the editor running the tool by hand, may have got there first.
		if ( is_array( get_transient( $cache_key ) ) ) {
			return;
		}

		$signal = PerformanceLens::score( $candidate );

		/*
		 * A failed lookup is not cached. It summarizes to the same shape as a
		 * genuine no-precedent result, so storing one would tell an editor the
		 * newsroom has never covered this — a positive editorial claim — on the
		 * strength of one 502. The next transition reports the comparison as still
		 * being gathered and queues it again, which is bounded because only a
		 * person moving a post can queue anything.
		 */
		if ( null !== $signal['error'] ) {
			return;
		}

		set_transient( $cache_key, $signal, self::SIGNAL_TTL );
	}

	/**
	 * Add a post to the queue and make sure something is coming to drain it.
	 *
	 * @param int $post_id Post to compare.
	 */
	private static function queue_warm( int $post_id ): void {
		$queue = self::queue();

		if ( isset( $queue[ $post_id ] ) ) {
			return;
		}

		if ( count( $queue ) >= self::QUEUE_LIMIT ) {
			return;
		}

		$queue[ $post_id ] = $post_id;

		self::save_queue( $queue );
		self::schedule_drain();
	}

	/**
	 * Ensure exactly one drain event is in flight.
	 */
	private static function schedule_drain(): void {
		if ( false !== wp_next_scheduled( self::WARM_HOOK ) ) {
			return;
		}

		wp_schedule_single_event( time() + self::WARM_DELAY, self::WARM_HOOK );
	}

	/**
	 * Posts waiting to be compared, keyed by post id.
	 *
	 * @return array<int, int>
	 */
	private static function queue(): array {
		$queue = get_option( self::QUEUE_OPTION, array() );

		return is_array( $queue ) ? $queue : array();
	}

	/**
	 * Persist the queue, removing the option entirely once it is empty.
	 *
	 * Never autoloaded: only the two paths that touch it ever read it.
	 *
	 * @param array<int, int> $queue The queue.
	 */
	private static function save_queue( array $queue ): void {
		if ( array() === $queue ) {
			delete_option( self::QUEUE_OPTION );
			return;
		}

		update_option( self::QUEUE_OPTION, $queue, false );
	}

	/**
	 * Cache key for a post's comparison.
	 *
	 * Keyed on everything that decides the answer — the post, its headline, its
	 * tags, and the metric and window the lens is configured for — so editing the
	 * headline invalidates the comparison of the old one rather than reporting it
	 * against the new. Built the way PromptScorer builds its key, for the same
	 * reason: one convention across the two things that cache a lens result.
	 *
	 * @param \WP_Post $post      The post.
	 * @param array    $candidate The candidate derived from it.
	 * @return string
	 */
	private static function cache_key( \WP_Post $post, array $candidate ): string {
		$config = PerformanceLens::get_config();

		return 'wf_parsely_check_' . md5(
			(string) wp_json_encode(
				array(
					$post->ID,
					strtolower( (string) $candidate['title'] ),
					$candidate['tags'],
					$config['metric'],
					$config['window_days'],
				)
			)
		);
	}

	/**
	 * The answer a transition gets while the comparison is still being gathered.
	 *
	 * Passes, like every other branch, and carries no multiplier: there is nothing
	 * to report yet, and a null is what every surface already renders as "no
	 * comparison" rather than as a weak one.
	 *
	 * @return array
	 */
	private static function pending_verdict(): array {
		return array(
			'passed'      => true,
			'status'      => 'pass',
			'detail'      => 'not_yet_computed',
			'issues'      => array(),
			'summary'     => __( 'The comparison with past performance is still being gathered and will be ready shortly.', 'workflow-parsely' ),
			'count'       => 0,
			'multiplier'  => null,
			'confidence'  => 'no_precedent',
			'suggestions' => array(),
		);
	}

	/**
	 * Turn a post into a lens candidate.
	 *
	 * Tags come from the post's own terms, which is what makes this work on a
	 * draft with a thin headline: "Bank rate decision" alone is a weak query,
	 * the same post tagged Money and interest rates is not.
	 *
	 * @param \WP_Post $post The post.
	 * @return array{title: string, text: string, tags: string[], section: string}
	 */
	private static function candidate_from_post( \WP_Post $post ): array {
		$tags = wp_get_post_terms( $post->ID, 'post_tag', array( 'fields' => 'names' ) );

		return array(
			'title'       => (string) $post->post_title,
			'text'        => (string) $post->post_excerpt,
			'tags'        => is_wp_error( $tags ) ? array() : array_slice( $tags, 0, 6 ),

			/*
			 * No section.
			 *
			 * Parse.ly's section filter recognizes only the vocabulary Parse.ly
			 * itself recorded, and a WordPress category name is not guaranteed
			 * to be one — "Sport" against "Sports", or the default
			 * "Uncategorized", match nothing and return zero rows rather than an
			 * error. Because the section scopes both the match query and the
			 * reference census, a near-miss empties both and the check reports
			 * "no comparable coverage" for a beat the paper runs daily.
			 *
			 * Searching the whole archive is less precise and honest. Restoring
			 * this needs a verified mapping from term to Parse.ly section, not
			 * the raw name.
			 */
			'section'     => '',

			/*
			 * Keep the post out of its own comparison. A published post is the
			 * strongest keyword match for its own headline, so without this it
			 * ranks first among its "comparable" articles and is measured
			 * against itself.
			 */
			'exclude_url' => (string) get_permalink( $post ),
		);
	}

	/**
	 * Turn a signal into a pass/fail with a readable summary.
	 *
	 * @param array $signal Lens result.
	 * @return array
	 */
	private static function verdict( array $signal ): array {

		if ( 'no_precedent' === $signal['confidence'] ) {
			return array(
				'passed'      => true,
				'status'      => 'pass',
				'detail'      => 'no_precedent',
				'issues'      => array(),
				'summary'     => __( 'No comparable coverage in the archive, so there is no performance history to compare against. This may be new ground.', 'workflow-parsely' ),
				'count'       => 0,
				'multiplier'  => null,
				'confidence'  => 'no_precedent',
				'suggestions' => array(),
			);
		}

		$multiplier = $signal['multiplier'];

		/*
		 * A signal with no multiplier still has evidence worth showing — it just
		 * has no comparison to express it against, usually because the reference
		 * cohorts have not been gathered yet.
		 */
		if ( null === $multiplier ) {
			return array(
				'passed'      => true,
				'status'      => 'pass',
				'detail'      => 'informational',
				'issues'      => array(),
				'summary'     => self::evidence_summary( $signal ),
				'count'       => (int) $signal['count'],
				'multiplier'  => null,
				'confidence'  => $signal['confidence'],
				'suggestions' => self::suggestions( $signal ),
			);
		}

		$tier = $signal['tier'] ?? null;

		return array(
			'passed'      => true,
			'status'      => 'pass',
			'detail'      => 'tier_' . ( null === $tier ? 'none' : $tier ),

			/*
			 * Always empty, deliberately.
			 *
			 * `issues` is the only field the transition gate reads, so an empty
			 * array is what makes this report rather than gate. It is returned
			 * rather than omitted so the shape stays stable for anything that
			 * indexes it.
			 */
			'issues'      => array(),
			'summary'     => sprintf(
				/* translators: 1: tier name, 2: metric name, 3: supporting evidence. */
				__( 'Comparable coverage is %1$s on %2$s. %3$s', 'workflow-parsely' ),
				PerformanceLens::tier_label( $tier ),
				PerformanceLens::metric_label( $signal['metric'] ),
				self::evidence_summary( $signal )
			),
			'count'       => (int) $signal['count'],
			'multiplier'  => $multiplier,
			'confidence'  => $signal['confidence'],
			'suggestions' => self::suggestions( $signal ),
		);
	}

	/**
	 * The comparable articles, as display strings.
	 *
	 * Keyed `suggestions` because that is what the editor's result modal renders
	 * from — an ability returning only structured data shows an empty modal.
	 *
	 * @param array $signal Lens result.
	 * @return string[]
	 */
	private static function suggestions( array $signal ): array {
		$rendered = array();

		foreach ( $signal['matches'] as $match ) {
			$rendered[] = sprintf(
				/* translators: 1: headline, 2: value, 3: metric name, 4: date. */
				__( '"%1$s" — %2$s %3$s (%4$s)', 'workflow-parsely' ),
				$match['title'],
				number_format_i18n( (float) $match['value'] ),
				PerformanceLens::metric_label( $signal['metric'] ),
				substr( (string) $match['pub_date'], 0, 10 )
			);
		}

		return $rendered;
	}

	/**
	 * One line describing what the comparison rests on.
	 *
	 * @param array $signal Lens result.
	 * @return string
	 */
	private static function evidence_summary( array $signal ): string {
		return sprintf(
			/* translators: 1: article count, 2: median value, 3: metric name, 4: window in days. */
			_n(
				'Based on %1$d comparable article, %2$s %3$s in its first %4$d days.',
				'Based on %1$d comparable articles, typically %2$s %3$s in their first %4$d days.',
				$signal['count'],
				'workflow-parsely'
			),
			$signal['count'],
			number_format_i18n( (float) $signal['typical'] ),
			PerformanceLens::metric_label( $signal['metric'] ),
			$signal['window_days']
		);
	}
}
