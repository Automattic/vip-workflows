/**
 * The workflow row — which sequence this post belongs to, and the only control
 * that changes it.
 *
 * The same document-sidebar row as the metadata fields below it (SidebarRow):
 * a label beside a value-shaped trigger, whose popover holds a searchable list
 * of the sequences this post type can use. It replaces two shapes that said the
 * same thing in two ways — an unlabelled `<h2>` once a workflow was assigned,
 * with no way at all to change it, and a select-plus-Start form before one was.
 * Which workflow a post is in is a property of the post, exactly like its
 * author or its publish date, so it reads as one row in both states.
 *
 * Picking is the whole gesture: there is no second button to press. Choosing a
 * DIFFERENT sequence is the consequential case and the panel confirms it first
 * — re-assignment re-seats the post at the new sequence's region entry stage,
 * so it loses its place — which is why this component only reports the choice
 * and never performs it.
 */

import { ComboboxControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

import { SidebarRow } from './SidebarRow';

/**
 * Row label and popover title. One string, used in three places, so the row,
 * its dialog and its accessible name cannot drift.
 *
 * @return {string} Translated label.
 */
const workflowLabel = () => __( 'Workflow', 'vip-workflows' );

/**
 * @param {Object}   root0                    Component props.
 * @param {Object}   root0.sequence           The assigned sequence (`{ id, name }`), or null.
 * @param {Array}    root0.availableSequences Sequences this post can use, from
 *                                            the status endpoint.
 * @param {boolean}  root0.disabled           Whether a workflow write is
 *                                            already in flight.
 * @param {Function} root0.onSelect           Called with the chosen sequence
 *                                            id. Never called for the sequence
 *                                            the post is already in.
 */
export function WorkflowRow( {
	sequence,
	availableSequences,
	disabled = false,
	onSelect,
} ) {
	const label = workflowLabel();
	const currentId = sequence?.id ? String( sequence.id ) : '';
	const valueLabel = sequence?.name || '';

	const options = ( availableSequences || [] ).map( ( candidate ) => ( {
		value: String( candidate.id ),
		label: candidate.name,
	} ) );

	// The post's own sequence, when the endpoint did not offer it back — an
	// inactive sequence, or one that no longer covers this post type. Without
	// it ComboboxControl has no option matching its value and renders an empty
	// input, which reads as "this post is in no workflow" over a post that
	// plainly is. Same reasoning as the metadata user control's resolved-but-
	// unlisted selection.
	if ( currentId && ! options.some( ( o ) => o.value === currentId ) ) {
		options.unshift( { value: currentId, label: valueLabel } );
	}

	const accessibleName = valueLabel
		? sprintf(
				/* translators: %s: the workflow the post is currently in. */
				__( 'Change workflow: %s', 'vip-workflows' ),
				valueLabel
		  )
		: __( 'Select a workflow', 'vip-workflows' );

	return (
		<SidebarRow
			label={ label }
			popoverLabel={ label }
			accessibleName={ accessibleName }
			valueLabel={ valueLabel }
			emptyLabel={ __( 'Select a workflow', 'vip-workflows' ) }
			disabled={ disabled }
			renderContent={ ( { onClose } ) => (
				<ComboboxControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ label }
					// The popover header already names the row; a second copy
					// of the word above the input says it twice.
					hideLabelFromVision
					value={ currentId }
					options={ options }
					// No `onFilterValueChange`: the whole list arrives with the
					// status payload, and ComboboxControl already filters its
					// own options by what is typed. The metadata user control
					// wires that callback because its list lives on the server
					// and every keystroke has to re-query it.
					placeholder={ __( 'Search workflows…', 'vip-workflows' ) }
					onChange={ ( selected ) => {
						onClose();

						// Clearing the input reports an empty value; so does
						// re-picking the sequence the post is already in.
						// Neither is a change to make.
						if ( ! selected || selected === currentId ) {
							return;
						}

						onSelect( parseInt( selected, 10 ) );
					} }
				/>
			) }
		/>
	);
}
