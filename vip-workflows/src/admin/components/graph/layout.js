/**
 * Auto-layout for the sequence graph.
 *
 * Stages are grouped by status region, and each region is drawn as a band the
 * nodes sit inside. That makes the layout two problems rather than one:
 *
 * 1. **Inside a band** — dagre's layered (Sugiyama) algorithm, top-to-bottom,
 *    run over just that region's stages and the transitions between them. A
 *    stage several others move into settles below them, so the flow reads
 *    downward like the rest of the editor.
 * 2. **Between bands** — no algorithm at all. Bands are stacked in
 *    `REGION_ORDER` (draft → pending → private → publish), share one width, and
 *    never overlap. That's what makes "which region is this stage in" a
 *    question the canvas answers by position, and what lets a drag decide the
 *    stage's region from where it was dropped.
 *
 * Band geometry is derived from the layout, not from where nodes happen to sit,
 * so it stays put while a node is dragged around inside it. Hand-placed
 * positions (`placements`) are stored *relative to their band's content origin*
 * for the same reason: when a band above grows and pushes the ones below it
 * down, everything the author placed by hand travels with its band instead of
 * being left behind at a stale absolute coordinate. A band grows to contain
 * whatever was placed in it — in whichever direction it was placed. Dropping a
 * stage above a band's content origin moves that band's *top border* up to
 * enclose it; dropping one left of the origin moves every band's left edge out,
 * since the bands share one width. The content origin itself never moves in
 * answer to a placement, which is the property that keeps the gesture local:
 * were the origin to shift, one stage dropped high would slide every other
 * stage in that band by the same amount.
 *
 * A hand-placed stage leaves the auto-layout altogether — dagre neither places
 * it nor reserves room for it, exactly as with the checkpoint stage pinned to a
 * band's border. That is what makes placement stick: were a placed stage still
 * ranked, adding one stage anywhere would re-rank the cluster and slide every
 * stage that had not been placed. `GraphCanvas` leans on this by pinning the
 * whole canvas the first time the author moves or adds anything, so the graph
 * only ever re-flows on "Reset layout" — see the freeze there. With everything
 * placed the clusters are empty and this file is reduced to stacking bands.
 *
 * A sequence with no regions — a phase sequence — skips all of this and gets
 * the plain dagre pass (`layoutGraph`).
 *
 * @package
 */

import dagre from '@dagrejs/dagre';
import {
	START_ID,
	END_ID,
	STAGE_WIDTH,
	STAGE_HEIGHT,
	NODE_TYPE,
	REGION_NODE_TYPE,
} from './graph-model';

/**
 * What an edge needs of the gap between two nodes before any of it is left for
 * the curve: a port stub at each end, run straight out of the border. Every
 * separation below is the spacing that looked right without stubs, plus this.
 *
 * A literal, deliberately decoupled from the routing's `PORT_STUB`: these
 * separations are the geometry the routing lab tuned its constants *against*
 * (RANK_SEP 104, NODE_SEP 88, and the band values below), and the stub base
 * now scales per edge (`edge-spline.js`), so the layout no longer follows it.
 */
const EDGE_PORTS = 32;

/** Gap between a band's edge and the stages inside it. */
export const BAND_PADDING = 32;
/**
 * Clearance between a band's top border and the stage area below it — and so,
 * since the checkpoint stage straddles that border, half a stage of it is the
 * gap between that stage and the first row below it.
 *
 * A floor, not a fixed distance: a band whose author placed something *above*
 * its content origin carries that reach on top of this, and its top border
 * moves up by the difference. `band.contentY` is the real clearance for a given
 * band; this is what it comes to when nothing was placed high.
 */
export const BAND_TOP_CLEARANCE = 48 + EDGE_PORTS;
/**
 * How far the checkpoint stage hangs above the border it straddles. The band
 * above has to stay clear of that much, which makes it the hard floor under
 * `BAND_GAP` — the part upward growth is not allowed to eat.
 */
