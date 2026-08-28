/**
 * SequenceSettingsInspector — sequence-level settings (the "nothing selected"
 * inspector state for workflow sequences).
 *
 * The canvas owns stages and transitions; everything else about the sequence —
 * name, description, post types, AI stage settings, metadata fields, delete —
 * lives here, shown when no node or edge is selected. Grouped with
 * `InspectorSection`, the same primitive the stage and transition panels use;
 * only metadata fields collapse, since that group opens into an editor of its
 * own. Delete ends the body, in the danger zone every inspector shares.
 *
 * @package
 */

import { CheckboxControl, Spinner, ToggleControl } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { __, sprintf, _n } from '@wordpress/i18n';
import InspectorShell from './InspectorShell';
import InspectorSection from './InspectorSection';
import InspectorDangerZone from './InspectorDangerZone';
import SequenceIdentityFields from './SequenceIdentityFields';
import MetadataFieldsEditor, {
	MetadataFieldsAdd,
} from './MetadataFieldsEditor';

export default function SequenceSettingsInspector( {
	name,
	onNameChange,
	description,
	onDescriptionChange,
	isActive,
	onActiveChange,
	postTypes,
	selectedPostTypes,
	onTogglePostType,
	settings,
	onSettingsChange,
	metadataFields,
	onMetadataChange,
	isNew,
	onDelete,
	deleting,
} ) {
	const fieldCount = ( metadataFields || [] ).length;
	const metadataSummary = fieldCount
		? sprintf(
				/* translators: %d: number of metadata fields. */
				_n( '%d field', '%d fields', fieldCount, 'vip-workflow' ),
				fieldCount
		  )
		: __( 'None', 'vip-workflow' );

	return (
		<InspectorShell
			eyebrow={ __( 'Sequence', 'vip-workflow' ) }
			title={ name || __( 'Untitled sequence', 'vip-workflow' ) }
		>
			<Stack direction="column" gap="lg" align="stretch">
				<SequenceIdentityFields
					name={ name }
					onNameChange={ onNameChange }
					namePlaceholder={ __(
						'e.g. Editorial Review',
						'vip-workflow'
					) }
					description={ description }
					onDescriptionChange={ onDescriptionChange }
					isActive={ isActive }
					onActiveChange={ onActiveChange }
				/>

				<InspectorSection title={ __( 'Post types', 'vip-workflow' ) }>
					{ postTypes.length === 0 && <Spinner /> }
					{ postTypes.length > 0 && (
						<Stack direction="column" gap="xs" align="stretch">
							{ postTypes.map( ( pt ) => (
								<CheckboxControl
									__nextHasNoMarginBottom
									key={ pt.value }
									label={ pt.label }
									checked={ selectedPostTypes.includes(
										pt.value
									) }
									onChange={ () =>
										onTogglePostType( pt.value )
									}
								/>
							) ) }
						</Stack>
					) }
				</InspectorSection>

				<InspectorSection title={ __( 'AI stages', 'vip-workflow' ) }>
					<ToggleControl
						__nextHasNoMarginBottom
						label={ __( 'Let AI stages publish', 'vip-workflow' ) }
						help={ __(
							'An AI stage routes on what a language model returned, and that model reads the post’s own content, so publishing and going private both wait for a person. Off by default. Turning it on grants no new rights — an agent still cannot publish for an author who could not.',
							'vip-workflow'
						) }
						checked={ settings?.allow_agent_publish === true }
						onChange={ ( allow ) =>
							onSettingsChange( {
								...settings,
								allow_agent_publish: allow,
							} )
						}
					/>
				</InspectorSection>

				<InspectorSection
					title={ __( 'Metadata fields', 'vip-workflow' ) }
					summary={ metadataSummary }
					collapsible
					// Opens straight to the editor once fields exist; an empty
					// sequence keeps the row quiet.
					defaultOpen={ fieldCount > 0 }
					actions={
						<MetadataFieldsAdd
							fields={ metadataFields }
							onChange={ onMetadataChange }
						/>
					}
				>
					<MetadataFieldsEditor
						fields={ metadataFields }
						onChange={ onMetadataChange }
					/>
				</InspectorSection>

				{ /* A sequence that was never saved has nothing to delete. */ }
				{ ! isNew && (
					<InspectorDangerZone
						label={ __( 'Delete sequence', 'vip-workflow' ) }
						onClick={ onDelete }
						busy={ deleting }
					/>
				) }
			</Stack>
		</InspectorShell>
	);
}
