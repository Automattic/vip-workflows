<?php
/**
 * Whether more than one editor is open on a post.
 *
 * @package VIPWorkflows
 */

declare( strict_types=1 );

namespace VIPWorkflows\Workflow;

/**
 * Answers one question for the stage agent: is anyone else in this post?
 *
 * A stage agent writes the post on the server. With real-time collaboration
 * on, the people in the editor share a live document that never hears about
 * that write, so whichever copy saves last wins: the agent's changes vanish
 * while the room stays open, and the room's edits vanish when the agent's
 * saved version is reloaded. The editor panel reloads onto the agent's version
 * when the run finishes, which only works if nobody else keeps the room open,
 * so agent stages wait until the post has one editor.
 *
 * WordPress itself cannot answer this — a post lock records one user, and
 * under collaboration it is shared — so the count comes from the collaboration
 * provider. VIP Real-Time Collaboration reports open editor connections per
 * post; it counts connections, not users, so one person in two tabs is two.
 * Without it the count is 0 and nothing is held.
 */
class CoEditing {

	/**
	 * Number of editor connections open on a post right now, as far as the
	 * collaboration provider knows. 0 when nothing reports.
	 *
	 * @param int $post_id Post ID.
	 * @return int
	 */
	public static function editor_connections( int $post_id ): int {
		return class_exists( '\VIPRealTimeCollaboration\Presence\EditorConnections' )
			? (int) \VIPRealTimeCollaboration\Presence\EditorConnections::get_count( $post_id )
			: 0;
	}

	/**
	 * Whether more than one editor is open on the post.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 */
	public static function is_shared( int $post_id ): bool {
		return self::editor_connections( $post_id ) > 1;
	}
}
