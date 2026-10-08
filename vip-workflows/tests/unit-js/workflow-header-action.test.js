/**
 * The workflow split button in the editor header.
 *
 * The main half runs the stage's primary transition — the first in authored
 * order, under the author's label — through the same flow as the sidebar rail;
 * the arrow opens the rail. Core's Publish button is hidden only where it
 * could do nothing but fail, and only while this button is on screen to stand
 * in for it.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-panel-publish-confirm.test.js for why these are stubbed: ESM-only
// deps the components name but do not otherwise exercise.
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, dispatch, register, select } from '@wordpress/data';
// eslint-disable-next-line import/first
import { SlotFillProvider, Slot } from '@wordpress/components';

const NO_META = {};
const POST_ONE_CAN_PUBLISH = { _links: { 'wp:action-publish': [ {} ] } };
const POST_ONE_CANNOT_PUBLISH = { _links: {} };

/**
 * What core's editor store reports about the post, as far as the header and
 * the flow ask. Real state rather than module variables: both subscribe to it,
 * so a test that changes what core says has to reach them the way core would.
 */
const CORE_EDITOR = {
	currentPostId: 42,
	savedStatus: 'draft',
	editedStatus: 'draft',
	published: false,
	canPublish: true,
	otherEntitiesDirty: false,
	dirty: false,
	saving: false,
	savingLocked: false,
};

const savePost = jest.fn( () => ( { dispatch: editor } ) => {
	editor.setCoreEditor( { dirty: false } );
} );

register(
	createReduxStore( 'core', {
		reducer: ( state = {} ) => state,
		selectors: { getEntityRecord: () => null },
		actions: { invalidateResolution: () => ( { type: 'NOOP' } ) },
	} )
);

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = CORE_EDITOR, action ) =>
			'SET_CORE_EDITOR' === action.type
				? { ...state, ...action.patch }
				: state,
		selectors: {
			getEditedPostAttribute: ( state, attribute ) =>
				'meta' === attribute ? NO_META : state.editedStatus,
			getCurrentPostAttribute: ( state ) => state.savedStatus,
			getCurrentPostId: ( state ) => state.currentPostId,
			getCurrentPost: ( state ) =>
				state.canPublish
					? POST_ONE_CAN_PUBLISH
					: POST_ONE_CANNOT_PUBLISH,
			isCurrentPostPublished: ( state ) => state.published,
			hasNonPostEntityChanges: ( state ) => state.otherEntitiesDirty,
			isEditedPostDirty: ( state ) => state.dirty,
			isSavingPost: ( state ) => state.saving,
			isPostSavingLocked: ( state ) => state.savingLocked,
		},
		actions: {
			setCoreEditor: ( patch ) => ( { type: 'SET_CORE_EDITOR', patch } ),
			savePost,
		},
	} )
);

/**
 * Change what core's editor store reports.
 *
 * @param {Object} patch Fields of CORE_EDITOR to replace.
 */
function setCoreEditor( patch ) {
	dispatch( 'core/editor' ).setCoreEditor( patch );
}

const createErrorNotice = jest.fn( () => ( { type: 'NOOP' } ) );
const createInfoNotice = jest.fn( () => ( { type: 'NOOP' } ) );

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice,
			createInfoNotice,
			removeNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

/* eslint-disable import/first */
import { STORE_NAME, seedEditorStore } from './helpers/editor-store';
import {
	WorkflowHeaderAction,
	REPLACES_PUBLISH_CLASS,
} from '../../src/editor/components/WorkflowHeaderAction';
import { TransitionFlow } from '../../src/editor/components/TransitionFlow';
/* eslint-enable import/first */

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';
const TRANSITION_PATH = '/vip-workflows/v1/workflow/post/42/transition';

const TO_REVIEW = {
	to: 'review',
	label: 'Send to Review',
	status_info: { key: 'review', label: 'Review', status: 'pending' },
};
const TO_LIVE = {
	to: 'live',
	label: 'Publish Now',
	status_info: { key: 'live', label: 'Live', status: 'publish' },
};

/**
 * A status payload.
 *
 * @param {Object} overrides Fields to replace.
 * @return {Object} Status endpoint response.
 */
function statusResponse( overrides = {} ) {
	return {
		has_workflow: true,
		sequence: { id: 1, name: 'Header Flow' },
		current: {
			key: 'draft',
			label: 'Draft',
			color: '#666',
			status: 'draft',
			is_terminal: false,
			transitions: [],
		},
		all_statuses: [],
		transitions: [ TO_REVIEW, TO_LIVE ],
		guard: { current_region: 'draft', can_bypass: false },
		can_remove: true,
		...overrides,
	};
}