export const CHECKPOINT_OVERHANG = STAGE_HEIGHT / 2;
/**
 * Narrowest a band gets. Wide enough that an empty region is still a target
 * worth dragging to, and that the checkpoint slot — a full stage footprint
 * centered on the top border — has room either side of it.
 */
export const BAND_MIN_WIDTH = 760;
/** Shortest a band's stage area gets, for the same reason. */
export const BAND_MIN_CONTENT_HEIGHT = 132;
/**
 * Vertical gap between bands, and between the Start / End markers and the first
 * / last band. Both have to clear the checkpoint slot, which hangs half a stage
 * above the band it belongs to.
 *
 * Two parts, once a band can grow upward: `CHECKPOINT_OVERHANG` the slot needs,
 * and the slack above it. A band reaching up takes the slack first — nothing
 * else on the canvas moves for that — and only what it needs beyond the slack
 * comes out of the bands above, which shift up to yield it.
 */
export const BAND_GAP = 96;
export const ENDPOINT_GAP = 88 + EDGE_PORTS;

/**
 * Default separations dagre lays stages out with. Both carry edges — `rankSep`
 * the vertical gap an edge crosses between ranks, `nodeSep` the horizontal lane
 * one routes through between siblings — so both leave room for two port stubs.
 */
export const RANK_SEP = 72 + EDGE_PORTS;
export const NODE_SEP = 56 + EDGE_PORTS;
/** Minimum separation dagre keeps between parallel edges. */
export const EDGE_SEP = 24;

/**
 * A band's content origin: the point every hand placement in it is measured
 * from, in flow coordinates.
 *
 * Held still by the stacking pass no matter which way the band grows, which is
 * the whole reason placements survive a neighbour moving.
 *
 * @param {Object} band A band rectangle from `layoutSequence`.
 * @return {{ x: number, y: number }} The origin.
 */
export function contentOrigin( band ) {
	return { x: band.x + band.contentX, y: band.y + band.contentY };
}

/**
 * Where a band-relative placement puts a node, in flow coordinates.
 *
 * @param {Object}                   band      A band rectangle.
 * @param {{ x: number, y: number }} placement Offset from the content origin.
 * @return {{ x: number, y: number }} Node top-left.
 */
export function positionIn( band, placement ) {
	const origin = contentOrigin( band );
	return { x: origin.x + placement.x, y: origin.y + placement.y };
}

/**
 * The inverse: what offset records a node sitting at this flow position.
 *
 * Unbounded in every direction, and that is the contract — a band grows to
 * contain whatever offset comes back, so there is no such thing as a placement
 * it cannot hold and nothing here has to refuse one.
 *
 * @param {Object}                   band     A band rectangle.
 * @param {{ x: number, y: number }} position Node top-left, in flow coords.
 * @return {{ x: number, y: number }} Offset from the content origin.
 */
export function offsetIn( band, position ) {
	const origin = contentOrigin( band );
	return { x: position.x - origin.x, y: position.y - origin.y };
}

/**
 * Compute node positions with dagre and return new node objects carrying those
 * positions. Edges are read-only here. Node `width`/`height` (as measured by
 * React Flow) are used when present so ranks don't overlap; otherwise the
 * defaults above apply.
 *
 * @param {Array}  nodes             React Flow nodes (from `buildGraph`).
 * @param {Array}  edges             React Flow edges (from `buildGraph`).
 * @param {Object} [options]         Layout options.
 * @param {number} [options.rankSep] Vertical gap between ranks.
 * @param {number} [options.nodeSep] Horizontal gap between siblings.
 * @param {number} [options.edgeSep] Minimum separation between parallel edges.
 * @return {Array} Nodes with `position` set (top-left, React Flow convention).
 *         Edges are not routed here — React Flow draws its own paths between the
 *         handles these positions imply.
 */
