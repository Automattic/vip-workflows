/**
 * Unit tests for which connections a phase sequence lets an author draw, and
 * which of them it may not save without.
 *
 * The editor used to answer this itself — `source === 'ideation' && target ===
 * 'editorial'`, written into the component — while the server kept its own copy
 * of the same rule in the write gate. Two copies of one rule is one desync away
 * from a canvas that offers a connection the save silently drops, and a phase
 * added to the lifecycle would have had to be remembered on both sides.
 *
 * So the editor asks. What is pinned here is that it asks and then obeys: the
 * published graph is the whole of what the canvas will accept, whatever is in
 * it — including a shape nothing ships today, which is the point.
 *
 * The canvas is stubbed down to the one prop under test. React Flow measures a
 * viewport jsdom does not lay out, and `isValidConnection` is a pure predicate
 * it hands the canvas — calling it directly is the connection gesture, minus a
 * drag jsdom cannot perform.
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

// The predicate the editor hands the canvas, held where a test can call it.
let isValidConnection;

jest.mock(
	'../../src/admin/components/graph/GraphCanvas',
	() =>
		function GraphCanvasStub( props ) {
			isValidConnection = props.isValidConnection;
			return <div data-testid="canvas" />;
		}
);

import SequenceGraphEditor from '../../src/admin/components/graph/SequenceGraphEditor';

const phaseSequence = ( phases ) => ( {
	id: 3,
	name: 'Content Lifecycle',
	description: '',
	status: 'active',
	type: 'phase',
	config: { phases },
} );

/** Every write the editor made, in order. */
let writes;

/**
 * Render the phase editor against a server that publishes `transitions`.
 *
 * @param {Array} transitions The phase graph, as { from, to } pairs.
 * @param {Array} phases      The phases stored on the sequence.
 * @param {Array} required    The hand-offs the server requires of a phase
 *                            sequence, as { from, to } pairs. Defaults to the
 *                            whole published graph.
 * @return {Promise<void>} Resolves once the canvas holds the predicate.
 */
async function renderPhaseEditor(
	transitions,
	phases,
	required = transitions
) {
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
		return Promise.resolve( phaseSequence( phases ) );
	} );

	render(
		<SequenceGraphEditor
			sequenceId={ 3 }
			mode="phase"
			onCancel={ jest.fn() }
		/>
	);

	await waitFor( () =>
		expect( isValidConnection ).toBeInstanceOf( Function )
	);
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
}

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

