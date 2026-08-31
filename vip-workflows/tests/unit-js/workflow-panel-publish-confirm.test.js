/**
 * The confirm that stands between a transition and publishing the post.
 *
 * A transition into a publish-region stage crosses the publish boundary, so the
 * server writes `publish` before the stage move — the post goes publicly live
 * from a sidebar button that reads as a workflow step. Core's own Publish
 * button asks first; these tests pin that the panel does too, that declining
 * really declines, and that the question is only asked when publishing is
 * actually the news: a within-region move, or a post that is already live,
 * proceeds without it.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

/*
 * `@wordpress/core-data` pulls @wordpress/sync, which needs TextEncoder that
 * jsdom does not provide. The panel only uses it to name the store it refreshes
 * the post entity on, so the store name is all this needs.
 */
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );

/*
 * `@wordpress/editor` pulls @wordpress/blocks, whose ESM-only dependencies Jest
 * cannot parse. The panel only needs the store's name plus a few post-state
 * selectors, so a named test store stands in for all of it.
 */
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';

// The committed post status, settable per test: the confirm keys off what is
// persisted, so an already-live post must be able to differ from a draft one.
let mockSavedStatus = 'draft';

register(
	createReduxStore( 'core', {
		reducer: ( state = {} ) => state,
		selectors: { getEntityRecord: () => null },
		actions: { invalidateResolution: () => ( { type: 'NOOP' } ) },
	} )
);

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			getEditedPostAttribute: () => mockSavedStatus,
			getCurrentPostAttribute: () => mockSavedStatus,
			isEditedPostDirty: () => false,
		},
		actions: { savePost: () => ( { type: 'NOOP' } ) },
	} )
);

/*
 * The real editor store, seeded per test: the panel reads its workflow state
 * from it rather than holding a copy, so a stand-in would test the stand-in.
 */
// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';
const TRANSITION_PATH = '/vip-workflows/v1/workflow/post/42/transition';

/**
 * A status payload whose stage offers one publishing exit and one that stays
 * in the draft region.
 *
 * @param {string} currentRegion Region the current stage declares.
 * @return {Object} Status endpoint response.
 */
function statusResponse( currentRegion = 'draft' ) {
	return {
		has_workflow: true,
		sequence: { id: 1, name: 'Publish Confirm Flow' },
		current: {
			key: 'review',
			label: 'Review',
			color: '#666',
			status: currentRegion,
			is_terminal: false,
		},
		transitions: [
			{
				to: 'live',
				label: 'Send Live',
				status_info: {
					key: 'live',
					label: 'On the site',
					status: 'publish',
				},
			},
			{
				to: 'copy_desk',
				label: 'Send to Copy Desk',
				status_info: {
					key: 'copy_desk',
					label: 'Copy Desk',
					status: 'draft',
				},
			},
		],
		can_remove: false,
	};
}

/**
 * The <button> element carrying a given label.
 *
 * @param {string} label Button text.
 * @return {HTMLElement} The button.
 */
function button( label ) {
	return screen.getByRole( 'button', { name: label } );
}

/**
 * Every transition POST apiFetch has received.
 *
 * @return {Array} The POST calls.
 */
function transitionPosts() {
	return apiFetch.mock.calls.filter(
		( [ { path, method } ] ) =>
			path === TRANSITION_PATH && 'POST' === method
	);
}

/**
 * Render the panel against a given status payload, with the transition POST
 * left unresolved so only its initiation is observable.
 *
 * @param {Object} status Status endpoint response.
 */
async function renderPanel( status ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( status );
		}
		if ( path.startsWith( '/vip-workflows/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		if ( 'POST' === method ) {
			return new Promise( () => {} );
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () => expect( button( 'Send Live' ) ).toBeInTheDocument() );
}

describe( 'WorkflowPanel publish confirm', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		mockSavedStatus = 'draft';
		seedEditorStore();
	} );

	it( 'asks before a transition that publishes, and does not transition until answered', async () => {
		await renderPanel( statusResponse() );

		await act( async () => {
			button( 'Send Live' ).click();
		} );

		expect( screen.getByText( 'Publish this post?' ) ).toBeInTheDocument();
		expect( transitionPosts() ).toHaveLength( 0 );
	} );

	it( 'declining the confirm abandons the transition', async () => {
		await renderPanel( statusResponse() );

		await act( async () => {
			button( 'Send Live' ).click();
		} );
		await act( async () => {
			button( 'Cancel' ).click();
		} );

		expect(
			screen.queryByText( 'Publish this post?' )
		).not.toBeInTheDocument();
		expect( transitionPosts() ).toHaveLength( 0 );
	} );

	it( 'confirming performs the transition', async () => {
		await renderPanel( statusResponse() );

		await act( async () => {
			button( 'Send Live' ).click();
		} );
		await act( async () => {
			button( 'Publish' ).click();
		} );

		expect( transitionPosts() ).toHaveLength( 1 );
		expect( transitionPosts()[ 0 ][ 0 ].data.to_status ).toBe( 'live' );
	} );

	it( 'does not ask for a transition that stays in the draft region', async () => {
		await renderPanel( statusResponse() );

		await act( async () => {
			button( 'Send to Copy Desk' ).click();
		} );

		expect(
			screen.queryByText( 'Publish this post?' )
		).not.toBeInTheDocument();
		expect( transitionPosts() ).toHaveLength( 1 );
	} );

	it( 'does not ask on a post that is already live', async () => {
		// A live post moving between two publish-region stages: the edge
		// crosses nothing, so no status is written and there is no news.
		mockSavedStatus = 'publish';
		await renderPanel( statusResponse( 'publish' ) );

		await act( async () => {
			button( 'Send Live' ).click();
		} );

		expect(
			screen.queryByText( 'Publish this post?' )
		).not.toBeInTheDocument();
		expect( transitionPosts() ).toHaveLength( 1 );
	} );
} );
