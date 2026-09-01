/**
 * Authoring the order a stage's transition buttons appear in.
 *
 * Order is the stored `transitions` array — it is already the source of truth and
 * already round-trips through the graph model, so reordering needs no new storage
 * and no migration. What was missing is any way for an author to change it:
 * transitions are graph edges, edited one at a time, so nothing ever showed a
 * stage's outgoing transitions as a list.
 *
 * The reorder itself is a pure function on the array. Index arithmetic is easy to
 * get wrong and silent when it is, and a drag in jsdom proves far less than the
 * mapping does.
 *
 * It takes positions rather than destination keys. A stage stored before the
 * one-transition-per-target rule can hold two transitions to the same place, so
 * resolving a key to an index would find the first of the pair and dragging the
 * second would move the first.
 *
 * @package
 */

import { render, screen } from './helpers/render-wp-component';
import { reorderList } from '../../src/admin/components/graph/graph-model';
import StageInspector from '../../src/admin/components/graph/StageInspector';

const TRANSITIONS = [
	{ to: 'fact_check' },
	{ to: 'copy_desk' },
	{ to: 'review', label: 'Send to Review', show_in_queue: true },
];

/**
 * Destination keys of a transition array.
 *
 * @param {Array} transitions Transitions.
 * @return {string[]} Keys.
 */
const keys = ( transitions ) => transitions.map( ( t ) => t.to );

describe( 'reorderList', () => {
	it( 'moves a transition to the position of the one it was dropped on', () => {
		expect( keys( reorderList( TRANSITIONS, 2, 0 ) ) ).toEqual( [
			'review',
			'fact_check',
			'copy_desk',
		] );
	} );

	it( 'moves a transition downward as well as upward', () => {
		expect( keys( reorderList( TRANSITIONS, 0, 2 ) ) ).toEqual( [
			'copy_desk',
			'review',
			'fact_check',
		] );
	} );

	it( 'preserves the relative order of everything it did not move', () => {
		const reordered = reorderList(
			[ { to: 'a' }, { to: 'b' }, { to: 'c' }, { to: 'd' } ],
			3,
			1
		);

		expect( keys( reordered ) ).toEqual( [ 'a', 'd', 'b', 'c' ] );
	} );

	it( 'carries each transition’s other config with it', () => {
		const reordered = reorderList( TRANSITIONS, 2, 0 );

		expect( reordered[ 0 ].label ).toBe( 'Send to Review' );
		expect( reordered[ 0 ].show_in_queue ).toBe( true );
	} );

	// ── No-ops ───────────────────────────────────────────────────────

	/**
	 * A drop that ends where it started must not report a change, or the sequence
	 * is marked dirty by a drag the author abandoned.
	 */
	it( 'returns the same array reference when the position is unchanged', () => {
		expect( reorderList( TRANSITIONS, 1, 1 ) ).toBe( TRANSITIONS );
	} );

	it( 'returns the same array reference when the drop index is out of range', () => {
		expect( reorderList( TRANSITIONS, 1, 9 ) ).toBe( TRANSITIONS );
	} );

	it( 'returns the same array reference when the moved index is out of range', () => {
		expect( reorderList( TRANSITIONS, -1, 1 ) ).toBe( TRANSITIONS );
	} );

	it( 'survives an empty list', () => {
		expect( reorderList( [], 0, 1 ) ).toEqual( [] );
	} );

	it( 'does not mutate the input array', () => {
		const input = [ { to: 'a' }, { to: 'b' } ];
		reorderList( input, 1, 0 );

		expect( keys( input ) ).toEqual( [ 'a', 'b' ] );
	} );
} );

describe( 'StageInspector outgoing transitions list', () => {
	/**
	 * Render the inspector for a stage.
	 *
	 * @param {Object}   stage    Stage config.
	 * @param {Function} onChange Change handler.
	 */
	function renderInspector( stage, onChange = () => {} ) {
		render(
			<StageInspector
				stage={ stage }
				onChange={ onChange }
				onRemove={ () => {} }
				availableAgents={ [] }
				resolveStageLabel={ ( key ) =>
					( {
						fact_check: 'Fact Check',
						copy_desk: 'Copy Desk',
						review: 'Review',
					} )[ key ] || key
				}
			/>
		);
	}

	/**
	 * Resolved labels of the stage's own transitions, not the agent-routing
	 * selects that read the same array.
	 */
	it( 'lists each outgoing transition by its destination’s current name', () => {
		renderInspector( {
			key: 'draft',
			label: 'Draft',
			transitions: TRANSITIONS,
		} );

		// Derived at render, like transition labels — a renamed stage must read
		// correctly here for the same reason.
		expect( screen.getAllByText( 'Fact Check' ).length ).toBeGreaterThan(
			0
		);
		expect( screen.getAllByText( 'Copy Desk' ).length ).toBeGreaterThan(
			0
		);
	} );

	it( 'renders an empty state for a stage with no outgoing transitions', () => {
		renderInspector( {
			key: 'published',
			label: 'Published',
			transitions: [],
		} );

		expect(
			screen.getByText( /no outgoing transitions|nothing leaves/i )
		).toBeInTheDocument();
	} );

	/**
	 * A dangling edge must not make the list unusable while the author is
	 * mid-repair — the destination is gone, but the row still has to render.
	 */
	it( 'renders a transition whose destination no longer exists', () => {
		renderInspector( {
			key: 'draft',
			label: 'Draft',
			transitions: [ { to: 'deleted_stage' } ],
		} );

		expect( screen.getAllByText( 'deleted_stage' ).length ).toBeGreaterThan(
			0
		);
	} );

	/**
	 * The drag handle is a real button, not the row itself: the row can hold a
	 * tooltip trigger, and dnd-kit's attributes would make whatever carries them
	 * a second control around it. A button is also what gives the KeyboardSensor
	 * a tab stop, so the order is reachable without a pointer.
	 */
	it( 'gives every transition a reorder handle a keyboard can reach', () => {
		renderInspector( {
			key: 'draft',
			label: 'Draft',
			transitions: TRANSITIONS,
		} );

		expect(
			screen.getAllByRole( 'button', { name: /^Reorder / } )
		).toHaveLength( TRANSITIONS.length );
	} );

	/**
	 * Two transitions to the same stage is the pre-2.19.0 shape the repair
	 * collapses, and this list is where an author is asked to look at them first.
	 * The sortable ids are positions for that reason — keyed by destination, the
	 * pair would collide and dnd-kit could not tell them apart.
	 */
	it( 'gives each of two transitions to the same stage its own handle', () => {
		renderInspector( {
			key: 'draft',
			label: 'Draft',
			transitions: [
				{ to: 'review', label: 'Send to review' },
				{ to: 'review', label: 'Send back to review' },
			],
		} );

		expect(
			screen.getAllByRole( 'button', { name: /^Reorder / } )
		).toHaveLength( 2 );
		expect(
			screen.getByRole( 'button', { name: 'Reorder Send to review' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'Reorder Send back to review',
			} )
		).toBeInTheDocument();
	} );
} );