export function layoutGraph( nodes, edges, options = {} ) {
	const {
		rankSep = RANK_SEP,
		nodeSep = NODE_SEP,
		edgeSep = EDGE_SEP,
	} = options;

	const g = new dagre.graphlib.Graph();
	g.setGraph( {
		rankdir: 'TB',
		ranksep: rankSep,
		nodesep: nodeSep,
		edgesep: edgeSep,
	} );
	g.setDefaultEdgeLabel( () => ( {} ) );

	nodes.forEach( ( node ) => {
		g.setNode( node.id, {
			width: node.width || STAGE_WIDTH,
			height: node.height || STAGE_HEIGHT,
		} );
	} );

	edges.forEach( ( edge ) => {
		g.setEdge( edge.source, edge.target );
	} );

	// Keep the End node ranked at the bottom even before any terminal stage is
	// connected: without an incoming edge dagre would float it up top. Add
	// layout-only edges from the sink stages (these are not rendered).
	const hasEndNode = nodes.some( ( n ) => n.id === END_ID );
	const endHasIncoming = edges.some( ( e ) => e.target === END_ID );
	if ( hasEndNode && ! endHasIncoming ) {
		const stageIds = nodes
			.filter( ( n ) => n.id !== START_ID && n.id !== END_ID )
			.map( ( n ) => n.id );
		const sources = new Set(
			edges
				.filter( ( e ) => e.target !== END_ID )
				.map( ( e ) => e.source )
		);
		const sinks = stageIds.filter( ( id ) => ! sources.has( id ) );
		( sinks.length ? sinks : stageIds ).forEach( ( id ) =>
			g.setEdge( id, END_ID )
		);
	}

	dagre.layout( g );

	return nodes.map( ( node ) => {
		const placed = g.node( node.id );
		if ( ! placed ) {
			return node;
		}
		// dagre centers nodes; React Flow positions by top-left corner.
		const width = node.width || STAGE_WIDTH;
		const height = node.height || STAGE_HEIGHT;
		return {
			...node,
			position: {
				x: placed.x - width / 2,
				y: placed.y - height / 2,
			},
		};
	} );
}

/**
 * Lay one region's stages out with dagre, normalized to its own origin.
 *
 * @param {Array}  clusterNodes Stage nodes in this region.
 * @param {Array}  edges        Every edge in the graph; ones with an endpoint
 *                              outside the cluster are ignored (a cross-region
 *                              transition is drawn, but it doesn't rank).
 * @param {Object} options      `rankSep` / `nodeSep` / `edgeSep`.
 * @return {{ positions: Object, width: number, height: number }} Positions keyed
 *         by node id, relative to the cluster's top-left, and its bounding size.
 */
function layoutCluster( clusterNodes, edges, options ) {
	if ( clusterNodes.length === 0 ) {
		return { positions: {}, width: 0, height: 0 };
	}

	const { rankSep, nodeSep, edgeSep } = options;
	const ids = new Set( clusterNodes.map( ( n ) => n.id ) );

	const g = new dagre.graphlib.Graph();
	g.setGraph( {
		rankdir: 'TB',
		ranksep: rankSep,
		nodesep: nodeSep,
		edgesep: edgeSep,
	} );
	g.setDefaultEdgeLabel( () => ( {} ) );

	clusterNodes.forEach( ( node ) =>
		g.setNode( node.id, {
			width: node.width || STAGE_WIDTH,
			height: node.height || STAGE_HEIGHT,
		} )
	);
	edges.forEach( ( edge ) => {
		if ( ids.has( edge.source ) && ids.has( edge.target ) ) {
			g.setEdge( edge.source, edge.target );
		}
	} );

	dagre.layout( g );

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const raw = {};

	clusterNodes.forEach( ( node ) => {
		const placed = g.node( node.id );
		const width = node.width || STAGE_WIDTH;
		const height = node.height || STAGE_HEIGHT;
		// dagre centers nodes; React Flow positions by top-left corner.
		const x = placed.x - width / 2;
		const y = placed.y - height / 2;
		raw[ node.id ] = { x, y };
		minX = Math.min( minX, x );
		minY = Math.min( minY, y );
		maxX = Math.max( maxX, x + width );
		maxY = Math.max( maxY, y + height );
	} );

	const positions = {};
	Object.keys( raw ).forEach( ( id ) => {
		positions[ id ] = { x: raw[ id ].x - minX, y: raw[ id ].y - minY };
	} );

	return { positions, width: maxX - minX, height: maxY - minY };
}

