/**
 * Geometry primitives shared by the edge pipeline.
 *
 * Plain numbers in, plain numbers out — nothing here knows about React Flow,
 * nodes, or state, which is what keeps every pass in the pipeline unit-testable
 * against hand-built rectangles.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import { MARK_STANDOFF } from './edge-constants';

/**
 * @typedef {Object} Point
 * @property {number} x Flow coordinate.
 * @property {number} y Flow coordinate.
 */

/**
 * @typedef {Object} Rect
 * @property {string} [id]   Node id, when the rectangle came from one.
 * @property {number} x      Left edge, in flow coordinates.
 * @property {number} y      Top edge.
 * @property {number} width  Node width.
 * @property {number} height Node height.
 */

// `Math.sqrt` over `Math.hypot` throughout this module: hypot's
// overflow-safe scaling is an order of magnitude slower in V8, and flow
// coordinates are far too small to need it. These primitives run hundreds
// of thousands of times per planning pass.
export const distance = ( a, b ) => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.sqrt( dx * dx + dy * dy );
};

export const round = ( value ) => Math.round( value * 100 ) / 100;

export const clamp = ( value, min, max ) =>
	Math.min( Math.max( value, min ), max );

/**
 * Center of a rectangle.
 *
 * @param {Rect} rect The rectangle.
 * @return {Point} Its center.
 */
export const centerOf = ( rect ) => ( {
	x: rect.x + rect.width / 2,
	y: rect.y + rect.height / 2,
} );

/**
 * Unit vector pointing out of a node from the given border.
 *
 * @param {Position} side The border.
 * @return {Point} Outward direction.
 */
export function outward( side ) {
	switch ( side ) {
		case Position.Left:
			return { x: -1, y: 0 };
		case Position.Right:
			return { x: 1, y: 0 };
		case Position.Top:
			return { x: 0, y: -1 };
		default:
			return { x: 0, y: 1 };
	}
}

/**
 * Where an edge's arrowhead points, in flow coordinates.
 *
 * Not the path's end: the path stops `MARK_STANDOFF` short of the border
 * (`trimPathEnd`), so the head's tip is measured back out along the normal.
 * Declared once because two layers stamp something on that exact point —
 * `EdgeOverlay` the head itself, `EdgeAnchors` the ring that grabs it — and a
 * ring that drifted off the mark it grabs would be a control pointing at
 * nothing.
 *
 * @param {Object} plan The edge's finished plan.
 * @return {Point} The tip.
 */
export function arrowTip( plan ) {
	const arrives = outward( plan.targetPos );
	return {
		x: plan.target.x + arrives.x * MARK_STANDOFF,
		y: plan.target.y + arrives.y * MARK_STANDOFF,
	};
}

/**
 * Unit vector from `a` to `b`, carrying the distance, or null if they coincide.
 *
 * @param {Point} a Start.
 * @param {Point} b End.
 * @return {{ x: number, y: number, length: number }|null} Direction and length.
 */
export function heading( a, b ) {
	const x = b.x - a.x;
	const y = b.y - a.y;
	const length = Math.sqrt( x * x + y * y );
	if ( ! length ) {
		return null;
	}
	return { x: x / length, y: y / length, length };
}

/**
 * A point on a cubic Bézier at parameter `t`.
 *
 * @param {Point}  a  Start point.
 * @param {Point}  c1 First control point.
 * @param {Point}  c2 Second control point.
 * @param {Point}  b  End point.
 * @param {number} t  Parameter in [0, 1].
 * @return {Point} The point.
 */
export function bezierAt( a, c1, c2, b, t ) {
	const u = 1 - t;
	const w0 = u * u * u;
	const w1 = 3 * u * u * t;
	const w2 = 3 * u * t * t;
	const w3 = t * t * t;
	return {
		x: a.x * w0 + c1.x * w1 + c2.x * w2 + b.x * w3,
		y: a.y * w0 + c1.y * w1 + c2.y * w2 + b.y * w3,
	};
}

