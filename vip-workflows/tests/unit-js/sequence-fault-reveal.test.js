/**
 * Showing the fault a refused Save names.
 *
 * The notice offers a button to the thing at fault — "Show transition" — and
 * selecting it turned out to be only half of "show me". Three ways the press
 * could produce nothing anyone could see:
 *
 *   1. The panel that holds the fix may be closed. It starts collapsed below
 *      wp-admin's breakpoint and stays closed for anyone who closed it, so the
 *      press swapped the contents of a hidden panel.
 *   2. Focus stayed on the button in the notice, which left a keyboard several
 *      tab stops from the fix and a screen reader with nothing announced: the
 *      only feedback the press gave was visual.
 *   3. The canvas never moved, so a fault outside the viewport was highlighted
 *      where nobody was looking.
 *
 * All three are the same promise, so they are pinned together here: the panel
 * opens and takes focus, and the canvas is told where to pan.
 *
 * The pan itself cannot run here — React Flow measures a viewport jsdom does
 * not lay out — so it is tested as the arithmetic it is (`canvas-reveal`), and
 * the editor is held to handing the canvas the request.
 *
 * @package
 */

import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
} from './helpers/render-wp-component';

import apiFetch from '@wordpress/api-fetch';

import Inspector from '../../src/admin/components/graph/Inspector';
import {
	REVEAL_MARGIN,
	revealNodeIds,
	revealViewport,
} from '../../src/admin/components/graph/canvas-reveal';
import { regionNodeId } from '../../src/admin/components/graph/graph-model';

jest.mock( '@wordpress/api-fetch' );

// Every reveal the canvas was handed, in order, deduplicated by identity: the
// stub re-renders for reasons of its own (a keystroke in the panel), and a prop
// arriving twice is still one instruction.
let mockReveals = [];

jest.mock(
	'../../src/admin/components/graph/GraphCanvas',
	() =>
		function GraphCanvasStub( { reveal } ) {
			if ( reveal && mockReveals[ mockReveals.length - 1 ] !== reveal ) {
				mockReveals.push( reveal );
			}
			return <div data-testid="canvas" />;
		}
);

import SequenceGraphEditor from '../../src/admin/components/graph/SequenceGraphEditor';

const heading = () => document.querySelector( '.wf-inspector__heading' );
const body = () => document.querySelector( '.wf-inspector__body' );
const toggle = () =>
	screen.getByRole( 'button', { name: /Collapse panel|Expand panel/ } );

// --- The panel a reveal opens ---------------------------------------------

const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'review', label: 'Submit' } ],
	},
	{ key: 'review', label: 'Review', status: 'pending', transitions: [] },
];

const SEQUENCE_SETTINGS = {
	name: 'Editorial Review',
	onNameChange: () => {},
	description: '',
	onDescriptionChange: () => {},
	isActive: true,
	onActiveChange: () => {},
	postTypes: [ { label: 'Posts', value: 'post' } ],
	selectedPostTypes: [ 'post' ],
	onTogglePostType: () => {},
	metadataFields: [],
	onMetadataChange: () => {},
	isNew: false,
	onDelete: () => {},
	deleting: false,
};

function renderInspector( overrides = {} ) {
	const props = {
		selection: { type: 'node', key: 'draft' },
		isPhase: false,
		stages: STAGES,
		selectedStage: STAGES[ 0 ],
		selectedTransition: null,
		availableAgents: [],
		availableRoles: [],
		availableTools: [],
		availableChannels: [],
		onUpdateStage: () => {},
		onDeleteStage: () => {},
		onUpdateTransition: () => {},
		onDeleteTransition: () => {},
		sequenceSettings: SEQUENCE_SETTINGS,
		...overrides,
	};
	const view = render( <Inspector { ...props } /> );
	return {
		...view,
		update: ( next ) =>
			view.rerender( <Inspector { ...props } { ...next } /> ),
	};
}

// One reveal of the stage these tests select, as the editor builds one.
const revealDraft = () => ( {
	target: { type: 'node', key: 'draft' },
} );