/**
 * Lay out a sequence whose stages are grouped into status regions.
 *
 * @param {Array}    nodes                React Flow nodes (from `buildGraph`).
 * @param {Array}    edges                React Flow edges (from `buildGraph`).
 * @param {Object}   [options]            Layout options.
 * @param {string[]} [options.regions]    Regions to band, top to bottom. Empty
 *                                        falls through to the plain dagre pass.
 * @param {Object}   [options.placements] Hand-placed stages as
 *                                        `{ stageKey: { region, x, y } }`, with
 *                                        `x`/`y` relative to that band's content
 *                                        origin. A placement whose `region` no
 *                                        longer matches the stage's is ignored —
 *                                        the stage was moved by other means and
 *                                        goes back to the computed slot.
 * @param {?number}  [options.minWidth]   Floor on the shared band content width,
 *                                        in px. The canvas records the width it
 *                                        froze at and passes it back here: with
 *                                        the clusters emptied by placements the
 *                                        computed width hugs the placed stages,
 *                                        and letting the bands snap in around
 *                                        them is the one move the freeze is
 *                                        there to prevent.
 * @param {number}   [options.rankSep]    Vertical gap between ranks.
 * @param {number}   [options.nodeSep]    Horizontal gap between siblings.
 * @param {number}   [options.edgeSep]    Minimum separation between parallel edges.
 * @return {{ nodes: Array, bands: Object }} Positioned nodes, and each region's
 *         band rectangle keyed by region slug.
 */
