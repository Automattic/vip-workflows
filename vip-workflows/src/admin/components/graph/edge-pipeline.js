/**
 * The edge pipeline — every edge on the canvas, planned together.
 *
 * Ports, spreads, bundles, and underpass breaks are all cross-edge decisions:
 * where one edge leaves a border depends on what else is on that border, a
 * bundle's lanes depend on every member, and a break mark's slot depends on
 * the other marks on the same face. So planning runs once over the whole
 * canvas (`EdgePlanProvider`) rather than once per edge component, in a fixed
 * order:
 *
 * 1. every edge picks its ports by cost (`planEdge`) — except fan followers,
 *    which take the borders the first transition of their pair chose (planned
 *    independently they can disagree, and the pair crosses), and except the
 *    Start edge, whose departure is not routed at all: it is pinned to the
 *    marker's one visible handle (`pinToStartHandle`);
 * 2. ports sharing a border are ordered and spaced (`spreadPorts`), and short
 *    near-column runs are straightened;
 * 3. co-travelling edges are gathered into lanes (`bundleEdges`), the stages'
 *    repulsion is re-computed per bundle (`repelGroups`), and the lanes are
 *    re-held through the push (`bundleEdges` again — the first pass decides
 *    which edges belong together, the second puts them back in their lanes).
 *    Which pairs bundled is remembered frame to frame (`memory`), so
 *    membership has hysteresis;
 * 4. port jumps are eased (`smoothPorts` — the only stateful pass, so the
 *    caller owns its memory and clock). Deliberately after every pass that
 *    can move a port: a relocation by the search, the clustering, or the
 *    loom's shuffle all ease the same way instead of the loom's snapping;
 * 5. underpass breaks are placed across all edges at once (`tunnelAll`), on
 *    the eased curves — the marks belong to the line as painted;
 * 6. each plan is drawn (`bsplinePath`) and handed back with its dash
 *    patterns, ready to render.
 *
 * The outcome badges on an agent stage follow the ports, not the other way
 * around: the grips are conventionally pass, fail, error left to right, and
 * when the pipeline puts fail's port left of pass's, the two edges would cross
 * under the stage purely to reach the badge they belong to. Their order on
 * the card is a convention; the association that matters is between an edge
 * and its own badge, so the pipeline reports which order the outcome edges
 * actually leave in (`portOrder`) and the badges reorder to match.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import { planEdge, refreshPlan } from './edge-plan';
import { spreadPorts } from './edge-spread';
import { smoothLevers, smoothPorts } from './edge-smooth';
import { bundleEdges, repelGroups } from './edge-bundle';
import { tunnelAll } from './edge-tunnel';
import { bsplinePath, trimPathEnd } from './edge-spline';
import { AGENT_OUTCOMES, START_ID } from './graph-model';
import { MARK_STANDOFF } from './edge-constants';

/**
 * Pin an edge's departure to the Start marker's own handle.
 *
 * Start is not a stage. It draws exactly one exit — a small circular handle
 * centred on its bottom border (`TerminalNode`) — and that dot is where the
 * flow leaves. The router knew nothing about it: it costed Start's four borders
 * like any other node's and put the port wherever the entry stage happened to
 * sit, so the one departure point on the canvas that is drawn wandered away
 * from the mark drawing it.
 *
 * So this edge is not routed at its source end. The border is the handle's
 * border and the point is the handle's point, and `pinnedSource` tells the
 * passes that divide a border between its ports to leave it alone
 * (`spreadPorts`). Nothing else needs telling: every other port move happens
 * within a face shared by two or more ports, and Start's bottom face carries
 * only this one.
 *
 * The socket mark is dropped for the same reason, by the same rule every other
 * mark landing on a handle follows (`EdgeOverlay`) — the handle already says
 * where the edge attaches, and a second mark domed over it says it twice.
 *
 * End is deliberately not the mirror of this: it has no source handle of its
 * own, and the arrowhead arriving at it is the only thing that says the flow
 * finishes there.
 *
 * @param {Object} planned The planned edge (`plan`, `obstacles`, `own`).
 * @param {Object} rect    The Start marker's rectangle.
 */
function pinToStartHandle( planned, rect ) {
	const plan = planned.plan;
	plan.sourcePos = Position.Bottom;
	plan.source = { x: rect.x + rect.width / 2, y: rect.y + rect.height };
	plan.pinnedSource = true;
	refreshPlan( planned );
}

/**
 * Plan and draw every edge.
 *
 * @param {Array}  edges  React Flow edge objects (`id`, `source`, `target`,
 *                        `data.outcome`).
 * @param {Object} rects  Measured node rectangles by id.
 * @param {Object} memory Persistent per-edge state, owned by the caller:
 *                        port easing, and last frame's loom mates.
 * @param {number} now    Current time in ms.
 * @return {{ plans: Object, portOrder: Object, animating: boolean }}
 *         Drawn plans by edge id, outcome port order by stage id, and whether
 *         the caller should schedule another frame.
 */
