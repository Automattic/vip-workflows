/**
 * GraphCanvas — the sequence editor's node/edge canvas.
 *
 * Wraps `@xyflow/react`. Nodes and edges are *derived* from the `stages` prop on
 * every render (`buildGraph` + `layoutSequence`) — structure is read-only as far
 * as React Flow's internal store is concerned; all real changes flow up through
 * callbacks and come back down as new `stages`. Edges are created by dragging
 * off a handle (`onConnect`), and dropped on empty canvas to create the stage
 * they should have landed on (`onConnectEnd`).
 *
 * They are rewired the same way — by dragging an endpoint — but not by React
 * Flow. Its reconnect anchors are placed from the *handle* an edge nominally
 * uses, and this canvas plans its own ports (`edge-pipeline.js`), so they
 * landed nowhere near the line they belonged to: an invisible `cursor: move`
 * circle on every card's top border, grabbing an edge that visibly arrived
 * somewhere else. So `edgesReconnectable` stays off and the anchors are drawn
 * where the edge actually ends, on the planned port, by `EdgeAnchors` — which
 * owns the gesture from grab to release. This file supplies what only it knows:
 * which of an edge's ends may move, what a drop on a given node would mean
 * (`reconnectVerdict`, answered by the model itself), and where a stage grown
 * by a release on empty canvas belongs (`dropSite`, `placeDroppedStage` — the
 * same two the `onConnectEnd` drop uses).
 *
 * **Status regions.** Stages are grouped into bands, one per region, stacked in
 * a fixed order (`layout.js`). Which band a stage sits in *is* its region, and
 * one slot straddling a band's top border *is* that region's entry checkpoint —
 * so both are set by dragging: on drop the node's center is tested against the
 * slot rectangles first and the band rectangles second, and `onPlaceStage` is
 * told where it landed. Dragging the checkpoint stage anywhere else in its band
 * is what leaves the region without one.
 *
 * The bands are geometry, not drop zones in the pointer-events sense — the node
 * spanning a band takes no pointer events at all (see `RegionNode`), so panning
 * still works over the whole canvas. (Selection does not follow: this canvas
 * derives `selected` from the editor's selection props, and drops React Flow's
 * `select` changes on the floor — see `handleNodesChange`. Shift-drag draws a
 * marquee that selects nothing.) What a region *looks*
 * like isn't in that node either: the boundary line and the label that names it
 * are screen-space chrome drawn by `RegionBands`, so the line runs the width of
 * the viewport however far the graph is panned and the label stays pinned to its
 * left edge — a region is a section of the canvas, not a shape on it.
 *
 * Position is the one thing the canvas owns rather than derives. A node the user
 * drags is remembered for the rest of the editing session — as an offset inside
 * its band, not an absolute point, so it travels with the band when a band above
 * grows and pushes it down. The offset is taken exactly as the gesture left it,
 * in any direction: the band grows to contain it, upward past its own border if
 * that is where the stage was let go. Nothing about it is saved — reopening the
 * sequence lays it out fresh.
 *
 * **The freeze.** The auto-layout gets exactly one turn. The first time the
 * author touches the canvas — drags a stage, drops a connection on empty space,
 * inserts one on an edge, deletes anything — every stage is pinned where it
 * currently sits (`freezeCanvas`), and from then on only the node the gesture
 * was actually about moves. Otherwise each edit re-ran dagre over the whole
 * graph: inserting a stage pushed everything downstream a rank, and a band
 * widening to fit a new stage slid the checkpoints back to centre while the
 * stages below them stayed put. "Reset layout" in the Controls panel drops the
 * placements and hands the graph back to dagre — the one place layout happens
 * on purpose.
 *
 * A placed stage is out of the layout entirely (`layout.js`), so with the canvas
 * frozen the clusters are empty and the bands only stack. The width they were
 * frozen at rides along as `minWidth`, since bands hugging the placed stages
 * would be the same snap the freeze exists to prevent.
 *
 * @package
 */

import {
	useMemo,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useCallback,
} from '@wordpress/element';
import {
	ReactFlow,
	ReactFlowProvider,
	Background,
	BackgroundVariant,
	Controls,
	ControlButton,
	useReactFlow,
	useStoreApi,
} from '@xyflow/react';
import { Icon } from '@wordpress/components';
import { rotateLeft, plus, trash } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';
import StageNode from './StageNode';
import TerminalNode from './TerminalNode';
import RegionNode from './RegionNode';
import RegionBands from './RegionBands';
import TransitionEdge from './TransitionEdge';
import CanvasMenu from './CanvasMenu';
import {
	buildGraph,
	NODE_TYPE,
	EDGE_TYPE,
	TERMINAL_NODE_TYPE,
	REGION_NODE_TYPE,
	parseEdgeId,
	canReconnect,
	canReconnectToNewStage,
	START_ID,
	STAGE_WIDTH,
	STAGE_HEIGHT,
} from './graph-model';
import {
	layoutSequence,
	bandAtPoint,
	checkpointSlotAtPoint,
	offsetIn,
} from './layout';
import { EdgePlanProvider } from './EdgePlanProvider';
import EdgeOverlay from './EdgeOverlay';
import EdgeAnchors from './EdgeAnchors';
import { regionLabel, REGION_ORDER } from './regions';

// Note: React Flow's base stylesheet (`@xyflow/react/dist/style.css`) is imported
// from the admin entry (`src/admin/index.js`), not here. Its filename matches
// wp-scripts' special `style.css` split-chunk cacheGroup, and this canvas lives
// in a lazily-loaded page chunk — importing it here lands it in an unnamed async
// chunk and crashes the build's chunk-naming step. Loaded from the entry it sits
// in the named `admin` chunk instead. Edges use React Flow's default bezier
// path but not its stroke — state tones live in `SequenceGraphEditor.css`.

const nodeTypes = {
	[ NODE_TYPE ]: StageNode,
	[ TERMINAL_NODE_TYPE ]: TerminalNode,
	[ REGION_NODE_TYPE ]: RegionNode,
};
const edgeTypes = { [ EDGE_TYPE ]: TransitionEdge };

// React Flow treats a `nodes`/`edges` prop with change handlers as a controlled
// flow. Edge changes are driven entirely by `stages`, so that handler is
// intentionally a no-op — it only exists to opt into controlled mode without
// warnings. (Node changes are not: see `handleNodesChange`.)
const noop = () => {};

// Zoom range for the canvas. The floor goes below React Flow's default 0.5 so a
// long sequence can be read end to end.
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

/**
 * Width the floating inspector takes out of the canvas, in pixels.
 *
 * The canvas runs full-bleed beneath the panel, so anything centering on it has
 * to discount the strip the panel covers. The measurements live in
 * `SequenceGraphEditor.css` as `--wf-inspector-width` and `--wf-float-inset`;
 * they're recombined here rather than read from the `--wf-inspector-reserve`
 * calc(), because a custom property holding a calc() comes back from
 * getComputedStyle unresolved.
 *
 * @param {HTMLElement} el Element inside the editor to resolve the vars against.
 * @return {number} Reserved width in px, or 0 if the vars aren't set.
 */
