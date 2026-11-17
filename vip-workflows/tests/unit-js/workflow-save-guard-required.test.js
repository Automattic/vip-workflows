/**
 * The save guard refuses publishing a post that has no workflow when the site
 * requires one.
 *
 * In "require" mode `WorkflowRequirementGuard` refuses, with a 409, publishing
 * a covered post that has no workflow. The status endpoint marks such a post
 * with `guard.workflow_required`, and the guard refuses the save before it is
 * sent, pointing at the Workflow row. When a save reaches the server anyway,
 * core shows the 409's message and the guard takes the refused status edit
 * back out, so the next save does not try to publish again.
 *
 * @package
 */

import { render, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-save-guard-refresh.test.js for why these two are stood in.
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );

import { createReduxStore, register, dispatch, select } from '@wordpress/data';
import { applyFiltersAsync } from '@wordpress/hooks';

register(
	createReduxStore( 'core/editor', {
		reducer: (
			state = {
				saving: false,
				autosaving: false,
				succeeded: false,
				title: 'Budget piece',
				edits: [],
			},
			action
		) => {
			switch ( action.type ) {
				case 'SET_SAVE_STATE':
					return { ...state, ...action.saveState };
				case 'SET_TITLE':
					return { ...state, title: action.title };
				case 'EDIT_POST':
					return {
						...state,
						edits: [ ...state.edits, action.edits ],
					};
				case 'RESET_EDITS':
					return { ...state, edits: [] };
				default:
					return state;
			}
		},
		selectors: {
			isSavingPost: ( state ) => state.saving,
			isAutosavingPost: ( state ) => state.autosaving,
			didPostSaveRequestSucceed: ( state ) => state.succeeded,
			getCurrentPost: () => ( { id: 42, type: 'post', status: 'draft' } ),
			getEditedPostAttribute: ( state ) => state.title,
			getEditPostCalls: ( state ) => state.edits,
		},
		actions: {
			editPost: ( edits ) => ( { type: 'EDIT_POST', edits } ),
			setSaveState: ( saveState ) => ( {
				type: 'SET_SAVE_STATE',
				saveState,
			} ),
			setTitle: ( title ) => ( { type: 'SET_TITLE', title } ),
			resetEdits: () => ( { type: 'RESET_EDITS' } ),
		},
	} )
);

// core-data keeps the last save error, code included.
register(
	createReduxStore( 'core', {
		reducer: ( state = { error: undefined }, action ) =>
			'SET_SAVE_ERROR' === action.type ? { error: action.error } : state,
		selectors: {
			getLastEntitySaveError: ( state, kind, name, id ) =>
				'postType' === kind && 'post' === name && 42 === id
					? state.error
					: undefined,
		},
		actions: {
			setSaveError: ( error ) => ( { type: 'SET_SAVE_ERROR', error } ),
		},
	} )
);

import { seedEditorStore } from './helpers/editor-store';
import { WorkflowSaveGuard } from '../../src/editor/components/WorkflowSaveGuard';
import {
	DECISION_SILENT,
	DECISION_VETO,
	evaluateRequiredWorkflow,
} from '../../src/common/confirm-workflow-side-effect';

/**
 * An unassigned post, as the status endpoint serves it.
 *
 * @param {Object|undefined} guard The guard payload, or undefined for none.
 * @return {Object} Status endpoint response.
 */
function statusResponse( guard ) {
	return {
		has_workflow: false,
		orphaned: false,
		post_id: 42,
		post_status: 'draft',
		sequence: null,
		current: null,
		transitions: [],
		all_statuses: [],
		available_sequences: [ { id: 1, name: 'News desk', slug: 'news' } ],
		metadata_fields: [],
		...( guard ? { guard } : {} ),
	};
}

/**
 * The guard payload for a post the requirement applies to.
 *
 * @param {Object} overrides Fields to change.
 * @return {Object} Guard payload.
 */
function requiredGuard( overrides = {} ) {
	return {
		workflow_required: true,
		current_region: 'draft',
		can_bypass: false,
		agent_pending: false,
		...overrides,
	};
}

/**
 * Run the pre-save filter for a status change.
 *
 * @param {string} targetStatus Status the save would write.
 * @return {Promise<{edits: Object|undefined, error: Error|undefined}>} What the filter returned or threw.
 */
async function preSave( targetStatus ) {
	try {
		const edits = await applyFiltersAsync(
			'editor.preSavePost',
			{ status: targetStatus, title: 'Budget piece' },
			{}
		);
		return { edits, error: undefined };
	} catch ( error ) {
		return { edits: undefined, error };
	}
}

/**
 * Drive core's save state through one save that ends with the given error.
 *
 * @param {Object|undefined} error         Last save error core-data holds afterwards.
 * @param {Object}           opts
 * @param {boolean}          opts.autosave Whether the save is an autosave.
 */
