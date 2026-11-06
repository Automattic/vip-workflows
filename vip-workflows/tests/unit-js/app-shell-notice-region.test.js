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

import { render, screen, waitFor } from './helpers/render-wp-component';

jest.mock( '@wordpress/api-fetch', () =>
	jest.fn( () => new Promise( () => {} ) )
);

/*
 * `@wordpress/notices` pulls an ESM-only `uuid` build Jest cannot parse. The
 * shell only reads snackbars and removes them, so a small store stands in.
 */
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

// eslint-disable-next-line import/first
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

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = NOTICES ) => state,
		selectors: { getNotices: ( state ) => state },
		actions: { removeNotice: () => ( { type: 'NOOP' } ) },
	} )
);

// eslint-disable-next-line import/first
import AppShell from '../../src/admin/components/AppShell';

describe( 'AppShell notice region', () => {
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

	it( 'leaves non-snackbar notices to the screens that raise them', async () => {
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
} );
