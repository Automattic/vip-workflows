/**
 * The workflow row: which sequence the post is in, and the one control that
 * changes it.
 *
 * The sequence used to be an unlabelled `<h2>` once a workflow was assigned —
 * which named the panel but offered no way to change what it named — beside a
 * select-plus-Start form in the state before one was. Both are now the same
 * document-sidebar row: a label beside a value you press, whose popover holds a
 * searchable list. These tests pin the row in both states, the confirm that
 * stands in front of giving up a place in a sequence, and the two branches that
 * deliberately get no picker at all.
 *
 * They also pin the single-sourcing the row sits on: a removal performed
 * anywhere in the editor — the publish veto's escape hatch dispatches exactly
 * the store action driven here — reaches the panel without remounting it.
 *
 * @package
 */

import {
	render,
	screen,
	waitFor,
	act,
	fireEvent,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

/*
 * `@wordpress/core-data` pulls @wordpress/sync, which needs TextEncoder that
 * jsdom does not provide. The store only uses it to name the store it refreshes
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
import { createReduxStore, dispatch, register } from '@wordpress/data';

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
			getEditedPostAttribute: () => 'draft',
			getCurrentPostAttribute: () => 'draft',
			isEditedPostDirty: () => false,
		},
		actions: { savePost: () => ( { type: 'NOOP' } ) },
	} )
);

// eslint-disable-next-line import/first
import { STORE_NAME, seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';

const STATUS_PATH = '/vip-workflow/v1/workflow/post/42/status';
const SEQUENCE_PATH = '/vip-workflow/v1/workflow/post/42/sequence';
const IDEATION_PATH = '/vip-workflow/v1/workflow/post/42/ideation';

const AVAILABLE = [
	{ id: 7, name: 'Weekend Magazine', slug: 'weekend-magazine' },
	{ id: 9, name: 'Breaking News', slug: 'breaking-news' },
];

/**
 * A status payload for a post enrolled in Weekend Magazine.
 *
 * @return {Object} Status endpoint response.
 */
function assignedStatus() {
	return {
		has_workflow: true,
		sequence: {
			id: 7,
			name: 'Weekend Magazine',
			slug: 'weekend-magazine',
		},
		current: {
			key: 'draft_desk',
			label: 'Draft Desk',
			color: '#666',
			is_terminal: false,
		},
		transitions: [],
		all_statuses: [],
		available_sequences: AVAILABLE,
	};
}

/**
 * A status payload for a post in no workflow, with sequences to choose from.
 *
 * @param {Array} available Sequences the post may be started in.
 * @return {Object} Status endpoint response.
 */
function unassignedStatus( available = AVAILABLE ) {
	return {
		has_workflow: false,
		orphaned: false,
		sequence: null,
		current: null,
		transitions: [],
		all_statuses: [],
		available_sequences: available,
	};
}

/**
 * Every GET the status endpoint has received.
 *
 * @return {Array} The status reads.
 */
function statusReads() {
	return apiFetch.mock.calls.filter(
		( [ { path, method } ] ) => path === STATUS_PATH && ! method
	);
}

/**
 * Every sequence assignment POST.
 *
 * @return {Array} The assignment calls.
 */
function assignPosts() {
	return apiFetch.mock.calls.filter(
		( [ { path, method } ] ) => path === SEQUENCE_PATH && 'POST' === method
	);
}

/**
 * Point apiFetch at a status payload and render the panel.
 *
 * @param {Object} status          Status endpoint response.
 * @param {Object} [opts]          Options.
 * @param {Object} [opts.onAssign] Payload the assignment POST answers with.
 * @param {Object} [opts.ideation] Payload the ideation endpoint answers with.
 */
async function renderPanel( status, { onAssign = null, ideation = {} } = {} ) {
	let current = status;

	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && ! method ) {
			return Promise.resolve( current );
		}
		if ( path === SEQUENCE_PATH && 'POST' === method ) {
			current = onAssign || current;
			return Promise.resolve( current );
		}
		if ( path === SEQUENCE_PATH && 'DELETE' === method ) {
			current = unassignedStatus();
			return Promise.resolve( true );
		}
		if ( path === IDEATION_PATH && ! method ) {
			return Promise.resolve( ideation );
		}
		if ( path.startsWith( '/vip-workflow/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect(
			screen.queryByText( 'Loading workflow…' )
		).not.toBeInTheDocument()
	);
}

/**
 * Open the row's popover and pick a sequence by name.
 *
 * @param {string} triggerName Accessible name of the row's value trigger.
 * @param {string} optionName  Sequence to choose.
 */
