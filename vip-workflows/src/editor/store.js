/**
 * VIP Workflow Editor Data Store
 *
 * Central reactive state for workflow data in the block editor.
 * Hydrated from wp_localize_script data on init, updated via dispatched actions.
 * Extensions and core components consume via useSelect( 'vip-workflow/editor' ).
 *
 * The post status endpoint's answer lives here, whole, because more than one
 * surface changes it: the sidebar panel assigns, removes and transitions, and
 * the save guard's veto notice removes from outside the sidebar entirely. While
 * the panel kept a private copy of that answer the two could disagree — a
 * removal from the notice left the panel rendering the workflow it had just
 * deleted until the page was reloaded — and the only channel between them was a
 * `key` bump in index.js that threw both sidebar panels away and rebuilt them.
 * A remount is not synchronisation: it re-runs the fetch instead of sharing the
 * result, and it cannot reach a surface that is not its child. One store, one
 * read, one answer.
 *
 * @package
 */

import { createReduxStore, register } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';

import { refreshPostEntity } from './refresh-post-entity';

const STORE_NAME = 'vip-workflow/editor';

/**
 * The status endpoint: the whole of a post's workflow state in one read — the
 * sequence, the stage, the ways out, the agent job, the guard payload and the
 * sequences this post could be moved to.
 *
 * @param {number} postId Post id.
 * @return {string} REST path.
 */
const statusPath = ( postId ) =>
	`/vip-workflow/v1/workflow/post/${ postId }/status`;

/**
 * The route that assigns (POST) and removes (DELETE) a post's workflow.
 *
 * @param {number} postId Post id.
 * @return {string} REST path.
 */
const sequencePath = ( postId ) =>
	`/vip-workflow/v1/workflow/post/${ postId }/sequence`;

const DEFAULT_STATE = {
	postId: null,
	postType: null,
	postStatus: null,
	hasWorkflow: false,
	showWorkflowModal: false,
	workflowEnforcement: false,
	sequence: null,
	currentStatus: null,
	transitions: [],
	currentUser: null,
	roles: [],
	metadataFields: [],

	// The status endpoint's last answer, verbatim. Null both before the first
	// read and after a failed one, which is why `workflowStatusResolved` exists:
	// it is what separates "not read yet" (show a spinner) from "read, and this
	// post has no workflow" (show the picker).
	workflowStatus: null,
	workflowStatusResolved: false,

	// Monotonic token, bumped by every read that starts AND by every payload
	// adopted from elsewhere. A response whose token has moved on is discarded:
	// the agent poll runs on a 5s interval, a transition answers with a full
	// status payload of its own, and without this the slower of the two lands
	// last and reinstates the state the user just left.
	workflowStatusRequest: 0,
};

const actions = {
	hydrate( data ) {
		return {
			type: 'HYDRATE',
			data,
		};
	},

	/**
	 * Adopt a status payload as the post's workflow state.
	 *
	 * Dispatched directly by the surfaces that already hold one: a transition,
	 * an agent revert and an assignment each answer with the same shape this
	 * endpoint serves, so re-reading it afterwards would cost a round trip to
	 * learn what the response already said.
	 *
	 * @param {Object|null} status Status endpoint payload, or null when the read failed.
	 */
	receiveWorkflowStatus( status ) {
		return {
			type: 'RECEIVE_WORKFLOW_STATUS',
			status,
		};
	},

	/**
	 * Claim the next request token, so an older read in flight is discarded.
	 */
	beginWorkflowStatusRequest() {
		return { type: 'BEGIN_WORKFLOW_STATUS_REQUEST' };
	},

	/**
	 * Record that a read failed, without answering for the post's workflow.
	 *
	 * A request that did not come back is not evidence the post has no
	 * workflow, and this state is shared: adopting `null` would tell the
	 * sidebar, the Metadata section and every extension reading
	 * `getSequence()` that the workflow is gone. Worse, the agent poll's own
	 * enable-condition is read back out of `agent_pending`, so a wipe stops
	 * the only thing that would have re-read the endpoint, and the pending ->
	 * not-pending edge the panel watches fires a reload for an agent that is
	 * still running.
	 *
	 * So the last good payload stands and only the bookkeeping moves: the read
	 * counts as resolved (a first read that fails must show the empty state,
	 * not a spinner forever) and the token advances, so a slower response from
	 * the same generation is still discarded.
	 */
	failWorkflowStatusRequest() {
		return { type: 'FAIL_WORKFLOW_STATUS_REQUEST' };
	},

	/**
	 * Read the post's workflow state from the server.
	 *
	 * The one place that performs this fetch, and it never rejects. A post with
	 * no id genuinely has no workflow, so it resolves the state to null. A
	 * failed request answers nothing at all — see failWorkflowStatusRequest().
	 */
	fetchWorkflowStatus:
		() =>
		async ( { dispatch, select } ) => {
			const postId = select.getPostId();

			if ( ! postId ) {
				dispatch.receiveWorkflowStatus( null );
				return;
			}

			dispatch.beginWorkflowStatusRequest();
			const token = select.getWorkflowStatusRequest();

			let status;
			try {
				status = await apiFetch( { path: statusPath( postId ) } );
			} catch {
				// Something fresher landed while this was in flight; it has
				// already answered, so a failure here says nothing.
				if ( select.getWorkflowStatusRequest() === token ) {
					dispatch.failWorkflowStatusRequest();
				}
				return;
			}

			// Something fresher landed while this was in flight — a transition's
			// own payload, or a later read. It wins.
			if ( select.getWorkflowStatusRequest() !== token ) {
				return;
			}

			dispatch.receiveWorkflowStatus( status );
		},

	/**
	 * Put this post in a workflow, or move it to a different one.
	 *
	 * Rejects with the server's error so the caller can surface it: a sequence
	 * that models no stage in the post's status region is refused
	 * (`unmodeled_post_status`), and that refusal is the answer the author needs
	 * rather than something to absorb here.
	 *
	 * @param {number} sequenceId Sequence to assign.
	 */
	assignSequence:
		( sequenceId ) =>
		async ( { dispatch, select, registry } ) => {
			const postId = select.getPostId();

			// The route answers with the post's new status payload, so the
			// assignment and the state it produced arrive together.
			const status = await apiFetch( {
				path: sequencePath( postId ),
				method: 'POST',
				data: { sequence_id: sequenceId },
			} );

			dispatch.receiveWorkflowStatus( status );

			// Assignment rewrites the post's meta behind the open editor's back,
			// and seating it can cross a region boundary — so core's own chrome
			// (Publish button, Summary status) has to re-read the record.
			refreshPostEntity( registry, select.getPostType(), postId );
		},

	/**
	 * Take this post out of its workflow.
	 *
	 * Both surfaces that offer removal — the sidebar panel's footer and the
	 * publish veto's escape hatch — come through here, so neither can leave the
	 * other's view of the post behind. Unlike assignment, the route answers with
	 * a bare `true`: the post's new state (no workflow, and the sequences it
	 * could now be started in) has to be read.
	 */
	removeWorkflow:
		() =>
		async ( { dispatch, select, registry } ) => {
			const postId = select.getPostId();

			await apiFetch( {
				path: sequencePath( postId ),
				method: 'DELETE',
			} );

			await dispatch.fetchWorkflowStatus();

			// Matches assignment: the workflow identity the editor renders from
			// is gone from the database, so the record it renders from must be
			// re-read too. Its absence is why a removal used to leave the
			// Summary status row and the Publish button stale until a reload.
			refreshPostEntity( registry, select.getPostType(), postId );
		},
};

