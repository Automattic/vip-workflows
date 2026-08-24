/**
 * EdgeOverlay — the parts of an edge that have to be drawn above the cards.
 *
 * React Flow paints its edge layer below its node layer, and the canvas leans on
 * that: a line passing behind a stage is the design (`edge-tunnel.js`), not a
 * defect. Two things are not, and both live here:
 *
 * - **The underpass ghost.** Where an edge passes behind a stage the visible
 *   stroke breaks, and the buried stretch is repainted faint and dotted, so the
 *   line reads as continuous without reading as drawn *on* the card.
 * - **The end marks** — the socket where an edge leaves and the arrowhead where
 *   it arrives. These sit on their own stage's border, and a card overlapping
 *   that border used to swallow them: stages sit at `STAGE_Z` and every edge at
 *   `EDGE_Z` below it, so a neighbour a stage happens to overlap covers the very
 *   marks that say where its transitions attach. Since nodes can be placed by
 *   hand and can overlap deliberately, that is now a normal arrangement rather
 *   than an edge case. Above the cards they always show.
 *
 * **An agent outcome edge leaves by its own mark, not by a plain socket.** An
 * AI stage can send two outcomes to one destination, and then two lines run
 * between the same pair of cards. Neither the tone nor the glyph used to be
 * painted at rest, so which line was pass and which was fail was unanswerable
 * without clicking one — reported as exactly that. So an outcome edge's
 * departure is a filled disc in the outcome's tone carrying the outcome's
 * glyph (`outcome-icons.js`, the same one the stage's badge uses), drawn
 * permanently. It is `PORT_SPREAD` across, the pitch two ports on one border
 * are normally placed at (`edge-spread.js`, and `EDGE_PITCH` for a bundled
 * pair), so two marks along a border touch rather than pile up.
 *
 * The marks are drawn here rather than as SVG `marker-start` / `marker-end` on
 * the edge because a marker is painted with the path it belongs to, in that
 * path's layer — there is no lifting one out. Orientation is not lost by moving
 * them: every edge leaves and meets its border square (the port stub is a
 * straight run along the outward normal), so the normal *is* the tangent, and
 * placing them from it is exact rather than an approximation of what the marker
 * would have measured.
 *
 * Clearing the cards has one cost, and it is paid here rather than by lowering
 * the layer: a node's own exit handles live inside the card's stacking context
 * and cannot be raised out of it, so a mark landing on one painted over it —
 * the socket of an edge leaving the bottom border sat as a blob on the drag
 * grip. A plain *socket* whose point falls inside one of its own node's source
 * handles is therefore not drawn at all. The handle is the port at that spot:
 * it is what the reader aims at to start a connection, and it says where the
 * edge departs better than a 4px dome stamped on top of it does.
 *
 * An outcome mark is not covered by that rule, because it is not the same
 * trade. A dome says only "an edge attaches here", which the handle already
 * says; the mark says *which outcome* leaves here, which the handle says only
 * while it is painted — and at rest it is transparent. So the outcome mark
 * yields on the same terms the arrowhead does (below): while the badge under
 * it is actually up, and not a moment longer.
 *
 * **Arrowheads yield only to a painted outcome badge — never to the grip, and
 * never at rest.** The socket rule is geometric and cannot see whether a grip
 * is actually painted — grips are transparent until their stage is hovered —
 * so extending it verbatim to arrowheads cost more than it bought: a back edge
 * arriving dead centre on a bottom border ("send back to draft", the commonest
 * shape there is) lost its arrowhead *permanently*, leaving nothing at rest to
 * say where the edge lands. An arrival mark is the only thing that
 * distinguishes the two ends of a line; a departure mark is not, because the
 * handle underneath it already reads as the port. So sockets yield to the grip
 * and arrowheads keep clear of that rule entirely.
 *
 * An AI stage's outcome badges are the one case with a real collision: each
 * carries a glyph (`StageNode`), and an arrowhead arriving under one stamped
 * itself over the very mark the badge exists to show. The badges paint at the
 * same moments the grip does — their stage hovered, or a connection dragged
 * from them — so the arrowhead yields for exactly that long and no longer:
 * while the badge is up the head fades out (`is-yielding`; the stylesheet
 * transitions it against the badge's own reveal), and the moment the badge
 * goes the head returns. Whether the thing underneath is painted is precisely
 * what the socket rule could not know, so the gate here is the same pair of
 * signals the stylesheet paints the badge by: the hovered stage (tracked by
 * `GraphCanvas`, which owns node events) and the handle a connection is in
 * flight from (the store). The anonymous grip never qualifies —
 * `coveredOutcomeBadge` counts only handles named for an agent outcome — which
 * is what keeps the back-edge case above true. Target handles were never in
 * scope either way — a stage's is the invisible sheet over the whole card
 * (`StageNode`), which marks nothing and would otherwise swallow every
 * arrowhead on the canvas.
 *
 * Two consequences worth naming. A grip is transparent until its stage is
 * hovered, so the commonest socket — dead centre of a bottom border, under the
 * grip — is gone at rest, and the line leaving the border is what says so.
 * And Start, whose handle is always visible and whose edge is pinned to it
 * (`pinToStartHandle`), never draws a socket at all, which is the intent.
 *
 * Everything drawn here wears the state classes its edge does (outcome tone,
 * outbound, hovered, selected — assembled in `GraphCanvas`), so it changes
 * colour with the line it belongs to. The layer takes no pointer events: it is a
 * drawing, not a target, and the edge's own hit stroke stays the thing to click.
 *
 * @package
 */

