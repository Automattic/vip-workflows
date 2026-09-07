<?php
/**
 * Smart Linking as a stage agent.
 *
 * The helper ability answers "show me what I could link". This answers "is this
 * post linked well enough to advance", and says so by leaving editorial notes on
 * the blocks rather than by editing the post.
 *
 * Annotating instead of inserting is the whole design, not a limitation worked
 * around. Parse.ly returns an anchor phrase and a destination but no usable
 * position — every `offset` observed against the live API came back `0` — so
 * inserting would mean matching the phrase inside block markup, skipping
 * existing anchors and tags, and resolving overlapping suggestions ("headline
 * testing" inside "Parse.ly and headline testing"). Getting any of that subtly
 * wrong corrupts someone's article. A note on the block carries the same
 * information, is reviewable before anything changes, and can be resolved.
 *
 * "Does not edit the post" means the prose. StageAgent does write to
 * post_content, adding a `noteId` attribute to the block a note anchors to —
 * that is how the note knows where it belongs. The words a reader sees are
 * untouched, and no link is ever inserted.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely\Agents;

use VIPWorkflows\Abilities\Agents\StageAgent;
use VIPWorkflows\Abilities\Availability;
use WorkflowParsely\Abilities\SmartLinking;
use WorkflowParsely\ParselyClient;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Flags internal links a post could carry, as editorial notes.
 */
class SmartLinkingAgent {

	/**
	 * Ability id.
	 */
	public const ABILITY_ID = 'workflow-parsely/smart-linking-check';

	/**
	 * Comment-meta key tagging this agent's notes.
	 *
	 * Distinct per agent so `interactive_notes()` reads back only its own, and a
	 * writer resolving a Smart Linking note does not silence a fact-check one.
	 */
	public const NOTE_MARKER = 'workflow_parsely_smart_link_note';

	/**
	 * Human label prefixed to each note.
	 */
	private const LABEL = 'Smart Linking';

