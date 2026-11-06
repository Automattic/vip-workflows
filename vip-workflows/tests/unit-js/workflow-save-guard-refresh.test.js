/**
 * The save guard re-reads the workflow state once a re-seating save lands.
 *
 * A status change confirmed through the guard re-seats the post server-side,
 * but the write is core's — so none of the sidebar's own refresh paths run, and
 * the sidebar went on drawing the pre-save stage until a reload. These tests pin
 * that the guard re-reads the status endpoint on the saving -> saved edge of
 * exactly that save, and not for autosaves, failed saves, declined changes or
 * saves that changed no status.
 *
 * @package
 */

import { render, screen, act, waitFor } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

/*
 * `@wordpress/core-data` pulls @wordpress/sync, which needs TextEncoder that
 * jsdom does not provide. The store only uses it to name the store it refreshes
 * the post entity on.
 */
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );

/*
 * `@wordpress/editor` pulls @wordpress/blocks, whose ESM-only dependencies Jest
 * cannot parse. A named test store stands in, carrying the save-state
 * selectors the guard watches.
 */
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register, dispatch, select } from '@wordpress/data';
// eslint-disable-next-line import/first
import { applyFiltersAsync } from '@wordpress/hooks';

register(
	createReduxStore( 'core/editor', {
		reducer: (
			state = { saving: false, autosaving: false, succeeded: false },
			action
		) =>
			'SET_SAVE_STATE' === action.type
				? { ...state, ...action.saveState }
				: state,
		selectors: {
			isSavingPost: ( state ) => state.saving,
			isAutosavingPost: ( state ) => state.autosaving,
			didPostSaveRequestSucceed: ( state ) => state.succeeded,
			getCurrentPost: () => ( { status: 'publish' } ),
			getEditedPostAttribute: () => 'A post',
		},
		actions: {
			editPost: () => ( { type: 'NOOP' } ),
			setSaveState: ( saveState ) => ( {
				type: 'SET_SAVE_STATE',
				saveState,
			} ),
		},
	} )
);

// eslint-disable-next-line import/first
import { seedEditorStore, STORE_NAME } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowSaveGuard } from '../../src/editor/components/WorkflowSaveGuard';

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';

/**
 * A completed workflow on a published post — the state the sidebar kept
 * drawing after the post was switched back to draft.
 *
 * @param {string} stageKey The stage the post sits at.
 * @return {Object} Status endpoint response.
 */
function statusResponse( stageKey ) {
	return {
		has_workflow: true,
		sequence: { id: 1, name: 'Editorial' },
		current: { key: stageKey },
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
			current_region: 'publish',
			can_bypass: true,
			agent_pending: false,
		},
	};
}

/**
 * Every status read apiFetch has received.
 *
 * @return {number} How many times the status endpoint was read.
 */
function statusReads() {
	return apiFetch.mock.calls.filter(
		( [ { path } ] ) => path === STATUS_PATH
	).length;
}

/**
 * Drive core's save state through one save.
 *
 * @param {Object}  options
 * @param {boolean} options.autosave  Whether the save is an autosave.
 * @param {boolean} options.succeeded Whether the request succeeded.
 */
async function completeSave( { autosave = false, succeeded = true } = {} ) {
	await act( async () => {
		dispatch( 'core/editor' ).setSaveState( {
			saving: true,
			autosaving: autosave,
			succeeded: false,
		} );
	} );
	await act( async () => {
		dispatch( 'core/editor' ).setSaveState( {
			saving: false,
			autosaving: false,
			succeeded,
		} );
	} );
}

/**
 * Run the pre-save filter for a status change and answer its confirm.
 *
 * @param {string} answer Label of the button to press.
 * @return {Promise<Object>} The edits the filter let through.
 */
async function saveStatusChange( answer ) {
	let result;
	const pending = applyFiltersAsync(
		'editor.preSavePost',
		{ status: 'draft' },
		{}
	).then( ( edits ) => {
		result = edits;
	} );

	await waitFor( () =>
		expect(
			screen.getByText( 'This changes the workflow' )
		).toBeInTheDocument()
	);

	await act( async () => {
		screen.getByRole( 'button', { name: answer } ).click();
		await pending;
	} );

	return result;
}

describe( 'WorkflowSaveGuard refresh after save', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockImplementation( () =>
			Promise.resolve( statusResponse( 'live' ) )
		);
		seedEditorStore();
		dispatch( 'core/editor' ).setSaveState( {
			saving: false,
			autosaving: false,
			succeeded: false,
		} );
		render( <WorkflowSaveGuard /> );
	} );

	it( 're-reads the workflow state once a confirmed status change has saved', async () => {
		const edits = await saveStatusChange( 'Continue' );
		expect( edits ).toEqual( { status: 'draft' } );

		// The guard's own pre-save read, and nothing more yet: the stage only
		// moves once the write commits.
		expect( statusReads() ).toBe( 1 );

		apiFetch.mockImplementation( () =>
			Promise.resolve( statusResponse( 'writing' ) )
		);
		await completeSave();

		expect( statusReads() ).toBe( 2 );
		await waitFor( () =>
			expect(
				select( STORE_NAME ).getWorkflowStatus()?.current?.key
			).toBe( 'writing' )
		);
	} );

	it( 'reads once per re-seating save, not on every save after it', async () => {
		await saveStatusChange( 'Continue' );
		await completeSave();
		await completeSave();

		expect( statusReads() ).toBe( 2 );
	} );

	it( 'leaves an autosave alone and waits for the real save', async () => {
		await saveStatusChange( 'Continue' );

		await completeSave( { autosave: true } );
		expect( statusReads() ).toBe( 1 );

		await completeSave();
		expect( statusReads() ).toBe( 2 );
	} );

	it( 'does not re-read after a save the server refused', async () => {
		await saveStatusChange( 'Continue' );
		await completeSave( { succeeded: false } );

		expect( statusReads() ).toBe( 1 );
	} );

	it( 'does not re-read after a declined status change', async () => {
		const edits = await saveStatusChange( 'Cancel' );
		expect( edits ).toEqual( {} );

		await completeSave();

		expect( statusReads() ).toBe( 1 );
	} );

	it( 'does not re-read after a save that changed no status', async () => {
		await act( async () => {
			await applyFiltersAsync(
				'editor.preSavePost',
				{ title: 'New title' },
				{}
			);
		} );
		await completeSave();

		expect( statusReads() ).toBe( 0 );
	} );
} );
