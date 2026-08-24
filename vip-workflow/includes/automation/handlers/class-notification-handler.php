<?php
/**
 * Notification action handler.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Automation\Handlers;

use VIPWorkflow\Automation\ActionHandlerInterface;
use VIPWorkflow\Database\Schema;

/**
 * Handles notification actions.
 */
class NotificationHandler implements ActionHandlerInterface {


	/**
	 * Execute the notification action.
	 *
	 * @param  array $config  Action configuration.
	 * @param  array $context Execution context.
	 * @return array Result data.
	 */
	public function execute( array $config, array $context ): array {
		$channel = $config['channel'] ?? 'in_app';

		// Phase 1: Only in_app notifications.
		if ( 'in_app' !== $channel ) {
			return array(
				'sent'    => false,
				'reason'  => "Channel '{$channel}' not yet implemented",
				'channel' => $channel,
			);
		}

		// Determine recipients.
		$recipients = $this->get_recipients( $config, $context );

		if ( empty( $recipients ) ) {
			return array(
				'sent'   => false,
				'reason' => 'No recipients found',
			);
		}

		// Process message template.
		$message = $this->process_template( $config['message'] ?? '', $context );
		$title   = $this->process_template( $config['title'] ?? 'Workflow Notification', $context );

		// Create notifications.
		$created = 0;
		foreach ( $recipients as $user_id ) {
			$this->create_notification( $user_id, $title, $message, $config, $context );
			++$created;
		}

		return array(
			'sent'       => true,
			'channel'    => $channel,
			'recipients' => count( $recipients ),
			'message'    => $message,
		);
	}

	/**
	 * Get recipients for the notification.
	 *
	 * @param  array $config  Action configuration.
	 * @param  array $context Execution context.
	 * @return int[] User IDs.
	 */
	private function get_recipients( array $config, array $context ): array {
		$recipients = array();

		// Specific user.
		if ( ! empty( $config['to_user'] ) ) {
			$recipients[] = (int) $config['to_user'];
		}

		// By role.
		if ( ! empty( $config['to_role'] ) ) {
			$role_users = $this->get_users_by_workflow_role( $config['to_role'], $context );
			$recipients = array_merge( $recipients, $role_users );
		}

		// Post author (owner).
		if ( ! empty( $config['to_owner'] ) && ! empty( $context['post_id'] ) ) {
			$post = get_post( $context['post_id'] );
			if ( $post && $post->post_author ) {
				$recipients[] = (int) $post->post_author;
			}
		}

		return array_unique( array_filter( $recipients ) );
	}

	/**
	 * Get users by role.
	 *
	 * @param  string $role_key WordPress role slug.
	 * @param  array  $context  Execution context.
	 * @return int[] User IDs.
	 */
	private function get_users_by_workflow_role( string $role_key, array $context ): array {
		/**
		 * Filter the WordPress role used for notifications.
		 *
		 * @param  string $role_key The role slug.
		 * @param  array  $context  The execution context.
		 * @return string The WordPress role slug to use.
		 */
		$wp_role = apply_filters( 'vip_workflow_notification_role', $role_key, $context );

		// Get users with this role.
		$users = get_users(
			array(
				'role'   => $wp_role,
				'number' => 10, // Limit to prevent mass notifications.
			)
		);

		return array_map( fn( $user ) => $user->ID, $users );
	}

	/**
	 * Process template variables in a string.
	 *
	 * @param  string $template Template string.
	 * @param  array  $context  Context data.
	 * @return string Processed string.
	 */
	private function process_template( string $template, array $context ): string {
		$replacements = array();

		// Post variables.
		if ( ! empty( $context['post_id'] ) ) {
			$post = get_post( $context['post_id'] );

			if ( $post ) {
				$replacements['{{post.id}}']    = (string) $post->ID;
				$replacements['{{post.title}}'] = $post->post_title;
				$replacements['{{post.status}}'] = $post->post_status;
			}
		}

		// Event data variables.
		$event_data = $context['event_data'] ?? array();
		foreach ( $event_data as $key => $value ) {
			if ( is_scalar( $value ) ) {
				$replacements[ '{{' . $key . '}}' ] = (string) $value;
			}
		}

		// Status variables.
		if ( ! empty( $event_data['from_status'] ) ) {
			$replacements['{{from_status}}'] = $event_data['from_status'];
		}
		if ( ! empty( $event_data['to_status'] ) ) {
			$replacements['{{to_status}}'] = $event_data['to_status'];
		}

		return str_replace( array_keys( $replacements ), array_values( $replacements ), $template );
	}

	/**
	 * Create a notification record.
	 *
	 * @param int    $user_id User ID.
	 * @param string $title   Notification title.
	 * @param string $message Notification message.
	 * @param array  $config  Action configuration.
	 * @param array  $context Execution context.
	 */
	private function create_notification( int $user_id, string $title, string $message, array $config, array $context ): void {
		global $wpdb;

		$wpdb->insert(
			Schema::get_table_name( 'workflow_notifications' ),
			array(
				'user_id'    => $user_id,
				'post_id'    => $context['post_id'] ?? null,
				'type'       => $config['type'] ?? 'info',
				'title'      => $title,
				'message'    => $message,
				'data'       => wp_json_encode(
					array(
						'action_config' => $config,
						'event_type'    => $context['event_type'] ?? null,
					)
				),
				'is_read'    => 0,
				'created_at' => current_time( 'mysql' ),
			)
		);
	}
}