/**
 * The point half the polyline's length along it, carrying the total length —
 * where the insert "+" goes.
 *
 * @param {Point[]} points The polyline.
 * @return {{ x: number, y: number, total: number }} Midpoint by arc length.
 */
export function polylineMidpoint( points ) {
	const lengths = [];
	let total = 0;
	for ( let i = 0; i < points.length - 1; i++ ) {
		const length = distance( points[ i ], points[ i + 1 ] );
		lengths.push( length );
		total += length;
	}

	let remaining = total / 2;
	for ( let i = 0; i < lengths.length; i++ ) {
		if ( remaining <= lengths[ i ] || i === lengths.length - 1 ) {
			const ratio = lengths[ i ] ? remaining / lengths[ i ] : 0;
			return {
				x:
					points[ i ].x +
					( points[ i + 1 ].x - points[ i ].x ) * ratio,
				y:
					points[ i ].y +
					( points[ i + 1 ].y - points[ i ].y ) * ratio,
				total,
			};
		}
		remaining -= lengths[ i ];
	}

	return { x: points[ 0 ].x, y: points[ 0 ].y, total };
}

/**
 * Distance from a point to a segment, and how far along it the foot lies.
 *
 * @param {Point} p The point.
 * @param {Point} a Segment start.
 * @param {Point} b Segment end.
 * @return {{ dist: number, t: number }} Distance and parametric position.
 */
export function pointToSegment( p, a, b ) {
	const vx = b.x - a.x;
	const vy = b.y - a.y;
	const len2 = vx * vx + vy * vy;
	const t = len2
		? clamp( ( ( p.x - a.x ) * vx + ( p.y - a.y ) * vy ) / len2, 0, 1 )
		: 0;
	const fx = a.x + vx * t;
	const fy = a.y + vy * t;
	const dx = p.x - fx;
	const dy = p.y - fy;
	return { dist: Math.sqrt( dx * dx + dy * dy ), t };
}

/**
 * Whether two sampled polylines cross each other.
 *
 * @param {Point[]} a One polyline.
 * @param {Point[]} b The other.
 * @return {boolean} True when any pair of segments intersects.
 */
export function polylinesCross( a, b ) {
	const side = ( p, q, r ) =>
		( q.x - p.x ) * ( r.y - p.y ) - ( q.y - p.y ) * ( r.x - p.x );
	for ( let i = 1; i < a.length; i++ ) {
		for ( let j = 1; j < b.length; j++ ) {
			const p1 = a[ i - 1 ];
			const p2 = a[ i ];
			const q1 = b[ j - 1 ];
			const q2 = b[ j ];
			const d1 = side( p1, p2, q1 );
			const d2 = side( p1, p2, q2 );
			const d3 = side( q1, q2, p1 );
			const d4 = side( q1, q2, p2 );
			if ( d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0 ) {
				return true;
			}
		}
	}
	return false;
}

/**
 * How many sampled points of a drawn path fall inside any of the obstacles.
 *
 * The inset shrinks (positive) or grows (negative) what counts as inside, so
 * the same test can ask "buried in the card" and "within a clearance of it".
 *
 * @param {Point[]} samples   Sampled points along the drawn curve.
 * @param {Rect[]}  obstacles Rectangles to test against.
 * @param {number}  [inset]   How much to shrink each rectangle by.
 * @return {number} Number of samples inside.
 */
export function penetration( samples, obstacles, inset = 1 ) {
	if ( ! samples || ! obstacles || ! obstacles.length ) {
		return 0;
	}
	let n = 0;
	for ( const p of samples ) {
		for ( const r of obstacles ) {
			if (
				p.x > r.x + inset &&
				p.x < r.x + r.width - inset &&
				p.y > r.y + inset &&
				p.y < r.y + r.height - inset
			) {
				n++;
				break;
			}
		}
	}
	return n;
}

