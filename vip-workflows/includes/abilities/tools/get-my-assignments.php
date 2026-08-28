<?php
/**
 * Get My Assignments ability.
 *
 * Returns posts assigned to the current user across all workflows.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Abilities\Tools;

/**
 * Execute the assignments query.
 *
 * @param  array|null $input Input parameters.
 * @return array|\WP_Error Result data or error.
 */
function execute_get_my_assignments( ?array $input = null ) {
	$input   = $input ?? array();
	$user_id = get_current_user_id();
	$status  = $input['status'] ?? null;
	$limit   = min( (int) ( $input['limit'] ?? 20 ), 50 );

	if ( ! $user_id ) {
		return new \WP_Error( 'not_logged_in', __( 'User must be logged in.', 'vip-workflow' ) );
	}

	// Find posts where the current user is assigned via post meta.
	$query_args = array(
		'post_type'      => 'any',
		'post_status'    => 'any',
		'posts_per_page' => $limit,
		'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
			array(
				'key'   => '_vip_workflow_assigned_user',
				'value' => $user_id,
			),
		),
		'orderby'        => 'modified',
		'order'          => 'DESC',
	);

	if ( $status ) {
		// Filter to a workflow stage (merges into the assignee meta_query; the
		// stage is decoupled from post_status, which stays 'any').
		$query_args = \VIPWorkflow\Workflow\StageQuery::by_stage_key( $status, $query_args );
	}

	$query = new \WP_Query( $query_args );
	$posts = array();

	foreach ( $query->posts as $post ) {
		if ( ! current_user_can( 'edit_post', $post->ID ) ) {
			continue;
		}

		$sequence_id = get_post_meta( $post->ID, '_vip_workflow_sequence_id', true );
		$stage_key    = get_post_meta( $post->ID, '_vip_workflow_current_stage_key', true );

		$posts[] = array(
			'post_id'       => $post->ID,
			'title'         => $post->post_title,
			'post_type'     => $post->post_type,
			'status'        => $post->post_status,
			'stage'         => $stage_key ? $stage_key : null,
			'sequence_id'   => $sequence_id ? (int) $sequence_id : null,
			'modified'      => $post->post_modified,
			'edit_url'      => get_edit_post_link( $post->ID, 'raw' ) ? get_edit_post_link( $post->ID, 'raw' ) : '',
		);
	}

	return array(
		'user_id' => $user_id,
		'count'   => count( $posts ),
		'posts'   => $posts,
	);
}

/**
 * Register the Get My Assignments ability.
 *
 * @return void
 */
function register_get_my_assignments(): void {
	wp_register_ability(
		'vip-workflow/get-my-assignments',
		array(
			'label'               => __( 'Get My Assignments', 'vip-workflow' ),
			'description'         => __( 'Returns posts assigned to the current user across all workflows.', 'vip-workflow' ),
			'category'            => 'vip-workflow',
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'properties'           => array(
					'status' => array(
						'type'        => 'string',
						'description' => __( 'Optional workflow status to filter by.', 'vip-workflow' ),
					),
					'limit'  => array(
						'type'        => 'integer',
						'description' => __( 'Maximum number of results (default 20, max 50).', 'vip-workflow' ),
						'default'     => 20,
					),
				),
			),
			'output_schema'       => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'properties'           => array(
					'user_id' => array(
						'type'        => 'integer',
						'description' => __( 'The current user ID.', 'vip-workflow' ),
					),
					'count'   => array(
						'type'        => 'integer',
						'description' => __( 'Number of assigned posts returned.', 'vip-workflow' ),
					),
					'posts'   => array(
						'type'        => 'array',
						'description' => __( 'Array of assigned posts.', 'vip-workflow' ),
					),
				),
			),
			'execute_callback'    => __NAMESPACE__ . '\\execute_get_my_assignments',
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
			'meta'                => array(
				'show_in_commands'    => false,
				'transition_eligible' => false,
				'annotations'         => array(
					'readonly'    => true,
					'destructive' => false,
					'idempotent'  => true,
				),
				'mcp'                 => array(
					'public' => true,
					'type'   => 'tool',
				),
			),
		)
	);
}
