/**
 * Unit tests for edge planning — port choice by cost.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import {
	planEdge,
	misalign,
	attempt,
	repulsion,
} from '../../src/admin/components/graph/edge-plan';
import { getFloatingEdgeParams } from '../../src/admin/components/graph/floating-edge';
import {
	REPEL_FORCE,
	REPEL_RANGE,
} from '../../src/admin/components/graph/edge-constants';

// A stage-sized rectangle (200×80), at the layout's own separations: 184 is
// one rank down (80 + RANK_SEP 104), 288 one sibling across (200 + NODE_SEP
// 88).
const stage = ( x, y ) => ( { x, y, width: 200, height: 80 } );

describe( 'planEdge', () => {
	it( 'runs a forward edge bottom-out, top-in', () => {
		const plan = planEdge( {
			source: stage( 0, 0 ),
			target: stage( 0, 184 ),
		} );
		expect( plan.sourcePos ).toBe( Position.Bottom );
		expect( plan.targetPos ).toBe( Position.Top );
		expect( plan.source ).toEqual( { x: 100, y: 80 } );
		expect( plan.target ).toEqual( { x: 100, y: 184 } );
		expect( plan.waypoints ).toHaveLength( 0 );
	} );

	it( 'joins two stages on one rank flank to flank', () => {
		const plan = planEdge( {
			source: stage( 0, 0 ),
			target: stage( 288, 0 ),
		} );
		expect( plan.sourcePos ).toBe( Position.Right );
		expect( plan.targetPos ).toBe( Position.Left );
	} );

	it( 'enters a stage on the next rank from above, not by the flank', () => {
		// A diagonal neighbour: down one rank, across one column. The centre
		// ray alone would happily arrive on the flank; the flow bias charges
		// that arrival, because an arrowhead into a flank reads as a sibling
		// rather than a successor.
		const plan = planEdge( {
			source: stage( 0, 0 ),
			target: stage( 288, 184 ),
		} );
		expect( plan.targetPos ).toBe( Position.Top );
	} );

	it( 'takes the named borders without searching when told', () => {
		const plan = planEdge( {
			source: stage( 0, 0 ),
			target: stage( 0, 184 ),
			sides: { source: Position.Right, target: Position.Right },
		} );
		expect( plan.sourcePos ).toBe( Position.Right );
		expect( plan.targetPos ).toBe( Position.Right );
	} );

	it( 'never leaves or arrives through its own card', () => {
		// A back edge one rank up: whatever pairing wins, the drawn curve
		// must not be buried in either of its own two stages.
		const source = stage( 0, 184 );
		const target = stage( 0, 0 );
		const plan = planEdge( { source, target } );
		const measured = attempt(
			{
				sx: plan.source.x,
				sy: plan.source.y,
				tx: plan.target.x,
				ty: plan.target.y,
				sourcePos: plan.sourcePos,
				targetPos: plan.targetPos,
			},
			[],
			[ source, target ]
		);
		expect( measured.ownHits ).toBe( 0 );
	} );
} );

describe( 'misalign', () => {
	it( 'is zero when both ports face along the path', () => {
		const params = getFloatingEdgeParams( stage( 0, 0 ), stage( 0, 184 ) );
		const plan = attempt( params, [], [ stage( 0, 0 ), stage( 0, 184 ) ] );
		expect( misalign( plan ) ).toBeCloseTo( 0 );
	} );

	it( 'charges a port pointing away from the travel', () => {
		// Leaving by the top to reach a stage below: the port normal points
		// exactly backwards.
		const plan = attempt(
			{
				sx: 100,
				sy: 0,
				tx: 100,
				ty: 184,
				sourcePos: Position.Top,
				targetPos: Position.Top,
			},
			[],
			[ stage( 0, 0 ), stage( 0, 184 ) ]
		);
		expect( misalign( plan ) ).toBeGreaterThan( 1 );
	} );
} );

describe( 'repulsion', () => {
	it( 'is null with nothing near', () => {
		expect(
			repulsion( { x: 0, y: 0 }, { x: 0, y: 400 }, [
				stage( 1000, 200 ),
			] )
		).toBeNull();
	} );

	it( 'pushes away from a centre near the chord', () => {
		// A stage centred 40px right of the chord's midpoint pushes left.
		const push = repulsion( { x: 0, y: 0 }, { x: 0, y: 400 }, [
			{ x: 40 - 100, y: 160, width: 200, height: 80 },
		] );
		expect( push ).not.toBeNull();
		expect( push.x ).toBeLessThan( 0 );
		expect( Math.abs( push.x ) ).toBeLessThanOrEqual( REPEL_FORCE );
	} );

	it( 'fades with distance', () => {
		const near = repulsion( { x: 0, y: 0 }, { x: 0, y: 400 }, [
			{ x: -70, y: 160, width: 200, height: 80 },
		] );
		const far = repulsion( { x: 0, y: 0 }, { x: 0, y: 400 }, [
			{ x: REPEL_RANGE - 110, y: 160, width: 200, height: 80 },
		] );
		expect( Math.abs( near.x ) ).toBeGreaterThan( Math.abs( far?.x ?? 0 ) );
	} );
} );
