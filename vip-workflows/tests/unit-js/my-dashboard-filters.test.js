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

/* eslint-disable import/first */
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
	urgency: 'normal',
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
	urgency: 'normal',
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
