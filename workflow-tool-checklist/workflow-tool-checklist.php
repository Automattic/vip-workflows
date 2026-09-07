<?php
/**
 * Plugin Name: Workflow Checklist Tool
 * Description: A customizable checklist tool for workflow transitions. Define items that must be checked before proceeding.
 * Version: 1.0.0
 * Author: WordPress VIP
 * Author URI: https://wpvip.com
 * Requires Plugins: vip-workflows
 * Text Domain: workflow-tool-checklist
 *
 * @package WorkflowToolChecklist
 */

declare( strict_types=1 );

namespace WorkflowToolChecklist;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'WORKFLOW_TOOL_CHECKLIST_PATH', __DIR__ );
define( 'WORKFLOW_TOOL_CHECKLIST_URL', plugin_dir_url( __FILE__ ) );

require_once __DIR__ . '/includes/class-checklist-tool.php';

// Register the ability on the correct hook.
add_action( 'wp_abilities_api_init', array( ChecklistTool::class, 'register' ) );

// Enqueue admin scripts on the Tools page.
add_action(
	'admin_enqueue_scripts',
	function ( $hook ) {
		if ( ! str_contains( $hook, 'vip-workflows-tools' ) ) {
			return;
		}

		$asset_file = WORKFLOW_TOOL_CHECKLIST_PATH . '/build/admin.asset.php';
		$asset      = file_exists( $asset_file ) ? require $asset_file : array(
			'dependencies' => array( 'wp-element', 'wp-components', 'wp-hooks', 'wp-api-fetch', 'wp-i18n' ),
			'version'      => '1.0.0',
		);

		// Add vip-workflows-admin as dependency to ensure filter is available.
		$dependencies   = $asset['dependencies'];
		$dependencies[] = 'vip-workflows-admin';

		wp_enqueue_script(
			'workflow-tool-checklist-admin',
			WORKFLOW_TOOL_CHECKLIST_URL . 'build/admin.js',
			$dependencies,
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'workflow-tool-checklist-admin',
			WORKFLOW_TOOL_CHECKLIST_URL . 'build/admin.css',
			array(),
			$asset['version']
		);
	}
);

// Register REST API for managing checklist items and per-post state.
add_action(
	'rest_api_init',
	function () {
		// Admin: Get/save checklist item definitions.
		register_rest_route(
			'workflow-tool-checklist/v1',
			'/items',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => __NAMESPACE__ . '\\get_checklist_items',
					'permission_callback' => function () {
						return current_user_can( 'edit_posts' );
					},
				),
				array(
					'methods'             => 'POST',
					'callback'            => __NAMESPACE__ . '\\save_checklist_items',
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
				),
			)
		);

		// Editor: Get/save checked state per post.
		register_rest_route(
			'workflow-tool-checklist/v1',
			'/post/(?P<post_id>\d+)/checked',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => __NAMESPACE__ . '\\get_post_checked_items',
					'permission_callback' => function ( $request ) {
						return current_user_can( 'edit_post', $request['post_id'] );
					},
				),
				array(
					'methods'             => 'POST',
					'callback'            => __NAMESPACE__ . '\\save_post_checked_items',
					'permission_callback' => function ( $request ) {
						return current_user_can( 'edit_post', $request['post_id'] );
					},
				),
			)
		);
	}
);

// Enqueue editor script only for post types managed by VIP Workflows.
add_action(
	'enqueue_block_editor_assets',
	function () {
		$screen = get_current_screen();
		if ( ! $screen || 'post' !== $screen->base ) {
			return;
		}

		if ( ! class_exists( \VIPWorkflows\Sequences\SequenceRepository::class ) ) {
			return;
		}

		$repo       = new \VIPWorkflows\Sequences\SequenceRepository();
		$sequences = $repo->get_active();
		$post_types = array();
		foreach ( $sequences as $sequence ) {
			$post_types = array_merge( $post_types, $sequence->get_post_types() );
		}

		if ( ! in_array( $screen->post_type, array_unique( $post_types ), true ) ) {
			return;
		}

		$asset_file = WORKFLOW_TOOL_CHECKLIST_PATH . '/build/editor.asset.php';
		$asset      = file_exists( $asset_file ) ? require $asset_file : array(
			'dependencies' => array( 'wp-plugins', 'wp-editor', 'wp-element', 'wp-components', 'wp-data', 'wp-api-fetch', 'wp-i18n' ),
			'version'      => '1.0.0',
		);

		wp_enqueue_script(
			'workflow-tool-checklist-editor',
			WORKFLOW_TOOL_CHECKLIST_URL . 'build/editor.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'workflow-tool-checklist-editor',
			WORKFLOW_TOOL_CHECKLIST_URL . 'build/editor.css',
			array(),
			$asset['version']
		);
	}
);

/**
 * Get checklist items.
 *
 * @return \WP_REST_Response
 */
function get_checklist_items(): \WP_REST_Response {
	$items = get_option( 'workflow_checklist_items', array() );
	return new \WP_REST_Response( $items, 200 );
}

/**
 * Save checklist items.
 *
 * @param \WP_REST_Request $request Request object.
 * @return \WP_REST_Response
 */
function save_checklist_items( \WP_REST_Request $request ): \WP_REST_Response {
	$items = $request->get_json_params();

	// Validate and sanitize items.
	$sanitized = array();
	if ( is_array( $items ) ) {
		foreach ( $items as $item ) {
			if ( ! empty( $item['label'] ) ) {
				$sanitized[] = array(
					'id'       => sanitize_key( $item['id'] ?? wp_generate_uuid4() ),
					'label'    => sanitize_text_field( $item['label'] ),
					'required' => ! empty( $item['required'] ), // True = hard, false = soft.
				);
			}
		}
	}

	update_option( 'workflow_checklist_items', $sanitized );
	return new \WP_REST_Response( $sanitized, 200 );
}

/**
 * Get checked items for a post.
 *
 * @param \WP_REST_Request $request Request object.
 * @return \WP_REST_Response
 */
function get_post_checked_items( \WP_REST_Request $request ): \WP_REST_Response {
	$post_id = (int) $request['post_id'];
	$checked = get_post_meta( $post_id, '_workflow_checklist_checked', true );
	return new \WP_REST_Response( is_array( $checked ) ? $checked : array(), 200 );
}

/**
 * Save checked items for a post.
 *
 * @param \WP_REST_Request $request Request object.
 * @return \WP_REST_Response
 */
function save_post_checked_items( \WP_REST_Request $request ): \WP_REST_Response {
	$post_id = (int) $request['post_id'];
	$data    = $request->get_json_params();
	$checked = isset( $data['checked'] ) && is_array( $data['checked'] )
		? array_map( 'sanitize_key', $data['checked'] )
		: array();

	update_post_meta( $post_id, '_workflow_checklist_checked', $checked );
	return new \WP_REST_Response( $checked, 200 );
}
