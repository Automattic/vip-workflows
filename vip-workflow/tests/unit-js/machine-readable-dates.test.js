/**
 * Every date these surfaces draw, in markup something other than an eye can read.
 *
 * The plugin rendered fourteen kinds of date and not one of them was a `<time>`:
 * a reader saw "Overdue" or "2 hours" or "August 14, 2026 3:45 pm", and a screen
 * reader offering to announce a deadline, an extension turning one into a
 * calendar entry, or anything else parsing the page saw a sentence with no
 * moment behind it. The relative wordings are the sharp end of that — they say
 * how a date stands relative to now and never say the date — so those are the
 * ones asserted hardest here.
 *
 * The other half is the My Queue "Waiting" column, which could not be sorted.
 * The cause was the payload: the route sent `human_time_diff()` prose and no
 * timestamp at all, so a presentation decision taken in PHP had thrown away the
 * only value an ordering could be built from. It sends both now — the phrase a
 * reader sees, and `modified`, the instant the column ranks on and the `<time>`
 * announces — so the wait reads the same here as it does on a Kanban card while
 * the queue is still orderable by it.
 *
 * **The site is in Tokyo here, and that is what makes these tests mean
 * anything.** Left at the package default the site clock is UTC, and on a UTC
 * runner every assertion below would be comparing the browser's clock with
 * itself: an attribute built the wrong way, with `new Date( value
 * ).toISOString()`, would come out identical and the suite would pass. Nine
 * hours east of the fixtures, it cannot.
 *
 * DataViews is stubbed with a capture (it is untranspiled ESM Jest cannot load),
 * and dnd-kit is stubbed because jsdom lays nothing out; both follow the
 * existing dashboard and kanban suites.
 *
 * @package
 */

import { getSettings, setSettings } from '@wordpress/date';

import { render, waitFor } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

const mockCaptured = { props: null };

jest.mock( '@wordpress/dataviews/wp', () => ( {
	DataViews: ( props ) => {
		mockCaptured.props = props;
		return null;
	},
	filterSortAndPaginate: ( data ) => ( {
		data,
		paginationInfo: { totalItems: data.length, totalPages: 1 },
	} ),
} ) );

jest.mock( '@dnd-kit/core', () => ( {
	__esModule: true,
	useDraggable: () => ( {
		attributes: {},
		listeners: {},
		setNodeRef: () => {},
		isDragging: false,
	} ),
} ) );

/* eslint-disable import/first */
import { MyQueuePage } from '../../src/admin/pages/MyQueuePage';
import { MyWorkPage } from '../../src/admin/pages/MyWorkPage';
import { KanbanCard } from '../../src/admin/components/KanbanCard';
/* eslint-enable import/first */

const DEFAULTS = getSettings();
const TOKYO = {
	...DEFAULTS,
	timezone: { ...DEFAULTS.timezone, offset: 9, string: 'Asia/Tokyo' },
};

// The instant the relative wordings are measured from: 15:45 on the 14th in
// Tokyo, mid-afternoon, so no branch of the deadline countdown sits near a
// site-local midnight. Frozen where it matters, below — a deadline built from
// one reading of the clock and judged against another has a window, however
// narrow, in which midnight falls between the two and "Due today" becomes "Due
// tomorrow" for no reason a reader of the failure could reconstruct.
const NOW = new Date( '2026-08-14T06:45:00Z' );

// Fixtures are fixed strings rather than offsets from the clock. Every wording
// on these surfaces is either the server's or measured from a frozen `NOW`, so
// nothing here needs to move with the suite — and a literal is what lets the
// assertions name the expected attribute exactly, which is the only form of
// them a runner in the site's own timezone cannot flatter.
const QUEUE_ROW = {
	post_id: 1,
	title: 'Hello world',
	edit_url: 'http://example.test/edit',
	author: { type: 'user', display_name: 'Ana Ng', avatar: null },
	sequence_name: 'Editorial',
	sequence_id: 3,
	status_key: 'in_review',
	status_label: 'In Review',
	status_color: '#3498db',
	waiting: '3 hours',
	modified: '2026-08-14 12:45:00',
	quick_actions: [],
};