export function layoutSequence( nodes, edges, options = {} ) {
	const {
		regions = [],
		placements = {},
		minWidth = null,
		rankSep = RANK_SEP,
		nodeSep = NODE_SEP,
		edgeSep = EDGE_SEP,
	} = options;

	// No bands to anchor to (a phase sequence): the plain dagre pass, with hand
	// placements applied as the absolute points they were recorded as.
	if ( regions.length === 0 ) {
		const laidOut = layoutGraph( nodes, edges, options );
		return {
			nodes: laidOut.map( ( node ) => {
				const placement = placements[ node.id ];
				return placement
					? {
							...node,
							position: { x: placement.x, y: placement.y },
					  }
					: node;
			} ),
			bands: {},
		};
	}

	const sepOptions = { rankSep, nodeSep, edgeSep };

	// A stage's band is its region, and every region a stage occupies is in the
	// list: `visibleRegions()` builds that list *from* the stages, and the same
	// list drives `buildGraph`'s bands. A stage naming a region with no band is
	// therefore a caller that assembled the two from different sources, and
	// there is no band to put it in — seating it in the first one would hide
	// that by drawing the stage somewhere it does not belong.
	const bandOf = ( node ) => {
		const region = node.data?.region;
		if ( ! regions.includes( region ) ) {
			throw new Error(
				`Stage "${ node.id }" is in region "${ region }", ` +
					`which has no band (bands: ${ regions.join( ', ' ) }).`
			);
		}
		return region;
	};

	const stageNodes = nodes.filter( ( node ) => node.type === NODE_TYPE );

	// The stage holding a region's checkpoint is pinned to the slot on the
	// band's top border, so it is left out of that band's cluster entirely —
	// dagre neither places it nor reserves room for it.
	const isPinned = ( node ) => Boolean( node.data?.isRegionEntry );

	// A placement counts only for the band the stage is actually in: one left
	// over from a stage since moved to another region is stale, and the stage
	// goes back to the computed slot.
	const placementOf = ( node ) => {
		const placement = placements[ node.id ];
		return placement && placement.region === bandOf( node )
			? placement
			: null;
	};

	// Out of the cluster on the same terms as a checkpoint: a stage the author
	// has put somewhere is no longer dagre's to rank or to reserve room for.
	const members = {};
	regions.forEach( ( region ) => ( members[ region ] = [] ) );
	stageNodes.forEach( ( node ) => {
		if ( ! isPinned( node ) && ! placementOf( node ) ) {
			members[ bandOf( node ) ].push( node );
		}
	} );

	const clusters = {};
	regions.forEach( ( region ) => {
		clusters[ region ] = layoutCluster(
			members[ region ],
			edges,
			sepOptions
		);
	} );

	// How far a band has to reach, in each direction, to still contain what was
	// placed in it by hand. Measured from the content origin, which is where
	// placements are anchored — so all four are distances, never coordinates,
	// and a band with nothing placed outside its content box reaches zero.
	const reach = {};
	regions.forEach(
		( region ) =>
			( reach[ region ] = { left: 0, right: 0, up: 0, down: 0 } )
	);
	stageNodes.forEach( ( node ) => {
		const placement = placementOf( node );
		// A checkpoint straddles the band's top border — half of it is outside
		// the content box by design, so it never grows one. Were it counted,
		// every band holding a placed checkpoint would reach up by the clearance
		// plus the overhang and drag its own border up past it, chasing itself.
		if ( isPinned( node ) || ! placement ) {
			return;
		}
		const region = bandOf( node );
		const width = node.width || STAGE_WIDTH;
		const height = node.height || STAGE_HEIGHT;
		reach[ region ] = {
			left: Math.max( reach[ region ].left, -placement.x ),
			right: Math.max( reach[ region ].right, placement.x + width ),
			up: Math.max( reach[ region ].up, -placement.y ),
			down: Math.max( reach[ region ].down, placement.y + height ),
		};
	} );

	// One width for every band, so their left and right edges line up and the
	// stack reads as a single column of sections. Reaching left is therefore
	// something every band does together: one band's left edge cannot move
	// without the rest, and moving them all keeps every content origin exactly
	// `BAND_PADDING` inside the column, so nothing already placed shifts.
	const contentLeft = regions.reduce(
		( furthest, region ) => Math.max( furthest, reach[ region ].left ),
		0
	);
	const contentWidth = regions.reduce(
		( widest, region ) =>
			Math.max( widest, clusters[ region ].width, reach[ region ].right ),
		Math.max( BAND_MIN_WIDTH - BAND_PADDING * 2, minWidth || 0 )
	);

	// Measure before placing. A band's own upward reach decides where its top
	// border goes, and once the reach is bigger than the slack in `BAND_GAP` it
	// also decides how far the bands *above* it have to move — which the old
	// single downward pass had no way to say, having already placed them.
	//
	// Two distances per band, both measured from its content origin, which is
	// the thing that must not move: `headroom` up to the top border, `legroom`
	// down to the bottom edge.
	const headroom = {};
	const legroom = {};
	const contentHeights = {};
	regions.forEach( ( region ) => {
		contentHeights[ region ] = Math.max(
			BAND_MIN_CONTENT_HEIGHT,
			clusters[ region ].height,
			reach[ region ].down
		);
		headroom[ region ] = BAND_TOP_CLEARANCE + reach[ region ].up;
		legroom[ region ] = contentHeights[ region ] + BAND_PADDING;
	} );

	// Where each band's content origin sits if no band reaches up at all. This
	// is the stack as it has always been laid out, and it is deliberately blind
	// to `reach.up`: a placement must never move the origin it is measured
	// from, or one stage dropped high would slide every other stage in the band.
	const origins = {};
	let cursorY = BAND_TOP_CLEARANCE;
	regions.forEach( ( region ) => {
		origins[ region ] = cursorY;
		cursorY += legroom[ region ] + BAND_GAP + BAND_TOP_CLEARANCE;
	} );

	// What a band's reach costs the ones above it: whatever it needs beyond the
	// slack in the gap. The first band answers to nobody above it and so never
	// costs anything. Paying it by shifting the *preceding* bands up — rather
	// than this band's content down — is what keeps the stage that was just
	// dropped where the author let go of it, along with everything else in this
	// band and every band below.
	const slack = BAND_GAP - CHECKPOINT_OVERHANG;
	let owed = 0;
	const lift = {};
	[ ...regions ].reverse().forEach( ( region, index ) => {
		lift[ region ] = owed;
		// `index` counts from the bottom, so the last one reached is the first
		// band — the one with nothing above it to push.
		if ( index < regions.length - 1 ) {
			owed += Math.max( 0, reach[ region ].up - slack );
		}
	} );

	// Every band's content origin sits exactly `BAND_PADDING` inside the column,
	// whatever the column has had to reach; the left edge is what moves out.
	const contentX = BAND_PADDING + contentLeft;
	const columnX = BAND_PADDING - contentX;

	const bands = {};
	regions.forEach( ( region ) => {
		const contentHeight = contentHeights[ region ];
		const origin = origins[ region ] - lift[ region ];
		const band = {
			region,
			x: columnX,
			y: origin - headroom[ region ],
			width: contentLeft + contentWidth + BAND_PADDING * 2,
			height: headroom[ region ] + contentHeight + BAND_PADDING,
			// Top-left of the area stages occupy, relative to the band. Both
			// absorb the band's reach, so that `band.{x,y} + band.content{X,Y}`
			// — the origin every placement is measured from — comes out the same
			// whether the band grew or not.
			contentX,
			contentY: headroom[ region ],
			contentWidth,
			contentHeight,
		};
		bands[ region ] = band;
	} );

	// Where each band's checkpoint slot is — the outline `RegionNode` draws and
	// the rectangle a drop is tested against. It follows the stage in it: once
	// the checkpoint has been placed by hand, a slot still centred on the band
	// would be a target sitting somewhere the stage visibly isn't. Only a region
	// whose checkpoint is unplaced (or empty) gets the centred default.
	//
	// A placement moves it *along* the border and nowhere else. The stage
	// straddling the border is what says a post entering the status lands here,
	// so its y is the border's, not the author's — and the border moves: every
	// placement is measured from the content origin, which upward growth holds
	// still while `band.y` climbs above it. Read from the placement, the
	// checkpoint would stay behind at a border that had moved off it, which is
	// exactly what a band growing upward did to it. Growing down never showed it
	// because `band.y` does not move.
	regions.forEach( ( region ) => {
		const band = bands[ region ];
		const held = stageNodes.find(
			( node ) => isPinned( node ) && bandOf( node ) === region
		);
		const placement = held ? placementOf( held ) : null;
		const centred = checkpointSlot( band );
		band.slot = placement
			? { x: positionIn( band, placement ).x, y: centred.y }
			: centred;
	} );

	const first = bands[ regions[ 0 ] ];
	const last = bands[ regions[ regions.length - 1 ] ];

	const positioned = nodes.map( ( node ) => {
		if ( node.type === REGION_NODE_TYPE ) {
			const band = bands[ node.data?.region ];
			if ( ! band ) {
				return node;
			}
			return {
				...node,
				position: { x: band.x, y: band.y },
				width: band.width,
				height: band.height,
				data: {
					...node.data,
					// The slot outline is positioned from these rather than from
					// the stylesheet, so it lands on the same rectangle a drop is
					// tested against.
					slotX: band.slot.x - band.x,
					slotY: band.slot.y - band.y,
				},
				style: {
					// React Flow measures a node it isn't told the size of; the
					// box has no intrinsic size of its own, so give it both.
					width: band.width,
					height: band.height,
					// And the box is inert. It covers most of the canvas, so
					// taking pointer events would leave no pane to pan from, no
					// empty space to clear the selection with, and nowhere to
					// drop a connection "inside" a region. Set here rather than in
					// the stylesheet because React Flow writes
					// `pointer-events: all` *inline* on every node wrapper, which
					// no rule can outrank — but `node.style` is spread after it,
					// so this does. Nothing inside switches them back on:
					// the part of a region you click is its label, and that is
					// screen-space chrome drawn by `RegionBands`, not part of this
					// node at all. `graph-model.js` takes the band out of the tab
					// order for the same reason.
					pointerEvents: 'none',
				},
			};
		}

		if ( node.type === NODE_TYPE ) {
			const region = bandOf( node );
			const band = bands[ region ];
			const cluster = clusters[ region ];
			const placement = placementOf( node );

			// The region's checkpoint: docked in its band's slot. Sitting *on*
			// the boundary is what says this stage is where a post entering the
			// status lands — but *where* along the boundary is the author's, once
			// they own the canvas. Without that, a band widening around a new
			// stage slid every checkpoint back to centre while nothing else
			// moved. The slot was computed from this same placement above, so the
			// stage and the target a drop is tested against stay one rectangle. A
			// stage dropped in the slot has its placement cleared
			// (`GraphCanvas`), so taking the checkpoint still snaps to the middle.
			if ( isPinned( node ) ) {
				return { ...node, position: band.slot };
			}

			let local;
			if ( placement ) {
				local = { x: placement.x, y: placement.y };
			} else {
				// Every stage that is neither pinned nor placed went into this
				// band's cluster above, on exactly these two tests, and
				// `layoutCluster` returns a position for every member it was
				// given. A gap means the two passes disagreed about which
				// stages dagre ranked, and the stage would silently pile up on
				// the band's content origin.
				const slot = cluster.positions[ node.id ];
				if ( ! slot ) {
					throw new Error(
						`Stage "${ node.id }" was not laid out in the "${ region }" cluster.`
					);
				}
				// Center the computed cluster in the shared band width.
				local = {
					x: slot.x + ( band.contentWidth - cluster.width ) / 2,
					y: slot.y,
				};
			}

			return { ...node, position: positionIn( band, local ) };
		}

		// Start / End bookend the stack, centered on the column of stages.
		if ( node.id === START_ID || node.id === END_ID ) {
			const width = node.width || STAGE_WIDTH;
			const height = node.height || STAGE_HEIGHT;
			const anchor = node.id === START_ID ? first : last;
			return {
				...node,
				position: {
					x: contentCentre( anchor ) - width / 2,
					y:
						node.id === START_ID
							? anchor.y - ENDPOINT_GAP - height
							: anchor.y + anchor.height + ENDPOINT_GAP,
				},
			};
		}

		return node;
	} );

	return { nodes: positioned, bands };
}

