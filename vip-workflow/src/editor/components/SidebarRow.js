/**
 * Sidebar row — core's document-sidebar row pattern, as one primitive.
 *
 * A label sits beside a value-shaped trigger button; clicking the value opens a
 * popover anchored to the row that holds whatever control changes it, and
 * committing closes it. Core composes PostAuthor / PostSchedule from
 * `PostPanelRow` + `Dropdown` and heads those popovers with
 * `InspectorPopoverHeader` (title beside a Close icon button); neither is
 * publicly exported from `@wordpress/editor`, so the shape is rebuilt here.
 *
 * Rebuilt once, because the Workflow sidebar draws it for two unrelated things:
 * the sequence the post belongs to (WorkflowRow) and every sequence-declared
 * metadata field (MetadataRow). What is generic — the two cells, the popover,
 * its header — lives here. The required-field asterisk and the wording that
 * spells it out stay with the metadata rows, which are the only rows that have
 * one; this primitive takes the finished strings.
 */

import { useId, useMemo, useState } from '@wordpress/element';
import { Button, Dropdown } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { closeSmall } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

import './SidebarRow.css';

/**
 * The popover's header: what the popover is for, and a Close button — the
 * header core's meta popovers get from InspectorPopoverHeader.
 *
 * @param {Object}   root0         Component props.
 * @param {string}   root0.title   Header title.
 * @param {Function} root0.onClose Called when the Close button is pressed.
 */
function SidebarRowHeader( { title, onClose } ) {
	return (
		<Stack
			className="vip-workflow-sidebar-row__header"
			direction="row"
			align="center"
			justify="space-between"
			gap="sm"
		>
			<Text variant="heading-sm">{ title }</Text>
			<Button
				size="small"
				icon={ closeSmall }
				label={ __( 'Close', 'vip-workflow' ) }
				showTooltip
				onClick={ onClose }
			/>
		</Stack>
	);
}

/**
 * A single label + clickable-value row whose popover holds the control.
 *
 * @param {Object}   root0                Component props.
 * @param {string}   root0.label          Visible row label.
 * @param {string}   root0.popoverLabel   Accessible name for the popover dialog.
 * @param {string}   root0.headerTitle    Visible popover header; defaults to
 *                                        `popoverLabel`, and differs from it
 *                                        only where the header spells out
 *                                        something the label leaves to an
 *                                        adornment.
 * @param {string}   root0.accessibleName Accessible name for the value trigger.
 *                                        The visible label is not associated
 *                                        with the trigger, so this sentence
 *                                        carries the whole of what pressing it
 *                                        does.
 * @param {string}   root0.valueLabel     Display text for the current value;
 *                                        empty string when unset.
 * @param {string}   root0.emptyLabel     Trigger copy when the value is unset.
 * @param {boolean}  root0.disabled       Whether the trigger is unavailable —
 *                                        a write on this row is already in
 *                                        flight.
 * @param {boolean}  root0.invalid        Whether the row's value is currently
 *                                        holding something up. Renders the
 *                                        form-control invalid state: the
 *                                        trigger reports `aria-invalid` and is
 *                                        described by `errorMessage`, which
 *                                        shows beneath it in the error tone.
 * @param {string}   root0.errorMessage   Finished sentence saying what is
 *                                        wrong. Required when `invalid` — an
 *                                        invalid control with no message names
 *                                        no problem to solve.
 * @param {Function} root0.onPopoverClose Optional; called when the popover
 *                                        closes, however it closes.
 * @param {Function} root0.renderContent  Renders the popover body below the
 *                                        header; receives `{ onClose }`.
 */
export function SidebarRow( {
	label,
	popoverLabel,
	headerTitle = popoverLabel,
	accessibleName,
	valueLabel,
	emptyLabel,
	disabled = false,
	invalid = false,
	errorMessage,
	onPopoverClose,
	renderContent,
} ) {
	// State (not a ref) so the component re-renders when the anchor mounts,
	// exactly as core's PostAuthor panel does.
	const [ popoverAnchor, setPopoverAnchor ] = useState( null );
	const popoverProps = useMemo(
		() => ( {
			// Anchor the popover to the whole row so it does not move around
			// when the value's label changes.
			anchor: popoverAnchor,
			// Popover renders a role-less div, where an aria-label alone is
			// prohibited ARIA that assistive tech ignores. The explicit dialog
			// role makes the label announce.
			role: 'dialog',
			'aria-label': popoverLabel,
			placement: 'left-start',
			offset: 36,
			shift: true,
		} ),
		[ popoverAnchor, popoverLabel ]
	);

	const hasValue = !! valueLabel;
	const errorId = useId();

	return (
		<Stack
			ref={ setPopoverAnchor }
			className={
				invalid
					? 'vip-workflow-sidebar-row vip-workflow-sidebar-row--invalid'
					: 'vip-workflow-sidebar-row'
			}
			direction="row"
			align="flex-start"
		>
			<Text className="vip-workflow-sidebar-row__label">{ label }</Text>
			{ /* A column so the error can sit under the value it belongs to
			     rather than beside it, the way a form control's message does.
			     `flex-start` keeps the trigger content-width, which is what
			     `align="center"` gave it while this was a single-child row;
			     the trigger's own 32px minimum still fills the cell. */ }
			<Stack
				className="vip-workflow-sidebar-row__control"
				direction="column"
				align="flex-start"
				gap="xs"
			>
				<Dropdown
					popoverProps={ popoverProps }
					// The string, not a bare `true`: `useFocusOnMount` only
					// looks for a tabbable for 'firstElement' /
					// 'firstInputElement' and focuses the popover container
					// itself for every other value — so `focusOnMount` alone
					// is weaker than the default it overrides, and lands a
					// keyboard user on a div instead of the control.
					focusOnMount="firstElement"
					onClose={ onPopoverClose }
					contentClassName="vip-workflow-sidebar-row__dialog"
					// Closing goes through `onClose`, not `onToggle`: only
					// `onClose` runs Dropdown's `close()`, which is what fires
					// `onPopoverClose`. Toggling shut would skip it, and that
					// callback is the row's only retry hook for a value whose
					// lookup failed.
					renderToggle={ ( { isOpen, onToggle, onClose } ) => (
						<Button
							size="compact"
							variant="tertiary"
							onClick={ isOpen ? onClose : onToggle }
							disabled={ disabled }
							aria-expanded={ isOpen }
							aria-label={ accessibleName }
							// The state itself, not a colour: this is what a
							// screen reader announces, and what the row's
							// styling keys off.
							aria-invalid={ invalid || undefined }
							aria-describedby={ invalid ? errorId : undefined }
						>
							{ hasValue ? valueLabel : emptyLabel }
						</Button>
					) }
					renderContent={ ( { onClose } ) => (
						<Stack
							className="vip-workflow-sidebar-row__content"
							direction="column"
							gap="sm"
						>
							<SidebarRowHeader
								title={ headerTitle }
								onClose={ onClose }
							/>
							{ renderContent( { onClose } ) }
						</Stack>
					) }
				/>
				{ invalid && (
					<Text
						id={ errorId }
						variant="body-sm"
						render={ <p /> }
						className="vip-workflow-sidebar-row__error"
					>
						{ errorMessage }
					</Text>
				) }
			</Stack>
		</Stack>
	);
}
