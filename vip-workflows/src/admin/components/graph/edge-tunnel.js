/**
 * Underpass breaks — where an edge passes behind a stage, the stroke says so.
 *
 * There is no router keeping edges out from under cards (`edge-plan.js`), so
 * this is what keeps an underpass legible: the visible stroke stops short of
 * the card, a small semicircular cup closes each end — doming toward the card,
 * so it reads as a mouth the line disappears into rather than a full stop — and
 * the hidden span is drawn faintly and dotted on a layer above the cards. The
 * marks come from the Figma port spec (`2210:680`).
 *
 * Done with the dash pattern rather than by cutting the path into pieces, so
 * the geometry stays one curve — the same `d` the hit target and the halo use.
 *
 * The break marks obey the same rules as ports. Where several edges dive under
 * the same card on the same side, their entry marks are placed by nothing but
 * where each curve happens to cross — so two can sit a pixel apart and read as
 * one thick mark. Ports had exactly this problem and it is already solved:
 * gather what is close, hold a minimum pitch, and keep off the corners.
 * Reusing `PORT_SPREAD`, `CLUSTER_RANGE` and `BORDER_INSET` keeps the two
 * kinds of mark consistent with each other, which matters more than either
 * being independently tunable. The cost is that a gathered mark is no longer
 * exactly `TUNNEL_GAP` from the card — it slides along its own curve to reach
 * its slot — so the slide is budgeted, and a slot that would cost the standoff
 * is refused: uneven spacing is a smaller fault than a break floating in open
 * space. Whatever the placement does, the gap always covers the true buried
 * span, so the visible stroke can never re-enter a card.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import {
	bezierAt,
	clamp,
	distance,
	heading,
	outward,
	round,
} from './edge-geometry';
import { bsplinePath } from './edge-spline';
import {
	BORDER_INSET,
	CLUSTER_RANGE,
	PORT_SPREAD,
	TUNNEL_CAP,
	TUNNEL_DOT,
	TUNNEL_DOT_GAP,
	TUNNEL_GAP,
} from './edge-constants';

/**
 * The border of the rect a mark stands off from.
 *
 * The mark sits `gap` off the card whose inflated boundary it crossed, so
 * the host is the rect whose border is nearest that standoff — not the
 * nearest rect outright, which in a dense layout can be a different, closer
 * neighbour the mark never crossed.
 *
 * @param {Object} point The point.
 * @param {Array}  rects Candidate rectangles.
 * @param {number} gap   The standoff the mark was placed at.
 * @return {{ rect: Object, face: Position }|null} Host rect and its face.
 */
function hostFace( point, rects, gap ) {
	let rect = null;
	let near = 1e9;
	rects.forEach( ( r ) => {
		const cx = clamp( point.x, r.x, r.x + r.width );
		const cy = clamp( point.y, r.y, r.y + r.height );
		const d = Math.hypot( point.x - cx, point.y - cy );
		const score = Math.abs( d - gap );
		if ( score < near ) {
			near = score;
			rect = r;
		}
	} );
	if ( ! rect ) {
		return null;
	}

	const onX = point.x > rect.x && point.x < rect.x + rect.width;
	const onY = point.y > rect.y && point.y < rect.y + rect.height;
	let face;
	if ( onX && ! onY ) {
		face = point.y < rect.y ? Position.Top : Position.Bottom;
	} else if ( onY && ! onX ) {
		face = point.x < rect.x ? Position.Left : Position.Right;
	} else {
		// A corner: whichever axis it is further out on.
		const dx =
			point.x < rect.x
				? rect.x - point.x
				: point.x - ( rect.x + rect.width );
		const dy =
			point.y < rect.y
				? rect.y - point.y
				: point.y - ( rect.y + rect.height );
		if ( dx > dy ) {
			face = point.x < rect.x ? Position.Left : Position.Right;
		} else {
			face = point.y < rect.y ? Position.Top : Position.Bottom;
		}
	}
	return { rect, face };
}

