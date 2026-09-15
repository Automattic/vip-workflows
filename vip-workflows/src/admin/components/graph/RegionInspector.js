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
import { __ } from '@wordpress/i18n';
import InspectorShell from './InspectorShell';
import InspectorSection from './InspectorSection';
import InspectorDangerZone from './InspectorDangerZone';
import { DEFAULT_REGION, regionLabel, regionSummary } from './regions';

export default function RegionInspector( {
	region,
	stages,
	entryKey,
	onSetEntry,
	onRemove,
	canRemove,
} ) {
	const label = regionLabel( region );
	// `canRemove` is false for Draft, or for a status that still holds stages.
	const removeBlocker =
		region === DEFAULT_REGION
			? __( 'Draft can’t be removed.', 'vip-workflows' )
			: __( 'Move or delete its stages first.', 'vip-workflows' );

	return (
		<InspectorShell
			eyebrow={ __( 'Post status', 'vip-workflows' ) }
			title={ label }
		>
			<Stack direction="column" gap="lg" align="stretch">
				<InspectorSection help={ regionSummary( region ) } />

				<InspectorSection
					title={ __( 'Entry checkpoint', 'vip-workflows' ) }
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
								'No stages yet. Drag one into this section.',
								'vip-workflows'
							) }
						</Text>
					) : (
						<SelectControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							label={ __( 'Stage', 'vip-workflows' ) }
							value={ entryKey || '' }
							options={ [
								{
									label: __( '— Not set —', 'vip-workflows' ),
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
					label={ __( 'Remove this status', 'vip-workflows' ) }
					onClick={ onRemove }
					disabled={ ! canRemove }
					description={ canRemove ? undefined : removeBlocker }
				/>
			</Stack>
		</InspectorShell>
	);
}
