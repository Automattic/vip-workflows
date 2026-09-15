/**
 * TransitionEdge — a transition rendered as an edge on the sequence canvas.
 *
 * The geometry is not decided here. Ports, spreads, bundles and underpass
 * breaks are cross-edge decisions, so every edge on the canvas is planned
 * together (`edge-pipeline.js`, run by `EdgePlanProvider`) and this component
 * reads its finished plan from context: a path `d`, the midpoint its marks
 * stand on, and — where the line passes behind a stage — a dash pattern that
 * breaks the stroke short of the card, with a small cup closing each end.
 *
 * On top of that path it adds three things:
 *
 * - a halo drawn under the line, which the stylesheet fades in on hover and
 *   selection — the edge's answer to the focus ring a stage node gets, since an
 *   SVG path can take neither `outline` nor `box-shadow`;
 * - a label pill at the path midpoint, shown while the edge is hovered or
 *   selected, which is what selects the transition;
 * - a shared-transition mark on that midpoint, on every one of a set of
 *   outcome edges backed by one transition record, painted at rest.
 *
 * That last one is not decoration. An AI stage can route two outcomes to the
 * same destination, and a stage holds at most one transition per target — so
 * the two edges are one record drawn twice, and configuring either configures
 * both. Two plain lines said the opposite: two transitions, each with its own
 * settings. So every line of the set wears the mark: the question it answers —
 * "does editing this one reach anything else?" — is asked of whichever line the
 * reader is following, and a mark on one line leaves the other saying nothing.
 * Which outcomes are tied is then read off which lines carry it, rather than
 * from a legend naming a set the reader still has to find.
 *
 * That is what fixes its size. It is a disc one lane pitch across — the same
 * `PORT_SPREAD` `EdgeOverlay` sizes an outcome's departure mark by, and the gap
 * a bundle of co-travelling edges closes to (`edge-bundle.js`) — so the marks on
 * a bundled pair sit rim to rim instead of piling up. It carries no tooltip and
 * takes no pointer events: it sits on the line permanently, and a
 * control-shaped thing that swallows a click without answering it would cost
 * the edge its own midpoint.
 *
 * It sits *on* the midpoint. It used to sit beside it, because the insert "+"
 * owned the point itself — that was where the "+" inserted, so that was where
 * it had to be drawn. With the "+" gone nothing else claims the point, and a
 * mark that reports a fact about the line belongs on the middle of it.
 *
 * ## The pill
 *
 * What replaced the "+", and not as a like-for-like swap: it is a target
 * before it is a label. A 22px circle on a 1px line is a hard thing to hit, and
 * the line was harder: selecting a transition meant getting the pointer almost
 * exactly onto a 1px stroke. Two changes answer that together: the
 * invisible stroke React Flow lays over the line is `EDGE_HIT_WIDTH` in
 * screen px rather than flow px, so hovering the edge no longer gets harder the
 * further out the canvas is zoomed, and the pill that hover reveals is a target
 * many times the size of the line for the click that follows — at every zoom
 * too, since it is scaled against the viewport the same way.
 *
 * Both are undone by hand, from the live zoom. React Flow zooms with a CSS
 * `scale()` on the HTML viewport that holds each edge's own `<svg>`, and
 * `vector-effect: non-scaling-stroke` only answers transforms inside the SVG,
 * so it leaves that one exactly where it was.
 *
 * It carries the label a writer will see on the button, derived — most
 * transitions store none, deliberately (`addTransition`), so `buildGraph` runs
 * the same `Move to {destination}` rule the server does and hands the result
 * down in `data.label`. An authored label wins there exactly as it does at
 * runtime, so what the pill says is what the writer's button will say.
 *
 * On a shared set the pill takes the link glyph as its leading mark. That is
 * the same fact the disc under it reports, said again at the moment the reader
 * is about to act on it — and it is what lets the disc keep the midpoint: the
 * pill covers it while shown, and would otherwise take the answer away exactly
 * when the question is being asked.
 *
 * Shown on hover and selection only. A pill on every edge at rest would be the
 * canvas restating what its own geometry already says — "Move to Review" on a
 * line that visibly lands on Review — and at bundle pitch several of them would
 * overlap. Hover-gated, at most two are ever on screen.
 *
 * A disabled transition keeps its pill, muted. Suppressing it would take the
 * enlarged target away from precisely the edges most likely to be selected and
 * deleted.
 *
 * What this component does *not* draw is either end mark, or the faint
 * continuation across a card it passes behind. All three have to sit above the
 * stages — see `EdgeOverlay`, which is where they are.
 *
 * Two textures can want the same stroke, and both are set here rather than in
 * the stylesheet so the precedence is a conditional and not a cascade race. A
 * disabled transition is drawn in the same dots as an underpass ghost — one
 * "this line is not the thing it looks like" texture, used twice — in its own
 * weak tone rather than the ghost's transparency. Where an edge is both, the
 * underpass wins: which stages the line passes under matters more than a
 * texture saying it is switched off, and the tone still carries that.
 *
 * The halo takes the underpass dash but never the disabled one. It breaks where
 * the line does, since it is that line's outline; a dotted hover ring is just a
 * dotted hover ring.
 *
 * Selection comes from React Flow's own edge click handling, on the pill as
 * much as on the line: `EdgeLabelRenderer` portals the pill out of the SVG edge
 * group in the DOM but not in the React tree, and React propagates events —
 * click, and enter/leave — along the React tree. So the pill's click reaches
 * `onEdgeClick`, and moving between the line and the pill neither leaves nor
 * re-enters the edge; the pill needs no handlers of its own.
 * Endpoints *are* draggable, but not by React Flow — its anchors sit where it
 * thinks the edge ends rather than where this one does, so the grab handles are
 * drawn on the planned ports by `EdgeAnchors` instead.
 *
 * @package
 */