/**
 * The middle of the column of stages, in flow coordinates.
 *
 * The content box's middle, NOT the band's. A band grows outward from its
 * content origin, and it grows LEFT as readily as right — so once an author has
 * dropped a stage past the column's left edge the two are no longer the same
 * point, and the band's geometric middle sits `reach.left / 2` to the left of
 * the stages in it. Everything that has to line up with those stages therefore
 * measures from here: the checkpoint slot they lead into, and the Start / End
 * markers that bookend them. Centring on `band.width` instead is what slid every
 * checkpoint and both endpoint markers sideways when one unrelated stage was
 * dragged left — the non-local answer this file's header promises a placement
 * can never produce.
 *
 * Identical to the band's middle whenever nothing has reached left, which is
 * every sequence that has not been hand-placed.
 *
 * @param {Object} band A band rectangle from `layoutSequence`.
 * @return {number} The x of the column's centre line.
 */
function contentCentre( band ) {
	return band.x + band.contentX + band.contentWidth / 2;
}

/**
 * Where a region's checkpoint stage sits: a stage-sized slot straddling the
 * band's top border, centered.
 *
 * That border is the boundary a post crosses coming into the status, so a stage
 * sitting on it *is* the answer to "and then what stage is it in" — which is why
 * the checkpoint has no marker of its own. Centered rather than tucked in a
 * corner because the stages below are centered too, so the flow reads straight
 * down; `BAND_MIN_WIDTH` keeps room either side of it.
 *
 * @param {Object} band A band rectangle from `layoutSequence`.
 * @return {{ x: number, y: number }} Slot top-left, in flow coordinates.
 */
