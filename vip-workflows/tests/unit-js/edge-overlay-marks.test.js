/**
 * EdgeOverlay's end marks — the two halves of it that are pure.
 *
 * The yield rule's geometry, and the signature the layer reads its colours and
 * end nodes out of. Everything else about the marks needs a live React Flow
 * store and is exercised in the browser.
 *
 * ## The yield rule
 *
 * An arrowhead yields to an AI stage's outcome badge (the head would stamp
 * itself over the badge's glyph), but only while the badge is painted, and
 * never to the anonymous drag grip. `coveredOutcomeBadge` is the geometric
 * half of that rule: which badge, if any, a mark's tip lands on. The painted
 * half (hover, connection-in-flight) lives in the component against a live
 * React Flow store, which is why the geometry is exported and pinned here.
 *
 * The one case these tests must keep true is the one the rule was shaped
 * around: a back edge arriving dead centre on a bottom border lands its tip
 * inside the drag grip's bounds, and the grip is transparent at rest — so a
 * suppressed arrowhead there left *nothing* to say where the edge lands.
 * Only a handle whose id names an agent outcome may claim a head; the grip's
 * id is null, and it never does.
 *
 * Rects mirror what React Flow measures for a 200×80 stage: 22px pill
 * handles straddling the bottom border (y 69–91), the outcome trio clustered
 * at 26px centres around the midpoint.
 *
 * @package
 */

import {
	coveredOutcomeBadge,
	readEdgeStates,
	selectEdgeStates,
} from '../../src/admin/components/graph/EdgeOverlay';

// A 200×80 stage at the origin; bottom border at y = 80.
const OUTCOME_HANDLES = [
	{ id: 'pass', x: 63, y: 69, width: 22, height: 22 },
	{ id: 'fail', x: 89, y: 69, width: 22, height: 22 },
	{ id: 'error', x: 115, y: 69, width: 22, height: 22 },
];

// The plain stage's single drag grip — same pill, no id.
const GRIP_HANDLES = [ { id: null, x: 89, y: 69, width: 22, height: 22 } ];

describe( 'coveredOutcomeBadge', () => {
	it( 'names the outcome badge a tip lands inside', () => {
		expect(
			coveredOutcomeBadge( { x: 100, y: 81.5 }, OUTCOME_HANDLES )
		).toBe( 'fail' );
	} );

	it( 'never yields to the anonymous drag grip', () => {
		// The dead-centre back edge: tip at MARK_STANDOFF below the bottom
		// border's midpoint, squarely inside the grip's bounds. The grip is
		// transparent at rest, so eating the arrowhead here left nothing to
		// say where the edge lands — the regression the outcome-only rule
		// exists to prevent.
		expect( coveredOutcomeBadge( { x: 100, y: 81.5 }, GRIP_HANDLES ) ).toBe(
			null
		);
	} );

	it( 'skips the grip to find the badge underneath the same point', () => {
		// The non-vacuous half of the grip rule. The grip-only case above
		// cannot tell the outcome guard from its absence — a matched null-id
		// rect maps to null through `?.id || null` either way — so this pins
		// the guard itself: a null-id rect FIRST in the array and a 'pass'
		// badge second, both containing the tip. With the guard the grip is
		// skipped and the badge answers; without it, `find` stops at the grip
		// and the result collapses to null.
		expect(
			coveredOutcomeBadge( { x: 100, y: 80 }, [
				{ id: null, x: 89, y: 69, width: 22, height: 22 },
				{ id: 'pass', x: 89, y: 69, width: 22, height: 22 },
			] )
		).toBe( 'pass' );
	} );

	it( 'leaves a tip clear of every badge alone', () => {
		// An arrival on the same border but outside the cluster — and one on
		// another border entirely — keep their arrowheads.
		expect(
			coveredOutcomeBadge( { x: 30, y: 81.5 }, OUTCOME_HANDLES )
		).toBe( null );
		expect(
			coveredOutcomeBadge( { x: 100, y: -1.5 }, OUTCOME_HANDLES )
		).toBe( null );
	} );

	it( 'counts a head grazing a badge’s edge as covering it', () => {
		// The chevron's arms reach ~3.54px around the tip, so the bounds are
		// inflated by that reach: a tip 3px past the error badge's outer edge
		// still lays its arms across the badge.
		expect(
			coveredOutcomeBadge( { x: 140, y: 80 }, OUTCOME_HANDLES )
		).toBe( 'error' );
		// And past the reach, it does not.
		expect(
			coveredOutcomeBadge( { x: 145, y: 80 }, OUTCOME_HANDLES )
		).toBe( null );
	} );

	it( 'answers null for a node with no measured handles', () => {
		// End has no source handles at all, and every node is unmeasured on
		// first paint.
		expect( coveredOutcomeBadge( { x: 100, y: 81.5 }, undefined ) ).toBe(
			null
		);
		expect( coveredOutcomeBadge( { x: 100, y: 81.5 }, [] ) ).toBe( null );
	} );
} );

describe( 'edge-state signature', () => {
	// The layer reads its colours and its two end nodes out of a joined string,
	// because the React Flow store hands back a new object every tick and a
	// string lets the memo skip an unchanged frame. Writer and reader are one
	// format written twice: a field added to the row and not to the read shifts
	// every field after it, which draws the wrong marks without throwing. So the
	// two are held to each other here.
	const store = {
		edges: [
			{
				id: 'review:pass->done',
				className: 'is-outcome is-pass',
				selected: true,
				source: 'review',
				target: 'done',
				data: { outcome: 'pass' },
			},
			{
				id: 'draft->review',
				source: 'draft',
				target: 'review',
			},
		],
	};

	it( 'round-trips every field the marks are drawn from', () => {
		expect( readEdgeStates( selectEdgeStates( store ) ) ).toEqual( {
			'review:pass->done': {
				className: 'is-outcome is-pass',
				selected: true,
				source: 'review',
				target: 'done',
				outcome: 'pass',
			},
			// A plain transition carries no outcome and no classes of its own;
			// it departs by the neutral socket rather than an outcome mark.
			'draft->review': {
				className: '',
				selected: false,
				source: 'draft',
				target: 'review',
				outcome: '',
			},
		} );
	} );

	it( 'reads nothing out of an empty canvas', () => {
		expect( readEdgeStates( selectEdgeStates( { edges: [] } ) ) ).toEqual(
			{}
		);
	} );
} );
