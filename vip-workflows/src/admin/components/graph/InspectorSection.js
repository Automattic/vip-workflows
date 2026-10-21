/**
 * InspectorSection — one group of options inside an inspector panel.
 *
 * The single sectioning primitive for the sidebar. Every inspector groups its
 * controls with this, so stage / transition / sequence all read the same way.
 *
 * A section is open in place by default — a divider rule, a title, the controls.
 * Pass `collapsible` for the groups that don't earn permanent space (an AI stage
 * that's switched off, metadata fields, advanced identity), and it becomes a
 * disclosure with the same title treatment. `summary` puts the collapsed state's
 * gist next to the title so the panel stays readable while shut.
 *
 * Collapsed panels use `hiddenUntilFound`, so browser find-in-page still reaches
 * the controls inside and springs the section open.
 *
 * `actions` puts a control in the heading row — the Add button over a list of
 * fields, say. It is a SIBLING of the disclosure trigger rather than a child of
 * it: the trigger is a button, and a button inside a button is not a thing. That
 * also keeps the two apart for a pointer, so adding an item cannot toggle the
 * section shut underneath it.
 *
 * An action may take itself away: an Add that has just added the last thing it
 * can add is no longer offered. When it goes while it holds focus, focus moves
 * to the section's own heading control rather than falling to the page.
 *
 * @package
 */

import {
	Children,
	useLayoutEffect,
	useRef,
	useState,
} from '@wordpress/element';
import { Collapsible, Stack, Text } from '@wordpress/ui';
import { Icon } from '@wordpress/components';
import { chevronRight } from '@wordpress/icons';

// Where focus goes when the heading's actions take themselves away.
//
// Every Add a section hangs off its heading can remove itself on use: the one
// that adds the only assignment a transition may have, the one that adds the
// last tool the site offers. A focused element that leaves the DOM drops focus
// to `<body>` with nothing announced, and the next Tab starts from the top of
// the admin page. So when the actions go while focus is inside them, focus is
// handed to `targetRef` — a control of the section's own that stays mounted.
//
// "Inside them" is tracked with React's focus events on the actions wrapper,
// because those bubble through portals: an Add with more than one option is a
// dropdown whose menu items render in a popover outside the wrapper's DOM. A
// blur only clears the flag when focus is going somewhere (`relatedTarget`) —
// a focused node being removed is the very case this is for, and must not
// clear it on the way out.
//
// The hand-off only happens when focus really was lost. If anything else has
// already taken it by the time the actions are gone, it stays where it is.
function useActionsFocusHandoff( hasActions, targetRef ) {
	const focusWithin = useRef( false );
	const hadActions = useRef( hasActions );

	useLayoutEffect( () => {
		const lostFocus =
			hadActions.current && ! hasActions && focusWithin.current;

		hadActions.current = hasActions;
		if ( ! hasActions ) {
			focusWithin.current = false;
		}

		const target = targetRef.current;
		if ( ! lostFocus || ! target ) {
			return;
		}

		const { activeElement, body } = target.ownerDocument;
		if ( activeElement && activeElement !== body ) {
			return;
		}

		target.focus();
	}, [ hasActions, targetRef ] );

	return {
		onFocus: () => {
			focusWithin.current = true;
		},
		onBlur: ( event ) => {
			if ( event.relatedTarget ) {
				focusWithin.current = false;
			}
		},
	};
}

// The title, shared by both variants so they can't drift apart. `heading-md`
// is the whole of its type; the stylesheet only tones it.
//
// `focusable` makes it a programmatic focus target (never a tab stop) for a
// section with no other heading control to hand focus to.
function SectionTitle( { children, focusable = false, titleRef } ) {
	return (
		<Text
			ref={ titleRef }
			variant="heading-md"
			render={ <h3 tabIndex={ focusable ? -1 : undefined } /> }
			className="wf-inspector-section__title"
		>
			{ children }
		</Text>
	);
}

// Optional explanatory line under a section title.
function SectionHelp( { children } ) {
	return (
		<Text
			variant="body-sm"
			render={ <p /> }
			className="wf-inspector-section__help"
		>
			{ children }
		</Text>
	);
}

