/**
 * Claim and Release in the Workflow panel.
 *
 * A claim (`claimed_by`) and a transition assignment (`assigned_to`) are stored
 * separately. Release posts to /unclaim, which clears only the claim, so it
 * must sit beside the claim. When it sat beside the assignment instead, pressing
 * it changed nothing the person could see, and a claim had no Release at all.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/edit-post', () => ( { store: 'core/edit-post' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';

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
			removeNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			isEditorPanelRemoved: () => false,
			isEditorPanelEnabled: () => true,
			getEditedPostAttribute: () => 'draft',
			getCurrentPostAttribute: () => 'draft',
			getCurrentPostId: () => 42,
			isEditedPostDirty: () => false,
			isSavingPost: () => false,
		},
		actions: { savePost: () => ( { type: 'NOOP' } ) },
	} )
);

// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';
const UNCLAIM_PATH = '/vip-workflows/v1/workflow/post/42/unclaim';

// The shape Actor::from_user() serves.
const person = ( id, displayName, isCurrent ) => ( {
	type: 'user',
	id,
	display_name: displayName,
	agent_actor: null,
	avatar: '',
	is_current: isCurrent,
} );

const status = ( overrides = {} ) => ( {
	has_workflow: true,
	sequence: { id: 1, name: 'Review Flow' },
	current: {
		key: 'review',
		label: 'Review',
		color: '#666',
		is_terminal: false,
	},
	transitions: [],
	assigned_to: null,
	claimed_by: null,
	can_claim: false,
	can_remove: false,
	...overrides,
} );

/**
 * Render the panel against a status payload, recording every request.
 *
 * @param {Object} payload Status payload the panel reads.
 * @return {Promise<Array>} The recorded requests.
 */
async function renderPanel( payload ) {
	const calls = [];
	apiFetch.mockImplementation( ( request ) => {
		calls.push( request );
		if ( request.path === STATUS_PATH ) {
			return Promise.resolve( payload );
		}
		if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( { success: true } );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect( screen.queryByText( 'Loading workflow…' ) ).toBeNull()
	);

	return calls;
}

describe( 'WorkflowPanel claim and release', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore();
	} );

	it( 'shows the claimer and a Release that clears the claim', async () => {
		const calls = await renderPanel(
			status( { claimed_by: person( 5, 'Riley Reviewer', true ) } )
		);

		expect( screen.getByText( 'Claimed by:' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Riley Reviewer' ) ).toBeInTheDocument();

		await act( async () => {
			screen.getByRole( 'button', { name: 'Release' } ).click();
		} );

		expect(
			calls.some(
				( c ) => c.path === UNCLAIM_PATH && c.method === 'DELETE'
			)
		).toBe( true );
	} );

	it( 'offers no Release on someone else’s claim', async () => {
		await renderPanel(
			status( { claimed_by: person( 9, 'Sam Someone', false ) } )
		);

		expect( screen.getByText( 'Sam Someone' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Release' } )
		).toBeNull();
	} );

	it( 'offers no Release beside a transition assignment', async () => {
		await renderPanel(
			status( { assigned_to: person( 5, 'Riley Reviewer', true ) } )
		);

		expect( screen.getByText( 'Assigned to:' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Claimed by:' ) ).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Release' } )
		).toBeNull();
	} );
} );
