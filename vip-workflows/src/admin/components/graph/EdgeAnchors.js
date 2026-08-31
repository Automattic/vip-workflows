/**
 * EdgeAnchors — the grab handles that move a transition's endpoints.
 *
 * React Flow ships this gesture, and this canvas cannot use it. Its reconnect
 * anchors are placed from the *handle* an edge nominally uses, and here an edge
 * does not end at its handle: ports are planned across the whole canvas at once
 * (`edge-pipeline.js`), so the anchors sat on every card's top border while the
 * line they belonged to visibly arrived somewhere else. The fix is not to move
 * React Flow's anchors — nothing exposes them — but to put the grab target
 * where the edge actually ends, which is a number this canvas already has:
 * `plan.source` and `plan.target`, the same two points `EdgeOverlay` stamps the
 * socket and the arrowhead on.
 *
 * So the anchor sits *on the mark*. That is the whole idea, and the rest
 * follows from it:
 *
 * - **The layer is the overlay's.** End marks have to clear the cards (a
 *   neighbour a stage overlaps would swallow them), and a grab target has the
 *   same problem in a worse form — an anchor under a card is not merely
 *   invisible, it is unclickable. So this draws in a `ViewportPortal` above the
 *   nodes, like `EdgeOverlay`, and unlike it takes pointer events — on the
 *   circles only, never on the sheet, so the canvas beneath stays live.
 *
 * - **Only the selected edge has anchors.** React Flow renders its anchors on
 *   every reconnectable edge, invisibly, all the time; that is what left an
 *   unexplained `cursor: move` circle on every card border. Here they belong to
 *   the one edge the author has selected, and they are painted rather than
 *   invisible: a ring at the socket and at the arrowhead saying "this end
 *   moves". Selection rather than hover is load-bearing — see the note on
 *   `anchorEdge` in `GraphCanvas`, where an anchor revealed by hover flickers,
 *   because reaching it takes the pointer off the very edge that put it there.
 *
 * - **The drag is this file's, not React Flow's.** With the anchor already off
 *   React Flow's handle, its connection session would have to be started at a
 *   handle anyway, and would land only on another handle: a stage's sole exit
 *   is the small grip on its bottom border, so moving an edge's *source* end
 *   would mean hitting a 22px pill instead of the card. Dragging here hit-tests
 *   the node under the pointer, so both ends land on a whole card — the same
 *   target the target end has always had.
 *
 * **What a drop means is not decided here.** Every endpoint the drag offers is
 * answered by the model that will execute it (`canReconnect`, which
 * `reconnectEdge` itself gates on, asked through `verdictFor`), so the line is
 * only ever drawn as droppable where the commit will be accepted. That is what
 * keeps this canvas free of the failure the gesture invites: an anchor that can
 * be grabbed, dropped, and silently spring back. A move the model refuses — a
 * source that already has this transition, a source endpoint dropped on Start,
 * an endpoint the flow has no meaning for — reads as refused *while it is held
 * there*, so letting go is never a surprise. Over a card the answer is asked
 * once per landing rather than once per frame, since neither the edge nor the
 * end being dragged changes for the life of a gesture; over open canvas it is
 * asked per frame, because there the answer depends on *where* — the band under
 * the pointer decides the stage a release would grow, and whether it grows one
 * at all.
 *
 * **What is committed is where the pointer was let go**, hit-tested again on
 * the release rather than read off the last `pointermove`: browsers coalesce
 * moves under load, so a flick can end somewhere no move ever reported.
 *
 * Released on empty canvas, the destination end grows the stage it was reaching
 * for, previewed as a ghost card at the drop point. The source end has no such
 * move — a stage made there would have nothing flowing into it, the same reason
 * `addStageFromNode` grows one only out of a source — so over empty canvas it
 * reads as a refusal rather than springing back unexplained.
 *
 * Pointer-only, like the connect gesture it belongs beside — and like it, with
 * no keyboard or assistive-technology equivalent yet: the anchors are painted
 * on a decorative layer with no focus target, and the inspector edits a
 * transition's fields, not its endpoints. Deleting the edge and drawing a new
 * one remains the only non-pointer route, the same gap the canvas's other
 * creation gestures have.
 *
 * @package
 */