/**
 * How many times a drawn path changes which way it curves.
 *
 * An edge that bends one way and then the other is an S, and an S between two
 * stages is nearly always a port that should have been on the other border:
 * leaving the bottom to reach something off to the left means turning left,
 * then right again to arrive. Nothing else in the cost sees it — both ends can
 * be perfectly aligned and the overall travel perfectly forward while the
 * middle doubles back. Counted from the sign of the cross product between
 * consecutive samples, so it measures the line as drawn.
 *
 * The turn is normalised — the sine of the angle, not the raw cross product.
 * The raw value scales with how long the two segments happen to be, so a fixed
 * threshold on it counts sampling noise on a long span as a reversal and
 * reports inflections in curves that have none.
 *
 * @param {Point[]} samples Sampled points along the drawn curve.
 * @return {number} Number of curvature reversals.
 */
export function inflections( samples ) {
	let sign = 0;
	let n = 0;
	for ( let i = 1; i < samples.length - 1; i++ ) {
		const a = samples[ i - 1 ];
		const b = samples[ i ];
		const c = samples[ i + 1 ];
		const ux = b.x - a.x;
		const uy = b.y - a.y;
		const vx = c.x - b.x;
		const vy = c.y - b.y;
		const lu = Math.sqrt( ux * ux + uy * uy );
		const lv = Math.sqrt( vx * vx + vy * vy );
		if ( ! lu || ! lv ) {
			continue;
		}
		const sin = ( ux * vy - uy * vx ) / ( lu * lv );
		if ( Math.abs( sin ) < 0.05 ) {
			continue;
		}
		const s = Math.sign( sin );
		if ( sign && s !== sign ) {
			n++;
		}
		sign = s;
	}
	return n;
}

/**
 * A point on a node's boundary as a single number running around it.
 *
 * Clockwise from the top-left corner, normalised to 0–1. Expressed this way a
 * border is just a range of the parameter rather than a separate space, so
 * moving from one face to the next is an ordinary move along it — which is
 * what lets a port slide around a corner instead of jumping across one.
 *
 * @param {Rect}   rect The node.
 * @param {number} u    Parameter in [0, 1), wrapped.
 * @return {{ x: number, y: number, side: Position }} Point and its border.
 */
export function perimeterAt( rect, u ) {
	const w = rect.width;
	const h = rect.height;
	const P = 2 * ( w + h );
	let s = ( ( ( u % 1 ) + 1 ) % 1 ) * P;
	if ( s < w ) {
		return { x: rect.x + s, y: rect.y, side: Position.Top };
	}
	s -= w;
	if ( s < h ) {
		return { x: rect.x + w, y: rect.y + s, side: Position.Right };
	}
	s -= h;
	if ( s < w ) {
		return { x: rect.x + w - s, y: rect.y + h, side: Position.Bottom };
	}
	s -= w;
	return { x: rect.x, y: rect.y + h - s, side: Position.Left };
}

/**
 * Where a point on the boundary sits along that parameter.
 *
 * @param {Rect}     rect  The node.
 * @param {Point}    point Point on its boundary.
 * @param {Position} side  Which border it is on.
 * @return {number} Parameter in [0, 1).
 */
export function perimeterOf( rect, point, side ) {
	const w = rect.width;
	const h = rect.height;
	const P = 2 * ( w + h );
	let s;
	if ( side === Position.Top ) {
		s = clamp( point.x - rect.x, 0, w );
	} else if ( side === Position.Right ) {
		s = w + clamp( point.y - rect.y, 0, h );
	} else if ( side === Position.Bottom ) {
		s = w + h + clamp( rect.x + w - point.x, 0, w );
	} else {
		s = w + h + w + clamp( rect.y + h - point.y, 0, h );
	}
	return s / P;
}

/**
 * Shortest signed distance between two points on a closed 0–1 loop.
 *
 * @param {number} from Start parameter.
 * @param {number} to   End parameter.
 * @return {number} Signed delta in [-0.5, 0.5].
 */
export function loopDelta( from, to ) {
	let d = to - from;
	if ( d > 0.5 ) {
		d -= 1;
	}
	if ( d < -0.5 ) {
		d += 1;
	}
	return d;
}