import { memo } from '@wordpress/element';
import { ViewportPortal, useStore } from '@xyflow/react';
import { Icon } from '@wordpress/components';
import { useEdgePlans } from './EdgePlanProvider';
import { useSourceHandles } from './source-handles';
import { arrowTip, outward } from './edge-geometry';
import { isAgentOutcome } from './graph-model';
import { OUTCOME_ICONS } from './outcome-icons';
import { PORT_SPREAD, TUNNEL_GHOST } from './edge-constants';

/**
 * The two end marks, drawn pointing along +x so one rotation places each.
 *
 * From the Figma port spec (`2210:680`): the socket is a filled semicircle
 * flush with the border it leaves by, doming the way the edge goes; the head is
 * an open chevron with 5px arms at a right angle, its tip on the path's end.
 */
const SOCKET = 'M 0,-4 A 4,4 0 0 1 0,4 Z';
const ARROW = 'M -3.54,-3.54 L 0,0 L -3.54,3.54';

/**
 * How far the head reaches around its tip, in px — the chevron's arms run
 * 3.54px back from it, at the line's own stroke width. An outcome badge's
 * bounds are inflated by this when asking whether a head covers the badge
 * (`coveredOutcomeBadge`), so a head grazing the badge's edge counts too.
 */
const ARROW_REACH = 4;

/**
 * The outcome mark's diameter, and the glyph inside it.
 *
 * `PORT_SPREAD` is the pitch two ports on one border are normally placed at —
 * the spread pass opens a cluster to exactly that, and a bundle closes its
 * members to `EDGE_PITCH`, which is the same number. Sized to it, two marks at
 * that pitch sit rim to rim and neither eats the other's glyph.
 *
 * It is a pitch, not a floor. A border with more ports on it than its band can
 * hold at `PORT_SPREAD` is spaced to whatever the band divides into instead
 * (`edge-spread.js` clamps the spacing to `( hi - lo ) / count`), and there the
 * discs do overlap at the rim — the later one clips the outer edge of its
 * neighbour's glyph. That is a stage crowded past what a border can show, and
 * the fix for it is fewer ports on the border, not a smaller mark.
 *
 * The glyph takes the same share of the disc the badge's does (18 in 22), so
 * the two read as the same mark at two sizes.
 */
const OUTCOME_MARK = PORT_SPREAD;
const OUTCOME_GLYPH = Math.round( ( OUTCOME_MARK * 18 ) / 22 );

