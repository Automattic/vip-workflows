/**
 * TransitionEdge — a transition rendered as an edge on the sequence canvas.
 *
 * The geometry is not decided here. Ports, spreads, bundles and underpass
 * breaks are cross-edge decisions, so every edge on the canvas is planned
 * together (`edge-pipeline.js`, run by `EdgePlanProvider`) and this component
 * reads its finished plan from context: a path `d`, the midpoint for the
 * insert "+", and — where the line passes behind a stage — a dash pattern
 * that breaks the stroke short of the card, with a small cup closing each end.
 *
 * On top of that path it adds three things:
 *
 * - a halo drawn under the line, which the stylesheet fades in on hover and
 *   selection — the edge's answer to the focus ring a stage node gets, since an
 *   SVG path can take neither `outline` nor `box-shadow`;
 * - an insert-stage "+" at the path midpoint, shown while the edge is hovered
 *   or selected;
 * - a shared-transition mark beside that midpoint, on every one of a set of
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
 * a bundled pair sit rim to rim instead of piling up. A wider pill could be
 * afforded on one line of a pair and not on both.
 *
 * It carries no tooltip and takes no pointer events: it sits on the line
 * permanently, and a control-shaped thing that swallows a click without
 * answering it would cost the edge its own midpoint. It sits beside that
 * midpoint rather than on it because the "+" owns the point itself — that is
 * where the "+" inserts, so that is where it has to be drawn. What it means at
 * length is said by the panel it opens (`TransitionInspector`), which names
 * every outcome on the record; to assistive technology, by its own label.
 *
 * What it does *not* draw is either end mark, or the faint continuation across a
 * card it passes behind. All three have to sit above the stages — see
 * `EdgeOverlay`, which is where they are.
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
 * Selection comes from React Flow's own edge click handling. Endpoints *are*
 * draggable, but not by React Flow — its anchors sit where it thinks the edge
 * ends rather than where this one does, so the grab handles are drawn on the
 * planned ports by `EdgeAnchors` instead.
 *
 * @package
 */

import { memo } from '@wordpress/element';
import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react';
import { Icon } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { plus, link } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';
import { useEdgePlan } from './EdgePlanProvider';
import { agentOutcomeNames } from './graph-model';
import { PORT_SPREAD, TUNNEL_DOT, TUNNEL_DOT_GAP } from './edge-constants';

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

function TransitionEdgeComponent( { id, data, selected } ) {
	const drawn = useEdgePlan( id );

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

	// The midpoint goes with the click: it is where the "+" sits, so it is where
	// the stage the "+" makes should appear.
	const onInsertClick = ( e ) => {
		e.stopPropagation();
		data?.onInsertStage?.( mid );
	};

	// One line, one mark: the set is carried by every edge drawn from the
	// transition, and every one of them wears it — a reader following the fail
	// line is owed the same answer as one following the pass line. It goes with
	// the line while either end of this edge is being dragged, for the reason
	// the "+" beside it does: the line the mark stands on is hidden for the
	// length of the gesture (`GraphCanvas`), and a mark left floating over empty
	// canvas points at a midpoint that is about to move.
	const shared =
		data?.sharedOutcomes && ! data?.reconnecting
			? data.sharedOutcomes
			: null;

	return (
		<>
			{ /* Under the line, and transparent until the edge is hovered or
			     selected — see `.wf-transition-edge__halo`. */ }
			<path
				className="wf-transition-edge__halo"
				d={ d }
				style={ dashed }
			/>
			<BaseEdge
				id={ id }
				path={ d }
				className="wf-transition-edge"
				style={ stroked }
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
			     `onInsertStage` and no outcomes, so they render nothing
			     here. */ }
			{ ( data?.onInsertStage || shared ) && (
				<EdgeLabelRenderer>
					{ /* The "+" is the only child in flow, so the row
					     shrink-wraps to it and the -50%/-50% centres *the
					     button* on the midpoint — which is the point it inserts
					     a stage at, and so the point it has to be drawn over.
					     The shared mark hangs off its left edge out of flow
					     (`.wf-transition-edge__shared`); sharing the row, it
					     pushed the button half a mark clear of the midpoint the
					     click still used. */ }
					<Stack
						align="center"
						className="wf-transition-edge__controls nodrag nopan"
						style={ {
							transform: `translate(-50%, -50%) translate(${ mid.x }px, ${ mid.y }px)`,
						} }
					>
						{ shared && (
							/* wpds-allow R7 -- a filled disc one lane pitch across, the mark `EdgeOverlay` draws an outcome's departure as, in the neutral tone: surface, radius and a knocked-out glyph, none of which a <Stack> carries, so binding the class to one restates each of those declarations as a library override and buys only the flex box. */
							<span
								className="wf-transition-edge__shared"
								style={ {
									width: SHARED_MARK,
									height: SHARED_MARK,
								} }
								role="img"
								aria-label={ sprintf(
									/* translators: %s: comma-separated agent outcome names, e.g. "On pass, On fail". */
									__(
										'%s share one transition',
										'vip-workflow'
									),
									agentOutcomeNames( shared )
								) }
							>
								<Icon icon={ link } size={ SHARED_GLYPH } />
							</span>
						) }
						{ data?.onInsertStage && (
							<button
								type="button"
								className={ [
									'wf-add-button',
									'wf-transition-edge__add',
									// Hidden while one of the edge's ends is
									// being dragged: the line it marks the
									// middle of is itself hidden for the length
									// of that gesture (`GraphCanvas`), and a "+"
									// floating with no line under it invites a
									// click on a midpoint that is about to move.
									( data?.hovered || selected ) &&
										! data?.reconnecting &&
										'is-visible',
								]
									.filter( Boolean )
									.join( ' ' ) }
								title={ __( 'Insert stage', 'vip-workflow' ) }
								onClick={ onInsertClick }
							>
								<Icon icon={ plus } size={ 16 } />
							</button>
						) }
					</Stack>
				</EdgeLabelRenderer>
			) }
		</>
	);
}

export default memo( TransitionEdgeComponent );
