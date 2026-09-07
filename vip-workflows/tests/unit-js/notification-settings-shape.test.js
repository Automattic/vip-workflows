/**
 * Unit tests for the Notifications screen's shape, per
 * docs/guides/settings-standard.md.
 *
 * The screen used to grow a tab per channel group and a tab per ungrouped
 * channel, then append `System Events` and `Routing & Debug` — so the strip
 * varied with how a site was configured. It is now two topic tabs, every channel
 * is a card in the first of them, and the two save models ( a Save per channel
 * card and a separate Save for the events matrix ) are one Save in the page
 * header.
 *
 * The save payload is pinned too, because the split was not only a presentation
 * problem: the route replaces a channel's whole stored option with the body it
 * is sent, so a Save that omitted `events` erased the matrix, and a Save that
 * sent only `events` erased the webhook.
 *
 * @package
 */

import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { createReduxStore, register } from '@wordpress/data';

jest.mock( '@wordpress/api-fetch' );
// The package's untranspiled ESM cannot be required here, and the screen only
// needs the store's key to dispatch its success snackbars.
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

// eslint-disable-next-line import/first
import Notifications from '../../src/admin/pages/Notifications';

const successNotices = [];

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = [] ) => state,
		actions: {
			createSuccessNotice: ( content ) => {
				successNotices.push( content );
				return { type: 'CREATE_SUCCESS_NOTICE' };
			},
		},
	} )
);

/**
 * A channel as `GET /vip-workflows/v1/notifications/channels` returns it.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Channel entry.
 */
const channel = ( overrides = {} ) => ( {
	id: 'slack-default',
	name: 'Slack',
	description: 'Send notifications to Slack channels via webhooks.',
	configured: true,
	...overrides,
} );

/** Events as `GET /vip-workflows/v1/notifications/events` returns them. */
const EVENTS = [
	{ id: 'sla.breached', label: 'SLA Breached' },
	{ id: 'published', label: 'Published' },
];

/**
 * Route the screen's reads, and hand every write to the caller.
 *
 * @param {Object}   options          Options.
 * @param {Array}    options.channels Channel list.
 * @param {Object}   options.settings Stored settings, keyed by channel id.
 * @param {Object}   options.routing  Stored event→channels map.
 * @param {Object}   options.debug    Stored debug settings.
 * @param {Function} options.onWrite  Called with ( { path, data } ) for a POST.
 */
function mockRest( {
	channels,
	settings = {},
	routing = {},
	debug = { enabled: false, channels: [] },
	onWrite = () => {},
} ) {
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( 'POST' === method ) {
			return Promise.resolve( onWrite( { path, data } ) );
		}

		if ( '/vip-workflows/v1/notifications/channels' === path ) {
			return Promise.resolve( channels );
		}

		const settingsRoute = path.match(
			/^\/vip-workflows\/v1\/notifications\/(.+)\/settings$/
		);
		if ( settingsRoute ) {
			return Promise.resolve( settings[ settingsRoute[ 1 ] ] || {} );
		}

		if ( '/vip-workflows/v1/notifications/events' === path ) {
			return Promise.resolve( EVENTS );
		}
		if ( '/vip-workflows/v1/notification-routing' === path ) {
			return Promise.resolve( { routing } );
		}
		if ( '/vip-workflows/v1/notification-debug' === path ) {
			return Promise.resolve( debug );
		}

		return Promise.reject( new Error( `unexpected read: ${ path }` ) );
	} );
}

/**
 * Render the screen and wait for the channel list to settle.
 *
 * @param {Object} options See `mockRest`.
 * @return {Promise<Object>} Render result.
 */
async function renderNotifications( options ) {
	mockRest( options );

	const result = render( <Notifications /> );

	// `getAllByText`: the routing panel is kept mounted, and it names every
	// channel too — as a column header and in its channel list.
	await waitFor( () =>
		expect(
			screen.getAllByText( options.channels[ 0 ].name ).length
		).toBeGreaterThan( 0 )
	);

	return result;
}

/**
 * The screen's one error Notice, scoped so queries do not also match the
 * aria-live region `Notice` mirrors its content into.
 *
 * @param {HTMLElement} container Render container.
 * @return {Object} Scoped queries.
 */
function errorNotice( container ) {
	const notice = container.querySelector( '.components-notice.is-error' );

	expect( notice ).toBeInTheDocument();

	return within( notice );
}

