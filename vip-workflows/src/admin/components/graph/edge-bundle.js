/**
 * Edge bundling — a wire loom, and the repulsion that moves it as one thing.
 *
 * Edges that travel together are gathered into evenly-spaced lanes at
 * `EDGE_PITCH`, and peel off at the ends to reach their own ports. Judged on
 * the drawn curves, not on control points: a control point is a lever, not a
 * location — two edges can run six pixels apart for their whole length while
 * their levers sit two hundred apart.
 *
 * Membership takes two gates that answer different questions. `EDGE_REACH`
 * says how far apart two edges may be and still count as running alongside;
 * `EDGE_GATHER` says how close they must actually come inside that stretch to
 * be worth gathering — travelling in the same direction is not the same as
 * travelling together. The stretch is measured per curve (two edges of
 * different lengths share a stretch at different parameters), direction is
 * compared in degrees (`EDGE_PARALLEL_DEG`), and antiparallel counts: a
 * reciprocal pair belongs in one loom even though the arrows disagree.
 * Membership also has hysteresis: a pair the caller says was bundled last
 * frame (`sticky`) holds its loom at gates widened by `EDGE_KEEP`, so
 * borderline geometry doesn't toggle a loom — and with it every port and
 * lever — on alternate frames of a drag.
 *
 * Lanes are ordered by each member's travel along the loom's axis — deeper
 * edge outboard, the same rule the ports use — so gathering cannot make two
 * members swap over mid-run. The ports then adopt the bundle's order (a
 * cluster's slots are interchangeable, so the fix is a permutation), kept only
 * if it strictly reduces crossings among the loom's members; and the ports
 * close to the bundle's pitch, because a bundle could never be drawn tighter
 * than the port spacing that pins its ends. A `straight` edge is an anchor:
 * it keeps its lane and the loom forms around it.
 *
 * A guard closes the pass, measured pair by pair rather than as one global
 * minimum — a single crossing anywhere on the canvas is a gap of zero, and a
 * global reading would excuse everything after it. Gathering lowers a pair's
 * gap on purpose, so each pair is allowed down to the pitch the loom was
 * asked to hold (less `EDGE_GUARD_SLACK`, the tolerance the relaxation itself
 * converges within) and no further; a pair already tighter than the pitch is
 * held to its own baseline instead. A violation rolls back only the looms it
 * implicates — ports, levers, and lane shifts — and leaves the rest standing.
 *
 * Lever moves are recorded on the plan (`leverShift`) as well as applied:
 * `controlFor` rebuilds a plan's control point whenever a port moves, and
 * only what is in `leverShift` survives the rebuild.
 *
 * `repelGroups` is the loom's half of centre repulsion: applied per edge, the
 * push displaced every thread by a different amount, so a bundle was gathered
 * out of parts already pulled apart. The force is computed once per bundle,
 * from the mean of what its threads each feel, and `controlFor` applies it
 * equally to all of them (`loomPush`) — the bundle moves as a unit and keeps
 * the spacing it was just given.
 *
 * @package
 */

import { Position } from '@xyflow/react';
import {
	clamp,
	heading,
	pointToSegment,
	polylinesCross,
} from './edge-geometry';
import { bsplinePath, portStubs } from './edge-spline';
import { controlFor, repulsion } from './edge-plan';
import {
	BORDER_INSET,
	EDGE_GATHER,
	EDGE_GUARD_SLACK,
	EDGE_KEEP,
	EDGE_OVERLAP,
	EDGE_PARALLEL_DEG,
	EDGE_PITCH,
	EDGE_REACH,
	LEVER_ACROSS,
	LEVER_ALONG,
	LEVER_FLOOR,
	PORT_SPREAD,
} from './edge-constants';

/**
 * Gather co-travelling edges into lanes. Mutates the plans in place.
 *
 * @param {Array}   plans  Planned edges (`id`, `plan`, `own`, `obstacles`).
 * @param {?Set}    sticky Pairs bundled last frame, as sorted `idA|idB`
 *                         keys — membership hysteresis (`EDGE_KEEP`).
 * @param {boolean} relane Re-hold the looms already on the plans (from a
 *                         previous call this frame) instead of re-deciding
 *                         membership — the pair search is skipped.
 */
