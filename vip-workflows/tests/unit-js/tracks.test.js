/**
 * Unit tests for the browser Tracks helper.
 *
 * The helper must stay silent wherever PHP localized no base properties (off
 * VIP) and on local environments, and otherwise send the prefixed event with
 * the base properties under the event's own.
 */

import { recordTracksEvent as recordWithCalypso } from '@automattic/calypso-analytics';

import { recordTracksEvent } from '../../src/common/tracks';

jest.mock( '@automattic/calypso-analytics', () => ( {
	recordTracksEvent: jest.fn(),
} ) );

const base = {
	plugin_version: '1.0.0',
	vip_env: 'production',
	vip_org: 1,
	is_vip_user: false,
	hosting_provider: 'wpvip',
	is_multisite: false,
	wp_version: '6.9',
	_ui: 'abc',
	_ut: 'vip:user_email',
};

describe( 'recordTracksEvent', () => {
	beforeEach( () => {
		delete window.vipWorkflowsAdmin;
		delete window.vipWorkflowsEditor;
		jest.clearAllMocks();
	} );

	it( 'records nothing when no base properties were localized', async () => {
		window.vipWorkflowsAdmin = { tracks: null };

		await recordTracksEvent( 'editor_history_opened' );

		expect( recordWithCalypso ).not.toHaveBeenCalled();
	} );

	it( 'records nothing when the screen has no localized data at all', async () => {
		await recordTracksEvent( 'editor_history_opened' );

		expect( recordWithCalypso ).not.toHaveBeenCalled();
	} );

	it( 'records nothing on a local environment', async () => {
		window.vipWorkflowsEditor = { tracks: { ...base, vip_env: 'local' } };

		await recordTracksEvent( 'editor_history_opened' );

		expect( recordWithCalypso ).not.toHaveBeenCalled();
	} );

	it( 'records the prefixed event with the editor base properties', async () => {
		window.vipWorkflowsEditor = { tracks: base };

		await recordTracksEvent( 'editor_history_opened' );

		expect( recordWithCalypso ).toHaveBeenCalledTimes( 1 );
		expect( recordWithCalypso ).toHaveBeenCalledWith(
			'vip_workflows_editor_history_opened',
			base
		);
	} );

	it( 'records with the admin base properties, event properties last', async () => {
		window.vipWorkflowsAdmin = { tracks: base };

		await recordTracksEvent( 'sequence_create_started', {
			source: 'header',
			plugin_version: 'overridden',
		} );

		expect( recordWithCalypso ).toHaveBeenCalledWith(
			'vip_workflows_sequence_create_started',
			{ ...base, source: 'header', plugin_version: 'overridden' }
		);
	} );

	it( 'swallows a failure in the Tracks client', async () => {
		window.vipWorkflowsAdmin = { tracks: base };
		recordWithCalypso.mockImplementationOnce( () => {
			throw new Error( 'boom' );
		} );

		await expect(
			recordTracksEvent( 'editor_history_opened' )
		).resolves.toBeUndefined();
	} );
} );
