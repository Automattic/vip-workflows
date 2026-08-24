/**
 * Choosing where an edge leaves and arrives, and what its curve does between.
 *
 * The port is part of the problem, not an input to it: the natural port pair —
 * where the centre ray meets each border — is tried first, and then every
 * combination of borders is routed for real and scored on what it costs to
 * draw. The search runs on every edge, not only obstructed ones: obstacles are
 * one reason a port pairing can be wrong, pointing the wrong way is another.
 *
 * The cost is measured on the curve that will actually be painted, not on a
 * polyline nobody draws. Length alone is the wrong measure — an edge between
 * two stages sitting side by side would leave the bottom of one and enter the
 * top of the other, barely longer than any alternative, while the drawn line
 * has to leave, turn ninety degrees, thread the gap, and turn back. So each
 * end is scored on how well its outward normal agrees with the direction the
 * path sets off in (`misalign`), every curvature reversal is charged
 * (`inflections` — an S between two stages is nearly always a port that should
 * have been on the other border), a cross-axis arrival between ranks is
 * charged (`FLOW_BIAS` — an arrowhead into a flank reads as a sibling rather
 * than a successor), and samples buried in the edge's own two cards are
 * charged as the certainty they are.
 *
 * There is deliberately no obstacle router. A third stage in the way is
 * handled by centre repulsion — node centres push a passing curve aside,
 * harder the nearer it comes, with no rectangle test and no clearance — and by
 * the underpass breaks (`edge-tunnel.js`) where the line does pass behind a
 * card. A line under a card is legible when the stroke says so; a line
 * swinging wide around three stacked stages is not.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import { getFloatingEdgeParams, getSidedEdgeParams } from './floating-edge';
import { portStubs, bsplinePath } from './edge-spline';
import {
	centerOf,
	clamp,
	distance,
	heading,
	inflections,
	outward,
	penetration,
} from './edge-geometry';
import {
	ALIGN_WEIGHT,
	FLOW_BIAS,
	INFLECT_WEIGHT,
	REPEL_FORCE,
	REPEL_RANGE,
	SEARCH_KEEP,
	SEARCH_TOLERANCE,
	SELF_HIT_WEIGHT,
} from './edge-constants';

/** Borders to try, in the order ties are resolved. */
const SIDES = [ Position.Top, Position.Right, Position.Bottom, Position.Left ];

/**
 * @typedef {Object} Plan
 * @property {{ x: number, y: number }} source     Point on the source border.
 * @property {{ x: number, y: number }} sourceStub Far end of its port stub.
 * @property {Array}                    waypoints  Zero or one control points.
 * @property {{ x: number, y: number }} targetStub Far end of the other stub.
 * @property {{ x: number, y: number }} target     Point on the target border.
 * @property {Position}                 sourcePos  Border it leaves.
 * @property {Position}                 targetPos  Border it arrives at.
 */

/**
 * How far a node's centre pushes an edge passing near it.
 *
 * The mirror of the pull that draws ports toward the middle of a face: there a
 * centre attracts, here it repels. It isn't trying to clear anything — no
 * rectangle, no clearance, no test for whether the line is blocked. An edge
 * that passes a stage widely is left alone; one that comes near its centre is
 * deformed, and more the nearer it comes. That is enough to keep edges out of
 * the middle of cards without any of them looking like they were routed.
 *
 * Taken from the closest approach of the chord to each centre, pushed along
 * that line away from it, and tapered toward the endpoints where the curve is
 * held by its ports and has no freedom to move. Contributions from several
 * nodes add, so an edge threading a row of stages settles where they balance.
 *
 * @param {Object} a     Chord start (source stub end).
 * @param {Object} b     Chord end (target stub end).
 * @param {Array}  rects Node rectangles that push, the edge's own excluded.
 * @return {{ x: number, y: number }|null} Total push, or null for none.
 */
