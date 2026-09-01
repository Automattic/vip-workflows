/**
 * Unit tests for the Agents screen, per docs/guides/settings-standard.md.
 *
 * The screen used to be two headed groups of cards, each card carrying its own
 * Save, above an intro paragraph that repeated the page subtitle and a bottom
 * bar holding the how-to button. It is now one tab per agent origin, with the
 * how-to and a single Save in the page header — which changes three things a
 * test can hold still: how many Saves exist, what enables the one that does, and
 * what a reader is told when a save fails.
 *
 * The foreground refetch stays: a card's requirement destination opens in a new
 * tab, so the common flow is leave, add the credential, come back. Without it
 * the screen sits on a stale unmet requirement for an agent that is now
 * configured. `focus` and `visibilitychange` both fire on a tab return, so the
 * pair must collapse into a single request rather than doubling every return
 * trip.
 *
 * @package
 */

import {
	render,
	screen,
	act,
	waitFor,
	fireEvent,
	within,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { createReduxStore, register } from '@wordpress/data';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
// The package's untranspiled ESM cannot be required here, and the screen only
// needs the store's key to dispatch its success snackbar.
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

// eslint-disable-next-line import/first
import Agents from '../../src/admin/pages/Agents';

const ASSISTANTS_PATH = '/vip-workflows/v1/assistants';

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
 * An agent payload as `GET /vip-workflows/v1/assistants` returns it.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Agent entry.
 */
const agent = ( overrides = {} ) => ( {
	slug: 'vip-workflows-web-researcher',
	label: 'Web Researcher',
	description: 'Searches the open web.',
	// The screen groups by origin and the built-in tab is the default, so this
	// is load-bearing rather than incidental fixture detail.
	origin: 'built-in',
	enabled: true,
	available: true,
	availability_state: 'available',
	availability: { available: true, groups: [] },
	availability_sources: [],
	ability_ids: [ 'vip-workflows/web-researcher' ],
	provider_slugs: [],
	capabilities: [ 'research' ],
	options: {},
	settings_schema: {},
	...overrides,
} );

/**
 * Count the list fetches issued so far.
 *
 * @return {number} Number of calls to the list endpoint.
 */
function listFetchCount() {
	return apiFetch.mock.calls.filter(
		( [ options ] ) => options?.path === ASSISTANTS_PATH
	).length;
}

/**
 * Render the screen with the given agents and wait for the fetch to settle.
 *
 * @param {Array}    entries  Agent payloads the list route returns.
 * @param {Function} [onPost] What a settings POST resolves or rejects with.
 * @return {Promise<Object>} Render result.
 */
async function renderAgents( entries, onPost ) {
	apiFetch.mockImplementation( ( { method } ) =>
		'POST' === method
			? ( onPost ?? ( () => Promise.resolve( entries[ 0 ] ) ) )()
			: Promise.resolve( entries )
	);

	const result = render( <Agents /> );

	// The active panel's content mounts a tick after the strip, so waiting on a
	// tab alone would let a synchronous query run against an empty panel.
	await waitFor( () =>
		expect( screen.getByText( entries[ 0 ].label ) ).toBeInTheDocument()
	);

	return result;
}

describe( 'Agents screen shape', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	afterEach( () => {
		successNotices.length = 0;
		// The active tab round-trips through the URL, so a test that switched
		// tabs would otherwise decide which tab the next one opens on.
		window.history.replaceState( {}, '', '/' );
	} );

	it( 'states the purpose once, in the page subtitle', async () => {
		// The panel used to open with a paragraph re-explaining the page under a
		// subtitle that had already explained it.
		await renderAgents( [ agent() ] );

		expect(
			screen.getByText(
				'Configure agents that assist with editorial work.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText( /Agents provide research, story discovery/ )
		).not.toBeInTheDocument();
	} );

	it( 'puts the how-to in the page header, with one verb for the concept', async () => {
		// `How to Create Custom Agents` in a bar at the bottom of the content was
		// a header action in the wrong place, and a second verb for `Add`.
		await renderAgents( [ agent() ] );

		expect(
			screen.getByRole( 'button', { name: 'Add custom agents' } )
		).toBeVisible();
		expect(
			screen.queryByRole( 'button', {
				name: 'How to Create Custom Agents',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'splits the agent origins across one tab strip', async () => {
		await renderAgents( [ agent() ] );

		expect( screen.getByRole( 'tab', { name: 'Built-in' } ) ).toBeVisible();
		expect(
			screen.getByRole( 'tab', { name: 'From plugins' } )
		).toBeVisible();
		// The origin groups were `h3`s wrapping cards, which collided with the
		// cards' own heading level.
		expect(
			screen.queryByRole( 'heading', { name: 'Built-in Agents' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'heading', { name: 'Plugin Agents' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps an origin that has no agents, and says so', async () => {
		// Filtering an empty origin out would make the strip vary per site, and
		// on a site with no agent plugins it would collapse to a single tab.
		await renderAgents( [ agent() ] );

		expect(
			screen.getByText( 'No agent plugins are installed.' )
		).not.toBeVisible();

		fireEvent.click( screen.getByRole( 'tab', { name: 'From plugins' } ) );

		await waitFor( () =>
			expect(
				screen.getByText( 'No agent plugins are installed.' )
			).toBeVisible()
		);
	} );

	it( 'round-trips the active tab through the URL', async () => {
		await renderAgents( [ agent() ] );

		fireEvent.click( screen.getByRole( 'tab', { name: 'From plugins' } ) );

		await waitFor( () =>
			expect(
				new URLSearchParams( window.location.search ).get( 'tab' )
			).toBe( 'plugin' )
		);
	} );

	it( 'opens on the tab the URL names', async () => {
		window.history.replaceState( {}, '', '/?tab=plugin' );
		await renderAgents( [ agent() ] );

		expect(
			screen.getByText( 'No agent plugins are installed.' )
		).toBeVisible();
	} );

	it( 'lists a plugin agent under the plugin tab', async () => {
		const plugin = agent( {
			slug: 'workflow-assistant-wikipedia',
			label: 'Wikipedia',
			origin: 'plugin',
			ability_ids: [ 'workflow-assistant-wikipedia/wikipedia' ],
		} );
		await renderAgents( [ agent(), plugin ] );

		expect( screen.getByText( 'Wikipedia' ) ).not.toBeVisible();

		fireEvent.click( screen.getByRole( 'tab', { name: 'From plugins' } ) );

		await waitFor( () =>
			expect( screen.getByText( 'Wikipedia' ) ).toBeVisible()
		);
	} );

	it( 'offers exactly one Save for the whole screen', async () => {
		const second = agent( {
			slug: 'vip-workflows-media-scout',
			label: 'Media Scout',
		} );
		await renderAgents( [ agent(), second ] );

		expect(
			screen.getAllByRole( 'button', { name: 'Save' } )
		).toHaveLength( 1 );
	} );

	it( 'disables Save until an agent is edited', async () => {
		await renderAgents( [ agent() ] );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);
	} );

	it( 'saves the edited agent through its own route', async () => {
		await renderAgents( [ agent() ] );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/vip-workflows/v1/assistants/vip-workflows-web-researcher/settings',
					method: 'POST',
					data: expect.objectContaining( { enabled: false } ),
				} )
			)
		);

		await waitFor( () =>
			expect( successNotices ).toContain( 'Agents saved.' )
		);
	} );

	it( 'names the agent whose save failed instead of swallowing it', async () => {
		// The old per-card handler reported failure to `console.error` alone, so
		// the reader watched a button stop spinning and change nothing.
		const { container } = await renderAgents( [ agent() ], () =>
			Promise.reject( new Error( 'Network down' ) )
		);

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		// Scoped to the notice: `Notice` also mirrors its content into the
		// aria-live region, so an unscoped query matches the same text twice.
		await waitFor( () =>
			expect(
				container.querySelector( '.components-notice.is-error' )
			).toBeInTheDocument()
		);

		expect(
			within(
				container.querySelector( '.components-notice.is-error' )
			).getByText( /Web Researcher: Network down/ )
		).toBeInTheDocument();
		expect( successNotices ).toHaveLength( 0 );
	} );
} );

describe( 'Agents screen foreground refetch', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockResolvedValue( [ agent() ] );
		Object.defineProperty( document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		} );
		jest.useFakeTimers( { doNotFake: [ 'nextTick', 'queueMicrotask' ] } );
	} );

	afterEach( () => {
		jest.useRealTimers();
		window.history.replaceState( {}, '', '/' );
	} );

	/**
	 * Set the document's reported visibility.
	 *
	 * jsdom's `visibilityState` is read-only, so it is redefined per test.
	 *
	 * @param {string} state 'visible' or 'hidden'.
	 */
	function setVisibility( state ) {
		Object.defineProperty( document, 'visibilityState', {
			configurable: true,
			get: () => state,
		} );
	}

	it( 'loads the list once on mount', async () => {
		await renderAgents( [ agent() ] );

		expect( listFetchCount() ).toBe( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( { path: ASSISTANTS_PATH } );
	} );

	it( 'coalesces the focus/visibilitychange pair into one refetch', async () => {
		await renderAgents( [ agent() ] );
		expect( listFetchCount() ).toBe( 1 );

		// Past the 1000 ms guard, so a genuine return is allowed to refetch.
		act( () => {
			jest.advanceTimersByTime( 1500 );
		} );

		// Both events fire on a real tab return, back to back.
		await act( async () => {
			document.dispatchEvent( new Event( 'visibilitychange' ) );
			window.dispatchEvent( new Event( 'focus' ) );
		} );

		expect( listFetchCount() ).toBe( 2 );
	} );

	it( 'does not refetch on focus while the document is hidden', async () => {
		await renderAgents( [ agent() ] );
		expect( listFetchCount() ).toBe( 1 );

		act( () => {
			jest.advanceTimersByTime( 1500 );
		} );

		setVisibility( 'hidden' );

		await act( async () => {
			window.dispatchEvent( new Event( 'focus' ) );
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );

		expect( listFetchCount() ).toBe( 1 );
	} );

	it( 'ignores a fetch that resolves after unmount', async () => {
		let resolveLoad;
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveLoad = resolve;
				} )
		);

		const { unmount } = render( <Agents /> );
		expect( listFetchCount() ).toBe( 1 );

		unmount();

		// No "update on an unmounted component" warning: the jest-console preset
		// fails the test on any unexpected console.error.
		await act( async () => {
			resolveLoad( [ agent() ] );
		} );

		expect(
			screen.queryByText( 'Web Researcher' )
		).not.toBeInTheDocument();
	} );

	it( 'ignores a failed fetch that rejects after unmount', async () => {
		let rejectLoad;
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve, reject ) => {
					rejectLoad = reject;
				} )
		);

		const { unmount } = render( <Agents /> );
		unmount();

		await act( async () => {
			rejectLoad( new Error( 'Network down' ) );
		} );

		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );
} );
