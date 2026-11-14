/**
 * Where the admin app's snackbars appear.
 *
 * The SnackbarList used to render at the end of the shell, in the page's own
 * flow. On a screen taller than the viewport that put every notice below the
 * fold, and an overlay could paint over it, so a refused action looked like
 * nothing happening. The shell now portals the list into one region on <body>,
 * outside every screen's scrolling box and stacking context.
 *
 * @package
 */

import {
	render,
	screen,
	waitFor,
	fireEvent,
} from './helpers/render-wp-component';

jest.mock( '@wordpress/api-fetch', () =>
	jest.fn( () => new Promise( () => {} ) )
);

/*
 * `@wordpress/notices` pulls an ESM-only `uuid` build Jest cannot parse. The
 * shell only reads snackbars and removes them, so a small store stands in.
 */
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

import { createReduxStore, register } from '@wordpress/data';

const NOTICES = [
	{
		id: 'refused',
		type: 'snackbar',
		content: 'The draft could not be created: the project has no seed.',
		spokenMessage: 'The draft could not be created.',
		actions: [],
	},
	{
		id: 'inline',
		type: 'default',
		content: 'An inline notice the shell does not own.',
		actions: [],
	},
];

const removed = [];

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = NOTICES, action ) =>
			'REMOVE_NOTICE' === action.type
				? state.filter( ( notice ) => notice.id !== action.id )
				: state,
		selectors: { getNotices: ( state ) => state },
		actions: {
			removeNotice: ( id ) => {
				removed.push( id );
				return { type: 'REMOVE_NOTICE', id };
			},
		},
	} )
);

import AppShell from '../../src/admin/components/AppShell';

describe( 'AppShell notice region', () => {
	// A Snackbar can move focus and scroll as it mounts or is clicked, and
	// jsdom implements no scrolling. Stubbed for every test in the file,
	// because when it happens depends on timing.
	let scrollTo;
	beforeEach( () => {
		scrollTo = jest
			.spyOn( window, 'scrollTo' )
			.mockImplementation( () => {} );
	} );
	afterEach( () => scrollTo.mockRestore() );

	it( 'renders snackbars in one region on <body>, outside the screen', async () => {
		const { container } = render( <AppShell /> );

		const message = await waitFor( () =>
			screen.getByText(
				'The draft could not be created: the project has no seed.'
			)
		);

		const region = message.closest( '.vip-workflows-notice-region' );
		expect( region ).not.toBeNull();
		expect( region.parentElement ).toBe( document.body );
		expect( container.contains( message ) ).toBe( false );
		expect(
			document.querySelectorAll( '.vip-workflows-notice-region' )
		).toHaveLength( 1 );
	} );

	it( 'shows only snackbar notices; other types are not drawn in the region', async () => {
		render( <AppShell /> );

		await waitFor( () =>
			expect(
				document.querySelector( '.vip-workflows-notice-region' )
			).not.toBeNull()
		);

		expect(
			screen.queryByText( 'An inline notice the shell does not own.' )
		).toBeNull();
	} );

	// Last: it removes the snackbar from the shared store.
	it( 'dismisses a snackbar through the notices store', async () => {
		render( <AppShell /> );

		const message = await waitFor( () =>
			screen.getByText(
				'The draft could not be created: the project has no seed.'
			)
		);

		fireEvent.click( message.closest( '.components-snackbar' ) );

		await waitFor( () => expect( removed ).toContain( 'refused' ) );
		await waitFor( () =>
			expect(
				screen.queryByText(
					'The draft could not be created: the project has no seed.'
				)
			).toBeNull()
		);
	} );
} );
