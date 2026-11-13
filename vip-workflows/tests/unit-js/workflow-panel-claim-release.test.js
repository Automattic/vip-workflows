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
import { speak } from '@wordpress/a11y';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/edit-post', () => ( { store: 'core/edit-post' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

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

import { seedEditorStore } from './helpers/editor-store';
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
		speak.mockClear();
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

	it( 're-reads the post when Release is refused, so a stale claim row goes', async () => {
		// The panel still shows a claim another tab already released.
		let claimed = true;
		const calls = [];
		apiFetch.mockImplementation( ( request ) => {
			calls.push( request );
			if ( request.path === STATUS_PATH ) {
				return Promise.resolve(
					status( {
						claimed_by: claimed
							? person( 5, 'Riley Reviewer', true )
							: null,
					} )
				);
			}
			if ( request.path === UNCLAIM_PATH ) {
				claimed = false;
				return Promise.reject( {
					code: 'post_not_claimed',
					message:
						'This post is not claimed, so there is nothing to release.',
				} );
			}
			if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		render( <WorkflowPanel /> );
		await waitFor( () =>
			expect( screen.getByText( 'Claimed by:' ) ).toBeInTheDocument()
		);

		await act( async () => {
			screen.getByRole( 'button', { name: 'Release' } ).click();
		} );

		await waitFor( () =>
			expect( screen.queryByText( 'Claimed by:' ) ).toBeNull()
		);
		expect(
			screen.getByText(
				'This post is not claimed, so there is nothing to release.'
			)
		).toBeInTheDocument();
		expect(
			calls.filter( ( c ) => c.path === STATUS_PATH ).length
		).toBeGreaterThan( 1 );
	} );

	it( 'keeps Release busy until the re-read lands, then moves focus to Claim', async () => {
		let claimed = true;
		let finishRead;
		apiFetch.mockImplementation( ( request ) => {
			if ( request.path === STATUS_PATH ) {
				const payload = status( {
					claimed_by: claimed
						? person( 5, 'Riley Reviewer', true )
						: null,
					can_claim: ! claimed,
				} );
				if ( claimed ) {
					return Promise.resolve( payload );
				}
				// The re-read after Release is slow.
				return new Promise( ( resolve ) => {
					finishRead = () => resolve( payload );
				} );
			}
			if ( request.path === UNCLAIM_PATH ) {
				claimed = false;
				return Promise.resolve( { success: true } );
			}
			if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		render( <WorkflowPanel /> );
		const release = await screen.findByRole( 'button', {
			name: 'Release',
		} );
		release.focus();

		await act( async () => {
			release.click();
		} );

		await waitFor( () => expect( finishRead ).toBeDefined() );
		expect( release ).toBeDisabled();

		await act( async () => {
			finishRead();
		} );

		const claim = await screen.findByRole( 'button', { name: 'Claim' } );
		await waitFor( () => expect( claim ).toHaveFocus() );
		expect(
			screen.queryByRole( 'button', { name: 'Release' } )
		).toBeNull();
		expect( speak ).toHaveBeenCalledWith( 'Claim released.' );
	} );

	it( 'moves focus to the panel when Release leaves no Claim to offer', async () => {
		let claimed = true;
		apiFetch.mockImplementation( ( request ) => {
			if ( request.path === STATUS_PATH ) {
				return Promise.resolve(
					status( {
						claimed_by: claimed
							? person( 5, 'Riley Reviewer', true )
							: null,
					} )
				);
			}
			if ( request.path === UNCLAIM_PATH ) {
				claimed = false;
				return Promise.resolve( { success: true } );
			}
			if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		const { container } = render( <WorkflowPanel /> );
		const release = await screen.findByRole( 'button', {
			name: 'Release',
		} );
		release.focus();

		await act( async () => {
			release.click();
		} );

		await waitFor( () =>
			expect(
				container.querySelector( '.vip-workflows-panel' )
			).toHaveFocus()
		);
		expect( speak ).toHaveBeenCalledWith( 'Claim released.' );
	} );

	it( 'moves focus to the panel when the re-read finds the post out of its workflow', async () => {
		let claimed = true;
		apiFetch.mockImplementation( ( request ) => {
			if ( request.path === STATUS_PATH ) {
				return Promise.resolve(
					claimed
						? status( {
								claimed_by: person( 5, 'Riley Reviewer', true ),
							} )
						: { has_workflow: false, available_sequences: [] }
				);
			}
			if ( request.path === UNCLAIM_PATH ) {
				claimed = false;
				return Promise.resolve( { success: true } );
			}
			if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		const { container } = render( <WorkflowPanel /> );
		const release = await screen.findByRole( 'button', {
			name: 'Release',
		} );
		release.focus();

		await act( async () => {
			release.click();
		} );

		await waitFor( () =>
			expect(
				container.querySelector( '.vip-workflows-panel' )
			).toHaveFocus()
		);
	} );

	it( 'keeps focus on Release when the release is refused and the claim stands', async () => {
		apiFetch.mockImplementation( ( request ) => {
			if ( request.path === STATUS_PATH ) {
				return Promise.resolve(
					status( {
						claimed_by: person( 5, 'Riley Reviewer', true ),
					} )
				);
			}
			if ( request.path === UNCLAIM_PATH ) {
				// As a browser does when the focused button is disabled for
				// the write.
				document.activeElement?.blur();
				return Promise.reject( {
					code: 'rest_forbidden',
					message: 'Sorry, you are not allowed to do that.',
				} );
			}
			if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		render( <WorkflowPanel /> );
		const release = await screen.findByRole( 'button', {
			name: 'Release',
		} );
		release.focus();

		await act( async () => {
			release.click();
		} );

		await screen.findByText( 'Sorry, you are not allowed to do that.' );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Release' } )
			).toHaveFocus()
		);
		expect( speak ).not.toHaveBeenCalledWith( 'Claim released.' );
	} );

	it( 'moves focus to Release after a claim, and announces it', async () => {
		let claimed = false;
		apiFetch.mockImplementation( ( request ) => {
			if ( request.path === STATUS_PATH ) {
				return Promise.resolve(
					status( {
						claimed_by: claimed
							? person( 5, 'Riley Reviewer', true )
							: null,
						can_claim: ! claimed,
					} )
				);
			}
			if ( request.path === '/vip-workflows/v1/workflow/post/42/claim' ) {
				claimed = true;
				return Promise.resolve( { success: true } );
			}
			if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		render( <WorkflowPanel /> );
		const claim = await screen.findByRole( 'button', { name: 'Claim' } );
		claim.focus();

		await act( async () => {
			claim.click();
		} );

		const release = await screen.findByRole( 'button', {
			name: 'Release',
		} );
		await waitFor( () => expect( release ).toHaveFocus() );
		expect( speak ).toHaveBeenCalledWith( 'Post claimed.' );
	} );
} );
