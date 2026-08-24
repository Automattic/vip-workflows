/**
 * Easing the jumps in a port's position — and in a curve's control point.
 *
 * A port doesn't drift — it either follows its stage continuously, or it
 * relocates: the search moves it to another border, or the clustering gathers
 * it into a group. Only the second kind needs smoothing, and easing the path
 * `d` cannot tell them apart — it eases the tracking too, so the line trails
 * the stage under the pointer.
 *
 * So the discontinuity is measured rather than assumed, as a position around
 * the node's perimeter in the node's own frame — never in canvas coordinates.
 * Held as an absolute point, a port keeps its old position on screen while the
 * stage moves out from under it, and a fast drag tears the end of the edge off
 * the card; in the node's frame its own travel isn't movement at all, so it
 * can neither trigger the easing nor be undone by it.
 *
 * A port that moved further in one frame than it could have by tracking is
 * treated as having jumped: the size of the jump is kept as an offset and
 * decayed to nothing over the following frames, so the drawing starts where
 * the port used to be and arrives where it now is. Anything smaller is
 * followed exactly, which is why a drag stays 1:1. And because the parameter
 * runs continuously around the whole boundary rather than per face, a move to
 * another border is the same kind of move as any other: the port slides
 * around the corner, at the same speed, with the stub swinging to whichever
 * side it is on at the time.
 *
 * The control point gets the same treatment (`smoothLevers`), in its own
 * frame: measured relative to the midpoint of the stubs, so an edge whose
 * stage is being dragged tracks 1:1 — the lever travels with the stubs — and
 * only a *decision* registers as a jump: a loom forming or dissolving around
 * the edge, a rollback, the repulsion of a passing card switching on. Those
 * are exactly the one-frame reshapes that read as flicker, because the CSS
 * `d` transition that eases relayout is deliberately off during drags.
 *
 * @package
 */

import { clamp, loopDelta, perimeterAt, perimeterOf } from './edge-geometry';
import { refreshPlan } from './edge-plan';

/** A frame-to-frame move larger than this, in boundary px, is a jump. */
const JUMP = 6;

/** How long a jump takes to ease away, in ms. */
const EASE_MS = 220;

/**
 * Ease the jumps out of every plan's ports. Mutates the plans in place.
 *
 * @param {Array}  plans  Planned edges (`id`, `plan`, `own`, `obstacles`).
 * @param {Object} memory Persistent per-edge easing state, owned by the
 *                        caller and carried between frames.
 * @param {number} now    Current time in ms.
 * @return {boolean} Whether any easing is still in flight — the caller should
 *                   schedule another frame while true.
 */
export function smoothPorts( plans, memory, now ) {
	let animating = false;

	plans.forEach( ( p ) => {
		const mem = memory[ p.id ] || ( memory[ p.id ] = {} );

		[ 'source', 'target' ].forEach( ( role, n ) => {
			const pt = p.plan[ role ];
			const side =
				role === 'source' ? p.plan.sourcePos : p.plan.targetPos;
			const rect = p.own && p.own[ n ];
			if ( ! rect ) {
				return;
			}

			const perimeter = 2 * ( rect.width + rect.height );
			const u = perimeterOf( rect, pt, side );
			let off = mem[ role + 'Off' ];
			const prev = mem[ role ];

			if ( prev !== undefined ) {
				const moved = loopDelta( prev, u );
				if ( Math.abs( moved ) * perimeter > JUMP ) {
					// A jump landing while an earlier ease is still in flight
					// carries over only the part of that ease not yet played
					// out. Carrying the full original offset would draw the
					// port back where the first jump started — a visible snap
					// backwards — instead of continuing from where it is.
					let residual = 0;
					if ( off ) {
						const gone = clamp( ( now - off.t ) / EASE_MS, 0, 1 );
						residual = off.v * Math.pow( 1 - gone, 3 );
					}
					off = { v: residual - moved, t: now };
				}
				mem[ role + 'Off' ] = off;
			}
			mem[ role ] = u;

			if ( off ) {
				const e = clamp( ( now - off.t ) / EASE_MS, 0, 1 );
				const eased = 1 - Math.pow( 1 - e, 3 );
				const drawn = perimeterAt( rect, u + off.v * ( 1 - eased ) );
				pt.x = drawn.x;
				pt.y = drawn.y;
				if ( role === 'source' ) {
					p.plan.sourcePos = drawn.side;
				} else {
					p.plan.targetPos = drawn.side;
				}
				if ( e >= 1 ) {
					delete mem[ role + 'Off' ];
				} else {
					animating = true;
				}
			}
		} );
	} );

	// The ports moved, so the stubs and the routes between them are stale.
	plans.forEach( refreshPlan );

	return animating;
}

/** A frame-to-frame lever move larger than this, in stub-frame px, is a jump. */
const LEVER_JUMP = 8;

/**
 * Ease the jumps out of every plan's control point. Mutates the plans in
 * place; must run after every pass that rebuilds waypoints (including
 * `smoothPorts`, whose refresh would overwrite the eased position).
 *
 * @param {Array}  plans  Planned edges (`id`, `plan`).
 * @param {Object} memory Persistent per-edge easing state, owned by the
 *                        caller and carried between frames.
 * @param {number} now    Current time in ms.
 * @return {boolean} Whether any easing is still in flight.
 */
export function smoothLevers( plans, memory, now ) {
	let animating = false;

	plans.forEach( ( p ) => {
		const mem = memory[ p.id ] || ( memory[ p.id ] = {} );
		const plan = p.plan;

		// The lever in the stubs' own frame. An edge with no control point
		// rests at the stub midpoint — which is where `bundleEdges` puts a
		// lever when it first needs one, so the two states meet exactly.
		const rest = {
			x: ( plan.sourceStub.x + plan.targetStub.x ) / 2,
			y: ( plan.sourceStub.y + plan.targetStub.y ) / 2,
		};
		const cur = plan.waypoints[ 0 ] || rest;
		const rel = { x: cur.x - rest.x, y: cur.y - rest.y };
		const prev = mem.lever;
		let off = mem.leverOff;

		if ( prev ) {
			const dx = rel.x - prev.x;
			const dy = rel.y - prev.y;
			if ( Math.sqrt( dx * dx + dy * dy ) > LEVER_JUMP ) {
				// Only the undecayed residual of an ease still in flight
				// carries over — same rule as the ports.
				let rx = 0;
				let ry = 0;
				if ( off ) {
					const gone = clamp( ( now - off.t ) / EASE_MS, 0, 1 );
					const k = Math.pow( 1 - gone, 3 );
					rx = off.x * k;
					ry = off.y * k;
				}
				off = { x: rx - dx, y: ry - dy, t: now };
			}
			mem.leverOff = off;
		}
		mem.lever = rel;

		if ( off ) {
			const e = clamp( ( now - off.t ) / EASE_MS, 0, 1 );
			const k = Math.pow( 1 - e, 3 );
			if ( e >= 1 ) {
				delete mem.leverOff;
			} else {
				animating = true;
				const drawn = {
					x: cur.x + off.x * k,
					y: cur.y + off.y * k,
				};
				if ( plan.waypoints[ 0 ] ) {
					plan.waypoints[ 0 ].x = drawn.x;
					plan.waypoints[ 0 ].y = drawn.y;
				} else {
					plan.waypoints = [ drawn ];
				}
			}
		}
	} );

	return animating;
}