/**
 * Where a curve runs beneath a stage, measured along the curve.
 *
 * Geometry only — no drawing. The marks it finds are the entry and exit
 * points, and they are collected across every edge before anything is drawn,
 * because a mark's final position depends on the other marks on the same
 * border.
 *
 * @param {Array}  handles The curve's cubic spans, from `bsplinePath`.
 * @param {Array}  rects   Rectangles the curve may pass under.
 * @param {number} gap     Standoff between a break and the card.
 * @return {Object|null} `{ pts, len, total, spans, ends }`, or null.
 */
function tunnelGeometry( handles, rects, gap ) {
	if ( ! handles || ! handles.length || ! rects || ! rects.length || ! gap ) {
		return null;
	}

	// Sampled far more densely than the routing needs: the dash pattern is
	// laid out in arc length, so an approximation good enough to test for
	// collisions is not good enough to put a gap in the right place.
	const pts = [];
	handles.forEach( ( h, n ) => {
		const first = n === 0 ? 0 : 1;
		for ( let i = first; i <= 32; i++ ) {
			pts.push( bezierAt( h.a, h.c1, h.c2, h.b, i / 32 ) );
		}
	} );
	if ( pts.length < 2 ) {
		return null;
	}

	const len = [ 0 ];
	for ( let i = 1; i < pts.length; i++ ) {
		len.push( len[ i - 1 ] + distance( pts[ i - 1 ], pts[ i ] ) );
	}
	const total = len[ len.length - 1 ];
	if ( ! total ) {
		return null;
	}

	const inside = ( p ) =>
		rects.some(
			( r ) =>
				p.x > r.x - gap &&
				p.x < r.x + r.width + gap &&
				p.y > r.y - gap &&
				p.y < r.y + r.height + gap
		);
	const buried = pts.map( inside );

	let spans = [];
	let from = -1;
	buried.forEach( ( b, i ) => {
		if ( b && from < 0 ) {
			from = i;
		}
		if ( ! b && from >= 0 ) {
			spans.push( [ from, i - 1 ] );
			from = -1;
		}
	} );
	if ( from >= 0 ) {
		spans.push( [ from, buried.length - 1 ] );
	}

	// Only where the line really goes under the card. The spans above are
	// measured against the rectangle plus its standoff, which is wider than
	// the card, so an edge merely passing close by — never hidden at all —
	// would be broken and capped as though it had tunnelled.
	const under = pts.map( ( p ) =>
		rects.some(
			( r ) =>
				p.x > r.x &&
				p.x < r.x + r.width &&
				p.y > r.y &&
				p.y < r.y + r.height
		)
	);
	spans = spans.filter( ( [ a, b ] ) => {
		// A span touching either end of the curve is the edge sitting on its
		// own port, not an underpass: every edge starts and ends on a border,
		// so that region is always inside the inflated rectangle and would
		// otherwise swallow the line from its own attachment point.
		if ( a === 0 || b === pts.length - 1 ) {
			return false;
		}
		for ( let i = a; i <= b; i++ ) {
			if ( under[ i ] ) {
				return true;
			}
		}
		return false;
	} );
	if ( ! spans.length ) {
		return null;
	}

	// The crossing is found between samples, not snapped to one — taking the
	// first buried sample as the boundary puts the break wherever the
	// sampling happened to land, so the standoff varies with step length.
	const cross = ( clear, hidden ) => {
		let lo = 0;
		let hi = 1;
		for ( let n = 0; n < 14; n++ ) {
			const mid = ( lo + hi ) / 2;
			const p = {
				x: clear.x + ( hidden.x - clear.x ) * mid,
				y: clear.y + ( hidden.y - clear.y ) * mid,
			};
			if ( inside( p ) ) {
				hi = mid;
			} else {
				lo = mid;
			}
		}
		return hi;
	};
	const lerp = ( a, b, f ) => ( {
		x: a.x + ( b.x - a.x ) * f,
		y: a.y + ( b.y - a.y ) * f,
	} );

	const ends = spans.map( ( [ a, b ] ) => {
		const mark = ( i, j ) => {
			const f = cross( pts[ i ], pts[ j ] );
			const p = lerp( pts[ i ], pts[ j ], f );
			const host = hostFace( p, rects, gap );
			if ( ! host ) {
				return null;
			}
			const at = len[ i ] + ( len[ j ] - len[ i ] ) * f;
			return {
				// The true crossing is kept as well as the placed position:
				// the gap has to cover the buried span whatever the placement
				// does, so it is the one thing that cannot be traded away.
				idx: j,
				s: at,
				s0: at,
				p,
				tangent: heading( pts[ i ], pts[ j ] ),
				rect: host.rect,
				face: host.face,
				coord:
					host.face === Position.Top || host.face === Position.Bottom
						? p.x
						: p.y,
			};
		};
		return {
			// A span running off either end of the curve has no visible end
			// to close, and nothing to place.
			start: a > 0 ? mark( a - 1, a ) : null,
			end: b < pts.length - 1 ? mark( b + 1, b ) : null,
		};
	} );

	return { pts, len, total, spans, ends };
}

