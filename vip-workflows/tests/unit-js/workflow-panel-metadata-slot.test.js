/**
 * Where the editorial metadata section sits in the workflow sidebar.
 *
 * The sidebar used to read stage → transitions → [Show history / Remove from
 * workflow] → metadata, because `src/editor/index.js` composed the panel and the
 * metadata as two flat sibling sections and the panel's foot lives inside the
 * panel. That put the two buttons that act on the workflow ITSELF in the middle
 * of the run of things the writer fills in.
 *
 * The foot cannot simply be lifted out to a third sibling: it needs the panel's
 * `transitioning` and `historyOpen` state and the lazily-imported history
 * dialog, so lifting it would mean lifting panel state into the store for a
 * reorder. The metadata is passed to the panel as a child instead, and the panel
 * seats it between the transition rail and the foot. This file is what keeps
 * that seating honest.
 *
 * The nesting also made the panel the only thing that decides whether the
 * section reaches the screen at all — every one of its returns, including the
 * ones that draw no workflow, has to render the slot or the post's editorial
 * fields disappear with the workflow. So each return is pinned here too.
 *
 * @package
 */

import { render, screen, waitFor } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { useEffect } from '@wordpress/element';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-panel-transition-busy.test.js for why these are stubbed: ESM-only
// deps the panel names but does not otherwise exercise. The core-data stub
// carries `useEntityProp` too — the real metadata section reads its values
// through it — with the one field this file's fixture declares already set.
jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
	useEntityProp: () => [ { wf_meta_35_desk: 'Foreign' }, () => {} ],
} ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
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

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';
// eslint-disable-next-line import/first
import { MetadataPanel } from '../../src/editor/components/MetadataPanel';

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';

/**
 * Stand-in for the metadata section: the panel is only asked where it puts its
 * child, so the child needs to be findable and nothing more.
 *
 * @return {JSX.Element} A marked node.
 */
function MetadataStub() {
	return <div data-testid="metadata-section">Editorial metadata</div>;
}

/**
 * Render the panel with a workflow assigned and the metadata stub as its child.
 *
 * @return {Promise<void>} Resolves once the transition button is on screen.
 */
async function renderPanel() {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( {
				has_workflow: true,
				sequence: { id: 35, name: 'AI Copy Desk' },
				current: {
					key: 'draft',
					label: 'Draft',
					color: '#666',
					is_terminal: false,
				},
				transitions: [
					{
						to: 'review',
						label: 'Send to Review',
						kind: 'normal',
						status_info: {
							key: 'review',
							label: 'Review',
							is_terminal: false,
						},
					},
				],
				can_remove: true,
			} );
		}
		if ( path.startsWith( '/vip-workflows/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( {} );
	} );

	render(
		<WorkflowPanel>
			<MetadataStub />
		</WorkflowPanel>
	);

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: 'Send to Review' } )
		).toBeInTheDocument()
	);
}

/**
 * Render the panel over a status payload of the caller's choosing, with the
 * metadata stub as its child.
 *
 * @param {Object} status The status endpoint's answer.
 * @return {Promise<void>} Resolves once the panel has drawn that answer.
 */
async function renderPanelOver( status ) {
	apiFetch.mockImplementation( ( { path } ) =>
		Promise.resolve( path === STATUS_PATH ? status : {} )
	);

	render(
		<WorkflowPanel>
			<MetadataStub />
		</WorkflowPanel>
	);

	await waitFor( () =>
		expect(
			screen.queryByText( 'Loading workflow…' )
		).not.toBeInTheDocument()
	);
}

/**
 * The one sequence-declared field this file's metadata fixture holds, in the
 * shape the status endpoint and the server bootstrap both serve.
 */
const DESK_FIELD = {
	key: 'desk',
	meta_key: 'wf_meta_35_desk',
	label: 'Desk',
	type: 'text',
};

/**
 * Whether `first` precedes `second` in document order.
 *
 * Read off a flat list of every rendered element rather than
 * `compareDocumentPosition`, whose answer is a bitmask.
 *
 * @param {Element} first  The node expected to come first.
 * @param {Element} second The node expected to come second.
 * @return {boolean} True when `first` precedes `second`.
 */
function precedes( first, second ) {
	const rendered = Array.from( document.body.querySelectorAll( '*' ) );
	return rendered.indexOf( first ) < rendered.indexOf( second );
}

