/**
 * Where the canvas's exit handles are, and whether a point lands on one.
 *
 * Shared by the two layers that draw on top of the cards and have to reckon
 * with what is underneath them. `EdgeOverlay` asks so it can leave a socket
 * undrawn where the handle already reads as the port; `EdgeAnchors` asks so a
 * grab ring does not plant an invisible disc over the control it covers. Both
 * questions are the same measurement, and it is React Flow's own — read from
 * the store rather than restated from the stylesheet, so the drag grip's pill
 * and an AI stage's three-pill cluster are whatever they actually render as,
 * including after the cluster reorders to follow its edges' ports
 * (`edge-pipeline.js`).
 *
 * @package
 */

import { useMemo } from '@wordpress/element';
import { useStore } from '@xyflow/react';

/**
 * Where every exit handle on the canvas is, in flow coordinates.
 *
 * A string signature, for the same reason `selectEdgeStates` is one: the store
 * hands back a new object every tick, and a joined string lets `useStore` skip
 * the re-render when nothing moved. Each row carries the handle's id — empty
 * for the anonymous drag grip — because the arrowhead rule needs to tell an
 * outcome badge from the grip, and an outcome handle's id is its outcome.
 *
 * @param {Object} state React Flow store state.
 * @return {string} One `nodeId|handleId|x|y|width|height` row per source handle.
 */
export function selectSourceHandles( state ) {
	const rows = [];
	state.nodeLookup.forEach( ( node ) => {
		// Absent until React Flow has measured the node — the same first-paint
		// gap `EdgePlanProvider` skips, and there are no marks to place yet.
		const handles = node.internals.handleBounds?.source;
		if ( ! handles ) {
			return;
		}
		const { x, y } = node.internals.positionAbsolute;
		handles.forEach( ( handle ) => {
			rows.push(
				[
					node.id,
					handle.id || '',
					x + handle.x,
					y + handle.y,
					handle.width,
					handle.height,
				].join( '|' )
			);
		} );
	} );
	return rows.join( '\n' );
}

/**
 * The handle a point falls on, if any.
 *
 * The rect rather than a boolean, because a caller that has to get *out* of the
 * way needs to know how far — see `EdgeAnchors`, which pushes its source ring
 * past the covering handle's far edge.
 *
 * Exported for its tests: the hook can only be exercised against a live React
 * Flow store.
 *
 * @param {?Array}                   rects One node's source-handle rects.
 * @param {{ x: number, y: number }} point The point to test, in flow coords.
 * @return {?Object} The covering rect, or null.
 */
export function handleAt( rects, point ) {
	return (
		( rects || [] ).find(
			( rect ) =>
				point.x >= rect.x &&
				point.x <= rect.x + rect.width &&
				point.y >= rect.y &&
				point.y <= rect.y + rect.height
		) || null
	);
}

/**
 * The measured exit handles, keyed by node, and the hit test over them.
 *
 * `occupied` is scoped to a named node on purpose: a mark that happens to land
 * over some *other* stage's grip is the overlapping-cards case the overlay
 * exists to keep visible, and yielding there would put the swallowed mark back.
 *
 * @return {{ handles: Object, occupied: Function, handleUnder: Function }} The
 *         rects by node id, `( nodeId, point )` → whether that node's own
 *         handles cover it, and the same lookup returning the covering rect.
 */
export function useSourceHandles() {
	const signature = useStore( selectSourceHandles );

	// Keyed on the signature, which is the exact memo key it was designed to be:
	// the string exists so a store tick that moved nothing skips the re-render,
	// and re-parsing it on every render of every consumer — twice per pointer
	// frame, once for each layer that asks — would spend the saving anyway. One
	// object per handle on the canvas, per frame, for an answer that has not
	// changed.
	return useMemo( () => {
		const handles = {};
		signature.split( '\n' ).forEach( ( row ) => {
			if ( ! row ) {
				return;
			}
			const [ nodeId, handleId, x, y, width, height ] = row.split( '|' );
			( handles[ nodeId ] = handles[ nodeId ] || [] ).push( {
				id: handleId || null,
				x: Number( x ),
				y: Number( y ),
				width: Number( width ),
				height: Number( height ),
			} );
		} );

		const handleUnder = ( nodeId, point ) =>
			handleAt( handles[ nodeId ], point );

		return {
			handles,
			handleUnder,
			occupied: ( nodeId, point ) =>
				handleUnder( nodeId, point ) !== null,
		};
	}, [ signature ] );
}