describe( 'a reveal opens the panel it selects into', () => {
	it( 'expands a panel that was collapsed by hand', () => {
		const { update } = renderInspector();
		fireEvent.click( toggle() );
		expect( body() ).toHaveAttribute( 'hidden' );

		update( { reveal: revealDraft() } );

		expect( body() ).not.toHaveAttribute( 'hidden' );
		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'true' );
	} );

	it( 'expands the panel that starts collapsed on a phone', () => {
		const desktop = window.matchMedia;
		window.matchMedia = () => ( {
			matches: true,
			media: '',
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		} );

		try {
			const { update } = renderInspector();
			expect( body() ).toHaveAttribute( 'hidden' );

			update( { reveal: revealDraft() } );

			expect( body() ).not.toHaveAttribute( 'hidden' );
		} finally {
			window.matchMedia = desktop;
		}
	} );

	it( 'moves focus into the panel, onto what it now holds', () => {
		const { update } = renderInspector();
		expect( heading() ).not.toHaveFocus();

		update( { reveal: revealDraft() } );

		expect( heading() ).toHaveFocus();
		// The eyebrow and the title together, which is what a screen reader
		// reads out on arrival — not the panel's first field.
		expect( heading() ).toHaveTextContent( 'Stage' );
		expect( heading() ).toHaveTextContent( 'Draft' );
	} );

	it( 'takes focus to the panel the reveal swapped in, not the one it left', () => {
		// Nothing selected, so the panel is the sequence's own settings — which
		// is where a refused Save leaves an author who has not clicked
		// anything. Showing a stage swaps one panel component for another, so
		// the shell unmounts and remounts, and focus has to land on the heading
		// that arrived rather than on a detached one.
		const { update } = renderInspector( {
			selection: null,
			selectedStage: null,
		} );
		expect( heading() ).toHaveTextContent( 'Editorial Review' );

		update( {
			selection: { type: 'node', key: 'draft' },
			selectedStage: STAGES[ 0 ],
			reveal: revealDraft(),
		} );

		expect( heading() ).toHaveTextContent( 'Draft' );
		expect( heading() ).toHaveFocus();
	} );

	it( 'leaves an ordinary selection alone', () => {
		const { update } = renderInspector();
		fireEvent.click( toggle() );

		// A click on the canvas: the selection changes, nothing was asked to be
		// shown. A panel closed on purpose stays closed, and focus stays where
		// the click left it.
		update( {
			selection: { type: 'node', key: 'review' },
			selectedStage: STAGES[ 1 ],
		} );

		expect( body() ).toHaveAttribute( 'hidden' );
		expect( heading() ).not.toHaveFocus();
	} );

	// The editor never clears a reveal, so every later click arrives with the
	// last one still in hand. Still only a click.
	it( 'leaves an ordinary selection alone after a reveal', () => {
		const reveal = revealDraft();
		const { update } = renderInspector( { reveal } );
		toggle().focus();
		fireEvent.click( toggle() );

		update( {
			reveal,
			selection: { type: 'node', key: 'review' },
			selectedStage: STAGES[ 1 ],
		} );

		expect( body() ).toHaveAttribute( 'hidden' );
		expect( toggle() ).toHaveFocus();
	} );

	// Where focus lands has to say what it landed on, rather than leave that
	// to how a screen reader treats a bare container.
	it( 'names the heading focus lands on', () => {
		const { update } = renderInspector();

		update( { reveal: revealDraft() } );

		expect( heading() ).toHaveAccessibleName( 'Stage Draft' );
	} );

	// A transition's sections open by what it holds. A reveal swapping one
	// transition for another has to reopen them for the one it arrived at, or
	// the field the fault names sits in a section the last transition shut.
	it( 'opens the arriving transition’s sections, not the last one’s', () => {
		const plain = { to: 'review', label: 'Submit' };
		const capturing = {
			to: 'draft',
			label: 'Send back',
			inputs: [ { type: 'assignment', meta_key: '' } ],
		};
		const { update } = renderInspector( {
			selection: { type: 'edge', from: 'draft', to: 'review' },
			selectedStage: null,
			selectedTransition: plain,
		} );
		const capture = () =>
			screen.getByRole( 'button', { name: /What to capture/ } );
		expect( capture() ).toHaveAttribute( 'aria-expanded', 'false' );

		update( {
			selection: { type: 'edge', from: 'review', to: 'draft' },
			selectedTransition: capturing,
			reveal: {
				target: { type: 'edge', from: 'review', to: 'draft' },
			},
		} );

		expect( capture() ).toHaveAttribute( 'aria-expanded', 'true' );
	} );

	it( 'reveals again when the same fault is asked for twice', () => {
		const { update } = renderInspector();
		update( { reveal: revealDraft() } );

		// Pressing the button a second time is a second reveal of one target —
		// the panel may have been closed again in between, and the fresh
		// request is what says so, since the target itself never changed.
		fireEvent.click( toggle() );
		update( { reveal: revealDraft() } );

		expect( body() ).not.toHaveAttribute( 'hidden' );
	} );
} );

