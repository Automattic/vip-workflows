/**
 * Drawing an edge plan as one continuous curve.
 *
 * The guide is short — port, stub, at most one control point, stub, port — and
 * the curve through it is a uniform cubic B-spline rather than an interpolating
 * chain. A Bézier chain passes exactly through its points with each span fitted
 * to the turn it has to make, so continuity is only C1: the tangent matches at
 * the joins but the curvature jumps. A B-spline approximates instead — the
 * guide points pull on the curve without being on it — and the result is C2:
 * curvature itself is continuous, which is the difference between a line that
 * looks smooth and one that looks drawn in a single motion.
 *
 * The ends still have to be exact: an edge must meet its border and leave
 * square. Reflecting one control point past each end (`E₋₁ = 2P₀ − P₁`) does
 * that on a uniform spline while keeping the whole curve expressible as
 * ordinary cubic segments — the first segment's start works out to exactly
 * `P₀`, and its first handle lies along `P₀→P₁`, the port normal.
 *
 * The stubs are what hold the departure square, and their *length* is the main
 * source of the curve's shape — so it answers to the length of the edge. One
 * fixed value is either too short to bend a long run or long enough to swamp a
 * short one; instead a span-scaled multiplier ramps from `STUB_MIN` on the
 * shortest edges to `STUB_MAX` on the longest.
 *
 * @package
 */

import {
	bezierAt,
	distance,
	outward,
	polylineMidpoint,
	round,
	clamp,
} from './edge-geometry';
import {
	PORT_STUB,
	STUB_MIN,
	STUB_MAX,
	STUB_NEAR,
	STUB_FAR,
} from './edge-constants';

/**
 * Where an edge's port stubs end — the points the curve between them runs from
 * and to, rather than the borders themselves.
 *
 * @param {Object} source    Point on the source border.
 * @param {string} sourcePos Border it sits on.
 * @param {Object} target    Point on the target border.
 * @param {string} targetPos Border it sits on.
 * @return {{ source: Object, target: Object }} The two stub ends.
 */
export function portStubs( source, sourcePos, target, targetPos ) {
	const span = distance( source, target );
	const ramp = clamp(
		( span - STUB_NEAR ) / Math.max( 1, STUB_FAR - STUB_NEAR ),
		0,
		1
	);
	const reach = PORT_STUB * ( STUB_MIN + ( STUB_MAX - STUB_MIN ) * ramp );
	const from = outward( sourcePos );
	const to = outward( targetPos );
	return {
		source: { x: source.x + from.x * reach, y: source.y + from.y * reach },
		target: { x: target.x + to.x * reach, y: target.y + to.y * reach },
	};
}

/**
 * @typedef {Object} SplinePath
 * @property {string}   d       SVG path from border to border.
 * @property {Object[]} samples Points along the drawn curve, for measuring.
 * @property {Object[]} handles Each cubic span's `{ a, c1, c2, b }`.
 * @property {Object}   mid     Arc-length midpoint, carrying `total`.
 */

/**
 * The B-spline through a plan's guide points.
 *
 * @param {Object}   plan            The edge plan.
 * @param {Object}   plan.source     Point on the source border.
 * @param {Object}   plan.sourceStub Far end of its stub.
 * @param {Object[]} plan.waypoints  Zero or one control points.
 * @param {Object}   plan.targetStub Far end of the other stub.
 * @param {Object}   plan.target     Point on the target border.
 * @return {SplinePath} The drawn curve.
 */