export function checkpointSlot( band ) {
	return {
		x: contentCentre( band ) - STAGE_WIDTH / 2,
		y: band.y - CHECKPOINT_OVERHANG,
	};
}

/**
 * Whether a point falls in some band's checkpoint slot, and which.
 *
 * Checked before `bandAtPoint` on a drop, and deliberately not forgiving: the
 * slot is exactly one stage footprint, so filling it is something you have to
 * aim at. A stage let go anywhere else in the band is just a stage in that
 * region — that asymmetry is what makes dragging one *off* the border a way to
 * free the checkpoint rather than an accident.
 *
 * @param {Object}                   bands   Bands keyed by region.
 * @param {string[]}                 regions Region order.
 * @param {{ x: number, y: number }} point   Point in flow coordinates.
 * @return {string|null} Region whose slot contains the point, or null.
 */
export function checkpointSlotAtPoint( bands, regions, point ) {
	for ( const region of regions ) {
		const band = bands[ region ];
		if ( ! band ) {
			continue;
		}
		// `band.slot` is where the slot actually is once the checkpoint has been
		// placed by hand; the centred default is the fallback for a band that
		// came from somewhere other than `layoutSequence`.
		const slot = band.slot || checkpointSlot( band );
		if (
			point.x >= slot.x &&
			point.x <= slot.x + STAGE_WIDTH &&
			point.y >= slot.y &&
			point.y <= slot.y + STAGE_HEIGHT
		) {
			return region;
		}
	}
	return null;
}

