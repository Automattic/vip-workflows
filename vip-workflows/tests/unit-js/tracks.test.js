/**
 * Unit tests for the browser Tracks helper.
 *
 * The helper must stay silent wherever PHP localized no base properties (off
 * VIP) and on local environments, and otherwise queue the prefixed event with
 * the base properties under the event's own, loading the Tracks script once.
 */

import {
	getTracksBaseProperties,
	recordTracksEvent,
} from '../../src/common/tracks';

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

/**
 * The Tracks script tags on the page.
 *
 * @return {HTMLScriptElement[]} Script elements loading stats.wp.com/w.js.
 */
const trackScripts = () =>
	Array.from(
		document.querySelectorAll( 'script[src*="stats.wp.com/w.js"]' )
	);

describe( 'recordTracksEvent', () => {
	beforeEach( () => {
		delete window._tkq;
		delete window.vipWorkflowsAdmin;
		delete window.vipWorkflowsEditor;
		trackScripts().forEach( ( script ) => script.remove() );
	} );

	it( 'records nothing when no base properties were localized', () => {
		window.vipWorkflowsAdmin = { tracks: null };

		recordTracksEvent( 'editor_history_opened' );

		expect( window._tkq ).toBeUndefined();
		expect( trackScripts() ).toHaveLength( 0 );
	} );

	it( 'records nothing when the screen has no localized data at all', () => {
		recordTracksEvent( 'editor_history_opened' );

		expect( getTracksBaseProperties() ).toBeNull();
		expect( window._tkq ).toBeUndefined();
		expect( trackScripts() ).toHaveLength( 0 );
	} );

	it( 'records nothing on a local environment', () => {
		window.vipWorkflowsEditor = { tracks: { ...base, vip_env: 'local' } };

		recordTracksEvent( 'editor_history_opened' );

		expect( window._tkq ).toBeUndefined();
		expect( trackScripts() ).toHaveLength( 0 );
	} );

	it( 'queues the prefixed event with the editor base properties', () => {
		window.vipWorkflowsEditor = { tracks: base };

		recordTracksEvent( 'editor_history_opened' );

		expect( window._tkq ).toEqual( [
			[ 'recordEvent', 'vip_workflows_editor_history_opened', base ],
		] );
	} );

	it( 'queues with the admin base properties, event properties last, undefined dropped', () => {
		window.vipWorkflowsAdmin = { tracks: base };

		recordTracksEvent( 'sequence_create_started', {
			source: 'header',
			plugin_version: 'overridden',
			missing: undefined,
		} );

		expect( window._tkq ).toEqual( [
			[
				'recordEvent',
				'vip_workflows_sequence_create_started',
				{ ...base, source: 'header', plugin_version: 'overridden' },
			],
		] );
	} );

	it( 'keeps events another script already queued', () => {
		window.vipWorkflowsAdmin = { tracks: base };
		window._tkq = [ [ 'recordEvent', 'other_event', {} ] ];

		recordTracksEvent( 'editor_history_opened' );

		expect( window._tkq ).toHaveLength( 2 );
		expect( window._tkq[ 0 ] ).toEqual( [
			'recordEvent',
			'other_event',
			{},
		] );
	} );

	it( 'loads the Tracks script once, on the first event', () => {
		window.vipWorkflowsAdmin = { tracks: base };

		recordTracksEvent( 'editor_history_opened' );
		recordTracksEvent( 'editor_history_opened' );

		expect( trackScripts() ).toHaveLength( 1 );
		expect( trackScripts()[ 0 ].src ).toBe( 'https://stats.wp.com/w.js' );
		expect( trackScripts()[ 0 ].async ).toBe( true );
	} );

	it( 'does not load the Tracks script again when another plugin has', () => {
		window.vipWorkflowsAdmin = { tracks: base };
		const existing = document.createElement( 'script' );
		existing.src = '//stats.wp.com/w.js';
		document.head.appendChild( existing );

		recordTracksEvent( 'editor_history_opened' );

		expect( trackScripts() ).toEqual( [ existing ] );
	} );

	it( 'tries loading the Tracks script again after it fails once', () => {
		window.vipWorkflowsAdmin = { tracks: base };

		recordTracksEvent( 'editor_history_opened' );
		trackScripts()[ 0 ].dispatchEvent( new Event( 'error' ) );
		expect( trackScripts() ).toHaveLength( 0 );

		recordTracksEvent( 'editor_history_opened' );

		expect( trackScripts() ).toHaveLength( 1 );
		expect( window._tkq ).toHaveLength( 2 );
	} );

	it( 'swallows a failure in the Tracks queue', () => {
		window.vipWorkflowsAdmin = { tracks: base };
		window._tkq = {
			push: () => {
				throw new Error( 'boom' );
			},
		};

		expect( () =>
			recordTracksEvent( 'editor_history_opened' )
		).not.toThrow();
	} );
} );
