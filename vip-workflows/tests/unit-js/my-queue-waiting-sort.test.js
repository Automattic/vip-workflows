/**
 * The My Queue "Waiting" column, ordered by the sorter that actually runs.
 *
 * The column reports a duration and used to be unsortable, and the column was
 * not the reason: the route computed `human_time_diff()` and shipped the
 * sentence with no timestamp anywhere in the row, so a presentation decision
 * taken in PHP had thrown away the only value an ordering could be built from.
 * The row carries both now — `waiting`, the phrase a reader sees, and
 * `modified`, the instant it was worded from — and the column ranks on the
 * instant.
 *
 * Asserting the field's own props proves the wiring and stops one step short of
 * the claim: that a reader who clicks the header gets rows in a different
 * order. Between the field and the rows sit two pieces of DataViews the field
 * definition cannot speak for. `normalizeFields` decides whose comparator wins
 * — the field's `sort` or the `datetime` type's — and hands it the two
 * `getValue` results rather than the two rows. `filterSortAndPaginate` then
 * skips any field whose resolved `enableSorting` is false, which is exactly
 * what this column used to declare, and returns the rows untouched when it
 * does. So this suite runs the real one over the page's real field definitions
 * and asserts the order that comes back.
 *
 * The fixtures are chosen so the phrase and the instant disagree. Sorted as
 * text, "1 week", "30 minutes" and "4 days" come back in that order, which is
 * neither oldest-first nor newest-first — so an ordering built on the sentence
 * cannot pass by coincidence, whichever direction is asked for.
 *
 * The site is in Tokyo, nine hours from a UTC runner, because the timestamps
 * are offsetless site-local strings: read on the browser's clock they name
 * different instants than they do on the site's, and the comparator this column
 * declares is the one that reads them on the site's.
 *
 * DataViews itself is stubbed with a capture — the published `./wp` entry is
 * untranspiled ESM Jest cannot parse — but only the component. The sorter is
 * the package's own, taken from its CommonJS build.
 *
 * @package
 */

import { getSettings, setSettings } from '@wordpress/date';
import apiFetch from '@wordpress/api-fetch';

import { act, render, waitFor } from './helpers/render-wp-component';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

const mockCaptured = { props: null };

jest.mock( '@wordpress/dataviews/wp', () => {
	// Same source as the ESM entry the page imports, compiled for a loader Jest
	// can read. Stubbing it — as the sibling date suite does, where the subject
	// is the markup a cell renders rather than the order rows arrive in — would
	// leave the ordering unproven: a pass-through returns whatever it was given.
	const { filterSortAndPaginate } = require( '@wordpress/dataviews' );

	return {
		DataViews: ( props ) => {
			mockCaptured.props = props;
			return null;
		},
		filterSortAndPaginate,
	};
} );

/* eslint-disable import/first */
import { MyQueuePage } from '../../src/admin/pages/MyQueuePage';
/* eslint-enable import/first */

const DEFAULTS = getSettings();
const TOKYO = {
	...DEFAULTS,
	timezone: { ...DEFAULTS.timezone, offset: 9, string: 'Asia/Tokyo' },
};

/**
 * A queue row.
 *
 * @param {number} postId   Post ID, which is what the assertions name.
 * @param {string} waiting  The phrase the route worded the wait as.
 * @param {string} modified The instant it was worded from.
 * @return {Object} The row.
 */
function queueRow( postId, waiting, modified ) {
	return {
		post_id: postId,
		title: `Post ${ postId }`,
		edit_url: `http://example.test/edit/${ postId }`,
		author: { type: 'user', display_name: 'Ana Ng', avatar: null },
		sequence_name: 'Editorial',
		sequence_id: 3,
		status_key: 'in_review',
		status_label: 'In Review',
		status_color: '#3498db',
		waiting,
		modified,
		quick_actions: [],
	};
}

// Sent in the order the route groups them — by sequence, then by stage, newest
// post first inside a group — which is neither of the two orders asked for
// below. A suite whose fixtures arrive already sorted proves nothing about the
// sorter.
const ROWS = [
	queueRow( 2, '4 days', '2026-08-10 09:00:00' ),
	queueRow( 3, '30 minutes', '2026-08-14 12:15:00' ),
	queueRow( 1, '1 week', '2026-08-07 09:00:00' ),
];

const OLDEST_FIRST = [ 1, 2, 3 ];
const NEWEST_FIRST = [ 3, 2, 1 ];

/**
 * Render the page and wait for the endpoint's rows to reach DataViews.
 *
 * @return {Promise<Object>} The captured DataViews props.
 */
async function renderQueue() {
	mockCaptured.props = null;
	apiFetch.mockImplementation( () => Promise.resolve( ROWS ) );

	render( <MyQueuePage /> );

	await waitFor( () => expect( mockCaptured.props ).not.toBeNull() );

	return mockCaptured.props;
}

/**
 * Ask for the column, the way clicking the header does.
 *
 * @param {string} direction 'asc' or 'desc'.
 * @return {Promise<Array<number>>} Post IDs, in the order DataViews received them.
 */
async function sortByWaiting( direction ) {
	const { view, onChangeView } = await renderQueue();

	act( () => {
		onChangeView( {
			...view,
			sort: { field: 'waiting', direction },
		} );
	} );

	await waitFor( () =>
		expect( mockCaptured.props.view.sort.direction ).toBe( direction )
	);

	return mockCaptured.props.data.map( ( item ) => item.post_id );
}

beforeEach( () => {
	setSettings( TOKYO );
} );

afterEach( () => {
	setSettings( DEFAULTS );
} );

describe( 'sorting the My Queue waiting column', () => {
	it( 'reorders the rows, oldest wait first', async () => {
		expect( await sortByWaiting( 'asc' ) ).toEqual( OLDEST_FIRST );
	} );

	it( 'reorders the rows, shortest wait first', async () => {
		expect( await sortByWaiting( 'desc' ) ).toEqual( NEWEST_FIRST );
	} );

	it( 'ranks on the instant rather than on the phrase', async () => {
		// The three phrases sorted as text are "1 week", "30 minutes",
		// "4 days" — posts 1, 3, 2. Neither direction produces that, so
		// neither is reading the sentence. Named as the wait a reader
		// actually sees, so a failure says which row moved where.
		const waits = async ( direction ) => {
			const ids = await sortByWaiting( direction );
			return ids.map(
				( id ) => ROWS.find( ( row ) => row.post_id === id ).waiting
			);
		};

		expect( await waits( 'asc' ) ).toEqual( [
			'1 week',
			'4 days',
			'30 minutes',
		] );
		expect( await waits( 'desc' ) ).toEqual( [
			'30 minutes',
			'4 days',
			'1 week',
		] );
	} );

	it( 'leaves the route’s order alone until it is asked to', async () => {
		// The endpoint groups its rows and the screen opens on that grouping.
		// Re-sorting on arrival would be the reader's order imposed rather
		// than chosen, which is what the column being unsortable had forced.
		const { data } = await renderQueue();

		expect( data.map( ( item ) => item.post_id ) ).toEqual(
			ROWS.map( ( row ) => row.post_id )
		);
	} );
} );