/**
 * Gather the break marks sharing a face, exactly the way ports are gathered.
 *
 * @param {Array} marks Every mark on the canvas.
 */
function clusterMarks( marks ) {
	const spacing = PORT_SPREAD;
	if ( ! spacing || marks.length < 2 ) {
		return;
	}

	const groups = {};
	marks.forEach( ( m ) => {
		const key = `${ Math.round( m.rect.x ) },${ Math.round( m.rect.y ) }:${
			m.face
		}`;
		( groups[ key ] = groups[ key ] || [] ).push( m );
	} );

	Object.values( groups ).forEach( ( list ) => {
		if ( list.length < 2 ) {
			return;
		}
		const face = list[ 0 ].face;
		const rect = list[ 0 ].rect;
		const horiz = face === Position.Top || face === Position.Bottom;
		const lo = ( horiz ? rect.x : rect.y ) + BORDER_INSET;
		const hi =
			( horiz ? rect.x + rect.width : rect.y + rect.height ) -
			BORDER_INSET;
		if ( hi <= lo ) {
			return;
		}

		const entries = list.slice().sort( ( a, b ) => a.coord - b.coord );
		const range = spacing * CLUSTER_RANGE;

		// The corner inset applies to every mark, crowded or not — a lone
		// mark sitting two pixels off a corner looks like a mistake whether
		// or not anything else shares its border.
		entries.forEach( ( e ) => {
			const held = clamp( e.coord, lo, hi );
			if ( Math.abs( held - e.coord ) > 0.01 ) {
				e.want = held;
			}
		} );

		let i = 0;
		while ( i < entries.length ) {
			let j = i + 1;
			while (
				j < entries.length &&
				entries[ j ].coord - entries[ j - 1 ].coord < range - 0.01
			) {
				j++;
			}
			const cluster = entries.slice( i, j );
			if ( cluster.length > 1 ) {
				const mean =
					cluster.reduce( ( sum, e ) => sum + e.coord, 0 ) /
					cluster.length;
				const width = spacing * ( cluster.length - 1 );
				const from = clamp(
					mean - width / 2,
					lo,
					Math.max( lo, hi - width )
				);
				cluster.forEach( ( e, slot ) => {
					e.want = from + slot * spacing;
				} );
			}
			i = j;
		}
	} );
}

/**
 * Slide a mark along its own curve until it sits where the clustering wants
 * it, and leave it alone if the curve never gets there.
 *
 * @param {Object} mark   The mark.
 * @param {Object} geo    Its curve's geometry, from `tunnelGeometry`.
 * @param {number} budget How far along the curve the mark may travel.
 * @param {number} gap    The standoff the moved mark must keep.
 */
