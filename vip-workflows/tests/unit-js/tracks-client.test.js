/**
 * Boundary test for the browser Tracks helper against the real Tracks client,
 * unmocked: a `vip_workflows_*` event has to reach the Tracks queue.
 *
 * The client's own `recordTracksEvent()` drops any event whose source is not
 * on its hard-coded list, and `vip` is not on it. A mocked client cannot catch
 * that, so this file does not mock it.
 */

import { recordTracksEvent } from '../../src/common/tracks';

describe( 'recordTracksEvent with the real Tracks client', () => {
	beforeEach( () => {
		window._tkq = [];
		window.vipWorkflowsAdmin = {
			tracks: { vip_env: 'production', plugin_version: '1.0.0' },
		};
	} );

	afterEach( () => {
		delete window.vipWorkflowsAdmin;
	} );

	it( 'queues a vip_workflows_ event for Tracks', async () => {
		await recordTracksEvent( 'sequence_create_started', {
			source: 'header',
		} );

		expect( window._tkq ).toEqual( [
			[
				'recordEvent',
				'vip_workflows_sequence_create_started',
				{
					vip_env: 'production',
					plugin_version: '1.0.0',
					source: 'header',
				},
			],
		] );
	} );
} );
