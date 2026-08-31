/**
 * The transition rail's drawing, tested as data.
 *
 * `railGeometry()` is pure — measured row midpoints in, path data out — so
 * every layout the rail can draw is a fixture here, without a DOM. The rules
 * under test are the spec's (docs/specs/shipped/transition-rail.md): the
 * trunk ends at the last fillet so nothing overruns past the last button, and
 * every arrowhead stops `MARK_STANDOFF` short of the button border.
 *
 * @package
 */

import {
	railGeometry,
	RAIL,
} from '../../src/editor/components/transition-rail-geometry';

const { TRUNK_X, FILLET, TIP_X } = RAIL;

/**
 * The spur path a row at midpoint y produces.
 *
 * @param {number} y Row midpoint.
 * @return {string} Path data.
 */
function spur( y ) {
	return (
		`M ${ TRUNK_X },${ y - FILLET } ` +
		`Q ${ TRUNK_X },${ y } ${ TRUNK_X + FILLET },${ y } ` +
		`H ${ TIP_X }`
	);
}

describe( 'railGeometry', () => {
	it( 'draws nothing for zero rows', () => {
		expect( railGeometry( [], { top: 17 } ) ).toEqual( {
			lines: [],
			heads: [],
		} );
	} );

	it( 'draws a trunk ending at the single row’s fillet, one spur, one head', () => {
		const geometry = railGeometry( [ { y: 57 } ], { top: 17 } );

		expect( geometry.lines ).toEqual( [
			`M ${ TRUNK_X },17 V ${ 57 - FILLET }`,
			spur( 57 ),
		] );
		expect( geometry.heads ).toEqual( [ { x: TIP_X, y: 57 } ] );
	} );

	it( 'ends the trunk at the LAST fillet with several rows — nothing overruns', () => {
		const geometry = railGeometry( [ { y: 50 }, { y: 100 }, { y: 150 } ], {
			top: 17,
		} );

		expect( geometry.lines[ 0 ] ).toBe(
			`M ${ TRUNK_X },17 V ${ 150 - FILLET }`
		);
		expect( geometry.lines.slice( 1 ) ).toEqual( [
			spur( 50 ),
			spur( 100 ),
			spur( 150 ),
		] );
		expect( geometry.heads ).toHaveLength( 3 );
	} );

	/**
	 * The trunk is one unbroken line whatever the rows are. It used to break
	 * around a wavy elision mark above the first bypass row; transitions no
	 * longer declare a kind, so there is nothing to elide and no break to draw.
	 */
	it( 'draws one unbroken trunk line however many rows there are', () => {
		const geometry = railGeometry( [ { y: 50 }, { y: 100 }, { y: 172 } ], {
			top: 17,
		} );

		const trunks = geometry.lines.filter( ( d ) => d.includes( ' V ' ) );

		expect( trunks ).toEqual( [ `M ${ TRUNK_X },17 V ${ 172 - FILLET }` ] );
	} );

	it( 'treats a dead end’s END pill row exactly like a button row', () => {
		// A dead end's rail is one spur into the END pill; geometry has no
		// special case for it, which is the point — the pill rides the rail
		// like any destination. A completed workflow renders no pill at all,
		// which is the zero-rows case above.
		const geometry = railGeometry( [ { y: 60 } ], { top: 17 } );

		expect( geometry.lines ).toHaveLength( 2 );
		expect( geometry.heads ).toEqual( [ { x: TIP_X, y: 60 } ] );
	} );

	it( 'stops every arrowhead MARK_STANDOFF short of the 28px button border', () => {
		// TIP_X is derived from the shared MARK_STANDOFF, not restated — the
		// same clearance the canvas trims its edges to.
		expect( TIP_X ).toBe( 28 - 1.5 );
	} );
} );
