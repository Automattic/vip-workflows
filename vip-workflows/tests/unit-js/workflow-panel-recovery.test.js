/**
 * The header's "Show Workflow panel" action.
 *
 * Where core's Summary panel cannot draw the Workflow and metadata rows, the
 * Workflow document panel carries them — and a person can switch that panel
 * off in Preferences → Panels. The action is the way back, offered only while
 * the rows are out of reach AND something waits on them: a move held on an
 * empty required field, or an orphaned post.
 *
 * @package
 */

import { render, screen, act, fireEvent } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
	useEntityProp: () => [ {}, () => {} ],
} ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/edit-post', () => ( { store: 'core/edit-post' } ) );

// eslint-disable-next-line import/first
import { createReduxStore, dispatch, register, select } from '@wordpress/data';
// eslint-disable-next-line import/first
import { SlotFillProvider, Slot } from '@wordpress/components';

const PANEL = 'vip-workflows/workflow';

/*
 * Core's panel state, as much of it as the action reads and writes: removed
 * panels (code), inactive panels and open panels (the person's preferences).
 * The toggles flip membership the way core's do, and every call is recorded.
 */
const mockCalls = [];
const NO_META = {};
const toggle = ( list, name ) =>
	list.includes( name )
		? list.filter( ( n ) => n !== name )
		: [ ...list, name ];

register(
	createReduxStore( 'core/editor', {
		reducer: (
			state = { removed: [], inactive: [], open: [] },
			action
		) => {
			switch ( action.type ) {
				case 'SET':
					return { ...state, ...action.state };
				case 'TOGGLE_ENABLED':
					return {
						...state,
						inactive: toggle( state.inactive, action.name ),
					};
				case 'TOGGLE_OPENED':
					return {
						...state,
						open: toggle( state.open, action.name ),
					};
				default:
					return state;
			}
		},
		selectors: {
			isEditorPanelRemoved: ( state, name ) =>
				state.removed.includes( name ),
			isEditorPanelEnabled: ( state, name ) =>
				! state.removed.includes( name ) &&
				! state.inactive.includes( name ),
			isEditorPanelOpened: ( state, name ) => state.open.includes( name ),
			getEditedPostAttribute: ( state, attribute ) =>
				'meta' === attribute ? NO_META : 'draft',
			getCurrentPostId: () => 42,
		},
		actions: {
			set: ( state ) => ( { type: 'SET', state } ),
			toggleEditorPanelEnabled: ( name ) => {
				mockCalls.push( [ 'toggleEditorPanelEnabled', name ] );
				return { type: 'TOGGLE_ENABLED', name };
			},
			toggleEditorPanelOpened: ( name ) => {
				mockCalls.push( [ 'toggleEditorPanelOpened', name ] );
				return { type: 'TOGGLE_OPENED', name };
			},
		},
	} )
);

register(
	createReduxStore( 'core/interface', {
		reducer: ( state = {} ) => state,
		actions: {
			enableComplementaryArea: ( scope, area ) => {
				mockCalls.push( [ 'enableComplementaryArea', scope, area ] );
				return { type: 'NOOP' };
			},
		},
	} )
);

// eslint-disable-next-line import/first
import { seedEditorStore, STORE_NAME } from './helpers/editor-store';
// eslint-disable-next-line import/first
import {
	WorkflowPanelBody,
	WorkflowPanelRecovery,
} from '../../src/editor/components/WorkflowPanelRecovery';

const REQUIRED_FIELD = {
	meta_key: '_vip_workflows_section',
	label: 'Section Name',
	type: 'text',
	required: true,
};

const status = ( overrides = {} ) => ( {
	has_workflow: true,
	sequence: { id: 7, name: 'Weekend Magazine', slug: 'weekend-magazine' },
	current: { key: 'ready', label: 'Ready', color: '#666' },
	transitions: [],
	all_statuses: [],
	metadata_fields: [],
	...overrides,
} );

// A move held on an empty required field.
const HELD = status( {
	metadata_fields: [ REQUIRED_FIELD ],
	transitions: [
		{
			to: 'publish',
			label: 'Publish',
			_locked: true,
			_locked_code: 'required_fields_missing',
			_locked_reason: 'Required fields are empty: Section Name',
		},
	],
} );

const ORPHANED = {
	has_workflow: false,
	orphaned: true,
	transitions: [],
	metadata_fields: [],
};

/**
 * Seat the stores: the post's workflow state, and core's panel state.
 *
 * @param {Object} workflow   The status payload.
 * @param {Object} panelState Core's removed / inactive / open panels.
 */
