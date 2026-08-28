<?php
/**
 * Plugin Name: Workflow Agent: Tag Sanity Check
 * Description: Stage-capable agent that flags questionable post tags.
 * Version: 1.0.0
 * Author: WordPress VIP
 * Author URI: https://wpvip.com
 * Requires Plugins: vip-workflows
 * Text Domain: workflow-agent-tag-sanity-check
 *
 * @package WorkflowAgentTagSanityCheck
 */

declare( strict_types=1 );

namespace WorkflowAgentTagSanityCheck;

use VIPWorkflow\Abilities\Agents\StageAgent;
use VIPWorkflow\Abilities\AiAvailability;
use VIPWorkflow\Abilities\Availability;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'vip_workflow_register_abilities', __NAMESPACE__ . '\register' );
add_action( 'vip_workflow_register_assistant_meta', __NAMESPACE__ . '\register_agent_meta' );

/**
 * Register the tag sanity-check stage agent ability.
 *
 * @return void
 */
function register(): void {
	if ( ! function_exists( 'vip_workflow_register_ability' ) || ! class_exists( StageAgent::class ) ) {
		return;
	}

	vip_workflow_register_ability(
		'workflow-agent-tag-sanity-check/tag-sanity-check',
		array(
			'label'               => __( 'Tag Sanity Check', 'workflow-agent-tag-sanity-check' ),
			'description'         => __( "Checks that a post's tags make sense for its content. Does not modify tags.", 'workflow-agent-tag-sanity-check' ),
			'category'            => 'vip-workflow',
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'post_id' ),
				'properties'           => array(
					'post_id' => array(
						'type'        => 'integer',
						'description' => __( 'The post ID whose tags to check.', 'workflow-agent-tag-sanity-check' ),
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
						'description' => __( 'Questionable tags for human review.', 'workflow-agent-tag-sanity-check' ),
					),
				),
			),
			'execute_callback'    => __NAMESPACE__ . '\execute',
			'permission_callback' => __NAMESPACE__ . '\can_execute',
			'meta'                => array(
				'show_in_rest'          => true,
				'show_in_commands'      => false,
				'transition_eligible'   => false,
				'icon'                  => 'tag',
				'type'                  => 'agent',
				'availability_callback' => __NAMESPACE__ . '\check_availability',
				'supports'              => array( 'workflow', 'stage' ),
				'stage_eligible'        => true,
				'annotations'           => array(
					'readonly'    => true,
					'destructive' => false,
					'idempotent'  => true,
				),
			),
		)
	);
}

/**
 * Register unified Agents tab metadata.
 *
 * @param object $registry Assistant registry.
 * @return void
 */
function register_agent_meta( $registry ): void {
	$registry->register(
		'workflow-agent-tag-sanity-check',
		array(
			'label'        => __( 'Tag Sanity Check', 'workflow-agent-tag-sanity-check' ),
			'description'  => __( "Checks that a post's tags make sense for its content. Does not modify tags.", 'workflow-agent-tag-sanity-check' ),
			'icon'         => 'tag',
			'ability_ids'  => array( 'workflow-agent-tag-sanity-check/tag-sanity-check' ),
			'capabilities' => array( 'stage' ),
		)
	);
}

/**
 * Execute the tag sanity-check agent.
 *
 * @param array|null $input Input parameters.
 * @return array|\WP_Error Result contract or error.
 */
