/**
 * StageNode — a stage rendered as a node on the sequence canvas.
 *
 * Variants are driven entirely by node data (see `buildGraph`): default,
 * selected, publishes (tag), warning (red), and AI (purple).
 * The card itself carries the state — a tinted surface and border per variant,
 * with no color accent: the stage's palette color identifies it in badges and
 * the inspector, not on the canvas. An AI stage takes the purple used for
 * assistant surfaces everywhere else in the product as its whole card. Nodes
 * carry no buttons of their own — a stage is added by dragging a connection off
 * this one, not from a control on the node.
 *
 * Connections start at the grip on the bottom border and end anywhere on the
 * node: the target handle is an invisible sheet over the whole node rather than
 * a dot to hit, and edges float to whichever border faces the other stage
 * (`floating-edge.js`), so there's no entry point to aim at. The sheet only takes
 * pointer events while a connection is in flight — otherwise it would sit
 * between the pointer and everything else in the node.
 *
 * An AI stage exits differently, so it swaps that one grip for three: an agent
 * finishes pass, fail, or error, and each outcome gets its own colored handle on
 * the bottom border. Dragging from one onto a stage is what assigns that
 * outcome's destination — there is no routing control in the inspector.
 *
 * These badges are the *affordance*, and like the grip they only paint under
 * the pointer. What says at rest where a routed outcome's line leaves is the
 * mark on the edge's own departure point, which wears the same tone and the
 * same glyph (`outcome-icons.js`, drawn by `EdgeOverlay`): the badge is where
 * you reach to re-route, the mark is where the line comes from.
 *
 * @package
 */

import { memo } from '@wordpress/element';
import { Handle, Position, useConnection } from '@xyflow/react';
import { Icon } from '@wordpress/components';
import { Stack, Text, VisuallyHidden } from '@wordpress/ui';
import { published, caution, login } from '@wordpress/icons';
import { __, _n, sprintf } from '@wordpress/i18n';
import { agentOutcomeLabel } from './graph-model';
import { gripOrder } from './edge-pipeline';
import { usePortOrder } from './EdgePlanProvider';
import { OUTCOME_ICONS } from './outcome-icons';

// Custom drag-out grip icon (a spiral). `currentColor` so it follows the
// handle's color (neutral → brand on hover) like the other node icons.
const dragGripIcon = (
	<svg
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		fill="none"
		aria-hidden="true"
		focusable="false"
	>
		<path
			fill="currentColor"
			d="M12.7983 4.00177C13.2159 3.97343 13.5781 4.28876 13.6065 4.70638C13.6348 5.12399 13.3185 5.48528 12.9009 5.51362C8.85448 5.7885 6.10859 9.21366 6.37092 12.7867H6.36993C6.6423 16.3582 9.68061 18.7299 12.7854 18.4631H12.7874C15.8918 18.205 17.8852 15.5477 17.624 12.917C17.3626 10.2856 15.0928 8.67269 12.9384 8.92615H12.9354C10.7815 9.17122 9.53829 11.0471 9.78048 12.7344C10.0226 14.421 11.4993 15.282 12.7124 15.0673L12.9315 15.016C13.9861 14.7098 14.4068 13.7222 14.2282 13.0314L14.2272 13.0255C14.0418 12.2841 13.3981 12.1672 13.1525 12.2735C12.7687 12.4404 12.3217 12.2646 12.1548 11.8808C11.9882 11.4971 12.164 11.051 12.5476 10.8841C13.6968 10.3844 15.297 11.0559 15.6976 12.6584H15.6966C16.1082 14.2648 15.0441 16.1776 12.9877 16.5584L12.9838 16.5594C10.9236 16.9282 8.64441 15.485 8.28047 12.9495C7.91649 10.4136 9.76366 7.76259 12.7618 7.42022L13.043 7.39456C15.9475 7.20787 18.7977 9.40343 19.1319 12.767C19.4768 16.2394 16.8622 19.6443 12.9137 19.9729L12.9147 19.9739C8.96672 20.3131 5.19404 17.3097 4.85906 12.8992V12.8972C4.53542 8.48741 7.91214 4.33366 12.7983 4.00177Z"
		/>
	</svg>
);