const WORK_ROW = {
	post_id: 1,
	title: 'Hello world',
	edit_url: 'http://example.test/edit',
	workflow_name: 'Editorial',
	status_label: 'In Review',
	status_color: '#3498db',
	post_status: 'draft',
	post_status_label: 'Draft',
	urgency: 'normal',
	created_date: '2026-01-01 09:00:00',
	modified_date: '2026-01-02 15:45:00',
};

/**
 * A Kanban card as the board endpoint serves one.
 *
 * @param {Object} overrides Fields to change.
 * @return {Object} Card.
 */
const kanbanCard = ( overrides = {} ) => ( {
	id: 11,
	title: 'Hello world',
	edit_url: 'http://example.test/edit',
	author: { type: 'user', display_name: 'Ana Ng', avatar: null },
	assigned_to: null,
	due_date: null,
	urgency: 'normal',
	waiting_time: '2 hours',
	modified: '2026-08-14 13:45:00',
	created: '2026-08-11 13:45:00',
	...overrides,
} );

/**
 * Render a page with a canned endpoint response and return what it handed
 * DataViews.
 *
 * @param {Function} Page  Page component.
 * @param {Array}    items Rows the endpoint should answer with.
 * @return {Promise<Object>} The DataViews props.
 */
async function dataViewsOf( Page, items ) {
	mockCaptured.props = null;
	apiFetch.mockImplementation( () => Promise.resolve( items ) );

	render( <Page /> );

	await waitFor( () => expect( mockCaptured.props ).not.toBeNull() );

	return mockCaptured.props;
}

/**
 * Find a field by id.
 *
 * @param {Array}  fields Field definitions.
 * @param {string} id     Field id.
 * @return {Object} The field.
 */
function field( fields, id ) {
	const found = fields.find( ( f ) => f.id === id );
	expect( found ).toBeDefined();
	return found;
}

/**
 * The `<time>` a cell or a card renders.
 *
 * @param {*} ui Element to render.
 * @return {Array<HTMLElement>} Every `<time>` in it.
 */
function times( ui ) {
	return Array.from( render( ui ).container.querySelectorAll( 'time' ) );
}

beforeEach( () => {
	setSettings( TOKYO );
} );

afterEach( () => {
	setSettings( DEFAULTS );
} );

describe( 'the My Queue waiting column', () => {
	it( 'sorts, on the instant rather than on a sentence', async () => {
		const { fields } = await dataViewsOf( MyQueuePage, [ QUEUE_ROW ] );
		const waiting = field( fields, 'waiting' );

		// The column used to declare `enableSorting: false`, which recorded the
		// payload's shortcoming as a property of the column. DataViews gates the
		// header's sort menu on `enableSorting !== false` and resolves an absent
		// value to the `datetime` type's `true`, so assert the resolved answer
		// rather than merely the absence of the old flag.
		expect( waiting.enableSorting ?? true ).toBe( true );
		expect( waiting.getValue( { item: QUEUE_ROW } ) ).toBe(
			QUEUE_ROW.modified
		);

		const older = '2026-08-12 12:45:00';
		expect( waiting.sort( older, QUEUE_ROW.modified, 'asc' ) ).toBeLessThan(
			0
		);
		expect(
			waiting.sort( older, QUEUE_ROW.modified, 'desc' )
		).toBeGreaterThan( 0 );
	} );

	it( 'shows the wait the route worded, over the instant behind it', async () => {
		const { fields } = await dataViewsOf( MyQueuePage, [ QUEUE_ROW ] );
		const [ element ] = times(
			field( fields, 'waiting' ).render( { item: QUEUE_ROW } )
		);

		// A duration, under a header that says "Waiting" — and the same phrase
		// a Kanban card shows for the same post, which is the point of taking
		// it from the route rather than wording it again here. The two screens
		// bucket a wait differently otherwise: PHP has a weeks bucket and the
		// client's relative wording does not, so ten days reads "1 week" on one
		// and "10 days ago" on the other.
		expect( element.textContent ).toBe( '3 hours' );
		expect( element.getAttribute( 'datetime' ) ).toBe(
			'2026-08-14T12:45:00+09:00'
		);
	} );

	it( 'opens on the order the route sent', async () => {
		// Which row leads is a product decision, and the finding this work
		// answers asked only that the column become sortable. It is, so
		// oldest-first is one click away rather than imposed on everybody —
		// and My Work, the sibling tab, states no default sort for the same
		// reason.
		const { view } = await dataViewsOf( MyQueuePage, [ QUEUE_ROW ] );

		expect( view.sort ).toEqual( {} );
	} );
} );

