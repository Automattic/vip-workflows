/**
 * Metadata row — core's document-sidebar meta pattern for one editorial
 * metadata field.
 *
 * The row itself is `SidebarRow`: a label cell beside a value-shaped trigger
 * whose popover holds the field's input. What is added here is the only part
 * that belongs to a metadata FIELD rather than to the pattern — whether the
 * field is required, and how that reaches a screen reader. The visible asterisk
 * rides on `label`, which is not associated with the trigger, so the signal is
 * spelled out as "(required)" in the trigger's accessible name and in the
 * popover header.
 *
 * Required and BLOCKING is a second, louder state, and the two are not the same
 * thing: the asterisk says the field will be wanted eventually, the invalid
 * state says a move the author is trying to make is being held for this row
 * right now. Only the second gets core's invalid treatment — an error state
 * standing over an action nobody is currently blocked on is just nagging.
 * Which rows are blocking is not this row's to work out; MetadataPanel asks
 * the gate (see required-metadata.js) and passes the answer down.
 */

import { sprintf, __ } from '@wordpress/i18n';

import { SidebarRow } from './SidebarRow';

/**
 * A single metadata field as a label + clickable-value row.
 *
 * @param {Object}   root0                Component props.
 * @param {string}   root0.label          Visible row label (carries the
 *                                        required-field asterisk).
 * @param {string}   root0.fieldLabel     The field's plain label, used for the
 *                                        popover header and accessible names.
 * @param {boolean}  root0.required       Whether the field is required.
 * @param {boolean}  root0.blocking       Whether this field being empty is
 *                                        holding a transition the author is
 *                                        being offered.
 * @param {string}   root0.valueLabel     Display text for the current value;
 *                                        empty string when the field is unset.
 * @param {string}   root0.emptyLabel     Trigger copy when the field is unset.
 * @param {Function} root0.onPopoverClose Optional; called when the popover
 *                                        closes, however it closes.
 * @param {Function} root0.renderContent  Renders the popover body below the
 *                                        header; receives `{ onClose }`.
 */
export function MetadataRow( {
	label,
	fieldLabel,
	required = false,
	blocking = false,
	valueLabel,
	emptyLabel,
	onPopoverClose,
	renderContent,
} ) {
	// The DISPLAY side of the same emptiness rule the server applies: a value
	// that is nothing but whitespace has not been filled in, so it must not
	// render as one. PHP's authority is Sequence::metadata_value_is_empty()
	// and its JS mirror is metadataValueIsEmpty() in required-metadata.js,
	// which judges the raw meta value; this judges the string that value was
	// turned into for the reader, and the two have to agree — a row that reads
	// "filled" here is a row the workflow will move past. Spaces used to read
	// as an answer on this side alone, which put the author in front of a
	// filled-looking field the transition refused.
	//
	// The trimmed label is what reaches SidebarRow, so the trigger shows the
	// empty copy rather than rendering the blank run.
	const displayLabel = String( valueLabel ?? '' ).trim();
	const hasValue = '' !== displayLabel;

	let accessibleName;
	if ( hasValue ) {
		accessibleName = required
			? sprintf(
					/* translators: %1$s: metadata field label, %2$s: its current value. */
					__( 'Change %1$s: %2$s (required)', 'vip-workflows' ),
					fieldLabel,
					displayLabel
			  )
			: sprintf(
					/* translators: %1$s: metadata field label, %2$s: its current value. */
					__( 'Change %1$s: %2$s', 'vip-workflows' ),
					fieldLabel,
					displayLabel
			  );
	} else {
		accessibleName = required
			? sprintf(
					/* translators: %s: metadata field label. */
					__( 'Set %s (required)', 'vip-workflows' ),
					fieldLabel
			  )
			: sprintf(
					/* translators: %s: metadata field label. */
					__( 'Set %s', 'vip-workflows' ),
					fieldLabel
			  );
	}

	const headerTitle = required
		? sprintf(
				/* translators: %s: metadata field label. */
				__( '%s (required)', 'vip-workflows' ),
				fieldLabel
		  )
		: fieldLabel;

	return (
		<SidebarRow
			label={ label }
			popoverLabel={ fieldLabel }
			headerTitle={ headerTitle }
			accessibleName={ accessibleName }
			valueLabel={ displayLabel }
			emptyLabel={ emptyLabel }
			// A filled field is never invalid, whatever the gate last said:
			// the answer the author can see on screen wins over a payload
			// computed before they typed it.
			invalid={ blocking && ! hasValue }
			errorMessage={ __( 'Required to publish.', 'vip-workflows' ) }
			onPopoverClose={ onPopoverClose }
			renderContent={ renderContent }
		/>
	);
}