describe( 'WorkflowPanel metadata slot', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		// `hydrate` merges, and the store outlives a render — so the fields are
		// cleared by name rather than left over from whichever test ran last.
		seedEditorStore( { metadataFields: [] } );
	} );

	// Seated in every branch, but at a different child index in each — and React
	// matches unkeyed siblings by position, so the section was torn down and
	// rebuilt the moment the status read resolved and the panel swapped
	// branches. That re-ran every user field's lookup and closed anything open,
	// which is the blink the loading branch renders it to avoid in the first
	// place. The slot carries a key, so the instance survives the swap.
	it( 'keeps one instance of the metadata across the status read', async () => {
		let mounts = 0;
		function CountingStub() {
			useEffect( () => {
				mounts += 1;
			}, [] );
			return <div data-testid="metadata-section">Editorial metadata</div>;
		}

		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === STATUS_PATH && method !== 'POST' ) {
				return Promise.resolve( {
					has_workflow: true,
					sequence: { id: 35, name: 'AI Copy Desk' },
					current: {
						key: 'draft',
						label: 'Draft',
						color: '#666',
						is_terminal: false,
					},
					transitions: [
						{
							to: 'review',
							label: 'Send to Review',
							kind: 'normal',
							status_info: {
								key: 'review',
								label: 'Review',
								is_terminal: false,
							},
						},
					],
					can_remove: true,
				} );
			}
			if ( path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		render(
			<WorkflowPanel>
				<CountingStub />
			</WorkflowPanel>
		);

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Send to Review' } )
			).toBeInTheDocument()
		);

		expect( mounts ).toBe( 1 );
	} );

	it( 'seats the metadata below the transition rail', async () => {
		await renderPanel();

		expect(
			precedes(
				screen.getByRole( 'button', { name: 'Send to Review' } ),
				screen.getByTestId( 'metadata-section' )
			)
		).toBe( true );
	} );

	it( 'seats the metadata above the panel foot, so the workflow actions come last', async () => {
		await renderPanel();

		const metadata = screen.getByTestId( 'metadata-section' );

		expect(
			precedes(
				metadata,
				screen.getByRole( 'button', { name: 'Show history' } )
			)
		).toBe( true );
		expect(
			precedes(
				metadata,
				screen.getByRole( 'button', {
					name: 'Remove from workflow',
				} )
			)
		).toBe( true );
	} );

	it( 'keeps the real fields on screen while the workflow status is still loading', async () => {
		// The fields come from the server bootstrap, not from the status read,
		// so they are already known while the panel spins — hiding them until
		// the read lands would blink them out for no reason. The real section
		// stands here rather than the stub: a stub would only show that the
		// slot renders children, and the claim is about the fields.
		seedEditorStore( { metadataFields: [ DESK_FIELD ] } );
		apiFetch.mockImplementation( () => new Promise( () => {} ) );

		render(
			<WorkflowPanel>
				<MetadataPanel />
			</WorkflowPanel>
		);

		expect( screen.getByText( 'Loading workflow…' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Desk' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Change Desk: Foreign' } )
		).toBeInTheDocument();
	} );

	// The three returns that draw no workflow. Every payload behind them
	// carries an empty `metadata_fields` today, so dropping the slot in any of
	// them would be invisible until the day one does not — which is exactly the
	// kind of cross-layer dependency the panel should not be holding.

	it( 'keeps the metadata on screen for a post whose workflow was deleted', async () => {
		await renderPanelOver( {
			has_workflow: false,
			orphaned: true,
			available_sequences: [],
			metadata_fields: [],
		} );

		expect(
			screen.getByRole( 'button', { name: 'Remove from workflow' } )
		).toBeInTheDocument();
		expect( screen.getByTestId( 'metadata-section' ) ).toBeInTheDocument();
	} );

	it( 'keeps the metadata on screen when the post type has no workflow to offer', async () => {
		await renderPanelOver( {
			has_workflow: false,
			orphaned: false,
			available_sequences: [],
			metadata_fields: [],
		} );

		expect(
			screen.getByText( 'No workflow available for this post type.' )
		).toBeInTheDocument();
		expect( screen.getByTestId( 'metadata-section' ) ).toBeInTheDocument();
	} );

	it( 'keeps the metadata on screen while a workflow is still being chosen', async () => {
		await renderPanelOver( {
			has_workflow: false,
			orphaned: false,
			available_sequences: [ { id: 35, name: 'AI Copy Desk' } ],
			metadata_fields: [],
		} );

		expect(
			screen.getByRole( 'button', { name: 'Select a workflow' } )
		).toBeInTheDocument();
		expect( screen.getByTestId( 'metadata-section' ) ).toBeInTheDocument();
	} );
} );
