<?php
/**
 * Checklist Tool class.
 *
 * @package WorkflowToolChecklist
 */

declare( strict_types=1 );

namespace WorkflowToolChecklist;

/**
 * Checklist Tool - presents a list of items with checkboxes.
 */
class ChecklistTool {

	/**
	 * Register the ability.
	 */
	public static function register(): void {
		if ( ! function_exists( 'wp_register_ability' ) ) {
			return;
		}

		wp_register_ability(
			'workflow-tool-checklist/checklist',
			[
				'label'               => __( 'Pre-publish Checklist', 'workflow-tool-checklist' ),
				'description'         => __( 'Ensure all required items are checked before proceeding.', 'workflow-tool-checklist' ),
				'category'            => 'vip-workflow',
				'input_schema'        => [
					'type'                 => 'object',
					'additionalProperties' => false,
					'properties'           => [
						'post_id' => [
							'type'        => 'integer',
							'description' => 'The post ID to check.',
							'required'    => true,
						],
					],
				],
				'output_schema'       => [
					'type'                 => 'object',
					'additionalProperties' => false,
					'properties'           => [
						'passed'  => [
							'type'        => 'boolean',
							'description' => 'Whether all required items were checked.',
							'required'    => true,
						],
						'status'  => [
							'type'        => 'string',
							'description' => 'Result status (pass/fail).',
							'required'    => true,
						],
						'summary' => [
							'type'        => 'string',
							'description' => 'Summary of results.',
							'required'    => true,
						],
						'message' => [
							'type'        => 'string',
							'description' => 'Result message.',
							'required'    => true,
						],
						'items'   => [
							'type'        => 'array',
							'description' => 'Status of each checklist item.',
							'required'    => true,
						],
						'issues'  => [
							'type'        => 'array',
							'description' => 'List of issues (unchecked required items).',
							'required'    => true,
						],
					],
				],
				'execute_callback'    => [ self::class, 'execute' ],
				'permission_callback' => [ self::class, 'can_execute' ],
				'meta'                => [
					'show_in_rest'        => true,
					'show_in_commands'    => false,
					'icon'                => 'list-view',
					'type'                => 'check',
					'supports'            => [ 'workflow' ],
					'transition_eligible' => true,
					'has_settings'        => true,
					'has_sidebar_panel'   => true, // Self-registers sidebar panel, exclude from Tools panel.
				],
			]
		);
	}

	/**
	 * Check if the ability can be executed.
	 *
	 * @param array $input Input parameters.
	 * @return bool|\WP_Error
	 */
	public static function can_execute( array $input ): bool|\WP_Error {
		$items = get_option( 'workflow_checklist_items', [] );

		if ( empty( $items ) ) {
			return new \WP_Error(
				'no_checklist_items',
				__( 'No checklist items have been configured. Please add items in the Integrations settings.', 'workflow-tool-checklist' )
			);
		}

		if ( empty( $input['post_id'] ) ) {
			return new \WP_Error(
				'missing_post_id',
				__( 'Post ID is required.', 'workflow-tool-checklist' )
			);
		}

		if ( ! current_user_can( 'edit_post', $input['post_id'] ) ) {
			return new \WP_Error(
				'permission_denied',
				__( 'You do not have permission to edit this post.', 'workflow-tool-checklist' )
			);
		}

		return true;
	}

	/**
	 * Execute the checklist check.
	 *
	 * Reads checked items from post meta - users check items in the sidebar,
	 * and this validates that all required items are checked.
	 *
	 * @param array $input Input parameters.
	 * @return array|\WP_Error
	 */
	public static function execute( array $input ): array|\WP_Error {
		$items   = get_option( 'workflow_checklist_items', [] );
		$post_id = $input['post_id'] ?? 0;

		if ( empty( $items ) ) {
			return new \WP_Error(
				'no_checklist_items',
				__( 'No checklist items configured.', 'workflow-tool-checklist' )
			);
		}

		// Get checked items from post meta (set by sidebar UI).
		$checked_items = get_post_meta( $post_id, '_workflow_checklist_checked', true );
		if ( ! is_array( $checked_items ) ) {
			$checked_items = [];
		}

		$results          = [];
		$issues           = [];
		$all_required_met = true;
		$missing_required = [];

		foreach ( $items as $item ) {
			$is_checked  = in_array( $item['id'], $checked_items, true );
			$is_required = ! empty( $item['required'] );

			$results[] = [
				'id'       => $item['id'],
				'label'    => $item['label'],
				'required' => $is_required,
				'checked'  => $is_checked,
				'passed'   => $is_checked || ! $is_required,
			];

			// Add to issues if required and not checked.
			if ( $is_required && ! $is_checked ) {
				$all_required_met   = false;
				$missing_required[] = $item['label'];
				$issues[]           = [
					'check_key'   => $item['id'],
					'type'        => 'checklist_item',
					'severity'    => 'error',
					'message'     => sprintf(
						/* translators: %s: checklist item label */
						__( 'Required checklist item not checked: %s', 'workflow-tool-checklist' ),
						$item['label']
					),
				];
			}
		}

		if ( $all_required_met ) {
			$message = __( 'All required checklist items have been completed.', 'workflow-tool-checklist' );
			$status  = 'pass';
		} else {
			$message = sprintf(
				/* translators: %s: comma-separated list of missing items */
				__( 'Missing required items: %s', 'workflow-tool-checklist' ),
				implode( ', ', $missing_required )
			);
			$status = 'fail';
		}

		return [
			'passed'  => $all_required_met,
			'status'  => $status,
			'summary' => $message,
			'message' => $message,
			'items'   => $results,
			'issues'  => $issues,
		];
	}

	/**
	 * Get all checklist items for display.
	 *
	 * @return array
	 */
	public static function get_items(): array {
		return get_option( 'workflow_checklist_items', [] );
	}
}