import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import {
	Position,
	ViewportPortal,
	getBezierPath,
	useReactFlow,
} from '@xyflow/react';
import { __ } from '@wordpress/i18n';
import { useEdgePlan } from './EdgePlanProvider';
import { arrowTip, outward } from './edge-geometry';
import { useSourceHandles } from './source-handles';
import { REGION_NODE_TYPE, STAGE_HEIGHT, STAGE_WIDTH } from './graph-model';

/**
 * The invisible circle the pointer has to be inside to grab an end, and the
 * painted ring that says it is there. The grab is wider than the ring for the
 * same reason the edge carries a wide invisible hit stroke: the mark is small
 * and the pointer is not precise.
 */
const GRAB_RADIUS = 11;
const RING_RADIUS = 4.5;

/**
 * The border a curve leaves by, mirrored — where the free end of a drag is
 * assumed to arrive from while it is still over open canvas. React Flow's own
 * connection line does the same with the handle it started at.
 */
const OPPOSITE = {
	[ Position.Top ]: Position.Bottom,
	[ Position.Bottom ]: Position.Top,
	[ Position.Left ]: Position.Right,
	[ Position.Right ]: Position.Left,
};

/**
 * Push a point clear of a handle rect, along the border's outward normal.
 *
 * The source anchor sits on `plan.source`, which for the commonest edge of all —
 * a plain stage leaving by its bottom border — is exactly where the card's drag
 * grip is. `EdgeOverlay` meets the same collision and resolves it by drawing
 * nothing: a socket there would be a blob on the grip, and the grip already
 * reads as the port. An anchor cannot do the same. It is not decoration but the
 * only control that moves this end of the transition, and its invisible grab
 * disc is wider than the grip it would cover — so yielding the spot would trade
 * a cosmetic overlap for the loss of both gestures: no source rewire, and no
 * new connection out of a stage while one of its transitions is selected.
 *
 * So it steps aside instead, onto the line it belongs to, just past the far
 * edge of whatever covers it. Measured from the rect rather than nudged by a
 * constant because the grip's pill and an AI stage's outcome badges are
 * different sizes, and "just clear of it" is the rule either way.
 *
 * Exported for its tests: the component can only be exercised against a live
 * React Flow store.
 *
 * @param {{ x: number, y: number }} point The anchor's planned spot.
 * @param {?Object}                  rect  The handle covering it, if any.
 * @param {string}                   side  The border the edge leaves by.
 * @return {{ x: number, y: number }} The spot to draw it at.
 */
export function clearOf( point, rect, side ) {
	if ( ! rect ) {
		return point;
	}
	// The direction the curve leaves that border by — `edge-geometry`'s, the
	// same one `arrowTip` above measures the head's clearance along.
	const away = outward( side );
	// How far past the rect's far edge the anchor has to travel before the grab
	// disc stops overlapping it: the rect's remaining depth in the direction of
	// travel, plus the disc's own radius. `away` is axis-aligned, so the dot
	// product below picks the axis that matters and zeroes the other.
	const far = {
		x: away.x > 0 ? rect.x + rect.width : rect.x,
		y: away.y > 0 ? rect.y + rect.height : rect.y,
	};
	const depth = away.x * ( far.x - point.x ) + away.y * ( far.y - point.y );
	const step = Math.max( 0, depth ) + GRAB_RADIUS;
	return { x: point.x + away.x * step, y: point.y + away.y * step };
}

/**
 * Where an edge's two ends are drawn, in flow coordinates.
 *
 * The departure is the path's own start — the socket is stamped there. The
 * arrival is not the path's end but the arrowhead's tip, which `arrowTip` is
 * the one statement of (`EdgeOverlay` stamps the head on the same point), so
 * the anchor goes on the head rather than on the gap behind it.
 *
 * @param {Object} plan The edge's finished plan.
 * @return {{ source: { x: number, y: number }, target: { x: number, y: number } }}
 *         The two grab points.
 */
function endsOf( plan ) {
	return { source: plan.source, target: arrowTip( plan ) };
}

/**
 * What is under the pointer: the node it would land on, or whether it is over
 * open canvas.
 *
 * A region's band is empty canvas, not a landing: dropping inside one is how a
 * new stage takes that band's status. Named here rather than left to the band's
 * `pointer-events: none` (`layout.js`) for the reason `handleConnectEnd` names
 * it — the gesture the whole band exists to receive should not depend on a
 * stylesheet winning a cascade tie.
 *
 * @param {number} clientX Pointer x, in client coordinates.
 * @param {number} clientY Pointer y, in client coordinates.
 * @return {{ node: ?string, onPane: boolean }} The node id under the pointer,
 *         and whether the pointer is over the canvas at all.
 */