function inspectorReserve( el ) {
	const styles = window.getComputedStyle( el );
	const width = parseFloat(
		styles.getPropertyValue( '--wf-inspector-width' )
	);
	const inset = parseFloat( styles.getPropertyValue( '--wf-float-inset' ) );
	if ( ! Number.isFinite( width ) || ! Number.isFinite( inset ) ) {
		return 0;
	}
	// Zero width is the mobile layout, where the panel docks along the bottom
	// and takes no horizontal room — not even the insets.
	if ( width <= 0 ) {
		return 0;
	}
	return width + inset * 2;
}

/**
 * A hand placement for an absolute flow position.
 *
 * Anchored to the band's content origin, which is what lets it travel with the
 * band; with no band (a phase sequence) the absolute point is the placement.
 *
 * The offset is taken as it comes, in every direction. A band grows to contain
 * whatever was placed in it — up and left as readily as down and right — so a
 * stage is recorded where it was let go and stays there. Holding the offset at
 * the content origin instead, as this used to, moved a stage dropped in a
 * band's top clearance back down onto whatever it was making room for, and did
 * it after the pointer was released, when there was no longer anything the
 * author could do about it.
 *
 * @param {{ x: number, y: number }} position Node top-left, in flow coords.
 * @param {?string}                  region   Region the stage belongs to.
 * @param {Object}                   bands    Bands keyed by region.
 * @return {{ region: ?string, x: number, y: number }} The placement.
 */
export function placementIn( position, region, bands ) {
	const band = region ? bands[ region ] : null;
	if ( ! band ) {
		return { region: null, x: position.x, y: position.y };
	}
	return { region, ...offsetIn( band, position ) };
}

/**
 * Sort a batch of React Flow `position` changes into the three things they can
 * mean.
 *
 * The change's own `dragging` flag doesn't say: React Flow emits
 * `dragging: false` for the closing change of a pointer drag, for an aborted
 * one, *and* for a discrete keyboard move, which is not part of a drag at all.
 * (`updateNodePositions( items, dragging = false )` — `@xyflow/react`; the
 * arrow-key path in `useMoveSelectedNodes` calls it with no second argument.)
 *
 * What separates them is whether that node had a drag in flight. A pointer drag
 * reaches its closing change only after at least one `dragging: true` change —
 * `XYDrag`'s `end` handler emits it only when `nodePositionsChanged`, which is
 * set by the very pass that emits the moving ones — and an abort emits its
 * closing change from inside the same session. A keyboard move arrives with
 * nothing in flight.
 *
 * @param {Array}       moves    Position changes, already filtered to those
 *                               carrying a position.
 * @param {Set<string>} inFlight Node ids with a pointer drag in progress. Read
 *                               and updated in place — ids go in as their drag
 *                               starts moving and come out as it ends.
 * @return {{ moving: Array, released: Array, stepped: Array }} `moving` are
 *                 in-flight drag positions; `released` are the ids whose drag
 *                 just ended, dropped or aborted alike, since either way the
 *                 in-flight position goes and only a drop commits (from
 *                 `onNodeDragStop`); `stepped` are the keyboard moves, which
 *                 have to be committed by the caller because nothing else will.
 */
export function classifyPositionChanges( moves, inFlight ) {
	const moving = [];
	const released = [];
	const stepped = [];
	moves.forEach( ( move ) => {
		if ( move.dragging ) {
			inFlight.add( move.id );
			moving.push( move );
			return;
		}
		if ( inFlight.delete( move.id ) ) {
			released.push( move.id );
			return;
		}
		stepped.push( move );
	} );
	return { moving, released, stepped };
}

/**
 * The endpoints an edge would have after one of its ends moved to `candidate`.
 *
 * One statement of it, asked once while the end is held and again when it is
 * let go: the verdict painted under the pointer and the move committed on
 * release have to be the same pair, or the canvas promises one thing and does
 * another.
 *
 * @param {Object}  edge      The edge being dragged — `{ from, to }`.
 * @param {string}  end       Which end is moving: `'source'` or `'target'`.
 * @param {?string} candidate Node the end is over, or null over open canvas.
 * @return {{ from: string, to: string }} The prospective endpoints.
 */
function endsAfterMove( edge, end, candidate ) {
	return {
		from: end === 'source' ? candidate : edge.from,
		to: end === 'target' ? candidate : edge.to,
	};
}

