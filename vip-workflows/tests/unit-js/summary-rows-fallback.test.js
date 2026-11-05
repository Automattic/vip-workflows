/**
 * The workflow sidebar's copy of the Summary rows.
 *
 * The Workflow row and the metadata rows live in core's Summary panel through
 * `PluginPostStatusInfo`, and that slot is not always rendered: a removed
 * `post-status` panel skips it, and some experimental DataForm Summary builds
 * draw none. Without the rows an author cannot assign or remove a workflow or
 * fill a required field, so the sidebar carries the same rows there — and only
 * there, and never while the fill is mounted.
 *
 * @package
 */

import { render, screen, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
	useEntityProp: () => [ {}, () => {} ],
} ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, dispatch, register } from '@wordpress/data';

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

// The one piece of core's panel state the fallback reads: whether the
// `post-status` panel has been removed. Reactive, like core's.
register(
	createReduxStore( 'core/editor', {
		reducer: ( state = { removed: false }, action ) =>
			'SET_REMOVED' === action.type
				? { ...state, removed: action.removed }
				: state,
		selectors: {
			isEditorPanelRemoved: ( state, panel ) =>
				'post-status' === panel && state.removed,
			getEditedPostAttribute: () => 'draft',
			getCurrentPostAttribute: () => 'draft',
			isEditedPostDirty: () => false,
		},
		actions: {
			setRemoved: ( removed ) => ( { type: 'SET_REMOVED', removed } ),
			savePost: () => ( { type: 'NOOP' } ),
		},
	} )
);

// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import {
	SummaryRowsFallback,
	SummaryRowsFill,
} from '../../src/editor/components/SummaryRowsFallback';

const STATUS = {
	has_workflow: true,
	sequence: { id: 7, name: 'Weekend Magazine', slug: 'weekend-magazine' },
	current: { key: 'draft', label: 'Draft', color: '#666' },
	transitions: [],
	all_statuses: [],
	available_sequences: [
		{ id: 7, name: 'Weekend Magazine', slug: 'weekend-magazine' },
	],
};

/**
 * The sidebar's copy, found by its section label.
 *
 * @return {HTMLElement|null} The section, or null.
 */
const queryFallback = () => screen.queryByRole( 'region', { name: 'Details' } );

/**
 * Render the sidebar's copy, and the Summary panel's fill when asked to.
 *
 * @param {Object}  props
 * @param {boolean} props.withFill Whether the Summary panel's fill is mounted.
 * @return {JSX.Element} The tree.
 */
function Editor( { withFill } ) {
	return (
		<>
			<div data-testid="summary-panel">
				{ withFill && <SummaryRowsFill /> }
			</div>
			<div data-testid="workflow-sidebar">
				<SummaryRowsFallback />
			</div>
		</>
	);
}

describe( 'SummaryRowsFallback', () => {
	beforeEach( async () => {
		apiFetch.mockReset();
		apiFetch.mockImplementation( () => Promise.resolve( STATUS ) );
		seedEditorStore( { summaryRowsMounted: 0, summaryRowsSeen: false } );
		await act( async () => {
			dispatch( 'core/editor' ).setRemoved( false );
		} );
		delete window.__experimentalDataFormInspector;
	} );

	afterEach( () => {
		delete window.__experimentalDataFormInspector;
	} );

	it( 'draws nothing where the Summary panel can show the rows', async () => {
		await act( async () => {
			render( <Editor withFill={ false } /> );
		} );

		// The document sidebar is merely closed: the Summary panel is one
		// click away, so the workflow sidebar does not carry a second copy.
		expect( queryFallback() ).not.toBeInTheDocument();
	} );

	it( 'carries the rows while the post-status panel is removed', async () => {
		await act( async () => {
			dispatch( 'core/editor' ).setRemoved( true );
		} );

		await act( async () => {
			render( <Editor withFill={ false } /> );
		} );

		const section = queryFallback();
		expect( section ).toBeInTheDocument();
		expect(
			screen.getByRole( 'heading', { name: 'Details' } )
		).toBeInTheDocument();
		// The same Workflow row the Summary panel draws, and reachable.
		expect(
			await screen.findByRole( 'button', {
				name: 'Change workflow: Weekend Magazine',
			} )
		).toBeInTheDocument();

		// Restoring the panel withdraws the copy.
		await act( async () => {
			dispatch( 'core/editor' ).setRemoved( false );
		} );
		expect( queryFallback() ).not.toBeInTheDocument();
	} );

	it( 'carries the rows under a DataForm Summary until the fill mounts', async () => {
		window.__experimentalDataFormInspector = true;

		const { rerender } = render( <Editor withFill={ false } /> );

		// Not mounted: the sidebar carries the rows.
		expect( queryFallback() ).toBeInTheDocument();

		// The Summary panel turns out to draw the slot: the fill mounts and
		// the sidebar's copy goes in the same commit.
		await act( async () => {
			rerender( <Editor withFill /> );
		} );
		expect( queryFallback() ).not.toBeInTheDocument();
		expect(
			screen.getAllByRole( 'button', {
				name: 'Change workflow: Weekend Magazine',
			} )
		).toHaveLength( 1 );

		// And it stays gone once the document sidebar closes again: the slot
		// is known to render, so the Summary panel is one click away.
		await act( async () => {
			rerender( <Editor withFill={ false } /> );
		} );
		expect( queryFallback() ).not.toBeInTheDocument();
	} );

	it( 'never draws a second copy while the fill is mounted', async () => {
		window.__experimentalDataFormInspector = true;
		await act( async () => {
			dispatch( 'core/editor' ).setRemoved( true );
		} );

		await act( async () => {
			render( <Editor withFill /> );
		} );

		expect( queryFallback() ).not.toBeInTheDocument();
	} );

	it( 'ignores the DataForm flag on post types it does not cover', async () => {
		window.__experimentalDataFormInspector = true;
		seedEditorStore( {
			postType: 'product',
			summaryRowsMounted: 0,
			summaryRowsSeen: false,
		} );

		await act( async () => {
			render( <Editor withFill={ false } /> );
		} );

		expect( queryFallback() ).not.toBeInTheDocument();
	} );
} );