function execute( ?array $input = null ) {
	$input   = $input ?? array();
	$post_id = (int) ( $input['post_id'] ?? 0 );

	if ( ! $post_id ) {
		return new \WP_Error( 'missing_post_id', __( 'A post_id is required.', 'workflow-agent-tag-sanity-check' ) );
	}

	$post = StageAgent::read_post( $post_id );
	if ( is_wp_error( $post ) ) {
		return $post;
	}

	$tags = wp_get_post_terms( $post_id, 'post_tag', array( 'fields' => 'names' ) );
	if ( is_wp_error( $tags ) ) {
		return $tags;
	}

	if ( empty( $tags ) ) {
		return StageAgent::result( 'fail', __( 'No tags are assigned to this post.', 'workflow-agent-tag-sanity-check' ), array( 'issues' => array() ) );
	}

	$token = StageAgent::verdict_token();

	$prompt = sprintf(
		"You are an editorial taxonomist. Judge whether a post's tags make sense for its content.\n\n" .
		"ARTICLE TITLE: %s\n\nTAGS: %s\n\n%s\n\n" .
		"Rules:\n" .
		"- If every tag is relevant and sensible, reply with exactly: %s\n" .
		"- Otherwise list each questionable tag on its own line, prefixed with '- ', with a short reason.",
		$post['title'],
		implode( ', ', $tags ),
		StageAgent::wrap_untrusted( $post['content'], 'post body' ),
		$token
	);

	// Tag sanity is mechanical, so this stage used to pin temperature to 0 and
	// promise the same problems flagged on every run. It no longer can: the models
	// this plugin runs against reject the option outright, and the AI Client's
	// metadata does not reliably say which ones, so no temperature is requested
	// anywhere. The same tags against the same content may now flag differently.

	/*
	 * The reply is short — a pass token, or one line per questionable tag — but the
	 * reasoning is not, and the whole article body is in the prompt for the model to
	 * reason over. That made 800 the most exposed ceiling of the four: reasoning on
	 * the comparable whole-article checks measured ~3,900-4,000 tokens against
	 * claude-sonnet-5 and did not scale down with the size of the answer, so this
	 * stage could never have completed. 6,000 clears the measured figure by ~1.5x.
	 * Sized from those measurements rather than its own, because the reproduction
	 * post carries no tags and this stage returns before calling the model.
	 */
	$response = StageAgent::generate( $prompt, 6000 );
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	if ( StageAgent::is_verdict( $response, $token ) ) {
		return StageAgent::result( 'pass', __( 'All tags look sensible.', 'workflow-agent-tag-sanity-check' ), array( 'issues' => array() ) );
	}

	$issues = StageAgent::parse_issue_lines( $response );

	return StageAgent::result(
		'fail',
		sprintf(
			/* translators: %d: number of questionable tags. */
			_n( 'Flagged %d tag for review.', 'Flagged %d tags for review.', count( $issues ), 'workflow-agent-tag-sanity-check' ),
			count( $issues )
		),
		array( 'issues' => $issues )
	);
}

/**
 * Whether AI text generation is configured for this agent.
 *
 * Asks about the admin-selected provider, because `StageAgent::generate()`
 * resolves its model through `AiInference`. Without this the agent presented as
 * working on an unconfigured site and failed only once a post reached the stage.
 *
 * @since 0.0.1
 *
 * @return bool|Availability True when generation is configured, otherwise the unmet requirements.
 */
function check_availability(): bool|Availability {
	return AiAvailability::for_selected_provider( array( __( 'Tag Sanity Check', 'workflow-agent-tag-sanity-check' ) ) );
}

/**
 * Permission callback.
 *
 * Scoped to the post the agent will act on. The read path enforces this too,
 * but the callback is what core's abilities endpoint, WP-CLI and MCP consult,
 * so it states the rule rather than inheriting it from a helper it does not
 * name.
 *
 * @param  array $input Ability input.
 * @return bool|\WP_Error
 */
function can_execute( array $input ): bool|\WP_Error {
	if ( empty( $input['post_id'] ) ) {
		return new \WP_Error(
			'missing_post_id',
			__( 'Post ID is required.', 'workflow-agent-tag-sanity-check' )
		);
	}

	$permission_error = \VIPWorkflow\Abilities\Tools\require_post_edit_permission( (int) $input['post_id'] );
	if ( $permission_error ) {
		return $permission_error;
	}

	return true;
}
