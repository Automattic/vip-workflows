/**
 * What a keyboard or screen-reader author meets tabbing the sequence canvas:
 * one stop per transition — its pill — named by what activating it does, its
 * visible text and the stage the line leaves.
 *
 * The pill's visible text is the writer's button label, "Move to Done", which
 * every transition into Done shares. Used alone as the accessible name it
 * announced the same thing once per incoming line. React Flow's own edge group
 * came first in the tab order besides, named from raw stage keys.
 *
 * That text alone also promised a move, where activating the pill selects the
 * transition and opens its inspector, so the name leads with "Edit transition".
 * The visible text follows exactly and in one piece, so a voice-control user
 * who says what they see reaches the pill (WCAG 2.5.3, Label in Name).
 *
 * The names are built in `buildGraph`, from stage labels, so they are asserted
 * on its output; `transition-edge.test.js` covers the pill wearing them.
 *
 * @package
 */

import {
	buildGraph,
	transitionPillName,
} from '../../src/admin/components/graph/graph-model';

/**
 * A sequence where two stages lead to the same one, and the AI stage routes a
 * pass/fail pair to one destination.
 *
 * @return {Array} Stage objects.
 */
const stages = () => [
	{
		key: 'draft',
		label: 'Draft',
		is_terminal: false,
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'review' }, { to: 'done' } ],
	},
	{
		key: 'review',
		label: 'Review',
		is_terminal: false,
		status: 'draft',
		region_entry: false,
		agent: {
			ability_id: 'copy-edit',
			routing: { pass: 'done', fail: 'done', error: 'draft' },
		},
		transitions: [ { to: 'done' }, { to: 'draft' } ],
	},
	{
		key: 'done',
		label: 'Done',
		is_terminal: true,
		status: 'publish',
		region_entry: true,
		transitions: [],
	},
];

/**
 * @param {Array} edges Edges from `buildGraph`.
 * @return {Array} The transition edges — the ones that carry a pill.
 */
const transitionEdges = ( edges ) =>
	edges.filter( ( e ) => ! e.data.synthetic );

describe( 'transition pill names', () => {
	it( 'says it edits the transition, then gives the visible label and the source stage', () => {
		const { edges } = buildGraph( stages() );
		const edge = edges.find( ( e ) => e.id === 'draft->review' );

		expect( edge.data.label ).toBe( 'Move to Review' );
		expect( edge.data.pillName ).toBe(
			'Edit transition: Move to Review, from Draft'
		);
	} );

	it( 'carries exactly the text its pill shows, whole, after the action', () => {
		// Label in Name: voice control matches on what is on screen, so the
		// visible text has to appear in the name unchanged and in one piece.
		const { edges } = buildGraph( stages() );

		transitionEdges( edges ).forEach( ( edge ) => {
			expect(
				edge.data.pillName.startsWith(
					`Edit transition: ${ edge.data.label }, from `
				)
			).toBe( true );
		} );
	} );

	it( 'carries an authored label when the transition has one', () => {
		const authored = stages().map( ( s ) =>
			s.key === 'draft'
				? { ...s, transitions: [ { to: 'review', label: 'Submit' } ] }
				: s
		);
		const { edges } = buildGraph( authored );

		expect(
			edges.find( ( e ) => e.id === 'draft->review' ).data.pillName
		).toBe( 'Edit transition: Submit, from Draft' );
	} );

	it( 'tells apart transitions into the same stage', () => {
		// Both pills read "Move to Done"; the names have to differ.
		const { edges } = buildGraph( stages() );
		const intoDone = transitionEdges( edges ).filter(
			( e ) => e.target === 'done'
		);

		expect( intoDone.map( ( e ) => e.data.label ) ).toEqual(
			intoDone.map( () => 'Move to Done' )
		);
		expect( new Set( intoDone.map( ( e ) => e.data.pillName ) ).size ).toBe(
			intoDone.length
		);
	} );

	it( 'tells apart the lines of a shared pass/fail pair by outcome', () => {
		// One record drawn twice, with the same two ends.
		const { edges } = buildGraph( stages() );

		expect(
			edges.find( ( e ) => e.id === 'review:pass->done' ).data.pillName
		).toBe( 'Edit transition: Move to Done, from Review (On pass)' );
		expect(
			edges.find( ( e ) => e.id === 'review:fail->done' ).data.pillName
		).toBe( 'Edit transition: Move to Done, from Review (On fail)' );
		expect(
			edges.find( ( e ) => e.id === 'review:error->draft' ).data.pillName
		).toBe( 'Edit transition: Move to Draft, from Review (On error)' );
	} );

	it( 'gives every pill on the canvas a name of its own', () => {
		const { edges } = buildGraph( stages() );
		const names = transitionEdges( edges ).map( ( e ) => e.data.pillName );

		expect( new Set( names ).size ).toBe( names.length );
	} );

	it( 'names an unlabelled stage by its key rather than leaving a blank', () => {
		// `validateSequence` reports the missing name; the pill still has to
		// say which stage the line leaves.
		const unlabelled = stages().map( ( s ) =>
			s.key === 'review' ? { ...s, label: '' } : s
		);
		const { edges } = buildGraph( unlabelled );

		expect(
			edges.find( ( e ) => e.id === 'review:pass->done' ).data.pillName
		).toBe( 'Edit transition: Move to Done, from review (On pass)' );
	} );

	it( 'leaves an outcome off a plain transition', () => {
		expect( transitionPillName( 'Move to Review', 'Draft' ) ).toBe(
			'Edit transition: Move to Review, from Draft'
		);
		expect( transitionPillName( 'Move to Review', 'Draft', null ) ).toBe(
			'Edit transition: Move to Review, from Draft'
		);
	} );
} );

describe( 'transition edge groups', () => {
	it( 'are out of the tab order and hidden from assistive technology', () => {
		// The pill is the transition's one stop; the group would be a second
		// one, named from raw keys.
		const { edges } = buildGraph( stages() );
		const transitions = transitionEdges( edges );

		expect( transitions.length ).toBeGreaterThan( 0 );
		transitions.forEach( ( edge ) => {
			expect( edge.focusable ).toBe( false );
			expect( edge.domAttributes ).toEqual( { 'aria-hidden': true } );
		} );
	} );

	it( 'leave the synthetic Start/End lines focusable', () => {
		// They have no pill, so their group is their only stop — and the End
		// line's is how the keyboard makes a stage non-final.
		const { edges } = buildGraph( stages() );
		const synthetic = edges.filter( ( e ) => e.data.synthetic );

		expect( synthetic.length ).toBeGreaterThan( 0 );
		synthetic.forEach( ( edge ) => {
			expect( edge.focusable ).toBeUndefined();
			expect( edge.domAttributes ).toBeUndefined();
		} );
	} );
} );