import { memo } from '@wordpress/element';
import { BaseEdge, EdgeLabelRenderer, useStore } from '@xyflow/react';
import { Button, Icon } from '@wordpress/components';
import { link } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';
import { useEdgePlan } from './EdgePlanProvider';
import { agentOutcomeNames } from './graph-model';
import {
	EDGE_HIT_WIDTH,
	PORT_SPREAD,
	TUNNEL_DOT,
	TUNNEL_DOT_GAP,
} from './edge-constants';

/**
 * The shared mark's diameter, and the glyph inside it — sized here rather than
 * in the stylesheet because the number is `PORT_SPREAD` and has to stay it.
 *
 * Every line of a shared set wears one, and a shared set is exactly the kind of
 * thing the router gathers into a bundle, whose lanes close to that same pitch
 * (`EDGE_PITCH`, `edge-bundle.js`). A mark the width of the pitch therefore sits
 * rim to rim with its sibling; anything wider buries it. `EdgeOverlay` sizes an
 * outcome's departure mark from the same constant for the same reason, and the
 * glyph takes the share of the disc the stage badge's does (18 in 22), so all
 * three read as one mark at three sizes.
 */
const SHARED_MARK = PORT_SPREAD;
const SHARED_GLYPH = Math.round( ( SHARED_MARK * 18 ) / 22 );

/**
 * The viewport zoom, which the hit stroke and the pill are sized against.
 *
 * @param {Object} state React Flow store state.
 * @return {number} Current zoom.
 */
const selectZoom = ( state ) => state.transform[ 2 ];

