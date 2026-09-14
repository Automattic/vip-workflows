<?php
/**
 * Smart Linking as a Workflow ability.
 *
 * Picking the links is wp-parsely's job. This class does nothing but hand it
 * content and shape what comes back into the result format the rest of Workflow
 * understands.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely\Abilities;

use VIPWorkflows\Abilities\Availability;
use WorkflowParsely\ParselyClient;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Suggests internal links for a post using wp-parsely's Smart Linking.
 */
class SmartLinking {

	/**
	 * Ability id.
	 */
	public const ABILITY_ID = 'workflow-parsely/smart-linking';

	/**
	 * The Parse.ly error code meaning "no suitable link", not "something broke".
	 */
	public const NO_LINKS_CODE = 'NO_LINKS';

	/**
	 * The Parse.ly error code meaning "no data for this". Ambiguous — see execute().
	 */
	public const NO_DATA_CODE = 'NO_DATA';

	/**
	 * How long a set of suggestions stays usable.
	 *
	 * A day, matching PerformanceCheck: the archive the suggestions are drawn
	 * from barely moves, and the key already carries the body, so the editing
	 * that would change the answer invalidates it directly rather than waiting
	 * for this to expire.
	 */
	private const SUGGESTIONS_TTL = DAY_IN_SECONDS;

