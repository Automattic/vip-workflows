/**
 * SequenceSettingsInspector — sequence-level settings (the "nothing selected"
 * inspector state for workflow sequences).
 *
 * The canvas owns stages and transitions; everything else about the sequence —
 * name, description, post types, AI stage settings, metadata fields, delete —
 * lives here, shown when no node or edge is selected. Grouped with
 * `InspectorSection`, the same primitive the stage and transition panels use;
 * stages, post statuses, and metadata fields collapse, since each opens into a
 * list of its own. Delete ends the body, in the danger zone every inspector
 * shares.
 *
 * **Stages and post statuses are listed and managed here**, following the same
 * add/remove pattern the metadata fields section uses. Stages are the steps
 * content moves through; each row shows its name and which post status it lives
 * in. Post statuses are the editorial regions drawn on the canvas; each row
 * names the status and says what it does to a post. Both are canvas concepts
 * surfaced here because both are about the sequence rather than about anything
 * selected in it.
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
import InspectorFieldList, {
	InspectorFieldListAdd,
} from './InspectorFieldList';
import {
	regionLabel,
	regionDescription,
	stageRegion,
	DEFAULT_REGION,
} from './regions';

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
	stages,
	onStagesChange,
	onRemoveStage,
	regions,
	addableRegions,
	onAddRegion,
	onRemoveRegion,
	onSelectNode,
	onSelectRegion,
} ) {
	const fieldCount = ( metadataFields || [] ).length;
	const metadataSummary = fieldCount
		? sprintf(
				/* translators: %d: number of metadata fields. */
				_n( '%d field', '%d fields', fieldCount, 'vip-workflows' ),
				fieldCount
		  )
		: __( 'None', 'vip-workflows' );

	const stageCount = ( stages || [] ).length;
	const stageSummary = stageCount
		? sprintf(
				/* translators: %d: number of stages. */
				_n( '%d stage', '%d stages', stageCount, 'vip-workflows' ),
				stageCount
		  )
		: __( 'None', 'vip-workflows' );

	const regionCount = ( regions || [] ).length;
	const regionSummary = regionCount
		? sprintf(
				/* translators: %d: number of post statuses. */
				_n( '%d status', '%d statuses', regionCount, 'vip-workflows' ),
				regionCount
		  )
		: __( 'None', 'vip-workflows' );

	// InspectorFieldList calls onChange with the whole array for both remove
	// and reorder. A remove delivers a shorter array — detect which stage was
	// taken out and delegate to the full removal, which also cleans up
	// transitions pointing at the deleted stage.
	const handleStagesListChange = ( newList ) => {
		if ( newList.length < stages.length ) {
			const removed = stages.find(
				( s ) => ! newList.some( ( n ) => n.key === s.key )
			);
			if ( removed ) {
				onRemoveStage( removed.key );
			}
			return;
		}
		onStagesChange( newList );
	};

	// Regions are strings, but InspectorFieldList works with objects. Wrap
	// each slug so describe / onItemSelect / canRemove receive an object.
	const regionItems = ( regions || [] ).map( ( slug ) => ( { slug } ) );

	// A region was removed from the list — find which one and delegate.
	const handleRegionsChange = ( newList ) => {
		const removed = regionItems.find(
			( item ) => ! newList.includes( item )
		);
		if ( removed ) {
			onRemoveRegion( removed.slug );
		}
	};

	// A region is removable when it is empty (no stage lives in it) and is
	// not the default region (Draft), which content is created in.
	const canRemoveRegion = ( item ) => {
		if ( item.slug === DEFAULT_REGION ) {
			return false;
		}
		return ! ( stages || [] ).some(
			( s ) => stageRegion( s ) === item.slug
		);
	};

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

				{ onAddStage && (
					<InspectorSection
						title={ __( 'Stages', 'vip-workflows' ) }
						summary={ stageSummary }
						collapsible
						defaultOpen={ stageCount > 0 }
						actions={
							<InspectorFieldListAdd
								addOptions={ [
									{
										label: __( 'Stage', 'vip-workflows' ),
										value: 'stage',
									},
								] }
								onAdd={ onAddStage }
								label={ __( 'Add stage', 'vip-workflows' ) }
							/>
						}
					>
						<InspectorFieldList
							items={ stages || [] }
							onChange={ handleStagesListChange }
							describe={ ( stage ) => ( {
								label:
									stage.label ||
									__( 'Untitled', 'vip-workflows' ),
								value: regionLabel( stageRegion( stage ) ),
							} ) }
							onItemSelect={
								onSelectNode
									? ( stage ) => onSelectNode( stage.key )
									: undefined
							}
							removeLabel={ __(
								'Remove stage',
								'vip-workflows'
							) }
							emptyLabel={ __(
								'This sequence has no stages. Add one to create the first step content moves through.',
								'vip-workflows'
							) }
						/>
					</InspectorSection>
				) }

				{ onAddStage && (
					<InspectorSection
						title={ __( 'Post statuses', 'vip-workflows' ) }
						summary={ regionSummary }
						collapsible
						defaultOpen={ regionCount > 0 }
						actions={
							( addableRegions || [] ).length > 0 && (
								<InspectorFieldListAdd
									addOptions={ addableRegions.map(
										( region ) => ( {
											label: regionLabel( region ),
											value: region,
											description:
												regionDescription( region ),
										} )
									) }
									onAdd={ onAddRegion }
									label={ __(
										'Add post status',
										'vip-workflows'
									) }
									alwaysMenu
								/>
							)
						}
					>
						<InspectorFieldList
							items={ regionItems }
							onChange={ handleRegionsChange }
							describe={ ( item ) => ( {
								label: regionLabel( item.slug ),
								value: regionDescription( item.slug ),
							} ) }
							onItemSelect={
								onSelectRegion
									? ( item ) => onSelectRegion( item.slug )
									: undefined
							}
							sortable={ false }
							canRemove={ canRemoveRegion }
							removeLabel={ __(
								'Remove post status',
								'vip-workflows'
							) }
							emptyLabel={ __(
								'No post statuses are in use.',
								'vip-workflows'
							) }
						/>
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