/**
 * The state carried on each edge object that the overlay's colour follows, plus
 * the two nodes its marks sit on, as a string signature so unrelated store
 * activity doesn't re-render the layer — the plans context already covers
 * geometry.
 *
 * @param {Object} state React Flow store state.
 * @return {string} One `id|classes|selected|source|target|outcome` row per edge.
 */
export function selectEdgeStates( state ) {
	return state.edges
		.map( ( edge ) =>
			[
				edge.id,
				edge.className || '',
				!! edge.selected,
				edge.source,
				edge.target,
				edge.data?.outcome || '',
			].join( '|' )
		)
		.join( '\n' );
}

/**
 * Read that signature back into one record per edge.
 *
 * The other half of `selectEdgeStates`, and next to it on purpose: the two are
 * one format written twice, and a field added to the row but not to the read
 * shifts every field after it — which does not throw, it just draws the wrong
 * marks. Exported with its writer so a test can hold them to each other.
 *
 * @param {string} signature The joined rows.
 * @return {Object} `{ className, selected, source, target, outcome }` by edge id.
 */
export function readEdgeStates( signature ) {
	const states = {};
	signature.split( '\n' ).forEach( ( row ) => {
		if ( ! row ) {
			return;
		}
		const [ id, className, selected, source, target, outcome ] =
			row.split( '|' );
		states[ id ] = {
			className,
			selected: selected === 'true',
			source,
			target,
			outcome,
		};
	} );
	return states;
}

/**
 * The moment a connection drag makes a handle paint without a hover: React
 * Flow marks the handle a connection is in flight from (`.connectingfrom`),
 * and the stylesheet keeps that one handle up for the length of its own drag —
 * which outlives the hover as soon as the pointer leaves the node.
 *
 * A joined string so unrelated store churn during the drag (the connection
 * position changes on every pointer move) never re-renders the layer.
 *
 * @param {Object} state React Flow store state.
 * @return {string} `nodeId|handleId` of the dragged-from handle, or ''.
 */
function selectConnectingHandle( state ) {
	if ( ! state.connection.inProgress ) {
		return '';
	}
	return [
		state.connection.fromNode?.id || '',
		state.connection.fromHandle?.id || '',
	].join( '|' );
}

/**
 * The outcome badge a point falls on, if any.
 *
 * Works on the measured source-handle rects of one node — the mark's own end
 * node, the same scoping the socket rule uses — inflated by the head's reach
 * so a chevron grazing a badge's edge counts as covering it. Only a handle
 * whose id names an agent outcome qualifies: the anonymous drag grip must
 * never eat an arrival mark, because it is transparent at rest and a back edge
 * arriving dead centre on it would lose its arrowhead with nothing left to
 * show where the edge lands (the regression the outcome-only rule guards
 * against — see the header).
 *
 * Exported for its tests: the component can only exercise it against a live
 * React Flow store.
 *
 * @param {{ x: number, y: number }} point   The mark's tip, in flow coordinates.
 * @param {?Array}                   handles One node's source-handle rects
 *                                           (`{ id, x, y, width, height }`).
 * @return {?string} The covered badge's outcome, or null.
 */
export function coveredOutcomeBadge( point, handles ) {
	return (
		( handles || [] ).find(
			( rect ) =>
				isAgentOutcome( rect.id ) &&
				point.x >= rect.x - ARROW_REACH &&
				point.x <= rect.x + rect.width + ARROW_REACH &&
				point.y >= rect.y - ARROW_REACH &&
				point.y <= rect.y + rect.height + ARROW_REACH
		)?.id || null
	);
}

/**
 * Degrees of a unit vector, for an SVG `rotate()`.
 *
 * @param {{ x: number, y: number }} v The vector.
 * @return {number} Its angle in degrees.
 */
const angleOf = ( v ) => ( Math.atan2( v.y, v.x ) * 180 ) / Math.PI;