function reducer( state = DEFAULT_STATE, action ) {
	switch ( action.type ) {
		case 'HYDRATE':
			return {
				...state,
				...action.data,
			};

		case 'BEGIN_WORKFLOW_STATUS_REQUEST':
			return {
				...state,
				workflowStatusRequest: state.workflowStatusRequest + 1,
			};

		// A read that failed moves the bookkeeping and nothing else: the last
		// good payload — and everything derived from it — stands.
		case 'FAIL_WORKFLOW_STATUS_REQUEST':
			return {
				...state,
				workflowStatusResolved: true,
				workflowStatusRequest: state.workflowStatusRequest + 1,
			};

		case 'RECEIVE_WORKFLOW_STATUS': {
			const status = action.status;

			return {
				...state,
				workflowStatus: status,
				workflowStatusResolved: true,
				workflowStatusRequest: state.workflowStatusRequest + 1,
				// The fields the server bootstrap hydrates, re-derived from the
				// same payload so a consumer reading `getSequence()` and one
				// reading `getWorkflowStatus()` can never describe two different
				// workflows.
				hasWorkflow: !! status?.has_workflow,
				// The bootstrap's sequence carries its stage list and
				// extensions read it (workflow-tool-checklist walks
				// `sequence.statuses` to decide whether it applies); the
				// endpoint serves the same stages under `all_statuses`, so they
				// are re-joined here rather than served twice.
				sequence: status?.sequence
					? {
							...status.sequence,
							statuses: status.all_statuses || [],
					  }
					: null,
				currentStatus: status?.current || null,
				transitions: status?.transitions || [],
				metadataFields: status?.metadata_fields || [],
			};
		}

		default:
			return state;
	}
}

const selectors = {
	getPostId: ( state ) => state.postId,
	getPostType: ( state ) => state.postType,
	getPostStatus: ( state ) => state.postStatus,
	hasWorkflow: ( state ) => state.hasWorkflow,
	getShowWorkflowModal: ( state ) => state.showWorkflowModal,
	getWorkflowEnforcement: ( state ) => state.workflowEnforcement,
	getSequence: ( state ) => state.sequence,
	getCurrentStatus: ( state ) => state.currentStatus,
	getTransitions: ( state ) => state.transitions,
	getCurrentUser: ( state ) => state.currentUser,
	getRoles: ( state ) => state.roles,
	getMetadataFields: ( state ) => state.metadataFields,
	getWorkflowStatus: ( state ) => state.workflowStatus,
	isWorkflowStatusResolved: ( state ) => state.workflowStatusResolved,
	getWorkflowStatusRequest: ( state ) => state.workflowStatusRequest,
};

const store = createReduxStore( STORE_NAME, {
	reducer,
	actions,
	selectors,
} );

register( store );

export { STORE_NAME };
export default store;
