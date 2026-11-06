/**
 * The My Dashboard tab counts read the count from X-WP-Total and still read the
 * response body. An unread body leaves the request open, so the page never goes
 * network-idle, which is what hung the end-to-end audit of this screen.
 *
 * @package
 */

import { render, screen, waitFor } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { adminGlobals } from './helpers/admin-globals';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../../src/admin/pages/MyWorkPage', () => ( {
	MyWorkPage: () => null,
} ) );
jest.mock( '../../src/admin/pages/MyQueuePage', () => ( {
	MyQueuePage: () => null,
} ) );
jest.mock( '../../src/admin/pages/MyIdeationPage', () => ( {
	MyIdeationPage: () => null,
} ) );

import { MyDashboardPage } from '../../src/admin/pages/MyDashboardPage';

afterEach( () => {
	jest.clearAllMocks();
	delete window.vipWorkflowsAdmin;
} );

it( 'reads the My Work count from the header and still reads the body', async () => {
	window.vipWorkflowsAdmin = adminGlobals();
	const text = jest.fn( () => Promise.resolve( '[]' ) );
	apiFetch.mockImplementation( ( { path } ) =>
		Promise.resolve(
			path.includes( 'count_only=1' )
				? { headers: { get: () => '4' }, text }
				: []
		)
	);

	render( <MyDashboardPage /> );

	expect( await screen.findByText( /\(4\)/ ) ).toBeInTheDocument();
	await waitFor( () => expect( text ).toHaveBeenCalled() );
} );
