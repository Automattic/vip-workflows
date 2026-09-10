/**
 * SequenceSettingsInspector — sequence-level settings (the "nothing selected"
 * inspector state for workflow sequences).
 *
 * The canvas owns stages and transitions; everything else about the sequence —
 * name, description, post types, post statuses, AI stage settings, metadata
 * fields, delete — lives here, shown when no node or edge is selected. Grouped
 * with `InspectorSection`, the same primitive the stage and transition panels
 * use; only metadata fields collapse, since that group opens into an editor of
 * its own. Delete ends the body, in the danger zone every inspector shares.
 *
 * Post statuses is the odd one out: the thing it edits lives on the canvas, not
 * in this panel. It is here because adding one had no home but the canvas's
 * right-click menu, which nothing advertises — see the group itself.
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
import InspectorShell from './InspectorShell';
import InspectorSection from './InspectorSection';
import InspectorDangerZone from './InspectorDangerZone';
import SequenceIdentityFields from './SequenceIdentityFields';
import { Fact } from './InspectorFacts';
import { regionDescription, regionLabel } from './regions';
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
	regions,
	canAddRegion,
	onAddRegion,
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

				{ /* Which sections the canvas is divided into, and the one
				     affordance that opens a new one. The canvas has a second
				     way in — right-click the pane — but nothing out there says
				     so, so this is where an author who has not been told finds
				     it: a named group listing what the sequence writes, with an
				     Add beside it. Removing one stays on the region's own panel
				     (`RegionInspector`), reached by clicking its label on the
				     canvas, because that panel is what a single status is. */ }
				<InspectorSection
					title={ __( 'Post statuses', 'vip-workflows' ) }
					help={ __(
						'The statuses this sequence moves posts through, each drawn as a section of the canvas. Adding one opens an empty section to drag stages into — it is scaffolding until a stage lives there, and a status still holding none is not saved with the sequence.',
						'vip-workflows'
					) }
					actions={
						<Button
							icon={ plus }
							// The name carries the reason when there is no
							// move left to make, and the button stays focusable
							// while disabled so that reason can be reached —
							// the same bargain `InspectorDangerZone` strikes
							// with its own explanation.
							label={
								canAddRegion
									? __( 'Add post status', 'vip-workflows' )
									: __(
											'Every post status is already on the canvas',
											'vip-workflows'
									  )
							}
							showTooltip
							size="small"
							disabled={ ! canAddRegion }
							accessibleWhenDisabled
							onClick={ onAddRegion }
						/>
					}
				>
					<Stack
						render={ <ul /> }
						direction="column"
						gap="xs"
						className="wf-inspector__facts"
					>
						{ regions.map( ( { region, stageCount } ) => (
							<Fact
								key={ region }
								label={ regionLabel( region ) }
								// The count is what tells a scaffolded status
								// from a real one: the empty ones are exactly
								// the ones a reload forgets.
								value={ sprintf(
									/* translators: %d: number of stages in this post status. */
									_n(
										'%d stage',
										'%d stages',
										stageCount,
										'vip-workflows'
									),
									stageCount
								) }
								empty={ stageCount === 0 }
								tip={ regionDescription( region ) }
							/>
						) ) }
					</Stack>
				</InspectorSection>

				<InspectorSection title={ __( 'AI stages', 'vip-workflows' ) }>
					<ToggleControl
						__nextHasNoMarginBottom
						label={ __( 'Let AI stages publish', 'vip-workflows' ) }
						help={ __(
							'An AI stage routes on what a language model returned, and that model reads the post’s own content, so publishing and going private both wait for a person. Off by default. Turning it on grants no new rights — an agent still cannot publish for an author who could not.',
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
