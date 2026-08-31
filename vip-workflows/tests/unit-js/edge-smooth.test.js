/**
 * Unit tests for port-jump smoothing.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import {
	smoothLevers,
	smoothPorts,
} from '../../src/admin/components/graph/edge-smooth';
import { portStubs } from '../../src/admin/components/graph/edge-spline';

const rect = { id: 'a', x: 0, y: 0, width: 200, height: 80 };
const target = { id: 'b', x: 0, y: 300, width: 200, height: 80 };

/**
 * A planned edge out of `rect`'s given port into the top of `target`.
 *
 * @param {Object} source    Point on the source border.
 * @param {string} sourcePos Border it sits on.
 * @return {Object} The planned edge.
 */
function planned( source, sourcePos ) {
	const targetPoint = { x: 100, y: 300 };
	const stubs = portStubs( source, sourcePos, targetPoint, Position.Top );
	return {
		id: 'e1',
		own: [ rect, target ],
		obstacles: [],
		plan: {
			source: { ...source },
			sourceStub: stubs.source,
			waypoints: [],
			targetStub: stubs.target,
			target: targetPoint,
			sourcePos,
			targetPos: Position.Top,
		},
	};
}

describe( 'smoothPorts', () => {
	it( 'follows a small move exactly, with no easing', () => {
		const memory = {};
		smoothPorts(
			[ planned( { x: 100, y: 80 }, Position.Bottom ) ],
			memory,
			0
		);
		const p = planned( { x: 103, y: 80 }, Position.Bottom );
		const animating = smoothPorts( [ p ], memory, 16 );
		expect( animating ).toBe( false );
		expect( p.plan.source.x ).toBe( 103 );
	} );

	it( 'eases a jump instead of teleporting', () => {
		const memory = {};
		smoothPorts(
			[ planned( { x: 100, y: 80 }, Position.Bottom ) ],
			memory,
			0
		);

		// The port relocates to another border — a jump, not tracking.
		const jumped = planned( { x: 200, y: 40 }, Position.Right );
		const animating = smoothPorts( [ jumped ], memory, 16 );
		expect( animating ).toBe( true );
		// Drawn somewhere on the way, not yet at the new port.
		const drawn = jumped.plan.source;
		expect( Math.hypot( drawn.x - 200, drawn.y - 40 ) ).toBeGreaterThan(
			5
		);

		// Once the ease has run its course, the drawn port is the real one.
		const settled = planned( { x: 200, y: 40 }, Position.Right );
		const still = smoothPorts( [ settled ], memory, 500 );
		expect( still ).toBe( false );
		expect( settled.plan.source.x ).toBeCloseTo( 200 );
		expect( settled.plan.source.y ).toBeCloseTo( 40 );
		expect( settled.plan.sourcePos ).toBe( Position.Right );
	} );

	it( 'continues from the drawn position when a second jump lands mid-ease', () => {
		const at = ( mem, x, t ) => {
			const p = planned( { x, y: 80 }, Position.Bottom );
			smoothPorts( [ p ], mem, t );
			return p.plan.source.x;
		};

		// A control run: one jump, then plain easing, read at t=48.
		const control = {};
		at( control, 100, 0 );
		at( control, 160, 16 );
		const expected = at( control, 160, 48 );

		// The real run: a second jump lands at t=48, while the first is still
		// easing. The drawn port must carry on from where the ease had got to
		// — not snap back toward where the first jump started.
		const memory = {};
		at( memory, 100, 0 );
		at( memory, 160, 16 );
		const drawn = at( memory, 40, 48 );
		expect( Math.abs( drawn - expected ) ).toBeLessThan( 1 );
	} );

	it( 'keeps the drawn port on the node while easing around the corner', () => {
		const memory = {};
		smoothPorts(
			[ planned( { x: 100, y: 80 }, Position.Bottom ) ],
			memory,
			0
		);
		const jumped = planned( { x: 200, y: 40 }, Position.Right );
		smoothPorts( [ jumped ], memory, 100 );
		const drawn = jumped.plan.source;
		// On the boundary: at least one coordinate pinned to a border.
		const onX = drawn.x === 0 || drawn.x === 200;
		const onY = drawn.y === 0 || drawn.y === 80;
		expect( onX || onY ).toBe( true );
	} );
} );

describe( 'smoothLevers', () => {
	const restOf = ( p ) => ( {
		x: ( p.plan.sourceStub.x + p.plan.targetStub.x ) / 2,
		y: ( p.plan.sourceStub.y + p.plan.targetStub.y ) / 2,
	} );

	it( 'eases a lever jump instead of reshaping the curve in one frame', () => {
		const memory = {};
		smoothLevers(
			[ planned( { x: 100, y: 80 }, Position.Bottom ) ],
			memory,
			0
		);

		// A loom forms around the edge: its control point jumps sideways.
		const loomed = planned( { x: 100, y: 80 }, Position.Bottom );
		const rest = restOf( loomed );
		loomed.plan.waypoints = [ { x: rest.x + 30, y: rest.y } ];
		const animating = smoothLevers( [ loomed ], memory, 16 );
		expect( animating ).toBe( true );
		// Drawn on the way — still near where it rested, not in its lane.
		expect( loomed.plan.waypoints[ 0 ].x ).toBeLessThan( rest.x + 5 );

		// Settled: the drawn lever is the real one.
		const settled = planned( { x: 100, y: 80 }, Position.Bottom );
		settled.plan.waypoints = [ { x: rest.x + 30, y: rest.y } ];
		const still = smoothLevers( [ settled ], memory, 500 );
		expect( still ).toBe( false );
		expect( settled.plan.waypoints[ 0 ].x ).toBeCloseTo( rest.x + 30 );
	} );

	it( 'tracks a drag exactly — the lever rides the stubs', () => {
		const memory = {};
		const before = planned( { x: 100, y: 80 }, Position.Bottom );
		const restBefore = restOf( before );
		before.plan.waypoints = [ { x: restBefore.x + 20, y: restBefore.y } ];
		smoothLevers( [ before ], memory, 0 );

		// The stage moves a little; the lever keeps its place relative to
		// the stubs, so nothing is a jump and nothing eases.
		const after = planned( { x: 103, y: 80 }, Position.Bottom );
		const restAfter = restOf( after );
		after.plan.waypoints = [ { x: restAfter.x + 20, y: restAfter.y } ];
		const animating = smoothLevers( [ after ], memory, 16 );
		expect( animating ).toBe( false );
		expect( after.plan.waypoints[ 0 ].x ).toBe( restAfter.x + 20 );
	} );
} );
