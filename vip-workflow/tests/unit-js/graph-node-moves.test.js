/**
 * Unit tests for how the sequence canvas reads React Flow's position changes.
 *
 * `GraphCanvas` gets every node movement as a batch of `{ type: 'position' }`
 * changes, and the `dragging` flag on them is ambiguous: React Flow emits
 * `dragging: false` for the closing change of a pointer drag, for an aborted
 * drag, and for a keyboard step (arrow keys on a focused, selected node), which
 * is not a drag at all. Those three want opposite handling — hold the in-flight
 * position, drop it, and commit it — so `classifyPositionChanges` separates them
 * against the set of ids whose drag is actually in flight.
 *
 * The classifier is the whole of that decision, and it is pure, so it is tested
 * here directly — as is `placementIn`, which turns the position a gesture ends
 * at into the offset that gets recorded. What sits between them,
 * `commitStagePlacement`, is inside the canvas component and would need a React
 * Flow jsdom harness to reach.
 *
 * @package
 */

import {
	classifyPositionChanges,
	placementIn,
} from '../../src/admin/components/graph/GraphCanvas';
import {
	positionIn,
	BAND_PADDING,
	BAND_TOP_CLEARANCE,
} from '../../src/admin/components/graph/layout';

/**
 * A React Flow position change.
 *
 * @param {string}  id     Node id.
 * @param {number}  x      X position.
 * @param {number}  y      Y position.
 * @param {boolean} [drag] The change's `dragging` flag.
 * @return {Object} The change.
 */
const move = ( id, x, y, drag ) => ( {
	id,
	type: 'position',
	position: { x, y },
	dragging: drag,
} );

describe( 'classifyPositionChanges', () => {
	it( 'holds an in-flight drag position and remembers the node is dragging', () => {
		const inFlight = new Set();
		const result = classifyPositionChanges(
			[ move( 'draft', 10, 20, true ) ],
			inFlight
		);

		expect( result.moving ).toEqual( [ move( 'draft', 10, 20, true ) ] );
		expect( result.released ).toEqual( [] );
		expect( result.stepped ).toEqual( [] );
		expect( inFlight.has( 'draft' ) ).toBe( true );
	} );

	it( 'releases the in-flight position when a drag ends', () => {
		// The closing change of a real drag. `onNodeDragStop` follows it and is
		// what commits, so this only has to let go of the transient position.
		const inFlight = new Set( [ 'draft' ] );
		const result = classifyPositionChanges(
			[ move( 'draft', 10, 20, false ) ],
			inFlight
		);

		expect( result.moving ).toEqual( [] );
		expect( result.released ).toEqual( [ 'draft' ] );
		expect( result.stepped ).toEqual( [] );
		expect( inFlight.has( 'draft' ) ).toBe( false );
	} );

	it( 'releases the in-flight position when a drag aborts', () => {
		// An abort (a second touch point, or the node deleted mid-drag) emits the
		// same closing change and then returns without calling `onNodeDragStop`.
		// Nothing commits, and — this is the bug the release closes — nothing is
		// left in the in-flight set or the position map either, where it would
		// outrank the layout for that node for the rest of the session.
		const inFlight = new Set( [ 'draft', 'review' ] );
		const result = classifyPositionChanges(
			[ move( 'draft', 10, 20, false ), move( 'review', 30, 40, false ) ],
			inFlight
		);

		expect( result.released ).toEqual( [ 'draft', 'review' ] );
		expect( result.stepped ).toEqual( [] );
		expect( inFlight.size ).toBe( 0 );
	} );

	it( 'reads a position change with nothing in flight as a keyboard step', () => {
		// `useMoveSelectedNodes` calls `updateNodePositions( nodeUpdates )` with
		// no `dragging` argument, so the change looks exactly like a drag's
		// closing one — except that no drag ever started for that node.
		const inFlight = new Set();
		const result = classifyPositionChanges(
			[ move( 'draft', 15, 20, false ) ],
			inFlight
		);

		expect( result.moving ).toEqual( [] );
		expect( result.released ).toEqual( [] );
		expect( result.stepped ).toEqual( [ move( 'draft', 15, 20, false ) ] );
		expect( inFlight.size ).toBe( 0 );
	} );

	it( 'reads an undefined dragging flag as a keyboard step too', () => {
		// The flag defaults to `false` in `updateNodePositions`, but nothing in
		// the change's shape promises it is present at all.
		const result = classifyPositionChanges(
			[ move( 'draft', 15, 20, undefined ) ],
			new Set()
		);

		expect( result.stepped ).toHaveLength( 1 );
		expect( result.released ).toEqual( [] );
	} );

	it( 'steps repeatedly without ever entering the drag set', () => {
		// Held arrow key: every press has to commit, because none of them will
		// ever reach `onNodeDragStop`.
		const inFlight = new Set();
		const stepped = [ 15, 20, 25 ].flatMap(
			( x ) =>
				classifyPositionChanges(
					[ move( 'draft', x, 20, false ) ],
					inFlight
				).stepped
		);

		expect( stepped.map( ( s ) => s.position.x ) ).toEqual( [
			15, 20, 25,
		] );
		expect( inFlight.size ).toBe( 0 );
	} );

	it( 'keeps a dragged node and a stepped node apart in one batch', () => {
		const inFlight = new Set( [ 'draft' ] );
		const result = classifyPositionChanges(
			[ move( 'draft', 10, 20, true ), move( 'review', 30, 40, false ) ],
			inFlight
		);

		expect( result.moving.map( ( m ) => m.id ) ).toEqual( [ 'draft' ] );
		expect( result.stepped.map( ( m ) => m.id ) ).toEqual( [ 'review' ] );
		expect( result.released ).toEqual( [] );
	} );

	it( 'follows a whole drag from first move to drop', () => {
		const inFlight = new Set();

		const start = classifyPositionChanges(
			[ move( 'draft', 10, 20, true ) ],
			inFlight
		);
		const during = classifyPositionChanges(
			[ move( 'draft', 12, 24, true ) ],
			inFlight
		);
		const end = classifyPositionChanges(
			[ move( 'draft', 12, 24, false ) ],
			inFlight
		);

		expect( start.moving ).toHaveLength( 1 );
		expect( during.moving ).toHaveLength( 1 );
		// Not a step: the drop commits from `onNodeDragStop`, and committing
		// here as well would place the stage twice.
		expect( end.stepped ).toEqual( [] );
		expect( end.released ).toEqual( [ 'draft' ] );
		expect( inFlight.size ).toBe( 0 );
	} );
} );

