/**
 * Unit tests for floating-edge geometry.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import {
	getNodeIntersection,
	getEdgeSide,
	getFloatingEdgeParams,
	easeOffCorner,
	borderPointOn,
	getSidedEdgeParams,
} from '../../src/admin/components/graph/floating-edge';
import { BORDER_INSET } from '../../src/admin/components/graph/edge-constants';

// A stage-sized node rectangle (200×80, centered at (100, 40)).
const at = ( x, y ) => ( { x, y, width: 200, height: 80 } );

describe( 'getNodeIntersection', () => {
	it( 'leaves the bottom border when the other node is straight below', () => {
		const point = getNodeIntersection( at( 0, 0 ), at( 0, 200 ) );
		expect( point ).toEqual( { x: 100, y: 80 } );
	} );

	it( 'leaves the top border when the other node is straight above', () => {
		const point = getNodeIntersection( at( 0, 200 ), at( 0, 0 ) );
		expect( point ).toEqual( { x: 100, y: 200 } );
	} );

	it( 'leaves the right border when the other node is straight across', () => {
		const point = getNodeIntersection( at( 0, 0 ), at( 600, 0 ) );
		expect( point ).toEqual( { x: 200, y: 40 } );
	} );

	it( 'returns the center for concentric nodes rather than dividing by zero', () => {
		const point = getNodeIntersection( at( 0, 0 ), at( 0, 0 ) );
		expect( point ).toEqual( { x: 100, y: 40 } );
	} );
} );

describe( 'getEdgeSide', () => {
	const rect = at( 100, 100 );

	it.each( [
		[ 'top', { x: 200, y: 100 }, Position.Top ],
		[ 'bottom', { x: 200, y: 180 }, Position.Bottom ],
		[ 'left', { x: 100, y: 130 }, Position.Left ],
		[ 'right', { x: 300, y: 130 }, Position.Right ],
	] )( 'reads a point on the %s border', ( _side, point, expected ) => {
		expect( getEdgeSide( rect, point ) ).toBe( expected );
	} );

	it( 'tolerates a sub-pixel miss', () => {
		expect( getEdgeSide( rect, { x: 200, y: 100.4 } ) ).toBe(
			Position.Top
		);
	} );
} );

describe( 'easeOffCorner', () => {
	const rect = at( 0, 0 );

	it( 'leaves a mid-face point exactly where it is', () => {
		expect(
			easeOffCorner( { x: 100, y: 80 }, Position.Bottom, rect )
		).toEqual( { x: 100, y: 80 } );
	} );

	it( 'pulls a cornered point toward the middle of its face', () => {
		const eased = easeOffCorner( { x: 200, y: 80 }, Position.Bottom, rect );
		expect( eased.x ).toBeLessThan( 200 - BORDER_INSET );
		expect( eased.x ).toBeGreaterThan( 100 );
		expect( eased.y ).toBe( 80 );
	} );

	it( 'moves a point further out harder than one nearer the middle', () => {
		const nearMiddle = easeOffCorner(
			{ x: 120, y: 80 },
			Position.Bottom,
			rect
		);
		const nearCorner = easeOffCorner(
			{ x: 190, y: 80 },
			Position.Bottom,
			rect
		);
		expect( 120 - nearMiddle.x ).toBeLessThan( 190 - nearCorner.x );
	} );
} );

describe( 'borderPointOn', () => {
	it( 'lands on the named border, facing the destination', () => {
		const point = borderPointOn( at( 0, 0 ), Position.Right, {
			x: 500,
			y: 40,
		} );
		expect( point.x ).toBe( 200 );
		expect( point.y ).toBe( 40 );
	} );

	it( 'clamps and eases a far destination back onto the face', () => {
		const point = borderPointOn( at( 0, 0 ), Position.Bottom, {
			x: 5000,
			y: 500,
		} );
		expect( point.y ).toBe( 80 );
		expect( point.x ).toBeLessThanOrEqual( 200 - BORDER_INSET );
	} );
} );

describe( 'getFloatingEdgeParams', () => {
	it( 'runs a forward edge from the source bottom into the target top', () => {
		const params = getFloatingEdgeParams( at( 0, 0 ), at( 0, 200 ) );
		expect( params ).toEqual( {
			sx: 100,
			sy: 80,
			tx: 100,
			ty: 200,
			sourcePos: Position.Bottom,
			targetPos: Position.Top,
		} );
	} );

	it( 'runs a back edge the other way', () => {
		const params = getFloatingEdgeParams( at( 0, 200 ), at( 0, 0 ) );
		expect( params ).toEqual( {
			sx: 100,
			sy: 200,
			tx: 100,
			ty: 80,
			sourcePos: Position.Top,
			targetPos: Position.Bottom,
		} );
	} );

	it( 'reads the borders off the geometry, taking no say in them', () => {
		// Aiming an end somewhere other than the far node is
		// `getSidedEdgeParams`'s `aim`, and it only makes sense once the borders
		// are already decided. A floating edge has nothing to aim with, so a
		// source out to the right of its target still leaves from the side
		// facing it, not from wherever a caller might have wanted.
		const params = getFloatingEdgeParams( at( 400, 0 ), at( 0, 0 ) );
		expect( params.sourcePos ).toBe( Position.Left );
	} );
} );

describe( 'getSidedEdgeParams', () => {
	it( 'uses the named borders and aims each end at the point given', () => {
		const params = getSidedEdgeParams(
			at( 0, 0 ),
			at( 0, 200 ),
			{ source: Position.Right, target: Position.Right },
			{ source: { x: 400, y: 0 }, target: { x: 400, y: 500 } }
		);
		expect( params.sourcePos ).toBe( Position.Right );
		expect( params.targetPos ).toBe( Position.Right );
		expect( params.sx ).toBe( 200 );
		expect( params.tx ).toBe( 200 );
		// Each end slid along its own border toward the point it heads for,
		// rather than toward the other node's center.
		expect( params.sy ).toBeLessThan( 40 );
		expect( params.ty ).toBeGreaterThan( 240 );
	} );
} );
