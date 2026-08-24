/**
 * Floating-edge geometry.
 *
 * An edge doesn't dock at a fixed handle — it meets each node wherever the line
 * between the two node centers crosses that node's border. A stage below its
 * source is entered from the top; one above it is entered from the bottom; one
 * off to the side, from the side. Nothing has to route around a fixed entry
 * point, which is what made back edges take the long way around.
 *
 * Ports are then eased off the corners: chosen by the centre ray, two stages
 * sitting diagonally next to each other both get a port pinned at the corner
 * facing the other — the worst place for one, since the stub leaves along the
 * border's outward normal, which at a corner points some 90° away from where
 * the edge has to go. The nearer a port lands to a corner, the harder it is
 * pulled toward the middle of its own face, so the face fills from the centre
 * outward and an edge always has open border to arc across.
 *
 * Kept pure (plain rectangles in, points out) so the math is unit-testable
 * without React Flow.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import { centerOf, clamp } from './edge-geometry';
import { BORDER_INSET, CENTER_PULL } from './edge-constants';

/**
 * @typedef {Object} Rect
 * @property {number} x      Left edge, in flow coordinates.
 * @property {number} y      Top edge, in flow coordinates.
 * @property {number} width  Node width.
 * @property {number} height Node height.
 */

/**
 * Where the ray from `rect`'s center toward `other`'s center leaves `rect`.
 *
 * Solved in the rectangle's normalized space, where the border is the unit
 * diamond |u| + |v| = 1: scaling the direction vector by `1 / (|u| + |v|)` lands
 * exactly on it, whichever side that turns out to be. Cheaper and branch-free
 * compared to testing each of the four sides in turn.
 *
 * Both arguments are node rectangles with a real width and height, and there is
 * deliberately no guard for one without. The scaling divides by half the width,
 * so a zero-width rect makes `w * scale` a `0 * Infinity` and every coordinate
 * NaN — but that is a measurement bug at its source, not a case to handle here:
 * `EdgePlanProvider.selectRects` refuses a node React Flow has not measured, so
 * the pipeline never plans between one. Catching it here would turn a visibly
 * broken edge into one quietly drawn to a plausible-looking point, which is the
 * reader-side fallback this codebase doesn't write. The concentric case below is
 * not that: two stages dropped on the same spot are two valid rectangles in a
 * configuration the formula has no direction for, and their shared center is the
 * answer rather than a substitute for one.
 *
 * @param {Rect} rect  The node the edge leaves.
 * @param {Rect} other The node at the far end.
 * @return {{ x: number, y: number }} Point on `rect`'s border.
 */
export function getNodeIntersection( rect, other ) {
	const w = rect.width / 2;
	const h = rect.height / 2;
	const cx = rect.x + w;
	const cy = rect.y + h;
	const ox = other.x + other.width / 2;
	const oy = other.y + other.height / 2;

	// Degenerate: concentric nodes have no meaningful direction.
	if ( ox === cx && oy === cy ) {
		return { x: cx, y: cy };
	}

	const u = ( ox - cx ) / ( 2 * w ) - ( oy - cy ) / ( 2 * h );
	const v = ( ox - cx ) / ( 2 * w ) + ( oy - cy ) / ( 2 * h );
	const scale = 1 / ( Math.abs( u ) + Math.abs( v ) );

	return {
		x: w * scale * ( u + v ) + cx,
		y: h * scale * ( v - u ) + cy,
	};
}

/**
 * Which side of `rect` a border point sits on.
 *
 * @param {Rect}                     rect  The node.
 * @param {{ x: number, y: number }} point Point on its border.
 * @return {Position} The side.
 */
export function getEdgeSide( rect, point ) {
	// A point can miss the border by a sub-pixel after the scaling above, so
	// compare with a pixel of slack rather than exactly.
	if ( Math.round( point.x ) <= Math.round( rect.x ) + 1 ) {
		return Position.Left;
	}
	if ( Math.round( point.x ) >= Math.round( rect.x + rect.width ) - 1 ) {
		return Position.Right;
	}
	if ( Math.round( point.y ) <= Math.round( rect.y ) + 1 ) {
		return Position.Top;
	}
	return Position.Bottom;
}

/**
 * Draw a border point back toward the middle of its face, harder the further
 * out it sits.
 *
 * Left where the geometry puts them, ports fan across the whole border and
 * pile up against the inset at the ends — where they are hardest to tell
 * apart, and where an edge leaves at the least useful angle. The pull is
 * proportional to how far out a port already is, so one near the middle is
 * untouched and one near a corner moves most. Deliberately before clustering,
 * not after — this decides where a port wants to be, and clustering then
 * decides what to do about the ones that want the same place.
 *
 * @param {{ x: number, y: number }} point Point on the border.
 * @param {Position}                 side  Which border it is on.
 * @param {Rect}                     rect  The node.
 * @return {{ x: number, y: number }} The eased point.
 */
