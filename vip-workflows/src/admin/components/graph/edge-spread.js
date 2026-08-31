/**
 * Spreading the edges that share a border along it.
 *
 * A port is chosen per edge, from that edge's own geometry, which means every
 * edge leaving a stage for somewhere below it lands on the same point of the
 * same border. Five transitions out of one stage then leave from one spot and
 * braid together for the first hundred pixels, and which line goes where is
 * unreadable exactly where it matters most — at the stage the reader is
 * looking at.
 *
 * So each border is divided once, between everything on it that this pass
 * owns — a port pinned to a handle drawn on that border sits out, since its
 * position is already spoken for. Ports are ordered
 * by where their edges are actually *going* — the far stage's centre, which
 * owes nothing to any port already placed — before they are spaced, so the fan
 * opens in the order it travels and the lines run parallel instead of swapping
 * over. A tie on aim (a fan whose destinations sit on one centre line) is
 * broken by depth, signed by the side the edge departs toward: when two edges
 * set off the same way, the one going further must stay outboard of the other
 * for the whole run, or the two have to swap over somewhere.
 *
 * Separation is per cluster, not across the whole border: ports are grouped by
 * actual proximity, anything more than a pitch from its neighbours is a
 * cluster of one and never moves, and only inside a cluster does anything
 * shift — opened out around the cluster's own mean at exactly `PORT_SPREAD`.
 * `CLUSTER_RANGE` widens the catchment without widening the spacing, so close
 * ports open out, loose ones pull in, and a fan out of a stage reads as one
 * set of exits rather than a few unrelated ones.
 *
 * Finally, short edges are brought into line: two stages nearly but not quite
 * in column leave the edge a few pixels of lateral offset to cover, and over a
 * short run that offset is the whole shape — an S wagging across the gap. When
 * two ports that slide along the same axis are close together, both are moved
 * to the average and the run comes out straight. The `straight` flag records
 * the decision so no later pass undoes it.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import { centerOf, clamp, distance, outward } from './edge-geometry';
import { refreshPlan } from './edge-plan';
import {
	BORDER_INSET,
	CLUSTER_RANGE,
	INLINE_RANGE,
	PORT_SPREAD,
} from './edge-constants';

/**
 * Spread, cluster, and inline the ports of every planned edge.
 *
 * Mutates the plans in place; every moved port gets its stubs and control
 * point rebuilt before returning.
 *
 * @param {Array}  plans Planned edges (`plan`, `own`, `obstacles`,
 *                       `sourceId`, `targetId`).
 * @param {Object} rects Node rectangles by id.
 */
