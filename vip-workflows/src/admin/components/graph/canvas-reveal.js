/**
 * canvas-reveal — bringing a named thing on the canvas into view.
 *
 * The blocked-save notice offers to *show* the fault it names ("Show
 * transition"). Selecting it is only half of that: an editor the author has
 * panned, or that opened on a sequence longer than the screen, will happily
 * highlight a stage nobody can see. So a reveal also has to move the canvas —
 * and the two rules below are what it moves by.
 *
 * **What a target frames.** A target is spelled in the editor's selection
 * vocabulary (`{ type: 'node' | 'edge' | 'region', … }`), and every one of the
 * three resolves to nodes React Flow already holds: a stage is its own node, a
 * transition is the run between the two it joins, and a status group is the
 * band node `layout.js` sizes to it — framed by the checkpoint slot that node
 * carries, since that is where a group's faults are fixed. Nothing here
 * measures anything — the caller frames those ids with React Flow's own
 * `getNodesBounds`, so a reveal reads the geometry the canvas actually laid out.
 *
 * **How far it pans.** Per axis, and never by zooming: the zoom is the
 * author's, and a reveal that reset it would answer "where is this" by
 * changing everything else on screen. An axis the target already fits inside
 * does not move at all, which is the common case — the fault is usually right
 * there — and is what keeps the button from jolting a canvas that needed no
 * help. An axis it does not fit inside centres it. An axis it is *too big* for
 * (a transition can run the length of the sequence) aligns the target's anchor
 * instead — the stage a transition leaves — because the middle of something
 * that overflows the viewport shows neither end, and the union's own start is
 * the destination whenever a transition runs back up the flow.
 *
 * @package
 */

import { regionNodeId } from './graph-model';

/**
 * Breathing room kept between a revealed target and the edge of the canvas, in
 * screen pixels. A node flush against the edge is technically in view and reads
 * as half-off it.
 */
export const REVEAL_MARGIN = 24;

/**
 * The nodes a target is shown by.
 *
 * @param {?Object} target A validation error's target.
 * @return {string[]} React Flow node ids, empty when the target names nothing
 *                    the canvas draws.
 */
export function revealNodeIds( target ) {
	switch ( target?.type ) {
		case 'node':
			return [ target.key ];
		// Both ends, the one it leaves first. A transition is the run between
		// two stages, and framing only the one it leaves can put its
		// destination off-screen; the first is what an overflow lands on.
		case 'edge':
			return [ target.from, target.to ];
		// The band is a node of its own, sized to the region by `layout.js`.
		case 'region':
			return [ regionNodeId( target.region ) ];
		default:
			return [];
	}
}

/**
 * Where one axis has to pan to bring a span into view.
 *
 * @param {Object} axis              The axis, in one flow dimension.
 * @param {number} axis.start        Span start, in flow coordinates.
 * @param {number} axis.size         Span length, in flow coordinates.
 * @param {number} axis.offset       Current viewport translation, in px.
 * @param {number} axis.zoom         Current zoom.
 * @param {number} axis.visibleStart Start of the visible strip, in pane px.
 * @param {number} axis.visibleSize  Length of the visible strip, in px.
 * @param {number} axis.margin       Room to keep at either end, in px.
 * @param {number} axis.anchorStart  Where an overflowing span is aligned from,
 *                                   in flow coordinates.
 * @return {?number} The new translation, or null when nothing need move.
 */
function axisPan( {
	start,
	size,
	offset,
	zoom,
	visibleStart,
	visibleSize,
	margin,
	anchorStart,
} ) {
	const screenStart = offset + start * zoom;
	const screenSize = size * zoom;
	const boxStart = visibleStart + margin;
	// A viewport narrower than its own margins still has to answer something,
	// so the box floors at zero rather than going negative and inverting every
	// comparison below.
	const boxSize = Math.max( 0, visibleSize - margin * 2 );

	if (
		screenStart >= boxStart &&
		screenStart + screenSize <= boxStart + boxSize
	) {
		return null;
	}

	if ( screenSize >= boxSize ) {
		return boxStart - anchorStart * zoom;
	}

	return boxStart + ( boxSize - screenSize ) / 2 - start * zoom;
}

/**
 * The viewport that brings a target into view, or null when one already does.
 *
 * @param {?Object} bounds           The target's bounds in flow coordinates,
 *                                   as `getNodesBounds` reports them.
 * @param {Object}  options          Where it is being shown.
 * @param {Object}  options.viewport React Flow's current `{ x, y, zoom }`.
 * @param {Object}  options.visible  The part of the pane the floating panel
 *                                   leaves visible, as `{ x, y, width,
 *                                   height }` in pane pixels.
 * @param {number}  [options.margin] Room to keep at the edges, in px.
 * @param {Object}  [options.anchor] The part of the target an overflowing axis
 *                                   is aligned to, in flow coordinates — the
 *                                   stage a transition leaves. The whole
 *                                   target when absent.
 * @return {?Object} A `{ x, y, zoom }` viewport, or null.
 */
export function revealViewport(
	bounds,
	{ viewport, visible, margin = REVEAL_MARGIN, anchor = bounds }
) {
	if ( ! bounds || ! Number.isFinite( bounds.x + bounds.y ) ) {
		return null;
	}

	const x = axisPan( {
		start: bounds.x,
		size: bounds.width,
		offset: viewport.x,
		zoom: viewport.zoom,
		visibleStart: visible.x,
		visibleSize: visible.width,
		margin,
		anchorStart: anchor.x,
	} );
	const y = axisPan( {
		start: bounds.y,
		size: bounds.height,
		offset: viewport.y,
		zoom: viewport.zoom,
		visibleStart: visible.y,
		visibleSize: visible.height,
		margin,
		anchorStart: anchor.y,
	} );

	if ( x === null && y === null ) {
		return null;
	}

	// One axis at a time: a target that is off the bottom but dead centre
	// horizontally rises without sliding sideways, so the canvas moves as far
	// as the reveal needs and no further.
	return { x: x ?? viewport.x, y: y ?? viewport.y, zoom: viewport.zoom };
}