// --- Where the canvas pans -------------------------------------------------

/**
 * The pane as it is above wp-admin's breakpoint: 800px wide with the floating
 * panel covering 360 of it, so the strip left visible is 440.
 */
const PANE = { x: 0, y: 0, width: 440, height: 600 };
const HOME = { x: 0, y: 0, zoom: 1 };

// Where the centre of that strip is, in pane pixels.
const STRIP_MIDDLE = REVEAL_MARGIN + ( PANE.width - REVEAL_MARGIN * 2 ) / 2;

const pan = ( bounds, options = {} ) =>
	revealViewport( bounds, { viewport: HOME, visible: PANE, ...options } );

describe( 'what a target is shown by', () => {
	it( 'shows a stage by its own node', () => {
		expect( revealNodeIds( { type: 'node', key: 'draft' } ) ).toEqual( [
			'draft',
		] );
	} );

	it( 'shows a transition by both the stages it joins', () => {
		expect(
			revealNodeIds( { type: 'edge', from: 'draft', to: 'legal' } )
		).toEqual( [ 'draft', 'legal' ] );
	} );

	it( 'shows a status group by its band', () => {
		expect(
			revealNodeIds( { type: 'region', region: 'pending' } )
		).toEqual( [ regionNodeId( 'pending' ) ] );
	} );

	it( 'shows nothing for a fault of the sequence itself', () => {
		expect( revealNodeIds( null ) ).toEqual( [] );
	} );
} );

describe( 'where a reveal pans the canvas', () => {
	it( 'does not move for something already in view', () => {
		expect( pan( { x: 100, y: 100, width: 200, height: 80 } ) ).toBeNull();
	} );

	it( 'centres something off to one side, and moves nothing else', () => {
		const next = pan( { x: 1000, y: 100, width: 200, height: 80 } );

		// The node's own middle lands on the strip's.
		expect( next.x + 1000 + 100 ).toBe( STRIP_MIDDLE );
		// Vertically it was in view all along, so that axis is untouched.
		expect( next.y ).toBe( HOME.y );
	} );

	it( 'counts the panel as covered, not as canvas', () => {
		// 500 → 700 is well inside an 800px pane and behind the panel in the
		// 440px strip, which is the whole reason the strip is measured.
		const bounds = { x: 500, y: 100, width: 200, height: 80 };

		expect( pan( bounds ) ).not.toBeNull();
		expect(
			revealViewport( bounds, {
				viewport: HOME,
				visible: { x: 0, y: 0, width: 800, height: 600 },
			} )
		).toBeNull();
	} );

	it( 'shows the start of something too big to frame', () => {
		// A transition running the length of the sequence. Centred it would
		// show the middle of a line and neither of its ends; the stage it
		// leaves is the end worth landing on.
		const next = pan( { x: -500, y: 100, width: 5000, height: 80 } );

		expect( next.x + -500 ).toBe( REVEAL_MARGIN );
		expect( next.y ).toBe( HOME.y );
	} );

	// A transition running back up the flow: its destination is the top of
	// the pair. Aligned by the pair's own start, the stage it leaves — where
	// the fault is configured — would be pushed off the bottom.
	it( 'lands an oversized back-edge on the stage it leaves', () => {
		const source = { x: 100, y: 4000, width: 200, height: 80 };
		const next = pan(
			{ x: 100, y: 0, width: 200, height: 4080 },
			{ anchor: source }
		);

		expect( next.y + source.y ).toBe( REVEAL_MARGIN );
	} );

	it( 'keeps the zoom it was given', () => {
		const viewport = { x: 0, y: 0, zoom: 0.5 };
		const next = revealViewport(
			{ x: 2000, y: 2000, width: 200, height: 80 },
			{ viewport, visible: PANE }
		);

		expect( next.zoom ).toBe( 0.5 );
		// Measured at that zoom: the framed span is half its flow size.
		expect( next.x + ( 2000 + 100 ) * 0.5 ).toBe( STRIP_MIDDLE );
	} );

	it( 'lifts something below the fold without sliding it sideways', () => {
		const next = pan( { x: 100, y: 4000, width: 200, height: 80 } );

		expect( next.x ).toBe( HOME.x );
		expect( next.y + 4000 + 40 ).toBe(
			REVEAL_MARGIN + ( PANE.height - REVEAL_MARGIN * 2 ) / 2
		);
	} );

	it( 'has nothing to answer without bounds', () => {
		expect( pan( null ) ).toBeNull();
	} );
} );