	/**
	 * Register the ability.
	 *
	 * Registered through the VIP Workflows wrapper rather than core's
	 * wp_register_ability(): only the wrapper sets ability_class, and only a
	 * VIPWorkflows\Abilities\Ability consults availability_callback. Registering
	 * through core would leave this ability presenting as usable with no
	 * Parse.ly credentials configured.
	 */
	public static function register(): void {
		if ( ! function_exists( 'vip_workflows_register_ability' ) ) {
			return;
		}

		vip_workflows_register_ability(
			self::ABILITY_ID,
			array(
				'label'               => __( 'Smart Linking', 'workflow-parsely' ),
				'description'         => __( 'Suggest internal links for a post using Parse.ly Smart Linking.', 'workflow-parsely' ),
				'category'            => 'vip-workflows',
				'input_schema'        => array(
					'type'                 => 'object',
					'additionalProperties' => false,
					'properties'           => array(
						'post_id' => array(
							'type'        => 'integer',
							'description' => __( 'The post to suggest links for.', 'workflow-parsely' ),
						),
					),
					'required'             => array( 'post_id' ),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'links'       => array(
							'type'        => 'array',
							'description' => __( 'Suggested links, each with the anchor text and destination.', 'workflow-parsely' ),
						),
						'count'       => array(
							'type'        => 'integer',
							'description' => __( 'How many links were suggested.', 'workflow-parsely' ),
						),
						'suggestions' => array(
							'type'        => 'array',
							'description' => __( 'The same links as display strings, for the editor to list.', 'workflow-parsely' ),
						),
						'summary'     => array(
							'type'        => 'string',
							'description' => __( 'One-line result, also stored as the result row summary.', 'workflow-parsely' ),
						),
					),
				),
				'execute_callback'    => array( self::class, 'execute' ),
				'permission_callback' => array( self::class, 'can_execute' ),
				'meta'                => array(
					'show_in_rest'          => true,
					'show_in_commands'      => true,
					'icon'                  => 'link',
					'type'                  => 'helper',
					/* Suggested links, each pointing at a destination. See skills/create-tool/SKILL.md. */
					'result_type'           => 'list',
					'supports'              => array( 'workflow' ),

					/*
					 * Not transition-eligible. A tool attached to a transition
					 * answers "may this post advance?", and this one returns a
					 * list of suggestions with no verdict for a gate to read.
					 *
					 * The gate machinery is not what is missing: AbilitySettings
					 * already implements soft and hard checks, per option key,
					 * and would apply here for free. What is missing is the
					 * decision about what counts as a failure — zero links, or a
					 * configurable minimum in the shape workflow-tool-minimum-pins
					 * uses for pinned sources. Until that exists, marking this
					 * eligible would put a gate in the sequence editor with
					 * nothing behind it to evaluate.
					 *
					 * `false` in meta is also the stronger statement rather than
					 * a default: the admin's "Can be used in transitions" toggle
					 * only renders when meta is true, so this cannot be switched
					 * on per-site until the ability genuinely reports a verdict.
					 */
					'transition_eligible'   => false,
					'annotations'           => array(

						/*
						 * Suggests only — nothing is written to the post.
						 * Inserting the links belongs to the stage version,
						 * which is where a destructive annotation would be
						 * honest.
						 */
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
	 * The reader-facing version of Parse.ly's NO_DATA.
	 *
	 * Shared with the stage agent so one wording reaches the editor from either
	 * path. Parse.ly's own "check data availability" means nothing to someone
	 * writing a post, and the agent leaked it verbatim into a stage failure
	 * before this was pulled out here.
	 *
	 * Carries no error data, deliberately. AbilityExecutor converts a WP_Error
	 * whose data is an array into a *success* result, so attaching even a
	 * debugging breadcrumb turns this failure into a success carrying that
	 * breadcrumb as its output — which renders as an empty modal.
	 *
	 * @return WP_Error
	 */
	public static function no_related_content_error(): WP_Error {
		return new WP_Error(
			'workflow_parsely_no_related_content',
			__( 'Parse.ly has no related content for this topic yet, so there is nothing to link to. If every post reports this, check the Site ID and API Secret under Settings → Parse.ly.', 'workflow-parsely' )
		);
	}

	/**
	 * Whether Parse.ly is set up for this ability.
	 *
	 * Delegates to the plugin-wide check so every Parse.ly capability reports
	 * the same requirement and the Agents card renders one row, not one per
	 * ability.
	 *
	 * @return bool|Availability True when configured, otherwise the unmet requirement.
	 */
	public static function check_availability(): bool|Availability {
		return \WorkflowParsely\check_suggestions_availability();
	}

	/**
	 * Who may run it.
	 *
	 * Scoped to the named post rather than the global `edit_posts` capability.
	 * This ability reads the post body and sends it to Parse.ly, so a caller who
	 * may edit *a* post but not *this* one would cross both the object boundary
	 * and the vendor boundary. `execute()` does not repeat the check — this is
	 * the whole gate.
	 *
	 * @param  array $input Ability input.
	 * @return bool|WP_Error
	 */
	public static function can_execute( array $input ): bool|WP_Error {
		if ( empty( $input['post_id'] ) ) {
			return new WP_Error(
				'workflow_parsely_missing_post_id',
				__( 'A post_id is required.', 'workflow-parsely' )
			);
		}

		$permission_error = \VIPWorkflows\Abilities\Tools\require_post_edit_permission( (int) $input['post_id'] );
		if ( $permission_error ) {
			return $permission_error;
		}

		return true;
	}

	/**
	 * Suggest links for a post.
	 *
	 * @param array $input Ability input; requires post_id.
	 * @return array|WP_Error Links and count, or an error.
	 */
	public static function execute( array $input ): array|WP_Error {
		$post_id = (int) ( $input['post_id'] ?? 0 );

		if ( $post_id <= 0 ) {
			return new WP_Error(
				'workflow_parsely_missing_post_id',
				__( 'A post_id is required to suggest smart links.', 'workflow-parsely' )
			);
		}

		$post = get_post( $post_id );

		if ( ! $post instanceof \WP_Post ) {
			return new WP_Error(
				'workflow_parsely_post_not_found',
				sprintf(
					/* translators: %d: post ID. */
					__( 'Post %d does not exist.', 'workflow-parsely' ),
					$post_id
				)
			);
		}

		$content = trim( (string) $post->post_content );

		/*
		 * Short-circuit before the network. An empty body has nothing to link,
		 * and Parse.ly would charge a round trip to tell us so.
		 */
		if ( '' === $content ) {
			return array(
				'links' => array(),
				'count' => 0,
			);
		}

		/*
		 * Every caller pays for this, so it is cached here rather than in each
		 * of them. Measured against the live API, the request is essentially the
		 * whole cost of asking: ~14s of a 14.5s call on an article the account
		 * has coverage for, against 4-7ms for everything this plugin does with
		 * the answer. It is also not proportional to the article — a longer post
		 * the account knows nothing about came back in under a second, while a
		 * short one on a well-covered topic took fifteen. The work is Parse.ly
		 * ranking candidates, so the better the match, the longer the wait.
		 *
		 * Uncached, a single editorial pass pays that repeatedly: a check on a
		 * transition, a caller applying what it found, and the check again on the
		 * next move are three identical requests for one editorial action.
		 */
		$cache_key = self::cache_key( $post_id, $content );
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$service = ParselyClient::suggestions();

		if ( $service instanceof WP_Error ) {
			return $service;
		}

		$links = $service->get_smart_links( $content );

		if ( $links instanceof WP_Error ) {
			/*
			 * "Nothing worth linking here" arrives as an error, not an empty
			 * array. Verified against the live API: a passage with no suitable
			 * destination returns WP_Error( 'NO_LINKS' ). That is an ordinary
			 * outcome for a post on an unfamiliar topic, so reporting it as a
			 * failed tool would cry wolf on healthy content.
			 *
			 * Only this one code is treated as benign. The list is not
			 * enumerable from wp-parsely's source — the code originates at the
			 * remote API and is passed straight through — so widening it would
			 * mean guessing, and guessing here risks swallowing a real failure.
			 */
			if ( self::NO_LINKS_CODE === $links->get_error_code() ) {
				// A determinate answer, and worth keeping: "nothing to link here"
				// costs a full round trip to establish, every time.
				return self::cache( $cache_key, self::result( array() ) );
			}

			/*
			 * NO_DATA is deliberately NOT folded into the empty result above,
			 * even though it often means the same thing to a writer.
			 *
			 * It is ambiguous in a way NO_LINKS is not. Parse.ly returns it both
			 * when a site genuinely has no coverage of the topic — ordinary, and
			 * common on a new beat — and when it has no usable data for the site
			 * at all, which is what a wrong Site ID or an untracked domain looks
			 * like. Reporting "0 links found" for the second case would hide a
			 * broken setup behind a healthy-looking answer.
			 *
			 * So it stays an error, but not Parse.ly's raw one: "check data
			 * availability" means nothing to someone writing a post. The message
			 * below has to serve both readings at once, which is why it names
			 * the ordinary cause first and the setup cause as the thing to check
			 * if it never stops happening.
			 */
			if ( self::NO_DATA_CODE === $links->get_error_code() ) {
				return self::no_related_content_error();
			}

			return $links;
		}

		$shaped = array();

		foreach ( (array) $links as $link ) {
			$shaped[] = self::shape_link( $link );
		}

		return self::cache( $cache_key, self::result( $shaped ) );
	}

	/**
	 * Cache key for a post's suggestions.
	 *
	 * Keyed on everything that decides the answer: the post, the body actually
	 * sent, and the Site ID whose archive the suggestions are drawn from. Editing
	 * the post therefore invalidates its own suggestions directly rather than
	 * waiting for the TTL, and pointing the site at a different Parse.ly account
	 * cannot serve that account's answers for this one.
	 *
	 * Built the way PerformanceCheck builds its key, for the same reason: one
	 * convention across the things that cache a Parse.ly result.
	 *
	 * @param  int    $post_id Post ID.
	 * @param  string $content The body sent to Parse.ly.
	 * @return string
	 */
	private static function cache_key( int $post_id, string $content ): string {
		$options = function_exists( 'get_option' ) ? (array) get_option( 'parsely', array() ) : array();

		return 'wf_parsely_links_' . md5(
			(string) wp_json_encode(
				array(
					$post_id,
					$content,
					(string) ( $options['apikey'] ?? '' ),
				)
			)
		);
	}

	/**
	 * Store a determinate result, and return it.
	 *
	 * Only determinate outcomes reach here — a set of suggestions, or Parse.ly
	 * saying there is nothing worth linking. Failures are deliberately not
	 * cached: `NO_DATA` is ambiguous between "no coverage of this topic" and "the
	 * Site ID is wrong", and a transport error says nothing about the article at
	 * all. Keeping either would turn a passing outage into a day of wrong
	 * answers, which is the opposite of what a cache is for.
	 *
	 * @param  string               $key    Cache key.
	 * @param  array<string, mixed> $result The result to keep.
	 * @return array<string, mixed>
	 */
	private static function cache( string $key, array $result ): array {
		set_transient( $key, $result, self::SUGGESTIONS_TTL );

		return $result;
	}

	/**
	 * Build the ability result from shaped links.
	 *
	 * Carries the same links three ways because three different consumers read
	 * this, and giving them one shape served none of them well:
	 *
	 * - `links` is the structured record. An agent calling this ability needs
	 *   the anchor text and destination as data, not as a sentence.
	 * - `suggestions` is what the editor renders: label, destination and href per
	 *   row. An ability returning only `links` renders an empty modal, which is
	 *   exactly what shipped before this.
	 * - `summary` is the one-line answer, and is also what AbilityResult stores
	 *   as the row's summary for the audit trail.
	 *
	 * @param array $links Shaped links.
	 * @return array{links: array, count: int, suggestions: array, summary: string}
	 */
	private static function result( array $links ): array {
		/*
		 * The richer row shape the editor renders: the phrase to link as the
		 * value, and where it goes as secondary text linked to the destination.
		 *
		 * Previously this flattened both into '"phrase" → https://…', which put
		 * five wrapped raw URLs in front of the reader. A destination is context
		 * for the choice, not the choice itself, so it reads as a page title and
		 * carries the URL behind it. Falls back to the URL when Parse.ly gives no
		 * title, since some destination is better than none.
		 */
		$suggestions = array_map(
			static function ( array $link ): array {
				return array(
					'label' => $link['text'],
					'meta'  => '' !== $link['title'] ? $link['title'] : $link['href'],
					'href'  => $link['href'],
				);
			},
			$links
		);

		$count = count( $links );

		return array(
			'links'       => $links,
			'count'       => $count,
			'suggestions' => $suggestions,
			'summary'     => 0 === $count
				? __( 'No suitable internal links were found for this post.', 'workflow-parsely' )
				: sprintf(
					/* translators: %d: number of suggested links. */
					_n( '%d suggested internal link.', '%d suggested internal links.', $count, 'workflow-parsely' ),
					$count
				),
		);
	}

	/**
	 * Reduce a wp-parsely Smart_Link to the fields Workflow surfaces.
	 *
	 * Deliberately narrow. Smart_Link::to_array() also carries offsets, source
	 * and destination post ids, applied state and smart-link ids — all of which
	 * matter to wp-parsely's own editor UI and none of which a suggestion list
	 * needs. Passing the whole structure through would make this adapter's
	 * output contract wp-parsely's to change.
	 *
	 * @param mixed $link A Smart_Link (or anything exposing to_array()).
	 * @return array{text: string, href: string, title: string}
	 */
	private static function shape_link( $link ): array {
		$data = is_object( $link ) && method_exists( $link, 'to_array' )
			? $link->to_array()
			: (array) $link;

		$href = $data['href'] ?? '';

		// href is array{raw, itm} on a Smart_Link; itm carries campaign params.
		if ( is_array( $href ) ) {
			$href = $href['raw'] ?? '';
		}

		return array(
			'text'  => (string) ( $data['text'] ?? '' ),
			'href'  => (string) $href,
			'title' => (string) ( $data['title'] ?? '' ),
		);
	}
}
