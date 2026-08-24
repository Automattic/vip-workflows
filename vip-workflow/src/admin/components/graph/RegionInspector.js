/**
 * RegionInspector — options for the selected status region (its label on the
 * canvas, or the entry checkpoint docked on its boundary; both select it).
 *
 * A region has exactly one thing to configure: which of its stages is the entry
 * checkpoint. Everything else about it — which stages belong to it — is edited
 * on the canvas by dragging, not here.
 *
 * @package
 */

import { SelectControl } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { __, sprintf } from '@wordpress/i18n';
import InspectorShell from './InspectorShell';
import InspectorSection from './InspectorSection';
import InspectorDangerZone from './InspectorDangerZone';
import { regionDescription, regionLabel } from './regions';

export default function RegionInspector( {
	region,
	stages,
	entryKey,
	onSetEntry,
	onRemove,
	canRemove,
} ) {
	const label = regionLabel( region );

	return (
		<InspectorShell
			eyebrow={ __( 'Post status', 'vip-workflow' ) }
			title={ label }
		>
			<Stack direction="column" gap="lg" align="stretch">
				<InspectorSection
					help={
						sprintf(
							/* translators: %s: post status label (e.g. Draft, Published) */
							__(
								'Posts hold the “%s” status while they sit in any stage in this section of the canvas. Moving between stages inside it leaves the status alone; a transition that crosses its boundary is what changes it.',
								'vip-workflow'
							),
							label
						) +
						' ' +
						regionDescription( region )
					}
				/>

				<InspectorSection
					title={ __( 'Entry checkpoint', 'vip-workflow' ) }
				>
					{ /* Not the section's `help` prop: this stands in for the
					     picker rather than introducing it, so it has to render
					     only while there is nothing to pick. The help line's
					     class is all it borrows, for the muted tone. */ }
					{ stages.length === 0 ? (
						<Text
							variant="body-sm"
							render={ <p /> }
							className="wf-inspector-section__help"
						>
							{ __(
								'This status has no stages yet. Drag a stage into its section of the canvas, or drop a new connection there.',
								'vip-workflow'
							) }
						</Text>
					) : (
						<SelectControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							label={ __( 'Stage', 'vip-workflow' ) }
							help={ __(
								'Where a post lands when something outside the workflow sets this status — publishing from the editor, a scheduled post going live, a REST write — and where a sequence assigned to a post already in this status seats it. Transitions are not funnelled through it: an edge may cross into any stage. The stage holding it sits astride the boundary line; dragging a stage onto that line sets this, and dragging it off clears it.',
								'vip-workflow'
							) }
							value={ entryKey || '' }
							options={ [
								{
									label: __( '— Not set —', 'vip-workflow' ),
									value: '',
								},
								...stages.map( ( stage ) => ( {
									label: stage.label || stage.key,
									value: stage.key,
								} ) ),
							] }
							onChange={ ( key ) => onSetEntry( key || null ) }
						/>
					) }
				</InspectorSection>

				<InspectorDangerZone
					label={ __( 'Remove this status', 'vip-workflow' ) }
					onClick={ onRemove }
					disabled={ ! canRemove }
					description={
						canRemove
							? undefined
							: __(
									'Only a status with no stages can be removed, and Draft always stays — it’s where new content is created.',
									'vip-workflow'
							  )
					}
				/>
			</Stack>
		</InspectorShell>
	);
}
