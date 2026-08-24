/**
 * Test harness for the editor data store.
 *
 * The sidebar panel reads a post's workflow state from `vip-workflow/editor`
 * rather than holding a copy of it, and the store is what performs the one read
 * of the status endpoint. So these tests drive the real store: a stand-in
 * registered per test file would prove only that the stand-in works, and the
 * single-sourcing is the thing under test.
 *
 * A store outliving a render is the whole point of it, which is exactly why
 * every test has to seat it first — otherwise the previous test's payload is
 * still on screen while this test's request is in flight.
 *
 * The importing test file must mock `@wordpress/api-fetch` (the store fetches
 * through it) and `@wordpress/core-data` (the store refreshes the post entity
 * through it, and the real package pulls @wordpress/sync, which needs a
 * TextEncoder jsdom does not provide).
 *
 * @package
 */

import { dispatch } from '@wordpress/data';

import { STORE_NAME } from '../../../src/editor/store';

export { STORE_NAME };

/**
 * Seat the editor store at a known starting point: this post, and no workflow
 * status read yet.
 *
 * @param {Object} overrides State to merge over the defaults.
 */
export function seedEditorStore( overrides = {} ) {
	dispatch( STORE_NAME ).hydrate( {
		postId: 42,
		postType: 'post',
		workflowEnforcement: 'optional',
		// Nothing has been read yet, so the panel opens on its spinner and
		// asks — the same sequence a real page load produces.
		workflowStatus: null,
		workflowStatusResolved: false,
		...overrides,
	} );

	// Retire whatever a previous test left in flight, so its response cannot
	// land as this test's answer. The same token that keeps a slow poll from
	// overwriting a transition's own payload.
	dispatch( STORE_NAME ).beginWorkflowStatusRequest();
}
