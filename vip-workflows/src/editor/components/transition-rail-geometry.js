/**
 * The transition rail's drawing, as data.
 *
 * One decorative trunk down the left of the actions column, and a fillet spur
 * and an arrowhead into each transition button. Pure geometry: the component
 * measures the laid-out buttons (`getBoundingClientRect` against the rail
 * container) and hands the midpoints here, so the drawing cannot drift from
 * the things it annotates and this file can be tested against fixtures
 * without a DOM.
 *
 * The marks are the sequence editor's own — the same 1px line, the same open
 * chevron (`EdgeOverlay.js`), the same `MARK_STANDOFF` clearance before a
 * border — so the sidebar and the canvas draw the one graph in one hand.
 *
 * @package
 */

import { MARK_STANDOFF } from '../../admin/components/graph/edge-constants';

/**
 * The rail's tuned constants, one design like `edge-constants.js`.
 */
export const RAIL = {
	/** x of the trunk — under the centre of the 18px stage-mark column. */
	TRUNK_X: 9,
	/** Fillet radius where each spur peels off the trunk. */
	FILLET: 8,
	/** Indent of every button the rail points at, in px. */
	TARGET_INSET: 28,
	/**
	 * Where a spur's arrowhead tip stops: the button border, `MARK_STANDOFF`
	 * short — a gap, not an overlap, exactly as the canvas trims its edges
	 * (`edge-constants.js`).
	 */
	TIP_X: 28 - MARK_STANDOFF,
};

/**
 * The rail's paths for a measured set of rows.
 *
 * Rows are the things the rail points at — transition buttons, agent outcome
 * buttons, or the END pill — each as its vertical midpoint relative to the
 * rail container. The stage mark's centre is where the trunk starts; the mark
 * is painted over it, so the line reads as leaving the dot's edge (the same
 * reason `EdgeOverlay` skips the socket on a node's own source handle).
 *
 * The trunk ends at the last fillet: the final spur's curve is the end of the
 * trunk, so nothing overruns past the last button.
 *
 * @param {Array<{y: number}>} rows     Measured rows, in render order.
 * @param {Object}             opts     Options.
 * @param {number}             opts.top Stage-mark centre y.
 * @return {{lines: string[], heads: Array<{x: number, y: number}>}}
 *         Path data for the lines and the arrowhead positions.
 */
export function railGeometry( rows, { top } = {} ) {
	const geometry = { lines: [], heads: [] };

	if ( ! Array.isArray( rows ) || rows.length === 0 ) {
		return geometry;
	}

	const { TRUNK_X, FILLET, TIP_X } = RAIL;
	const lastElbow = rows[ rows.length - 1 ].y - FILLET;

	geometry.lines.push( `M ${ TRUNK_X },${ top } V ${ lastElbow }` );

	for ( const row of rows ) {
		geometry.lines.push(
			`M ${ TRUNK_X },${ row.y - FILLET } ` +
				`Q ${ TRUNK_X },${ row.y } ${ TRUNK_X + FILLET },${ row.y } ` +
				`H ${ TIP_X }`
		);
		geometry.heads.push( { x: TIP_X, y: row.y } );
	}

	return geometry;
}

/**
 * The arrowhead: an open chevron with its tip on the path's end, stroked at
 * the line's own width with round cap and join — `EdgeOverlay.js`'s ARROW,
 * verbatim.
 */
export const ARROW_PATH = 'M -3.54,-3.54 L 0,0 L -3.54,3.54';