function slideMark( mark, geo, budget, gap ) {
	if ( mark.want === undefined ) {
		return;
	}
	const horiz = mark.face === Position.Top || mark.face === Position.Bottom;
	const axis = horiz ? 'x' : 'y';
	const pts = geo.pts;
	const len = geo.len;
	const target = mark.want;

	// Outward from where it is now, so it takes the nearest crossing of the
	// wanted coordinate rather than some far one the curve also passes.
	for ( let step = 1; step < pts.length; step++ ) {
		for ( const dir of [ -1, 1 ] ) {
			const j = mark.idx + dir * step;
			const i = j - 1;
			if ( i < 0 || j >= pts.length ) {
				continue;
			}
			const a = pts[ i ][ axis ];
			const b = pts[ j ][ axis ];
			if ( ( a - target ) * ( b - target ) > 0 ) {
				continue;
			}
			const f =
				Math.abs( b - a ) < 0.001 ? 0 : ( target - a ) / ( b - a );
			const at = len[ i ] + ( len[ j ] - len[ i ] ) * f;

			// A curve crossing a border steeply barely moves sideways however
			// far along it you go — reaching a slot a few pixels aside can
			// mean travelling a long way. Past the budget the slot is refused
			// and the mark stays at the true crossing.
			if ( Math.abs( at - mark.s0 ) > budget ) {
				return;
			}

			const moved = {
				x: pts[ i ].x + ( pts[ j ].x - pts[ i ].x ) * f,
				y: pts[ i ].y + ( pts[ j ].y - pts[ i ].y ) * f,
			};

			// And the standoff has to survive the move: an oblique crossing
			// could slide to a slot while drifting onto the card's border and
			// past it. The mark exists to sit `gap` off the card; a slot that
			// costs that is not worth having.
			const r = mark.rect;
			const dx = Math.max(
				r.x - moved.x,
				0,
				moved.x - ( r.x + r.width )
			);
			const dy = Math.max(
				r.y - moved.y,
				0,
				moved.y - ( r.y + r.height )
			);
			if ( Math.abs( Math.hypot( dx, dy ) - gap ) > 1.5 ) {
				return;
			}

			mark.s = at;
			mark.p = moved;
			return;
		}
	}
}

/**
 * The dash pattern, the ghost's, and the caps for one curve.
 *
 * @param {Object} geo    The curve's geometry, marks placed.
 * @param {number} capLen Diameter of the cup closing each end.
 * @return {{ dash: string, ghost: string, caps: Array }} Drawing instructions.
 */
