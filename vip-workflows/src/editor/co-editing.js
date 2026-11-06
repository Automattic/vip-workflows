/**
 * Whether anyone else has this post open in the editor.
 *
 * A stage agent writes the post on the server, out of sight of a shared
 * editing session, so the session and the agent overwrite each other's
 * changes. The server refuses an AI stage while the post is shared when the
 * collaboration provider reports a count (see CoEditing.php); this is the
 * editor's own check, which works without one.
 *
 * Gutenberg keeps who is present behind a private API of `@wordpress/core-data`,
 * `useActiveCollaborators`, the same hook its collaborator avatars render
 * from. VIP Real-Time Collaboration already opts in to core-data's private
 * APIs the same way. If a Gutenberg release drops the hook or core-data's
 * private APIs, this reads as nobody else present and the server check is
 * what remains.
 */

/**
 * WordPress dependencies
 */
import { privateApis as coreDataPrivateApis } from '@wordpress/core-data';
import { __dangerousOptInToUnstableAPIsOnlyForCoreModules } from '@wordpress/private-apis';

const { unlock } = __dangerousOptInToUnstableAPIsOnlyForCoreModules(
	'I acknowledge private features are not for use in themes or plugins and doing so will break in the next version of WordPress.',
	'@wordpress/core-data'
);

const NO_COLLABORATORS = [];

// `unlock` throws on a missing object, which would take the whole editor
// bundle down with it, so only unlock what is there.
const useActiveCollaborators =
	( coreDataPrivateApis &&
		unlock( coreDataPrivateApis ).useActiveCollaborators ) ||
	( () => NO_COLLABORATORS );

/**
 * Whether the collaborators include anyone besides this editor — another
 * person, or the same person in another tab.
 *
 * @param {Array<{isMe: boolean}>} collaborators Active collaborators.
 * @return {boolean} True when another editor is present.
 */
export function includesOtherEditors( collaborators ) {
	return collaborators.some( ( collaborator ) => ! collaborator.isMe );
}

/**
 * Whether anyone else has the post open in the editor right now.
 *
 * @param {number|null} postId   Post ID.
 * @param {string|null} postType Post type.
 * @return {boolean} True when another editor is present.
 */
export function useHasOtherEditorsOpen( postId, postType ) {
	return includesOtherEditors( useActiveCollaborators( postId, postType ) );
}
