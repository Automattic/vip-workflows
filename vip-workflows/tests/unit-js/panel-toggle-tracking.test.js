/**
 * Unit tests for usePanelToggleTracking: the Workflow panel's open state as
 * the post loads is not recorded; every change after it is.
 */

import { renderHook } from '@testing-library/react';

import { usePanelToggleTracking } from '../../src/editor/use-panel-toggle-tracking';
import { recordTracksEvent } from '../../src/common/tracks';

let mockOpened = false;

jest.mock( '@wordpress/data', () => ( {
	useSelect: ( selector ) =>
		selector( () => ( { isEditorPanelOpened: () => mockOpened } ) ),
} ) );

jest.mock( '../../src/editor/store', () => ( {
	WORKFLOW_PANEL_NAME: 'vip-workflows/workflow',
} ) );

jest.mock( '../../src/common/tracks', () => ( {
	recordTracksEvent: jest.fn(),
} ) );

describe( 'usePanelToggleTracking', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'records nothing for the state the post loads with', () => {
		mockOpened = true;
		const { rerender } = renderHook( () => usePanelToggleTracking() );
		rerender();

		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );

	it( 'records each open and close after that', () => {
		mockOpened = false;
		const { rerender } = renderHook( () => usePanelToggleTracking() );

		mockOpened = true;
		rerender();
		mockOpened = false;
		rerender();

		expect( recordTracksEvent ).toHaveBeenNthCalledWith(
			1,
			'editor_panel_toggled',
			{ opened: true }
		);
		expect( recordTracksEvent ).toHaveBeenNthCalledWith(
			2,
			'editor_panel_toggled',
			{ opened: false }
		);
		expect( recordTracksEvent ).toHaveBeenCalledTimes( 2 );
	} );
} );