function tunnelDraw( geo, capLen ) {
	const dash = [];
	const caps = [];
	// The ghost is the opposite of the visible stroke — drawn exactly where that
	// one isn't — but not simply its inverse: inside each buried span it is
	// broken again into dots. So it is built alongside the dash rather than
	// derived from it. A dasharray alternates dash, gap, dash, gap…, and the
	// helpers below are what keep that alternation honest while two patterns are
	// laid down at once.
	const ghost = [];
	const ghostDraw = ( length ) => {
		// Entries land in whichever slot is next, so a run in the wrong slot has
		// to open a zero-length one of the other kind first. Zero-length dashes
		// draw nothing — the ghost keeps butt caps, and round ones would turn
		// each into a stray dot.
		if ( ghost.length % 2 === 1 ) {
			ghost.push( 0 );
		}
		ghost.push( length );
	};
	const ghostSkip = ( length ) => {
		if ( ghost.length % 2 === 0 ) {
			ghost.push( 0 );
		}
		ghost.push( length );
	};
	let cursor = 0;

	// The cup that closes each end: a semicircle centred on the break, its chord
	// square to the line — a terminator at an angle to its own line reads as a
	// separate object lying across it — and its dome toward the card, so it says
	// which side the stage is on and reads as the mouth the line goes into.
	//
	// Drawn as one cubic rather than an arc command: control points `4/3 · r`
	// along the two tangents put the curve exactly through the dome at its
	// midpoint, and there is no sweep flag to get the wrong way round on a
	// break that happens to run right to left.
	const tick = ( mark ) => {
		const face = outward( mark.face );
		const dir = mark.tangent || face;
		const along = { x: -dir.y, y: dir.x };
		const sign = dir.x * face.x + dir.y * face.y >= 0 ? 1 : -1;
		// Along the line, away from the card — so its negation domes into it.
		const out = { x: dir.x * sign, y: dir.y * sign };
		const r = capLen / 2;
		const reach = ( 4 / 3 ) * r;
		const a = {
			x: mark.p.x - along.x * r,
			y: mark.p.y - along.y * r,
		};
		const b = {
			x: mark.p.x + along.x * r,
			y: mark.p.y + along.y * r,
		};
		const c1 = { x: a.x - out.x * reach, y: a.y - out.y * reach };
		const c2 = { x: b.x - out.x * reach, y: b.y - out.y * reach };
		caps.push( {
			d: `M ${ round( a.x ) },${ round( a.y ) } C ${ round(
				c1.x
			) },${ round( c1.y ) } ${ round( c2.x ) },${ round(
				c2.y
			) } ${ round( b.x ) },${ round( b.y ) }`,
		} );
	};

	geo.spans.forEach( ( span, n ) => {
		const e = geo.ends[ n ];
		// Never shorter than the buried span, whatever the placement did: the
		// gap starts no later than the true entry and ends no earlier than
		// the true exit, so the visible stroke can never re-enter a card.
		let from = e.start ? Math.min( e.start.s, e.start.s0 ) : 0;
		let to = e.end ? Math.max( e.end.s, e.end.s0 ) : geo.total;
		if ( to < from ) {
			const t = from;
			from = to;
			to = t;
		}
		if ( e.start ) {
			tick( e.start );
		}
		if ( e.end ) {
			tick( e.end );
		}
		dash.push( Math.max( 0, from - cursor ), Math.max( 0, to - from ) );

		// The ghost skips the stretch the line itself draws, then dots its way
		// across the buried one. A dot is never run past the end of the span:
		// the ghost must stop where the visible stroke resumes, or the two would
		// overlap at the mouth of the underpass.
		ghostSkip( Math.max( 0, from - cursor ) );
		let at = Math.max( from, cursor );
		while ( at < to ) {
			const on = Math.min( TUNNEL_DOT, to - at );
			ghostDraw( on );
			at += on;
			if ( at >= to ) {
				break;
			}
			const off = Math.min( TUNNEL_DOT_GAP, to - at );
			ghostSkip( off );
			at += off;
		}
		cursor = to;
	} );
	if ( cursor < geo.total ) {
		dash.push( geo.total - cursor );
	}

	// Both patterns have to tile the curve exactly once. A dasharray repeats,
	// and an odd-length one repeats with dashes and gaps exchanged — so a ghost
	// that stopped at the last underpass would carry on dotting the clear run
	// after it.
	ghostSkip( Math.max( 0, geo.total - cursor ) );
	if ( ghost.length % 2 === 1 ) {
		ghost.push( 0 );
	}

	return {
		dash: dash.map( round ).join( ' ' ),
		ghost: ghost.map( round ).join( ' ' ),
		caps,
	};
}

/**
 * Every edge's underpass breaks, placed together.
 *
 * @param {Array} plans Planned edges (`id`, `plan`, `obstacles`, `own`).
 * @return {Object} Drawing instructions by edge id.
 */
export function tunnelAll( plans ) {
	const out = {};
	const gap = TUNNEL_GAP;
	const budget = PORT_SPREAD * 2;

	const geos = {};
	const marks = [];
	plans.forEach( ( p ) => {
		const { handles } = bsplinePath( p.plan );
		// Its own two stages count as well. An edge that bows back over the
		// card it just left is running under a node like any other — the
		// routing tolerates its own rectangles because it may legitimately
		// touch them, but the drawing has no such licence.
		const geo = tunnelGeometry(
			handles,
			( p.obstacles || [] ).concat( p.own || [] ),
			gap
		);
		if ( ! geo ) {
			return;
		}
		geos[ p.id ] = geo;
		geo.ends.forEach( ( e ) => {
			if ( e.start ) {
				marks.push( e.start );
			}
			if ( e.end ) {
				marks.push( e.end );
			}
		} );
	} );

	clusterMarks( marks );
	Object.keys( geos ).forEach( ( id ) => {
		geos[ id ].ends.forEach( ( e ) => {
			if ( e.start ) {
				slideMark( e.start, geos[ id ], budget, gap );
			}
			if ( e.end ) {
				slideMark( e.end, geos[ id ], budget, gap );
			}
		} );
		out[ id ] = tunnelDraw( geos[ id ], TUNNEL_CAP );
	} );
	return out;
}