describe( 'Notifications screen shape', () => {
	afterEach( () => {
		apiFetch.mockReset();
		successNotices.length = 0;
		// The active tab round-trips through the URL, so a test that switched
		// tabs would otherwise decide which tab the next one opens on.
		window.history.replaceState( {}, '', '/' );
	} );

	it( 'divides the screen by topic, not by channel', async () => {
		await renderNotifications( {
			channels: [
				channel( { id: 'slack-1', name: 'Newsroom' } ),
				channel( { id: 'slack-2', name: 'Standups' } ),
				channel( { id: 'email', name: 'Email' } ),
			],
		} );

		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 );
		expect( screen.getByRole( 'tab', { name: 'Channels' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Routing' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'tab', { name: 'Newsroom' } )
		).not.toBeInTheDocument();
	} );

	it( 'lists every destination as a card in the one channels tab', async () => {
		// Five Slack destinations are five cards, never five tabs.
		await renderNotifications( {
			channels: [ 1, 2, 3, 4, 5 ].map( ( n ) =>
				channel( { id: `slack-${ n }`, name: `Slack ${ n }` } )
			),
		} );

		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 );
		[ 1, 2, 3, 4, 5 ].forEach( ( n ) =>
			expect(
				screen.getByRole( 'heading', {
					level: 2,
					name: `Slack ${ n }`,
				} )
			).toBeInTheDocument()
		);
	} );

	it( 'holds one event matrix, in sections rather than cards', async () => {
		// There used to be two matrices over the same events: this screen's
		// per-channel `events` list and the global routing option. Neither Slack
		// nor ntfy stores the former, so it reported success and saved nothing.
		await renderNotifications( { channels: [ channel() ] } );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Routing' } ) );

		const routing = within( await screen.findByRole( 'tabpanel' ) );

		expect(
			routing.getByRole( 'heading', { level: 2, name: 'Event routing' } )
		).toBeInTheDocument();
		expect(
			routing.getByRole( 'heading', { level: 2, name: 'Debug mode' } )
		).toBeInTheDocument();
		expect(
			routing.queryByRole( 'heading', { name: 'System events' } )
		).not.toBeInTheDocument();
		expect(
			routing.queryByRole( 'heading', { name: 'Available Channels' } )
		).not.toBeInTheDocument();
	} );

	it( 'offers exactly one Save for the whole screen', async () => {
		// Three primary Saves lived here: one per channel card, one for the
		// events matrix, and `Save routing` / `Save debug settings` inside the
		// routing panel.
		await renderNotifications( {
			channels: [
				channel( { id: 'slack-1', name: 'Newsroom' } ),
				channel( { id: 'slack-2', name: 'Standups' } ),
			],
		} );

		expect(
			screen.getAllByRole( 'button', { name: 'Save' } )
		).toHaveLength( 1 );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Routing' } ) );

		const routing = within( await screen.findByRole( 'tabpanel' ) );

		expect(
			routing.queryByRole( 'button', { name: /^Save/ } )
		).not.toBeInTheDocument();
		expect(
			screen.getAllByRole( 'button', { name: 'Save' } )
		).toHaveLength( 1 );
	} );

	it( 'disables Save until a channel is edited', async () => {
		await renderNotifications( { channels: [ channel() ] } );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();

		fireEvent.change( screen.getByLabelText( 'Bot name' ), {
			target: { value: 'Newsroom Bot' },
		} );

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);
	} );

	it( 'saves through the channel’s own route, carrying its whole settings', async () => {
		// The route replaces the stored option with the body, so a save that
		// left `events` out of the payload wiped the system-events matrix.
		const writes = [];
		await renderNotifications( {
			channels: [ channel() ],
			settings: {
				'slack-default': {
					webhook_url: 'https://hooks.slack.com/services/x',
					bot_name: 'Workflow Bot',
					events: [ 'sla_breach' ],
				},
			},
			onWrite: ( write ) => {
				writes.push( write );
				return { success: true, settings: write.data };
			},
		} );

		fireEvent.change( screen.getByLabelText( 'Bot name' ), {
			target: { value: 'Newsroom Bot' },
		} );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].path ).toBe(
			'/vip-workflows/v1/notifications/slack-default/settings'
		);
		expect( writes[ 0 ].data ).toEqual( {
			webhook_url: 'https://hooks.slack.com/services/x',
			bot_name: 'Newsroom Bot',
			events: [ 'sla_breach' ],
		} );

		await waitFor( () =>
			expect( successNotices ).toContain( 'Notifications saved.' )
		);
	} );

	it( 'names the channel that failed instead of swallowing it', async () => {
		// The old per-card save reported failure through a label that changed
		// back, so a reader watched a button stop spinning and change nothing.
		const { container } = await renderNotifications( {
			channels: [ channel( { name: 'Newsroom' } ) ],
			onWrite: () => {
				throw new Error( 'Network down' );
			},
		} );

		fireEvent.change( screen.getByLabelText( 'Bot name' ), {
			target: { value: 'Newsroom Bot' },
		} );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () =>
			expect(
				container.querySelector( '.components-notice.is-error' )
			).toBeInTheDocument()
		);
		expect(
			errorNotice( container ).getByText( /Newsroom: Network down/ )
		).toBeInTheDocument();
		expect( successNotices ).toHaveLength( 0 );
	} );

	it( 'badges only the channel that needs work', async () => {
		await renderNotifications( {
			channels: [
				channel( { id: 'slack-1', name: 'Newsroom' } ),
				channel( {
					id: 'slack-2',
					name: 'Standups',
					configured: false,
				} ),
			],
		} );

		// "Configured" was a static fact on every working card; its absence is
		// what says a channel is ready. Scoped to the visible panel: the
		// routing surface still prints the word in its own channel list, which
		// this screen does not own.
		const channels = within( screen.getByRole( 'tabpanel' ) );

		expect( channels.queryByText( 'Configured' ) ).not.toBeInTheDocument();
		expect( channels.getAllByText( 'Setup needed' ) ).toHaveLength( 1 );
	} );

	it( 'puts adding a channel in the page header', async () => {
		await renderNotifications( { channels: [ channel() ] } );

		expect(
			screen.getByRole( 'button', { name: 'Add Slack' } )
		).toBeInTheDocument();
	} );

	it( 'explains a disabled test in text rather than a tooltip', async () => {
		await renderNotifications( { channels: [ channel() ] } );

		const sendTest = screen.getByRole( 'button', { name: 'Send test' } );
		expect( sendTest ).toBeEnabled();
		expect( sendTest ).not.toHaveAttribute( 'title' );

		fireEvent.change( screen.getByLabelText( 'Bot name' ), {
			target: { value: 'Newsroom Bot' },
		} );

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Send test' } )
			).toBeDisabled()
		);
		expect(
			screen.getByText( 'Save to send a test.' )
		).toBeInTheDocument();
	} );

	it( 'round-trips the active tab through the URL', async () => {
		await renderNotifications( { channels: [ channel() ] } );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Routing' } ) );

		await waitFor( () =>
			expect(
				new URLSearchParams( window.location.search ).get( 'tab' )
			).toBe( 'routing' )
		);
	} );

	it( 'opens on the tab the URL names', async () => {
		window.history.replaceState( {}, '', '/?tab=routing' );

		await renderNotifications( { channels: [ channel() ] } );

		expect(
			await screen.findByRole( 'heading', {
				level: 2,
				name: 'Event routing',
			} )
		).toBeInTheDocument();
	} );

	it( 'saves a routing change through the one Save', async () => {
		const writes = [];
		await renderNotifications( {
			channels: [ channel( { name: 'Newsroom' } ) ],
			onWrite: ( write ) => {
				writes.push( write );
				return { success: true, routing: write.data };
			},
		} );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Routing' } ) );

		fireEvent.click(
			await screen.findByRole( 'checkbox', {
				name: 'SLA Breached via Newsroom',
			} )
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ] ).toEqual( {
			path: '/vip-workflows/v1/notification-routing',
			data: { 'sla.breached': [ 'slack-default' ] },
		} );
		await waitFor( () =>
			expect( successNotices ).toContain( 'Notifications saved.' )
		);
	} );

	it( 'saves debug mode through the same Save', async () => {
		const writes = [];
		await renderNotifications( {
			channels: [ channel() ],
			onWrite: ( write ) => {
				writes.push( write );
				return { success: true, settings: write.data };
			},
		} );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Routing' } ) );

		fireEvent.click(
			await screen.findByRole( 'checkbox', { name: 'Mirror all events' } )
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].path ).toBe(
			'/vip-workflows/v1/notification-debug'
		);
		expect( writes[ 0 ].data.enabled ).toBe( true );
	} );

	it( 'names the routing matrix when its save is the one that failed', async () => {
		const { container } = await renderNotifications( {
			channels: [ channel( { name: 'Newsroom' } ) ],
			onWrite: () => {
				throw new Error( 'Network down' );
			},
		} );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Routing' } ) );
		fireEvent.click(
			await screen.findByRole( 'checkbox', {
				name: 'SLA Breached via Newsroom',
			} )
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () =>
			expect(
				container.querySelector( '.components-notice.is-error' )
			).toBeInTheDocument()
		);
		expect(
			errorNotice( container ).getByText( /Event routing: Network down/ )
		).toBeInTheDocument();
	} );

	it( 'routes only to channels that are configured', async () => {
		await renderNotifications( {
			channels: [
				channel( { id: 'slack-1', name: 'Newsroom' } ),
				channel( {
					id: 'slack-2',
					name: 'Standups',
					configured: false,
				} ),
			],
		} );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Routing' } ) );

		const routing = within( await screen.findByRole( 'tabpanel' ) );

		expect(
			routing.getByRole( 'columnheader', { name: 'Newsroom' } )
		).toBeInTheDocument();
		expect(
			routing.queryByRole( 'columnheader', { name: 'Standups' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps edits on a tab the reader has looked away from', async () => {
		// Base UI unmounts a hidden panel by default, which would discard the
		// edit — and the dirty state that enables Save — without saying so.
		await renderNotifications( { channels: [ channel() ] } );

		fireEvent.change( screen.getByLabelText( 'Bot name' ), {
			target: { value: 'Newsroom Bot' },
		} );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'tab', { name: 'Routing' } ) );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
		expect(
			screen.getByDisplayValue( 'Newsroom Bot' )
		).toBeInTheDocument();
	} );
} );
