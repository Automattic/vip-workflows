/**
 * PhaseStageInspector — the inspector for a phase node.
 *
 * Phase sequences have a fixed set of phases (Ideation, Editorial); their nodes
 * can't be renamed, recolored, or deleted. The inspector just identifies the
 * selected phase and explains that only the transition between them is
 * configurable.
 *
 * @package
 */

import { Text } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import InspectorShell from './InspectorShell';

export default function PhaseStageInspector( { stage } ) {
	return (
		<InspectorShell
			eyebrow={ __( 'Phase', 'vip-workflows' ) }
			title={ stage.label || stage.key }
		>
			<Text
				variant="body-sm"
				render={ <p /> }
				className="wf-inspector__help"
			>
				{ __(
					'Phases are fixed. Select the connection between phases to configure how content moves from Ideation into the editorial workflow.',
					'vip-workflows'
				) }
			</Text>
		</InspectorShell>
	);
}
