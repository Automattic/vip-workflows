/**
 * Unit tests for the browser Tracks helper.
 *
 * The helper must stay silent wherever PHP localized no base properties (off
 * VIP), on local environments and when analytics consent is off, and otherwise
 * queue the prefixed event with the base properties under the event's own.
 * The real client is exercised in tracks-client.test.js.
 */

const mockAnalytics = {
	pushEventToTracksQueue: jest.fn(),
	getTrackingPrefs: jest.fn(),
};
let mockImportFails = false;

jest.mock( '@automattic/calypso-analytics', () => {
	if ( mockImportFails ) {
		throw new Error( 'chunk failed to load' );
	}
	return mockAnalytics;
} );

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

let recordTracksEvent;

describe( 'recordTracksEvent', () => {
	beforeEach( () => {
		jest.resetModules();
		jest.clearAllMocks();
		mockImportFails = false;
		mockAnalytics.getTrackingPrefs.mockReturnValue( {
			buckets: { analytics: true },
		} );
		delete window.vipWorkflowsAdmin;
		delete window.vipWorkflowsEditor;
		( { recordTracksEvent } = require( '../../src/common/tracks' ) );
	} );

	it( 'records nothing when no base properties were localized', async () => {
		window.vipWorkflowsAdmin = { tracks: null };

		await recordTracksEvent( 'editor_history_opened' );

		expect( mockAnalytics.pushEventToTracksQueue ).not.toHaveBeenCalled();
	} );

	it( 'records nothing when the screen has no localized data at all', async () => {
		await recordTracksEvent( 'editor_history_opened' );

		expect( mockAnalytics.pushEventToTracksQueue ).not.toHaveBeenCalled();
	} );

	it( 'records nothing on a local environment', async () => {
		window.vipWorkflowsEditor = { tracks: { ...base, vip_env: 'local' } };

		await recordTracksEvent( 'editor_history_opened' );

		expect( mockAnalytics.pushEventToTracksQueue ).not.toHaveBeenCalled();
	} );

	it( 'records nothing when analytics consent is off', async () => {
		window.vipWorkflowsEditor = { tracks: base };
		mockAnalytics.getTrackingPrefs.mockReturnValue( {
			buckets: { analytics: false },
		} );

		await recordTracksEvent( 'editor_history_opened' );

		expect( mockAnalytics.pushEventToTracksQueue ).not.toHaveBeenCalled();
	} );

	it( 'queues the prefixed event with the editor base properties', async () => {
		window.vipWorkflowsEditor = { tracks: base };

		await recordTracksEvent( 'editor_history_opened' );

		expect( mockAnalytics.pushEventToTracksQueue ).toHaveBeenCalledTimes(
			1
		);
		expect( mockAnalytics.pushEventToTracksQueue ).toHaveBeenCalledWith( [
			'recordEvent',
			'vip_workflows_editor_history_opened',
			base,
		] );
	} );

	it( 'queues with the admin base properties, event properties last, undefined dropped', async () => {
		window.vipWorkflowsAdmin = { tracks: base };

		await recordTracksEvent( 'sequence_create_started', {
			source: 'header',
			plugin_version: 'overridden',
			missing: undefined,
		} );

		expect( mockAnalytics.pushEventToTracksQueue ).toHaveBeenCalledWith( [
			'recordEvent',
			'vip_workflows_sequence_create_started',
			{ ...base, source: 'header', plugin_version: 'overridden' },
		] );
	} );

	it( 'swallows a failure in the Tracks client', async () => {
		window.vipWorkflowsAdmin = { tracks: base };
		mockAnalytics.pushEventToTracksQueue.mockImplementationOnce( () => {
			throw new Error( 'boom' );
		} );

		await expect(
			recordTracksEvent( 'editor_history_opened' )
		).resolves.toBeUndefined();
	} );

	it( 'tries the import again after it fails once', async () => {
		window.vipWorkflowsAdmin = { tracks: base };
		mockImportFails = true;

		await expect(
			recordTracksEvent( 'editor_history_opened' )
		).resolves.toBeUndefined();
		expect( mockAnalytics.pushEventToTracksQueue ).not.toHaveBeenCalled();

		mockImportFails = false;
		await recordTracksEvent( 'editor_history_opened' );

		expect( mockAnalytics.pushEventToTracksQueue ).toHaveBeenCalledTimes(
			1
		);
	} );
} );