function dropAt( clientX, clientY ) {
	const under = document.elementFromPoint( clientX, clientY );
	const node = under?.closest?.( '.react-flow__node' );
	if (
		node &&
		! node.classList.contains( `react-flow__node-${ REGION_NODE_TYPE }` )
	) {
		return { node: node.getAttribute( 'data-id' ), onPane: true };
	}
	return {
		node: null,
		onPane: Boolean( under?.closest?.( '.react-flow__pane' ) ),
	};
}

/**
 * @param {Object}   props
 * @param {?Object}  props.anchor                The edge to draw anchors for —
 *                                               `{ id, from, to, outcome, ends,
 *                                               className }` — or null.
 * @param {Function} props.verdictFor            `( edge, end, node, onPane )` →
 *                                               `'valid' | 'invalid' |
 *                                               'unchanged' | 'create'`.
 * @param {Function} props.ghostFor              `( clientX, clientY )` → the
 *                                               flow-coordinate top-left a
 *                                               stage created here would take,
 *                                               clamping included.
 * @param {Function} props.onReconnect           `( edge, end, node )` — commit a
 *                                               move onto an existing node.
 * @param {Function} props.onReconnectToNewStage `( edge, client )` — commit a
 *                                               release on empty canvas.
 * @param {Function} props.onDragChange          `( edgeId )` — a drag started
 *                                               or ended.
 * @return {?JSX.Element} The anchor layer.
 */