export function repulsion( a, b, rects ) {
	if ( ! rects || ! rects.length ) {
		return null;
	}
	const dir = heading( a, b );
	if ( ! dir ) {
		return null;
	}

	let x = 0;
	let y = 0;
	rects.forEach( ( r ) => {
		const c = centerOf( r );
		const along = clamp(
			( ( c.x - a.x ) * dir.x + ( c.y - a.y ) * dir.y ) / dir.length,
			0,
			1
		);
		const near = {
			x: a.x + ( b.x - a.x ) * along,
			y: a.y + ( b.y - a.y ) * along,
		};
		const away = { x: near.x - c.x, y: near.y - c.y };

		// The field is elliptical, matched to the card's own footprint, so
		// its reach past the border is REPEL_RANGE on every side. A plain
		// radius from the centre of a wide, short card reached much further
		// vertically than horizontally — a stage a whole rank away in y was
		// still shoving edges it stood nowhere near.
		const sx = r.width / 2 + REPEL_RANGE;
		const sy = r.height / 2 + REPEL_RANGE;
		const ax = away.x / sx;
		const ay = away.y / sy;
		const u = Math.sqrt( ax * ax + ay * ay );
		if ( u >= 1 ) {
			return;
		}

		// Squared falloff: barely anything at the edge of its range, firm near
		// the centre, rather than shoving everything equally.
		const closeness = 1 - u;
		const w = closeness * closeness * ( 4 * along * ( 1 - along ) );
		const d = Math.sqrt( away.x * away.x + away.y * away.y );

		// Dead on the centre there is no direction to flee, so take the
		// perpendicular and let the edge slide off rather than stall.
		const unit =
			d > 0.01
				? { x: away.x / d, y: away.y / d }
				: { x: -dir.y, y: dir.x };
		x += unit.x * REPEL_FORCE * w;
		y += unit.y * REPEL_FORCE * w;
	} );

	return x || y ? { x, y } : null;
}

/**
 * The control point for a plan, from every force that has a say.
 *
 * Several passes move a plan's ports and have to rebuild its control point
 * afterwards; this is the one place it is made, so no force is quietly thrown
 * away by a rebuild. Two forces contribute:
 *
 * - centre repulsion, computed for this edge — or, when the edge belongs to a
 *   bundle, the single force computed for the bundle as a whole
 *   (`repelGroups` leaves it on the plan as `loomPush`), so all its threads
 *   move together and keep their lanes;
 * - the loom's lane correction (`leverShift`), accumulated by `bundleEdges`
 *   as it holds a bundle's members to their lanes. It has to live here: a
 *   port move rebuilds the control point, and a rebuild that forgot the
 *   loom's corrections would quietly undo the gathering.
 *
 * There is deliberately no per-sibling fan offset. There used to be — each
 * sibling's control point was spread sideways the way its port was — but
 * spacing the middles of co-travelling edges is exactly the loom's job, and
 * the pre-spread fought it: the lanes had to haul each bulged curve back to
 * the pitch, the big lever swings collided with bystanders, and the guard
 * rolled the whole loom back — leaving the bulge. Without it, siblings start
 * near their port spacing and the lanes only fine-tune.
 *
 * @param {Plan}  plan      The plan (loom fields read if present).
 * @param {Array} obstacles Node rectangles that repel, the edge's own excluded.
 * @return {Array} Zero or one control points.
 */
export function controlFor( plan, obstacles ) {
	// The loom's accumulated lane correction, re-applied on every rebuild. An
	// edge with no control point of its own gets one to carry it.
	const loom = ( pts ) => {
		const shift = plan.leverShift;
		if ( ! shift || ( ! shift.x && ! shift.y ) ) {
			return pts;
		}
		if ( ! pts.length ) {
			pts = [
				{
					x: ( plan.sourceStub.x + plan.targetStub.x ) / 2,
					y: ( plan.sourceStub.y + plan.targetStub.y ) / 2,
				},
			];
		}
		pts[ 0 ].x += shift.x;
		pts[ 0 ].y += shift.y;
		return pts;
	};

	const push =
		plan.loomPush ||
		repulsion( plan.sourceStub, plan.targetStub, obstacles );
	if ( push ) {
		return loom( [
			{
				x: ( plan.sourceStub.x + plan.targetStub.x ) / 2 + push.x,
				y: ( plan.sourceStub.y + plan.targetStub.y ) / 2 + push.y,
			},
		] );
	}
	return loom( [] );
}