async function seat( workflow, panelState ) {
	await act( async () => {
		seedEditorStore( { summaryRowsMounted: 0, summaryRowsSeen: false } );
		dispatch( STORE_NAME ).receiveWorkflowStatus( workflow );
		dispatch( 'core/editor' ).set( {
			removed: [],
			inactive: [],
			open: [],
			...panelState,
		} );
	} );
}

const renderHeader = () =>
	render(
		<SlotFillProvider>
			<Slot name="PinnedItems/core" />
			<WorkflowPanelRecovery />
		</SlotFillProvider>
	);

const queryAction = () =>
	screen.queryByRole( 'button', { name: 'Show Workflow panel' } );

// Summary panel removed (rows only in the Workflow panel), Workflow panel off.
const HIDDEN = { removed: [ 'post-status' ], inactive: [ PANEL ] };

describe( 'WorkflowPanelRecovery', () => {
	beforeEach( () => {
		mockCalls.length = 0;
		apiFetch.mockReset();
		apiFetch.mockImplementation( () => Promise.resolve( HELD ) );
	} );

	it( 'is offered for a held move while the only copy of the rows is switched off', async () => {
		await seat( HELD, HIDDEN );
		renderHeader();
		expect( queryAction() ).toBeInTheDocument();
	} );

	it( 'is offered for an orphaned post in the same configuration', async () => {
		await seat( ORPHANED, HIDDEN );
		renderHeader();
		expect( queryAction() ).toBeInTheDocument();
	} );

	it( 'is not offered while the Workflow panel is on', async () => {
		await seat( HELD, { removed: [ 'post-status' ] } );
		renderHeader();
		expect( queryAction() ).not.toBeInTheDocument();
	} );

	it( 'is not offered while the Summary panel shows the rows', async () => {
		await seat( HELD, { inactive: [ PANEL ] } );
		renderHeader();
		expect( queryAction() ).not.toBeInTheDocument();
	} );

	it( 'is not offered while nothing is waiting on the rows', async () => {
		await seat( status(), HIDDEN );
		renderHeader();
		expect( queryAction() ).not.toBeInTheDocument();
	} );

	it( 'is not offered for a panel removed in code, which no preference restores', async () => {
		await seat( HELD, {
			removed: [ 'post-status', PANEL ],
			inactive: [ PANEL ],
		} );
		renderHeader();
		expect( queryAction() ).not.toBeInTheDocument();
	} );

	it( 'turns the panel on, expands it, opens the Post tab and asks for focus', async () => {
		await seat( HELD, HIDDEN );
		renderHeader();

		await act( async () => {
			fireEvent.click( queryAction() );
		} );

		expect( mockCalls ).toEqual( [
			[ 'toggleEditorPanelEnabled', PANEL ],
			[ 'toggleEditorPanelOpened', PANEL ],
			[ 'enableComplementaryArea', 'core', 'edit-post/document' ],
		] );
		expect( select( 'core/editor' ).isEditorPanelEnabled( PANEL ) ).toBe(
			true
		);
		expect( select( 'core/editor' ).isEditorPanelOpened( PANEL ) ).toBe(
			true
		);
		expect( select( STORE_NAME ).isWorkflowPanelFocusRequested() ).toBe(
			true
		);

		// The panel is back, so the action withdraws itself.
		expect( queryAction() ).not.toBeInTheDocument();
	} );

	it( 'leaves an already-expanded panel expanded', async () => {
		await seat( HELD, { ...HIDDEN, open: [ PANEL ] } );
		renderHeader();

		await act( async () => {
			fireEvent.click( queryAction() );
		} );

		expect( mockCalls ).toEqual( [
			[ 'toggleEditorPanelEnabled', PANEL ],
			[ 'enableComplementaryArea', 'core', 'edit-post/document' ],
		] );
		expect( select( 'core/editor' ).isEditorPanelOpened( PANEL ) ).toBe(
			true
		);
	} );
} );

describe( 'WorkflowPanelBody', () => {
	it( 'takes focus once when it mounts under a focus request', async () => {
		await seat( status(), {} );
		await act( async () => {
			dispatch( STORE_NAME ).showWorkflowPanel();
		} );

		await act( async () => {
			render(
				<WorkflowPanelBody>
					<button>Inside</button>
				</WorkflowPanelBody>
			);
		} );

		const body = document.querySelector(
			'.vip-workflows-document-panel__body'
		);
		expect( body ).toHaveFocus();
		expect( select( STORE_NAME ).isWorkflowPanelFocusRequested() ).toBe(
			false
		);
	} );

	it( 'leaves focus alone when nothing asked for it', async () => {
		await seat( status(), {} );
		await act( async () => {
			render(
				<WorkflowPanelBody>
					<button>Inside</button>
				</WorkflowPanelBody>
			);
		} );

		expect(
			document.querySelector( '.vip-workflows-document-panel__body' )
		).not.toHaveFocus();
	} );
} );
