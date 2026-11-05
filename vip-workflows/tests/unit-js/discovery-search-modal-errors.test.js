/**
 * The discovery search modal tells the user what the route answered.
 *
 * A search can be refused — the route answers with an error that says why and
 * when to try again — and that answer must reach the person who searched. It
 * is not the same as a search that found nothing.
 */

/**
 * External dependencies
 */
import {
	render,
	screen,
	waitFor,
	fireEvent,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// eslint-disable-next-line import/first
import DiscoverySearchModal from '../../src/admin/components/ideation/DiscoverySearchModal';

const REFUSAL =
	'This account has reached its hourly limit for discovery searches. Try again in 42 minutes.';

/**
 * The error notice in the modal, or null. Queried by its element: the notice
 * also announces its text through a live region elsewhere in the document.
 */
const errorNotice = () =>
	document.querySelector( '.components-notice.is-error' );

/**
 * Render the modal for one provider and answer its search with the given result.
 *
 * @param {Function} search What the search route answers: resolves results or rejects.
 */
async function renderModal( search ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/vip-workflows/v1/discovery/providers' ) {
			return Promise.resolve( [ { slug: 'wire', label: 'Wire' } ] );
		}
		if ( path.startsWith( '/vip-workflows/v1/discovery/filters' ) ) {
			return Promise.resolve( [] );
		}
		if ( path.startsWith( '/vip-workflows/v1/discovery/search' ) ) {
			return search();
		}
		return Promise.resolve( {} );
	} );

	render(
		<DiscoverySearchModal
			provider="wire"
			onSelect={ () => {} }
			onClose={ () => {} }
			submitting={ null }
		/>
	);

	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Search' } ) ).toBeEnabled()
	);
}

describe( 'DiscoverySearchModal errors', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'shows the message of a refused search, not "no results"', async () => {
		await renderModal( () =>
			Promise.reject( {
				code: 'vip_workflows_discovery_search_rate_limited',
				message: REFUSAL,
				data: { status: 429 },
			} )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Search' } ) );

		await waitFor( () => expect( errorNotice() ).not.toBeNull() );
		expect( errorNotice() ).toHaveTextContent( REFUSAL );
		expect(
			screen.queryByText( /No results found/ )
		).not.toBeInTheDocument();
	} );

	it( 'says a search found nothing when the route answered an empty list', async () => {
		await renderModal( () => Promise.resolve( [] ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Search' } ) );

		expect(
			await screen.findByText( /No results found/ )
		).toBeInTheDocument();
	} );

	it( 'drops the message once a later search succeeds', async () => {
		let attempt = 0;
		await renderModal( () => {
			attempt += 1;
			return attempt === 1
				? Promise.reject( { message: REFUSAL, data: { status: 429 } } )
				: Promise.resolve( [] );
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Search' } ) );
		await waitFor( () => expect( errorNotice() ).not.toBeNull() );

		fireEvent.click( screen.getByRole( 'button', { name: 'Search' } ) );
		expect(
			await screen.findByText( /No results found/ )
		).toBeInTheDocument();
		expect( errorNotice() ).toBeNull();
	} );
} );
