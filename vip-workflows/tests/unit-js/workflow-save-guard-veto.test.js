/**
 * The save guard's refusal names the direction of the refused change.
 *
 * For a person who cannot bypass the workflow, a status change across the
 * publish boundary is refused in the guard, and the message it throws is the
 * one core's save-failure notice carries. The sentence depends on the target
 * status, so these tests pin that the guard hands the target status to the
 * shared copy: without it, a publish attempt is told only that the status
 * cannot be changed.
 *
 * @package
 */

import { render } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-save-guard-refresh.test.js for why these two are stood in.
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';
// eslint-disable-next-line import/first
import { applyFiltersAsync } from '@wordpress/hooks';

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			isSavingPost: () => false,
			isAutosavingPost: () => false,
			didPostSaveRequestSucceed: () => false,
			getCurrentPost: () => ( { status: 'draft' } ),
			getEditedPostAttribute: () => 'Budget piece',
		},
		actions: {
			editPost: () => ( { type: 'NOOP' } ),
		},
	} )
);

// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowSaveGuard } from '../../src/editor/components/WorkflowSaveGuard';

/**
 * A workflow post, seen by a person who cannot bypass it.
 *
 * @param {string} currentRegion Side of the publish line the post is on.
 * @return {Object} Status endpoint response.
 */
function statusResponse( currentRegion ) {
	return {
		has_workflow: true,
		sequence: { id: 1, name: 'News desk' },
		current: { key: 'publish' === currentRegion ? 'live' : 'writing' },
		all_statuses: [
			{
				key: 'writing',
				label: 'Writing',
				status: 'draft',
				region_entry: true,
			},
			{
				key: 'live',
				label: 'On the site',
				status: 'publish',
				region_entry: true,
			},
		],
		transitions: [],
		guard: {
			current_region: currentRegion,
			can_bypass: false,
			agent_pending: false,
		},
	};
}

/**
 * Run the pre-save filter for a status change and return what it threw.
 *
 * @param {string} targetStatus Status the save would write.
 * @return {Promise<Error>} The refusal.
 */
async function refusal( targetStatus ) {
	try {
		await applyFiltersAsync(
			'editor.preSavePost',
			{ status: targetStatus },
			{}
		);
	} catch ( error ) {
		return error;
	}
	throw new Error( 'The guard let a vetoed save through.' );
}

describe( 'WorkflowSaveGuard veto message', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore();
		render( <WorkflowSaveGuard /> );
	} );

	it( 'tells a publish attempt the post can’t be published directly', async () => {
		apiFetch.mockImplementation( () =>
			Promise.resolve( statusResponse( 'draft' ) )
		);

		const error = await refusal( 'publish' );

		expect( error.message ).toBe(
			'“Budget piece” is in the “News desk” workflow, so it can’t be published directly. Move it through the workflow to a published stage.'
		);
	} );

	it( 'tells an unpublish attempt its status can’t be changed directly', async () => {
		apiFetch.mockImplementation( () =>
			Promise.resolve( statusResponse( 'publish' ) )
		);

		const error = await refusal( 'draft' );

		expect( error.message ).toBe(
			'“Budget piece” is in the “News desk” workflow, so its status can’t be changed directly. Move it through the workflow instead.'
		);
	} );
} );