// Everything below a section's rule: the heading group, then the controls.
//
// Two nested columns rather than one evenly spaced list — a title and its own
// help line are a heading and its subtitle, so they belong tighter to each other
// (`xs`) than the pair belongs to the controls they introduce (`md`). Both
// variants render this; the collapsible one keeps its title in the trigger, so
// it passes only the help line.
//
// Either group is left out entirely when it holds nothing, rather than rendered
// empty: a flex gap falls between items whatever their height, so an empty box
// would still space the section as though it had content. `children` is counted
// through `Children.toArray` rather than tested for truth — a section whose
// controls are a `.map()` over a list that has not loaded yet hands us `[]`,
// which is truthy, and that is exactly the phantom gap this guard is for.
function SectionBody( { className, title, help, actions, children } ) {
	const hasChildren = Children.toArray( children ).length > 0;

	// An open section has no trigger, so its own title takes focus when the
	// actions beside it take themselves away. That swaps the heading row for a
	// bare title, so the title focused is a new <h3>, not the one that sat in
	// the row; the ref is reattached before the hand-off reads it.
	const titleRef = useRef( null );
	const actionsFocus = useActionsFocusHandoff( !! actions, titleRef );

	return (
		<Stack
			className={ className }
			direction="column"
			gap="md"
			align="stretch"
		>
			{ ( title || help || actions ) && (
				<Stack direction="column" gap="xs" align="stretch">
					{ /* The heading row appears only when something has to sit
					     beside the title. A bare title stays a bare title, so
					     the block margin the stylesheet restores on it still
					     lands on a block rather than on a centred flex item. */ }
					{ actions ? (
						<Stack
							direction="row"
							align="center"
							gap="sm"
							justify="space-between"
							className="wf-inspector-section__header"
						>
							{ title && (
								<SectionTitle focusable titleRef={ titleRef }>
									{ title }
								</SectionTitle>
							) }
							{ /* `display: contents` — see the collapsible
							     variant. Here it carries only the focus
							     bookkeeping. */ }
							<div
								className="wf-inspector-section__actions"
								{ ...actionsFocus }
							>
								{ actions }
							</div>
						</Stack>
					) : (
						title && (
							<SectionTitle focusable titleRef={ titleRef }>
								{ title }
							</SectionTitle>
						)
					) }
					{ help && <SectionHelp>{ help }</SectionHelp> }
				</Stack>
			) }
			{ hasChildren && (
				<Stack direction="column" gap="md" align="stretch">
					{ children }
				</Stack>
			) }
		</Stack>
	);
}

export default function InspectorSection( {
	title,
	help,
	summary,
	actions,
	collapsible = false,
	defaultOpen = false,
	children,
} ) {
	if ( ! collapsible ) {
		return (
			<SectionBody
				className="wf-inspector-section"
				title={ title }
				help={ help }
				actions={ actions }
			>
				{ children }
			</SectionBody>
		);
	}

	return (
		<CollapsibleSection
			title={ title }
			help={ help }
			summary={ summary }
			actions={ actions }
			defaultOpen={ defaultOpen }
		>
			{ children }
		</CollapsibleSection>
	);
}

// The disclosure variant, split out so its open state can be a hook — `actions`
// is a sibling of the trigger (a button inside a button is not a thing), which
// makes it pressable while the section is shut, and every action a section puts
// there adds something to the panel. `Collapsible.Root` reads `defaultOpen` once
// at mount, so an uncontrolled disclosure answered an Add by leaving the new row
// behind `hidden="until-found"` with only the summary count to say it existed.
//
// Controlled here rather than opened by each caller: "adding to a group opens
// it" is the group's rule, and a caller that forgot it would fail silently.
function CollapsibleSection( {
	title,
	help,
	summary,
	actions,
	defaultOpen,
	children,
} ) {
	const [ open, setOpen ] = useState( defaultOpen );

	// The trigger stays mounted whatever the actions do, so it is where focus
	// goes when they take themselves away.
	const triggerRef = useRef( null );
	const actionsFocus = useActionsFocusHandoff( !! actions, triggerRef );

	return (
		<Collapsible.Root
			open={ open }
			onOpenChange={ setOpen }
			className="wf-inspector-section wf-inspector-section--collapsible"
		>
			<Stack
				direction="row"
				align="center"
				gap="sm"
				className="wf-inspector-section__header"
			>
				<Collapsible.Trigger
					ref={ triggerRef }
					className="wf-inspector-section__toggle"
				>
					<Icon
						icon={ chevronRight }
						size={ 20 }
						className="wf-inspector-section__chevron"
					/>
					<SectionTitle>{ title }</SectionTitle>
					{ summary && (
						<Text
							variant="body-sm"
							className="wf-inspector-section__summary"
						>
							{ summary }
						</Text>
					) }
				</Collapsible.Trigger>
				{ /* `display: contents`, so the wrapper carries the handler and
				     nothing else: the action stays a direct flex item of the
				     header and the row lays out exactly as it did. Capture
				     rather than bubble, so the section is already open by the
				     time the control's own click runs. */ }
				{ actions && (
					<div
						className="wf-inspector-section__actions"
						onClickCapture={ () => setOpen( true ) }
						{ ...actionsFocus }
					>
						{ actions }
					</div>
				) }
			</Stack>
			<Collapsible.Panel
				hiddenUntilFound
				className="wf-inspector-section__panel"
			>
				{ /* Everything that has to vanish with the section goes on this
				     inner column, spacing included — never on the panel.
				     `hiddenUntilFound` shuts the panel with
				     `hidden="until-found"`, which the HTML rendering spec gives
				     `content-visibility: hidden` rather than `display: none`:
				     the panel still generates a box and still lays out its own
				     padding and border, and only its *contents* are skipped. A
				     padded panel therefore keeps that padding while collapsed,
				     as a strip of dead space under the header. */ }
				<SectionBody
					className="wf-inspector-section__disclosed"
					help={ help }
				>
					{ children }
				</SectionBody>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
