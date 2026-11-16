/**
 * Records the Workflow document panel being opened or closed.
 *
 * Core keeps the panel's open state in the user's editor preferences and offers
 * no click callback, so this watches that state and records each change after
 * the first read — the state a post loads with is not a toggle.
 */

import { useEffect, useRef } from '@wordpress/element';
import { useSelect } from '@wordpress/data';

import { recordTracksEvent } from '../common/tracks';
import { WORKFLOW_PANEL_NAME } from './store';

export function usePanelToggleTracking() {
	const opened = useSelect(
		( select ) =>
			select( 'core/editor' ).isEditorPanelOpened( WORKFLOW_PANEL_NAME ),
		[]
	);
	const previous = useRef( opened );

	useEffect( () => {
		if ( previous.current === opened ) {
			return;
		}
		previous.current = opened;
		recordTracksEvent( 'editor_panel_toggled', { opened } );
	}, [ opened ] );
}
