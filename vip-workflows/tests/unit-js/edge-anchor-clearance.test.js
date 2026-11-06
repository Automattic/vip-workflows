/**
 * The departure anchor and the controls underneath it.
 *
 * `EdgeAnchors` puts its source ring on `plan.source`, which for the commonest
 * edge on the canvas — a plain stage leaving by its bottom border — is exactly
 * where the card's drag grip sits. At full width the ring's invisible grab disc
 * covers that grip, so with an outgoing transition selected no new connection
 * could be drawn out of the stage. The ring stays on the border — it marks
 * where the edge ends — and `grabRadius` narrows its disc there instead, with
 * `handleAt` as the measurement that says it is covered.
 *
 * Both are pure; the components around them can only run against a live React
 * Flow store, which is why each is exported for this file.
 */

import { grabRadius } from '../../src/admin/components/graph/EdgeAnchors';
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

describe( 'grabRadius', () => {
	it( 'keeps the full grab disc where nothing is underneath', () => {
		expect( grabRadius( null ) ).toBe( 11 );
	} );

	// The grip is 22px across, so a disc narrower than its half-width leaves a
	// rim of the grip reachable around the ring.
	it( 'narrows the disc over a handle so the handle stays reachable', () => {
		const radius = grabRadius( handleAt( [ GRIP ], BOTTOM_PORT ) );
		expect( radius ).toBeLessThan( 11 );
		expect( radius ).toBeGreaterThan( 4.5 );
	} );
} );
