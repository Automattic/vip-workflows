/**
 * The departure anchor and the controls underneath it.
 *
 * `EdgeAnchors` puts its source ring on `plan.source`, which for the commonest
 * edge on the canvas — a plain stage leaving by its bottom border — is exactly
 * where the card's drag grip sits. The ring carries an invisible grab disc
 * wider than that grip, so left alone it takes every press meant for the grip:
 * with an outgoing transition selected, no new connection can be drawn out of
 * the stage. `clearOf` steps the anchor out along the edge instead, and
 * `handleAt` is the measurement it steps out of.
 *
 * Both are pure; the components around them can only run against a live React
 * Flow store, which is why each is exported for this file.
 */

import { Position } from '@xyflow/react';
import { clearOf } from '../../src/admin/components/graph/EdgeAnchors';
import { handleAt } from '../../src/admin/components/graph/source-handles';

// A stage card at (0, 0), 200×80, with the anonymous drag grip centred on its
// bottom border — the measurements React Flow reports for a plain stage.
const GRIP = { id: null, x: 89, y: 76, width: 22, height: 8 };
const BOTTOM_PORT = { x: 100, y: 80 };

describe( 'handleAt', () => {
	it( 'finds the handle a point lands on', () => {
		expect( handleAt( [ GRIP ], BOTTOM_PORT ) ).toBe( GRIP );
	} );

	it( 'returns null for a point beside it', () => {
		expect( handleAt( [ GRIP ], { x: 60, y: 80 } ) ).toBeNull();
		expect( handleAt( [ GRIP ], { x: 100, y: 60 } ) ).toBeNull();
	} );

	it( 'treats a node with no measured handles as clear', () => {
		expect( handleAt( undefined, BOTTOM_PORT ) ).toBeNull();
		expect( handleAt( [], BOTTOM_PORT ) ).toBeNull();
	} );
} );

describe( 'clearOf', () => {
	it( 'leaves an uncovered anchor exactly where it was planned', () => {
		expect( clearOf( BOTTOM_PORT, null, Position.Bottom ) ).toEqual(
			BOTTOM_PORT
		);
	} );

	it( 'steps down past the grip for an edge leaving the bottom border', () => {
		const moved = clearOf( BOTTOM_PORT, GRIP, Position.Bottom );
		expect( moved.x ).toBe( 100 );
		// Clear of the grip's lower edge (84) by the grab radius, so the disc
		// no longer overlaps the control it was covering.
		expect( moved.y ).toBe( 95 );
		expect( handleAt( [ GRIP ], moved ) ).toBeNull();
	} );

	it( 'steps up for an edge leaving the top border', () => {
		const port = { x: 100, y: 0 };
		const topGrip = { id: null, x: 89, y: -4, width: 22, height: 8 };
		expect( clearOf( port, topGrip, Position.Top ) ).toEqual( {
			x: 100,
			y: -15,
		} );
	} );

	it( 'steps sideways for an edge leaving a left or right border', () => {
		const port = { x: 200, y: 40 };
		const sideGrip = { id: null, x: 196, y: 29, width: 8, height: 22 };
		expect( clearOf( port, sideGrip, Position.Right ) ).toEqual( {
			x: 215,
			y: 40,
		} );
		expect(
			clearOf( { x: 0, y: 40 }, { ...sideGrip, x: -4 }, Position.Left )
		).toEqual( { x: -15, y: 40 } );
	} );

	it( 'clears an outcome badge by its own width, not a fixed nudge', () => {
		// An AI stage's outcome pills are taller than the anonymous grip, so a
		// constant step would leave the ring still on top of one.
		const badge = { id: 'pass', x: 60, y: 72, width: 44, height: 16 };
		const moved = clearOf( { x: 80, y: 80 }, badge, Position.Bottom );
		expect( moved.y ).toBe( 99 );
		expect( handleAt( [ badge ], moved ) ).toBeNull();
	} );
} );
