/**
 * Unit tests for the one fault a phase canvas can hold, and the two halves of
 * keeping an author out of it.
 *
 * A phase sequence owes hand-offs the server names, and the save is refused
 * until they are drawn. The blocked-save notice offers to open the phase at
 * fault — so the panel it opens has to be able to resolve it. It could not: the
 * phase panel was read-only, so the button promised a fix and delivered a
 * restatement, leaving the author to work out that the answer was a drag on the
 * canvas.
 *
 * Two things are pinned here. The panel now offers the hand-off it owes, drawn
 * through the same gesture the canvas connects with. And the hand-off cannot be
 * deleted in the first place — the phases either end of it are already fixed,
 * and a line between two fixed nodes that the save insists on is no more the
 * author's to remove than they are.
 *
 * Which hand-offs are owed is the server's answer throughout, never a pair of
 * keys written here — the same list the write gate refuses on. A test that
 * hardcoded `ideation → editorial` would pass against an editor that had
 * stopped asking.
 *
 * The canvas is stubbed to the props under test: React Flow measures a viewport
 * jsdom does not lay out, and selection and deletion both reach the editor as
 * plain callbacks, so calling one directly is the gesture minus the drag.
 *
 * @package
 */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from './helpers/render-wp-component';

import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );

// The canvas's callbacks, held where a test can drive them.
let canvas;

jest.mock(
	'../../src/admin/components/graph/GraphCanvas',
	() =>
		function GraphCanvasStub( props ) {
			canvas = props;
			return <div data-testid="canvas" />;
		}
);

import SequenceGraphEditor from '../../src/admin/components/graph/SequenceGraphEditor';
import { isRequiredHandOff } from '../../src/admin/components/graph/graph-model';

const IDEATION_TO_EDITORIAL = [ { from: 'ideation', to: 'editorial' } ];

const LIFECYCLE = [
	{ key: 'ideation', label: 'Ideation', transitions: [] },
	{ key: 'editorial', label: 'Editorial', transitions: [] },
];

const LIFECYCLE_CONNECTED = [
	{
		key: 'ideation',
		label: 'Ideation',
		transitions: [ { to: 'editorial', label: 'Create Draft' } ],
	},
	{ key: 'editorial', label: 'Editorial', transitions: [] },
];

/** Every write the editor made, in order. */
let writes;

/**
 * Render the phase editor against a server publishing a graph.
 *
 * @param {Object} options               Harness options.
 * @param {Array}  options.phases        The phases stored on the sequence.
 * @param {Array}  [options.transitions] What the graph MAY connect.
 * @param {Array}  [options.required]    What it may not be saved without.
 *                                       Defaults to the whole graph.
 * @param {string} [options.mode]        `workflow` to open the same stages as
 *                                       a workflow sequence instead.
 * @return {Promise<void>} Resolves once the canvas is up.
 */
async function renderPhaseEditor( {
	phases,
	transitions = IDEATION_TO_EDITORIAL,
	required = transitions,
	mode = 'phase',
} ) {
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( path === '/vip-workflows/v1/sequences/options' ) {
			return Promise.resolve( {
				post_types: [ { value: 'post', label: 'Posts' } ],
				phase_transitions: transitions,
				required_phase_transitions: required,
			} );
		}
		if (
			path.startsWith( '/vip-workflows/v1/abilities' ) ||
			path === '/vip-workflows/v1/notifications/channels'
		) {
			return Promise.resolve( [] );
		}
		if ( method === 'POST' || method === 'PUT' ) {
			writes.push( { path, method, data } );
		}
		return Promise.resolve( {
			id: 3,
			name: 'Content Lifecycle',
			description: '',
			status: 'active',
			type: mode,
			config:
				'phase' === mode
					? { phases }
					: { statuses: phases, post_types: [ 'post' ] },
		} );
	} );

	render(
		<SequenceGraphEditor
			sequenceId={ 3 }
			mode={ mode }
			onCancel={ jest.fn() }
		/>
	);

	await waitFor( () => expect( canvas ).toBeDefined() );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
}

/**
 * Open a phase's panel, as clicking its node does.
 *
 * @param {string} key The phase to select.
 * @return {Promise<void>} Resolves once the panel has rendered.
 */
const selectPhase = ( key ) => act( () => canvas.onSelectNode( key ) );

/**
 * Open a hand-off's panel, as clicking the line does.
 *
 * @param {string} from Source phase key.
 * @param {string} to   Target phase key.
 * @return {Promise<void>} Resolves once the panel has rendered.
 */
const selectHandOff = ( from, to ) =>
	act( () => canvas.onSelectEdge( `${ from }->${ to }` ) );

const saveButton = () =>
	screen.getByRole( 'button', { name: /^(Save|Saving…|Saved!)$/ } );

beforeEach( () => {
	canvas = undefined;
	writes = [];
} );

