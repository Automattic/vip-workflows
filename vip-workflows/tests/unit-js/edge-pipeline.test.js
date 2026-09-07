/**
 * Unit tests for the whole-canvas edge pipeline.
 *
 * @package
 */

import {
	buildEdgePlans,
	gripOrder,
} from '../../src/admin/components/graph/edge-pipeline';
import { AGENT_OUTCOMES } from '../../src/admin/components/graph/graph-model';
import {
	EDGE_PITCH,
	LEVER_ACROSS,
	LEVER_FLOOR,
	MARK_STANDOFF,
	TUNNEL_DOT,
} from '../../src/admin/components/graph/edge-constants';

// Stage-sized rectangles at the layout's own separations.
const stage = ( id, x, y ) => ( { id, x, y, width: 200, height: 80 } );

const rectsOf = ( ...stages ) => {
	const rects = {};
	stages.forEach( ( s ) => {
		rects[ s.id ] = s;
	} );
	return rects;
};

const edge = ( id, source, target, outcome = null ) => ( {
	id,
	source,
	target,
	data: { outcome },
} );

const build = ( edges, rects ) => buildEdgePlans( edges, rects, {}, 0 );

describe( 'buildEdgePlans', () => {
	it( 'draws a path for every edge whose nodes are measured', () => {
		const rects = rectsOf( stage( 'a', 0, 0 ), stage( 'b', 0, 184 ) );
		const { plans } = build( [ edge( 'e1', 'a', 'b' ) ], rects );
		expect( plans.e1 ).toBeDefined();
		expect( plans.e1.d ).toMatch( /^M / );
		expect( plans.e1.mid.total ).toBeGreaterThan( 0 );
	} );

	it( 'stops the drawn line short of the stage it arrives at', () => {
		// The arrowhead sits on the path's end, so the clearance it needs from
		// the card is a gap in the line — draw to the border and the stroke
		// shows through the open chevron as a spike past the tip.
		const rects = rectsOf( stage( 'a', 0, 0 ), stage( 'b', 0, 184 ) );
		const { plans } = build( [ edge( 'e1', 'a', 'b' ) ], rects );
		const numbers = plans.e1.d.match( /-?[\d.]+/g ).map( Number );
		const end = {
			x: numbers[ numbers.length - 2 ],
			y: numbers[ numbers.length - 1 ],
		};
		const { source, target } = plans.e1.plan;
		expect( Math.hypot( end.x - target.x, end.y - target.y ) ).toBeCloseTo(
			MARK_STANDOFF,
			1
		);
		// Only the far end moves — the near one carries the socket, which is
		// flush with its border.
		expect( numbers[ 0 ] ).toBeCloseTo( source.x, 1 );
		expect( numbers[ 1 ] ).toBeCloseTo( source.y, 1 );
	} );

	it( 'skips an edge whose node is missing rather than guessing', () => {
		const rects = rectsOf( stage( 'a', 0, 0 ) );
		const { plans } = build( [ edge( 'e1', 'a', 'ghost' ) ], rects );
		expect( plans.e1 ).toBeUndefined();
	} );

	it( 'gives a same-pair fan one border and spreads its ports along it', () => {
		// Two transitions between the same pair of stages (an agent routing
		// two outcomes to one destination): the follower takes the borders
		// the leader chose — planned independently they can disagree, and the
		// pair crosses. The pair then travels together, so it bundles, and a
		// bundle's members hold the lane pitch rather than the wider spacing
		// unrelated neighbours get — two lines a lane apart, not one drawn
		// twice.
		const rects = rectsOf( stage( 'a', 0, 0 ), stage( 'b', 0, 184 ) );
		const { plans } = build(
			[ edge( 'e1', 'a', 'b', 'pass' ), edge( 'e2', 'a', 'b', 'fail' ) ],
			rects
		);
		const p1 = plans.e1.plan;
		const p2 = plans.e2.plan;
		expect( p1.sourcePos ).toBe( p2.sourcePos );
		expect( p1.targetPos ).toBe( p2.targetPos );
		const gap = Math.hypot(
			p1.source.x - p2.source.x,
			p1.source.y - p2.source.y
		);
		expect( gap ).toBeGreaterThanOrEqual( EDGE_PITCH - 0.01 );
	} );

	it( 'keeps a gathered pair gathered — the guard must not roll back its own pitch', () => {
		// A clean canvas: nothing else near, so the only gap the guard can
		// read is the one the loom itself just closed to the pitch. That gap
		// is the point of the gathering, not damage to roll back.
		const rects = rectsOf( stage( 'a', 0, 0 ), stage( 'b', 0, 400 ) );
		const { plans } = build(
			[ edge( 'e1', 'a', 'b', 'pass' ), edge( 'e2', 'a', 'b', 'fail' ) ],
			rects
		);
		const p1 = plans.e1.plan;
		const p2 = plans.e2.plan;
		expect( Number.isInteger( p1.loomId ) ).toBe( true );
		expect( p2.loomId ).toBe( p1.loomId );
		// Closed to the lane pitch, not left at the wider spread spacing a
		// rollback would restore.
		const gap = Math.hypot(
			p1.source.x - p2.source.x,
			p1.source.y - p2.source.y
		);
		expect( gap ).toBeLessThanOrEqual( EDGE_PITCH + 0.5 );
	} );

	it( 'remembers loom mates between frames for membership hysteresis', () => {
		const rects = rectsOf( stage( 'a', 0, 0 ), stage( 'b', 0, 400 ) );
		const memory = {};
		buildEdgePlans(
			[ edge( 'e1', 'a', 'b', 'pass' ), edge( 'e2', 'a', 'b', 'fail' ) ],
			rects,
			memory,
			0
		);
		expect( memory.e1.mates ).toEqual( [ 'e2' ] );
		expect( memory.e2.mates ).toEqual( [ 'e1' ] );
	} );

	it( 'keeps a reciprocal pair apart', () => {
		const rects = rectsOf( stage( 'a', 0, 0 ), stage( 'b', 0, 184 ) );
		const { plans } = build(
			[ edge( 'fwd', 'a', 'b' ), edge( 'back', 'b', 'a' ) ],
			rects
		);
		expect( plans.fwd.d ).not.toBe( plans.back.d );
		// They share the gap between the stages, so the ports that meet each
		// border must differ.
		const down = plans.fwd.plan;
		const up = plans.back.plan;
		expect(
			Math.abs( down.source.x - up.target.x ) +
				Math.abs( down.target.x - up.source.x )
		).toBeGreaterThan( 1 );
	} );

	it( 'reports the order outcome edges leave a stage in', () => {
		// pass heads left, fail heads right: the pass port must sit left of
		// the fail port, and the report says so.
		const rects = rectsOf(
			stage( 'agent', 288, 0 ),
			stage( 'left', 0, 184 ),
			stage( 'right', 576, 184 )
		);
		const { portOrder } = build(
			[
				edge( 'p', 'agent', 'left', 'pass' ),
				edge( 'f', 'agent', 'right', 'fail' ),
			],
			rects
		);
		expect( portOrder.agent ).toEqual( [ 'pass', 'fail' ] );
	} );

	it( 'breaks the stroke where an edge passes under a stage', () => {
		// A straight run two ranks down with a stage dead on the line: there
		// is no router to bend around it, so the line passes under and the
		// dash pattern opens a gap.
		const rects = rectsOf(
			stage( 'top', 0, 0 ),
			stage( 'mid', 0, 236 ),
			stage( 'bottom', 0, 472 )
		);
		const { plans } = build( [ edge( 'e1', 'top', 'bottom' ) ], rects );
		const tunnel = plans.e1.tunnel;
		expect( tunnel ).not.toBeNull();
		// dash · gap · dash at least; the gap spans the card plus standoffs.
		const parts = tunnel.dash.split( ' ' ).map( Number );
		expect( parts.length ).toBeGreaterThanOrEqual( 3 );
		expect( Math.max( ...parts ) ).toBeGreaterThanOrEqual( 80 );
		// The mouths of the underpass are capped on both sides.
		expect( tunnel.caps.length ).toBeGreaterThanOrEqual( 2 );
	} );

	it( 'dots the ghost across exactly the span the stroke leaves open', () => {
		const rects = rectsOf(
			stage( 'top', 0, 0 ),
			stage( 'mid', 0, 236 ),
			stage( 'bottom', 0, 472 )
		);
		const { plans } = build( [ edge( 'e1', 'top', 'bottom' ) ], rects );
		const { dash, ghost } = plans.e1.tunnel;
		const ghostParts = ghost.split( ' ' ).map( Number );

		// Even, so the browser doesn't duplicate the list and swap dashes for
		// gaps on the second pass...
		expect( ghostParts.length % 2 ).toBe( 0 );
		// ...and tiling the curve exactly once, so it never wraps and dots the
		// clear run. Both patterns cover the same total length.
		const sum = ( parts ) => parts.reduce( ( a, b ) => a + b, 0 );
		expect( sum( ghostParts ) ).toBeCloseTo(
			sum( dash.split( ' ' ).map( Number ) ),
			1
		);

		// Dotted, not one long faint line: the drawn runs are the even slots,
		// and inside the underpass they are short and there are several.
		const drawn = ghostParts.filter( ( _v, i ) => i % 2 === 0 && _v > 0 );
		expect( drawn.length ).toBeGreaterThan( 3 );
		expect( Math.max( ...drawn ) ).toBeLessThanOrEqual( TUNNEL_DOT );
	} );

	it( 'keeps a short run straight even when a long edge bundles with it', () => {
		// The checkpoint stage straddles its band's top border, so the run from
		// it down to the first row is ~40px — the one place `INLINE_RANGE`
		// short-edge straightening applies. A long edge arriving at the same
		// border used to bundle with that short one and drag it out of line:
		// the loom repacked its ports and pushed it with the group, and the
		// 40px run drew as an S.
		const rects = rectsOf(
			stage( 'cp', 0, -40 ),
			stage( 'first', 0, 80 ),
			stage( 'far', 0, 400 )
		);
		const { plans } = build(
			[ edge( 'short', 'first', 'cp' ), edge( 'long', 'far', 'cp' ) ],
			rects
		);
		// Every x in the path — ports and control points alike — is the same.
		const xs = [ ...plans.short.d.matchAll( /(-?[\d.]+),-?[\d.]+/g ) ].map(
			( m ) => Number( m[ 1 ] )
		);
		expect( xs.length ).toBeGreaterThan( 2 );
		expect( Math.max( ...xs ) - Math.min( ...xs ) ).toBeLessThan( 0.01 );
	} );

	it( 'does not let a loom stretch a member past its own target', () => {
		// A crowded corner of the shipping sequence: four stages, seven edges,
		// and enough pairwise gathering that all of them chain into one loom.
		// The lane pass holds lanes along the *loom's* perpendicular, which here
		// lands near `review→s5`'s own axis — so its lever was pushed 226px down
		// its own direction, past the stage it was going to, and the 77px edge
		// looped out through Stage 5 and back to reach it.
		const rects = rectsOf(
			stage( 'review', 240, -122 ),
			stage( 'rtp', 0, 0 ),
			stage( 's5', 273, 29 ),
			stage( 'pub', 240, 221 )
		);
		const { plans } = build(
			[
				edge( 'review-rtp', 'review', 'rtp' ),
				edge( 'review-s5', 'review', 's5' ),
				edge( 'rtp-review', 'rtp', 'review' ),
				edge( 'rtp-s5', 'rtp', 's5' ),
				edge( 'rtp-pub', 'rtp', 'pub' ),
				edge( 's5-rtp', 's5', 'rtp' ),
				edge( 's5-pub', 's5', 'pub' ),
			],
			rects
		);

		const { plan, tunnel } = plans[ 'review-s5' ];
		// It runs from In Review's bottom straight down onto Stage 5's top, so
		// it passes under nothing at all — two spans meant it dived through the
		// card, came out below, and climbed back in.
		expect( tunnel ).toBeNull();
		// And its lever stays in the neighbourhood of the edge it steers.
		const span = Math.hypot(
			plan.targetStub.x - plan.sourceStub.x,
			plan.targetStub.y - plan.sourceStub.y
		);
		const home = {
			x: ( plan.sourceStub.x + plan.targetStub.x ) / 2,
			y: ( plan.sourceStub.y + plan.targetStub.y ) / 2,
		};
		const lever = plan.waypoints[ 0 ];
		expect(
			Math.hypot( lever.x - home.x, lever.y - home.y )
		).toBeLessThanOrEqual( LEVER_FLOOR + LEVER_ACROSS * span + 0.01 );
	} );

	it( 'leaves a clear edge unbroken', () => {
		const rects = rectsOf( stage( 'a', 0, 0 ), stage( 'b', 0, 184 ) );
		const { plans } = build( [ edge( 'e1', 'a', 'b' ) ], rects );
		expect( plans.e1.tunnel ).toBeNull();
	} );
} );

describe( 'gripOrder', () => {
	it( 'keeps the conventional order with nothing or one thing routed', () => {
		expect( gripOrder( null ) ).toEqual( AGENT_OUTCOMES );
		expect( gripOrder( [ 'fail' ] ) ).toEqual( AGENT_OUTCOMES );
	} );

	it( 'follows the ports, with unrouted outcomes keeping their place', () => {
		expect( gripOrder( [ 'fail', 'pass' ] ) ).toEqual( [
			'fail',
			'pass',
			'error',
		] );
	} );
} );