/**
 * Rebuild everything downstream of a plan's ports: stubs, control point, and
 * nothing else. Every pass that moves a port calls this before anything is
 * measured again.
 *
 * @param {Object} planned The planned edge (`plan`, `obstacles` fields).
 */
export function refreshPlan( planned ) {
	const plan = planned.plan;
	const stubs = portStubs(
		plan.source,
		plan.sourcePos,
		plan.target,
		plan.targetPos
	);
	plan.sourceStub = stubs.source;
	plan.targetStub = stubs.target;
	plan.waypoints = controlFor( plan, planned.obstacles );
}

/**
 * How far each port faces away from the direction the drawn curve actually
 * sets off in (and arrives from), summed over both ends. Zero when both agree
 * perfectly; up to four when both point exactly backwards.
 *
 * @param {Plan} plan The plan.
 * @return {number} Misalignment.
 */
export function misalign( plan ) {
	const so = outward( plan.sourcePos );
	const ti = outward( plan.targetPos );
	const h1 = heading(
		plan.sourceStub,
		plan.waypoints[ 0 ] || plan.targetStub
	);
	const h2 = heading(
		plan.waypoints[ plan.waypoints.length - 1 ] || plan.sourceStub,
		plan.targetStub
	);
	const a1 = h1 ? so.x * h1.x + so.y * h1.y : 1;
	const a2 = h2 ? -ti.x * h2.x - ti.y * h2.y : 1;
	return 1 - a1 + ( 1 - a2 );
}

/**
 * What a candidate route costs to draw. Lower is better; see the module
 * comment for what each term is protecting.
 *
 * @param {Plan & { length: number, samples: number, turns: number, ownHits: number }} plan
 *                                                                                            The measured plan.
 * @param {Object}                                                                     source Source node rectangle.
 * @param {Object}                                                                     target Target node rectangle.
 * @return {number} The cost.
 */
export function routeCost( plan, source, target ) {
	const cross = [ Position.Left, Position.Right ];
	const sc = centerOf( source );
	const tc = centerOf( target );
	const ranked =
		Math.abs( tc.y - sc.y ) > ( source.height + target.height ) / 2;
	const sourceCross = cross.indexOf( plan.sourcePos ) >= 0;
	const targetCross = cross.indexOf( plan.targetPos ) >= 0;

	// Leaving by a flank and arriving by a flank are not the same choice.
	// Arriving is the end that carries the meaning, so a cross-axis arrival is
	// charged on its own, and the pair that uses one at both ends costs most.
	// Only between ranks: two stages side by side on one rank have nothing but
	// their flanks to face each other with, and are left alone.
	let flow = 1;
	if ( ranked && sourceCross && targetCross ) {
		flow = 1 + FLOW_BIAS;
	} else if ( ranked && targetCross ) {
		flow = 1 + FLOW_BIAS * 0.5;
	}

	const samples = Math.max( 1, plan.samples || 1 );
	const self = SELF_HIT_WEIGHT * ( ( plan.ownHits || 0 ) / samples );
	return (
		plan.length *
		( 1 +
			ALIGN_WEIGHT * misalign( plan ) +
			INFLECT_WEIGHT * ( plan.turns || 0 ) +
			self ) *
		flow
	);
}

/**
 * Route one pair of endpoints and measure what it comes to — on the curve
 * that will be painted, not the guide polyline.
 *
 * @param {Object} params    From `getFloatingEdgeParams` / `getSidedEdgeParams`.
 * @param {Array}  obstacles Node rectangles, the edge's own two excluded.
 * @param {Array}  own       The edge's own two rectangles.
 * @return {Plan & { length: number, samples: number, turns: number, hits: number, ownHits: number }}
 *         The measured plan.
 */