export function buildEdgePlans( edges, rects, memory, now ) {
	const all = Object.values( rects );

	// Fan coherence: every transition between the same pair of nodes takes
	// the borders the first of them chose. Only the search is shared — each
	// edge still gets its own ports on those borders.
	const leaders = {};
	const plans = [];
	edges.forEach( ( edge ) => {
		const source = rects[ edge.source ];
		const target = rects[ edge.target ];
		if ( ! source || ! target ) {
			return;
		}
		const obstacles = all.filter(
			( rect ) => rect.id !== edge.source && rect.id !== edge.target
		);
		const key = `${ edge.source }→${ edge.target }`;
		const lead = leaders[ key ];
		const plan = planEdge( {
			source,
			target,
			obstacles,
			sides: lead
				? { source: lead.sourcePos, target: lead.targetPos }
				: null,
		} );
		if ( ! lead ) {
			leaders[ key ] = plan;
		}
		const planned = {
			id: edge.id,
			sourceId: edge.source,
			targetId: edge.target,
			outcome: edge.data?.outcome || null,
			plan,
			obstacles,
			own: [ source, target ],
		};
		if ( edge.source === START_ID ) {
			pinToStartHandle( planned, source );
		}
		plans.push( planned );
	} );

	spreadPorts( plans, rects );

	// Pairs bundled last frame, for membership hysteresis: a pair sitting at
	// the gather threshold must not flick in and out of its loom — and move
	// its ports and levers — on alternate frames of a drag.
	const sticky = new Set();
	edges.forEach( ( e ) => {
		const mates = memory[ e.id ]?.mates;
		( mates || [] ).forEach( ( m ) => {
			sticky.add( e.id < m ? `${ e.id }|${ m }` : `${ m }|${ e.id }` );
		} );
	} );

	bundleEdges( plans, sticky );
	repelGroups( plans );
	// The second call re-holds the lanes through the push; membership was
	// decided by the first and is reused, not re-derived.
	bundleEdges( plans, sticky, true );

	// Remember who bundled with whom, for next frame's hysteresis.
	const byLoom = {};
	plans.forEach( ( p ) => {
		const loom = p.plan.loomId;
		if ( loom !== null && loom !== undefined ) {
			( byLoom[ loom ] = byLoom[ loom ] || [] ).push( p.id );
		}
	} );
	plans.forEach( ( p ) => {
		const mem = memory[ p.id ] || ( memory[ p.id ] = {} );
		const group = byLoom[ p.plan.loomId ];
		mem.mates = group ? group.filter( ( id ) => id !== p.id ) : [];
	} );

	// Which outcome now leaves from which side, so the badges can follow the
	// ports rather than the ports being expected to follow the badges. Read
	// before the easing below: the badges follow where a port settles, not
	// where it happens to be drawn mid-flight.
	const grips = {};
	plans.forEach( ( p ) => {
		if ( ! p.outcome ) {
			return;
		}
		const plan = p.plan;
		const horiz =
			plan.sourcePos === Position.Top ||
			plan.sourcePos === Position.Bottom;
		( grips[ p.sourceId ] = grips[ p.sourceId ] || [] ).push( {
			outcome: p.outcome,
			at: horiz ? plan.source.x : plan.source.y,
		} );
	} );
	const portOrder = {};
	Object.keys( grips ).forEach( ( id ) => {
		portOrder[ id ] = grips[ id ]
			.sort( ( a, b ) => a.at - b.at )
			.map( ( g ) => g.outcome );
	} );

	// Eased last, after every pass that can move a port, so a relocation by
	// the search, the clustering, or the loom's shuffle all slide instead of
	// snapping. Levers ease after ports: the port pass rebuilds waypoints,
	// and would overwrite an eased lever.
	const portsAnimating = smoothPorts( plans, memory, now );
	const leversAnimating = smoothLevers( plans, memory, now );
	const animating = portsAnimating || leversAnimating;

	// Placed across every edge at once: a mark's slot depends on the other
	// marks on the same border.
	const tunnels = tunnelAll( plans );

	// Drawn last, and stopped short of the stage it arrives at so the arrowhead
	// has the clearance the spec gives it — see `trimPathEnd`. Everything above
	// works from the plan's ports, which the trim does not touch.
	const out = {};
	plans.forEach( ( p ) => {
		const { d, mid, handles } = bsplinePath( p.plan );
		out[ p.id ] = {
			d: trimPathEnd( handles, MARK_STANDOFF ) || d,
			mid,
			plan: p.plan,
			tunnel: tunnels[ p.id ] || null,
		};
	} );

	return { plans: out, portOrder, animating };
}

/**
 * The order an agent stage's outcome badges sit in, taken from where their
 * edges actually leave. Any outcome without an edge keeps its conventional
 * place, so an agent with one transition still reads pass, fail, error.
 *
 * @param {?Array} routed Outcome keys in port order, from `buildEdgePlans`.
 * @return {Array} All outcome keys, in display order.
 */
export function gripOrder( routed ) {
	if ( ! routed || routed.length < 2 ) {
		return AGENT_OUTCOMES;
	}
	const rest = AGENT_OUTCOMES.filter(
		( outcome ) => routed.indexOf( outcome ) < 0
	);
	return routed.concat( rest );
}