function EdgeOverlayComponent( { hoveredNodeId = null } ) {
	const plans = useEdgePlans();
	const stateSignature = useStore( selectEdgeStates );
	const { handles, occupied } = useSourceHandles();
	const connectingHandle = useStore( selectConnectingHandle );

	const ids = Object.keys( plans );
	if ( ! ids.length ) {
		return null;
	}

	const states = readEdgeStates( stateSignature );

	const classesFor = ( id, base ) => {
		const state = states[ id ] || { className: '', selected: false };
		return [ base, state.className, state.selected && 'selected' ]
			.filter( Boolean )
			.join( ' ' );
	};

	// Whether the outcome badge a mark lands on is currently *painted*. Both
	// yield rules turn on this and nothing else: geometry alone cannot tell a
	// badge that is up from one that is transparent, and yielding to a
	// transparent badge is how a mark goes missing with nothing in its place.
	// The signals are the pair the stylesheet reveals a badge by — its stage
	// hovered, or a connection in flight from that very handle.
	const badgeIsUp = ( nodeId, point ) => {
		const badge = coveredOutcomeBadge( point, handles[ nodeId ] );
		if ( ! badge ) {
			return false;
		}
		return (
			nodeId === hoveredNodeId ||
			`${ nodeId }|${ badge }` === connectingHandle
		);
	};

	return (
		<ViewportPortal>
			<svg
				className="wf-edge-overlay"
				aria-hidden="true"
				focusable="false"
			>
				{ ids.map( ( id ) => {
					const { plan, tunnel } = plans[ id ];
					const state = states[ id ];
					const leaves = outward( plan.sourcePos );
					const arrives = outward( plan.targetPos );
					const tip = arrowTip( plan );
					// The head yields while — and only while — the outcome
					// badge underneath it is painted: its stage hovered, or a
					// connection in flight from that badge. See the header.
					const yields = badgeIsUp( state?.target, tip );
					// An outcome edge departs by its own mark rather than by a
					// plain socket, and that mark yields on the same terms —
					// the badge it would sit under is the same statement, at a
					// size you can reach for.
					const outcome = isAgentOutcome( state?.outcome )
						? state.outcome
						: null;
					return (
						<g key={ id }>
							{ tunnel && (
								<path
									className={ classesFor(
										id,
										'wf-edge-overlay__ghost'
									) }
									d={ plans[ id ].d }
									strokeDasharray={ tunnel.ghost }
									opacity={ TUNNEL_GHOST }
								/>
							) }
							{ outcome && (
								<g
									className={ classesFor(
										id,
										[
											'wf-edge-overlay__outcome',
											badgeIsUp(
												state?.source,
												plan.source
											) && 'is-yielding',
										]
											.filter( Boolean )
											.join( ' ' )
									) }
									transform={ `translate(${ plan.source.x } ${ plan.source.y })` }
								>
									<circle
										className="wf-edge-overlay__outcome-disc"
										r={ OUTCOME_MARK / 2 }
									/>
									{ /* `<Icon>` renders a nested `<svg>` with
									     its own 0 0 24 24 viewBox, so the glyph
									     scales itself to `size` and this group
									     is only here to centre it on the port —
									     a nested `<svg>` starts at its parent's
									     origin. */ }
									<g
										transform={ `translate(${
											-OUTCOME_GLYPH / 2
										} ${ -OUTCOME_GLYPH / 2 })` }
									>
										<Icon
											icon={ OUTCOME_ICONS[ outcome ] }
											size={ OUTCOME_GLYPH }
										/>
									</g>
								</g>
							) }
							{ ! outcome &&
								! occupied( state?.source, plan.source ) && (
									<path
										className={ classesFor(
											id,
											'wf-edge-overlay__socket'
										) }
										d={ SOCKET }
										transform={ `translate(${
											plan.source.x
										} ${ plan.source.y }) rotate(${ angleOf(
											leaves
										) })` }
									/>
								) }
							<path
								className={ classesFor(
									id,
									[
										'wf-edge-overlay__arrow',
										yields && 'is-yielding',
									]
										.filter( Boolean )
										.join( ' ' )
								) }
								d={ ARROW }
								transform={ `translate(${ tip.x } ${
									tip.y
								}) rotate(${ angleOf( {
									x: -arrives.x,
									y: -arrives.y,
								} ) })` }
							/>
						</g>
					);
				} ) }
			</svg>
		</ViewportPortal>
	);
}

export default memo( EdgeOverlayComponent );
