/**
 * What the workflow panel no longer draws.
 *
 * Which sequence a post is in, the metadata that sequence declares, and the way
 * out of the workflow are properties of the post, so they moved to the document
 * sidebar's Summary panel (WorkflowSummaryRows). What stays in the panel acts on
 * the post's movement through the workflow: the transition rail and its
 * record. A panel that went on drawing the Workflow row or a Remove button
 * would put the same control in two places, which is the drift these tests
 * exist to stop.
 *
 * The panel also used to take over its whole body for a post whose sequence
 * was deleted, with an explanation and a Remove button. That state is now the
 * Workflow row's to express; the panel says why there is nothing to move and
 * offers nothing else.
 *
 * @package
 */

import { render, screen, waitFor } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-panel-transition-busy.test.js for why these are stubbed: ESM-only
// deps the panel names but does not otherwise exercise.
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
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

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';
const IDEATION_PATH = '/vip-workflows/v1/workflow/post/42/ideation';

/**
 * A metadata field the store holds, so a panel that still drew the metadata
 * rows would have one to draw.
 */
const DESK_FIELD = {
	key: 'desk',
	meta_key: 'wf_meta_35_desk',
	label: 'Desk',
	type: 'text',
};

/**
 * A status payload for a post enrolled in a sequence.
 *
 * @return {Object} Status endpoint response.
 */
function assignedStatus() {
	return {
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
		available_sequences: [ { id: 35, name: 'AI Copy Desk' } ],
	};
}

/**
 * Render the panel over a status payload.
 *
 * @param {Object} status          The status endpoint's answer.
 * @param {Object} [opts]          Options.
 * @param {Object} [opts.ideation] Payload the ideation endpoint answers with.
 * @return {Promise<void>} Resolves once the panel has drawn that answer.
 */
async function renderPanel( status, { ideation = {} } = {} ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === STATUS_PATH ) {
			return Promise.resolve( status );
		}
		if ( path === IDEATION_PATH ) {
			return Promise.resolve( ideation );
		}
		if ( path.startsWith( '/vip-workflows/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect(
			screen.queryByText( 'Loading workflow…' )
		).not.toBeInTheDocument()
	);
}

describe( 'WorkflowPanel after the Summary panel split', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore( { metadataFields: [ DESK_FIELD ] } );
	} );

	it( 'keeps the rail and the history, and nothing that belongs to the post', async () => {
		await renderPanel( assignedStatus() );

		expect(
			screen.getByRole( 'button', { name: 'Send to Review' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Show history' } )
		).toBeInTheDocument();

		// The Workflow row, the metadata rows and the way out all live in the
		// Summary panel now.
		expect(
			screen.queryByRole( 'button', { name: /^Change workflow/ } )
		).not.toBeInTheDocument();
		expect( screen.queryByText( 'Desk' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Remove from workflow' } )
		).not.toBeInTheDocument();
	} );

	it( 'explains an orphaned post without taking it over with a Remove button', async () => {
		await renderPanel( {
			has_workflow: false,
			orphaned: true,
			available_sequences: [],
		} );

		expect(
			screen.getByText(
				'This post belongs to a workflow that no longer exists, so its status cannot be changed.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Remove from workflow' } )
		).not.toBeInTheDocument();
	} );

	it( 'points an unassigned post at the Workflow row instead of drawing a picker', async () => {
		await renderPanel( {
			has_workflow: false,
			orphaned: false,
			available_sequences: [ { id: 35, name: 'AI Copy Desk' } ],
		} );

		expect(
			screen.getByText( /Choose one from the Workflow row/ )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Select a workflow' } )
		).not.toBeInTheDocument();
	} );

	it( 'says so plainly when this post type has no sequences', async () => {
		await renderPanel( {
			has_workflow: false,
			orphaned: false,
			available_sequences: [],
		} );

		expect(
			screen.getByText( 'No workflow available for this post type.' )
		).toBeInTheDocument();
	} );

	it( 'shows ideation research before a workflow is assigned', async () => {
		await renderPanel(
			{
				has_workflow: false,
				orphaned: false,
				available_sequences: [],
			},
			{
				ideation: {
					project_id: 19,
					source: { title: 'City desk briefing' },
					items: [],
				},
			}
		);

		expect(
			await screen.findByText( 'From Ideation' )
		).toBeInTheDocument();
		expect( screen.getByText( 'City desk briefing' ) ).toBeInTheDocument();
	} );
} );
