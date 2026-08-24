/**
 * The save-button label, for the surfaces that still swap it.
 *
 * The settings screens no longer do: `docs/guides/settings-standard.md` retires
 * the label swap in favour of a static label plus `isBusy`, and the companion
 * `UnsavedChangesHint` was deleted once the last settings screen migrated. What
 * is left has two consumers outside that standard's reach — `JobsTab` and the
 * sequence graph editor — and goes with them.
 */

import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/components';
import { check } from '@wordpress/icons';

/**
 * Resolve the save button label for its current state.
 *
 * @param {boolean} isSaving   Whether a save is in progress.
 * @param {string}  saveStatus Current save status ( 'success', 'error', or null ).
 * @param {string}  idleLabel  Already-translated label to show when idle.
 * @return {JSX.Element|string} The button label.
 */
export function getSaveButtonLabel( isSaving, saveStatus, idleLabel ) {
	if ( isSaving ) {
		return __( 'Saving…', 'vip-workflow' );
	}
	if ( saveStatus === 'success' ) {
		return (
			<>
				<Icon icon={ check } size={ 16 } />{ ' ' }
				{ __( 'Saved!', 'vip-workflow' ) }
			</>
		);
	}
	return idleLabel;
}