export function attempt( params, obstacles, own ) {
	const source = { x: params.sx, y: params.sy };
	const target = { x: params.tx, y: params.ty };
	const stubs = portStubs(
		source,
		params.sourcePos,
		target,
		params.targetPos
	);
	const plan = {
		source,
		sourceStub: stubs.source,
		waypoints: [],
		targetStub: stubs.target,
		target,
		sourcePos: params.sourcePos,
		targetPos: params.targetPos,
	};
	plan.waypoints = controlFor( plan, obstacles );

	const points = [
		plan.source,
		plan.sourceStub,
		...plan.waypoints,
		plan.targetStub,
		plan.target,
	];
	let total = 0;
	for ( let i = 0; i < points.length - 1; i++ ) {
		total += distance( points[ i ], points[ i + 1 ] );
	}

	const drawn = bsplinePath( plan );

	return {
		...plan,
		length: total,
		samples: drawn.samples.length,
		turns: inflections( drawn.samples ),
		hits: penetration( drawn.samples, obstacles ),
		// Its own two stages, counted separately: an edge may legitimately
		// pass near a third stage, but it never has to pass under the one it
		// starts from or ends at — moving the port is always available.
		ownHits: penetration( drawn.samples, own || [], 5 ),
	};
}

/**
 * Where an edge should leave, arrive, and bend in between.
 *
 * With `sides` given the search is skipped and the named borders are used —
 * that is how every transition in a fan takes the borders the first of them
 * chose. Planned independently they can disagree, and the pair crosses.
 *
 * @param {Object} edge             The edge to plan.
 * @param {Object} edge.source      Source node rectangle.
 * @param {Object} edge.target      Target node rectangle.
 * @param {Array}  [edge.obstacles] Node rectangles in the way, the edge's own
 *                                  two excluded.
 * @param {Object} [edge.sides]     Borders to use, skipping the search.
 * @return {Plan} The plan, ready for the cross-edge passes.
 */
export function planEdge( { source, target, obstacles = [], sides = null } ) {
	const own = [ source, target ];

	if ( sides ) {
		return attempt(
			getSidedEdgeParams( source, target, sides ),
			obstacles,
			own
		);
	}

	const natural = attempt(
		getFloatingEdgeParams( source, target ),
		obstacles,
		own
	);

	let best = natural;
	// A small handicap on the alternatives, so the port the geometry chose
	// keeps near-ties and an edge doesn't flicker between borders while its
	// stage is dragged past the point where two pairings cost the same.
	let bestCost = routeCost( natural, source, target ) * SEARCH_KEEP;
	// How much longer an alternative may be depends on how bad the natural
	// route is: a well-aimed port is worth keeping and the tolerance stays
	// tight; one whose normal points away from where the edge travels is worth
	// escaping at real cost.
	const limit =
		natural.length * ( SEARCH_TOLERANCE + misalign( natural ) * 0.6 );

	SIDES.forEach( ( sourceSide ) => {
		SIDES.forEach( ( targetSide ) => {
			const candidate = attempt(
				getSidedEdgeParams( source, target, {
					source: sourceSide,
					target: targetSide,
				} ),
				obstacles,
				own
			);
			// Too long is disqualifying only when it also clears nothing the
			// incumbent doesn't: a longer route that passes under fewer
			// stages is still worth costing.
			if ( candidate.length > limit && candidate.hits >= best.hits ) {
				return;
			}
			const cost = routeCost( candidate, source, target );
			if ( cost < bestCost ) {
				best = candidate;
				bestCost = cost;
			}
		} );
	} );

	// Whatever port won, aim it at the bulge the curve actually heads for
	// rather than at the far node, so the drawn line and the line that was
	// measured are the same.
	if ( best.waypoints.length > 0 ) {
		const aimed = attempt(
			getSidedEdgeParams(
				source,
				target,
				{ source: best.sourcePos, target: best.targetPos },
				{
					source: best.waypoints[ 0 ],
					target: best.waypoints[ best.waypoints.length - 1 ],
				}
			),
			obstacles,
			own
		);
		if (
			aimed.hits <= best.hits &&
			aimed.waypoints.length <= best.waypoints.length
		) {
			best = aimed;
		}
	}

	return best;
}
