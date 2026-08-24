/**
 * Unit tests for the B-spline edge drawing.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import {
	portStubs,
	bsplinePath,
} from '../../src/admin/components/graph/edge-spline';
import {
	PORT_STUB,
	STUB_MIN,
	STUB_MAX,
} from '../../src/admin/components/graph/edge-constants';

describe( 'portStubs', () => {
	it( 'gives a short edge the short end of the ramp', () => {
		const { source } = portStubs(
			{ x: 0, y: 0 },
			Position.Bottom,
			{ x: 0, y: 10 },
			Position.Top
		);
		expect( source.y ).toBeCloseTo( PORT_STUB * STUB_MIN );
	} );

	it( 'saturates on a long edge', () => {
		const { source } = portStubs(
			{ x: 0, y: 0 },
			Position.Bottom,
			{ x: 0, y: 2000 },
			Position.Top
		);
		expect( source.y ).toBeCloseTo( PORT_STUB * STUB_MAX );
	} );

	it( 'reaches straight out of the named border', () => {
		const { source, target } = portStubs(
			{ x: 100, y: 50 },
			Position.Right,
			{ x: 400, y: 50 },
			Position.Left
		);
		expect( source.y ).toBe( 50 );
		expect( source.x ).toBeGreaterThan( 100 );
		expect( target.y ).toBe( 50 );
		expect( target.x ).toBeLessThan( 400 );
	} );
} );

/**
 * A plan with its stubs already struck, for drawing directly.
 *
 * @param {Object} source    Point on the source border.
 * @param {string} sourcePos Border it sits on.
 * @param {Object} target    Point on the target border.
 * @param {string} targetPos Border it sits on.
 * @param {Array}  waypoints Control points.
 * @return {Object} The plan.
 */
function plan( source, sourcePos, target, targetPos, waypoints = [] ) {
	const stubs = portStubs( source, sourcePos, target, targetPos );
	return {
		source,
		sourceStub: stubs.source,
		waypoints,
		targetStub: stubs.target,
		target,
		sourcePos,
		targetPos,
	};
}

describe( 'bsplinePath', () => {
	it( 'starts and ends exactly on the ports', () => {
		const p = plan(
			{ x: 100, y: 80 },
			Position.Bottom,
			{ x: 140, y: 300 },
			Position.Top
		);
		const { samples } = bsplinePath( p );
		expect( samples[ 0 ].x ).toBeCloseTo( 100 );
		expect( samples[ 0 ].y ).toBeCloseTo( 80 );
		expect( samples[ samples.length - 1 ].x ).toBeCloseTo( 140 );
		expect( samples[ samples.length - 1 ].y ).toBeCloseTo( 300 );
	} );

	it( 'leaves the border square', () => {
		const p = plan(
			{ x: 100, y: 80 },
			Position.Bottom,
			{ x: 300, y: 300 },
			Position.Top
		);
		const { samples } = bsplinePath( p );
		// The first step off the port travels along the port normal (down),
		// not sideways: x barely moves while y grows.
		const dx = Math.abs( samples[ 1 ].x - samples[ 0 ].x );
		const dy = samples[ 1 ].y - samples[ 0 ].y;
		expect( dy ).toBeGreaterThan( 0 );
		expect( dx ).toBeLessThan( dy );
	} );

	it( 'bends toward a control point without passing through it', () => {
		const control = { x: 300, y: 190 };
		const p = plan(
			{ x: 100, y: 80 },
			Position.Bottom,
			{ x: 100, y: 300 },
			Position.Top,
			[ control ]
		);
		const { samples } = bsplinePath( p );
		// The curve deflects that way…
		const maxX = Math.max( ...samples.map( ( s ) => s.x ) );
		expect( maxX ).toBeGreaterThan( 120 );
		// …but a B-spline approximates: it stays short of the point itself.
		expect( maxX ).toBeLessThan( control.x );
	} );

	it( 'draws a straight line when the guide is two points', () => {
		const { d, samples } = bsplinePath( {
			source: { x: 0, y: 0 },
			sourceStub: { x: 0, y: 0 },
			waypoints: [],
			targetStub: { x: 100, y: 0 },
			target: { x: 100, y: 0 },
		} );
		expect( d ).toBe( 'M 0,0 L 100,0' );
		expect( samples ).toHaveLength( 2 );
	} );

	it( 'reports the arc-length midpoint and total', () => {
		const p = plan(
			{ x: 100, y: 80 },
			Position.Bottom,
			{ x: 100, y: 300 },
			Position.Top
		);
		const { mid } = bsplinePath( p );
		expect( mid.total ).toBeGreaterThanOrEqual( 220 );
		expect( mid.y ).toBeCloseTo( 190, 0 );
	} );
} );
