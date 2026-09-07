/**
 * Whether a discovery provider offers "Browse more…".
 *
 * The button opens the search modal, so it only makes sense for a provider that
 * declares the `search` feature. It used to render for every provider that had a
 * slug — which is all of them — because the first two providers both supported
 * search and nothing made the gap reachable.
 *
 * A recommend-only provider (Parse.ly ranks your archive; it cannot answer a
 * text query) made it reachable, and clicking it returned a 500 carrying
 * `Discovery provider "parsely-trending" has no callable "search" callback` —
 * an internal message in a customer's face.
 *
 * @package
 */

import { render, screen, waitFor } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// eslint-disable-next-line import/first
import StoryDiscovery from '../../src/admin/components/ideation/StoryDiscovery';

/**
 * One provider group as the recommend route returns it.
 *
 * @param {Object}   overrides             Group overrides.
 * @param {string[]} overrides.features    Provider features.
 * @param {string}   overrides.slug        Provider slug.
 * @param {string}   overrides.label       Provider label.
 * @param {number}   overrides.promptCount How many prompts to fabricate.
 * @return {Object} A recommend group.
 */
function group( { slug, label, features, promptCount = 2 } ) {
	return {
		provider: { slug, label, icon: 'chart-line', features },
		prompts: Array.from( { length: promptCount }, ( _, i ) => ( {
			id: `${ slug }-${ i }`,
			provider: slug,
			title: `${ label } prompt ${ i }`,
			description: 'Something to write about.',
			tags: [],
		} ) ),
	};
}

/**
 * Render with a given set of provider groups.
 *
 * @param {Array} groups Recommend groups.
 */
async function renderWith( groups ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/vip-workflows/v1/discovery/recommend' ) {
			return Promise.resolve( groups );
		}
		return Promise.resolve( {} );
	} );

	render( <StoryDiscovery onSelect={ () => {} } onNavigate={ () => {} } /> );

	await waitFor( () =>
		expect(
			screen.getByText( groups[ 0 ].provider.label )
		).toBeInTheDocument()
	);
}

describe( 'StoryDiscovery browse-more affordance', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'offers browse-more for a provider that declares search', async () => {
		await renderWith( [
			group( {
				slug: 'foresight-news',
				label: 'Foresight News',
				features: [ 'recommend', 'search' ],
			} ),
		] );

		expect(
			screen.getByRole( 'button', { name: /browse more/i } )
		).toBeInTheDocument();
	} );

	it( 'does not offer browse-more for a recommend-only provider', async () => {
		await renderWith( [
			group( {
				slug: 'parsely-trending',
				label: 'Parse.ly Trending',
				features: [ 'recommend' ],
			} ),
		] );

		expect(
			screen.queryByRole( 'button', { name: /browse more/i } )
		).not.toBeInTheDocument();
	} );

	/**
	 * Mixed is the real case: one section can search, the next cannot. Hiding the
	 * button globally when any provider lacks search would be as wrong as showing
	 * it always.
	 */
	it( 'decides per provider rather than for the whole screen', async () => {
		await renderWith( [
			group( {
				slug: 'foresight-news',
				label: 'Foresight News',
				features: [ 'recommend', 'search' ],
			} ),
			group( {
				slug: 'parsely-trending',
				label: 'Parse.ly Trending',
				features: [ 'recommend' ],
			} ),
		] );

		expect(
			screen.getAllByRole( 'button', { name: /browse more/i } )
		).toHaveLength( 1 );
	} );

	/**
	 * An older cached payload, or a provider registered before features were sent,
	 * has no `features` key. Treat that as "cannot search": a missing button is a
	 * smaller failure than a button that 500s.
	 */
	it( 'withholds browse-more when features are absent', async () => {
		await renderWith( [
			group( {
				slug: 'mystery-provider',
				label: 'Mystery Provider',
				features: undefined,
			} ),
		] );

		expect(
			screen.queryByRole( 'button', { name: /browse more/i } )
		).not.toBeInTheDocument();
	} );

	it( 'still renders the provider’s prompts without a browse-more button', async () => {
		await renderWith( [
			group( {
				slug: 'parsely-trending',
				label: 'Parse.ly Trending',
				features: [ 'recommend' ],
			} ),
		] );

		expect(
			screen.getByText( 'Parse.ly Trending prompt 0' )
		).toBeInTheDocument();
	} );
} );