export function bundleEdges( plans, sticky = null, relane = false ) {
	const pitch = EDGE_PITCH;
	if ( ! pitch ) {
		return;
	}

	const trace = ( p ) => {
		const pts = bsplinePath( p.plan ).samples;
		if ( ! pts || pts.length < 3 ) {
			return null;
		}
		const tan = pts.map( ( _, i ) =>
			heading(
				pts[ Math.max( 0, i - 1 ) ],
				pts[ Math.min( pts.length - 1, i + 1 ) ]
			)
		);
		const box = {
			minX: Infinity,
			minY: Infinity,
			maxX: -Infinity,
			maxY: -Infinity,
		};
		pts.forEach( ( pt ) => {
			box.minX = Math.min( box.minX, pt.x );
			box.minY = Math.min( box.minY, pt.y );
			box.maxX = Math.max( box.maxX, pt.x );
			box.maxY = Math.max( box.maxY, pt.y );
		} );
		return { pts, tan, box };
	};

	const rows = plans
		.map( ( p ) => {
			const t = trace( p );
			return t ? { p, pts: t.pts, tan: t.tan, box: t.box } : null;
		} )
		.filter( Boolean );
	if ( rows.length < 2 ) {
		return;
	}

	// The cheapest possible "could these two even matter to each other": the
	// gap between their bounding boxes, a lower bound on the gap between the
	// curves. Most pairs on a real canvas are nowhere near each other, and
	// this is what keeps the pair scans from touching them.
	const boxGap = ( a, b ) => {
		const dx = Math.max(
			a.box.minX - b.box.maxX,
			b.box.minX - a.box.maxX,
			0
		);
		const dy = Math.max(
			a.box.minY - b.box.maxY,
			b.box.minY - a.box.maxY,
			0
		);
		return Math.sqrt( dx * dx + dy * dy );
	};
	// The same lower bound per point: a point further from the whole curve's
	// box than the distance being asked about can't answer it, and skips the
	// segment scan entirely.
	const boxDist = ( pt, box ) => {
		const dx = Math.max( box.minX - pt.x, 0, pt.x - box.maxX );
		const dy = Math.max( box.minY - pt.y, 0, pt.y - box.maxY );
		return Math.sqrt( dx * dx + dy * dy );
	};

	// Rebuild a row's stubs, control point and sampled curve after its ports
	// or lever moved.
	const refresh = ( row ) => {
		const plan = row.p.plan;
		const stubs = portStubs(
			plan.source,
			plan.sourcePos,
			plan.target,
			plan.targetPos
		);
		plan.sourceStub = stubs.source;
		plan.targetStub = stubs.target;
		plan.waypoints = controlFor( plan, row.p.obstacles );
		const t = trace( row.p );
		if ( t ) {
			row.pts = t.pts;
			row.tan = t.tan;
			row.box = t.box;
		}
	};
	// Re-sample only — for lever moves, which don't invalidate the ports.
	const retrace = ( row ) => {
		const t = trace( row.p );
		if ( t ) {
			row.pts = t.pts;
			row.tan = t.tan;
			row.box = t.box;
		}
	};

	const reach = pitch * EDGE_REACH;
	const gather = pitch * EDGE_GATHER;
	const cosLimit = Math.cos( ( EDGE_PARALLEL_DEG * Math.PI ) / 180 );

	// Where A runs alongside B: the stretch of A that is close and roughly
	// parallel, and how close it gets inside that stretch. A yes/no asked at
	// a tens-of-pixels reach doesn't need every sample, so A is walked at
	// every other point; the window indices stay in full-resolution terms.
	const shared = ( a, b, limit ) => {
		let close = 0;
		let sampled = 0;
		let lo = Infinity;
		let hi = -1;
		let minD = 1e9;
		for ( let i = 0; i < a.pts.length; i += 2 ) {
			const pt = a.pts[ i ];
			sampled++;
			if ( boxDist( pt, b.box ) > limit ) {
				continue;
			}
			let best = 1e9;
			let at = 0;
			for ( let j = 1; j < b.pts.length; j++ ) {
				const d = pointToSegment( pt, b.pts[ j - 1 ], b.pts[ j ] );
				if ( d.dist < best ) {
					best = d.dist;
					at = j;
				}
			}
			if ( best > limit ) {
				continue;
			}
			const ta = a.tan[ i ];
			const tb = b.tan[ at ];
			if ( ! ta || ! tb ) {
				continue;
			}
			if ( Math.abs( ta.x * tb.x + ta.y * tb.y ) < cosLimit ) {
				continue;
			}
			close++;
			if ( i < lo ) {
				lo = i;
			}
			if ( i > hi ) {
				hi = i;
			}
			if ( best < minD ) {
				minD = best;
			}
		}
		return { frac: close / Math.max( 1, sampled ), lo, hi, minD };
	};

	const win = rows.map( () => null );
	const widen = ( n, w ) => {
		if ( w.hi < 0 ) {
			return;
		}
		const cur = win[ n ];
		win[ n ] = cur
			? { lo: Math.min( cur.lo, w.lo ), hi: Math.max( cur.hi, w.hi ) }
			: { lo: w.lo, hi: w.hi };
	};

	let looms = [];
	if ( relane ) {
		// The first pass decided who belongs together; a re-lane pass only
		// puts the members back in their lanes after the repulsion moved
		// them, so membership is read off the plans rather than re-derived —
		// the whole pair search is skipped.
		const byLoom = {};
		rows.forEach( ( r, i ) => {
			const loom = r.p.plan.loomId;
			if ( loom !== null && loom !== undefined ) {
				( byLoom[ loom ] = byLoom[ loom ] || [] ).push( i );
			}
		} );
		looms = Object.values( byLoom ).filter( ( g ) => g.length > 1 );

		// The windows still have to be measured: the loom's axis, the lane
		// readings, and the pitch-holding all take them, and with none the
		// hold treats the whole curve — peel-offs to the ports included — as
		// shared run, and answers end-proximity with a mid-curve lever: an S.
		// Only within-loom pairs are scanned, so this stays cheap.
		looms.forEach( ( group ) => {
			const limit = reach * EDGE_KEEP;
			for ( let a = 0; a < group.length; a++ ) {
				for ( let b = a + 1; b < group.length; b++ ) {
					const i = group[ a ];
					const j = group[ b ];
					if ( boxGap( rows[ i ], rows[ j ] ) > limit ) {
						continue;
					}
					widen( i, shared( rows[ i ], rows[ j ], limit ) );
					widen( j, shared( rows[ j ], rows[ i ], limit ) );
				}
			}
		} );
	} else {
		const pairKey = ( i, j ) => {
			const a = rows[ i ].p.id;
			const b = rows[ j ].p.id;
			return a < b ? `${ a }|${ b }` : `${ b }|${ a }`;
		};

		const linked = rows.map( () => [] );
		for ( let i = 0; i < rows.length; i++ ) {
			for ( let j = i + 1; j < rows.length; j++ ) {
				if ( rows[ i ].p.plan.straight && rows[ j ].p.plan.straight ) {
					continue;
				}
				// A pair bundled last frame holds its loom at widened gates.
				const held = sticky && sticky.has( pairKey( i, j ) );
				const reachHere = held ? reach * EDGE_KEEP : reach;
				if ( boxGap( rows[ i ], rows[ j ] ) > reachHere ) {
					continue;
				}
				const si = shared( rows[ i ], rows[ j ], reachHere );
				const sj = shared( rows[ j ], rows[ i ], reachHere );
				const need = held ? EDGE_OVERLAP / EDGE_KEEP : EDGE_OVERLAP;
				if ( si.frac < need && sj.frac < need ) {
					continue;
				}
				const gatherHere = held ? gather * EDGE_KEEP : gather;
				if ( Math.min( si.minD, sj.minD ) > gatherHere ) {
					continue;
				}
				widen( i, si );
				widen( j, sj );
				linked[ i ].push( j );
				linked[ j ].push( i );
			}
		}

		const seen = new Array( rows.length ).fill( false );
		rows.forEach( ( _, i ) => {
			if ( seen[ i ] || ! linked[ i ].length ) {
				return;
			}
			const stack = [ i ];
			const group = [];
			seen[ i ] = true;
			while ( stack.length ) {
				const n = stack.pop();
				group.push( n );
				linked[ n ].forEach( ( m ) => {
					if ( ! seen[ m ] ) {
						seen[ m ] = true;
						stack.push( m );
					}
				} );
			}
			if ( group.length > 1 ) {
				looms.push( group );
			}
		} );
	}

	// Recorded so the repulsion that follows can treat a bundle as one thing.
	rows.forEach( ( r ) => {
		r.p.plan.loomId = null;
	} );
	looms.forEach( ( group, n ) => {
		group.forEach( ( i ) => {
			rows[ i ].p.plan.loomId = n;
		} );
	} );
	if ( ! looms.length ) {
		return;
	}

	const lever = ( row ) => {
		const plan = row.p.plan;
		if ( ! plan.waypoints.length ) {
			plan.waypoints = [
				{
					x: ( plan.sourceStub.x + plan.targetStub.x ) / 2,
					y: ( plan.sourceStub.y + plan.targetStub.y ) / 2,
				},
			];
		}
		return plan.waypoints[ 0 ];
	};

	// Every lever move is recorded as well as applied: `controlFor` rebuilds
	// a plan's control point whenever a port moves, and only what is in
	// `leverShift` survives the rebuild (`edge-plan.js`).
	//
	// And bounded, in the edge's own frame rather than the loom's — see
	// `LEVER_ACROSS` / `LEVER_ALONG`. The cap is on the accumulated shift, not
	// on the step: the lane and relaxation passes each move a little and run
	// several times over, so a per-step limit bounds nothing.
	const shiftLever = ( row, dx, dy ) => {
		const c = lever( row );
		const plan = row.p.plan;
		const s = plan.leverShift || ( plan.leverShift = { x: 0, y: 0 } );
		// Where the plan itself put the lever, which is what the bounds are
		// measured from.
		const home = { x: c.x - s.x, y: c.y - s.y };

		const axis = heading( plan.sourceStub, plan.targetStub );
		let x = s.x + dx;
		let y = s.y + dy;
		if ( axis ) {
			const across = Math.max( LEVER_FLOOR, LEVER_ACROSS * axis.length );
			const along = LEVER_ALONG * axis.length;
			// Split into the two components, clamp each, and put it back
			// together — clamping the magnitude alone would let a shift that is
			// entirely the wrong way through at full strength.
			const u = x * axis.x + y * axis.y;
			const v = x * -axis.y + y * axis.x;
			const cu = clamp( u, -along, along );
			const cv = clamp( v, -across, across );
			x = cu * axis.x - cv * axis.y;
			y = cu * axis.y + cv * axis.x;
		}

		s.x = x;
		s.y = y;
		c.x = home.x + x;
		c.y = home.y + y;
	};

	// The guard's measurement, one pair at a time. A global minimum would be
	// vacuous the moment any two edges cross anywhere (a crossing is a gap of
	// zero); per pair, a crossing only excuses that pair. Nothing under the
	// pitch matters, so a pair's scan stops the moment it finds a crossing,
	// and pairs whose bounding boxes already clear the pitch are never
	// scanned at all — an unmeasured pair's floor is the pitch itself.
	// Capped: only values below `cap` matter to any caller, so the running
	// minimum starts there — which lets the per-point bound skip most of the
	// scan — and "nothing below the cap" comes back as the cap itself.
	const pairGap = ( a, b, cap ) => {
		let min = cap;
		const pa = rows[ a ].pts;
		const pb = rows[ b ].pts;
		const box = rows[ b ].box;
		for ( let i = 0; i < pa.length; i++ ) {
			if ( boxDist( pa[ i ], box ) >= min ) {
				continue;
			}
			for ( let j = 1; j < pb.length; j++ ) {
				const d = pointToSegment( pa[ i ], pb[ j - 1 ], pb[ j ] ).dist;
				if ( d < min ) {
					min = d;
					if ( min <= 0.01 ) {
						return min;
					}
				}
			}
		}
		return min;
	};
	const baseline = {};
	for ( let i = 0; i < rows.length; i++ ) {
		for ( let j = i + 1; j < rows.length; j++ ) {
			if ( boxGap( rows[ i ], rows[ j ] ) < pitch ) {
				baseline[ `${ i }|${ j }` ] = pairGap( i, j, pitch );
			}
		}
	}
	// Ports, levers, and the accumulated lane shift: the shuffle moves ports
	// and the lane passes accumulate `leverShift`, so a snapshot of levers
	// alone would give a partial rollback.
	const origin = rows.map( ( r ) => {
		const plan = r.p.plan;
		const w = plan.waypoints[ 0 ];
		const s = plan.leverShift;
		return {
			lever: w ? { x: w.x, y: w.y } : null,
			shift: s ? { x: s.x, y: s.y } : null,
			source: { x: plan.source.x, y: plan.source.y },
			target: { x: plan.target.x, y: plan.target.y },
		};
	} );

	looms.forEach( ( group ) => {
		// One axis for the whole loom, from the mean heading of its members;
		// members running the other way are flipped into agreement so they do
		// not cancel.
		let ax = 0;
		let ay = 0;
		group.forEach( ( n ) => {
			const w = win[ n ];
			const tan = rows[ n ].tan;
			const at = w
				? Math.round( ( w.lo + w.hi ) / 2 )
				: Math.floor( tan.length / 2 );
			const t = tan[ clamp( at, 0, tan.length - 1 ) ];
			if ( ! t ) {
				return;
			}
			const flip = t.x * ax + t.y * ay < 0 ? -1 : 1;
			ax += t.x * flip;
			ay += t.y * flip;
		} );
		const m = Math.hypot( ax, ay );
		if ( m < 0.01 ) {
			return;
		}
		const perp = { x: -ay / m, y: ax / m };

		// Each member measured at the centre of its own shared stretch, which
		// is the part the loom is holding. The ends belong to the ports.
		const midOf = ( n ) => {
			const w = win[ n ];
			const pts = rows[ n ].pts;
			const i = w
				? Math.round( ( w.lo + w.hi ) / 2 )
				: Math.floor( pts.length / 2 );
			return pts[ clamp( i, 0, pts.length - 1 ) ];
		};
		let cx = 0;
		let cy = 0;
		group.forEach( ( n ) => {
			const p = midOf( n );
			cx += p.x;
			cy += p.y;
		} );
		cx /= group.length;
		cy /= group.length;
		const across = ( n ) => {
			const p = midOf( n );
			return ( p.x - cx ) * perp.x + ( p.y - cy ) * perp.y;
		};

		// Lanes in port order: deeper edge outboard. Ordering by where the
		// members currently lie would keep whatever the middle of the run
		// happens to look like — and the middle is precisely where a deeper
		// edge detouring around a nearer one re-crosses it.
		const along = { x: ax / m, y: ay / m };
		const travel = ( n ) => {
			const plan = rows[ n ].p.plan;
			return Math.abs(
				( plan.target.x - plan.source.x ) * along.x +
					( plan.target.y - plan.source.y ) * along.y
			);
		};
		const order = group
			.map( ( n ) => ( {
				n,
				v: across( n ),
				key: ( Math.sign( across( n ) ) || 1 ) * travel( n ),
			} ) )
			.sort( ( a, b ) => a.key - b.key || a.v - b.v );
		const width = pitch * ( order.length - 1 );
		const mean = order.reduce( ( sum, e ) => sum + e.v, 0 ) / order.length;
		order.forEach( ( e, slot ) => {
			e.want = mean - width / 2 + slot * pitch;
		} );

		// A straightened edge keeps its lane and the loom forms around it.
		const anchored = order.filter( ( e ) => rows[ e.n ].p.plan.straight );
		if ( anchored.length ) {
			const shift =
				anchored.reduce( ( sum, e ) => sum + ( e.v - e.want ), 0 ) /
				anchored.length;
			order.forEach( ( e ) => {
				e.want += shift;
			} );
		}

		// Moving a lever moves the curve by rather less, so the correction is
		// applied, measured again, and applied again — every member corrected
		// from the same reading before any of them moves.
		for ( let pass = 0; pass < 4; pass++ ) {
			const errs = order.map( ( e ) => e.want - across( e.n ) );
			let worst = 0;
			errs.forEach( ( v ) => {
				worst = Math.max( worst, Math.abs( v ) );
			} );
			if ( worst < 0.3 ) {
				break;
			}
			order.forEach( ( e, idx ) => {
				if ( rows[ e.n ].p.plan.straight ) {
					return;
				}
				// Gently: the lever's corrections persist now (`leverShift`),
				// so an aggressive gain rings — over-correct, over-correct
				// back — and under a drag that ringing reads as flicker. The
				// loop converges across its passes instead.
				const step = clamp(
					errs[ idx ] * 1.2,
					-width - pitch,
					width + pitch
				);
				shiftLever( rows[ e.n ], perp.x * step, perp.y * step );
			} );
			order.forEach( ( e ) => retrace( rows[ e.n ] ) );
		}

		// The ports adopt the bundle's order — a permutation of the slots the
		// clustering already chose, kept only if it strictly reduces
		// crossings among the loom's members. A tie is not a win: the
		// existing order was chosen for good reason (deeper edge outboard)
		// and keeps the benefit of the doubt.
		//
		// A straightened edge sits out: its two ports were put on one line by
		// `spreadPorts` precisely so the short run between two close stages
		// draws dead straight, and a permutation moves one end without the
		// other. It neither offers its slot nor takes anyone else's — which is
		// what the anchoring above already assumes.
		const shuffle = () => {
			const groups = {};
			order.forEach( ( e, lane ) => {
				const p = rows[ e.n ].p;
				const plan = p.plan;
				if ( plan.straight ) {
					return;
				}
				[
					[ 'source', 0 ],
					[ 'target', 1 ],
				].forEach( ( [ role, idx ] ) => {
					const rect = p.own && p.own[ idx ];
					if ( ! rect ) {
						return;
					}
					const face =
						role === 'source' ? plan.sourcePos : plan.targetPos;
					const key = `${ Math.round( rect.x ) },${ Math.round(
						rect.y
					) }:${ face }`;
					if ( ! groups[ key ] ) {
						groups[ key ] = { face, items: [] };
					}
					groups[ key ].items.push( { lane, role, plan } );
				} );
			} );

			let moved = false;
			Object.keys( groups ).forEach( ( key ) => {
				const g = groups[ key ];
				if ( g.items.length < 2 ) {
					return;
				}
				const horiz =
					g.face === Position.Top || g.face === Position.Bottom;
				const axis = horiz ? 'x' : 'y';
				// Which way along this border the lane order runs.
				const sense = ( horiz ? perp.x : perp.y ) >= 0 ? 1 : -1;
				const port = ( it ) =>
					it.role === 'source' ? it.plan.source : it.plan.target;
				const slots = g.items
					.map( ( it ) => port( it )[ axis ] )
					.sort( ( a, b ) => a - b );
				const wanted = g.items
					.slice()
					.sort( ( a, b ) => sense * ( a.lane - b.lane ) );
				wanted.forEach( ( it, i ) => {
					const pt = port( it );
					if ( Math.abs( pt[ axis ] - slots[ i ] ) > 0.01 ) {
						moved = true;
					}
					pt[ axis ] = slots[ i ];
				} );
			} );
			if ( ! moved ) {
				return;
			}
			order.forEach( ( e ) => refresh( rows[ e.n ] ) );
		};

		// Counted on every-other-sample polylines: a crossing between two
		// curves in a loom is not a sub-sample event, and the count is only a
		// tie-break for the shuffle — half resolution answers it at a quarter
		// of the cost. The endpoint is kept so no crossing near a port slips
		// between the last two samples.
		const tangles = () => {
			const coarse = ( i ) => {
				const pts = rows[ i ].pts;
				const out = [];
				for ( let k = 0; k < pts.length; k += 2 ) {
					out.push( pts[ k ] );
				}
				if ( pts.length % 2 === 0 ) {
					out.push( pts[ pts.length - 1 ] );
				}
				return out;
			};
			const sampled = group.map( coarse );
			let n = 0;
			for ( let a = 0; a < group.length; a++ ) {
				for ( let b = a + 1; b < group.length; b++ ) {
					if ( polylinesCross( sampled[ a ], sampled[ b ] ) ) {
						n++;
					}
				}
			}
			return n;
		};
		const tangledBefore = tangles();
		const portsBefore = group.map( ( n ) => {
			const plan = rows[ n ].p.plan;
			return {
				s: { x: plan.source.x, y: plan.source.y },
				t: { x: plan.target.x, y: plan.target.y },
			};
		} );

		shuffle();

		if ( tangles() >= tangledBefore ) {
			group.forEach( ( n, idx ) => {
				const plan = rows[ n ].p.plan;
				plan.source.x = portsBefore[ idx ].s.x;
				plan.source.y = portsBefore[ idx ].s.y;
				plan.target.x = portsBefore[ idx ].t.x;
				plan.target.y = portsBefore[ idx ].t.y;
				refresh( rows[ n ] );
			} );
		}

		// The ports close to the bundle's pitch as well as the middles. Port
		// clustering sets the spacing an edge gets among unrelated
		// neighbours; a bundle overrides it for its own members, because they
		// are no longer unrelated.
		//
		// A straightened edge is left out, as in the shuffle: repacking moves
		// one of its ends and the run stops being straight. Left out of
		// `member` too, so it counts as a stranger to the clash test below and
		// the packing refuses to close over it rather than through it.
		const closePorts = () => {
			const faceKey = ( rect, face ) =>
				`${ Math.round( rect.x ) },${ Math.round( rect.y ) }:${ face }`;
			const faces = {};
			order.forEach( ( e ) => {
				const p = rows[ e.n ].p;
				const plan = p.plan;
				if ( plan.straight ) {
					return;
				}
				[
					[ 'source', 0 ],
					[ 'target', 1 ],
				].forEach( ( [ role, idx ] ) => {
					const rect = p.own && p.own[ idx ];
					if ( ! rect ) {
						return;
					}
					const face =
						role === 'source' ? plan.sourcePos : plan.targetPos;
					const key = faceKey( rect, face );
					if ( ! faces[ key ] ) {
						faces[ key ] = {
							rect,
							face,
							items: [],
							member: new Set(),
						};
					}
					faces[ key ].items.push( { role, plan } );
					faces[ key ].member.add( `${ p.id }:${ role }` );
				} );
			} );

			let moved = false;
			Object.keys( faces ).forEach( ( key ) => {
				const g = faces[ key ];
				if ( g.items.length < 2 ) {
					return;
				}
				const horiz =
					g.face === Position.Top || g.face === Position.Bottom;
				const axis = horiz ? 'x' : 'y';
				const lo = ( horiz ? g.rect.x : g.rect.y ) + BORDER_INSET;
				const hi =
					( horiz
						? g.rect.x + g.rect.width
						: g.rect.y + g.rect.height ) - BORDER_INSET;
				if ( hi <= lo ) {
					return;
				}
				const port = ( it ) =>
					it.role === 'source' ? it.plan.source : it.plan.target;

				// Kept in the order they already sit in, so closing them up
				// cannot introduce a crossing, and centred on where they
				// already are.
				const sorted = g.items
					.slice()
					.sort( ( a, b ) => port( a )[ axis ] - port( b )[ axis ] );
				const centre =
					sorted.reduce(
						( sum, it ) => sum + port( it )[ axis ],
						0
					) / sorted.length;
				const span = pitch * ( sorted.length - 1 );
				const from = clamp(
					centre - span / 2,
					lo,
					Math.max( lo, hi - span )
				);

				// Ports on this face belonging to edges outside the loom. The
				// spread pass holds everything a full spread apart; packing
				// the loom's own ports to the lane pitch must not close on a
				// stranger sitting among them. If one would end up inside the
				// packed run, this face keeps the spread spacing — uneven
				// bundle ends are a smaller fault than two ports drawn on top
				// of each other.
				const clash = plans.some( ( q ) => {
					const qp = q.plan;
					return [
						[ 'source', 0 ],
						[ 'target', 1 ],
					].some( ( [ role, idx ] ) => {
						const rect = q.own && q.own[ idx ];
						if ( ! rect || g.member.has( `${ q.id }:${ role }` ) ) {
							return false;
						}
						const face =
							role === 'source' ? qp.sourcePos : qp.targetPos;
						if ( faceKey( rect, face ) !== key ) {
							return false;
						}
						const at = (
							role === 'source' ? qp.source : qp.target
						)[ axis ];
						return (
							at > from - PORT_SPREAD + 0.01 &&
							at < from + span + PORT_SPREAD - 0.01
						);
					} );
				} );
				if ( clash ) {
					return;
				}

				sorted.forEach( ( it, i ) => {
					const pt = port( it );
					const want = from + i * pitch;
					if ( Math.abs( pt[ axis ] - want ) > 0.01 ) {
						moved = true;
					}
					pt[ axis ] = want;
				} );
			} );
			if ( ! moved ) {
				return;
			}
			order.forEach( ( e ) => refresh( rows[ e.n ] ) );
		};
		closePorts();

		// Lanes set the order and the pitch at one point; this holds the
		// pitch everywhere else in the shared run. Outside the window nothing
		// is touched, so the members still fan out to their own ports.
		// Adjacent lanes only: any pair further apart in the lane order has a
		// lane between them, and holding every neighbouring gap holds theirs
		// — measuring all pairs would cost the square of the loom for nothing.
		for ( let pass = 0; pass < 3; pass++ ) {
			const nudge = order.map( () => ( { x: 0, y: 0, n: 0 } ) );
			let worst = 0;

			for ( let a = 0; a < order.length - 1; a++ ) {
				{
					const b = a + 1;
					const ra = rows[ order[ a ].n ];
					const rb = rows[ order[ b ].n ];
					const wa = win[ order[ a ].n ];
					const lo = wa ? wa.lo : 0;
					const hi = wa ? wa.hi : ra.pts.length - 1;
					// Both curves clipped to their shared windows: a pinch at
					// a peel-off near the ports is the port spacing's
					// business, and answering it with the mid-curve lever is
					// exactly the bulge — the middle balloons while the pinch
					// it was correcting barely moves.
					const wb = win[ order[ b ].n ];
					const bLo = Math.max( 1, wb ? wb.lo : 1 );
					const bHi = Math.min(
						rb.pts.length - 1,
						wb ? wb.hi : rb.pts.length - 1
					);
					let dist = 1e9;
					let pa = null;
					let pb = null;
					for ( let i = lo; i <= hi && i < ra.pts.length; i += 2 ) {
						for ( let j = bLo; j <= bHi; j++ ) {
							const d = pointToSegment(
								ra.pts[ i ],
								rb.pts[ j - 1 ],
								rb.pts[ j ]
							);
							if ( d.dist < dist ) {
								dist = d.dist;
								pa = ra.pts[ i ];
								pb = {
									x:
										rb.pts[ j - 1 ].x +
										( rb.pts[ j ].x - rb.pts[ j - 1 ].x ) *
											d.t,
									y:
										rb.pts[ j - 1 ].y +
										( rb.pts[ j ].y - rb.pts[ j - 1 ].y ) *
											d.t,
								};
							}
						}
					}
					const short = pitch - dist;
					if ( short <= 0.4 || ! pa ) {
						continue;
					}
					// A gap of nothing is a crossing, not a squeeze. Pushing
					// a crossing pair apart cannot fix it — the crossing
					// point stays at zero — so the loop would apply its
					// maximum correction every pass and inflate both curves
					// symmetrically while changing nothing. Leave it for the
					// port shuffle, which is the pass that can uncross.
					if ( dist < 1 ) {
						continue;
					}
					worst = Math.max( worst, short );

					let ux = pa.x - pb.x;
					let uy = pa.y - pb.y;
					const mm = Math.sqrt( ux * ux + uy * uy );
					if ( mm < 0.01 ) {
						ux = perp.x;
						uy = perp.y;
					} else {
						ux /= mm;
						uy /= mm;
					}

					// A straight edge is an anchor: it takes none of the
					// correction, and its partner takes all of it.
					const sa = ra.p.plan.straight;
					const sb = rb.p.plan.straight;
					let wA = 0.5;
					let wB = 0.5;
					if ( sa ) {
						wA = 0;
						wB = sb ? 0 : 1;
					} else if ( sb ) {
						wB = 0;
						wA = 1;
					}
					if ( wA ) {
						nudge[ a ].x += ux * short * wA;
						nudge[ a ].y += uy * short * wA;
						nudge[ a ].n++;
					}
					if ( wB ) {
						nudge[ b ].x -= ux * short * wB;
						nudge[ b ].y -= uy * short * wB;
						nudge[ b ].n++;
					}
				}
			}
			if ( ! worst ) {
				break;
			}

			order.forEach( ( e, idx ) => {
				if ( ! nudge[ idx ].n || rows[ e.n ].p.plan.straight ) {
					return;
				}
				shiftLever(
					rows[ e.n ],
					( nudge[ idx ].x / nudge[ idx ].n ) * 1.2,
					( nudge[ idx ].y / nudge[ idx ].n ) * 1.2
				);
			} );
			group.forEach( ( n ) => retrace( rows[ n ] ) );
		}
	} );

	// Better or unchanged, or that loom did not happen. Gathering lowers a
	// pair's gap on purpose, so each pair is allowed down to the pitch it was
	// asked to hold (or its own baseline, where that was already tighter),
	// less the slack the relaxation converges within — and a violation rolls
	// back only the looms it implicates. Pairs of unbundled edges never
	// moved, so only pairs touching a loom are looked at.
	const marked = new Set();
	for ( let i = 0; i < rows.length; i++ ) {
		for ( let j = i + 1; j < rows.length; j++ ) {
			const la = rows[ i ].p.plan.loomId;
			const lb = rows[ j ].p.plan.loomId;
			if ( la === null && lb === null ) {
				continue;
			}
			if ( boxGap( rows[ i ], rows[ j ] ) >= pitch ) {
				continue;
			}
			const key = `${ i }|${ j }`;
			const floor =
				Math.min(
					baseline[ key ] !== undefined ? baseline[ key ] : pitch,
					pitch
				) - EDGE_GUARD_SLACK;
			if ( floor > 0 && pairGap( i, j, floor ) < floor ) {
				if ( la !== null ) {
					marked.add( la );
				}
				if ( lb !== null ) {
					marked.add( lb );
				}
			}
		}
	}
	if ( marked.size ) {
		looms.forEach( ( group, n ) => {
			if ( ! marked.has( n ) ) {
				return;
			}
			group.forEach( ( idx ) => {
				const plan = rows[ idx ].p.plan;
				const was = origin[ idx ];
				plan.source.x = was.source.x;
				plan.source.y = was.source.y;
				plan.target.x = was.target.x;
				plan.target.y = was.target.y;
				plan.leverShift = was.shift
					? { x: was.shift.x, y: was.shift.y }
					: null;
				if ( ! was.lever ) {
					if ( plan.waypoints.length ) {
						plan.waypoints = [];
					}
				} else if ( plan.waypoints[ 0 ] ) {
					plan.waypoints[ 0 ].x = was.lever.x;
					plan.waypoints[ 0 ].y = was.lever.y;
				}
				const stubs = portStubs(
					plan.source,
					plan.sourcePos,
					plan.target,
					plan.targetPos
				);
				plan.sourceStub = stubs.source;
				plan.targetStub = stubs.target;
				// The lanes are undone; membership is not. The members still
				// co-travel, so they keep their loom for the repulsion pass
				// (an even mean push, not per-edge shoves) and stay sticky
				// for next frame — a rollback that also dissolved the loom
				// made the pair flip between two looks on alternate frames.
			} );
		} );
	}
}