describe( 'What a phase sequence may connect', () => {
	beforeEach( () => {
		isValidConnection = undefined;
		writes = [];
	} );

	it( 'accepts the hand-off the server published', async () => {
		await renderPhaseEditor( IDEATION_TO_EDITORIAL, LIFECYCLE );

		expect(
			isValidConnection( { source: 'ideation', target: 'editorial' } )
		).toBe( true );
	} );

	it( 'refuses the same hand-off backwards', async () => {
		await renderPhaseEditor( IDEATION_TO_EDITORIAL, LIFECYCLE );

		// The published graph is directed, and the write gate reads it the same
		// way: a transition stored on Editorial pointing back at Ideation is
		// dropped on save, so the canvas will not draw one.
		expect(
			isValidConnection( { source: 'editorial', target: 'ideation' } )
		).toBe( false );
	} );

	it( 'refuses a phase to itself', async () => {
		await renderPhaseEditor( IDEATION_TO_EDITORIAL, LIFECYCLE );

		expect(
			isValidConnection( { source: 'ideation', target: 'ideation' } )
		).toBe( false );
	} );

	// The reason the rule is fetched rather than written down. A lifecycle with
	// a phase between the two ends draws nothing at all under a hardcoded
	// `ideation → editorial`; under a published graph it draws both hops, and
	// the hop the graph skips stays refused.
	it( 'draws whatever graph the server publishes, not the pair it used to know', async () => {
		const withMiddle = [
			{ from: 'ideation', to: 'triage' },
			{ from: 'triage', to: 'editorial' },
		];

		await renderPhaseEditor( withMiddle, [
			{ key: 'ideation', label: 'Ideation', transitions: [] },
			{ key: 'triage', label: 'Triage', transitions: [] },
			{ key: 'editorial', label: 'Editorial', transitions: [] },
		] );

		expect(
			isValidConnection( { source: 'ideation', target: 'triage' } )
		).toBe( true );
		expect(
			isValidConnection( { source: 'triage', target: 'editorial' } )
		).toBe( true );
		expect(
			isValidConnection( { source: 'ideation', target: 'editorial' } )
		).toBe( false );
	} );

	// Nothing is drawable until the server has answered. Treating an unanswered
	// fetch as "connect anything" is the failure the fetch exists to remove.
	it( 'refuses every connection until the graph has arrived', async () => {
		await renderPhaseEditor( [], LIFECYCLE );

		expect(
			isValidConnection( { source: 'ideation', target: 'editorial' } )
		).toBe( false );
	} );

	// ...and the canvas is not on screen before then, which is the other half
	// of the same rule. The load waits for the options read rather than racing
	// it: `postTypes` is one of the load effect's dependencies, so a phase
	// editor that started before the answer landed read the sequence a SECOND
	// time when it did — and that read carries no `sent`, so it re-seats every
	// field outright and re-takes the dirty baseline from the server's copy.
	// Anything typed in the window between the two responses went with it, with
	// Save switched off and both exit guards stood down on the loss.
	it( 'reads the sequence once, not once per response', async () => {
		const calls = [];
		apiFetch.mockImplementation( ( { path } ) => {
			calls.push( path );
			if ( path === '/vip-workflows/v1/sequences/options' ) {
				return Promise.resolve( {
					post_types: [ { value: 'post', label: 'Posts' } ],
					phase_transitions: IDEATION_TO_EDITORIAL,
					required_phase_transitions: IDEATION_TO_EDITORIAL,
				} );
			}
			if (
				path.startsWith( '/vip-workflows/v1/abilities' ) ||
				path === '/vip-workflows/v1/notifications/channels'
			) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( phaseSequence( LIFECYCLE ) );
		} );

		render(
			<SequenceGraphEditor
				sequenceId={ 3 }
				mode="phase"
				onCancel={ jest.fn() }
			/>
		);

		await waitFor( () =>
			expect( isValidConnection ).toBeInstanceOf( Function )
		);
		await act( async () => {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		} );

		expect(
			calls.filter( ( path ) => path === '/vip-workflows/v1/sequences/3' )
		).toHaveLength( 1 );
	} );
} );

/*
 * The other half of the same graph. What a phase sequence MAY connect is one
 * question; what it may not be saved WITHOUT is another, and the server answers
 * both — the second as `required_phase_transitions`, which its write gate
 * refuses on. The editor used to answer this one itself, and it answered a
 * different question than it asked: it checked that both phases were on the
 * canvas, never that anything joined them, and the "no way out" check that would
 * have caught that is only a warning on a phase sequence. So a lifecycle with
 * two phases and no hand-off saved, and the promotion it configures had nowhere
 * to go.
 */
describe( 'What a phase sequence may not save without', () => {
	const saveButton = () =>
		screen.getByRole( 'button', { name: /^(Save|Saving…|Saved!)$/ } );
	const nameField = () => screen.getByRole( 'textbox', { name: /^Name/ } );

	beforeEach( () => {
		isValidConnection = undefined;
		writes = [];
	} );

	it( 'refuses the save when a required hand-off is missing', async () => {
		await renderPhaseEditor( IDEATION_TO_EDITORIAL, LIFECYCLE );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		// Named, and nothing written: the server would refuse this config, so
		// the canvas refuses it first rather than posting into a 422. The
		// message lands twice — the notice, and the live region that reads it
		// out — so the query takes both.
		const [ notice ] = await screen.findAllByText( /hand off/i );
		expect( notice ).toHaveTextContent( 'ideation' );
		expect( notice ).toHaveTextContent( 'editorial' );
		expect( writes ).toHaveLength( 0 );
	} );

	it( 'saves once the hand-off is drawn', async () => {
		await renderPhaseEditor( IDEATION_TO_EDITORIAL, LIFECYCLE_CONNECTED );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
	} );

	// The obligation is read, not remembered: a lifecycle that grows a phase in
	// the middle is required to hand off through it the moment the server says
	// so, with nothing in the editor to update.
	it( 'requires whatever hand-offs the server publishes', async () => {
		const throughTriage = [
			{ from: 'ideation', to: 'triage' },
			{ from: 'triage', to: 'editorial' },
		];

		await renderPhaseEditor(
			throughTriage,
			LIFECYCLE_CONNECTED,
			throughTriage
		);

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		expect( await screen.findAllByText( /triage/ ) ).not.toHaveLength( 0 );
		expect( writes ).toHaveLength( 0 );
	} );
} );