export function easeOffCorner( point, side, rect ) {
	const horiz = side === Position.Top || side === Position.Bottom;
	const lo = ( horiz ? rect.x : rect.y ) + BORDER_INSET;
	const hi =
		( horiz ? rect.x + rect.width : rect.y + rect.height ) - BORDER_INSET;
	if ( hi <= lo ) {
		return point;
	}

	const middle = horiz ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
	const half = ( horiz ? rect.width : rect.height ) / 2;
	let v = horiz ? point.x : point.y;
	if ( half > 0 && CENTER_PULL ) {
		const out = clamp( Math.abs( v - middle ) / half, 0, 1 );
		v = middle + ( v - middle ) * ( 1 - CENTER_PULL * out );
	}

	v = clamp( v, lo, hi );
	return horiz ? { x: v, y: point.y } : { x: point.x, y: v };
}

/**
 * The point on one named border of a node that sits nearest `toward`.
 *
 * The counterpart to `getNodeIntersection`, which derives the border from the
 * direction and gives no say in it. This takes the border as given and picks
 * the best place on it — which is what lets an edge's port be chosen for the
 * route it makes possible rather than fixed before routing starts
 * (`edge-plan.js`).
 *
 * @param {Rect}                     rect   The node.
 * @param {Position}                 side   Border to leave from.
 * @param {{ x: number, y: number }} toward What the edge is heading for.
 * @return {{ x: number, y: number }} Point on that border.
 */
export function borderPointOn( rect, side, toward ) {
	const point =
		side === Position.Top || side === Position.Bottom
			? {
					x: clamp(
						toward.x,
						rect.x + BORDER_INSET,
						rect.x + rect.width - BORDER_INSET
					),
					y: side === Position.Top ? rect.y : rect.y + rect.height,
			  }
			: {
					x: side === Position.Left ? rect.x : rect.x + rect.width,
					y: clamp(
						toward.y,
						rect.y + BORDER_INSET,
						rect.y + rect.height - BORDER_INSET
					),
			  };
	return easeOffCorner( point, side, rect );
}

/**
 * Endpoints and sides for an edge floating between two nodes.
 *
 * Re-aiming an end at the bulge its curve actually heads for is
 * `getSidedEdgeParams`'s `aim`, not this function's business: by the time a
 * route has a bulge to aim at, its borders have been chosen and it is no longer
 * floating (`edge-plan.js`).
 *
 * @param {Rect} source Source node geometry.
 * @param {Rect} target Target node geometry.
 * @return {{ sx: number, sy: number, tx: number, ty: number, sourcePos: Position, targetPos: Position }}
 *         Path parameters.
 */
export function getFloatingEdgeParams( source, target ) {
	let sourcePoint = getNodeIntersection( source, target );
	let targetPoint = getNodeIntersection( target, source );
	const sourcePos = getEdgeSide( source, sourcePoint );
	const targetPos = getEdgeSide( target, targetPoint );
	sourcePoint = easeOffCorner( sourcePoint, sourcePos, source );
	targetPoint = easeOffCorner( targetPoint, targetPos, target );

	return {
		sx: sourcePoint.x,
		sy: sourcePoint.y,
		tx: targetPoint.x,
		ty: targetPoint.y,
		sourcePos,
		targetPos,
	};
}

/**
 * Endpoints for an edge told which borders to use, rather than deriving them
 * from where the two nodes happen to sit.
 *
 * @param {Rect}                      source       Source node geometry.
 * @param {Rect}                      target       Target node geometry.
 * @param {Object}                    sides        Borders to use.
 * @param {Position}                  sides.source Border the edge leaves from.
 * @param {Position}                  sides.target Border it arrives at.
 * @param {Object}                    [aim]        What each end should face along its border;
 *                                                 the other node's center by default.
 * @param {?{ x: number, y: number }} [aim.source] Where the path goes first.
 * @param {?{ x: number, y: number }} [aim.target] Where it comes from last.
 * @return {{ sx: number, sy: number, tx: number, ty: number, sourcePos: Position, targetPos: Position }}
 *         Path parameters.
 */
export function getSidedEdgeParams( source, target, sides, aim = null ) {
	const sourcePoint = borderPointOn(
		source,
		sides.source,
		aim?.source || centerOf( target )
	);
	const targetPoint = borderPointOn(
		target,
		sides.target,
		aim?.target || centerOf( source )
	);

	return {
		sx: sourcePoint.x,
		sy: sourcePoint.y,
		tx: targetPoint.x,
		ty: targetPoint.y,
		sourcePos: sides.source,
		targetPos: sides.target,
	};
}