export default function EdgeAnchors( {
	anchor,
	verdictFor,
	ghostFor,
	onReconnect,
	onReconnectToNewStage,
	onDragChange,
} ) {
	const { screenToFlowPosition } = useReactFlow();
	const { handleUnder } = useSourceHandles();

	// The live drag: which edge and which of its ends. Held rather than derived
	// so the gesture survives the pointer leaving the edge it started on.
	const [ session, setSession ] = useState( null );

	// Where the free end currently is and what would happen if it were let go
	// there. The state drives the render; the ref is what the release handler
	// reads, since the pointer handlers are bound once per drag and would
	// otherwise close over the first frame's value.
	const [ preview, setPreview ] = useState( null );
	const previewRef = useRef( null );

	const edge = session ? session.edge : anchor;
	const plan = useEdgePlan( edge?.id || null )?.plan || null;

	// The press began on the anchor and — over open canvas — ends on the pane,
	// so the browser synthesizes one click on the box that contains both: the
	// pane itself, whose own handler clears the selection (`onPaneClick`, and
	// React Flow's `resetSelectedElements` behind it). That would undo the
	// selection the release just set — the new stage the author has to name
	// next. React Flow suppresses the same click after its own drop-on-pane
	// gesture; this one has to say so itself.
	//
	// Armed here rather than inside the drag effect, because arming it is the
	// last thing a release does and ENDING the drag is the second-to-last: the
	// effect's own cleanup runs on the session it just closed, and would take
	// the listener down again before the click it was armed for ever arrived.
	// Held in a ref so a disarm has something to remove.
	//
	// Scoped to the canvas, and to this turn of the event loop, because the
	// click it waits for is not always coming: `begin` calls `preventDefault`
	// on the press, which suppresses the compatibility mouse events, so a
	// release over a card produces no click at all. An unscoped listener left
	// armed for one that never arrives eats the author's next real click
	// instead — Save, a field, a menu item — and the press appears to do
	// nothing whatever.
	const swallowRef = useRef( null );
	const disarmTimerRef = useRef( null );

	const disarmClick = useCallback( () => {
		if ( disarmTimerRef.current ) {
			window.clearTimeout( disarmTimerRef.current );
			disarmTimerRef.current = null;
		}
		if ( swallowRef.current ) {
			document.removeEventListener( 'click', swallowRef.current, true );
			swallowRef.current = null;
		}
	}, [] );

	const swallowNextClick = useCallback( () => {
		disarmClick();
		const swallow = ( event ) => {
			// The canvas's own click, and only that one. The synthesized click
			// is aimed at the box holding both ends of the gesture, which is
			// inside the flow wrapper wherever the release landed; anything
			// outside it is the author's next move and has to reach its
			// handler.
			if ( event.target?.closest?.( '.wf-canvas__viewport' ) ) {
				event.stopPropagation();
			}
			disarmClick();
		};
		swallowRef.current = swallow;
		document.addEventListener( 'click', swallow, true );
		// The synthesized click, when there is one, is dispatched with the
		// release that caused it — so anything still armed once this turn of
		// the loop is over was waiting for a click that is not coming.
		disarmTimerRef.current = window.setTimeout( disarmClick, 0 );
	}, [ disarmClick ] );

	// A release outside the window never produces the click it was armed for,
	// and an armed listener left behind would eat an unrelated one. The next
	// press is the latest moment that can still be true, and unmounting is the
	// other way this layer goes away.
	useEffect( () => disarmClick, [ disarmClick ] );

	const begin = useCallback(
		( event, end ) => {
			// Left button only, like every other drag on the canvas.
			if ( event.button !== 0 || ! anchor ) {
				return;
			}
			disarmClick();
			// The anchor floats over the canvas; without this the press starts
			// a pane drag underneath it and the graph pans away.
			event.stopPropagation();
			event.preventDefault();
			previewRef.current = null;
			setPreview( null );
			setSession( { edge: anchor, end } );
			onDragChange( anchor.id );
		},
		[ anchor, onDragChange, disarmClick ]
	);

	useEffect( () => {
		if ( ! session ) {
			return undefined;
		}
		const { edge: dragged, end } = session;

		const close = () => {
			setSession( null );
			setPreview( null );
			previewRef.current = null;
			onDragChange( null );
		};

		// The verdict depends on the edge and the end being dragged — both fixed
		// for the life of this session — and on what the pointer is over. Frames
		// that stay over the same card ask the model the same question, so it
		// is asked once per landing rather than once per frame. The effect is
		// re-run (and this cleared) if `verdictFor` changes identity, which is
		// how a change to the sequence behind the drag would reach it.
		//
		// Open canvas is not cached: there the answer depends on *where*, since
		// the band under the pointer decides the stage a release would grow.
		const verdicts = new Map();
		const verdictAt = ( node, onPane, client ) => {
			if ( ! node ) {
				return verdictFor( dragged, end, null, onPane, client );
			}
			if ( ! verdicts.has( node ) ) {
				verdicts.set(
					node,
					verdictFor( dragged, end, node, onPane, client )
				);
			}
			return verdicts.get( node );
		};

		const previewAt = ( clientX, clientY ) => {
			const { node, onPane } = dropAt( clientX, clientY );
			const verdict = verdictAt( node, onPane, {
				x: clientX,
				y: clientY,
			} );
			return {
				// The pointer itself, which the lead line follows.
				at: screenToFlowPosition( { x: clientX, y: clientY } ),
				client: { x: clientX, y: clientY },
				node,
				verdict,
				// Where the card would actually land, which is not the pointer
				// wherever the drop's clamp has something to say. Only a
				// 'create' draws one, so only a 'create' pays for the answer.
				ghost:
					verdict === 'create' ? ghostFor( clientX, clientY ) : null,
			};
		};

		const track = ( event ) => {
			const next = previewAt( event.clientX, event.clientY );
			previewRef.current = next;
			setPreview( next );
		};

		const release = ( event ) => {
			const moved = previewRef.current;
			// Pressed and let go without moving: a grab handle is not a button,
			// so there is nothing to do — and no drag for a stray click to be
			// the tail of.
			if ( ! moved ) {
				close();
				return;
			}
			// Where the pointer was *let go*, asked again here rather than read
			// off the last `pointermove`. Browsers coalesce moves under load, so
			// a flick-and-release can end at coordinates no move ever reported —
			// committing the last-hovered stage, or growing one at a stale
			// point. The release event knows where it happened; ask it.
			const landed = previewAt( event.clientX, event.clientY );
			swallowNextClick();
			close();
			if ( landed.verdict === 'valid' ) {
				onReconnect( dragged, end, landed.node );
				return;
			}
			if ( landed.verdict === 'create' ) {
				onReconnectToNewStage( dragged, landed.client );
			}
			// 'unchanged' and 'invalid' spring back. The line was drawn as one
			// or the other for as long as it was held there, so the snap back
			// is the answer to something already asked.
		};

		const abandon = ( event ) => {
			if ( event.key === 'Escape' ) {
				close();
			}
		};

		document.addEventListener( 'pointermove', track );
		document.addEventListener( 'pointerup', release );
		// A pointer stream can end without a release — a pen or touch gesture
		// the browser takes over, a device removed. Without this the session
		// would stay open with no pointer in it: the edge held invisible
		// (`is-reconnecting`), the lead line tracking a cursor that is no
		// longer dragging, and the next click anywhere committing whatever the
		// last move had reached.
		document.addEventListener( 'pointercancel', close );
		document.addEventListener( 'keydown', abandon );
		return () => {
			document.removeEventListener( 'pointermove', track );
			document.removeEventListener( 'pointerup', release );
			document.removeEventListener( 'pointercancel', close );
			document.removeEventListener( 'keydown', abandon );
		};
	}, [
		swallowNextClick,
		session,
		screenToFlowPosition,
		verdictFor,
		ghostFor,
		onReconnect,
		onReconnectToNewStage,
		onDragChange,
	] );

	// Nothing engaged, or its nodes aren't measured yet and there is no plan to
	// place anything from.
	if ( ! edge || ! plan ) {
		return null;
	}

	// The departure end steps clear of any exit handle it lands on — for a plain
	// stage that is the drag grip, in exactly this spot. See `clearOf`.
	const drawn = endsOf( plan );
	const points = {
		source: clearOf(
			drawn.source,
			handleUnder( edge.from, drawn.source ),
			plan.sourcePos
		),
		target: drawn.target,
	};
	const held = session ? session.end : null;
	// The end the line is still pinned to while the other one travels.
	const pinned = held === 'source' ? 'target' : 'source';
	const pinnedSide = pinned === 'source' ? plan.sourcePos : plan.targetPos;

	const lead =
		preview &&
		getBezierPath( {
			sourceX: points[ pinned ].x,
			sourceY: points[ pinned ].y,
			sourcePosition: pinnedSide,
			targetX: preview.at.x,
			targetY: preview.at.y,
			targetPosition: OPPOSITE[ pinnedSide ],
		} )[ 0 ];

	const anchorFor = ( end ) => (
		<g
			key={ end }
			// `nopan`/`nodrag` are React Flow's own opt-outs, read by the pane's
			// zoom filter and the node drag filter off the pressed element.
			// Stopping the React-synthetic pointerdown in `begin` cannot reach
			// either — both bind natively, below the root React delegates from —
			// so the classes are what actually keep the graph still under the
			// grab. The repo already marks the edge's own controls this way.
			className={ `wf-edge-anchors__anchor wf-edge-anchors__anchor--${ end } nodrag nopan` }
			transform={ `translate(${ points[ end ].x } ${ points[ end ].y })` }
			onPointerDown={ ( event ) => begin( event, end ) }
		>
			<title>
				{ end === 'source'
					? __(
							'Drag to move where this transition starts',
							'vip-workflows'
					  )
					: __(
							'Drag to move where this transition goes',
							'vip-workflows'
					  ) }
			</title>
			<circle className="wf-edge-anchors__grab" r={ GRAB_RADIUS } />
			<circle className="wf-edge-anchors__ring" r={ RING_RADIUS } />
		</g>
	);

	return (
		<ViewportPortal>
			<svg
				className={ [ 'wf-edge-anchors', session && 'is-dragging' ]
					.filter( Boolean )
					.join( ' ' ) }
				focusable="false"
				aria-hidden="true"
			>
				{ /* The edge's own tones (outcome, outbound, disabled) ride on
				     the group, the same way `EdgeOverlay` wears them, so an
				     anchor is unmistakably part of the line it belongs to —
				     and a drop the model would accept keeps that colour. The
				     verdict rides here too, and only overrules it to say the
				     move is refused or is no move at all. */ }
				<g
					className={ [
						edge.className,
						preview && `is-${ preview.verdict }`,
					]
						.filter( Boolean )
						.join( ' ' ) }
				>
					{ lead && (
						<path className="wf-edge-anchors__lead" d={ lead } />
					) }
					{ preview?.verdict === 'create' && preview.ghost && (
						<rect
							className="wf-edge-anchors__ghost"
							x={ preview.ghost.x }
							y={ preview.ghost.y }
							width={ STAGE_WIDTH }
							height={ STAGE_HEIGHT }
						/>
					) }
					{ /* The end being dragged *is* the pointer, so only the
					     other one is still drawn. */ }
					{ edge.ends.source &&
						held !== 'source' &&
						anchorFor( 'source' ) }
					{ edge.ends.target &&
						held !== 'target' &&
						anchorFor( 'target' ) }
				</g>
			</svg>
		</ViewportPortal>
	);
}
