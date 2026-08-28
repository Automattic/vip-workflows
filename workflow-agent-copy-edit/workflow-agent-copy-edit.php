<?php
/**
 * Plugin Name: Workflow Agent: Copy Edit
 * Description: Stage-capable agent that copy-edits posts and saves revisions.
 * Version: 1.0.0
 * Author: WordPress VIP
 * Author URI: https://wpvip.com
 * Requires Plugins: vip-workflows
 * Text Domain: workflow-agent-copy-edit
 *
 * @package WorkflowAgentCopyEdit
 */

declare( strict_types=1 );

namespace WorkflowAgentCopyEdit;

use VIPWorkflow\Abilities\Agents\StageAgent;
use VIPWorkflow\Abilities\AiAvailability;
use VIPWorkflow\Abilities\Availability;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'vip_workflow_register_abilities', __NAMESPACE__ . '\register' );
add_action( 'vip_workflow_register_assistant_meta', __NAMESPACE__ . '\register_agent_meta' );

/**
 * Register the copy-edit stage agent ability.
 *
 * @return void
 */
function register(): void {
	if ( ! function_exists( 'vip_workflow_register_ability' ) || ! class_exists( StageAgent::class ) ) {
		return;
	}

	vip_workflow_register_ability(
		'workflow-agent-copy-edit/copy-edit',
		array(
			'label'               => __( 'Copy Edit', 'workflow-agent-copy-edit' ),
			'description'         => __( 'Copy-edits a post body for grammar, spelling, and style, saving changes as a revision.', 'workflow-agent-copy-edit' ),
			'category'            => 'vip-workflow',
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'post_id' ),
				'properties'           => array(
					'post_id' => array(
						'type'        => 'integer',
						'description' => __( 'The post ID to copy-edit.', 'workflow-agent-copy-edit' ),
					),
					'style'   => array(
						'type'        => 'string',
						'description' => __( 'Description of the target house style.', 'workflow-agent-copy-edit' ),
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
				),
			),
			'execute_callback'    => __NAMESPACE__ . '\execute',
			'permission_callback' => __NAMESPACE__ . '\can_execute',
			'meta'                => array(
				'show_in_rest'          => true,
				'show_in_commands'      => false,
				'transition_eligible'   => false,
				'icon'                  => 'pencil',
				'type'                  => 'agent',
				'availability_callback' => __NAMESPACE__ . '\check_availability',
				'supports'              => array( 'workflow', 'stage' ),
				'stage_eligible'        => true,
				'settings_schema'       => array(
					'style' => array(
						'type'        => 'string',
						'default'     => '',
						'label'       => __( 'House style', 'workflow-agent-copy-edit' ),
						'description' => __( 'Describe the copy style the agent should enforce.', 'workflow-agent-copy-edit' ),
					),
				),
				'annotations'           => array(
					'readonly'    => false,
					'destructive' => false,
					'idempotent'  => false,
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
		'workflow-agent-copy-edit',
		array(
			'label'        => __( 'Copy Edit', 'workflow-agent-copy-edit' ),
			'description'  => __( 'Copy-edits a post body for grammar, spelling, and style, saving changes as a revision.', 'workflow-agent-copy-edit' ),
			'icon'         => 'pencil',
			'ability_ids'  => array( 'workflow-agent-copy-edit/copy-edit' ),
			'capabilities' => array( 'stage' ),
		)
	);
}

/**
 * Execute the copy-edit agent.
 *
 * @param array|null $input Input parameters.
 * @return array|\WP_Error Result contract or error.
 */
function execute( ?array $input = null ) {
	$input   = $input ?? array();
	$post_id = (int) ( $input['post_id'] ?? 0 );

	if ( ! $post_id ) {
		return new \WP_Error( 'missing_post_id', __( 'A post_id is required.', 'workflow-agent-copy-edit' ) );
	}

	$post = StageAgent::read_post( $post_id );
	if ( is_wp_error( $post ) ) {
		return $post;
	}

	$style = trim( (string) ( $input['style'] ?? '' ) );
	$style = '' !== $style ? $style : __( 'clear, correct, house-style news copy', 'workflow-agent-copy-edit' );

	$token = StageAgent::verdict_token();

	$prompt = sprintf(
		"You are a professional copy editor. Copy-edit an article body for grammar, spelling, punctuation, and style: %s.\n\n" .
		"ARTICLE TITLE: %s\n\nARTICLE BODY:\n%s\n\n" .
		"Rules:\n" .
		"- If the copy is already clean and needs no edits, reply with exactly: %s\n" .
		"- If the copy is not publishable and needs a human rewrite, reply with exactly: REJECT\n" .
		'- Otherwise reply with ONLY the copy-edited article body (no preamble). Preserve all facts, quotes, and meaning.',
		$style,
		$post['title'],
		StageAgent::wrap_untrusted( $post['content'], 'post body' ),
		$token
	);

	/*
	 * This agent replies with the whole article body, so the ceiling has to cover
	 * the body twice over in effect: the reasoning that precedes it plus every token
	 * of the rewrite. Measured on a 4,397-character body (~1,190 tokens) against
	 * claude-sonnet-5: reasoning ~3,980 tokens, rewrite ~1,190, 5,177 in total — so
	 * the previous 2,000 could not have fitted the reasoning alone, let alone the
	 * body it is required to reproduce in full. 12,000 is ~2.3x the measured run,
	 * which keeps a body around 2.5x this one's length inside the ceiling.
	 */
	$response = StageAgent::generate( $prompt, 12000 );
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	if ( StageAgent::is_verdict( $response, $token ) ) {
		return StageAgent::result( 'pass', __( 'Copy is already clean; no edits needed.', 'workflow-agent-copy-edit' ) );
	}

	if ( StageAgent::is_sentinel( $response, 'REJECT' ) ) {
		return StageAgent::result( 'fail', __( 'The copy needs a human rewrite before it can proceed.', 'workflow-agent-copy-edit' ) );
	}

	if ( StageAgent::is_implausibly_short( $post['content'], $response ) ) {
		return new \WP_Error(
			'implausible_rewrite',
			__( 'The agent returned copy far shorter than the original; refusing to overwrite the post.', 'workflow-agent-copy-edit' )
		);
	}

	$written = StageAgent::write_content( $post_id, $response, $post['modified'] );
	if ( is_wp_error( $written ) ) {
		return $written;
	}

	return StageAgent::result( 'pass', __( 'Applied copy edits.', 'workflow-agent-copy-edit' ) );
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
	return AiAvailability::for_selected_provider( array( __( 'Copy Edit', 'workflow-agent-copy-edit' ) ) );
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
			__( 'Post ID is required.', 'workflow-agent-copy-edit' )
		);
	}

	$permission_error = \VIPWorkflow\Abilities\Tools\require_post_edit_permission( (int) $input['post_id'] );
	if ( $permission_error ) {
		return $permission_error;
	}

	return true;
}