describe( 'placementIn', () => {
	// A band as `layoutSequence` builds one, with nothing placed in it yet: the
	// content origin sits `BAND_PADDING` right and `BAND_TOP_CLEARANCE` down
	// from the top-left corner.
	const band = {
		region: 'pending',
		x: 0,
		y: 400,
		width: 824,
		height: 244,
		contentX: BAND_PADDING,
		contentY: BAND_TOP_CLEARANCE,
		contentWidth: 760,
		contentHeight: 132,
	};
	const bands = { pending: band };
	const origin = { x: band.x + band.contentX, y: band.y + band.contentY };

	it( 'records a drop inside the content box as its offset from the origin', () => {
		expect(
			placementIn(
				{ x: origin.x + 120, y: origin.y + 40 },
				'pending',
				bands
			)
		).toEqual( { region: 'pending', x: 120, y: 40 } );
	} );

	// The bug this replaced: a stage let go in the band's top clearance — below
	// the border, above the content origin — had its offset held at zero, so it
	// was moved back down onto the first row. The author got no warning while
	// aiming, because the correction happened after they released. Nothing is
	// held now; the band grows upward to reach it.
	it( 'keeps a drop above the content origin above it', () => {
		expect(
			placementIn( { x: origin.x, y: band.y + 20 }, 'pending', bands )
		).toEqual( { region: 'pending', x: 0, y: 20 - BAND_TOP_CLEARANCE } );
	} );

	it( 'keeps a drop left of the content origin left of it', () => {
		expect(
			placementIn( { x: band.x, y: origin.y }, 'pending', bands )
		).toEqual( { region: 'pending', x: -BAND_PADDING, y: 0 } );
	} );

	it( 'round-trips any drop, in any direction, back to where it was let go', () => {
		// The property the clamp broke, and the one that makes a placement a
		// record of the gesture rather than an approximation of it.
		[
			{ x: origin.x + 300, y: origin.y + 200 },
			{ x: origin.x - 240, y: origin.y - 180 },
			{ x: origin.x, y: origin.y },
			{ x: origin.x - 1000, y: origin.y - 1000 },
		].forEach( ( position ) => {
			expect(
				positionIn( band, placementIn( position, 'pending', bands ) )
			).toEqual( position );
		} );
	} );

	it( 'records an absolute point when there is no band to anchor to', () => {
		// A phase sequence has no regions, and so no bands.
		expect( placementIn( { x: 42, y: 84 }, null, {} ) ).toEqual( {
			region: null,
			x: 42,
			y: 84,
		} );
	} );
} );
