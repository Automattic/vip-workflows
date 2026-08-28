/**
 * SequenceIdentityFields — the name, description, and active toggle every
 * sequence carries, whatever kind of sequence it is.
 *
 * Both sequence-level panels open with the same three fields: the workflow one
 * (`SequenceSettingsInspector`) and the shorter phase one that `Inspector`
 * renders inline. Written twice, they had already drifted — the phase copy had
 * lost the placeholders and the "Active" help text — so the group lives here
 * once instead.
 *
 * The one difference that is real is the name's example, which has to name
 * something the author might plausibly be writing: an editorial workflow, or the
 * gate between lifecycle phases. That stays an explicit prop rather than being
 * flattened to whichever panel asked last.
 *
 * @package
 */

import {
	TextControl,
	TextareaControl,
	ToggleControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import InspectorSection from './InspectorSection';

export default function SequenceIdentityFields( {
	name,
	onNameChange,
	namePlaceholder,
	description,
	onDescriptionChange,
	isActive,
	onActiveChange,
} ) {
	return (
		<InspectorSection>
			<TextControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				label={ __( 'Name', 'vip-workflows' ) }
				value={ name }
				onChange={ onNameChange }
				placeholder={ namePlaceholder }
			/>
			<TextareaControl
				__nextHasNoMarginBottom
				label={ __( 'Description', 'vip-workflows' ) }
				value={ description }
				onChange={ onDescriptionChange }
				placeholder={ __(
					'What is this workflow for?',
					'vip-workflows'
				) }
			/>
			<ToggleControl
				__nextHasNoMarginBottom
				label={ __( 'Active', 'vip-workflows' ) }
				help={ __(
					'Inactive sequences are saved as drafts and not applied to content.',
					'vip-workflows'
				) }
				checked={ isActive }
				onChange={ onActiveChange }
			/>
		</InspectorSection>
	);
}