	/**
	 * Register the agent.
	 */
	public static function register(): void {
		if ( ! function_exists( 'vip_workflows_register_ability' ) || ! class_exists( StageAgent::class ) ) {
			return;
		}

		vip_workflows_register_ability(
			self::ABILITY_ID,
			array(
				'label'               => __( 'Smart Linking Check', 'workflow-parsely' ),
				'description'         => __( 'Flags internal links this post could carry, as editorial notes on the blocks where they belong.', 'workflow-parsely' ),
				'category'            => 'vip-workflows',
				'input_schema'        => array(
					'type'                 => 'object',
					'additionalProperties' => false,
					'required'             => array( 'post_id' ),
					'properties'           => array(
						'post_id' => array(
							'type'        => 'integer',
							'description' => __( 'The post to check.', 'workflow-parsely' ),
						),
					),
				),
				'output_schema'       => array(
					'type'                 => 'object',
					'additionalProperties' => false,
					'required'             => array( 'status', 'summary' ),
					'properties'           => array(
						'status'  => array(
							'type' => 'string',
							'enum' => array( 'pass', 'fail' ),
						),
						'summary' => array( 'type' => 'string' ),
						'issues'  => array(
							'type'        => 'array',
							'description' => __( 'Suggested links awaiting editorial review.', 'workflow-parsely' ),
						),
					),
				),
				'execute_callback'    => array( self::class, 'execute' ),
				'permission_callback' => array( self::class, 'can_execute' ),
				'meta'                => array(
					'show_in_rest'          => true,
					'show_in_commands'      => false,
					'icon'                  => 'link',
					'type'                  => 'agent',
					'display_order'         => 40,
					'supports'              => array( 'workflow', 'stage' ),
					'stage_eligible'        => true,

					/*
					 * Transition-eligible, unlike the helper ability: this one
					 * returns a pass/fail verdict, which is exactly what a gate
					 * needs. Whether a failure warns or blocks is left to the
					 * per-option check mode, so a site can run it advisory
					 * before making it binding.
					 */
					'transition_eligible'   => true,
					'annotations'           => array(

						/*
						 * Not readonly: it writes editorial notes, and anchors
						 * them by adding a `noteId` to the block. Not
						 * destructive: notes are additive and resolvable, and
						 * the prose is never edited — no link is inserted and
						 * no word changes.
						 */
						'readonly'    => false,
						'destructive' => false,
						'idempotent'  => false,
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
	 * Scoped to the post the agent will act on. The read path enforces this too,
	 * but the callback is what core's abilities endpoint, WP-CLI and MCP consult,
	 * so it states the rule rather than inheriting it from a helper it does not
	 * name.
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
	 * Check a post and annotate it.
	 *
	 * @param array $input Agent input; requires post_id.
	 * @return array|WP_Error Verdict, or an error.
	 */
	public static function execute( array $input ): array|WP_Error {
		$post_id = (int) ( $input['post_id'] ?? 0 );

		if ( $post_id <= 0 ) {
			return new WP_Error(
				'workflow_parsely_missing_post_id',
				__( 'A post_id is required.', 'workflow-parsely' )
			);
		}

		$post = StageAgent::read_post( $post_id );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		$content = trim( (string) $post['content'] );

		if ( '' === $content ) {
			return StageAgent::result(
				'pass',
				__( 'The post is empty, so there is nothing to link.', 'workflow-parsely' )
			);
		}

		$service = ParselyClient::suggestions();

		if ( $service instanceof WP_Error ) {
			return $service;
		}

		$links     = $service->get_smart_links( $content );
		$suggested = array();

		if ( $links instanceof WP_Error ) {
			/*
			 * NO_LINKS is the clean pass — Parse.ly looked and found nothing
			 * worth linking. Every other code, NO_DATA included, stays an
			 * error: a gate that reports "pass" because it could not reach its
			 * data would wave posts through on an outage. See the helper
			 * ability for why NO_DATA in particular is ambiguous.
			 */
			$code = $links->get_error_code();

			if ( SmartLinking::NO_DATA_CODE === $code ) {
				/*
				 * Same wording the helper ability gives, not Parse.ly's raw
				 * "check data availability" — which a stage failure surfaced
				 * verbatim to editors before this.
				 */
				return SmartLinking::no_related_content_error();
			}

			if ( SmartLinking::NO_LINKS_CODE !== $code ) {
				return $links;
			}
		} else {
			$suggested = (array) $links;
		}

		$numbered = StageAgent::number_blocks( parse_blocks( $post['content'] ) );

		$issue_map = self::map_to_blocks( $suggested, $numbered );

		$issues = array();
		foreach ( $issue_map as $block_issues ) {
			foreach ( $block_issues as $issue ) {
				$issues[] = $issue;
			}
		}

		$count = count( $issues );

		$summary_note = 0 === $count
			? __( 'No additional internal links suggested.', 'workflow-parsely' )
			: null;

		$written = StageAgent::write_block_notes(
			$post_id,
			$issue_map,
			$summary_note,
			$post['modified'],
			self::NOTE_MARKER,
			self::LABEL
		);

		if ( is_wp_error( $written ) ) {
			return $written;
		}

		if ( 0 === $count ) {
			return StageAgent::result(
				'pass',
				__( 'No additional internal links suggested.', 'workflow-parsely' )
			);
		}

		return StageAgent::result(
			'fail',
			sprintf(
				/* translators: %d: number of suggested links. */
				_n(
					'%d suggested internal link left as a note for review.',
					'%d suggested internal links left as notes for review.',
					$count,
					'workflow-parsely'
				),
				$count
			),
			array( 'issues' => $issues )
		);
	}

	/**
	 * Map each suggested link to the block whose text carries its anchor.
	 *
	 * Matching on the rendered text rather than a position, because Parse.ly
	 * supplies no usable offset. A phrase appearing in more than one block
	 * anchors to the first — the note names the phrase, so a reader can tell
	 * immediately if it landed on the wrong paragraph, which is the failure
	 * mode worth accepting here.
	 *
	 * An anchor matching no block still gets a note on the first block rather
	 * than being dropped. A suggestion the editor never sees is worse than one
	 * attached slightly off.
	 *
	 * @param array $links    Smart_Link objects from wp-parsely.
	 * @param array $numbered Output of StageAgent::number_blocks().
	 * @return array<int, array<int, string>> Block number => note strings.
	 */
	private static function map_to_blocks( array $links, array $numbered ): array {
		$issue_map = array();
		$fallback  = $numbered ? (int) $numbered[0]['number'] : 1;

		foreach ( $links as $link ) {
			$data = is_object( $link ) && method_exists( $link, 'to_array' )
				? $link->to_array()
				: (array) $link;

			$text = trim( (string) ( $data['text'] ?? '' ) );

			if ( '' === $text ) {
				continue;
			}

			$href = $data['href'] ?? '';
			if ( is_array( $href ) ) {
				$href = $href['raw'] ?? '';
			}

			$number = $fallback;
			foreach ( $numbered as $entry ) {
				if ( false !== stripos( (string) $entry['text'], $text ) ) {
					$number = (int) $entry['number'];
					break;
				}
			}

			$issue_map[ $number ][] = sprintf(
				/* translators: 1: anchor phrase, 2: destination URL. */
				__( 'Consider linking "%1$s" to %2$s', 'workflow-parsely' ),
				$text,
				(string) $href
			);
		}

		return $issue_map;
	}
}
