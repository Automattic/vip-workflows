/**
 * Unit tests for MetadataUserControl.
 *
 * Covers the branches the e2e happy-path can't reach: the include= resolution
 * of a saved id outside the first page, the unavailable-id fallback option,
 * the fetch error path, the initial loading state, and search debouncing.
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';

import apiFetch from '@wordpress/api-fetch';

import { MetadataUserControl } from '../../src/common/MetadataUserControl';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

// The control lives in src/common/ and needs only @wordpress/components +
// api-fetch. It used to be imported from MetadataPanel, which meant stubbing
// @wordpress/core-data, @wordpress/editor and the editor store here purely to
// stop the module graph pulling block-editor → parsel-js (untransformed ESM)
// into a test that never touched any of them.

// @wordpress/components (ComboboxControl/Popover) touches browser APIs jsdom
// does not implement.
beforeAll( () => {
	window.matchMedia =
		window.matchMedia ||
		( () => ( {
			matches: false,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		} ) );

	global.ResizeObserver =
		global.ResizeObserver ||
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const renderControl = ( props = {} ) =>
	render(
		<MetadataUserControl
			label="Owner"
			value={ 0 }
			onChange={ () => {} }
			{ ...props }
		/>
	);

describe( 'MetadataUserControl', () => {
	it( 'fetches the user list with per_page and no search on initial load', async () => {
		apiFetch.mockResolvedValue( [ { id: 1, name: 'Admin' } ] );

		renderControl();

		await screen.findByRole( 'combobox' );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		const { path } = apiFetch.mock.calls[ 0 ][ 0 ];
		expect( path ).toContain( '/vip-workflow/v1/assignable-users' );
		expect( path ).toContain( 'per_page=50' );
		expect( path ).not.toContain( 'search=' );
		// No `context`: that parameter belongs to core's wp/v2/users, whose
		// `edit` context is what needs `list_users`. This route returns only
		// { id, name }, so there is no context to choose between.
		expect( path ).not.toContain( 'context=' );
	} );

	it( 'shows the loading state until the user list resolves', () => {
		// A pending promise keeps the control in its loading branch.
		apiFetch.mockReturnValue( new Promise( () => {} ) );

		renderControl();

		expect( screen.getByText( 'Loading users…' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'combobox' ) ).not.toBeInTheDocument();
	} );

	it( 'resolves a saved id outside the first page via include= and adds it as an option', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.includes( 'include=' ) ) {
				return Promise.resolve( [ { id: 42, name: 'Jane Doe' } ] );
			}
			return Promise.resolve( [ { id: 1, name: 'Admin' } ] );
		} );

		renderControl( { value: 42 } );

		// The control holds its loading state until the out-of-page id resolves,
		// then displays the resolved name (not a bare id or "(unavailable)").
		expect(
			await screen.findByDisplayValue( 'Jane Doe' )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: expect.stringContaining( 'include=42' ),
			} )
		);
		expect(
			screen.queryByDisplayValue( /unavailable/i )
		).not.toBeInTheDocument();
	} );

	it( 'keeps an unresolvable saved id visible as "User #N (unavailable)"', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.includes( 'include=' ) ) {
				return Promise.resolve( [] ); // deleted user / no list_users
			}
			return Promise.resolve( [ { id: 1, name: 'Admin' } ] );
		} );

		renderControl( { value: 999 } );

		expect(
			await screen.findByDisplayValue( 'User #999 (unavailable)' )
		).toBeInTheDocument();
	} );

	it( 'surfaces a fetch error in the control help text', async () => {
		apiFetch.mockRejectedValue( new Error( 'Service unavailable' ) );

		renderControl();

		expect(
			await screen.findByText( 'Service unavailable' )
		).toBeInTheDocument();
	} );

	it( 'debounces rapid searches into a single request', async () => {
		jest.useFakeTimers();
		try {
			apiFetch.mockResolvedValue( [ { id: 1, name: 'Admin' } ] );

			renderControl();

			// Initial load uses a 0ms delay; flush it.
			await act( async () => {
				jest.advanceTimersByTime( 0 );
			} );

			const input = screen.getByRole( 'combobox' );
			apiFetch.mockClear();

			await act( async () => {
				fireEvent.change( input, { target: { value: 'ja' } } );
				fireEvent.change( input, { target: { value: 'jan' } } );
				fireEvent.change( input, { target: { value: 'jane' } } );
			} );

			// Before the debounce window elapses, no request is in flight.
			await act( async () => {
				jest.advanceTimersByTime( 299 );
			} );
			expect( apiFetch ).not.toHaveBeenCalled();

			// One request fires after the window, for the latest term only.
			await act( async () => {
				jest.advanceTimersByTime( 1 );
			} );
			expect( apiFetch ).toHaveBeenCalledTimes( 1 );
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: expect.stringContaining( 'search=jane' ),
				} )
			);
		} finally {
			jest.useRealTimers();
		}
	} );
} );
