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

import {
	render,
	screen,
	waitFor,
	act,
	fireEvent,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { speak } from '@wordpress/a11y';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-panel-publish-confirm.test.js for why these are stubbed: ESM-only
// deps the components name but do not otherwise exercise.
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/edit-post', () => ( { store: 'core/edit-post' } ) );
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
	saveable: true,
	saveFailed: false,
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
			isEditedPostSaveable: ( state ) => state.saveable,
			didPostSaveRequestFail: ( state ) => state.saveFailed,
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
import {
	STORE_NAME,
	seedEditorStore,
	setHasMetaBoxes,
} from './helpers/editor-store';
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
 * What core reports for a live post, and the status payload for one.
 */
const LIVE = {
	savedStatus: 'publish',
	editedStatus: 'publish',
	published: true,
};
const LIVE_STATUS = {
	guard: { current_region: 'publish', can_bypass: false },
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
		speak.mockClear();
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

	/**
	 * Core will not save a post with no title, content or excerpt — savePost()
	 * returns without a request — so a pre-move save there could only be
	 * reported as failed.
	 */
	it( 'moves a dirty post core will not save without trying to save it', async () => {
		setCoreEditor( { dirty: true, saveable: false } );
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () => expect( transitionPosts() ).toHaveLength( 1 ) );
		expect( savePost ).not.toHaveBeenCalled();
		expect( createErrorNotice ).not.toHaveBeenCalled();
	} );

	/**
	 * The sidebar rail is what used to announce a move, and it is not mounted
	 * while the sidebar is closed — so the flow announces it.
	 */
	it( 'announces a move started from the header', async () => {
		await renderHeader( statusResponse(), () =>
			Promise.resolve(
				statusResponse( {
					current: {
						key: 'review',
						label: 'Review',
						status: 'pending',
						transitions: [],
					},
					transitions: [ TO_LIVE ],
				} )
			)
		);

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () =>
			expect( speak ).toHaveBeenCalledWith( 'Moved to Review.', 'polite' )
		);
		expect( speak ).toHaveBeenCalledTimes( 1 );
	} );

	/**
	 * A failed agent stage withholds its exits, so there is no primary
	 * transition — but the header must not vanish: the stage's one way out,
	 * back where the post came from, takes the main half.
	 */
	it( 'offers Go back when the stage agent failed', async () => {
		const failed = statusResponse( {
			transitions: [],
			agent_job: {
				status: 'failed',
				error: 'Timed out.',
				revert_to: { key: 'draft', label: 'Draft' },
			},
		} );
		await renderHeader( failed );

		apiFetch.mockImplementation( ( { path } ) =>
			Promise.resolve(
				path.endsWith( '/agent-revert' ) ? statusResponse() : failed
			)
		);

		await act( async () => {
			(
				await screen.findByRole( 'button', {
					name: 'Go back to Draft',
				} )
			).click();
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/vip-workflows/v1/workflow/post/42/agent-revert',
			method: 'POST',
		} );
		expect(
			await screen.findByRole( 'button', { name: 'Send to Review' } )
		).toBeInTheDocument();
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

	/**
	 * Core posts classic meta boxes after its own save, and the editor's dirty
	 * flag cannot see them. Short of live, a move saves whenever the screen
	 * has them, as core's Publish would.
	 */
	it( 'saves a clean draft first when the screen has meta boxes', async () => {
		setHasMetaBoxes( true );
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () => expect( transitionPosts() ).toHaveLength( 1 ) );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not move the post when that save fails', async () => {
		setHasMetaBoxes( true );
		savePost.mockImplementationOnce( () => ( { dispatch: editor } ) => {
			editor.setCoreEditor( { saveFailed: true } );
		} );
		await renderHeader( statusResponse() );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () =>
			expect( createErrorNotice ).toHaveBeenCalledWith(
				'Could not save the post before the transition. Try again.',
				expect.anything()
			)
		);
		expect( transitionPosts() ).toHaveLength( 0 );
	} );

	/**
	 * On a live post a save publishes, so meta boxes nothing can tell have
	 * changed are left for the post's own Update.
	 */
	it( 'leaves a clean live post unsaved, meta boxes or not', async () => {
		setHasMetaBoxes( true );
		setCoreEditor( LIVE );
		await renderHeader( statusResponse( LIVE_STATUS ) );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await waitFor( () => expect( transitionPosts() ).toHaveLength( 1 ) );
		expect( savePost ).not.toHaveBeenCalled();
		expect(
			screen.queryByText( 'Publish your changes?' )
		).not.toBeInTheDocument();
	} );

	/**
	 * The save before a move is an Update on a live post: the edits go public,
	 * and stay public if the move is refused. A workflow step does not say
	 * that, so it is asked.
	 */
	it( "asks before publishing a live post's unsaved edits", async () => {
		setCoreEditor( { ...LIVE, dirty: true } );
		await renderHeader( statusResponse( LIVE_STATUS ) );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		expect(
			await screen.findByText( 'Publish your changes?' )
		).toBeInTheDocument();
		expect( savePost ).not.toHaveBeenCalled();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Publish changes' } )
			);
		} );

		await waitFor( () => expect( transitionPosts() ).toHaveLength( 1 ) );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'leaves a live post and its edits alone when that is cancelled', async () => {
		setCoreEditor( { ...LIVE, dirty: true } );
		await renderHeader( statusResponse( LIVE_STATUS ) );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		await act( async () => {
			fireEvent.click(
				await screen.findByRole( 'button', { name: 'Cancel' } )
			);
		} );

		expect( savePost ).not.toHaveBeenCalled();
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

	/**
	 * The panel's workflow-level writes (and the save guard's removal) run
	 * through the store, so a move pressed from the header cannot race one.
	 */
	it( 'stands down while a workflow write is in flight', async () => {
		await renderHeader( statusResponse() );
		const main = await screen.findByRole( 'button', {
			name: 'Send to Review',
		} );

		let finish;
		apiFetch.mockImplementation( ( { method } ) =>
			'DELETE' === method
				? new Promise( ( resolve ) => ( finish = resolve ) )
				: Promise.resolve( statusResponse() )
		);

		let removal;
		await act( async () => {
			removal = dispatch( STORE_NAME ).removeWorkflow();
		} );
		expect( main ).toHaveAttribute( 'aria-disabled', 'true' );

		await act( async () => {
			finish( true );
			await removal;
		} );
		expect( main ).not.toHaveAttribute( 'aria-disabled' );
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
	 * Moving the stage while its agent runs stops the agent. The server allows
	 * it, so the only thing between the author and that is this question.
	 */
	it( 'asks before a move that would stop a running agent', async () => {
		await renderHeader( statusResponse( { agent_pending: true } ) );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );

		expect(
			await screen.findByText( 'This changes the workflow' )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		} );

		expect( transitionPosts() ).toHaveLength( 0 );
	} );

	/**
	 * A status read can withdraw the transition an open assignee popover
	 * belongs to — someone else moved the post. Submitting it then would fire a
	 * move the stage no longer declares, so the popover goes.
	 */
	it( 'drops the assignee popover when its transition is withdrawn', async () => {
		seedEditorStore( {
			roles: [ { slug: 'editor', name: 'Editor' } ],
		} );
		const assign = {
			...TO_REVIEW,
			inputs: [
				{
					type: 'assignment',
					assignee_type: 'role',
					meta_key: 'wfp_a1_assignee',
					label: 'Pick a reviewer',
				},
			],
		};
		await renderHeader( statusResponse( { transitions: [ assign ] } ) );

		await act( async () => {
			(
				await screen.findByRole( 'button', { name: 'Send to Review' } )
			).click();
		} );
		expect(
			await screen.findByRole( 'dialog', { name: 'Pick a reviewer' } )
		).toBeInTheDocument();

		await act( async () => {
			dispatch( STORE_NAME ).receiveWorkflowStatus(
				statusResponse( { transitions: [ TO_LIVE ] } )
			);
		} );

		expect(
			screen.queryByRole( 'dialog', { name: 'Pick a reviewer' } )
		).not.toBeInTheDocument();
		expect( transitionPosts() ).toHaveLength( 0 );
	} );

	/**
	 * An agent that finishes onto a held route has already written the post.
	 * The editor still holds the copy from before it ran, so Continue moves
	 * the post on what the database holds and saves nothing over it.
	 */
	it( 'continues an agent-held route without saving over the agent', async () => {
		jest.useFakeTimers();

		try {
			await renderHeader(
				statusResponse( { agent_pending: true, transitions: [] } )
			);
			await act( async () => {} );

			apiFetch.mockImplementation( ( { path } ) =>
				Promise.resolve(
					path === TRANSITION_PATH
						? statusResponse()
						: statusResponse( {
								transitions: [],
								agent_job: {
									status: 'warnings_pending',
									to_status: 'review',
									soft_warnings: [
										{
											code: 'soft_check_failed',
											message: 'Check this.',
										},
									],
									comment: '',
								},
						  } )
				)
			);
			setCoreEditor( { dirty: true } );

			await act( async () => {
				jest.advanceTimersByTime( 5000 );
			} );

			const proceed = await screen.findByRole( 'button', {
				name: 'Continue',
			} );
			await act( async () => {
				proceed.click();
			} );

			await waitFor( () =>
				expect( transitionPosts() ).toEqual( [
					expect.objectContaining( {
						to_status: 'review',
						acknowledge_warnings: true,
					} ),
				] )
			);
			expect( savePost ).not.toHaveBeenCalled();
		} finally {
			jest.useRealTimers();
		}
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
