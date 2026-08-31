<?php
/**
 * Headline suggestions from Parse.ly.
 *
 * Suggestions, not scoring. Parse.ly's suggestion endpoint is generative — it
 * takes a persona and a style and writes alternatives — and returns plain
 * strings with no rating attached. Its headline A/B results, which do carry
 * click and CTR figures, live behind a feature wp-parsely only injects as a
 * front-end script; there is no way to read them from another plugin. So this
 * offers a writer better options rather than grading the headline they have.
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
 * Suggests alternative headlines for a post.
 */
class HeadlineSuggestions {

	/**
	 * Ability id.
	 */
	public const ABILITY_ID = 'workflow-parsely/headline-suggestions';

	/**
	 * Parse.ly's own defaults, restated so the settings UI has something to show
	 * and so a stored blank falls back to the same thing the API would pick.
	 */
	private const DEFAULT_PERSONA   = 'journalist';
	private const DEFAULT_STYLE     = 'neutral';
	private const DEFAULT_MAX_ITEMS = 5;

	/**
	 * Register the ability.
	 */
	public static function register(): void {
		if ( ! function_exists( 'vip_workflows_register_ability' ) ) {
			return;
		}

		vip_workflows_register_ability(
			self::ABILITY_ID,
			array(
				'label'               => __( 'Headline Suggestions', 'workflow-parsely' ),
				'description'         => __( 'Suggest alternative headlines for a post using Parse.ly.', 'workflow-parsely' ),
				'category'            => 'vip-workflows',
				'input_schema'        => array(
					'type'                 => 'object',
					'additionalProperties' => false,
					'required'             => array( 'post_id' ),
					'properties'           => array(
						'post_id'   => array(
							'type'        => 'integer',
							'description' => __( 'The post to suggest headlines for.', 'workflow-parsely' ),
						),
						'persona'   => array(
							'type'        => 'string',
							'description' => __( 'Voice to write in.', 'workflow-parsely' ),
						),
						'style'     => array(
							'type'        => 'string',
							'description' => __( 'Tone to aim for.', 'workflow-parsely' ),
						),
						'max_items' => array(
							'type'        => 'integer',
							'description' => __( 'How many headlines to ask for.', 'workflow-parsely' ),
						),
					),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'suggestions' => array(
							'type'        => 'array',
							'description' => __( 'Suggested headlines, as plain strings.', 'workflow-parsely' ),
						),
						'count'       => array(
							'type'        => 'integer',
							'description' => __( 'How many headlines were suggested.', 'workflow-parsely' ),
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

					/*
					 * A writer reaches for this while working on the headline, so
					 * the command palette is the surface that matters.
					 */
					'show_in_commands'      => true,
					'icon'                  => 'typography',
					'type'                  => 'helper',
					/* Several alternatives, chosen from per row. See skills/create-tool/SKILL.md. */
					'result_type'           => 'list',
					'display_order'         => 45,

					/*
					 * The post title. This is what turns the listed suggestions
					 * into something a writer can use: the modal offers an apply
					 * action per suggestion only when a tool names a field, and
					 * without it the list is read-only text they would retype.
					 */
					'apply_field'           => 'title',
					'supports'              => array( 'workflow' ),

					/*
					 * Not transition-eligible, for the same reason as the Smart
					 * Linking helper: a list of alternatives carries no pass or
					 * fail, so a gate would have nothing to evaluate. Making
					 * headline quality a gate would need a verdict Parse.ly does
					 * not give us.
					 */
					'transition_eligible'   => false,
					'annotations'           => array(

						/*
						 * Reads the post and writes nothing. Not idempotent: the
						 * suggestions are generated, so two runs on identical
						 * content legitimately differ.
						 */
						'readonly'    => true,
						'destructive' => false,
						'idempotent'  => false,
					),
					'settings_schema'       => array(
						'persona'   => array(
							'type'        => 'string',
							'default'     => self::DEFAULT_PERSONA,
							'label'       => __( 'Persona', 'workflow-parsely' ),
							'description' => __( 'The voice Parse.ly writes in.', 'workflow-parsely' ),
						),
						'style'     => array(
							'type'        => 'string',
							'default'     => self::DEFAULT_STYLE,
							'label'       => __( 'Style', 'workflow-parsely' ),
							'description' => __( 'The tone to aim for.', 'workflow-parsely' ),
						),
						'max_items' => array(
							'type'        => 'integer',
							'default'     => self::DEFAULT_MAX_ITEMS,
							'label'       => __( 'Suggestions per run', 'workflow-parsely' ),
							'description' => __( 'How many headlines to ask for.', 'workflow-parsely' ),
							'minimum'     => 1,
							'maximum'     => 10,
						),
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
	 * Suggest headlines for a post.
	 *
	 * @param array $input Ability input; requires post_id.
	 * @return array|WP_Error Suggestions and a summary, or an error.
	 */
	public static function execute( array $input ): array|WP_Error {
		$post_id = (int) ( $input['post_id'] ?? 0 );

		if ( $post_id <= 0 ) {
			return new WP_Error(
				'workflow_parsely_missing_post_id',
				__( 'A post_id is required to suggest headlines.', 'workflow-parsely' )
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
		 * A headline is suggested from the body, so an empty body has nothing to
		 * work from. Short-circuit rather than pay a round trip to be told so.
		 */
		if ( '' === $content ) {
			return self::result( array() );
		}

		$service = ParselyClient::suggestions();

		if ( $service instanceof WP_Error ) {
			return $service;
		}

		$suggestions = $service->get_title_suggestions(
			$content,
			array(
				'persona'   => (string) ( $input['persona'] ?? self::DEFAULT_PERSONA ),
				'style'     => (string) ( $input['style'] ?? self::DEFAULT_STYLE ),
				'max_items' => (int) ( $input['max_items'] ?? self::DEFAULT_MAX_ITEMS ),
			)
		);

		if ( $suggestions instanceof WP_Error ) {
			return $suggestions;
		}

		return self::result( (array) $suggestions );
	}

	/**
	 * Build the ability result.
	 *
	 * Keeps only non-empty strings. Parse.ly returns plain strings today, and
	 * anything else reaching the editor would render as a stringified array or
	 * an object id — worse than being dropped, because it looks like a headline
	 * someone could pick.
	 *
	 * @param array $suggestions Raw suggestions from Parse.ly.
	 * @return array{suggestions: array, count: int, summary: string}
	 */
	private static function result( array $suggestions ): array {
		$clean = array();

		foreach ( $suggestions as $suggestion ) {
			if ( ! is_string( $suggestion ) ) {
				continue;
			}

			$suggestion = trim( $suggestion );

			if ( '' !== $suggestion ) {
				$clean[] = $suggestion;
			}
		}

		$count = count( $clean );

		return array(
			'suggestions' => $clean,
			'count'       => $count,
			'summary'     => 0 === $count
				? __( 'Parse.ly suggested no alternative headlines for this post.', 'workflow-parsely' )
				: sprintf(
					/* translators: %d: number of suggested headlines. */
					_n( '%d suggested headline.', '%d suggested headlines.', $count, 'workflow-parsely' ),
					$count
				),
		);
	}
}
