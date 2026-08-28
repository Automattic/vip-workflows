/**
 * Unit tests for stage-label rendering in the editor sidebar's transition history.
 *
 * The history dialog is fed by `/workflow/post/<id>/history`, which carries the
 * stage labels snapshotted onto each event when it happened. Printing the stage
 * key instead shows the sequence editor's generated identifier ("status_3") as
 * the stage's name, which never changes when the author renames the stage.
 *
 * The trail moved from an inline list in the sidebar card to a modal holding a
 * DataViews activity stream, so the flow under test is now "click Show history,
 * read the dialog" rather than "click the toggle, read the card".
 *
 * The route serves events in the canonical shape the audit log uses — the type
 * plus the recorded `event_data` — and the dialog renders them with the shared
 * event fields, so the fixtures below are whole events rather than the flattened
 * rows this route used to return. Each stage name lands in its own `<strong>`,
 * which is why the assertions name them one at a time.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

/*
 * `@wordpress/core-data` pulls @wordpress/sync, which needs TextEncoder that
 * jsdom does not provide. The panel only uses it to name the store it
 * invalidates the post entity on, so the store name is all this needs.
 */
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );

/*
 * `@wordpress/editor` pulls @wordpress/blocks, whose ESM-only dependencies Jest
 * cannot parse. The panel only needs the store's name plus a few post-state
 * selectors, so a named test store stands in for all of it.
 */
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );

/*
 * DataViews measures the viewport to lay itself out, which jsdom does not do —
 * the same reason the harness cannot open a popover. Stand in for it with a
 * renderer that walks the real field definitions for each row, so what is under
 * test is this file's `getValue` / `render` (where the label-vs-key decision is
 * made) rather than the layout package.
 */
jest.mock( '@wordpress/dataviews/wp', () => {
	const { createElement } = require( '@wordpress/element' );

	const DataViews = ( { data, fields, view, children } ) =>
		createElement(
			'div',
			null,
			data.map( ( item ) =>
				createElement(
					'div',
					{ key: item.id },
					[ view.titleField, view.descriptionField, ...view.fields ]
						.map( ( id ) =>
							fields.find( ( field ) => field.id === id )
						)
						.filter( Boolean )
						.map( ( field ) =>
							createElement(
								'span',
								{ key: field.id },
								// DataViews defaults an unspecified getValue
								// to `item[ field.id ]`; the stub has to do
								// the same or a plain field throws.
								field.render
									? field.render( { item } )
									: (
											field.getValue ??
											( ( { item: row } ) =>
												row[ field.id ] )
									  )( {
											item,
									  } )
							)
						)
				)
			),
			children
		);

	// The dialog composes the stream itself — `<DataViews.Layout />` plus
	// `<DataViews.Footer />` — rather than letting `DefaultUI` draw its
	// view-actions row, so the stub has to carry those sub-components or the
	// element type is undefined. The stub draws the rows itself and renders
	// its children, marking each so a test can see which were composed.
	DataViews.Layout = () =>
		createElement( 'div', { 'data-testid': 'dataviews-layout' } );
	DataViews.Footer = () =>
		createElement( 'div', { 'data-testid': 'dataviews-footer' } );

	return { DataViews };
} );

/*
 * `@wordpress/notices` pulls an ESM-only `uuid` build Jest cannot parse, and
 * `@wordpress/a11y` builds a live region against the real document. The rail
 * only dispatches notices and announces moves, so stubs stand in for both.
 */
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';

register(
	createReduxStore( 'core', {
		reducer: ( state = {} ) => state,
		selectors: { getEntityRecord: () => null },
		actions: { invalidateResolution: () => ( { type: 'NOOP' } ) },
	} )
);

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			getEditedPostAttribute: () => 'draft',
			getCurrentPostAttribute: () => 'draft',
			isEditedPostDirty: () => false,
		},
		actions: { savePost: () => ( { type: 'NOOP' } ) },
	} )
);

/*
 * The real editor store, seeded per test: the panel reads its workflow state
 * from it rather than holding a copy, so a stand-in would test the stand-in.
 */
// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';

const STATUS_PATH = '/vip-workflow/v1/workflow/post/42/status';
const HISTORY_PATH = '/vip-workflow/v1/workflow/post/42/history';

const STATUS_RESPONSE = {
	has_workflow: true,
	sequence: { id: 1, name: 'Label Snapshot Flow' },
	// Deliberately unrelated to the history entries' labels, so an assertion on a
	// history label cannot be satisfied by the current-stage readout.
	current: {
		key: 'status_9',
		label: 'Newsroom',
		color: '#666',
		is_terminal: false,
	},
	transitions: [],
	can_remove: false,
};

/**
 * Stand in for the paged `fetch` Response the history route now returns. The
 * dialog reads the totals from headers and the entries from the body, so a bare
 * array is no longer the shape it consumes.
 *
 * @param {Array} entries History entries.
 * @return {Object} A minimal Response.
 */
function historyResponse( entries ) {
	return {
		ok: true,
		json: () => Promise.resolve( entries ),
		headers: {
			get: ( name ) =>
				name === 'X-WP-Total' ? String( entries.length ) : '1',
		},
	};
}

