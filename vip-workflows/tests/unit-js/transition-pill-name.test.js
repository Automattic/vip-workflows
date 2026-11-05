/**
 * What a keyboard or screen-reader author meets tabbing the sequence canvas:
 * one stop per transition — its pill — named for what activating it does and
 * which two stages the line joins.
 *
 * The pill's visible text is the writer's button label, "Move to Done", which
 * every transition into Done shares. Used as the accessible name it announced
 * the same thing once per incoming line, and promised a move the pill does not
 * make: activating it selects the transition. React Flow's own edge group came
 * first in the tab order besides, named from raw stage keys.
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
	it( 'names the action and both ends, by stage label', () => {
		const { edges } = buildGraph( stages() );
		const edge = edges.find( ( e ) => e.id === 'draft->review' );

		expect( edge.data.pillName ).toBe(
			'Select transition: Draft → Review'
		);
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
		).toBe( 'Select transition: Review → Done (On pass)' );
		expect(
			edges.find( ( e ) => e.id === 'review:fail->done' ).data.pillName
		).toBe( 'Select transition: Review → Done (On fail)' );
		expect(
			edges.find( ( e ) => e.id === 'review:error->draft' ).data.pillName
		).toBe( 'Select transition: Review → Draft (On error)' );
	} );

	it( 'gives every pill on the canvas a name of its own', () => {
		const { edges } = buildGraph( stages() );
		const names = transitionEdges( edges ).map( ( e ) => e.data.pillName );

		expect( new Set( names ).size ).toBe( names.length );
	} );

	it( 'names an unlabelled stage by its key rather than leaving a blank', () => {
		// `validateSequence` reports the missing name; the pill still has to
		// say which stage the line reaches.
		const unlabelled = stages().map( ( s ) =>
			s.key === 'review' ? { ...s, label: '' } : s
		);
		const { edges } = buildGraph( unlabelled );

		expect(
			edges.find( ( e ) => e.id === 'draft->review' ).data.pillName
		).toBe( 'Select transition: Draft → review' );
	} );

	it( 'leaves an outcome off a plain transition', () => {
		expect( transitionPillName( 'Draft', 'Review' ) ).toBe(
			'Select transition: Draft → Review'
		);
		expect( transitionPillName( 'Draft', 'Review', null ) ).toBe(
			'Select transition: Draft → Review'
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