describe( 'A phase panel opened on a missing hand-off', () => {
	it( 'offers the hand-off the phase owes', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE } );
		await selectPhase( 'ideation' );

		// Named by the phase's label, not its key: the author reads "Editorial"
		// on the node beside it, and a button naming `editorial` would be the
		// panel speaking the storage's vocabulary rather than the canvas's.
		expect(
			screen.getByRole( 'button', { name: /Add the hand-off to/ } )
		).toHaveTextContent( 'Editorial' );
	} );

	// The whole point of the affordance. Before this, the panel named the fault
	// and offered nothing, so the button on the notice that opened it led
	// somewhere the fix could not be made.
	it( 'draws it, and the save the fault was blocking goes through', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE } );
		await selectPhase( 'ideation' );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Add the hand-off to/ } )
		);

		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].data.statuses[ 0 ].transitions ).toEqual( [
			expect.objectContaining( { to: 'editorial' } ),
		] );
	} );

	// Drawing one is the same edit and the same landing as the drag, because it
	// is the same call: the new hand-off takes the selection, so the author ends
	// up in the panel where it is configured rather than back where they were.
	it( 'leaves the author in the new hand-off’s panel', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE } );
		await selectPhase( 'ideation' );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Add the hand-off to/ } )
		);

		expect(
			screen.getByText( 'Ideation → Editorial' )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /Add the hand-off to/ } )
		).not.toBeInTheDocument();
	} );

	// The button pressed lives in the panel the new selection replaces. Left to
	// the selection alone, focus falls to the document and a keyboard is sent
	// back to the top of the page — so the add is a reveal, as "Show phase" was.
	it( 'takes the keyboard to the new hand-off’s panel', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE } );
		await selectPhase( 'ideation' );

		const add = screen.getByRole( 'button', {
			name: /Add the hand-off to/,
		} );
		add.focus();
		fireEvent.click( add );

		const heading = document.querySelector( '.wf-inspector__heading' );
		expect( heading ).toHaveTextContent( 'Ideation → Editorial' );
		expect( heading ).toHaveFocus();
		expect( canvas.reveal?.target ).toMatchObject( {
			type: 'edge',
			from: 'ideation',
			to: 'editorial',
		} );
	} );

	// A panel names the phase it opened on. Editorial owes nothing, so offering
	// Ideation's hand-off here would be a button fixing something this panel is
	// not about — and two panels offering the same repair is how one of them
	// ends up doing it twice.
	it( 'offers nothing on a phase that owes nothing', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE } );
		await selectPhase( 'editorial' );

		expect(
			screen.queryByRole( 'button', { name: /Add the hand-off to/ } )
		).not.toBeInTheDocument();
	} );

	// A sequence missing the phase entirely is missing a phase, which is its own
	// error with its own fix. There is no node to hang an offer on, and the
	// hand-off is not what is wrong.
	it( 'offers nothing for a hand-off whose other phase is absent', async () => {
		await renderPhaseEditor( {
			phases: [ { key: 'ideation', label: 'Ideation', transitions: [] } ],
		} );
		await selectPhase( 'ideation' );

		expect(
			screen.queryByRole( 'button', { name: /Add the hand-off to/ } )
		).not.toBeInTheDocument();
	} );

	// The obligation is read, not remembered — the same reason the rule is
	// fetched at all. A lifecycle that grows a phase in the middle offers the
	// hop the server now names, with nothing in the editor to update.
	it( 'offers whatever hand-off the server publishes', async () => {
		const throughTriage = [
			{ from: 'ideation', to: 'triage' },
			{ from: 'triage', to: 'editorial' },
		];

		await renderPhaseEditor( {
			phases: [
				{ key: 'ideation', label: 'Ideation', transitions: [] },
				{ key: 'triage', label: 'Triage', transitions: [] },
				{ key: 'editorial', label: 'Editorial', transitions: [] },
			],
			transitions: throughTriage,
		} );
		await selectPhase( 'ideation' );

		expect(
			screen.getByRole( 'button', { name: /Add the hand-off to/ } )
		).toHaveTextContent( 'Triage' );
	} );

	// The panel used to send the author to a thing that wasn't there — "Select
	// the connection between phases" is unfollowable advice on a canvas whose
	// connection has been deleted. It is the same dead end as the button, one
	// paragraph up.
	it( 'does not tell the author to select a connection that is missing', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE } );
		await selectPhase( 'ideation' );

		expect(
			screen.queryByText( /Select the connection/i )
		).not.toBeInTheDocument();
	} );

	it( 'says to select it once there is one', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE_CONNECTED } );
		await selectPhase( 'ideation' );

		expect(
			screen.getByText( /Select the connection/i )
		).toBeInTheDocument();
	} );

	// Owing nothing is not the same as having a way out. Nothing leaves
	// Editorial, so a panel telling it to select the connection that does is
	// the dead end above, on the other phase.
	it( 'does not tell a phase with no way out to select one', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE_CONNECTED } );
		await selectPhase( 'editorial' );

		expect(
			document.querySelector( '.wf-inspector__heading' )
		).toHaveTextContent( 'Editorial' );
		expect(
			screen.queryByText( /Select the connection/i )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( /no connection leaves this one/i )
		).toBeInTheDocument();
	} );
} );