function Flow( {
	stages,
	isPhase,
	warnings,
	regions: regionsProp = [],
	selectedNodeKey,
	selectedEdgeId,
	selectedRegion,
	onConnectTransition,
	onReconnectTransition,
	onReconnectTransitionToNewStage,
	onSelectNode,
	onSelectEdge,
	onSelectRegion,
	onClearSelection,
	onDeleteNode,
	onDeleteEdge,
	onAddStageFromNode,
	onInsertStageOnEdge,
	onPlaceStage,
	onAddRegion,
	onRemoveRegion,
	connectable = true,
	isValidConnection,
} ) {
	// `visibleRegions` (`SequenceGraphEditor`) allocates a fresh array on every
	// render, so the prop's identity says nothing about whether the set of bands
	// changed — a keystroke in the inspector produces a new-but-equal one. Hold
	// the last array whose *value* differed and key everything below on that, or
	// every drop-target callback is rebuilt per character typed.
	const regionsRef = useRef( regionsProp );
	if ( regionsRef.current.join( '|' ) !== regionsProp.join( '|' ) ) {
		regionsRef.current = regionsProp;
	}
	const regions = regionsRef.current;

	// Where the user has placed nodes by hand, as `{ region, x, y }` offsets
	// inside that region's band (see `layout.js`). Feeding these back into the
	// layout is what lets a band grow to contain them.
	const [ placements, setPlacements ] = useState( {} );

	// The shared band content width at the moment the canvas was frozen, or null
	// while it is still the auto-layout's. A floor, not a width.
	const [ frozenWidth, setFrozenWidth ] = useState( null );

	// The projection. Cheap (plain maps over `stages`), and re-run whenever
	// anything the canvas *draws* changes — a label being typed in the
	// inspector, a colour, a stage count.
	const graph = useMemo(
		() => buildGraph( stages, { isPhase, regions } ),
		[ stages, isPhase, regions ]
	);

	// What the dagre pass actually reads out of that projection: which nodes
	// exist and how big they are, which band each belongs to, which one is its
	// band's checkpoint (both of those leave the cluster), and what connects to
	// what. A label or a colour changes none of it.
	//
	// Derived from the projection rather than from `stages`, so it describes
	// what `layout.js` consumes rather than how `buildGraph` happens to derive
	// it — the stage fields behind these can move without stranding the layout
	// on a stale arrangement.
	const layoutKey = useMemo(
		() =>
			JSON.stringify( [
				graph.nodes.map( ( node ) => [
					node.id,
					node.type,
					node.width ?? null,
					node.height ?? null,
					node.data?.region ?? null,
					Boolean( node.data?.isRegionEntry ),
				] ),
				graph.edges.map( ( edge ) => [ edge.source, edge.target ] ),
			] ),
		[ graph ]
	);

	// The dagre pass, keyed on that structure and on the hand placements — not
	// on selection clicks or inspector keystrokes, which are the frequent
	// updates. The projection is read through a ref for the same reason: two
	// projections with one `layoutKey` lay out identically, so the memo is free
	// to keep the older one's positions.
	const graphRef = useRef( graph );
	graphRef.current = graph;
	const placed = useMemo(
		() =>
			layoutSequence( graphRef.current.nodes, graphRef.current.edges, {
				regions,
				placements,
				minWidth: frozenWidth,
			} ),
		// `layoutKey` stands in for the projection the positions were computed
		// from; `regions` is already part of it (a band is a node).
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[ layoutKey, regions, placements, frozenWidth ]
	);

	// …and the two put back together: positions and band geometry from the
	// layout, everything drawn from the current projection.
	const layout = useMemo( () => {
		const laidOut = new Map(
			placed.nodes.map( ( node ) => [ node.id, node ] )
		);
		return {
			nodes: graph.nodes.map( ( node ) => {
				const positioned = laidOut.get( node.id );
				return {
					...positioned,
					// `layout.js` adds to a node's data (a band's slot offsets)
					// rather than replacing it, so the fresh data goes on top.
					data: { ...positioned.data, ...node.data },
				};
			} ),
			edges: graph.edges,
			bands: placed.bands,
		};
	}, [ graph, placed ] );

	// Which band a stage belongs to, on the same terms `layout.js` decides it — a
	// placement is only read back when its region matches, so the two have to
	// agree. `layout.js` `bandOf()` refuses a stage whose region has no band
	// instead of seating it in the first one, and so does this: the two are one
	// rule stated twice, and a copy that quietly disagreed would put the stage in
	// a band the layout never drew it in. No bands at all is a different thing —
	// that is a phase sequence, which has no regions by design.
	const bandRegionOf = useCallback(
		( node ) => {
			if ( regions.length === 0 ) {
				return null;
			}
			const region = node.data?.region;
			if ( ! regions.includes( region ) ) {
				throw new Error(
					`Stage "${ node.id }" is in region "${ region }", ` +
						`which has no band (bands: ${ regions.join( ', ' ) }).`
				);
			}
			return region;
		},
		[ regions ]
	);

	// Pin the canvas as the given layout has it, then let the caller add or drop
	// the one placement its gesture is actually about. Stages already placed are
	// left alone — a freeze records where things are, it never moves them.
	//
	// `snapshot` is a layout, not necessarily the current one: a gesture that
	// changes the structure freezes from the layout that was on screen when it
	// started, which is the arrangement the author is asking to keep.
	const freezeCanvas = useCallback(
		( snapshot, adjust ) => {
			setPlacements( ( current ) => {
				const next = { ...current };
				snapshot.nodes.forEach( ( node ) => {
					if ( node.type !== NODE_TYPE || next[ node.id ] ) {
						return;
					}
					next[ node.id ] = placementIn(
						node.position,
						bandRegionOf( node ),
						snapshot.bands
					);
				} );
				adjust?.( next );
				return next;
			} );
			// Only the first freeze sets the floor. A later one would record a
			// width the bands had already grown to, and the canvas could then
			// only ever get wider.
			setFrozenWidth( ( current ) =>
				current === null
					? snapshot.bands[ regions[ 0 ] ]?.contentWidth ?? null
					: current
			);
		},
		[ bandRegionOf, regions ]
	);

	// A node's position while it's actually under the pointer, absolute and
	// transient. Committed to `placements` (band-relative) on drop; keeping it
	// separate is what stops the layout re-running on every pointer move.
	const [ dragPositions, setDragPositions ] = useState( {} );

	// Node ids with a pointer drag in flight — the only thing that tells a drag's
	// closing position change apart from a keyboard step (see
	// `classifyPositionChanges`). A ref rather than a read of `dragPositions`,
	// because the classification has to happen outside `setDragPositions`'s
	// updater: an updater that collected the keyboard moves as a side effect
	// would collect them twice under StrictMode.
	const draggingIdsRef = useRef( new Set() );

	// Which band a dragged stage would land in, when that isn't the band it
	// came from — the canvas's way of saying "letting go here changes this
	// stage's post status".
	const [ dropRegion, setDropRegion ] = useState( null );

	// Which band's checkpoint slot the dragged stage is currently over, if any.
	// Letting go there makes it that region's entry.
	const [ dropSlotRegion, setDropSlotRegion ] = useState( null );

	// True only while a node is under the pointer. Two jobs: the layout easing is
	// suspended (eased transforms would leave the node, and its edges, trailing
	// the cursor), and every region shows its checkpoint slot, which is only a
	// target while something is in flight.
	const [ draggingNode, setDraggingNode ] = useState( false );

	// Split an edge with the "+" that rides on it. The new stage appears under
	// the button that made it rather than in the slot the layout would open up
	// for it — an insert used to push everything downstream a rank, which read as
	// the canvas rearranging itself in answer to a click on one edge.
	//
	// Its band is the source's, because that is the region `insertStageOnEdge`
	// gives it. On an edge crossing between regions the "+" sits over a band the
	// stage doesn't belong to, and the stage still appears under it: the source's
	// band stretches to reach it, which is the same answer as for a stage dragged
	// there by hand, and says plainly that this stage is in that region however
	// far from the rest of it the edge ran.
	const handleInsertStage = useCallback(
		( edge, mid ) => {
			const key = onInsertStageOnEdge(
				edge.source,
				edge.target,
				edge.data?.outcome || null
			);
			if ( ! key || ! mid ) {
				return;
			}
			const source = layout.nodes.find( ( n ) => n.id === edge.source );
			const region = source ? bandRegionOf( source ) : null;
			const position = {
				x: mid.x - STAGE_WIDTH / 2,
				y: mid.y - STAGE_HEIGHT / 2,
			};
			freezeCanvas( layout, ( next ) => {
				next[ key ] = placementIn( position, region, layout.bands );
			} );
		},
		[ onInsertStageOnEdge, layout, bandRegionOf, freezeCanvas ]
	);

	// Decoration: in-flight drag positions, selection, per-stage warnings, and
	// the edge "+". Cheap (plain maps), so it can re-run on every selection or
	// edit without paying for another layout.
	const { nodes, edges } = useMemo( () => {
		const decoratedNodes = layout.nodes.map( ( laidOut ) => {
			const node = dragPositions[ laidOut.id ]
				? { ...laidOut, position: dragPositions[ laidOut.id ] }
				: laidOut;

			// A region draws nothing in flow space but its checkpoint slot; the
			// boundary line and the label are screen-space chrome (`RegionBands`).
			if ( node.type === REGION_NODE_TYPE ) {
				return {
					...node,
					data: {
						...node.data,
						isSlotTarget: node.data.region === dropSlotRegion,
						// While a stage is being dragged the slot is a target,
						// so the region has to show one even when it is filled
						// — the stage on the border may be the one in flight.
						isDragging: draggingNode,
					},
				};
			}

			if ( node.type !== NODE_TYPE ) {
				return node;
			}

			const data = {
				...node.data,
				warnings: warnings[ node.id ] || [],
			};
			return { ...node, selected: node.id === selectedNodeKey, data };
		} );

		const decoratedEdges = layout.edges.map( ( edge ) => ( {
			...edge,
			selected: edge.id === selectedEdgeId,
			className: [
				// What `buildGraph` already put there — the checkpoint tie
				// marks itself that way.
				edge.className,
				// Selecting a stage lights up what it leads to: every edge
				// leaving it is drawn in the selected tone, so "where does this
				// stage go" is answerable from the canvas without opening the
				// inspector.
				selectedNodeKey &&
					edge.source === selectedNodeKey &&
					'is-outbound',
				// An agent outcome edge, drawn in that outcome's tone — at all
				// times, so two lines between the same pair of stages can be
				// told apart at rest (see the CSS).
				edge.data?.outcome && `is-outcome is-${ edge.data.outcome }`,
				// A transition an agent stage no longer lets anyone use. Still
				// selectable and deletable — just visibly inert.
				edge.data?.disabled && 'is-disabled',
			]
				.filter( Boolean )
				.join( ' ' ),
			data: {
				...edge.data,
				// "Insert a stage in the middle of this edge" affordance. The
				// edge hands back the midpoint it drew the "+" at, which is
				// where the new stage goes.
				onInsertStage:
					onInsertStageOnEdge && ! edge.data?.synthetic
						? ( mid ) => handleInsertStage( edge, mid )
						: undefined,
			},
		} ) );
		return { nodes: decoratedNodes, edges: decoratedEdges };
	}, [
		layout,
		dragPositions,
		warnings,
		selectedNodeKey,
		selectedEdgeId,
		dropSlotRegion,
		draggingNode,
		onInsertStageOnEdge,
		handleInsertStage,
	] );

	// What the screen-space region layer needs of each region beyond its band
	// rectangle. Read off the projected region nodes rather than recomputed, so
	// the line, the label, and the slot are all describing the same projection.
	const regionMeta = useMemo( () => {
		const meta = {};
		layout.nodes.forEach( ( node ) => {
			if ( node.type === REGION_NODE_TYPE ) {
				meta[ node.data.region ] = node.data;
			}
		} );
		return meta;
	}, [ layout.nodes ] );

	/**
	 * Where a dragged stage would land, from its top-left position.
	 *
	 * The checkpoint slot is tested first and takes precedence: it straddles the
	 * boundary between two bands, so a point inside it is ambiguous to
	 * `bandAtPoint` but not to the author, who aimed at it.
	 *
	 * @param {{ x: number, y: number }} position Node top-left, in flow coords.
	 * @return {{ region: ?string, isCheckpoint: boolean }} Landing.
	 */
	const landingAt = useCallback(
		( position ) => {
			const center = {
				x: position.x + STAGE_WIDTH / 2,
				y: position.y + STAGE_HEIGHT / 2,
			};
			const slot = checkpointSlotAtPoint( layout.bands, regions, center );
			if ( slot ) {
				return { region: slot, isCheckpoint: true };
			}
			return {
				region: bandAtPoint( layout.bands, regions, center ),
				isCheckpoint: false,
			};
		},
		[ layout.bands, regions ]
	);

	const handleNodeDrag = useCallback(
		( _event, node ) => {
			if ( node.type !== NODE_TYPE || regions.length === 0 ) {
				return;
			}
			const { region, isCheckpoint } = landingAt( node.position );
			setDropSlotRegion( isCheckpoint ? region : null );
			// The band only lights up for a move that would change the stage's
			// status; the slot lights up on its own whenever it's the target.
			setDropRegion(
				! isCheckpoint && region === node.data?.region ? null : region
			);
		},
		[ landingAt, regions.length ]
	);

	/**
	 * Record where a stage now sits: pin the canvas around it, keep its position
	 * as a band-relative offset, and tell the editor which region it landed in.
	 *
	 * Both ways a stage moves end up here — a pointer drag, through
	 * `onNodeDragStop`, and a keyboard step, which never reaches that callback.
	 *
	 * @param {string}                   id       Node id.
	 * @param {{ x: number, y: number }} position Node top-left, in flow coords.
	 */
	const commitStagePlacement = useCallback(
		( id, position ) => {
			// Only stages carry a placement. The bands and the terminals are laid
			// out from the graph and have nowhere to record a hand position.
			if (
				layout.nodes.find( ( n ) => n.id === id )?.type !== NODE_TYPE
			) {
				return;
			}

			// No bands (a phase sequence) — remember the absolute point.
			if ( regions.length === 0 ) {
				freezeCanvas( layout, ( next ) => {
					next[ id ] = {
						region: null,
						x: position.x,
						y: position.y,
					};
				} );
				return;
			}

			const { region, isCheckpoint } = landingAt( position );
			if ( ! layout.bands[ region ] ) {
				return;
			}

			// Everything else stays exactly where it is — the gesture moved one
			// stage, so one stage moves. Landing in the slot is the exception
			// that *removes* a placement: the stage *is* the region's checkpoint
			// now, and `layout.js` docks it in the middle of the border. A hand
			// placement would be read again the moment it's dragged back off,
			// putting it somewhere it was never let go of.
			freezeCanvas( layout, ( next ) => {
				if ( isCheckpoint ) {
					delete next[ id ];
					return;
				}
				// Anchored to the band's content origin, in whichever direction
				// it fell: the band grows to hold what was placed in it, so the
				// stage stays exactly where the pointer left it.
				next[ id ] = placementIn( position, region, layout.bands );
			} );

			// One call for wherever it ended up: the region it belongs to, and
			// whether it took that region's checkpoint. Moving the checkpoint
			// stage anywhere else is how a region is left without one.
			onPlaceStage?.( id, region, isCheckpoint );
		},
		[ layout, landingAt, regions.length, onPlaceStage, freezeCanvas ]
	);

	const handleNodeDragStop = useCallback(
		( _event, node ) => {
			setDropRegion( null );
			setDropSlotRegion( null );
			setDraggingNode( false );
			// The in-flight position has already been released by the
			// `dragging: false` change that precedes this callback in the same
			// event (see `handleNodesChange`); from here the node is positioned
			// from `placements`, and the two land in one render.
			commitStagePlacement( node.id, node.position );
		},
		[ commitStagePlacement ]
	);

	// Nodes are draggable, so React Flow's position changes are the one kind of
	// node change worth keeping. Structure (add/remove) still flows through
	// `stages`; `select` changes are dropped, which is A11Y-001 (see the note at
	// the top of the file).
	//
	// The in-flight position is released here rather than in `onNodeDragStop`,
	// which a drag isn't guaranteed to reach: a second touch point, or the node
	// being removed mid-drag, aborts, and React Flow emits that last change and
	// returns without calling `onNodeDragStop` at all. Releasing here means an
	// abort leaves nothing behind — a stranded entry would outrank the layout for
	// that node forever, and "Reset layout" wouldn't reach it either.
	//
	// A keyboard step — arrow keys on a focused, selected node — reaches
	// `onNodeDragStop` even less, because there is no drag to stop. It has to be
	// committed from here, or the next layout is computed without it and the node
	// snaps back while React Flow's aria-live announcement says it moved.
	// Which of the two a `dragging: false` change is, is `classifyPositionChanges`.
	const handleNodesChange = useCallback(
		( changes ) => {
			const moves = changes.filter(
				( change ) => change.type === 'position' && change.position
			);
			if ( moves.length === 0 ) {
				return;
			}
			const { moving, released, stepped } = classifyPositionChanges(
				moves,
				draggingIdsRef.current
			);
			setDraggingNode( moving.length > 0 );
			setDragPositions( ( current ) => {
				const next = { ...current };
				moving.forEach( ( move ) => {
					next[ move.id ] = move.position;
				} );
				released.forEach( ( id ) => delete next[ id ] );
				return next;
			} );
			stepped.forEach( ( move ) =>
				commitStagePlacement( move.id, move.position )
			);
		},
		[ commitStagePlacement ]
	);

	// `getNodesBounds` comes off the instance rather than the package export.
	// The bare one warns in every development build ("Please use
	// `getNodesBounds` from `useReactFlow`…") because without a `nodeLookup` it
	// can only measure the objects handed to it; the instance's passes the
	// store's, so it reads the geometry React Flow actually laid out — which is
	// also what lets the centering below hand it a node array from an earlier
	// render without centering on stale positions.
	const { setViewport, getViewport, getNodesBounds, screenToFlowPosition } =
		useReactFlow();
	const store = useStoreApi();
	const viewportRef = useRef( null );

	// Hover state comes from React Flow's own edge events (its edges carry a wide
	// invisible interaction stroke, so the target is forgiving). It rides in
	// `data` because the insert "+" renders in React Flow's label layer — a
	// separate DOM subtree the SVG edge's class can't reach — and *also* as a
	// class, because `EdgeOverlay` draws the end marks on a layer of its own and
	// reads its tones from the edge's className. The line itself still takes its
	// hover tone from CSS `:hover`; this is what keeps its ends in step.
	const [ hoveredEdgeId, setHoveredEdgeId ] = useState( null );

	// The hovered stage, for the overlay. An AI stage's outcome badges paint
	// on hover, and the arrowhead of an edge arriving under one yields for
	// exactly that long (`EdgeOverlay`). Node hover is not in React Flow's
	// store, so it is tracked here from the node events, the same way the
	// edges' hover is above.
	const [ hoveredNodeId, setHoveredNodeId ] = useState( null );

	// The edge one of whose ends is currently being dragged (`EdgeAnchors`).
	// While it is, the line is hidden: the drag line is where that edge now
	// goes, and drawing both says the transition is in two places at once.
	const [ reconnectingEdgeId, setReconnectingEdgeId ] = useState( null );

	const edgesWithHover = useMemo(
		() =>
			edges.map( ( edge ) => {
				const state = [
					edge.id === hoveredEdgeId && 'is-hovered',
					edge.id === reconnectingEdgeId && 'is-reconnecting',
				].filter( Boolean );
				if ( state.length === 0 ) {
					return edge;
				}
				return {
					...edge,
					className: [ edge.className, ...state ].join( ' ' ),
					// The insert "+" renders in React Flow's label layer, a
					// separate DOM subtree the class above cannot reach, so
					// both states have to travel in `data` as well.
					data: {
						...edge.data,
						hovered: edge.id === hoveredEdgeId,
						reconnecting: edge.id === reconnectingEdgeId,
					},
				};
			} ),
		[ edges, hoveredEdgeId, reconnectingEdgeId ]
	);

	// The selected edge, and which of its ends may be dragged. Anchors belong to
	// that one edge — React Flow's live on every reconnectable edge at once,
	// which is how they became an unexplained grab target on every card border
	// (see the note at the top).
	//
	// Selection and not hover, and that is not a matter of taste. An anchor sits
	// *on* the line, above it, so the pointer reaching one leaves the edge —
	// which, if hover were what put the anchor there, would unmount it, hand the
	// pointer back to the edge underneath, and put it straight back: a flicker
	// loop with no stable state. Selection has no such race, and it reads
	// better anyway — clicking a transition already opens it in the inspector,
	// so its ends becoming movable is the same gesture saying the same thing.
	const anchorEdge = useMemo( () => {
		// A phase sequence's hand-offs are the server's, not the author's — it
		// says so the same way it does for the other gestures that would invent
		// one, by not being handed the callback. Without this its one fixed edge
		// would grow two rings whose every drop is refused.
		if ( ! selectedEdgeId || ! onReconnectTransition ) {
			return null;
		}
		const edge = edges.find( ( e ) => e.id === selectedEdgeId );
		// The End edge is marked non-reconnectable where it is built
		// (`buildGraph`): dragging the exit onto a stage has no meaning.
		if ( ! edge || edge.reconnectable === false ) {
			return null;
		}
		const { from, to, outcome } = parseEdgeId( selectedEdgeId );
		return {
			id: selectedEdgeId,
			from,
			to,
			outcome,
			className: edge.className,
			ends: {
				// Two ends are offered; two are not, and neither is withheld
				// for want of a meaning the model has. An outcome belongs to
				// the agent on its own stage, so moving its departure would be
				// asking a different stage's agent to own the route — the model
				// refuses it (`canReconnect`), and an anchor that can only
				// spring back is a broken control, not a strict one. The Start
				// edge is the same from the other side: its departure *is* the
				// entry marker, so moving it could only re-point the entry at
				// the stage it already points at.
				source: ! outcome && from !== START_ID,
				target: true,
			},
		};
	}, [ selectedEdgeId, edges, onReconnectTransition ] );

	// Rather than scaling to fit, center the graph horizontally and align its top
	// to the viewport top — the flow reads top-down and the entry (Start) should
	// be the first thing in view. Whatever zoom the user is at is preserved, so
	// this never yanks the canvas back to 100%.
	//
	// The canvas runs full-bleed under the floating inspector, so "centered"
	// means centered in what the panel leaves visible, not in the whole element
	// — otherwise the graph sits half-under the panel.
	const centerOn = useCallback(
		( placedNodes, options = {} ) => {
			const el = viewportRef.current;
			if ( ! el || placedNodes.length === 0 ) {
				return;
			}
			const bounds = getNodesBounds( placedNodes );
			const { zoom } = getViewport();
			const visibleWidth = el.clientWidth - inspectorReserve( el );
			setViewport(
				{
					x:
						visibleWidth / 2 -
						( bounds.x + bounds.width / 2 ) * zoom,
					y: 48 - bounds.y * zoom,
					zoom,
				},
				options
			);
		},
		[ getNodesBounds, getViewport, setViewport ]
	);

	const structureKey = nodes.map( ( n ) => n.id ).join( '|' );
	const prevStructure = useRef( '' );

	// The last layout actually drawn, kept for exactly one render. Every gesture
	// that adds a stage freezes from the layout it started in, but a stage can be
	// added or removed from outside the canvas too — the inspector's delete, the
	// "add stage" button, a status change that moves one between bands — and each
	// of those would otherwise re-flow whatever hadn't been placed yet. So the
	// same freeze runs on any structural change, against the arrangement that was
	// on screen before it.
	//
	// A layout effect, not a passive one: it commits before the browser paints,
	// so the re-laid-out frame it is undoing is never shown.
	const drawnLayout = useRef( null );
	useLayoutEffect( () => {
		const previous = drawnLayout.current;
		drawnLayout.current = { structureKey, layout };
		if ( ! previous || previous.structureKey === structureKey ) {
			return;
		}
		// Nothing was on the canvas to keep — the sequence loading in, not an
		// edit. Left to the auto-layout, and left to be centered below.
		if ( ! previous.layout.nodes.some( ( n ) => n.type === NODE_TYPE ) ) {
			return;
		}
		freezeCanvas( previous.layout );
		// Freezing *is* the canvas becoming the author's, so the centering below
		// has nothing left to do: claiming the key is how it's told.
		prevStructure.current = structureKey;
	}, [ structureKey, layout, freezeCanvas ] );

	// The frame the centering below waits on, and the only thing that cancels it:
	// unmount. Cancelling from that effect's own cleanup instead would lose the
	// centering outright, because the effect re-runs on every rebuild of `nodes`
	// — the agents list arriving and recomputing the warnings, a selection, a
	// keystroke in the inspector — and the re-run can't reschedule: it has to
	// early-return, since `prevStructure` claimed this structure the first time
	// through. The graph would simply never be centered.
	const centerFrame = useRef( 0 );
	useEffect( () => () => cancelAnimationFrame( centerFrame.current ), [] );

	// Center the graph when it first arrives, and while it is still the computed
	// layout. Once anything has been placed by hand the user owns the canvas:
	// panning it out from under them on the next edit would undo the thing they
	// just positioned. "Reset layout" re-centers explicitly.
	useEffect( () => {
		if ( prevStructure.current === structureKey ) {
			return;
		}
		prevStructure.current = structureKey;
		if ( Object.keys( placements ).length > 0 ) {
			return;
		}
		cancelAnimationFrame( centerFrame.current );
		centerFrame.current = requestAnimationFrame( () => centerOn( nodes ) );
	}, [ structureKey, centerOn, nodes, placements ] );

	// Set by "Reset layout", consumed by the effect below. Centering can't happen
	// in the handler: `layout` there is still the one holding the placements
	// being dropped, so `getNodesBounds` would frame the arrangement being thrown
	// away — a stage dragged far off to one side would pull the view out with it
	// and leave the re-flowed graph off-screen. Nothing corrects it afterwards
	// either; the centering above only fires on a change of `structureKey`, which
	// is ids, and a reset changes no ids.
	const pendingRecenter = useRef( false );

	// Hand back to the auto-layout: drop every hand-placed position, release the
	// width they were frozen at, and re-center. The one place the graph re-flows
	// on purpose.
	//
	// The placements are cleared unconditionally rather than only when there are
	// some, so the layout is recomputed and the effect below has a frame to fire
	// on even when the button is pressed on an already-computed canvas — where
	// "reset" still means "put the view back".
	const handleResetLayout = useCallback( () => {
		pendingRecenter.current = true;
		setDragPositions( {} );
		setPlacements( {} );
		setFrozenWidth( null );
	}, [] );

	// Re-center once the layout the reset asked for has actually been computed.
	useEffect( () => {
		if ( ! pendingRecenter.current ) {
			return;
		}
		pendingRecenter.current = false;
		centerOn( layout.nodes, { duration: 200 } );
	}, [ layout, centerOn ] );

	// --- Dropping on empty canvas -------------------------------------------

	// Where a stage made by a drop belongs. Centred under the pointer (React
	// Flow positions by top-left), in the status region of whichever band it
	// was released inside. Shared by the two gestures that grow a stage this
	// way — a connection dropped on empty canvas, and an edge endpoint released
	// there — so both put it in the same place for the same reasons.
	const dropSite = useCallback(
		( clientX, clientY ) => {
			const dropped = screenToFlowPosition( {
				x: clientX,
				y: clientY,
			} );
			const position = {
				x: dropped.x - STAGE_WIDTH / 2,
				y: dropped.y - STAGE_HEIGHT / 2,
			};
			return {
				position,
				region:
					regions.length > 0 ? landingAt( position ).region : null,
			};
		},
		[ screenToFlowPosition, landingAt, regions.length ]
	);

	// Pin the new stage where it was dropped rather than in the slot the layout
	// would have chosen, and pin the rest of the canvas as it stood before the
	// stage joined it, so the graph doesn't re-flow around the drop. Batched
	// with the mutation that made it, so the node lands in place on the first
	// paint instead of jumping in from the computed slot.
	const placeDroppedStage = useCallback(
		( key, site ) => {
			freezeCanvas( layout, ( next ) => {
				next[ key ] = placementIn(
					site.position,
					site.region,
					layout.bands
				);
			} );
		},
		[ freezeCanvas, layout ]
	);

	// Where a stage released here would land, in flow coordinates — asked before
	// the release so the ghost card can be drawn there. It is the drop point
	// itself: with the band growing to contain whatever it is given, there is no
	// longer any correction between where the card is drawn and where the stage
	// appears, and the ghost is a straight promise rather than a prediction of
	// where the drop would be moved to.
	const dropGhostAt = useCallback(
		( clientX, clientY ) => dropSite( clientX, clientY ).position,
		[ dropSite ]
	);

	// --- Connections --------------------------------------------------------

	// A connection drag has no way out but letting go. `XYHandle` binds pointer
	// moves and pointer up and nothing else, so a release is the only thing that
	// ends one — and on this canvas a release over empty space *means* something:
	// it creates the stage the drag was reaching for. With no undo in the editor,
	// a drag begun by accident is a stage the author then has to find and delete.
	// So Escape abandons it.
	//
	// `cancelConnection` is React Flow's own teardown, the one `XYHandle` calls
	// itself: it resets the store's connection, which unrenders the line and
	// clears the `fromHandle` that the next pointer move checks — so the session
	// closes itself rather than being left half-live. It closes through
	// `onPointerUp` though, which still reports `onConnect` and `onConnectEnd`
	// from the state it had reached. This flag is what tells those two that the
	// gesture was abandoned rather than completed.
	const connectAborted = useRef( false );

	useEffect( () => {
		const onKeyDown = ( event ) => {
			if ( event.key !== 'Escape' ) {
				return;
			}
			const { connection, cancelConnection } = store.getState();
			if ( ! connection.inProgress ) {
				return;
			}
			connectAborted.current = true;
			cancelConnection();
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ store ] );

	const handleConnectStart = useCallback( () => {
		connectAborted.current = false;
	}, [] );

	const handleConnect = useCallback(
		( connection ) => {
			// Escape while over a valid target: the drag still ends on a
			// connection React Flow considers good, and it is still abandoned.
			if ( connectAborted.current ) {
				return;
			}
			if ( connection.source && connection.target ) {
				// The handle is what the gesture means on an AI stage: which of
				// the agent's outcomes this destination belongs to.
				onConnectTransition(
					connection.source,
					connection.target,
					connection.sourceHandle || null
				);
			}
		},
		[ onConnectTransition ]
	);

	// Drop a connection on empty canvas to create the stage it was reaching for:
	// wired up to the node the drag started from, left where it was dropped
	// rather than in the slot the layout would have chosen, and in the status
	// region of whichever band it landed in.
	//
	// Only drags off a *source* handle qualify — a stage grown this way flows out
	// of its source.
	const handleConnectEnd = useCallback(
		( event, connectionState ) => {
			// Abandoned with Escape. The drag is only arriving here because
			// `onPointerUp` is the one way `XYHandle` ends a session, cancelled
			// or not; the flag is cleared here because this is the last of the
			// two callbacks that release fires.
			if ( connectAborted.current ) {
				connectAborted.current = false;
				return;
			}
			if (
				! onAddStageFromNode ||
				connectionState.isValid ||
				connectionState.fromHandle?.type !== 'source' ||
				! connectionState.fromNode
			) {
				return;
			}
			const pointer =
				'changedTouches' in event ? event.changedTouches[ 0 ] : event;
			// Landing on anything but empty canvas is a cancelled connection, not
			// a request for a stage. Nodes render *inside* the pane, so being
			// within the pane isn't enough — a drop on a node it can't legally
			// connect to (Start, or itself) has to be excluded too.
			//
			// The node spanning a region's band is the exception, and named here
			// rather than left to its `pointer-events: none`: dropping inside a
			// region is the whole point of the gesture, and it would be a poor
			// thing for that to depend on a stylesheet winning a cascade tie.
			const target =
				'changedTouches' in event
					? document.elementFromPoint(
							pointer.clientX,
							pointer.clientY
					  )
					: event.target;
			const landedOn = target?.closest?.( '.react-flow__node' );
			if (
				! target?.closest?.( '.react-flow__pane' ) ||
				( landedOn &&
					! landedOn.classList.contains(
						`react-flow__node-${ REGION_NODE_TYPE }`
					) )
			) {
				return;
			}
			const site = dropSite( pointer.clientX, pointer.clientY );

			// Two things ride along with the drag: the group it was released
			// inside, which is the new stage's status region, and — when it
			// started from an outcome handle — the outcome, which the new stage
			// becomes the destination of.
			const key = onAddStageFromNode( connectionState.fromNode.id, {
				region: site.region,
				outcome: connectionState.fromHandle?.id || null,
			} );
			if ( ! key ) {
				return;
			}
			placeDroppedStage( key, site );
		},
		[ onAddStageFromNode, dropSite, placeDroppedStage ]
	);

	// --- Rewiring -----------------------------------------------------------

	// What would happen if the end being dragged were let go where it is. Both
	// halves are asked of the code that will answer them for real: React Flow's
	// own rule for a hand-drawn connection, so an endpoint can reach exactly
	// what a fresh connection can, and then the model, which is what decides
	// whether this particular move is a move at all. Nothing about the gesture's
	// meaning is restated here — a duplicate transition, an outcome's fixed
	// departure, a source endpoint dropped on Start, an endpoint the flow has no
	// meaning for, all come back refused because `canReconnect` refuses them,
	// and the line says so while it is still being held rather than springing
	// back unexplained on release.
	//
	// `canReconnect` rather than `reconnectEdge`: this runs on every pointer
	// frame, and the mutation rebuilt the whole stages tree to yield one boolean
	// that answered a subtly different question ("is there an edge worth
	// selecting" rather than "will the endpoint move"). `reconnectEdge` gates on
	// the same predicate, so held and released still agree.
	const reconnectVerdict = useCallback(
		( edge, end, candidate, onPane, client ) => {
			if ( ! candidate ) {
				// Empty canvas. The destination end grows the stage it was
				// reaching for; the other end has no such move, because a stage
				// made there would have nothing flowing into it — the same
				// reason `onConnectEnd` grows one only out of a source handle.
				// A phase sequence grows no stages at all, and says so the same
				// way it does for a dropped connection: by not being handed the
				// callback.
				if (
					! onPane ||
					end !== 'target' ||
					! onReconnectTransitionToNewStage
				) {
					return 'invalid';
				}
				// And then asked of the model, like every other verdict here.
				// Not every release on open canvas grows something: a Start
				// endpoint claims the flow entry only inside the draft band, and
				// a stage grown off a transition no outcome routes would be
				// unreachable the moment it appeared. Painting a ghost card for
				// either is the "dropped, and silently nothing happened" the
				// whole verdict mechanism exists to rule out.
				//
				// The band under the pointer is part of the question, which is
				// why the release point comes in with it.
				const { region } = dropSite( client.x, client.y );
				return canReconnectToNewStage( stages, edge.from, edge.to, {
					...( region ? { status: region } : {} ),
					outcome: edge.outcome,
				} )
					? 'create'
					: 'invalid';
			}
			const { from, to } = endsAfterMove( edge, end, candidate );
			if ( from === edge.from && to === edge.to ) {
				return 'unchanged';
			}
			if (
				! isValidConnection( {
					source: from,
					target: to,
					sourceHandle: edge.outcome,
				} )
			) {
				return 'invalid';
			}
			return canReconnect(
				stages,
				edge.from,
				edge.to,
				from,
				to,
				edge.outcome
			)
				? 'valid'
				: 'invalid';
		},
		[ stages, isValidConnection, onReconnectTransitionToNewStage, dropSite ]
	);

	const handleReconnect = useCallback(
		( edge, end, candidate ) => {
			const { from, to } = endsAfterMove( edge, end, candidate );
			onReconnectTransition( edge.from, edge.to, from, to, edge.outcome );
		},
		[ onReconnectTransition ]
	);

	// An endpoint released on empty canvas: the stage it was reaching for is
	// created and the endpoint lands on it in one step, so the transition is
	// never briefly pointing at nothing.
	const handleReconnectToNewStage = useCallback(
		( edge, client ) => {
			const site = dropSite( client.x, client.y );
			const key = onReconnectTransitionToNewStage( edge.from, edge.to, {
				region: site.region,
				outcome: edge.outcome,
			} );
			if ( ! key ) {
				return;
			}
			placeDroppedStage( key, site );
		},
		[ onReconnectTransitionToNewStage, dropSite, placeDroppedStage ]
	);

	// --- Right-click menu --------------------------------------------------

	// `{ x, y }` in viewport-relative px, plus the region the menu was opened
	// on (null on empty canvas).
	const [ menu, setMenu ] = useState( null );
	const closeMenu = useCallback( () => setMenu( null ), [] );

	const openMenu = useCallback( ( event, region = null ) => {
		event.preventDefault();
		const rect = viewportRef.current?.getBoundingClientRect();
		if ( ! rect ) {
			return;
		}
		setMenu( {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
			region,
		} );
	}, [] );

	const menuItems = useMemo( () => {
		if ( ! menu ) {
			return [];
		}
		const remaining = REGION_ORDER.filter(
			( r ) => ! regions.includes( r )
		);
		const items = [
			{
				id: 'add-region',
				icon: plus,
				label: __( 'Add post status…', 'vip-workflows' ),
				disabled: remaining.length === 0,
				onSelect: () => onAddRegion?.(),
			},
		];

		if ( menu.region && regionMeta[ menu.region ]?.removable ) {
			items.push( {
				id: 'remove-region',
				icon: trash,
				label: sprintf(
					/* translators: %s: post status label (e.g. Pending Review) */
					__( 'Remove “%s”', 'vip-workflows' ),
					regionLabel( menu.region )
				),
				onSelect: () => onRemoveRegion?.( menu.region ),
			} );
		}

		return items;
	}, [ menu, regionMeta, regions, onAddRegion, onRemoveRegion ] );

	return (
		<div
			className={ [
				'wf-canvas__viewport',
				draggingNode && 'is-dragging',
				// The grab cursor for an endpoint in flight has to be claimed
				// here: the anchors themselves stop taking pointer events for
				// the length of the drag (the drop is decided by what is under
				// the cursor, so the layer following it must never be the
				// answer), and an element that never hit-tests never paints a
				// cursor.
				reconnectingEdgeId && 'is-rewiring',
			]
				.filter( Boolean )
				.join( ' ' ) }
			ref={ viewportRef }
		>
			<ReactFlow
				nodes={ nodes }
				edges={ edgesWithHover }
				onNodesChange={ handleNodesChange }
				onEdgesChange={ noop }
				nodeTypes={ nodeTypes }
				edgeTypes={ edgeTypes }
				nodesDraggable
				nodesConnectable={ connectable }
				elementsSelectable
				// Selection is drawn from `stages` and the selection props, so
				// React Flow's automatic z-elevation of the selected node would
				// only lift a region's band out from under its own stages.
				elevateNodesOnSelect={ false }
				// Deliberately off. Endpoints *are* draggable here — see
				// `EdgeAnchors` — but React Flow's own anchors would be a
				// second, misplaced grab target for the same gesture (the note
				// at the top of the file).
				edgesReconnectable={ false }
				isValidConnection={ isValidConnection }
				onConnectStart={ handleConnectStart }
				onConnect={ handleConnect }
				onConnectEnd={ handleConnectEnd }
				onNodeDrag={ handleNodeDrag }
				onNodeDragStop={ handleNodeDragStop }
				onEdgeMouseEnter={ ( _e, edge ) => setHoveredEdgeId( edge.id ) }
				onEdgeMouseLeave={ () => setHoveredEdgeId( null ) }
				onNodeMouseEnter={ ( _e, node ) => setHoveredNodeId( node.id ) }
				onNodeMouseLeave={ () => setHoveredNodeId( null ) }
				// Mouseleave alone is not enough: a zoom or pan slides a stage
				// out from under a stationary pointer, so CSS `:hover` drops
				// (the outcome badges fade) with no mouse event fired — and a
				// stale id here would keep an arrowhead yielding to a badge
				// that is no longer painted.
				onMoveStart={ () => setHoveredNodeId( null ) }
				onNodeClick={ ( _e, node ) => {
					if ( node.type === NODE_TYPE ) {
						onSelectNode( node.id );
					} else {
						onClearSelection();
					}
				} }
				onEdgeClick={ ( _e, edge ) => onSelectEdge( edge.id ) }
				onPaneClick={ onClearSelection }
				onPaneContextMenu={ openMenu }
				onMove={ closeMenu }
				onNodesDelete={ ( deleted ) =>
					deleted.forEach( ( n ) => onDeleteNode( n.id ) )
				}
				onEdgesDelete={ ( deleted ) =>
					deleted.forEach( ( e ) => {
						const { from, to, outcome } = parseEdgeId( e.id );
						onDeleteEdge( from, to, outcome );
					} )
				}
				proOptions={ { hideAttribution: true } }
				// Scroll (and pinch) zooms; drag the pane to pan. Double-click
				// zoom stays off — it fights double-clicking a node.
				minZoom={ MIN_ZOOM }
				maxZoom={ MAX_ZOOM }
				zoomOnScroll
				zoomOnPinch
				zoomOnDoubleClick={ false }
			>
				<Background
					variant={ BackgroundVariant.Dots }
					gap={ 16 }
					size={ 1 }
					className="wf-canvas__background"
				/>
				{ /* Status region boundaries and their labels, drawn in screen
				     space so a line runs the width of the pane however far the
				     graph is panned, and a label stays pinned to the left edge. */ }
				<RegionBands
					regions={ regions }
					bands={ layout.bands }
					meta={ regionMeta }
					selectedRegion={ selectedRegion }
					dropRegion={ dropRegion }
					onSelectRegion={ onSelectRegion }
					onContextMenu={ openMenu }
				/>
				<Controls showInteractive={ false }>
					<ControlButton
						onClick={ handleResetLayout }
						title={ __( 'Reset layout', 'vip-workflows' ) }
						aria-label={ __( 'Reset layout', 'vip-workflows' ) }
					>
						<Icon icon={ rotateLeft } size={ 16 } />
					</ControlButton>
				</Controls>
				{ /* The hidden spans of edges passing behind stages, repainted
				     faintly above the cards (`edge-tunnel.js`), and the edges'
				     end marks. The hovered stage rides along because an AI
				     stage's outcome badges paint on hover, and an arrowhead
				     landing on one yields while it is up. */ }
				<EdgeOverlay hoveredNodeId={ hoveredNodeId } />
				{ /* The grab handles that move an edge's ends, drawn on the
				     planned ports the marks above sit on. */ }
				<EdgeAnchors
					anchor={ anchorEdge }
					verdictFor={ reconnectVerdict }
					ghostFor={ dropGhostAt }
					onReconnect={ handleReconnect }
					onReconnectToNewStage={ handleReconnectToNewStage }
					onDragChange={ setReconnectingEdgeId }
				/>
			</ReactFlow>
			{ menu && (
				<CanvasMenu
					x={ menu.x }
					y={ menu.y }
					items={ menuItems }
					// One name for the menu however it was opened. Which
					// region it was opened on is already carried by the item
					// that names it ("Remove “Pending Review”").
					label={ __( 'Canvas actions', 'vip-workflows' ) }
					onClose={ closeMenu }
				/>
			) }
		</div>
	);
}

/**
 * Canvas wrapper. `ReactFlowProvider` gives the inner `Flow` access to the
 * imperative API (`setViewport`); `EdgePlanProvider` reads node geometry out
 * of the same store once, plans every edge together, and publishes the
 * finished plans to the edges and the outcome-badge order to the stages.
 *
 * @param {Object} props Canvas props (see `Flow`).
 * @return {JSX.Element} The canvas.
 */
export default function GraphCanvas( props ) {
	return (
		<ReactFlowProvider>
			<EdgePlanProvider>
				<Flow { ...props } />
			</EdgePlanProvider>
		</ReactFlowProvider>
	);
}