/**
 * Which band a point falls in.
 *
 * Bands are stacked with a gap between them — `BAND_GAP`, less whatever the band
 * below has reached up into it — and a stage can be let go in one of those gaps
 * or off the ends. Rather than refuse the drop, a band takes it: the author
 * moved the stage somewhere deliberately, and reading that as some region is
 * better than snapping it back.
 *
 * *Which* band gets the gap is not a judgement call, though: `RegionBands` paints
 * each section from its own top border down to the next one, so the whole gap is
 * visibly part of the region above it — including the tint that lights up while
 * a stage is being dragged over it. Attributing it the same way here is what
 * keeps the band that lights up and the band the stage lands in the same band.
 * The last section runs off the bottom of the pane, so it takes everything below
 * it too; only the space *above* the first border has no section painted over
 * it, and the first band takes that.
 *
 * @param {Object}                   bands   Bands keyed by region (from `layoutSequence`).
 * @param {string[]}                 regions Region order.
 * @param {{ x: number, y: number }} point   Point in flow coordinates.
 * @return {string|null} Region slug, or null when there are no bands.
 */
export function bandAtPoint( bands, regions, point ) {
	const stack = regions
		.filter( ( region ) => Boolean( bands[ region ] ) )
		.map( ( region ) => ( { region, band: bands[ region ] } ) );

	if ( stack.length === 0 ) {
		return null;
	}

	// The last section whose border the point is below — which is the section
	// painted over it, gap included, with the last one running off the bottom of
	// the canvas. A point above the first border is below none of them, and the
	// first band takes it.
	let landed = stack[ 0 ];
	stack.forEach( ( entry ) => {
		if ( point.y >= entry.band.y ) {
			landed = entry;
		}
	} );
	return landed.region;
}