/**
 * One stage-change event, in the shape the route serves.
 *
 * @param {Object} eventData Recorded event_data, merged over the stage keys.
 * @param {Object} [actor]   Actor object; a person by default.
 * @return {Object} The event.
 */
function stageChange(
	eventData,
	actor = { type: 'user', display_name: 'Ada Lovelace' }
) {
	return {
		id: 1,
		event_type: 'status_transition',
		event_type_label: 'Stage Changed',
		event_data: {
			from_status: 'status_1',
			to_status: 'status_2',
			...eventData,
		},
		actor,
		created_at: '2026-01-01 00:00:00',
	};
}

/**
 * Render the panel with a stubbed status + history response, then open the
 * history dialog and wait for the lazily-loaded module to arrive.
 *
 * @param {Array} history History entries returned by the REST endpoint.
 * @return {Promise<void>} Resolves once the dialog's entries are on screen.
 */
async function renderWithHistory( history ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === STATUS_PATH ) {
			return Promise.resolve( STATUS_RESPONSE );
		}
		if ( path.startsWith( HISTORY_PATH ) ) {
			return Promise.resolve( historyResponse( history ) );
		}
		if ( path.startsWith( '/vip-workflow/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: 'Show history' } )
		).toBeInTheDocument()
	);

	await act( async () => {
		screen.getByRole( 'button', { name: 'Show history' } ).click();
	} );

	// The dialog is code-split, so its module lands a microtask or two after the
	// click; the entries land after its first request resolves.
	await waitFor( () =>
		expect(
			screen.getByRole( 'dialog', { name: 'Workflow History' } )
		).toBeInTheDocument()
	);
}

describe( 'WorkflowPanel transition history stage labels', () => {
	beforeEach( () => {
		seedEditorStore();
	} );

	afterEach( () => {
		apiFetch.mockReset();
	} );

	it( 'renders the snapshotted labels, not the generated stage keys', async () => {
		await renderWithHistory( [
			stageChange( {
				from_label: 'Ideas',
				to_label: 'Copy Desk',
			} ),
		] );

		// The dialog sets no title of its own, so the entry leads with the event
		// described in a sentence: "Stage changed from Ideas to Copy Desk".
		await waitFor( () =>
			expect(
				screen.getByText( 'Stage changed from Ideas to Copy Desk' )
			).toBeInTheDocument()
		);
		expect( screen.queryByText( /status_1/ ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /status_2/ ) ).not.toBeInTheDocument();
	} );

	it( 'falls back to the stage key only when no label was snapshotted', async () => {
		await renderWithHistory( [
			stageChange( { from_label: null, to_label: null } ),
		] );

		await waitFor( () =>
			expect(
				screen.getByText( 'Stage changed from status_1 to status_2' )
			).toBeInTheDocument()
		);
	} );

	it( 'credits the actor the route names', async () => {
		await renderWithHistory( [
			stageChange(
				{ from_label: 'Ideas', to_label: 'Copy Desk' },
				{ type: 'agent', display_name: 'Fact Check Agent' }
			),
		] );

		await waitFor( () =>
			expect( screen.getByText( 'Fact Check Agent' ) ).toBeInTheDocument()
		);
	} );

	it( 'composes the stream from DataViews.Layout and DataViews.Footer', async () => {
		// Left to `DefaultUI`, DataViews draws a whole view-actions row above
		// the stream to hold the "View options" cog — the only part of it that
		// paints here. A one-post trail has one layout, one order the route
		// serves and no fields worth hiding, so there is no view to configure;
		// the dialog names the two pieces it wants instead.
		await renderWithHistory( [
			stageChange( { from_label: 'Ideas', to_label: 'Copy Desk' } ),
		] );

		expect( screen.getByTestId( 'dataviews-layout' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'dataviews-footer' ) ).toBeInTheDocument();
	} );

	it( 'asks the route for a five-entry page, and turns pages rather than scrolling', async () => {
		// PER_PAGE seeds both the view's perPage and the per_page the route is
		// asked with, so the query is the observable half of that one constant.
		// Five keeps the trail inside a dialog that sits beside the editor.
		await renderWithHistory( [
			stageChange( { from_label: 'Ideas', to_label: 'Copy Desk' } ),
		] );

		const historyCall = apiFetch.mock.calls.find( ( [ options ] ) =>
			options.path.startsWith( HISTORY_PATH )
		);
		expect( historyCall[ 0 ].path ).toContain( 'per_page=5' );
		expect( historyCall[ 0 ].path ).toContain( 'page=1' );
	} );

	it( 'names the sequence the audit log has always shown', async () => {
		// The dialog composes the same event fields the audit log does, so the
		// sequence name recorded on the event reaches the editor too — it was
		// dropped while this screen interpreted a stage change on its own.
		await renderWithHistory( [
			stageChange( {
				from_label: 'Ideas',
				to_label: 'Copy Desk',
				// Deliberately not the sequence named in STATUS_RESPONSE: the
				// panel prints that one too, and the assertion must be satisfied
				// by the event's own record rather than the current-stage readout.
				sequence_name: 'Archived Newsroom Flow',
			} ),
		] );

		await waitFor( () =>
			expect(
				screen.getByText( /Archived Newsroom Flow/ )
			).toBeInTheDocument()
		);
	} );
} );