function StageNodeComponent( { id, data, selected } ) {
	const {
		label,
		isAgent,
		routing,
		isTerminal,
		publishes,
		transitionCount,
		warnings = [],
		isRegionEntry,
	} = data;

	// Selector form: this re-renders only when a connection starts or ends, not
	// on every pointer move of the drag.
	const connecting = useConnection( ( c ) => c.inProgress );

	// The order this stage's outcome edges actually leave in, so each badge
	// sits over its own edge's port. The grips are conventionally pass, fail,
	// error left to right, but the router chooses its ports by cost — when it
	// puts fail's port left of pass's, keeping the conventional badge order
	// would cross the two edges under the stage purely to reach the color
	// they belong to. The badges are the convention; the edges are the
	// meaning; the badges move.
	const portOrder = usePortOrder( id );

	const hasWarning = warnings.length > 0;
	const className = [
		'wf-stage-node',
		selected && 'is-selected',
		hasWarning && 'is-warning',
		isRegionEntry && 'is-checkpoint',
		isAgent && 'is-agent',
		connecting && 'is-connecting',
	]
		.filter( Boolean )
		.join( ' ' );

	let meta = '';
	if ( transitionCount > 0 ) {
		meta = sprintf(
			/* translators: %d: number of outgoing transitions */
			_n(
				'%d transition',
				'%d transitions',
				transitionCount,
				'vip-workflow'
			),
			transitionCount
		);
	}

	return (
		<div className={ className }>
			<Handle
				type="target"
				position={ Position.Top }
				className="wf-stage-node__drop"
			/>

			<Stack className="wf-stage-node__body" direction="column" gap="xs">
				<Stack align="center" gap="xs">
					{ /* wpds-allow R7 -- the title is the card's own inherited size at medium weight, and every <Text> variant sets size, line-height and family as a package (body-sm is 12px/regular, heading-sm 11px/medium and uppercase, heading-md 13px with a 20px line-height); there is no weight-only variant and no weight prop, so a <Text> would retype it */ }
					<span className="wf-stage-node__label">{ label }</span>
					{ isRegionEntry && (
						<Icon
							icon={ login }
							size={ 16 }
							className="wf-stage-node__flag"
						/>
					) }
					{ /* The wrapper is what carries the tooltip and the label a
					     screen reader reads the flag out by. */ }
					{ hasWarning && (
						<Stack
							render={ <span /> }
							align="center"
							title={ warnings.join( '\n' ) }
							role="img"
							aria-label={ warnings.join( ' ' ) }
						>
							<Icon
								icon={ caution }
								size={ 16 }
								className="wf-stage-node__flag wf-stage-node__flag--warning"
							/>
						</Stack>
					) }
				</Stack>
				<Stack align="center" gap="sm">
					{ meta && (
						<Text variant="body-sm" className="wf-stage-node__meta">
							{ meta }
						</Text>
					) }
					{ /* The edge to End already shows terminal status on the
					     canvas; this is the only screen-reader signal for it. */ }
					{ isTerminal && (
						<VisuallyHidden>
							{ __( 'Final stage', 'vip-workflow' ) }
						</VisuallyHidden>
					) }
					{ publishes && (
						<Text
							variant="body-sm"
							className="wf-stage-node__publishes"
						>
							<Icon icon={ published } size={ 16 } />
							{ __( 'Publishes', 'vip-workflow' ) }
						</Text>
					) }
				</Stack>
			</Stack>

			{ /* An AI stage exits by outcome, so its three handles replace the
			     grip entirely: every way out of the stage is one of them. Same
			     pill the grip is, one per outcome — grouped tight around the
			     node's midpoint (see the CSS) rather than spread across the
			     border, so they read as one cluster of exits. */ }
			{ isAgent ? (
				gripOrder( portOrder ).map( ( outcome, index ) => {
					const target = routing?.[ outcome ] || null;
					const outcomeLabel = agentOutcomeLabel( outcome );
					return (
						<Handle
							key={ outcome }
							id={ outcome }
							type="source"
							position={ Position.Bottom }
							style={ {
								left: `calc(50% + ${ ( index - 1 ) * 26 }px)`,
							} }
							title={
								target
									? sprintf(
											/* translators: 1: outcome label (e.g. On pass), 2: destination stage key */
											__( '%1$s → %2$s', 'vip-workflow' ),
											outcomeLabel,
											target
									  )
									: sprintf(
											/* translators: %s: outcome label (e.g. On pass) */
											__(
												'%s — drag to a stage to route it',
												'vip-workflow'
											),
											outcomeLabel
									  )
							}
							className={ [
								'wf-stage-node__handle',
								'wf-stage-node__handle--outcome',
								`wf-stage-node__handle--${ outcome }`,
								target && 'is-routed',
							]
								.filter( Boolean )
								.join( ' ' ) }
						>
							<Icon
								icon={ OUTCOME_ICONS[ outcome ] }
								size={ 18 }
							/>
						</Handle>
					);
				} )
			) : (
				<Handle
					type="source"
					position={ Position.Bottom }
					className="wf-stage-node__handle wf-stage-node__handle--source"
				>
					<Icon icon={ dragGripIcon } size={ 22 } />
				</Handle>
			) }
		</div>
	);
}

export default memo( StageNodeComponent );
