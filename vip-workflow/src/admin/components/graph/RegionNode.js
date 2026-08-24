/**
 * RegionNode — the flow-space part of a status region.
 *
 * The region itself is not a shape on the canvas: it is a *section* of it,
 * marked by a boundary line running the full width of the viewport with the
 * status label stuck to the left edge. That is drawn in screen space by
 * `RegionBands`, which is where the region's visible identity now lives.
 *
 * What is left here is the one part of a region that has to be in flow space,
 * because it is measured in stage footprints and has to scale and travel with
 * the graph: the **entry checkpoint slot** — a stage-sized outline straddling
 * the band's top border. The checkpoint has no marker of its own; the stage that
 * holds it is docked in that slot by `layout.js`, so what sits on the boundary
 * is the stage a post entering the status lands at. The outline is only visible
 * with the slot empty, or while a stage is being dragged and could fill it; the
 * rest of the time the stage covers it.
 *
 * The node otherwise draws nothing and takes no pointer events (see the inline
 * `pointerEvents: 'none'` in `layout.js`): it spans the whole band, and a box
 * that size would leave nowhere to pan from and no empty pane to clear the
 * selection with. It still carries the band rectangle, which is what makes the
 * region a drop target — the canvas decides that geometrically, from the
 * rectangles `layout.js` computed, not from pointer events.
 *
 * @package
 */

import { memo } from '@wordpress/element';
import { Icon } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { login } from '@wordpress/icons';

function RegionNodeComponent( { data } ) {
	const { region, hasEntry, isSlotTarget, isDragging, slotX, slotY } = data;

	// The slot shows when there's nothing in it, and while a drag is in flight
	// so there's something to aim at — including when the stage in flight is the
	// one that was filling it.
	const showSlot = ! hasEntry || isDragging;

	return (
		<div
			className={ [ 'wf-region', ! hasEntry && 'is-unset' ]
				.filter( Boolean )
				.join( ' ' ) }
			data-region={ region }
		>
			{ showSlot && (
				<div
					className={ [
						'wf-region__slot',
						isSlotTarget && 'is-target',
					]
						.filter( Boolean )
						.join( ' ' ) }
					// Placed from the band rather than centred by the
					// stylesheet: once the checkpoint has been dragged along
					// the border the slot goes with it, and the outline has to
					// be the same rectangle `checkpointSlotAtPoint` tests.
					style={ { left: slotX, top: slotY } }
					aria-hidden="true"
				>
					<Icon icon={ login } size={ 16 } />
					<span>{ __( 'Entry checkpoint', 'vip-workflow' ) }</span>
				</div>
			) }
		</div>
	);
}

export default memo( RegionNodeComponent );
