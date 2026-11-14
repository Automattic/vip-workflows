/**
 * My Queue's report of assignee-access warnings after a quick action.
 *
 * A transition can land with a role assignee whose members cannot all open
 * the post. The server accepts the move and says so in the response's
 * `warnings` list; the screen shows each entry, in the server's own words, on
 * its existing inline Notice surface — the same place a failed quick action
 * reports. A transition that lands without warnings shows none.
 *
 * DataViews is stubbed — the published `./wp` entry is untranspiled ESM Jest
 * cannot parse — with a stand-in that renders the page's own Actions cell for
 * each row, so the quick-action buttons under test are the page's real ones.
 *
 * @package
 */

import apiFetch from '@wordpress/api-fetch';

import { render, screen, fireEvent, act } from './helpers/render-wp-component';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

jest.mock( '@wordpress/dataviews/wp', () => ( {
	DataViews: ( { data, fields } ) => {
		const actions = fields.find(
			( field ) => field.id === 'queue_actions'
		);
		return data.map( ( item ) => (
			<div key={ item.post_id }>{ actions.render( { item } ) }</div>
		) );
	},
	filterSortAndPaginate: ( data ) => ( {
		data,
		paginationInfo: { totalItems: data.length, totalPages: 1 },
	} ),
} ) );

import { MyQueuePage } from '../../src/admin/pages/MyQueuePage';

const ROW = {
	post_id: 5,
	title: 'Post 5',
	edit_url: 'http://example.test/edit/5',
	author: { type: 'user', display_name: 'Ana Ng', avatar: null },
	sequence_name: 'Editorial',
	sequence_id: 3,
	status_key: 'draft',
	status_label: 'Draft',
	status_color: '#3498db',
	waiting: '4 days',
	modified: '2026-08-10 09:00:00',
	quick_actions: [ { to: 'review', label: 'Send to review' } ],
};

const MESSAGE = 'Some members of the Contributor role cannot open this post.';

const WARNING = {
	type: 'assignee_cannot_read',
	meta_key: '_vip_workflows_reviewer',
	role: 'contributor',
	message: MESSAGE,
};

/**
 * Route-aware apiFetch stand-in.
 *
 * @param {Function} transition Handler for the transition POST.
 */
function mockRoutes( transition ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === '/vip-workflows/v1/workflow/my-queue' ) {
			return Promise.resolve( [ ROW ] );
		}
		if (
			path === '/vip-workflows/v1/workflow/post/5/transition' &&
			'POST' === method
		) {
			return transition();
		}
		return Promise.reject(
			new Error( `Unexpected apiFetch path: ${ path }` )
		);
	} );
}

/**
 * Click a control and let the requests it starts settle.
 *
 * @param {HTMLElement} element Control.
 */
async function click( element ) {
	await act( async () => {
		fireEvent.click( element );
	} );
}

/**
 * Render the queue and click the row's quick action.
 */
async function sendToReview() {
	render( <MyQueuePage /> );
	await click(
		await screen.findByRole( 'button', { name: 'Send to review' } )
	);
}

/**
 * The number of transition POSTs made so far.
 *
 * @return {number} Count.
 */
function transitionCalls() {
	return apiFetch.mock.calls.filter( ( [ { method } ] ) => 'POST' === method )
		.length;
}

/**
 * The text of each warning Notice on screen. Read off the Notice itself: it
 * also speaks its text into an a11y live region, which a text query would
 * match too.
 *
 * @return {Array<string>} Messages, in render order.
 */
function warningNotices() {
	return Array.from(
		document.querySelectorAll(
			'.components-notice.is-warning .components-notice__content'
		)
	).map( ( node ) => node.textContent );
}

describe( 'MyQueuePage assignee-access warnings', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'shows each warning the transition returns, in the server words', async () => {
		mockRoutes( () => Promise.resolve( { warnings: [ WARNING ] } ) );
		await sendToReview();

		// Shown after the queue re-fetch, on the inline Notice surface.
		await screen.findByRole( 'button', { name: 'Send to review' } );
		expect( warningNotices() ).toEqual( [ MESSAGE ] );
	} );

	it( 'shows the warnings of the acknowledged retry after a soft-warning confirm', async () => {
		let calls = 0;
		mockRoutes( () => {
			calls += 1;
			return Promise.resolve(
				1 === calls
					? { warnings_pending: true, soft_warnings: [] }
					: { warnings: [ WARNING ] }
			);
		} );
		await sendToReview();

		await click(
			await screen.findByRole( 'button', { name: 'Continue' } )
		);
		await screen.findByRole( 'button', { name: 'Send to review' } );

		expect( transitionCalls() ).toBe( 2 );
		expect( warningNotices() ).toEqual( [ MESSAGE ] );
	} );

	it( 'lets the reader dismiss a warning', async () => {
		mockRoutes( () => Promise.resolve( { warnings: [ WARNING ] } ) );
		await sendToReview();
		await screen.findByRole( 'button', { name: 'Send to review' } );
		expect( warningNotices() ).toEqual( [ MESSAGE ] );

		await click(
			document.querySelector(
				'.components-notice.is-warning .components-notice__dismiss'
			)
		);

		expect( warningNotices() ).toEqual( [] );
	} );

	it( 'shows no warning when the transition returns none', async () => {
		mockRoutes( () => Promise.resolve( {} ) );
		await sendToReview();
		await screen.findByRole( 'button', { name: 'Send to review' } );

		expect( transitionCalls() ).toBe( 1 );
		expect( warningNotices() ).toEqual( [] );
	} );
} );