/**
 * Every transition POST apiFetch has received.
 *
 * @return {Array} The POST bodies.
 */
function transitionPosts() {
	return apiFetch.mock.calls
		.filter(
			( [ { path, method } ] ) =>
				path === TRANSITION_PATH && 'POST' === method
		)
		.map( ( [ { data } ] ) => data );
}

/**
 * Render the header slot with the button and the flow, against a payload.
 *
 * @param {Object}   status     Status endpoint response.
 * @param {Function} transition Answers the transition POST; unresolved by default.
 */
async function renderHeader(
	status,
	transition = () => new Promise( () => {} )
) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( status );
		}
		if ( path === TRANSITION_PATH ) {
			return transition();
		}
		return Promise.resolve( [] );
	} );

	render(
		<SlotFillProvider>
			<div className="editor-header">
				<Slot name="PinnedItems/core" />
			</div>
			<TransitionFlow />
			<WorkflowHeaderAction />
		</SlotFillProvider>
	);

	await waitFor( () =>
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( { path: STATUS_PATH } )
		)
	);
}

describe( 'WorkflowHeaderAction', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		savePost.mockClear();
		createErrorNotice.mockClear();
		createInfoNotice.mockClear();
		setCoreEditor( CORE_EDITOR );
		document.body.classList.remove( REPLACES_PUBLISH_CLASS );
		seedEditorStore();
	} );

	it( 'labels the main half with the first transition and stands in for Publish', async () => {
		await renderHeader( statusResponse() );

		const main = await screen.findByRole( 'button', {
			name: 'Send to Review',
		} );
		expect( main ).toHaveClass( 'is-primary' );
		expect( document.body ).toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'runs the primary transition through the flow', async () => {
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () =>
			expect( transitionPosts() ).toEqual( [
				expect.objectContaining( { to_status: 'review' } ),
			] )
		);
	} );

	it( 'saves a dirty post before the move', async () => {
		setCoreEditor( { dirty: true } );
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () => expect( transitionPosts() ).toHaveLength( 1 ) );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'asks before a primary transition that publishes', async () => {
		await renderHeader(
			statusResponse( { transitions: [ TO_LIVE, TO_REVIEW ] } )
		);

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Publish Now' } )
			).click();
		} );

		expect(
			await screen.findByText( 'Publish this post?' )
		).toBeInTheDocument();
		expect( transitionPosts() ).toHaveLength( 0 );
	} );

	it( 'draws a locked primary disabled rather than promoting the next move', async () => {
		await renderHeader(
			statusResponse( {
				transitions: [
					{
						...TO_LIVE,
						_locked: true,
						_locked_reason: 'Fill in Section first.',
					},
					TO_REVIEW,
				],
			} )
		);

		const main = await screen.findByRole( 'button', {
			name: 'Publish Now',
		} );
		expect( main ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.queryByRole( 'button', { name: 'Send to Review' } )
		).not.toBeInTheDocument();
	} );

	it( 'opens the rail from the arrow', async () => {
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', {
					name: 'Workflow transitions',
				} )
			).click();
		} );

		// The rail lists every way out — the primary again among them.
		expect(
			await screen.findByRole( 'button', { name: 'Publish Now' } )
		).toBeInTheDocument();
		expect(
			screen.getAllByRole( 'button', { name: 'Send to Review' } )
		).toHaveLength( 2 );
	} );

	it( 'sits beside core controls for a person who can bypass the workflow', async () => {
		await renderHeader(
			statusResponse( {
				guard: { current_region: 'draft', can_bypass: true },
			} )
		);

		const main = await screen.findByRole( 'button', {
			name: 'Send to Review',
		} );
		expect( main ).toHaveClass( 'is-secondary' );
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'sits beside core Save on a live post', async () => {
		await renderHeader(
			statusResponse( {
				guard: { current_region: 'publish', can_bypass: false },
			} )
		);

		expect(
			await screen.findByRole( 'button', { name: 'Send to Review' } )
		).toHaveClass( 'is-secondary' );
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'renders nothing and keeps core controls when the stage offers no move', async () => {
		await renderHeader( statusResponse( { transitions: [] } ) );

		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', {
					name: 'Workflow transitions',
				} )
			).not.toBeInTheDocument()
		);
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'renders nothing for an orphaned post', async () => {
		await renderHeader(
			statusResponse( {
				has_workflow: false,
				orphaned: true,
				guard: { current_region: null, can_bypass: false },
			} )
		);

		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Send to Review' } )
			).not.toBeInTheDocument()
		);
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	it( 'reports a refused move as an editor notice', async () => {
		await renderHeader( statusResponse(), () =>
			Promise.reject( {
				code: 'forbidden_transition',
				message: 'Not yours to move.',
			} )
		);

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () =>
			expect( createErrorNotice ).toHaveBeenCalledWith(
				'Not yours to move.',
				expect.anything()
			)
		);
	} );

	/**
	 * Core draws one header button for several jobs. On the draft side it is
	 * still the post's Save — with "Save draft" withdrawn, the only one — in
	 * each of these states, so it is not a Publish that could only fail and
	 * must stay on screen.
	 */
	it.each( [
		[ 'a status has been picked in Summary', { editedStatus: 'pending' } ],
		[
			'the post is published privately at a draft stage',
			{
				savedStatus: 'private',
				editedStatus: 'private',
				published: true,
			},
		],
		[
			'a person who cannot publish has a pending post',
			{
				savedStatus: 'pending',
				editedStatus: 'pending',
				canPublish: false,
			},
		],
		[ 'another entity has changes to save', { otherEntitiesDirty: true } ],
	] )( 'keeps core Save when %s', async ( _when, core ) => {
		setCoreEditor( core );
		await renderHeader( statusResponse() );

		expect(
			await screen.findByRole( 'button', { name: 'Send to Review' } )
		).toHaveClass( 'is-secondary' );
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );
	} );

	/**
	 * "Edit original" on a synced pattern points the same editor, header and
	 * plugin area at the pattern. The header is the pattern's then: its Save
	 * must not be hidden, and the post's move must not run from there — the
	 * save that precedes a move would save the pattern and send on a post
	 * nobody saved.
	 */
	it( 'stands down while the editor is on another entity', async () => {
		setCoreEditor( { currentPostId: 99 } );
		await renderHeader( statusResponse() );

		// The status has landed, so an absent button is a decision and not a
		// payload still in flight.
		await waitFor( () =>
			expect( select( STORE_NAME ).isWorkflowStatusResolved() ).toBe(
				true
			)
		);

		expect(
			screen.queryByRole( 'button', { name: 'Send to Review' } )
		).not.toBeInTheDocument();
		expect( document.body ).not.toHaveClass( REPLACES_PUBLISH_CLASS );

		// The sidebar rail can still ask; the flow refuses.
		await act( async () => {
			dispatch( STORE_NAME ).requestTransition(
				TO_REVIEW,
				null,
				'header'
			);
		} );

		expect( createErrorNotice ).toHaveBeenCalledWith(
			'Go back to the post before moving it through its workflow.',
			expect.anything()
		);
		expect( savePost ).not.toHaveBeenCalled();
		expect( transitionPosts() ).toHaveLength( 0 );
	} );

	/**
	 * A status core wrote re-seats the post at another stage on the server —
	 * the default administrator pressing core's own Publish is the plainest
	 * case. Nothing else tells the header, which would go on offering the move
	 * out of the stage the post has left.
	 */
	it( 'reads the workflow again when the persisted status changes', async () => {
		await renderHeader(
			statusResponse( {
				guard: { current_region: 'draft', can_bypass: true },
			} )
		);
		await screen.findByRole( 'button', { name: 'Send to Review' } );

		const reads = () =>
			apiFetch.mock.calls.filter(
				( [ { path, method } ] ) =>
					path === STATUS_PATH && 'POST' !== method
			).length;
		expect( reads() ).toBe( 1 );

		await act( async () => {
			setCoreEditor( {
				savedStatus: 'publish',
				editedStatus: 'publish',
				published: true,
			} );
		} );

		expect( reads() ).toBe( 2 );
	} );

	/**
	 * Core's savePost() returns at once, without saving, while another save
	 * is in flight, and the post reads as dirty until that one lands. The move
	 * waits for it instead of calling a save that is about to succeed a
	 * failure.
	 */
	it( 'waits out a save already in flight rather than calling it failed', async () => {
		setCoreEditor( { dirty: true, saving: true } );
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		expect( transitionPosts() ).toHaveLength( 0 );
		expect( createErrorNotice ).not.toHaveBeenCalled();

		// The save the author started lands.
		await act( async () => {
			setCoreEditor( { dirty: false, saving: false } );
		} );

		await waitFor( () => expect( transitionPosts() ).toHaveLength( 1 ) );
		expect( savePost ).not.toHaveBeenCalled();
		expect( createErrorNotice ).not.toHaveBeenCalled();
	} );

	it( 'runs one move at a time', async () => {
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );
		await waitFor( () => expect( transitionPosts() ).toHaveLength( 1 ) );

		// The rail leaves the button in flight pressable; a second press of it
		// arrives here as a second request.
		await act( async () => {
			dispatch( STORE_NAME ).requestTransition(
				TO_REVIEW,
				null,
				'panel'
			);
		} );

		expect( transitionPosts() ).toHaveLength( 1 );
	} );

	/**
	 * Core locks saving while an upload is in flight (and plugins lock it for
	 * their own checks). Its Publish, Save draft and Ctrl+S all stand down;
	 * savePost() itself does not ask, so the button that replaces Publish has
	 * to.
	 */
	it( 'does not save or move a dirty post while saving is locked', async () => {
		setCoreEditor( { dirty: true, savingLocked: true } );
		await renderHeader( statusResponse() );

		const main = await screen.findByRole( 'button', {
			name: 'Send to Review',
		} );
		await act( async () => {
			main.click();
		} );

		await waitFor( () =>
			expect( createErrorNotice ).toHaveBeenCalledWith(
				expect.stringContaining( 'cannot be saved yet' ),
				expect.anything()
			)
		);
		expect( savePost ).not.toHaveBeenCalled();
		expect( transitionPosts() ).toHaveLength( 0 );
		expect( main ).not.toHaveAttribute( 'aria-disabled', 'true' );
	} );

	/**
	 * Nobody presses anything for the agent-held warnings dialog to open, and
	 * it opens with the sidebar closed — so a refusal of its Continue has to
	 * land in the editor's own notices, not in a panel that is not there.
	 */
	it( 'reports a refused agent-held route as an editor notice', async () => {
		await renderHeader(
			statusResponse( {
				agent_job: {
					status: 'warnings_pending',
					to_status: 'review',
					soft_warnings: [
						{ code: 'soft_check_failed', message: 'Check this.' },
					],
					comment: '',
				},
			} ),
			() =>
				Promise.reject( {
					code: 'forbidden_transition',
					message: 'Not yours to continue.',
				} )
		);

		const proceed = await screen.findByRole( 'button', {
			name: 'Continue',
		} );
		await act( async () => {
			proceed.click();
		} );

		await waitFor( () =>
			expect( createErrorNotice ).toHaveBeenCalledWith(
				'Not yours to continue.',
				expect.anything()
			)
		);
	} );

	/**
	 * A move into an AI stage can start from the header with the sidebar
	 * closed, so waiting on the agent cannot be the sidebar panel's job: the
	 * flow polls, and offers the reload once the agent has rewritten a post
	 * the editor holds unsaved edits to.
	 */
	it( 'follows a stage agent with no sidebar open', async () => {
		jest.useFakeTimers();

		try {
			await renderHeader(
				statusResponse( { agent_pending: true, transitions: [] } )
			);
			await act( async () => {} );

			// The agent finishes and routes the post on; the author has
			// typed in the meantime.
			apiFetch.mockImplementation( () =>
				Promise.resolve( statusResponse() )
			);
			setCoreEditor( { dirty: true } );

			await act( async () => {
				jest.advanceTimersByTime( 5000 );
			} );

			const next = await screen.findByRole( 'button', {
				name: 'Send to Review',
			} );
			expect( createInfoNotice ).toHaveBeenCalledWith(
				expect.stringContaining( 'The AI agent updated this post' ),
				expect.objectContaining( { actions: expect.any( Array ) } )
			);

			// The editor now holds the older copy. Moving the post on must
			// not save that back over what the agent wrote.
			await act( async () => {
				next.click();
			} );
			await waitFor( () =>
				expect( transitionPosts() ).toHaveLength( 1 )
			);
			expect( savePost ).not.toHaveBeenCalled();
		} finally {
			jest.useRealTimers();
		}
	} );

	/**
	 * The reason tooltip must not be something the button is wrapped in only
	 * while it is held: that swaps the element at its position, React rebuilds
	 * the button, and focus — and any popover anchored to it — is dropped.
	 */
	it( 'keeps the same button when its lock is released', async () => {
		await renderHeader(
			statusResponse( {
				transitions: [
					{
						...TO_LIVE,
						_locked: true,
						_locked_reason: 'Fill in Section first.',
					},
					TO_REVIEW,
				],
			} )
		);

		const held = await screen.findByRole( 'button', {
			name: 'Publish Now',
		} );

		await act( async () => {
			dispatch( STORE_NAME ).receiveWorkflowStatus(
				statusResponse( { transitions: [ TO_LIVE, TO_REVIEW ] } )
			);
		} );

		const released = screen.getByRole( 'button', { name: 'Publish Now' } );
		expect( released ).not.toHaveAttribute( 'aria-disabled', 'true' );
		expect( released ).toBe( held );
	} );
} );