describe( 'the My Work date columns', () => {
	it.each( [
		[ 'modified_date', '2026-01-02T15:45:00+09:00' ],
		[ 'created_date', '2026-01-01T09:00:00+09:00' ],
	] )(
		'renders %s as a <time> naming its instant',
		async ( id, expected ) => {
			const { fields } = await dataViewsOf( MyWorkPage, [ WORK_ROW ] );
			const [ element ] = times(
				field( fields, id ).render( { item: WORK_ROW } )
			);

			// The DataViews `datetime` type renders a bare string, which is
			// what these were: the date was on the page and the moment was not.
			// Asserted as a literal, offset and all — `new Date( value
			// ).toISOString()`, the wrong way to build this, answers
			// `2026-01-02T15:45:00.000Z` on a UTC runner and the *right* instant
			// on a Tokyo one, so only the exact string catches it everywhere.
			expect( element ).not.toBeUndefined();
			expect( element.getAttribute( 'datetime' ) ).toBe( expected );
		}
	);

	it.each( [ 'modified_date', 'created_date' ] )(
		'orders %s on the site clock, not the browser one',
		async ( id ) => {
			const { fields } = await dataViewsOf( MyWorkPage, [ WORK_ROW ] );

			// Both columns override the field type's comparator, which is
			// `new Date( a ) - new Date( b )` and reads an offsetless site-local
			// stamp on whatever clock the reader is sitting on. 09:00 in Tokyo
			// *is* midnight UTC, so the shared comparator calls this pair a tie
			// from anywhere; the type's own would only do so from UTC+9.
			expect(
				field( fields, id ).sort(
					'2026-08-14 09:00:00',
					'2026-08-14T00:00:00Z',
					'asc'
				)
			).toBe( 0 );
		}
	);
} );

describe( 'the Kanban card', () => {
	beforeEach( () => {
		// Today is not a fixed point, so the deadline fixtures below ("Due
		// today", "Due tomorrow") only mean what they say against a frozen
		// clock. Freeze it at NOW; nothing here advances timers.
		jest.useFakeTimers( { now: NOW } );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	it.each( [
		[ 'Overdue', '2026-08-12 09:00:00', '2026-08-12' ],
		[ 'Due today', '2026-08-14 23:00:00', '2026-08-14' ],
		[ 'Due tomorrow', '2026-08-15 09:00:00', '2026-08-15' ],
	] )(
		'puts the deadline behind "%s"',
		( wording, due, expectedAttribute ) => {
			// The words say how the date stands relative to now and never say
			// the date, so the attribute is the only place the deadline exists.
			//
			// It is the day and not an instant, deliberately: every branch of
			// the card's countdown measures calendar days and none of them
			// names an hour, so `2026-08-14T00:00:00+09:00` would assert a
			// midnight the card never claimed.
			const card = kanbanCard( { due_date: due } );
			const deadline = times( <KanbanCard card={ card } /> ).find(
				( element ) => element.textContent === wording
			);

			expect( deadline ).toBeDefined();
			expect( deadline.getAttribute( 'datetime' ) ).toBe(
				expectedAttribute
			);
		}
	);

	it( 'anchors the waiting time to the moment it was worded from', () => {
		const card = kanbanCard();
		const waiting = times( <KanbanCard card={ card } /> ).find(
			( element ) => element.textContent === card.waiting_time
		);

		expect( waiting ).toBeDefined();
		expect( waiting.getAttribute( 'datetime' ) ).toBe(
			'2026-08-14T13:45:00+09:00'
		);
	} );
} );