async function pickWorkflow( triggerName, optionName ) {
	fireEvent.click( screen.getByRole( 'button', { name: triggerName } ) );

	const combobox = await screen.findByRole( 'combobox' );
	fireEvent.focus( combobox );
	// The list is local, so ComboboxControl filters it itself — typing is the
	// search, not a request.
	fireEvent.change( combobox, {
		target: { value: optionName.slice( 0, 5 ) },
	} );

	await act( async () => {
		fireEvent.click(
			await screen.findByRole( 'option', { name: optionName } )
		);
	} );
}

describe( 'WorkflowPanel workflow row', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore();
	} );

	it( 'names the sequence in a labelled row, not a heading', async () => {
		await renderPanel( assignedStatus() );

		expect( screen.getByText( 'Workflow' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'Change workflow: Weekend Magazine',
			} )
		).toHaveTextContent( 'Weekend Magazine' );

		// The heading the row replaced is gone: a name you cannot act on is
		// not what the sidebar owes the reader.
		expect(
			screen.queryByRole( 'heading', { name: 'Weekend Magazine' } )
		).not.toBeInTheDocument();
	} );

	it( 'offers the same row, empty, when the post is in no workflow', async () => {
		await renderPanel( unassignedStatus() );

		expect( screen.getByText( 'Workflow' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Select a workflow' } )
		).toHaveTextContent( 'Select a workflow' );

		// The select-plus-Start form is gone with it: picking IS starting.
		expect(
			screen.queryByRole( 'button', { name: 'Start' } )
		).not.toBeInTheDocument();
	} );

	/**
	 * The row shares its primitive with the metadata rows below it, and that
	 * primitive learned an invalid state when a required field started holding
	 * a move. Which sequence a post is in is never a required field, so this
	 * row must never wear it: no `aria-invalid`, no message associated with the
	 * trigger, and no `--invalid` class for the error tone and boundary to key
	 * off. `SidebarRow`'s invalid treatment is opt-in, and this is the consumer
	 * that never opts in.
	 */
	it( 'never wears the invalid treatment the metadata rows can', async () => {
		await renderPanel( assignedStatus() );

		const trigger = screen.getByRole( 'button', {
			name: 'Change workflow: Weekend Magazine',
		} );

		expect( trigger ).not.toHaveAttribute( 'aria-invalid' );
		expect( trigger ).not.toHaveAttribute( 'aria-describedby' );
		expect(
			trigger.closest( '.vip-workflow-sidebar-row' )
		).not.toHaveClass( 'vip-workflow-sidebar-row--invalid' );
	} );

	it( 'assigns straight from the combobox, with nothing else to press', async () => {
		await renderPanel( unassignedStatus(), { onAssign: assignedStatus() } );

		await pickWorkflow( 'Select a workflow', 'Weekend Magazine' );

		expect( assignPosts() ).toHaveLength( 1 );
		expect( assignPosts()[ 0 ][ 0 ].data ).toEqual( { sequence_id: 7 } );

		// The POST answers with the post's new state, so the row adopts it
		// without a second read.
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', {
					name: 'Change workflow: Weekend Magazine',
				} )
			).toBeInTheDocument()
		);
	} );

	it( 'asks before moving an enrolled post to a different sequence', async () => {
		await renderPanel( assignedStatus() );

		await pickWorkflow(
			'Change workflow: Weekend Magazine',
			'Breaking News'
		);

		expect(
			screen.getByText( 'Change this post’s workflow?' )
		).toBeInTheDocument();
		// The consequence is named: the post gives up where it had got to.
		expect(
			screen.getByText( /gives up its place in “Weekend Magazine”/ )
		).toBeInTheDocument();
		expect( assignPosts() ).toHaveLength( 0 );
	} );

	it( 'declining the switch confirm leaves the post where it is', async () => {
		await renderPanel( assignedStatus() );

		await pickWorkflow(
			'Change workflow: Weekend Magazine',
			'Breaking News'
		);
		await act( async () => {
			screen.getByRole( 'button', { name: 'Cancel' } ).click();
		} );

		expect( assignPosts() ).toHaveLength( 0 );
		expect(
			screen.getByRole( 'button', {
				name: 'Change workflow: Weekend Magazine',
			} )
		).toBeInTheDocument();
	} );

	it( 'confirming the switch performs the re-assignment', async () => {
		await renderPanel( assignedStatus() );

		await pickWorkflow(
			'Change workflow: Weekend Magazine',
			'Breaking News'
		);
		await act( async () => {
			screen.getByRole( 'button', { name: 'Change workflow' } ).click();
		} );

		expect( assignPosts() ).toHaveLength( 1 );
		expect( assignPosts()[ 0 ][ 0 ].data ).toEqual( { sequence_id: 9 } );
	} );

	it( 'surfaces a refused assignment rather than swallowing it', async () => {
		await renderPanel( unassignedStatus() );

		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === SEQUENCE_PATH && 'POST' === method ) {
				return Promise.reject( {
					code: 'unmodeled_post_status',
					message:
						'The "Weekend Magazine" sequence has no stage with the Draft status.',
				} );
			}
			return Promise.resolve( unassignedStatus() );
		} );

		await pickWorkflow( 'Select a workflow', 'Weekend Magazine' );

		await waitFor( () =>
			expect(
				screen.getByText( /has no stage with the Draft status/ )
			).toBeInTheDocument()
		);
	} );

	it( 'a removal from outside the panel reaches it, without remounting it', async () => {
		await renderPanel( assignedStatus() );

		const readsBefore = statusReads().length;

		// Exactly what the publish veto's escape hatch dispatches: the panel
		// did not initiate this and is not a child of whatever did.
		await act( async () => {
			await dispatch( STORE_NAME ).removeWorkflow();
		} );

		// The removed sequence is gone from the row, in this same panel — the
		// failure this replaced was the panel drawing it until a page reload.
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Select a workflow' } )
			).toBeInTheDocument()
		);
		expect(
			screen.queryByText( 'Weekend Magazine' )
		).not.toBeInTheDocument();

		// One read, the removal's own. A remounted panel would have run its
		// mount effect and asked a second time.
		expect( statusReads().length - readsBefore ).toBe( 1 );
	} );

	it( 'offers an orphaned post no picker at all', async () => {
		// Re-assigning on top of a dangling workflow identity buries the broken
		// state instead of clearing it, so the server offers no sequences and
		// the panel offers no row.
		await renderPanel( {
			has_workflow: false,
			orphaned: true,
			sequence: null,
			current: null,
			transitions: [],
			all_statuses: [],
			available_sequences: [],
		} );

		expect( screen.queryByText( 'Workflow' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Remove from workflow' } )
		).toBeInTheDocument();
	} );

	it( 'surfaces a failed removal from the orphaned branch rather than swallowing it', async () => {
		// Regression: this branch's return did not render `actionError` at
		// all, so a removal that failed here — a permission hiccup, a network
		// blip, a server error — looked identical to the button doing
		// nothing. There was no error, no state change, nothing to tell the
		// author it had not worked.
		await renderPanel( {
			has_workflow: false,
			orphaned: true,
			sequence: null,
			current: null,
			transitions: [],
			all_statuses: [],
			available_sequences: [],
		} );

		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === SEQUENCE_PATH && 'DELETE' === method ) {
				return Promise.reject( {
					message: 'The removal could not be completed.',
				} );
			}
			return Promise.resolve( {} );
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Remove from workflow' } )
		);

		// The confirm dialog's own action shares the trigger's exact label
		// (both come from getRemoveFromWorkflowLabel()), but the Modal marks
		// the rest of the page `aria-hidden` while it is open, so the trigger
		// behind it drops out of the accessibility tree and this still
		// resolves to exactly one button: the dialog's own.
		const confirmButton = await screen.findByRole( 'button', {
			name: 'Remove from workflow',
		} );

		await act( async () => {
			confirmButton.click();
		} );

		await waitFor( () =>
			expect(
				screen.getByText( 'The removal could not be completed.' )
			).toBeInTheDocument()
		);

		// The button itself is still there — removal genuinely failed, so
		// the orphaned state (and its one way out) has to remain on screen.
		expect(
			screen.getByRole( 'button', { name: 'Remove from workflow' } )
		).toBeInTheDocument();
	} );

	it( 'says so plainly when this post type has no sequences', async () => {
		await renderPanel( unassignedStatus( [] ) );

		expect(
			screen.getByText( 'No workflow available for this post type.' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Workflow' ) ).not.toBeInTheDocument();
	} );

	it( 'shows ideation research before a workflow is assigned', async () => {
		await renderPanel( unassignedStatus( [] ), {
			ideation: {
				project_id: 19,
				source: { title: 'City desk briefing' },
				items: [],
			},
		} );

		expect(
			await screen.findByText( 'From Ideation' )
		).toBeInTheDocument();
		expect( screen.getByText( 'City desk briefing' ) ).toBeInTheDocument();
	} );
} );
