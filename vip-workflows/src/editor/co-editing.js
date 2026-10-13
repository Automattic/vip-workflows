/**
 * Whether anyone else has this post open in the editor.
 *
 * A stage agent writes the post on the server, out of sight of a shared
 * editing session, so the session and the agent overwrite each other's
 * changes. The server refuses an AI stage while the post is shared when the
 * collaboration provider reports a count (see CoEditing.php); this is the
 * editor's own check, which works without one.
 *
 * Gutenberg keeps who is present behind a private API, but it renders the
 * collaborator avatars only when someone else is in the post — another person,
 * or the same person in another tab — so their presence in the page answers
 * the question. It is markup, not an API: if Gutenberg renames it, this
 * quietly returns false and the server check is what remains.
 *
 * @param {Document} doc Document to look in.
 * @return {boolean} True when another editor is present.
 */
export function hasOtherEditorsOpen( doc = document ) {
	return !! doc.querySelector( '.editor-collaborators-presence' );
}
