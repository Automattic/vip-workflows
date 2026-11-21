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

import { createReduxStore, register, dispatch } from '@wordpress/data';

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

import { seedEditorStore } from './helpers/editor-store';
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';
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

	describe( 'Go back blocked by a required tool', () => {
		const failed = failedStatus( {
			can_rerun: true,
			revert_to: { key: 'drafting', label: 'Drafting' },
		} );

		/**
		 * Render the panel, have the server refuse Go back with `refusal`,
		 * and press Go back.
		 *
		 * @param {Object} refusal The rejected apiFetch error.
		 */
		async function pressBlockedGoBack( refusal ) {
			apiFetch.mockImplementation( ( request ) => {
				if ( request.path === REVERT_PATH ) {
					return Promise.reject( refusal );
				}
				if ( request.path === STATUS_PATH ) {
					return Promise.resolve( failed );
				}
				return Promise.resolve( [] );
			} );

			render(
				<>
					<TransitionFlow />
					<WorkflowPanel />
				</>
			);
			const goBack = await screen.findByRole( 'button', {
				name: 'Go back to Drafting',
			} );
			await act( async () => {
				goBack.click();
			} );
		}

		it( 'lists the failed checks in the Transition blocked dialog', async () => {
			await pressBlockedGoBack( {
				code: 'tool_check_failed',
				message: 'Transition blocked by required checks.',
				data: {
					status: 422,
					hard_failures: [
						{
							tool: 'acme/fact-check',
							key: 'execution_error',
							message: 'The fact check service is unreachable.',
							severity: 'hard',
						},
					],
					soft_warnings: [],
				},
			} );

			expect(
				await screen.findByText( 'Transition blocked' )
			).toBeInTheDocument();
			expect(
				screen.getByText( 'The fact check service is unreachable.' )
			).toBeInTheDocument();
			expect(
				screen.getByText( 'acme/fact-check:' )
			).toBeInTheDocument();
			expect( screen.queryByText( 'Warnings detected' ) ).toBeNull();
		} );

		it( 'falls back to the notice when the refusal lists no checks', async () => {
			await pressBlockedGoBack( {
				code: 'tool_check_failed',
				message: 'Transition blocked by required checks.',
				data: { status: 422, hard_failures: [], soft_warnings: [] },
			} );

			expect(
				await screen.findByText(
					'Transition blocked by required checks.'
				)
			).toBeInTheDocument();
			expect( screen.queryByText( 'Transition blocked' ) ).toBeNull();
		} );
	} );

	describe( 'Go back held for soft warnings', () => {
		const held = {
			warnings_pending: true,
			soft_warnings: [ { message: 'Readability is low' } ],
		};
		const failed = failedStatus( {
			can_rerun: true,
			revert_to: { key: 'drafting', label: 'Drafting' },
		} );
		const moved = {
			...failed,
			current: {
				key: 'drafting',
				label: 'Drafting',
				color: '#666',
				is_terminal: false,
			},
			agent_job: null,
		};

		/**
		 * Render the panel with a Go back the server holds until it is
		 * acknowledged, then press Go back.
		 *
		 * @return {Promise<Array>} The recorded requests.
		 */
		async function pressHeldGoBack() {
			const calls = [];
			apiFetch.mockImplementation( ( request ) => {
				calls.push( request );
				if ( request.path === REVERT_PATH ) {
					return Promise.resolve(
						request.data?.acknowledge_warnings ? moved : held
					);
				}
				if ( request.path === STATUS_PATH ) {
					return Promise.resolve( failed );
				}
				if (
					request.path.startsWith( '/vip-workflows/v1/abilities' )
				) {
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
			const goBack = await screen.findByRole( 'button', {
				name: 'Go back to Drafting',
			} );
			await act( async () => {
				goBack.click();
			} );

			return calls;
		}

		it( 'sends one request for repeated Go back presses while busy', async () => {
			await renderPanel( failed );
			let answer;
			const requests = [];
			apiFetch.mockImplementation( ( request ) => {
				requests.push( request );
				return new Promise( ( resolve ) => {
					answer = resolve;
				} );
			} );
			const button = screen.getByRole( 'button', {
				name: 'Go back to Drafting',
			} );
			await act( async () => {
				button.click();
			} );
			await act( async () => {
				button.click();
			} );
			expect(
				requests.filter( ( c ) => c.path === REVERT_PATH )
			).toHaveLength( 1 );
			await act( async () => {
				answer( held );
			} );
		} );

		it( 'shows the warnings instead of reporting success', async () => {
			const calls = await pressHeldGoBack();

			expect(
				await screen.findByText( 'Warnings detected' )
			).toBeInTheDocument();
			expect(
				screen.getByText( 'Readability is low' )
			).toBeInTheDocument();

			// Nothing moved: the failure and both its actions are still there.
			expect(
				screen.getByText( 'The AI agent could not finish.' )
			).toBeInTheDocument();
			expect(
				calls.filter( ( c ) => c.path === REVERT_PATH )
			).toHaveLength( 1 );
			expect( calls.find( ( c ) => c.path === REVERT_PATH ).data ).toBe(
				undefined
			);
		} );

		it( 'sends Go back again with the acknowledgement on Continue', async () => {
			const calls = await pressHeldGoBack();

			const continueButton = await screen.findByRole( 'button', {
				name: 'Continue',
			} );
			await act( async () => {
				continueButton.click();
			} );

			const reverts = calls.filter( ( c ) => c.path === REVERT_PATH );
			expect( reverts ).toHaveLength( 2 );
			expect( reverts[ 1 ].data ).toEqual( {
				acknowledge_warnings: true,
			} );

			await waitFor( () =>
				expect( screen.queryByText( 'Warnings detected' ) ).toBeNull()
			);
			await waitFor( () =>
				expect(
					screen.queryByText( 'The AI agent could not finish.' )
				).toBeNull()
			);
		} );

		it( 'leaves the failed stage as it was on Cancel', async () => {
			const calls = await pressHeldGoBack();

			const cancelButton = await screen.findByRole( 'button', {
				name: 'Cancel',
			} );
			await act( async () => {
				cancelButton.click();
			} );

			expect( screen.queryByText( 'Warnings detected' ) ).toBeNull();
			expect(
				calls.filter( ( c ) => c.path === REVERT_PATH )
			).toHaveLength( 1 );
			expect(
				screen.getByRole( 'button', { name: 'Run again' } )
			).toBeEnabled();
			expect(
				screen.getByRole( 'button', { name: 'Go back to Drafting' } )
			).toBeEnabled();
		} );

		it( 'sends one confirmation while Continue is busy and ignores another Go back', async () => {
			const calls = await pressHeldGoBack();
			let resolveRevert;
			apiFetch.mockImplementation( ( request ) => {
				calls.push( request );
				return new Promise( ( resolve ) => {
					resolveRevert = resolve;
				} );
			} );
			const button = screen.getByRole( 'button', { name: 'Continue' } );
			await act( async () => {
				button.click();
			} );
			await act( async () => {
				button.click();
				dispatch( 'vip-workflows/editor' ).requestRevert( 'header' );
			} );
			expect(
				calls.filter( ( c ) => c.path === REVERT_PATH )
			).toHaveLength( 2 );
			await act( async () => {
				resolveRevert( moved );
			} );
		} );

		it( 'retires a held Go back when a status poll changes the failed job', async () => {
			const calls = await pressHeldGoBack();
			await act( async () => {
				dispatch( 'vip-workflows/editor' ).receiveWorkflowStatus( {
					...failed,
					current: {
						...failed.current,
						key: 'other_ai',
						label: 'Other AI',
					},
					agent_job: {
						status: 'failed',
						revert_to: { key: 'review', label: 'Review' },
					},
				} );
			} );

			// Consent was requested for the old job and its warnings.
			expect( screen.queryByText( 'Warnings detected' ) ).toBeNull();
			expect(
				calls.filter( ( c ) => c.path === REVERT_PATH )
			).toHaveLength( 1 );
		} );

		it.each( [ false, true ] )(
			'keeps an unchanged failed job confirmable across a status read (before response: %s)',
			async ( beforeResponse ) => {
				await renderPanel( failed );
				let resolveRevert;
				const calls = [];
				apiFetch.mockImplementation( ( request ) => {
					calls.push( request );
					return new Promise( ( resolve ) => {
						resolveRevert = resolve;
					} );
				} );
				await act( async () => {
					screen
						.getByRole( 'button', { name: 'Go back to Drafting' } )
						.click();
				} );
				const readUnchangedStatus = () =>
					dispatch( 'vip-workflows/editor' ).receiveWorkflowStatus( {
						...failed,
						current: { ...failed.current },
						agent_job: { ...failed.agent_job },
					} );
				await act( async () => {
					if ( beforeResponse ) {
						readUnchangedStatus();
					}
					resolveRevert( held );
				} );
				if ( ! beforeResponse ) {
					await act( async () => {
						readUnchangedStatus();
					} );
				}
				expect(
					screen.getByText( 'Warnings detected' )
				).toBeInTheDocument();
				await act( async () => {
					screen.getByRole( 'button', { name: 'Continue' } ).click();
				} );
				const reverts = calls.filter( ( c ) => c.path === REVERT_PATH );
				expect( reverts ).toHaveLength( 2 );
				expect( reverts[ 1 ].data ).toEqual( {
					acknowledge_warnings: true,
				} );
				await act( async () => {
					resolveRevert( moved );
				} );
			}
		);

		it( 'discards a held response arriving after the job became pending', async () => {
			await renderPanel( failed );
			let resolveRevert;
			const calls = [];
			apiFetch.mockImplementation( ( request ) => {
				calls.push( request );
				return new Promise( ( resolve ) => {
					resolveRevert = resolve;
				} );
			} );
			await act( async () => {
				screen
					.getByRole( 'button', { name: 'Go back to Drafting' } )
					.click();
			} );
			await act( async () => {
				dispatch( 'vip-workflows/editor' ).receiveWorkflowStatus( {
					...failed,
					agent_job: { ...failed.agent_job, status: 'pending' },
				} );
			} );
			await act( async () => {
				resolveRevert( held );
			} );
			expect( screen.queryByText( 'Warnings detected' ) ).toBeNull();
			expect(
				calls.filter( ( c ) => c.path === REVERT_PATH )
			).toHaveLength( 1 );
		} );

		it( 'asks nothing and re-reads the post when held with no warnings', async () => {
			const calls = [];
			apiFetch.mockImplementation( ( request ) => {
				calls.push( request );
				if ( request.path === REVERT_PATH ) {
					return Promise.resolve( {
						warnings_pending: true,
						soft_warnings: [],
					} );
				}
				if ( request.path === STATUS_PATH ) {
					return Promise.resolve( failed );
				}
				return Promise.resolve( [] );
			} );

			render(
				<>
					<TransitionFlow />
					<WorkflowPanel />
				</>
			);
			const goBack = await screen.findByRole( 'button', {
				name: 'Go back to Drafting',
			} );
			const readsBefore = calls.filter(
				( c ) => c.path === STATUS_PATH
			).length;
			await act( async () => {
				goBack.click();
			} );

			expect( screen.queryByText( 'Warnings detected' ) ).toBeNull();
			await waitFor( () =>
				expect(
					calls.filter( ( c ) => c.path === STATUS_PATH ).length
				).toBeGreaterThan( readsBefore )
			);
			expect(
				screen.getByRole( 'button', { name: 'Go back to Drafting' } )
			).toBeInTheDocument();
		} );

		it( 'reports a refused confirmation and re-reads the post', async () => {
			const calls = await pressHeldGoBack();
			apiFetch.mockImplementation( ( request ) => {
				calls.push( request );
				if ( request.path === REVERT_PATH ) {
					return Promise.reject( {
						code: 'agent_revert_conflict',
						message:
							'This agent run changed while you were going back. Reload the post to see where it is now.',
					} );
				}
				return Promise.resolve(
					request.path === STATUS_PATH ? failed : []
				);
			} );
			const readsBefore = calls.filter(
				( c ) => c.path === STATUS_PATH
			).length;

			const continueButton = await screen.findByRole( 'button', {
				name: 'Continue',
			} );
			await act( async () => {
				continueButton.click();
			} );

			expect(
				await screen.findByText(
					'This agent run changed while you were going back. Reload the post to see where it is now.'
				)
			).toBeInTheDocument();
			expect( screen.queryByText( 'Warnings detected' ) ).toBeNull();
			expect(
				calls.filter( ( c ) => c.path === STATUS_PATH ).length
			).toBeGreaterThan( readsBefore );
		} );
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
