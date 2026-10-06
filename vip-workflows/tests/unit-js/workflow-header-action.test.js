/**
 * The workflow split button in the editor header.
 *
 * The main half runs the stage's primary transition — the first in authored
 * order, under the author's label — through the same flow as the sidebar rail;
 * the arrow opens the rail. Core's Publish button is hidden only where it
 * could do nothing but fail, and only while this button is on screen to stand
 * in for it.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-panel-publish-confirm.test.js for why these are stubbed: ESM-only
// deps the components name but do not otherwise exercise.
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';
// eslint-disable-next-line import/first
import { SlotFillProvider, Slot } from '@wordpress/components';

const NO_META = {};
let postIsDirty = false;
const savePost = jest.fn( () => {
	postIsDirty = false;
	return Promise.resolve();
} );

register(
	createReduxStore( 'core', {
		reducer: ( state = {} ) => state,
		selectors: { getEntityRecord: () => null },
		actions: { invalidateResolution: () => ( { type: 'NOOP' } ) },
	} )
);

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			getEditedPostAttribute: ( state, attribute ) =>
				'meta' === attribute ? NO_META : 'draft',
			getCurrentPostAttribute: () => 'draft',
			isEditedPostDirty: () => postIsDirty,
		},
		actions: { savePost },
	} )
);

const createErrorNotice = jest.fn( () => ( { type: 'NOOP' } ) );

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice,
			removeNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

/* eslint-disable import/first */
import { seedEditorStore } from './helpers/editor-store';
import {
	WorkflowHeaderAction,
	REPLACES_PUBLISH_CLASS,
} from '../../src/editor/components/WorkflowHeaderAction';
import { TransitionFlow } from '../../src/editor/components/TransitionFlow';
/* eslint-enable import/first */

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';
const TRANSITION_PATH = '/vip-workflows/v1/workflow/post/42/transition';

const TO_REVIEW = {
	to: 'review',
	label: 'Send to Review',
	status_info: { key: 'review', label: 'Review', status: 'pending' },
};
const TO_LIVE = {
	to: 'live',
	label: 'Publish Now',
	status_info: { key: 'live', label: 'Live', status: 'publish' },
};

/**
 * A status payload.
 *
 * @param {Object} overrides Fields to replace.
 * @return {Object} Status endpoint response.
 */
function statusResponse( overrides = {} ) {
	return {
		has_workflow: true,
		sequence: { id: 1, name: 'Header Flow' },
		current: {
			key: 'draft',
			label: 'Draft',
			color: '#666',
			status: 'draft',
			is_terminal: false,
			transitions: [],
		},
		all_statuses: [],
		transitions: [ TO_REVIEW, TO_LIVE ],
		guard: { current_region: 'draft', can_bypass: false },
		can_remove: true,
		...overrides,
	};
}

/**
 * Every transition POST apiFetch has received.
 *
 * @return {Array} The POST bodies.
 */
function transitionPosts() {
	return apiFetch.mock.calls
		.filter(
			( [ { path, method } ] ) =>
				path === TRANSITION_PATH && 'POST' === method
		)
		.map( ( [ { data } ] ) => data );
}

/**
 * Render the header slot with the button and the flow, against a payload.
 *
 * @param {Object}   status     Status endpoint response.
 * @param {Function} transition Answers the transition POST; unresolved by default.
 */
async function renderHeader(
	status,
	transition = () => new Promise( () => {} )
) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( status );
		}
		if ( path === TRANSITION_PATH ) {
			return transition();
		}
		return Promise.resolve( [] );
	} );

	render(
		<SlotFillProvider>
			<div className="editor-header">
				<Slot name="PinnedItems/core" />
			</div>
			<TransitionFlow />
			<WorkflowHeaderAction />
		</SlotFillProvider>
	);

	await waitFor( () =>
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( { path: STATUS_PATH } )
		)
	);
}

describe( 'WorkflowHeaderAction', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		savePost.mockClear();
		createErrorNotice.mockClear();
		postIsDirty = false;
		document.body.classList.remove( REPLACES_PUBLISH_CLASS );
		seedEditorStore();
	} );

	it( 'labels the main half with the first transition and stands in for Publish', async () => {
		await renderHeader( statusResponse() );

		const main = await screen.findByRole( 'button', {
			name: 'Send to Review',
		} );
		expect( main ).toHaveClass( 'is-primary' );
		expect( document.body ).toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'runs the primary transition through the flow', async () => {
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () =>
			expect( transitionPosts() ).toEqual( [
				expect.objectContaining( { to_status: 'review' } ),
			] )
		);
	} );

	it( 'saves a dirty post before the move', async () => {
		postIsDirty = true;
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () => expect( transitionPosts() ).toHaveLength( 1 ) );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'asks before a primary transition that publishes', async () => {
		await renderHeader(
			statusResponse( { transitions: [ TO_LIVE, TO_REVIEW ] } )
		);

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Publish Now' } )
			).click();
		} );

		expect(
			await screen.findByText( 'Publish this post?' )
		).toBeInTheDocument();
		expect( transitionPosts() ).toHaveLength( 0 );
	} );

	it( 'draws a locked primary disabled rather than promoting the next move', async () => {
		await renderHeader(
			statusResponse( {
				transitions: [
					{
						...TO_LIVE,
						_locked: true,
						_locked_reason: 'Fill in Section first.',
					},
					TO_REVIEW,
				],
			} )
		);

		const main = await screen.findByRole( 'button', {
			name: 'Publish Now',
		} );
		expect( main ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.queryByRole( 'button', { name: 'Send to Review' } )
		).not.toBeInTheDocument();
	} );

	it( 'opens the rail from the arrow', async () => {
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', {
					name: 'Workflow transitions',
				} )
			).click();
		} );

		// The rail lists every way out — the primary again among them.
		expect(
			await screen.findByRole( 'button', { name: 'Publish Now' } )
		).toBeInTheDocument();
		expect(
			screen.getAllByRole( 'button', { name: 'Send to Review' } )
		).toHaveLength( 2 );
	} );

	it( 'sits beside core controls for a person who can bypass the workflow', async () => {
		await renderHeader(
			statusResponse( {
				guard: { current_region: 'draft', can_bypass: true },
			} )
		);

		const main = await screen.findByRole( 'button', {
			name: 'Send to Review',
		} );
		expect( main ).toHaveClass( 'is-secondary' );
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'sits beside core Save on a live post', async () => {
		await renderHeader(
			statusResponse( {
				guard: { current_region: 'publish', can_bypass: false },
			} )
		);

		expect(
			await screen.findByRole( 'button', { name: 'Send to Review' } )
		).toHaveClass( 'is-secondary' );
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'renders nothing and keeps core controls when the stage offers no move', async () => {
		await renderHeader( statusResponse( { transitions: [] } ) );

		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', {
					name: 'Workflow transitions',
				} )
			).not.toBeInTheDocument()
		);
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'renders nothing for an orphaned post', async () => {
		await renderHeader(
			statusResponse( {
				has_workflow: false,
				orphaned: true,
				guard: { current_region: null, can_bypass: false },
			} )
		);

		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Send to Review' } )
			).not.toBeInTheDocument()
		);
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'reports a refused move as an editor notice', async () => {
		await renderHeader( statusResponse(), () =>
			Promise.reject( {
				code: 'forbidden_transition',
				message: 'Not yours to move.',
			} )
		);

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () =>
			expect( createErrorNotice ).toHaveBeenCalledWith(
				'Not yours to move.',
				expect.anything()
			)
		);
	} );
} );
