/**
 * PhaseStageInspector — the inspector for a phase node.
 *
 * Phase sequences have a fixed set of phases (Ideation, Editorial); their nodes
 * can't be renamed, recolored, or deleted. So this panel mostly identifies the
 * selected phase and says that the hand-off leaving it is what's configurable.
 *
 * The exception is a phase that owes a hand-off nobody has drawn. That is the
 * one fault on this surface a panel can resolve, and it is the reason this file
 * is not read-only: the blocked-save notice offers to open the phase at fault,
 * and a panel that opened on the complaint with nothing to press would be a
 * button promising a fix and delivering a restatement. Which hand-off is owed
 * comes from the server (`missingHandOffs` over `/sequences/options`), so the
 * offer here and the rule that refuses the save can never disagree.
 *
 * Adding one is a button rather than a canvas gesture because an owed hand-off
 * is not a choice: the server names the pair, so there is nothing to pick. (What
 * a phase sequence MAY draw is a separate, larger list — this only ever offers
 * what it MUST.) The drag still works and still says the same thing; this is
 * the way to it that doesn't have to be guessed at.
 *
 * @package
 */

import { Button } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { __, _n, sprintf } from '@wordpress/i18n';
import { ActionRow } from '../../../common/ActionRow';
import InspectorShell from './InspectorShell';

/**
 * The panel's one line of help, for the state the phase is in.
 *
 * Three states, not two: a phase with nothing owed is not thereby a phase with
 * a connection leaving it. Editorial never has one, and telling its panel to
 * "select the connection leaving this phase" is the same unfollowable advice
 * as naming a missing hand-off as the way to fix itself.
 *
 * @param {Object} stage   The selected phase.
 * @param {Array}  missing The hand-offs it owes and has not drawn.
 * @return {string} The help text.
 */
function helpText( stage, missing ) {
	if ( missing.length > 0 ) {
		return sprintf(
			/* translators: %d: how many hand-offs the phase owes. */
			_n(
				'Phases are fixed. This one owes %d hand-off that has not been drawn, and the sequence cannot be saved without it.',
				'Phases are fixed. This one owes %d hand-offs that have not been drawn, and the sequence cannot be saved without them.',
				missing.length,
				'vip-workflows'
			),
			missing.length
		);
	}

	if ( ( stage.transitions || [] ).length > 0 ) {
		return __(
			'Phases are fixed. Select the connection leaving this phase to configure how content moves on.',
			'vip-workflows'
		);
	}

	return __(
		'Phases are fixed, and no connection leaves this one, so there is nothing to configure here.',
		'vip-workflows'
	);
}

/**
 * @param {Object}   props                   Component props.
 * @param {Object}   props.stage             The selected phase.
 * @param {Array}    props.missing           `{ from, to }` hand-offs this phase
 *                                           owes and has not drawn.
 * @param {Function} props.resolveStageLabel Names a phase by key.
 * @param {Function} props.onAddHandOff      Draws the hand-off to a phase key.
 * @return {JSX.Element} The phase panel.
 */
export default function PhaseStageInspector( {
	stage,
	missing,
	resolveStageLabel,
	onAddHandOff,
} ) {
	return (
		<InspectorShell
			eyebrow={ __( 'Phase', 'vip-workflows' ) }
			title={ stage.label || stage.key }
		>
			<Stack direction="column" gap="lg" align="stretch">
				<Text
					variant="body-sm"
					render={ <p /> }
					className="wf-inspector__help"
				>
					{ helpText( stage, missing ) }
				</Text>
				{ missing.length > 0 && (
					<ActionRow stretch>
						{ missing.map( ( { to } ) => (
							<Button
								key={ to }
								variant="secondary"
								onClick={ () => onAddHandOff( to ) }
								__next40pxDefaultSize
							>
								{ sprintf(
									/* translators: %s: target phase label (e.g. Editorial) */
									__(
										'Add the hand-off to “%s”',
										'vip-workflows'
									),
									resolveStageLabel( to )
								) }
							</Button>
						) ) }
					</ActionRow>
				) }
			</Stack>
		</InspectorShell>
	);
}
