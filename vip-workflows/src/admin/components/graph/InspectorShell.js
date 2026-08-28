/**
 * InspectorShell — the floating panel chrome shared by every inspector view.
 *
 * A small eyebrow label (e.g. "Stage" / "Transition"), a title, and a scrolling
 * body. Keeps the inspector views visually consistent without each one
 * re-implementing the header.
 *
 * The panel is a WPDS <Card> hovering over the canvas — the same card surface
 * the Sequences list uses, so its border, radius, and elevation come from the
 * design system rather than being redrawn here. The editor's `__inspector`
 * wrapper positions it; this owns everything inside. The header stays put while
 * the body scrolls, so the title never scrolls away.
 *
 * The header carries no control but the collapse toggle. A panel's destructive
 * one — delete stage, remove transition, delete sequence, remove status — ends
 * its body instead, through `InspectorDangerZone`. The header put it above every
 * field it destroys, reached it first in the tab order, and left it an icon
 * whose meaning lived in a tooltip.
 *
 * **Collapse is deliberately hand-rolled rather than using `CollapsibleCard`.**
 * That component turns its whole header into the toggle trigger, and documents
 * the consequence: "Avoid placing interactive elements (buttons, links, inputs)
 * inside the header, since the entire area is clickable and their events will
 * bubble to trigger the collapse toggle." That objection died with the header's
 * Delete button — but the other one did not: `CollapsibleCard` animates its
 * content height to fit, which fights a panel that fills its container and
 * scrolls internally. Collapsing here just hides the body, leaving the header
 * bar — so the card keeps telling you what's selected while the canvas clears.
 *
 * @package
 */

import { createContext, useContext, useId } from '@wordpress/element';
import { Button } from '@wordpress/components';
import { chevronUp, chevronDown } from '@wordpress/icons';
import { Card, Stack, Text } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';

/**
 * Collapsed state for the panel, provided by `Inspector`.
 *
 * It lives above the shell on purpose: the shell unmounts whenever the
 * selection swaps one panel for another, so state held here would spring back
 * open every time you clicked a different node. `Inspector` stays mounted, so
 * it owns the flag and passes it down through context — which keeps the five
 * panel components from having to thread two props they don't care about.
 *
 * `null` means no provider (the panel simply isn't collapsible).
 */
export const InspectorCollapseContext = createContext( null );

export default function InspectorShell( { eyebrow, title, children } ) {
	const collapse = useContext( InspectorCollapseContext );
	const bodyId = useId();
	const collapsed = Boolean( collapse?.collapsed );

	return (
		<Card.Root
			className={ `wf-inspector${
				collapsed ? ' wf-inspector--collapsed' : ''
			}` }
		>
			<Stack
				className="wf-inspector__head"
				gap="sm"
				align="flex-start"
				justify="space-between"
			>
				<div className="wf-inspector__heading">
					{ eyebrow && (
						// heading-sm is the uppercase label variant, so the
						// small caps come from the variant rather than the
						// stylesheet.
						<Text
							variant="heading-sm"
							render={ <span /> }
							className="wf-inspector__eyebrow"
						>
							{ eyebrow }
						</Text>
					) }
					{ title && (
						// heading-lg is the whole of its type; the stylesheet
						// only tones it and lets a long one wrap.
						<Text
							variant="heading-lg"
							render={ <h2 /> }
							className="wf-inspector__title"
						>
							{ title }
						</Text>
					) }
				</div>
				{ collapse && (
					<Button
						className="wf-inspector__collapse"
						icon={ collapsed ? chevronDown : chevronUp }
						onClick={ collapse.toggle }
						label={
							collapsed
								? __( 'Expand panel', 'vip-workflows' )
								: __( 'Collapse panel', 'vip-workflows' )
						}
						showTooltip
						aria-expanded={ ! collapsed }
						aria-controls={ bodyId }
						__next40pxDefaultSize
					/>
				) }
			</Stack>
			{ /* Hidden rather than unmounted, so the options keep their state —
			     an expanded "AI stage" section is still expanded on the way
			     back, and the body keeps its scroll position. */ }
			<div
				id={ bodyId }
				className="wf-inspector__body"
				hidden={ collapsed }
			>
				{ children }
			</div>
		</Card.Root>
	);
}