async function finishSave( error, { autosave = false } = {} ) {
	await act( async () => {
		dispatch( 'core/editor' ).setSaveState( {
			saving: true,
			autosaving: autosave,
			succeeded: false,
		} );
	} );
	await act( async () => {
		dispatch( 'core' ).setSaveError( error );
		dispatch( 'core/editor' ).setSaveState( {
			saving: false,
			autosaving: false,
			succeeded: ! error,
		} );
	} );
}

const statusRestores = () =>
	select( 'core/editor' )
		.getEditPostCalls()
		.filter( ( edits ) => 'draft' === edits.status ).length;

describe( 'evaluateRequiredWorkflow', () => {
	it.each( [
		[ 'publish', 'draft', false, DECISION_VETO ],
		[ 'future', 'draft', false, DECISION_VETO ],
		[ 'publish', 'pending', false, DECISION_VETO ],
		[ 'publish', 'private', false, DECISION_VETO ],
		[ 'publish', 'trash', false, DECISION_VETO ],
		[ 'publish', 'draft', true, DECISION_SILENT ],
		[ 'pending', 'draft', false, DECISION_SILENT ],
		[ 'private', 'draft', false, DECISION_SILENT ],
		[ 'draft', 'publish', false, DECISION_SILENT ],
		[ 'future', 'publish', false, DECISION_SILENT ],
	] )(
		'target %s from region %s (on the bypass list: %s) is %s',
		( targetStatus, currentRegion, canBypass, expected ) => {
			expect(
				evaluateRequiredWorkflow( {
					currentRegion,
					targetStatus,
					canBypass,
				} )
			).toBe( expected );
		}
	);
} );

describe( 'WorkflowSaveGuard when a workflow is required', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore();
		dispatch( 'core/editor' ).resetEdits();
		dispatch( 'core/editor' ).setTitle( 'Budget piece' );
		dispatch( 'core/editor' ).setSaveState( {
			saving: false,
			autosaving: false,
			succeeded: false,
		} );
		dispatch( 'core' ).setSaveError( undefined );
		render( <WorkflowSaveGuard /> );
	} );

	it( 'refuses Publish before the save and points at the Workflow row', async () => {
		apiFetch.mockResolvedValue( statusResponse( requiredGuard() ) );

		const { error } = await preSave( 'publish' );

		expect( error.message ).toBe(
			'“Budget piece” can’t be published without a workflow. Choose one in the Workflow row, then move it to a published stage.'
		);
		expect( statusRestores() ).toBe( 1 );
	} );

	it( 'refuses Schedule the same way', async () => {
		apiFetch.mockResolvedValue( statusResponse( requiredGuard() ) );

		const { error } = await preSave( 'future' );

		expect( error ).toBeInstanceOf( Error );
		expect( statusRestores() ).toBe( 1 );
	} );

	it( 'names no title when the post has none', async () => {
		apiFetch.mockResolvedValue( statusResponse( requiredGuard() ) );
		dispatch( 'core/editor' ).setTitle( '' );

		const { error } = await preSave( 'publish' );

		expect( error.message ).toBe(
			'This post can’t be published without a workflow. Choose one in the Workflow row, then move it to a published stage.'
		);
	} );

	it.each( [
		[ 'a pending save', 'pending', requiredGuard() ],
		[
			'a user with an override role',
			'publish',
			requiredGuard( { can_bypass: true } ),
		],
		[
			'an already published post',
			'publish',
			requiredGuard( { current_region: 'publish' } ),
		],
		[ 'a site that does not require a workflow', 'publish', undefined ],
	] )( 'lets %s through untouched', async ( _label, target, guard ) => {
		apiFetch.mockResolvedValue( statusResponse( guard ) );

		const { edits, error } = await preSave( target );

		expect( error ).toBeUndefined();
		expect( edits ).toEqual( { status: target, title: 'Budget piece' } );
		expect( statusRestores() ).toBe( 0 );
	} );

	it( 'takes the status edit back out when the server refuses with the 409', async () => {
		await finishSave( {
			code: 'vip_workflows_workflow_required',
			message: 'refused',
		} );

		expect( statusRestores() ).toBe( 1 );
	} );

	it( 'leaves the status edit alone for any other save failure', async () => {
		await finishSave( { code: 'rest_cannot_edit', message: 'no' } );

		expect( statusRestores() ).toBe( 0 );
	} );

	it( 'leaves the status edit alone after a successful save or an autosave', async () => {
		await finishSave( undefined );
		await finishSave(
			{ code: 'vip_workflows_workflow_required', message: 'refused' },
			{ autosave: true }
		);

		expect( statusRestores() ).toBe( 0 );
	} );
} );
