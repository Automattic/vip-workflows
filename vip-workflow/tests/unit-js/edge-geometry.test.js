/**
 * Unit tests for the edge pipeline's geometry primitives.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import {
	inflections,
	penetration,
	perimeterAt,
	perimeterOf,
	loopDelta,
	pointToSegment,
	polylinesCross,
} from '../../src/admin/components/graph/edge-geometry';

describe( 'inflections', () => {
	it( 'reports none for a straight run', () => {
		const samples = Array.from( { length: 20 }, ( _, i ) => ( {
			x: i * 10,
			y: 0,
		} ) );
		expect( inflections( samples ) ).toBe( 0 );
	} );

	it( 'reports none for a single arc', () => {
		// A quarter circle only ever curves one way.
		const samples = Array.from( { length: 20 }, ( _, i ) => {
			const t = ( i / 19 ) * ( Math.PI / 2 );
			return { x: Math.sin( t ) * 100, y: 100 - Math.cos( t ) * 100 };
		} );
		expect( inflections( samples ) ).toBe( 0 );
	} );

	it( 'reports one for an S', () => {
		// Two half-waves of a sine: curvature flips once at the middle.
		const samples = Array.from( { length: 40 }, ( _, i ) => ( {
			x: i * 10,
			y: Math.sin( ( i / 39 ) * Math.PI * 2 ) * 60,
		} ) );
		expect( inflections( samples ) ).toBe( 1 );
	} );
} );

describe( 'penetration', () => {
	const rect = { x: 0, y: 0, width: 100, height: 100 };

	it( 'counts samples inside the rectangle', () => {
		const samples = [
			{ x: 50, y: 50 },
			{ x: 20, y: 80 },
			{ x: 150, y: 50 },
		];
		expect( penetration( samples, [ rect ] ) ).toBe( 2 );
	} );

	it( 'lets the inset forgive a sample on the border', () => {
		expect( penetration( [ { x: 0.5, y: 50 } ], [ rect ], 1 ) ).toBe( 0 );
	} );

	it( 'grows the rectangle for a negative inset', () => {
		expect( penetration( [ { x: 105, y: 50 } ], [ rect ], -10 ) ).toBe( 1 );
	} );
} );

describe( 'perimeter parameterisation', () => {
	const rect = { x: 0, y: 0, width: 200, height: 80 };

	it( 'round-trips a point through the parameter and back', () => {
		const point = { x: 150, y: 80 };
		const u = perimeterOf( rect, point, Position.Bottom );
		const back = perimeterAt( rect, u );
		expect( back.x ).toBeCloseTo( point.x );
		expect( back.y ).toBeCloseTo( point.y );
		expect( back.side ).toBe( Position.Bottom );
	} );

	it( 'slides around a corner as one continuous move', () => {
		// Just before the top-right corner and just after it, on the next
		// border, are neighbouring parameter values.
		const before = perimeterOf( rect, { x: 199, y: 0 }, Position.Top );
		const after = perimeterOf( rect, { x: 200, y: 1 }, Position.Right );
		expect(
			Math.abs( loopDelta( before, after ) ) * ( 2 * ( 200 + 80 ) )
		).toBeLessThan( 3 );
	} );

	it( 'measures the short way around the loop', () => {
		expect( loopDelta( 0.95, 0.05 ) ).toBeCloseTo( 0.1 );
		expect( loopDelta( 0.05, 0.95 ) ).toBeCloseTo( -0.1 );
	} );
} );

describe( 'pointToSegment', () => {
	it( 'measures perpendicular distance inside the segment', () => {
		const { dist, t } = pointToSegment(
			{ x: 50, y: 30 },
			{ x: 0, y: 0 },
			{ x: 100, y: 0 }
		);
		expect( dist ).toBeCloseTo( 30 );
		expect( t ).toBeCloseTo( 0.5 );
	} );

	it( 'clamps to the nearer endpoint beyond the segment', () => {
		const { dist, t } = pointToSegment(
			{ x: 130, y: 40 },
			{ x: 0, y: 0 },
			{ x: 100, y: 0 }
		);
		expect( dist ).toBeCloseTo( 50 );
		expect( t ).toBe( 1 );
	} );
} );

describe( 'polylinesCross', () => {
	it( 'sees an X', () => {
		const a = [
			{ x: 0, y: 0 },
			{ x: 100, y: 100 },
		];
		const b = [
			{ x: 0, y: 100 },
			{ x: 100, y: 0 },
		];
		expect( polylinesCross( a, b ) ).toBe( true );
	} );

	it( 'sees two parallel runs as clear', () => {
		const a = [
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		];
		const b = [
			{ x: 0, y: 20 },
			{ x: 100, y: 20 },
		];
		expect( polylinesCross( a, b ) ).toBe( false );
	} );
} );
