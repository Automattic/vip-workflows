/**
 * refreshPostEntity — pull the post's REST record back into the editor after a
 * workflow write changed it server-side.
 *
 * A transition whose edge crosses a region boundary writes post_status, and
 * assigning or removing a workflow rewrites the post's meta — all behind the
 * open editor's back. The editor renders from the entity record in
 * `@wordpress/core-data`, so until that record is refetched the top bar still
 * offers "Publish" on a post the workflow already published, and the Summary
 * panel still shows the pre-transition status.
 *
 * Both halves matter:
 *
 * - `invalidateResolution` alone only marks the cached resolution stale; the
 *   refetch happens when something re-selects the record through the resolver.
 *   `resolveSelect` re-runs the resolver right away, so the refresh does not
 *   depend on which selectors happen to be mounted.
 * - The args must match the resolution cache's key exactly — it is an
 *   EquivalentKeyMap, so a string post id from a localized script misses the
 *   numeric key the editor resolved under and the invalidation silently does
 *   nothing. That was this refresh's original bug; the editor bootstrap now
 *   inlines JSON so the id arrives numeric (see class-editor-integration.php).
 *
 * @package
 */

import { store as coreStore } from '@wordpress/core-data';

/**
 * Refetch the post's entity record so the editor reflects server-side changes.
 *
 * @param {Object} registry Data registry (from `useRegistry()`).
 * @param {string} postType Post type slug.
 * @param {number} postId   Post ID.
 * @return {Promise|undefined} Resolves when the record has been refetched.
 */
export function refreshPostEntity( registry, postType, postId ) {
	if ( ! postType || ! postId ) {
		return;
	}

	const args = [ 'postType', postType, postId ];

	registry
		.dispatch( coreStore )
		.invalidateResolution( 'getEntityRecord', args );

	return registry.resolveSelect( coreStore ).getEntityRecord( ...args );
}