export function bsplinePath( plan ) {
	const raw = [
		plan.source,
		plan.sourceStub,
		...plan.waypoints,
		plan.targetStub,
		plan.target,
	];
	const P = raw.filter(
		( p, i ) => i === 0 || distance( p, raw[ i - 1 ] ) > 0.01
	);

	if ( P.length < 2 ) {
		return {
			d: '',
			samples: P,
			handles: [],
			mid: { x: 0, y: 0, total: 0 },
		};
	}
	if ( P.length === 2 ) {
		return {
			d: `M ${ round( P[ 0 ].x ) },${ round( P[ 0 ].y ) } L ${ round(
				P[ 1 ].x
			) },${ round( P[ 1 ].y ) }`,
			samples: P,
			handles: [],
			mid: polylineMidpoint( P ),
		};
	}

	const first = P[ 0 ];
	const second = P[ 1 ];
	const last = P[ P.length - 1 ];
	const penult = P[ P.length - 2 ];
	const E = [
		{ x: 2 * first.x - second.x, y: 2 * first.y - second.y },
		...P,
		{ x: 2 * last.x - penult.x, y: 2 * last.y - penult.y },
	];

	let d = '';
	const samples = [];
	const handles = [];
	for ( let i = 0; i + 3 < E.length; i++ ) {
		const a = E[ i ];
		const b = E[ i + 1 ];
		const c = E[ i + 2 ];
		const e = E[ i + 3 ];
		const b0 = {
			x: ( a.x + 4 * b.x + c.x ) / 6,
			y: ( a.y + 4 * b.y + c.y ) / 6,
		};
		const b1 = { x: ( 2 * b.x + c.x ) / 3, y: ( 2 * b.y + c.y ) / 3 };
		const b2 = { x: ( b.x + 2 * c.x ) / 3, y: ( b.y + 2 * c.y ) / 3 };
		const b3 = {
			x: ( b.x + 4 * c.x + e.x ) / 6,
			y: ( b.y + 4 * c.y + e.y ) / 6,
		};
		if ( ! d ) {
			d = `M ${ round( b0.x ) },${ round( b0.y ) }`;
			samples.push( b0 );
		}
		d +=
			` C ${ round( b1.x ) },${ round( b1.y ) }` +
			` ${ round( b2.x ) },${ round( b2.y ) }` +
			` ${ round( b3.x ) },${ round( b3.y ) }`;
		for ( let t = 1; t <= 12; t++ ) {
			samples.push( bezierAt( b0, b1, b2, b3, t / 12 ) );
		}
		handles.push( { a: b0, c1: b1, c2: b2, b: b3 } );
	}

	return { d, samples, handles, mid: polylineMidpoint( samples ) };
}

/**
 * The same curve, stopped short of its far end.
 *
 * The arrowhead stands off the card it points at, and the line has to stop
 * where the head does — run to the border underneath it and the last pixels
 * show through the open chevron, which reads as the head sitting *on* the line
 * rather than ending it. Trimming the path is what makes the standoff a gap
 * instead of a shift: the marker then sits at `refX` 0, on the path's own end.
 *
 * Only the far end moves. The near one carries the socket, which is flush with
 * its border by design.
 *
 * The plan's ports are untouched, so everything measured from them — the break
 * marks, the midpoint the insert "+" rides at, the ports themselves — is the
 * geometry it always was. A dash pattern laid out along the full length still
 * lands where it did; the trim only clips its final run.
 *
 * @param {Array}  handles Cubic spans from `bsplinePath`.
 * @param {number} gap     How much to take off the end, in px.
 * @return {?string} The shortened path, or null when there is nothing to trim
 *         (no spans, or a last span shorter than the gap — neither happens with
 *         real ports, and a caller falling back to the full path is right).
 */
export function trimPathEnd( handles, gap ) {
	if ( ! handles.length || ! ( gap > 0 ) ) {
		return null;
	}
	const last = handles[ handles.length - 1 ];

	// Where along the last span `gap` px remain. Sampled rather than solved:
	// arc length of a cubic has no closed form, and the span is a port stub —
	// near enough straight that the sampling is exact for this purpose.
	const steps = 32;
	const lengths = [ 0 ];
	let previous = last.a;
	for ( let i = 1; i <= steps; i++ ) {
		const point = bezierAt( last.a, last.c1, last.c2, last.b, i / steps );
		lengths.push( lengths[ i - 1 ] + distance( previous, point ) );
		previous = point;
	}
	const total = lengths[ steps ];
	if ( total <= gap ) {
		return null;
	}
	const want = total - gap;
	let i = 1;
	while ( i < steps && lengths[ i ] < want ) {
		i++;
	}
	const span = lengths[ i ] - lengths[ i - 1 ];
	const fraction = span > 0 ? ( want - lengths[ i - 1 ] ) / span : 0;
	const t = ( i - 1 + fraction ) / steps;

	// de Casteljau, keeping the first part: the split is exact, so the kept
	// curve is the same curve and not a refit of it.
	const lerp = ( p, q ) => ( {
		x: p.x + ( q.x - p.x ) * t,
		y: p.y + ( q.y - p.y ) * t,
	} );
	const q0 = lerp( last.a, last.c1 );
	const q1 = lerp( last.c1, last.c2 );
	const q2 = lerp( last.c2, last.b );
	const r0 = lerp( q0, q1 );
	const r1 = lerp( q1, q2 );
	const end = lerp( r0, r1 );

	const kept = handles
		.slice( 0, -1 )
		.concat( [ { a: last.a, c1: q0, c2: r0, b: end } ] );
	const at = ( p ) => `${ round( p.x ) },${ round( p.y ) }`;
	return kept.reduce(
		( d, h ) => `${ d } C ${ at( h.c1 ) } ${ at( h.c2 ) } ${ at( h.b ) }`,
		`M ${ at( kept[ 0 ].a ) }`
	);
}
