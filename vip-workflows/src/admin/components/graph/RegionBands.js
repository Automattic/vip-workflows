/**
 * RegionBands — status regions drawn as sections of the canvas.
 *
 * A region isn't a shape sitting on the canvas; it's a stretch *of* it. So the
 * only mark it makes is the boundary: a hairline running the full width of the
 * viewport at the top of the band, with the region's label riding just below it.
 * Everything between one line and the next is that region — including the parts
 * off either side of the screen, which is exactly what a `post_status` is: not a
 * box a stage was dropped into, but a stretch of the workflow it sits in.
 *
 * That means this layer is drawn in *screen* space, not flow space. It reads the
 * viewport transform out of the React Flow store and converts each band's top
 * edge into a screen y itself, so:
 *
 * - the line spans `0 → 100%` of the pane and can't run out however far you pan;
 * - the label sticks to the left edge of the viewport rather than to a point in
 *   the graph, so it's still readable when the sequence is panned sideways;
 * - the hairline stays a hairline and the label stays legible at any zoom,
 *   because neither is inside the scaled transform.
 *
 * Two layers, because they belong on opposite sides of the graph: the lines go
 * *under* the nodes and edges (a boundary the checkpoint stage sits astride, and
 * that transitions cross), the labels go *over* them (chrome, like the zoom
 * controls — a stage panned across the left edge shouldn't swallow the label
 * that says which status you're looking at).
 *
 * The band rectangles come from `layout.js`; nothing here measures the DOM.
 *
 * @package
 */

import { memo } from '@wordpress/element';
import { useStore } from '@xyflow/react';
import { Icon } from '@wordpress/components';
import { _n, sprintf } from '@wordpress/i18n';
import { postList } from '@wordpress/icons';

/**
 * Screen-space y of a flow-space y, under the current viewport transform.
 *
 * @param {number}   flowY     Y in flow coordinates.
 * @param {number[]} transform React Flow's `[ x, y, zoom ]`.
 * @return {number} Y in pixels from the top of the pane.
 */
const toScreenY = ( flowY, [ , panY, zoom ] ) => panY + flowY * zoom;

function RegionBandsComponent( {
	regions,
	bands,
	meta,
	selectedRegion,
	dropRegion,
	onSelectRegion,
	onContextMenu,
} ) {
	const transform = useStore( ( state ) => state.transform );

	// Ordered top to bottom, so a section runs from its own line down to the
	// next one — and the last runs off the bottom of the pane. The gap between
	// two bands is therefore painted as the region *above* it, tint and all;
	// `bandAtPoint` attributes a drop there the same way, so the section that
	// lights up under a dragged stage is the one it lands in.
	const sections = regions
		.map( ( region ) => ( { region, band: bands[ region ] } ) )
		.filter( ( { band } ) => Boolean( band ) )
		.map( ( { region, band }, index, all ) => {
			const next = all[ index + 1 ];
			const top = toScreenY( band.y, transform );
			return {
				region,
				top,
				// Null height means "to the bottom of the pane": the last region
				// has no boundary below it, because nothing follows it.
				height: next ? toScreenY( next.band.y, transform ) - top : null,
			};
		} );

	if ( sections.length === 0 ) {
		return null;
	}

	const stateClass = ( region ) =>
		[
			region === selectedRegion && 'is-selected',
			region === dropRegion && 'is-drop-target',
		]
			.filter( Boolean )
			.join( ' ' );

	return (
		<>
			{ /* wpds-allow R7 -- a full-pane painting layer, not a layout: it is inset-0 and pointer-events:none, and every section inside it is absolutely positioned from the viewport transform, so a <Stack> would lay nothing out */ }
			<div className="wf-region-bands" aria-hidden="true">
				{ sections.map( ( { region, top, height } ) => (
					<div
						key={ region }
						className={ [
							'wf-region-bands__section',
							stateClass( region ),
						]
							.filter( Boolean )
							.join( ' ' ) }
						data-region={ region }
						style={
							height === null
								? { top, bottom: 0 }
								: { top, height }
						}
					/>
				) ) }
			</div>
			{ /* wpds-allow R7 -- the matching painting layer over the graph; same absolutely-positioned, pointer-events:none pane as the bands above */ }
			<div className="wf-region-labels">
				{ sections.map( ( { region, top } ) => {
					// Not defaulted: `meta` is read off the same projected
					// region nodes the bands come from (`GraphCanvas`), and
					// `buildGraph` gives every one of them a label and a stage
					// count. A section with no entry means the two were built
					// from different projections, which a band labelled with a
					// raw slug and "0 stages" would only disguise.
					const { label, stageCount } = meta[ region ];
					return (
						<button
							key={ region }
							type="button"
							className={ [
								'wf-region-labels__label',
								stateClass( region ),
							]
								.filter( Boolean )
								.join( ' ' ) }
							data-region={ region }
							style={ { top } }
							onClick={ () => onSelectRegion?.( region ) }
							onContextMenu={ ( event ) =>
								onContextMenu?.( event, region )
							}
						>
							<Icon
								icon={ postList }
								size={ 16 }
								className="wf-region-labels__icon"
							/>
							{ /* wpds-allow R7 -- uppercase micro-type inside the pill; the class also carries letter-spacing and colour, which <Text> has no prop for, and its stylesheet is out of this sweep's scope */ }
							<span className="wf-region-labels__name">
								{ label }
							</span>
							{ /* wpds-allow R7 -- the pill's secondary label; same constraint as the name above */ }
							<span className="wf-region-labels__count">
								{ sprintf(
									/* translators: %d: number of stages in this status region */
									_n(
										'%d stage',
										'%d stages',
										stageCount,
										'vip-workflows'
									),
									stageCount
								) }
							</span>
						</button>
					);
				} ) }
			</div>
		</>
	);
}

export default memo( RegionBandsComponent );
