/**
 * The workflow's rows in the document sidebar's Summary panel: which sequence
 * the post is in, the one control that changes it (and takes the post out of
 * it), and the metadata fields the sequence declares.
 *
 * Which workflow a post is in is a property of the post, so it is drawn the way
 * the Summary panel draws any other: a label beside a value you press, whose
 * popover holds a searchable list. These tests pin the row in every state the
 * status read can answer — assigned, unassigned, orphaned, and none to offer —
 * the confirms that stand in front of giving up a place in a sequence, the
 * removal that sits at the foot of the same popover, and the metadata rows
 * that follow it.
 *
 * They also pin the single-sourcing the rows sit on: a removal performed
 * anywhere in the editor — the publish veto's escape hatch dispatches exactly
 * the store action driven here — reaches the rows without remounting them.
 *
 * @package
 */

import {
	render,
	screen,
	waitFor,
	act,
	fireEvent,
	within,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

/*
 * `@wordpress/core-data` pulls @wordpress/sync, which needs TextEncoder that
 * jsdom does not provide. The store only uses it to name the store it refreshes
 * the post entity on, so the store name is all this needs.
 */
jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
	useEntityProp: () => [ { wf_meta_7_desk: 'Foreign' }, () => {} ],
} ) );

/*
 * `@wordpress/editor` pulls @wordpress/blocks, whose ESM-only dependencies Jest
 * cannot parse. The panel only needs the store's name plus a few post-state
 * selectors, so a named test store stands in for all of it.
 */
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, dispatch, register, select } from '@wordpress/data';

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
import { WorkflowSummaryRows } from '../../src/editor/components/WorkflowSummaryRows';

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';
const SEQUENCE_PATH = '/vip-workflows/v1/workflow/post/42/sequence';

/**
 * A sequence-declared metadata field, in the shape the server bootstrap
 * serves.
 */
const DESK_FIELD = {
	key: 'desk',
	meta_key: 'wf_meta_7_desk',
	label: 'Desk',
	type: 'text',
};

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
 * A status payload for a post whose sequence was deleted.
 *
 * @return {Object} Status endpoint response.
 */
function orphanedStatus() {
	return {
		has_workflow: false,
		orphaned: true,
		sequence: null,
		current: null,
		transitions: [],
		all_statuses: [],
		available_sequences: [],
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
 * Every removal DELETE.
 *
 * @return {Array} The removal calls.
 */
function removeDeletes() {
	return apiFetch.mock.calls.filter(
		( [ { path, method } ] ) =>
			path === SEQUENCE_PATH && 'DELETE' === method
	);
}

/**
 * Point apiFetch at a status payload and render the rows.
 *
 * @param {Object} status          Status endpoint response.
 * @param {Object} [opts]          Options.
 * @param {Object} [opts.onAssign] Payload the assignment POST answers with.
 */
async function renderRows( status, { onAssign = null } = {} ) {
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
		return Promise.resolve( {} );
	} );

	render( <WorkflowSummaryRows /> );

	await waitFor( () =>
		expect( select( STORE_NAME ).isWorkflowStatusResolved() ).toBe( true )
	);
}

/**
 * Open the row's popover from its value trigger.
 *
 * @param {string} triggerName Accessible name of the row's value trigger.
 * @return {Promise<HTMLElement>} The popover dialog.
 */
