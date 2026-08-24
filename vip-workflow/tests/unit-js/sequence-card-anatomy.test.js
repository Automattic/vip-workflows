/**
 * Unit tests for what a sequence card says.
 *
 * The card is title and description. It used to carry a `Post types: post, page`
 * line, which printed raw registered slugs where a reader expects the labels
 * (*Posts*, *Pages*) and, either way, said less about the sequence than a
 * sentence of description does.
 *
 * What did NOT go is the pair of badges that flag a broken sequence: a post
 * type named in the config that no longer exists, or a config left with no
 * usable type at all. Those are worth interrupting a scan for, and they are the
 * reason the screen still fetches the registered types at all — so they are
 * pinned here beside the removals, as the thing that must survive them.
 *
 * These drive the real DataViews rather than a stand-in, for the reason
 * jobs-tab-run-now.test.js gives: the chrome around the cards is DataViews' own.
 * `@wordpress/dataviews/wp` ships as untransformed ESM that Jest cannot parse,
 * so the package's CommonJS build stands in for it.
 *
 * @package
 */

import { render, screen, within } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );

jest.mock( '@wordpress/dataviews/wp', () => require( '@wordpress/dataviews' ) );
// The package's untranspiled ESM cannot be required here, and the screen only
// needs the store's key: its one dispatch is the snackbar a failed export
// raises, which nothing below provokes.
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';

// eslint-disable-next-line import/first
import { SequencesList } from '../../src/admin/components/SequencesList';

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = [] ) => state,
		actions: {
			createErrorNotice: () => ( { type: 'CREATE_ERROR_NOTICE' } ),
		},
	} )
);

/** The post types this site has registered, as /wp/v2/types answers. */
const REGISTERED_TYPES = { post: {}, page: {}, newsroom_story: {} };

const HEALTHY = {
	id: 1,
	name: 'Newsroom Pipeline',
	description: 'Reporting desk, from assignment through publication.',
	type: 'workflow',
	status: 'active',
	post_types: [ 'newsroom_story' ],
	config: {},
};

const STALE_TYPE = {
	id: 2,
	name: 'Legacy Pipeline',
	description: 'Points at a post type this site no longer registers.',
	type: 'workflow',
	status: 'active',
	post_types: [ 'post', 'retired_type' ],
	config: {},
};

/**
 * Render the list and wait for the fetched sequences to reach the cards.
 *
 * @return {Promise<void>} Resolves once the first card is on screen.
 */
async function renderList() {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/wp/v2/types' ) {
			return Promise.resolve( REGISTERED_TYPES );
		}
		return Promise.resolve( [ HEALTHY, STALE_TYPE ] );
	} );
	render( <SequencesList /> );
	await screen.findByText( HEALTHY.name );
}

/**
 * The card a given sequence was drawn as.
 *
 * Located by its block class: a card composed by the screen carries no ARIA
 * role of its own, so the class is the card's boundary.
 *
 * @param {Object} sequence One of the fixtures above.
 * @return {HTMLElement} The card element.
 */
function cardFor( sequence ) {
	return screen
		.getByText( sequence.name )
		.closest( '.vip-workflow-summary-card' );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'A sequence card', () => {
	it( 'says its name and its description', async () => {
		await renderList();

		const card = cardFor( HEALTHY );
		expect(
			within( card ).getByText( HEALTHY.description )
		).toBeInTheDocument();
	} );

	it( 'does not list the post types it targets', async () => {
		await renderList();

		expect( screen.queryByText( /Post types:/ ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( /newsroom_story/ )
		).not.toBeInTheDocument();
	} );

	it( 'still flags a post type the site no longer registers', async () => {
		await renderList();

		const card = cardFor( STALE_TYPE );
		expect(
			within( card ).getByText( 'Invalid post types' )
		).toBeInTheDocument();
	} );
} );