function TransitionEdgeComponent( { id, data, selected } ) {
	const drawn = useEdgePlan( id );
	const zoom = useStore( selectZoom );

	// Both nodes have to be measured before there's anything to draw.
	if ( ! drawn ) {
		return null;
	}

	const { d, mid, tunnel } = drawn;
	const dashed = tunnel
		? { strokeDasharray: tunnel.dash, strokeLinecap: 'butt' }
		: undefined;
	const stroked =
		dashed ||
		( data?.disabled
			? { strokeDasharray: `${ TUNNEL_DOT } ${ TUNNEL_DOT_GAP }` }
			: undefined );

	// One line, one mark: the set is carried by every edge drawn from the
	// transition, and every one of them wears it — a reader following the fail
	// line is owed the same answer as one following the pass line. It goes with
	// the line while either end of this edge is being dragged, for the reason
	// the pill over it does: the line the mark stands on is hidden for the
	// length of the gesture (`GraphCanvas`), and a mark left floating over empty
	// canvas points at a midpoint that is about to move.
	const shared =
		data?.sharedOutcomes && ! data?.reconnecting
			? data.sharedOutcomes
			: null;

	// What the pill says: the label `buildGraph` derived for this transition,
	// which is the string the writer's button will carry. Absent on the
	// synthetic Start/End edges, which are not transitions and get no pill.
	const pill = data?.label || null;

	// Hidden while one of the edge's ends is being dragged: the line it stands on
	// the middle of is itself hidden for the length of that gesture
	// (`GraphCanvas`), and a pill floating with no line under it invites a click
	// on a transition whose midpoint is about to move.
	const pillVisible = ( data?.hovered || selected ) && ! data?.reconnecting;

	return (
		<>
			{ /* Under the line, and transparent until the edge is hovered or
			     selected — see `.wf-transition-edge__halo`. */ }
			<path
				className="wf-transition-edge__halo"
				d={ d }
				style={ dashed }
			/>
			{ /* `interactionWidth` is the invisible stroke React Flow lays
			     over the line for the pointer, in flow px. Divided by the zoom
			     it is `EDGE_HIT_WIDTH` screen px, so the target no longer
			     thins as the canvas is zoomed out. */ }
			<BaseEdge
				id={ id }
				path={ d }
				className="wf-transition-edge"
				style={ stroked }
				interactionWidth={ EDGE_HIT_WIDTH / zoom }
			/>
			{ /* The mouths of the underpasses: a semicircular cup closing each
			     end of every break, its chord square to the line and its dome
			     toward the card the line goes under. */ }
			{ ( tunnel?.caps || [] ).map( ( cap, index ) => (
				<path
					key={ index }
					className="wf-transition-edge__cap"
					d={ cap.d }
				/>
			) ) }
			{ /* Synthetic Start/End edges are structural: they carry no
			     transition record and so no pill, and no outcomes and so no
			     mark. They render nothing here. */ }
			{ ( pill || shared ) && (
				<EdgeLabelRenderer>
					{ /* Both children are out of flow and centred on the
					     midpoint by the -50%/-50% (`.wf-transition-edge__mark`,
					     `.wf-transition-edge__pill`), so the pill's width —
					     which is a stage name's, and so anything — moves
					     neither of them. The mark holds the point at rest; the
					     pill covers it while shown, and carries the same link
					     glyph so nothing is lost for that moment.

					     The wrapper's transform makes it a stacking context, so a
					     shown pill is lifted here rather than on the pill itself —
					     otherwise the next edge's mark, later in the layer, paints
					     over it. A hovered one goes above a merely selected one,
					     which is the one under the pointer. */ }
					<div
						className={ [
							'wf-transition-edge__controls',
							'nodrag',
							'nopan',
							pillVisible && 'is-visible',
							pillVisible && data?.hovered && 'is-hovered',
						]
							.filter( Boolean )
							.join( ' ' ) }
						style={ {
							transform: `translate(${ mid.x }px, ${ mid.y }px)`,
						} }
					>
						{ shared && (
							/* wpds-allow R7 -- a filled disc one lane pitch across, the mark `EdgeOverlay` draws an outcome's departure as, in the neutral tone: surface, radius and a knocked-out glyph, none of which a <Stack> carries, so binding the class to one restates each of those declarations as a library override and buys only the flex box. */
							<span
								className="wf-transition-edge__mark"
								style={ {
									width: SHARED_MARK,
									height: SHARED_MARK,
								} }
								role="img"
								aria-label={ sprintf(
									/* translators: %s: comma-separated agent outcome names, e.g. "On pass, On fail". */
									__(
										'%s share one transition',
										'vip-workflows'
									),
									agentOutcomeNames( shared )
								) }
							>
								<Icon icon={ link } size={ SHARED_GLYPH } />
							</span>
						) }
						{ pill && (
							<Button
								type="button"
								size="small"
								icon={ shared ? link : undefined }
								iconSize={ SHARED_GLYPH }
								className={ [
									'wf-transition-edge__pill',
									pillVisible && 'is-visible',
									data?.disabled && 'is-disabled',
								]
									.filter( Boolean )
									.join( ' ' ) }
								// Scaled against the viewport, so it is the
								// same size on screen at every zoom — the
								// large target the hit stroke leads to, not a
								// few pixels once the whole sequence fits.
								style={ {
									transform: `translate(-50%, -50%) scale(${
										1 / zoom
									})`,
								} }
								// No handlers: React Flow's own edge click and
								// hover reach it through the portal.
								// The pill elides a long destination name
								// rather than growing to the width of the
								// canvas. The accessible name is the full
								// string either way — this is what gets it
								// back for a pointer.
								title={ pill }
							>
								{ /* An array preserves Button's icon-and-text
								     layout while the label has an ellipsis wrapper. */ }
								{ [
									<span
										key="label"
										className="wf-transition-edge__pill-text"
									>
										{ pill }
									</span>,
								] }
							</Button>
						) }
					</div>
				</EdgeLabelRenderer>
			) }
		</>
	);
}

export default memo( TransitionEdgeComponent );
