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
 * **Two things the canvas owns are started from here**: adding a stage, and
 * adding a post status. Both make something on the canvas rather than editing
 * the sequence, so on the face of it neither belongs in this panel — but both
 * are about the sequence rather than about anything selected in it, and this is
 * the panel that shows when nothing is. The alternative was where they were:
 * one buried in a right-click menu, the other with no affordance at all, since
 * "drag off a handle and release over empty canvas" is not something a surface
 * can say to you.
 *
 * @package
 */

import {
	Button,
	CheckboxControl,
	Spinner,
	ToggleControl,
} from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { plus } from '@wordpress/icons';
import { __, sprintf, _n } from '@wordpress/i18n';
import { ActionRow } from '../../../common/ActionRow';
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
	onAddStage,
	onAddPostStatus,
	canAddPostStatus,
} ) {
	const fieldCount = ( metadataFields || [] ).length;
	const metadataSummary = fieldCount
		? sprintf(
				/* translators: %d: number of metadata fields. */
				_n( '%d field', '%d fields', fieldCount, 'vip-workflows' ),
				fieldCount
		  )
		: __( 'None', 'vip-workflows' );

	return (
		<InspectorShell
			eyebrow={ __( 'Sequence', 'vip-workflows' ) }
			title={ name || __( 'Untitled sequence', 'vip-workflows' ) }
		>
			<Stack direction="column" gap="lg" align="stretch">
				<SequenceIdentityFields
					name={ name }
					onNameChange={ onNameChange }
					namePlaceholder={ __(
						'e.g. Editorial Review',
						'vip-workflows'
					) }
					description={ description }
					onDescriptionChange={ onDescriptionChange }
					isActive={ isActive }
					onActiveChange={ onActiveChange }
				/>

				{ /* The canvas's two creation verbs. They are sequence-level
				     rather than stage-level — neither one is about the stage
				     that happens to be selected — and this is the panel that
				     shows when nothing is. Until now the only home either had
				     was a right-click on the canvas, which nothing announces:
				     the status one was a menu item, and the stage one was
				     "drag off a handle and let go over empty space". */ }
				{ onAddStage && (
					<InspectorSection
						title={ __( 'Structure', 'vip-workflows' ) }
						help={ __(
							'Everything content moves through is drawn on the canvas. A stage added here lands in Draft with nothing leading to it yet, and opens its own panel — where its post status and the ways out of it are set.',
							'vip-workflows'
						) }
					>
						<ActionRow>
							<Button
								__next40pxDefaultSize
								variant="secondary"
								icon={ plus }
								onClick={ onAddStage }
							>
								{ __( 'Add stage', 'vip-workflows' ) }
							</Button>
							<Button
								__next40pxDefaultSize
								variant="secondary"
								icon={ plus }
								onClick={ onAddPostStatus }
								// Every status the server allows is already
								// drawn — the same gate the canvas menu's item
								// carries.
								disabled={ ! canAddPostStatus }
								accessibleWhenDisabled
							>
								{ __( 'Add post status…', 'vip-workflows' ) }
							</Button>
						</ActionRow>
					</InspectorSection>
				) }

				<InspectorSection title={ __( 'Post types', 'vip-workflows' ) }>
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

				<InspectorSection title={ __( 'AI stages', 'vip-workflows' ) }>
					<ToggleControl
						__nextHasNoMarginBottom
						label={ __( 'Let AI stages publish', 'vip-workflows' ) }
						help={ __(
							'Never exceeds the post author’s permissions.',
							'vip-workflows'
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
					title={ __( 'Metadata fields', 'vip-workflows' ) }
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
						label={ __( 'Delete sequence', 'vip-workflows' ) }
						onClick={ onDelete }
						busy={ deleting }
					/>
				) }
			</Stack>
		</InspectorShell>
	);
}
