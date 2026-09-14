/**
 * Unit tests for the My Dashboard DataViews field definitions.
 *
 * Two things these tabs got wrong, both invisible from the rendered table:
 *
 *   1. A `text` field with no `elements` still offers a filter, and DataViews
 *      seeds it with the type's first default operator, `isAny`. That operator
 *      is built for an array of chosen elements and does
 *      `filterValue.includes( fieldValue )` — handed the typed string it becomes
 *      String.includes and asks whether the search text contains the whole
 *      title. Filtering by "hello" then excluded "hello world". Naming the text
 *      operators is what makes the filter compare the right way round.
 *
 *   2. My Work lists posts no workflow manages alongside workflow ones. Their
 *      core status used to arrive in the stage field, so a scheduled post
 *      appeared to be at a workflow stage called "Scheduled". Stage and status
 *      are now separate columns, and the stage is empty when there is none.
 *
 * The fields are built inside the page components, so DataViews is stubbed with
 * a capture: it is also untranspiled ESM that Jest cannot load.
 *
 * @package
 */

import { render, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

const mockCaptured = { props: null };

jest.mock( '@wordpress/dataviews/wp', () => {
	// My Work free-composes <DataViews> (see MyWorkPage.js) to slot in a
	// "Group by" control DataViews itself doesn't provide, passing its own
	// toolbar/layout/pagination as children built from `DataViews.*`
	// sub-components. This mock captures `props` exactly as before and never
	// renders `children`, so those sub-components only need to exist as valid
	// element types — a no-op stub is enough for every one of them. Each gets
	// its own function identity (not one shared `noop`) so a test can tell
	// *which* sub-component a page composed in, not just that something did —
	// composing the wrong one, or dropping one silently, is exactly the shape
	// of bug this is for (see the LayoutSwitcher regression test below).
	const DataViews = ( props ) => {
		mockCaptured.props = props;
		return null;
	};
	DataViews.Search = () => null;
	DataViews.FiltersToggle = () => null;
	DataViews.FiltersToggled = () => null;
	DataViews.ViewConfig = () => null;
	DataViews.LayoutSwitcher = () => null;
	DataViews.Layout = () => null;
	DataViews.Pagination = () => null;

	return {
		DataViews,
		filterSortAndPaginate: ( data ) => ( {
			data,
			paginationInfo: { totalItems: data.length, totalPages: 1 },
		} ),
	};
} );

/* eslint-disable import/first */
import { DataViews } from '@wordpress/dataviews/wp';
import { MyWorkPage } from '../../src/admin/pages/MyWorkPage';
import { MyQueuePage } from '../../src/admin/pages/MyQueuePage';
import { MyIdeationPage } from '../../src/admin/pages/MyIdeationPage';
/* eslint-enable import/first */

const WORKFLOW_ROW = {
	post_id: 1,
	title: 'hello world',
	edit_url: 'http://example.test/edit',
	workflow_name: 'Editorial',
	status_label: 'In Review',
	status_color: '#3498db',
	post_status: 'draft',
	post_status_label: 'Draft',
	author: {
		id: 7,
		type: 'user',
		display_name: 'Jane Author',
		agent_actor: null,
		avatar: 'http://example.test/avatar.png',
	},
	assignee: {
		id: 9,
		type: 'user',
		display_name: 'Alex Assignee',
		agent_actor: null,
		avatar: 'http://example.test/avatar.png',
	},
	featured_image_url: 'http://example.test/image.jpg',
	created_date: '2026-01-01 00:00:00',
	modified_date: '2026-01-02 00:00:00',
};

const NON_WORKFLOW_ROW = {
	post_id: 2,
	title: 'hello',
	edit_url: 'http://example.test/edit',
	workflow_name: null,
	status_label: null,
	status_color: null,
	post_status: 'future',
	post_status_label: 'Scheduled',
	author: {
		id: 7,
		type: 'user',
		display_name: 'Jane Author',
		agent_actor: null,
		avatar: 'http://example.test/avatar.png',
	},
	assignee: null,
	featured_image_url: null,
	created_date: '2026-01-01 00:00:00',
	modified_date: '2026-01-02 00:00:00',
};

/**
 * Render a page with a canned endpoint response and return its DataViews fields.
 *
 * @param {Function} Page  Page component.
 * @param {Array}    items Rows the endpoint should answer with.
 * @return {Promise<Array>} Field definitions the page handed to DataViews.
 */
async function fieldsOf( Page, items ) {
	mockCaptured.props = null;
	apiFetch.mockImplementation( () => Promise.resolve( items ) );

	render( <Page /> );

	await waitFor( () => expect( mockCaptured.props ).not.toBeNull() );

	return mockCaptured.props.fields;
}

/**
 * Whether a React element tree contains an element of the given type.
 *
 * The `<DataViews.*>` mock never renders `children` (see the mock above), so
 * a sub-component silently missing from a page's free-composed JSX — the
 * exact shape of the LayoutSwitcher regression this guards — has no other
 * way to surface: nothing throws, nothing looks different in `mockCaptured.props`
 * itself. Walking the element tree the page handed to `<DataViews>` as
 * `children` is what actually proves a given sub-component is composed in.
 *
 * @param {*}        node Element (or array/string/etc.) to search.
 * @param {Function} type Component reference to find.
 * @return {boolean} Whether `type` appears anywhere in the tree.
 */
function containsElementType( node, type ) {
	if ( ! node || typeof node !== 'object' ) {
		return false;
	}
	if ( Array.isArray( node ) ) {
		return node.some( ( child ) => containsElementType( child, type ) );
	}
	if ( node.type === type ) {
		return true;
	}
	return containsElementType( node.props?.children, type );
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
 * Render a field's cell for one row and return its text.
 *
 * @param {Object} definition Field definition.
 * @param {Object} item       Row.
 * @return {string} Cell text.
 */
function cellText( definition, item ) {
	return render( definition.render( { item } ) ).container.textContent;
}

describe( 'free-text filters on the My Dashboard tabs', () => {
	it.each( [
		[ 'My Work', MyWorkPage, [ WORKFLOW_ROW ], 'title' ],
		[
			'My Queue',
			MyQueuePage,
			[ { ...WORKFLOW_ROW, author: 'Ana' } ],
			'title',
		],
		[
			'My Queue author',
			MyQueuePage,
			[ { ...WORKFLOW_ROW, author: 'Ana' } ],
			'author',
		],
		[
			'My Ideation',
			MyIdeationPage,
			[ { id: 1, title: 'hello world', pipeline_status: 'ideation' } ],
			'title',
		],
	] )(
		'%s names the text operators rather than taking the type default',
		async ( _label, Page, items, fieldId ) => {
			const definition = field( await fieldsOf( Page, items ), fieldId );

			// The operator the UI seeds is the first one listed, so `contains`
			// has to lead. `isAny` here is the defect: it compares the typed
			// text against the value, not the value against the typed text.
			expect( definition.filterBy.operators ).toEqual( [
				'contains',
				'notContains',
			] );
		}
	);

	it( 'leaves no filterable field to be filtered by unbacked free text', async () => {
		const fields = await fieldsOf( MyWorkPage, [
			WORKFLOW_ROW,
			NON_WORKFLOW_ROW,
		] );

		for ( const definition of fields ) {
			if ( false === definition.filterBy ) {
				continue;
			}

			// Either the filter offers a bounded list to pick from, or it takes
			// typed text with the text operators named. A `text` field with
			// neither is the broken shape.
			const picksFromElements = Array.isArray( definition.elements );
			const takesTypedText =
				definition.filterBy?.operators?.[ 0 ] === 'contains';

			expect( picksFromElements || takesTypedText ).toBe( true );
		}
	} );
} );

describe( 'My Work separates the workflow stage from the post status', () => {
	it( 'renders no stage for a post no workflow manages', async () => {
		const fields = await fieldsOf( MyWorkPage, [
			WORKFLOW_ROW,
			NON_WORKFLOW_ROW,
		] );
		const stage = field( fields, 'status_label' );

		expect( cellText( stage, WORKFLOW_ROW ) ).toBe( 'In Review' );
		expect( cellText( stage, NON_WORKFLOW_ROW ) ).toBe( '—' );
	} );

	it( 'renders the core status in its own column, for every row', async () => {
		const fields = await fieldsOf( MyWorkPage, [
			WORKFLOW_ROW,
			NON_WORKFLOW_ROW,
		] );
		const status = field( fields, 'post_status' );

		expect( cellText( status, WORKFLOW_ROW ) ).toBe( 'Draft' );
		expect( cellText( status, NON_WORKFLOW_ROW ) ).toBe( 'Scheduled' );
		expect( status.getValue( { item: NON_WORKFLOW_ROW } ) ).toBe(
			'future'
		);
	} );

	it( 'filters the status column from a fixed list, not from the rows', async () => {
		// Only one core status is present in the data. Scraping the rows would
		// leave a one-entry list on My Work and an empty one on a list of
		// nothing but workflow posts; the vocabulary is fixed instead.
		const fields = await fieldsOf( MyWorkPage, [ WORKFLOW_ROW ] );

		expect(
			field( fields, 'post_status' ).elements.map( ( e ) => e.value )
		).toEqual( [ 'draft', 'pending', 'future', 'private', 'publish' ] );
	} );

	it( 'keeps a stageless post out of the stage filter', async () => {
		const fields = await fieldsOf( MyWorkPage, [
			WORKFLOW_ROW,
			NON_WORKFLOW_ROW,
		] );

		// The stage elements are scraped from the rows, so a null stage must not
		// become an element — "no stage" is not a stage to filter by.
		expect(
			field( fields, 'status_label' ).elements.map( ( e ) => e.value )
		).toEqual( [ 'In Review' ] );
	} );
} );

describe( 'My Work SLA removal and the author field', () => {
	it( 'no longer offers an urgency/SLA field', async () => {
		const fields = await fieldsOf( MyWorkPage, [
			WORKFLOW_ROW,
			NON_WORKFLOW_ROW,
		] );

		expect( fields.find( ( f ) => f.id === 'urgency' ) ).toBeUndefined();
	} );

	it( 'filters and groups the author column by display name, and renders the actor', async () => {
		const fields = await fieldsOf( MyWorkPage, [
			WORKFLOW_ROW,
			NON_WORKFLOW_ROW,
		] );
		const author = field( fields, 'author' );

		expect( author.filterBy.operators ).toEqual( [ 'isAny' ] );
		expect( author.elements.map( ( e ) => e.value ) ).toEqual( [
			'Jane Author',
		] );
		expect( author.getValue( { item: WORKFLOW_ROW } ) ).toBe(
			'Jane Author'
		);
		// The avatar renders its own initial fallback alongside the name, so
		// assert the name appears rather than that it is the only text.
		expect( cellText( author, WORKFLOW_ROW ) ).toContain( 'Jane Author' );
	} );

	it( 'filters and groups the assignee column by display name, distinct from the author', async () => {
		const fields = await fieldsOf( MyWorkPage, [
			WORKFLOW_ROW,
			NON_WORKFLOW_ROW,
		] );
		const assignee = field( fields, 'assignee' );

		expect( assignee.filterBy.operators ).toEqual( [ 'isAny' ] );
		// NON_WORKFLOW_ROW is unclaimed (assignee: null), so it contributes no
		// element — only WORKFLOW_ROW's claimant is a choosable filter value.
		expect( assignee.elements.map( ( e ) => e.value ) ).toEqual( [
			'Alex Assignee',
		] );
		expect( assignee.getValue( { item: WORKFLOW_ROW } ) ).toBe(
			'Alex Assignee'
		);
		expect( assignee.getValue( { item: NON_WORKFLOW_ROW } ) ).toBe( '' );
		expect( cellText( assignee, NON_WORKFLOW_ROW ) ).toBe( '—' );
	} );

	it( 'renders the featured image as the grid media, and a placeholder when there is none', async () => {
		const fields = await fieldsOf( MyWorkPage, [
			WORKFLOW_ROW,
			NON_WORKFLOW_ROW,
		] );
		const media = field( fields, 'featured_image' );

		// Not a visible table column: the grid finds it by id via
		// `view.mediaField`, not through the visible-fields list.
		expect(
			mockCaptured.props.view.fields.includes( 'featured_image' )
		).toBe( false );
		expect( mockCaptured.props.view.mediaField ).toBe( 'featured_image' );

		const { container } = render( media.render( { item: WORKFLOW_ROW } ) );
		expect( container.querySelector( 'img' ).src ).toBe(
			WORKFLOW_ROW.featured_image_url
		);

		const { container: emptyContainer } = render(
			media.render( { item: NON_WORKFLOW_ROW } )
		);
		expect(
			emptyContainer.querySelector(
				'.dataviews-view-grid__media-placeholder'
			)
		).not.toBeNull();
	} );

	it( 'offers Workflow as a quick filter chip, alongside Stage', async () => {
		const fields = await fieldsOf( MyWorkPage, [ WORKFLOW_ROW ] );

		expect( field( fields, 'workflow_name' ).filterBy.isPrimary ).toBe(
			true
		);
		expect( field( fields, 'status_label' ).filterBy.isPrimary ).toBe(
			true
		);
	} );

	it.each( [ 'workflow_name', 'status_label', 'author', 'assignee' ] )(
		'sorts %s with a blank value last, in either direction',
		async ( fieldId ) => {
			const fields = await fieldsOf( MyWorkPage, [
				WORKFLOW_ROW,
				NON_WORKFLOW_ROW,
			] );
			const sort = field( fields, fieldId ).sort;

			// A real value beats blank regardless of direction — blank is not
			// "alphabetically first", it is "nothing to sort by, put it last".
			expect( sort( '', 'Editorial', 'asc' ) ).toBeGreaterThan( 0 );
			expect( sort( 'Editorial', '', 'asc' ) ).toBeLessThan( 0 );
			expect( sort( '', 'Editorial', 'desc' ) ).toBeGreaterThan( 0 );
			expect( sort( 'Editorial', '', 'desc' ) ).toBeLessThan( 0 );
			expect( sort( '', '', 'asc' ) ).toBe( 0 );
		}
	);

	it( 'lets Stage be grouped, not just filtered — sortable, not left disabled', async () => {
		// Grouping and column-sort share one gate in DataViews
		// (filterSortAndPaginate looks up a groupBy field the same way it
		// looks up a sort field: `enableSorting !== false`), so Stage sitting
		// in GROUP_BY_FIELDS silently does nothing unless this holds too.
		const fields = await fieldsOf( MyWorkPage, [ WORKFLOW_ROW ] );

		expect( field( fields, 'status_label' ).enableSorting ).not.toBe(
			false
		);
	} );

	it( 'composes a LayoutSwitcher, so the grid layout it registers is reachable', async () => {
		// `<DataViews.ViewConfig>` — unlike the library's own default,
		// non-composed UI — never folds the layout switcher in; free
		// composition needs `<DataViews.LayoutSwitcher>` rendered explicitly,
		// or a grid registered in `defaultLayouts` has no control that reaches
		// it. Asserting on `mockCaptured.props.defaultLayouts` alone would
		// pass even with the switcher missing — this has to walk the actual
		// composed tree.
		await fieldsOf( MyWorkPage, [ WORKFLOW_ROW ] );

		expect( mockCaptured.props.defaultLayouts ).toHaveProperty( 'grid' );
		expect(
			containsElementType(
				mockCaptured.props.children,
				DataViews.LayoutSwitcher
			)
		).toBe( true );
	} );
} );

describe( 'My Work view persistence', () => {
	afterEach( () => {
		window.localStorage.clear();
		delete window.vipWorkflowsAdmin;
	} );

	it( 'persists a changed view to localStorage, namespaced per user', async () => {
		window.vipWorkflowsAdmin = { currentUser: { id: 42 } };
		await fieldsOf( MyWorkPage, [ WORKFLOW_ROW ] );

		act( () => {
			mockCaptured.props.onChangeView( {
				...mockCaptured.props.view,
				groupBy: { field: 'author' },
			} );
		} );

		const stored = JSON.parse(
			window.localStorage.getItem( 'vip_workflows_my_work_view_42' )
		);
		expect( stored.groupBy ).toEqual( { field: 'author' } );
	} );

	it( 'loads a previously persisted view on mount', async () => {
		window.vipWorkflowsAdmin = { currentUser: { id: 42 } };
		window.localStorage.setItem(
			'vip_workflows_my_work_view_42',
			JSON.stringify( { sort: { field: 'title', direction: 'asc' } } )
		);

		await fieldsOf( MyWorkPage, [ WORKFLOW_ROW ] );

		expect( mockCaptured.props.view.sort ).toEqual( {
			field: 'title',
			direction: 'asc',
		} );
	} );

	it( 'falls back to the default view when storage is corrupt', async () => {
		window.vipWorkflowsAdmin = { currentUser: { id: 42 } };
		window.localStorage.setItem(
			'vip_workflows_my_work_view_42',
			'not json'
		);

		await fieldsOf( MyWorkPage, [ WORKFLOW_ROW ] );

		expect( mockCaptured.props.view.sort ).toEqual( {
			field: 'modified_date',
			direction: 'desc',
		} );
	} );
} );