describe( 'A hand-off the sequence owes', () => {
	// The other half. An author who cannot delete it never reaches the fault,
	// and the repair above is what covers a config that arrived without one.
	it( 'has no Remove control in its panel', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE_CONNECTED } );
		await selectHandOff( 'ideation', 'editorial' );

		expect(
			screen.queryByRole( 'button', { name: /Remove transition/i } )
		).not.toBeInTheDocument();
	} );

	// Absent from the panel, not merely hidden there. The canvas's keyboard
	// delete reaches the handler without passing any control that could have
	// been taken away, so the guard has to be on the handler as well.
	it( 'survives the canvas delete the panel has no button for', async () => {
		await renderPhaseEditor( { phases: LIFECYCLE_CONNECTED } );

		await act( () => canvas.onDeleteEdge( 'ideation', 'editorial' ) );

		expect( canvas.stages[ 0 ].transitions ).toEqual( [
			expect.objectContaining( { to: 'editorial' } ),
		] );
		// And nothing was written to be undone: a refused gesture leaves the
		// sequence where it was, so Save has nothing to offer either.
		expect( saveButton() ).toBeDisabled();
	} );

	// The canvas has a control of its own — an edge's right-click menu, whose
	// only verb for a transition is Delete — so it is given the same list the
	// panel reads its guard from, and asks `isRequiredHandOff` of it. Left
	// without the list, the menu would offer the one removal the handler
	// refuses: an item that promises and does nothing.
	it( 'tells the canvas which hand-offs are owed', async () => {
		await renderPhaseEditor( {
			phases: LIFECYCLE_CONNECTED,
			transitions: [
				{ from: 'ideation', to: 'triage' },
				{ from: 'ideation', to: 'editorial' },
			],
			required: IDEATION_TO_EDITORIAL,
		} );

		expect( canvas.requiredTransitions ).toEqual( IDEATION_TO_EDITORIAL );
		expect(
			isRequiredHandOff(
				canvas.requiredTransitions,
				'ideation',
				'editorial'
			)
		).toBe( true );
		expect(
			isRequiredHandOff(
				canvas.requiredTransitions,
				'ideation',
				'triage'
			)
		).toBe( false );
	} );

	// The guard is the obligation, not the phase mode. A hand-off a phase
	// sequence MAY draw but is not required to keep is ordinary work, and
	// refusing to remove it would strand whoever drew it — including one that
	// shares either end with the one that is owed, which is where a guard
	// matching on half the pair would give itself away.
	it( 'still removes one the server allows but does not require', async () => {
		const allowed = [
			{ from: 'ideation', to: 'triage' },
			{ from: 'ideation', to: 'editorial' },
			{ from: 'triage', to: 'editorial' },
		];

		await renderPhaseEditor( {
			phases: [
				{
					key: 'ideation',
					label: 'Ideation',
					transitions: [
						{ to: 'triage', label: 'Triage it' },
						{ to: 'editorial', label: 'Create Draft' },
					],
				},
				{
					key: 'triage',
					label: 'Triage',
					transitions: [ { to: 'editorial', label: 'Accept' } ],
				},
				{ key: 'editorial', label: 'Editorial', transitions: [] },
			],
			transitions: allowed,
			required: [ { from: 'ideation', to: 'editorial' } ],
		} );

		// Same source as the owed hand-off.
		await selectHandOff( 'ideation', 'triage' );
		fireEvent.click(
			screen.getByRole( 'button', { name: /Remove transition/i } )
		);
		// Same target.
		await selectHandOff( 'triage', 'editorial' );
		fireEvent.click(
			screen.getByRole( 'button', { name: /Remove transition/i } )
		);
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].data.statuses[ 0 ].transitions ).toEqual( [
			expect.objectContaining( { to: 'editorial' } ),
		] );
		expect( writes[ 0 ].data.statuses[ 1 ].transitions ).toEqual( [] );
	} );

	// The list is published to every editor, and a workflow sequence is free to
	// key its stages however it likes. Owing is a phase sequence's business.
	it( 'is nothing a workflow sequence owes, whatever its stages are keyed', async () => {
		await renderPhaseEditor( {
			phases: LIFECYCLE_CONNECTED,
			mode: 'workflow',
		} );
		await selectHandOff( 'ideation', 'editorial' );

		expect(
			screen.getByRole( 'button', { name: /Remove transition/i } )
		).toBeInTheDocument();

		await act( () => canvas.onDeleteEdge( 'ideation', 'editorial' ) );

		expect( canvas.stages[ 0 ].transitions ).toEqual( [] );
	} );
} );
