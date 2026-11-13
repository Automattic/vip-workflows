/**
 * The failed AI stage in the Workflow panel: Run again and Go back.
 *
 * Run again retries the agent in place, started by whoever presses it, so it
 * leads whenever the server says the run can go again. Go back stays beside it
 * as the way out, and leads only when a re-run is not offered.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/edit-post', () => ( { store: 'core/edit-post' } ) );
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
			removeNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			isEditorPanelRemoved: () => false,
			isEditorPanelEnabled: () => true,
			getEditedPostAttribute: () => 'draft',
			getCurrentPostAttribute: () => 'draft',
			getCurrentPostId: () => 42,
			isEditedPostDirty: () => false,
			isSavingPost: () => false,
		},
		actions: { savePost: () => ( { type: 'NOOP' } ) },
	} )
);

// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';
// eslint-disable-next-line import/first
import { TransitionFlow } from '../../src/editor/components/TransitionFlow';

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';
const RERUN_PATH = '/vip-workflows/v1/workflow/post/42/agent-rerun';
const REVERT_PATH = '/vip-workflows/v1/workflow/post/42/agent-revert';

const failedStatus = ( agentJob ) => ( {
	has_workflow: true,
	sequence: { id: 1, name: 'AI Flow' },
	current: {
		key: 'ai_desk',
		label: 'AI Desk',
		color: '#666',
		is_terminal: false,
	},
	transitions: [],
	agent_pending: false,
	agent_job: { status: 'failed', error: 'Agent run timed out.', ...agentJob },
	can_remove: false,
} );

/**
 * Render the panel against a status payload, recording every request.
 *
 * @param {Object} payload Status payload the panel reads.
 * @return {Promise<Array>} The recorded requests.
 */
async function renderPanel( payload ) {
	const calls = [];
	apiFetch.mockImplementation( ( request ) => {
		calls.push( request );
		if ( request.path === STATUS_PATH ) {
			return Promise.resolve( payload );
		}
		if ( request.path === RERUN_PATH ) {
			return Promise.resolve( {
				...payload,
				agent_pending: true,
				agent_job: { status: 'pending', error: '' },
			} );
		}
		if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( {} );
	} );

	render(
		<>
			<TransitionFlow />
			<WorkflowPanel />
		</>
	);

	await waitFor( () =>
		expect(
			screen.getByText( 'The AI agent could not finish.' )
		).toBeInTheDocument()
	);

	return calls;
}

describe( 'WorkflowPanel failed agent actions', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore();
	} );

	it( 'runs the agent again in place, ahead of Go back', async () => {
		const calls = await renderPanel(
			failedStatus( {
				can_rerun: true,
				revert_to: { key: 'drafting', label: 'Drafting' },
			} )
		);

		const runAgain = screen.getByRole( 'button', { name: 'Run again' } );
		const goBack = screen.getByRole( 'button', {
			name: 'Go back to Drafting',
		} );
		expect( runAgain ).toHaveClass( 'is-primary' );
		expect( goBack ).toHaveClass( 'is-secondary' );

		await act( async () => {
			runAgain.click();
		} );

		expect(
			calls.some( ( c ) => c.path === RERUN_PATH && c.method === 'POST' )
		).toBe( true );
		expect(
			calls.some( ( c ) => c.path.endsWith( '/agent-revert' ) )
		).toBe( false );

		// The run is pending now: the failure and its actions are gone.
		await waitFor( () =>
			expect(
				screen.queryByText( 'The AI agent could not finish.' )
			).toBeNull()
		);
		expect(
			screen.queryByRole( 'button', { name: 'Run again' } )
		).toBeNull();
	} );

	it( 'shows the refusal and re-reads the post when Run again is refused', async () => {
		const failed = failedStatus( {
			can_rerun: true,
			revert_to: { key: 'drafting', label: 'Drafting' },
		} );
		let refused = false;
		const calls = [];
		apiFetch.mockImplementation( ( request ) => {
			calls.push( request );
			if ( request.path === RERUN_PATH ) {
				refused = true;
				return Promise.reject( {
					code: 'agent_rerun_conflict',
					message:
						'This agent run changed while you were starting it. Reload the post to see where it is now.',
				} );
			}
			if ( request.path === STATUS_PATH ) {
				// Someone else's re-run is now pending.
				return Promise.resolve(
					refused
						? {
								...failed,
								agent_pending: true,
								agent_job: { status: 'pending', error: '' },
						  }
						: failed
				);
			}
			if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		render(
			<>
				<TransitionFlow />
				<WorkflowPanel />
			</>
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Run again' } )
			).toBeInTheDocument()
		);

		await act( async () => {
			screen.getByRole( 'button', { name: 'Run again' } ).click();
		} );

		expect(
			await screen.findByText(
				'This agent run changed while you were starting it. Reload the post to see where it is now.'
			)
		).toBeInTheDocument();
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Run again' } )
			).toBeNull()
		);
		expect(
			calls.filter( ( c ) => c.path === STATUS_PATH ).length
		).toBeGreaterThan( 1 );
	} );

	it( 'shows the refusal and re-reads the post when Go back is refused', async () => {
		const failed = failedStatus( {
			can_rerun: true,
			revert_to: { key: 'drafting', label: 'Drafting' },
		} );
		let refused = false;
		const calls = [];
		apiFetch.mockImplementation( ( request ) => {
			calls.push( request );
			if ( request.path === REVERT_PATH ) {
				refused = true;
				return Promise.reject( {
					code: 'agent_revert_conflict',
					message:
						'This agent run changed while you were going back. Reload the post to see where it is now.',
				} );
			}
			if ( request.path === STATUS_PATH ) {
				// Someone else's Run again won; its run is now pending.
				return Promise.resolve(
					refused
						? {
								...failed,
								agent_pending: true,
								agent_job: { status: 'pending', error: '' },
						  }
						: failed
				);
			}
			if ( request.path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );

		render(
			<>
				<TransitionFlow />
				<WorkflowPanel />
			</>
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Go back to Drafting' } )
			).toBeInTheDocument()
		);

		await act( async () => {
			screen
				.getByRole( 'button', { name: 'Go back to Drafting' } )
				.click();
		} );

		expect(
			await screen.findByText(
				'This agent run changed while you were going back. Reload the post to see where it is now.'
			)
		).toBeInTheDocument();
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Go back to Drafting' } )
			).toBeNull()
		);
		expect(
			calls.filter( ( c ) => c.path === STATUS_PATH ).length
		).toBeGreaterThan( 1 );
	} );

	it( 'leads with Go back when the run cannot go again', async () => {
		await renderPanel(
			failedStatus( {
				can_rerun: false,
				revert_to: { key: 'drafting', label: 'Drafting' },
			} )
		);

		expect(
			screen.queryByRole( 'button', { name: 'Run again' } )
		).toBeNull();
		expect(
			screen.getByRole( 'button', { name: 'Go back to Drafting' } )
		).toHaveClass( 'is-primary' );
	} );
} );