// --- The editor's side of the promise --------------------------------------

// The one transition captures an assignment and names no key, which the server
// refuses as `invalid_assignment_key`. The fault belongs to the transition, so
// the notice offers "Show transition".
const FAULTED = [
	{
		key: 'draft',
		label: 'Draft',
		color: '#C36EFF',
		status: 'draft',
		region_entry: true,
		is_terminal: false,
		transitions: [
			{
				to: 'legal',
				label: 'Send to legal',
				inputs: [ { type: 'assignment', meta_key: '' } ],
			},
		],
	},
	{
		key: 'legal',
		label: 'Legal',
		color: '#C36EFF',
		status: 'draft',
		region_entry: false,
		is_terminal: true,
		transitions: [],
	},
];

const sequence = () => ( {
	id: 7,
	name: 'Editorial Review',
	description: '',
	status: 'active',
	stages_missing_region: [],
	config: {
		statuses: FAULTED,
		post_types: [ 'post' ],
		settings: {},
		metadata_fields: [],
	},
} );

const OPTIONS = {
	post_types: [ { value: 'post', label: 'Posts' } ],
	phase_transitions: [],
	required_phase_transitions: [],
};

beforeEach( () => {
	mockReveals = [];
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/vip-workflows/v1/sequences/options' ) {
			return Promise.resolve( OPTIONS );
		}
		if (
			path.startsWith( '/vip-workflows/v1/abilities' ) ||
			path === '/vip-workflows/v1/notifications/channels'
		) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( sequence() );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const saveButton = () =>
	screen.getByRole( 'button', { name: /^(Save|Saving…|Saved!)$/ } );
const nameField = () => screen.getByRole( 'textbox', { name: /^Name/ } );
const showTransition = () =>
	screen.getByRole( 'button', { name: 'Show transition' } );

async function renderEditor() {
	render( <SequenceGraphEditor sequenceId={ 7 } onCancel={ () => {} } /> );
	await waitFor( () => expect( saveButton() ).toBeInTheDocument() );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
}

describe( 'the way a refused Save shows its fault', () => {
	// Save is disabled until there is unsaved work, so it has to be given some
	// before it can be refused any.
	const pressSave = async () => {
		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );
		await screen.findAllByText( /names no assignment key/ );
	};

	it( 'opens the transition’s panel and leaves focus in it', async () => {
		await renderEditor();
		await pressSave();

		fireEvent.click( showTransition() );

		// The panel now holding the fix, with the keyboard in it rather than on
		// a button in the notice.
		expect( heading() ).toHaveTextContent( 'Transition' );
		expect( heading() ).toHaveTextContent( 'Draft → Legal' );
		expect( heading() ).toHaveFocus();
	} );

	it( 'tells the canvas which transition to bring into view', async () => {
		await renderEditor();
		await pressSave();
		expect( mockReveals ).toHaveLength( 0 );

		fireEvent.click( showTransition() );

		expect( mockReveals ).toHaveLength( 1 );
		expect( mockReveals[ 0 ].target ).toMatchObject( {
			type: 'edge',
			from: 'draft',
			to: 'legal',
		} );
	} );

	it( 'counts a second press as a second reveal', async () => {
		await renderEditor();
		await pressSave();

		fireEvent.click( showTransition() );
		fireEvent.click( showTransition() );

		// One target, two requests. The canvas may have been panned away in
		// between, so the second press has to arrive as a fresh instruction
		// rather than as an unchanged prop.
		expect( mockReveals ).toHaveLength( 2 );
		expect( mockReveals[ 1 ] ).not.toBe( mockReveals[ 0 ] );
	} );
} );
