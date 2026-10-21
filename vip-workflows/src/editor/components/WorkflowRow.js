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
 * DIFFERENT sequence is the consequential case and the caller confirms it first
 * — re-assignment re-seats the post at the new sequence's region entry stage,
 * so it loses its place — which is why this component only reports the choice
 * and never performs it.
 *
 * Taking the post out of its workflow lives in the same popover, under the
 * list. Choosing which workflow a post is in and taking it out of one are the
 * same decision, so they are the same control rather than two ends of a panel.
 * Like a choice, a removal is only reported: the caller confirms and performs
 * it.
 *
 * A post whose sequence was deleted is still drawn as this row. Its value says
 * the workflow is gone, the row wears the invalid state (the deleted identity is
 * what holds every status change), and its popover offers the one way out —
 * removal — instead of a list: re-assigning on top of a dangling identity would
 * bury the broken state rather than clear it.
 */

import { Button, ComboboxControl } from '@wordpress/components';
import { Text } from '@wordpress/ui';
import { __, sprintf } from '@wordpress/i18n';

import { getRemoveFromWorkflowLabel } from '../../common/confirm-workflow-side-effect';
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
 * @param {Function} root0.onRemove           Optional. Called when the
 *                                            Remove button is pressed. Without
 *                                            it the popover offers no way out —
 *                                            the caller withholds it where the
 *                                            workflow is enforced.
 * @param {boolean}  root0.orphaned           Whether the post's sequence was
 *                                            deleted out from under it.
 */
export function WorkflowRow( {
	sequence,
	availableSequences,
	disabled = false,
	onSelect,
	onRemove,
	orphaned = false,
} ) {
	const label = workflowLabel();

	// Closed first: the caller answers with a confirm dialog, and a modal
	// opened over a popover that still holds focus fights it for the focus.
	const renderRemove = ( onClose ) => (
		<Button
			className="vip-workflows-workflow-row__remove"
			variant="secondary"
			isDestructive
			onClick={ () => {
				onClose();
				onRemove();
			} }
		>
			{ getRemoveFromWorkflowLabel() }
		</Button>
	);

	if ( orphaned ) {
		return (
			<SidebarRow
				label={ label }
				popoverLabel={ label }
				accessibleName={ __(
					'Workflow no longer exists',
					'vip-workflows'
				) }
				valueLabel={ __( 'Deleted workflow', 'vip-workflows' ) }
				emptyLabel={ __( 'Deleted workflow', 'vip-workflows' ) }
				disabled={ disabled }
				invalid
				errorMessage={ __(
					'This post belongs to a workflow that no longer exists, so its status cannot be changed.',
					'vip-workflows'
				) }
				renderContent={ ( { onClose } ) => (
					<>
						<Text variant="body-md" render={ <p /> }>
							{ __(
								'Remove the post from it to edit it as an ordinary post.',
								'vip-workflows'
							) }
						</Text>
						{ renderRemove( onClose ) }
					</>
				) }
			/>
		);
	}
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
				<>
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
						placeholder={ __(
							'Search workflows…',
							'vip-workflows'
						) }
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
					{ /* At the bottom, below the list: leaving is the
					     consequential end of the same decision. */ }
					{ sequence && onRemove && renderRemove( onClose ) }
				</>
			) }
		/>
	);
}