async function openRow( triggerName ) {
	fireEvent.click( screen.getByRole( 'button', { name: triggerName } ) );
	return screen.findByRole( 'dialog', { name: 'Workflow' } );
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

describe( 'WorkflowSummaryRows', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore( { metadataFields: [] } );
	} );

	it( 'names the sequence in a labelled row, not a heading', async () => {
		await renderRows( assignedStatus() );

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
		await renderRows( unassignedStatus() );

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
		await renderRows( assignedStatus() );

		const trigger = screen.getByRole( 'button', {
			name: 'Change workflow: Weekend Magazine',
		} );

		expect( trigger ).not.toHaveAttribute( 'aria-invalid' );
		expect( trigger ).not.toHaveAttribute( 'aria-describedby' );
		expect(
			trigger.closest( '.vip-workflows-sidebar-row' )
		).not.toHaveClass( 'vip-workflows-sidebar-row--invalid' );
	} );

	it( 'assigns straight from the combobox, with nothing else to press', async () => {
		await renderRows( unassignedStatus(), { onAssign: assignedStatus() } );

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
		await renderRows( assignedStatus() );

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
		await renderRows( assignedStatus() );

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
		await renderRows( assignedStatus() );

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
		await renderRows( unassignedStatus() );

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

	it( 'a removal from outside the rows reaches them, without remounting them', async () => {
		await renderRows( assignedStatus() );

		const readsBefore = statusReads().length;

		// Exactly what the publish veto's escape hatch dispatches: the rows
		// did not initiate this and is not a child of whatever did.
		await act( async () => {
			await dispatch( STORE_NAME ).removeWorkflow();
		} );

		// The removed sequence is gone from the row, in these same rows — the
		// failure this replaced was a panel drawing it until a page reload.
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Select a workflow' } )
			).toBeInTheDocument()
		);
		expect(
			screen.queryByText( 'Weekend Magazine' )
		).not.toBeInTheDocument();

		// One read, the removal's own. Remounted rows would have run their
		// mount effect and asked a second time.
		expect( statusReads().length - readsBefore ).toBe( 1 );
	} );

	it( 'draws an orphaned post as a row that says the workflow is gone', async () => {
		await renderRows( orphanedStatus() );

		expect( screen.getByText( 'Workflow' ) ).toBeInTheDocument();

		const trigger = screen.getByRole( 'button', {
			name: 'Workflow no longer exists',
		} );
		expect( trigger ).toHaveTextContent( 'Deleted workflow' );

		// The deleted identity is what holds every status change, so the row
		// wears the invalid state and says why.
		expect( trigger ).toHaveAttribute( 'aria-invalid', 'true' );
		expect(
			screen.getByText(
				'This post belongs to a workflow that no longer exists, so its status cannot be changed.'
			)
		).toBeInTheDocument();
	} );

	it( 'offers an orphaned post removal and no picker', async () => {
		// Re-assigning on top of a dangling workflow identity buries the broken
		// state instead of clearing it, so the popover holds the one way out.
		await renderRows( orphanedStatus() );

		await openRow( 'Workflow no longer exists' );

		expect( screen.queryByRole( 'combobox' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Remove from workflow' } )
		).toBeInTheDocument();
	} );

	it( 'offers an orphaned post removal even where the workflow is enforced', async () => {
		seedEditorStore( {
			metadataFields: [],
			workflowEnforcement: 'require',
		} );
		await renderRows( orphanedStatus() );

		await openRow( 'Workflow no longer exists' );

		expect(
			screen.getByRole( 'button', { name: 'Remove from workflow' } )
		).toBeInTheDocument();
	} );

	it( 'surfaces a failed removal of an orphaned post rather than swallowing it', async () => {
		await renderRows( orphanedStatus() );

		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === SEQUENCE_PATH && 'DELETE' === method ) {
				return Promise.reject( {
					message: 'The removal could not be completed.',
				} );
			}
			return Promise.resolve( {} );
		} );

		await openRow( 'Workflow no longer exists' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Remove from workflow' } )
		);

		// The popover closed when Remove was pressed, so the only button of
		// that name left is the confirm dialog's own.
		const confirmButton = await screen.findByRole( 'button', {
			name: 'Remove from workflow',
		} );
		expect(
			screen.getByText( /Remove this post from its deleted workflow\?/ )
		).toBeInTheDocument();

		await act( async () => {
			confirmButton.click();
		} );

		await waitFor( () =>
			expect(
				screen.getByText( 'The removal could not be completed.' )
			).toBeInTheDocument()
		);

		// Removal genuinely failed, so the orphaned row stays on screen.
		expect(
			screen.getByRole( 'button', { name: 'Workflow no longer exists' } )
		).toBeInTheDocument();
	} );

	it( 'offers removal at the foot of the Workflow popover, below the list', async () => {
		await renderRows( assignedStatus() );

		const dialog = await openRow( 'Change workflow: Weekend Magazine' );

		const combobox = screen.getByRole( 'combobox' );
		const remove = screen.getByRole( 'button', {
			name: 'Remove from workflow',
		} );

		expect( dialog ).toContainElement( remove );
		expect(
			// eslint-disable-next-line no-bitwise
			combobox.compareDocumentPosition( remove ) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	} );

	it( 'offers no reset on the picker, leaving removal to its own button', async () => {
		await renderRows( assignedStatus() );

		const dialog = await openRow( 'Change workflow: Weekend Magazine' );

		expect( screen.getByRole( 'combobox' ) ).toBeInTheDocument();
		expect(
			within( dialog ).queryByRole( 'button', { name: 'Reset' } )
		).not.toBeInTheDocument();
	} );

	it( 'confirms, then removes the post from its workflow', async () => {
		await renderRows( assignedStatus() );

		await openRow( 'Change workflow: Weekend Magazine' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Remove from workflow' } )
		);

		expect(
			await screen.findByText(
				/Remove this post from the “Weekend Magazine” workflow\?/
			)
		).toBeInTheDocument();
		expect( removeDeletes() ).toHaveLength( 0 );

		await act( async () => {
			screen
				.getByRole( 'button', { name: 'Remove from workflow' } )
				.click();
		} );

		expect( removeDeletes() ).toHaveLength( 1 );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Select a workflow' } )
			).toBeInTheDocument()
		);
	} );

	it( 'offers no way out of an enforced workflow', async () => {
		seedEditorStore( {
			metadataFields: [],
			workflowEnforcement: 'require',
		} );
		await renderRows( assignedStatus() );

		await openRow( 'Change workflow: Weekend Magazine' );

		expect( screen.getByRole( 'combobox' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Remove from workflow' } )
		).not.toBeInTheDocument();
	} );

	it( 'offers no removal before the post is in a workflow', async () => {
		await renderRows( unassignedStatus() );

		await openRow( 'Select a workflow' );

		expect(
			screen.queryByRole( 'button', { name: 'Remove from workflow' } )
		).not.toBeInTheDocument();
	} );

	it( 'draws no Workflow row when this post type has no sequences', async () => {
		await renderRows( unassignedStatus( [] ) );

		expect( screen.queryByText( 'Workflow' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Select a workflow' } )
		).not.toBeInTheDocument();
	} );

	it( 'draws no Workflow row until the status read lands', async () => {
		apiFetch.mockImplementation( () => new Promise( () => {} ) );

		render( <WorkflowSummaryRows /> );

		// An empty row would say "Select a workflow" over a post that may well
		// be in one. The rows ask for the status themselves: the Summary panel
		// is open by default, and the workflow sidebar may never be.
		expect(
			screen.queryByRole( 'button', { name: 'Select a workflow' } )
		).not.toBeInTheDocument();
		expect( statusReads() ).toHaveLength( 1 );
	} );

	it( 'follows the Workflow row with the sequence’s metadata rows', async () => {
		// The status read re-sources the fields, so its payload carries them.
		seedEditorStore( { metadataFields: [ DESK_FIELD ] } );
		await renderRows( {
			...assignedStatus(),
			metadata_fields: [ DESK_FIELD ],
		} );

		const workflowTrigger = screen.getByRole( 'button', {
			name: 'Change workflow: Weekend Magazine',
		} );
		const deskTrigger = screen.getByRole( 'button', {
			name: 'Change Desk: Foreign',
		} );

		expect(
			// eslint-disable-next-line no-bitwise
			workflowTrigger.compareDocumentPosition( deskTrigger ) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	} );

	it( 'keeps the metadata rows on screen while the status is still loading', async () => {
		// The fields come from the server bootstrap, not from the status read,
		// so they are already known while it is in flight.
		seedEditorStore( { metadataFields: [ DESK_FIELD ] } );
		apiFetch.mockImplementation( () => new Promise( () => {} ) );

		render( <WorkflowSummaryRows /> );

		expect(
			screen.getByRole( 'button', { name: 'Change Desk: Foreign' } )
		).toBeInTheDocument();
	} );

	it( 'keeps the metadata rows on screen for a post whose workflow was deleted', async () => {
		// The status read re-sources the fields, so its payload carries them.
		seedEditorStore( { metadataFields: [ DESK_FIELD ] } );
		await renderRows( {
			...orphanedStatus(),
			metadata_fields: [ DESK_FIELD ],
		} );

		expect(
			screen.getByRole( 'button', { name: 'Change Desk: Foreign' } )
		).toBeInTheDocument();
	} );

	it( 'rules the workflow rows off from core’s with a divider above the Workflow row', async () => {
		await renderRows( assignedStatus() );

		const divider = screen.getByRole( 'separator' );
		const workflowTrigger = screen.getByRole( 'button', {
			name: 'Change workflow: Weekend Magazine',
		} );

		expect(
			// eslint-disable-next-line no-bitwise
			divider.compareDocumentPosition( workflowTrigger ) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	} );

	it( 'draws no divider when there are no workflow rows to set off', async () => {
		await renderRows( unassignedStatus( [] ) );

		expect( screen.queryByRole( 'separator' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the divider over the metadata rows while the status is still loading', async () => {
		seedEditorStore( { metadataFields: [ DESK_FIELD ] } );
		apiFetch.mockImplementation( () => new Promise( () => {} ) );

		render( <WorkflowSummaryRows /> );

		const divider = screen.getByRole( 'separator' );
		const deskTrigger = screen.getByRole( 'button', {
			name: 'Change Desk: Foreign',
		} );

		expect(
			// eslint-disable-next-line no-bitwise
			divider.compareDocumentPosition( deskTrigger ) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	} );
} );