/**
 * Stages push bundles aside, not individual threads.
 *
 * The force is computed once per bundle, from the mean of what its threads
 * each feel — not the sum; a bundle of four should not be shoved four times as
 * far as a single edge on the same route — and left on each plan as
 * `loomPush` for `controlFor` to apply. An unbundled edge is a bundle of one
 * and behaves exactly as before.
 *
 * A straightened edge is an anchor here too: it neither takes the push nor
 * counts toward it. It is short, it runs between its own two stages, and a
 * shared push would bow the one line the straightening exists to keep flat.
 *
 * @param {Array} plans Planned edges (`plan`, `obstacles`).
 */
export function repelGroups( plans ) {
	const groups = {};
	plans.forEach( ( p, n ) => {
		const key =
			p.plan.loomId === null || p.plan.loomId === undefined
				? `solo${ n }`
				: `loom${ p.plan.loomId }`;
		( groups[ key ] = groups[ key ] || [] ).push( p );
	} );

	Object.keys( groups ).forEach( ( key ) => {
		const members = groups[ key ];
		const pushed = members.filter( ( p ) => ! p.plan.straight );
		members.forEach( ( p ) => {
			if ( p.plan.straight ) {
				p.plan.loomPush = null;
			}
		} );
		if ( pushed.length < 2 ) {
			pushed.forEach( ( p ) => {
				p.plan.loomPush = null;
			} );
			return;
		}

		let x = 0;
		let y = 0;
		let n = 0;
		pushed.forEach( ( p ) => {
			const push = repulsion(
				p.plan.sourceStub,
				p.plan.targetStub,
				p.obstacles
			);
			if ( ! push ) {
				return;
			}
			x += push.x;
			y += push.y;
			n++;
		} );
		const mean = n ? { x: x / pushed.length, y: y / pushed.length } : null;
		pushed.forEach( ( p ) => {
			p.plan.loomPush = mean;
		} );
	} );
}