export function spreadPorts( plans, rects ) {
	const groups = {};
	plans.forEach( ( p ) => {
		[ 'source', 'target' ].forEach( ( role ) => {
			// A pinned port is not part of its border's division: it sits on a
			// handle that is drawn there (`pinToStartHandle`), so it has a
			// position for a reason this pass cannot see and must not average
			// away.
			if ( role === 'source' && p.plan.pinnedSource ) {
				return;
			}
			const nodeId = role === 'source' ? p.sourceId : p.targetId;
			const side =
				role === 'source' ? p.plan.sourcePos : p.plan.targetPos;
			const key = `${ nodeId }|${ side }`;
			groups[ key ] = groups[ key ] || { nodeId, side, items: [] };
			groups[ key ].items.push( { p, role } );
		} );
	} );

	Object.values( groups ).forEach( ( g ) => {
		if ( g.items.length < 2 ) {
			return;
		}
		const rect = rects[ g.nodeId ];
		if ( ! rect ) {
			return;
		}
		const horiz = g.side === Position.Top || g.side === Position.Bottom;
		const lo = ( horiz ? rect.x : rect.y ) + BORDER_INSET;
		const hi =
			( horiz ? rect.x + rect.width : rect.y + rect.height ) -
			BORDER_INSET;
		if ( hi <= lo ) {
			return;
		}

		const middle = centerOf( rect );
		const normal = outward( g.side );
		const axis = horiz ? { x: 1, y: 0 } : { x: 0, y: 1 };

		// The far *stage*, not the far port or the control point. Both of
		// those are consequences of the port already chosen, so ordering by
		// them is circular — it re-affirms whatever order produced them. A
		// stage's centre owes nothing to any of this.
		const farOf = ( it ) =>
			centerOf( it.role === 'source' ? it.p.own[ 1 ] : it.p.own[ 0 ] );

		// The angle away from the border's own normal: how far to one side the
		// destination lies, relative to how far out. The steepest departure
		// takes the port furthest that way, the most head-on takes the middle.
		const aimTo = ( it ) => {
			const far = farOf( it );
			const dx = far.x - middle.x;
			const dy = far.y - middle.y;
			const across = dx * axis.x + dy * axis.y;
			const out = Math.abs( dx * normal.x + dy * normal.y );
			return across / Math.max( 1, out );
		};

		// Which way the edge leans, for the depth tiebreak: the destination's
		// side when it says, the port the router already chose when it
		// doesn't.
		const sideOf = ( it ) => {
			const far = farOf( it );
			const lateral =
				( far.x - middle.x ) * axis.x + ( far.y - middle.y ) * axis.y;
			if ( Math.abs( lateral ) > 1 ) {
				return Math.sign( lateral );
			}
			const pt =
				it.role === 'source' ? it.p.plan.source : it.p.plan.target;
			const off =
				( pt.x - middle.x ) * axis.x + ( pt.y - middle.y ) * axis.y;
			return Math.sign( off ) || 1;
		};
		const depthOf = ( it ) => {
			const far = farOf( it );
			return Math.abs(
				( far.x - middle.x ) * normal.x +
					( far.y - middle.y ) * normal.y
			);
		};

		// One comparator for both passes below. Whatever decides who goes
		// where has to decide it once, or the second pass undoes the first.
		const byRoute = ( a, b ) => {
			const d = aimTo( a ) - aimTo( b );
			if ( Math.abs( d ) > 0.02 ) {
				return d;
			}
			return sideOf( a ) * depthOf( a ) - sideOf( b ) * depthOf( b );
		};

		// Order first, across the whole face, before any spacing is
		// considered: a permutation of the positions the geometry already
		// chose, so nothing moves anywhere new — only which edge sits at
		// which of those positions changes.
		const coordOf = ( it ) => {
			const pt =
				it.role === 'source' ? it.p.plan.source : it.p.plan.target;
			return horiz ? pt.x : pt.y;
		};
		const slots = g.items.map( coordOf ).sort( ( a, b ) => a - b );
		g.items
			.slice()
			.sort( byRoute )
			.forEach( ( it, i ) => {
				const pt =
					it.role === 'source' ? it.p.plan.source : it.p.plan.target;
				if ( horiz ) {
					pt.x = slots[ i ];
				} else {
					pt.y = slots[ i ];
				}
			} );

		// Then space, per cluster. In natural order along the border, so
		// proximity means what it says.
		const spacing = Math.min( PORT_SPREAD, ( hi - lo ) / g.items.length );
		const range = spacing * CLUSTER_RANGE;
		const entries = g.items.map( ( it ) => ( { it, v: coordOf( it ) } ) );
		entries.sort( ( a, b ) => a.v - b.v );

		let i = 0;
		while ( i < entries.length ) {
			let j = i + 1;
			while (
				j < entries.length &&
				entries[ j ].v - entries[ j - 1 ].v < range - 0.01
			) {
				j++;
			}
			const cluster = entries.slice( i, j );

			if ( cluster.length === 1 ) {
				// Nothing near it, so it is not this pass's business at all —
				// not even to pull inside the band.
				cluster[ 0 ].skip = true;
			} else {
				// Opened out around the cluster's own mean, so it stays where
				// it formed rather than migrating to the middle of the face.
				const mean =
					cluster.reduce( ( sum, e ) => sum + e.v, 0 ) /
					cluster.length;
				const width = spacing * ( cluster.length - 1 );
				const start = clamp( mean - width / 2, lo, hi - width );
				cluster
					.slice()
					.sort( ( a, b ) => byRoute( a.it, b.it ) )
					.forEach( ( e, slot ) => {
						e.at = start + slot * spacing;
					} );
			}
			i = j;
		}

		entries.forEach( ( e ) => {
			if ( e.skip ) {
				return;
			}
			const at = clamp( e.at, lo, hi );
			const pt =
				e.it.role === 'source'
					? e.it.p.plan.source
					: e.it.p.plan.target;
			if ( horiz ) {
				pt.x = at;
			} else {
				pt.y = at;
			}
		} );
	} );

	// Short edges are brought into line. Opposed faces are not required —
	// only that both ports slide along the same axis, so top-to-top pairs are
	// as straightenable as bottom-to-top ones.
	plans.forEach( ( p ) => {
		const plan = p.plan;
		// Straightening moves *both* ends onto one line, which a pinned end
		// cannot do — its position is a handle's, not a value to average. The
		// edge keeps whatever shape the short run gives it.
		if ( plan.pinnedSource ) {
			return;
		}
		const horiz =
			plan.sourcePos === Position.Top ||
			plan.sourcePos === Position.Bottom;
		const targetHoriz =
			plan.targetPos === Position.Top ||
			plan.targetPos === Position.Bottom;
		if ( horiz !== targetHoriz ) {
			return;
		}
		if ( distance( plan.source, plan.target ) > INLINE_RANGE ) {
			return;
		}
		const axis = horiz ? 'x' : 'y';
		const mid = ( plan.source[ axis ] + plan.target[ axis ] ) / 2;
		const band = ( rect ) => {
			const lo = ( horiz ? rect.x : rect.y ) + BORDER_INSET;
			const hi =
				( horiz ? rect.x + rect.width : rect.y + rect.height ) -
				BORDER_INSET;
			return hi > lo ? [ lo, hi ] : null;
		};
		const a = band( p.own[ 0 ] );
		const b = band( p.own[ 1 ] );
		if ( ! a || ! b ) {
			return;
		}
		const lo = Math.max( a[ 0 ], b[ 0 ] );
		const hi = Math.min( a[ 1 ], b[ 1 ] );
		if ( hi <= lo ) {
			return;
		}
		const at = clamp( mid, lo, hi );
		plan.source[ axis ] = at;
		plan.target[ axis ] = at;
		// Recorded, because a straightened edge is a decision and not just a
		// shape: the bundling pass must not undo it.
		plan.straight = true;
	} );

	// The ports moved, so the stubs and the curves between them are stale.
	plans.forEach( refreshPlan );
}
