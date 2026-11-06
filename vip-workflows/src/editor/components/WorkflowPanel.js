/**
 * Workflow Panel Component
 *
 * The post's movement through its workflow: where it sits, how far along that
 * is, who holds it, and every way onward.
 *
 * Which sequence the post is in, and the metadata that sequence declares, are
 * not here. They are properties of the post, so they are rows in the document
 * sidebar's Summary panel (WorkflowSummaryRows) alongside Status and Author —
 * and so is taking the post out of its workflow, which lives in the Workflow
 * row's popover beside the choice of workflow.
 *
 * It used to be two components — this one in a plugin sidebar and a
 * `WorkflowStatusPanel` in the document sidebar — which independently requested
 * the same status endpoint and independently rendered the sequence name, the
 * current stage and the terminal state from it. Two panels disagreeing about
 * the same post (one of them a request behind) is the failure that split
 * invited, so the transition actions moved here and the panel became the single
 * home. The save-layer guard did NOT come with them: it stays mounted
 * unconditionally from `src/editor/index.js`, outside every collapsible panel.
 * See WorkflowSaveGuard.
 *
 * Running a transition is not the panel's either. The editor header offers the
 * same moves (WorkflowHeaderAction), so the confirms, input popover and refusal
 * dialogs a move can open live in TransitionFlow, mounted once beside the save
 * guard; the rail here hands it a request through the store. Waiting on a stage
 * agent went with it: the poll, and the reload once the agent has rewritten the
 * post, have to run whether or not this panel is open.
 *
 * The state itself is not the panel's. It lives in the `vip-workflows/editor`
 * store, which performs the one read of the status endpoint and answers every
 * consumer from it — this panel, the Summary panel's rows, and the save
 * guard's veto notice, which removes a post from its workflow while standing
 * outside the sidebar entirely. A private copy here is what let that notice
 * delete a workflow the panel went on drawing until the page was reloaded.
 *
 * @package
 */

import {
	useState,
	useEffect,
	useRef,
	lazy,
	Suspense,
} from '@wordpress/element';
import {
	Button,
	Modal,
	Spinner,
	Notice as DismissibleNotice,
} from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import apiFetch from '@wordpress/api-fetch';
import { speak } from '@wordpress/a11y';
import { __, sprintf } from '@wordpress/i18n';
import { STORE_NAME } from '../store';
import { AuthorCell } from '../../common/DataViewCells';
import { useRequiredMetadataGate } from '../required-metadata';
import { TransitionRail } from './TransitionRail';
import { IdeationPanel } from './IdeationPanel';

// Loaded on demand. The history dialog is the editor's only DataViews consumer,
// and DataViews is bundled rather than externalized — keeping it out of the
// editor entry means the panel costs nothing extra for the readers who never
// open the trail.
const WorkflowHistoryModal = lazy( () => import( './WorkflowHistoryModal' ) );

/**
 * One person who holds the post — its assignee or its claimer — drawn the same
 * way whichever it is, so the two rows line up and stay alike.
 *
 * The person is drawn with the cell the lists use for an author, so the person
 * waiting on this post looks the same in the panel and in My Queue. "(you)" is
 * the cell's trailing slot: it is something this reader's context adds about
 * the person, not part of their name.
 *
 * @param {Object} props            Props.
 * @param {string} props.label      What the row says about them ("Assigned to:").
 * @param {Object} props.actor      The person, in the shared actor shape.
 * @param {*}      [props.children] Actions on the row, after the person.
 */
function HolderRow( { label, actor, children } ) {
	return (
		<Stack
			className="vip-workflows-panel__holder"
			direction="row"
			align="center"
			wrap="wrap"
		>
			<span className="vip-workflows-panel__holder-label">{ label }</span>
			<AuthorCell
				actor={ actor }
				className="vip-workflows-panel__holder-name"
			>
				{ actor.is_current && (
					<Text
						variant="body-md"
						className="vip-workflows-panel__you"
					>
						{ '(' + __( 'you', 'vip-workflows' ) + ')' }
					</Text>
				) }
			</AuthorCell>
			{ children }
		</Stack>
	);
}

/**
 * The post's place in its workflow, and everything that moves it.
 */
export function WorkflowPanel() {
	const {
		postId,
		postStatus,
		workflow,
		loading,
		transitioningTo,
		transitionError,
	} = useSelect( ( select ) => {
		const s = select( STORE_NAME );
		const editor = select( editorStore );
		return {
			postId: s.getPostId(),
			// Live core visibility — decoupled from the workflow stage, so
			// the panel can show whether a post-publish-stage post is
			// actually live.
			postStatus: editor.getEditedPostAttribute( 'status' ),
			// The whole of the post's workflow state, as the store last read
			// it. Not held here: an assignment or a removal performed anywhere
			// in the editor has to reach this panel, and a copy cannot be
			// reached.
			workflow: s.getWorkflowStatus(),
			// A resolved read that answered "no workflow" is not the same as
			// no read yet, and only the second is a spinner.
			loading: ! s.isWorkflowStatusResolved(),
			// The move in flight and the last refusal belong to the
			// transition flow (TransitionFlow), which runs every move whether
			// it was started here or from the header button.
			transitioningTo: s.getTransitioningTo(),
			transitionError: s.getTransitionError(),
		};
	}, [] );

	// The stage's ways out, with the required-metadata locks re-decided against
	// the fields as they stand in the editor rather than as they stand in the
	// database. The rail draws THIS list, and the transition flow acts on the
	// same one, because a rail that offers a move the flow then refuses (or
	// the reverse) is worse than either answer alone. See
	// required-metadata.js for why the editor is allowed to re-decide this one
	// lock, and only ever in the direction of releasing it.
	const { transitions } = useRequiredMetadataGate();

	const [ historyOpen, setHistoryOpen ] = useState( false );
	const [ actionError, setActionError ] = useState( null ); // every action failure — shown as a Notice, not a browser dialog

	// After Claim or Release, focus must not fall to the page when the button
	// that had it goes. It lands on whichever of the pair the post now offers
	// (Release after a claim, Claim after a release, or the same button again
	// after a refusal), and otherwise on the panel. Every branch's root takes
	// panelRef, since the re-read can swap branches (the post left its
	// workflow, or the workflow was deleted).
	const panelRef = useRef( null );
	const claimButtonRef = useRef( null );
	const releaseButtonRef = useRef( null );
	const [ restoreFocus, setRestoreFocus ] = useState( false );
	useEffect( () => {
		if ( ! restoreFocus ) {
			return;
		}
		setRestoreFocus( false );
		const { activeElement, body } = panelRef.current?.ownerDocument ?? {};
		if (
			activeElement &&
			activeElement !== body &&
			activeElement.isConnected
		) {
			return;
		}
		(
			releaseButtonRef.current ??
			claimButtonRef.current ??
			panelRef.current
		)?.focus();
	}, [ restoreFocus ] );

	// Busy while a move or a workflow-level write runs, wherever it was
	// started: the store's answer, so the header stands down with the panel.
	const transitioning = useSelect(
		( select ) => select( STORE_NAME ).isTransitioning(),
		[]
	);

	const {
		fetchWorkflowStatus,
		requestTransition,
		revertAgentStage,
		requestRerun,
		setWorkflowWriting,
		setTransitionError,
	} = useDispatch( STORE_NAME );

	// One notice reports two kinds of failure: the panel's own writes
	// (`actionError`) and a refused move (`transitionError`, the flow's). Each
	// new attempt of either kind starts from a clean notice, so the message on
	// screen is always about the last thing that was tried.
	const clearErrors = () => {
		setActionError( null );
		setTransitionError( null );
	};

	// A move can start outside this panel (the header button, the agent-held
	// warnings dialog), where nothing here is called — so the panel's own
	// leftover error is dropped when one goes in flight, not on a click.
	useEffect( () => {
		if ( null !== transitioningTo ) {
			setActionError( null );
		}
	}, [ transitioningTo ] );

	// The panel is what puts the post's workflow state on screen, so it is what
	// asks for it. The read itself belongs to the store: one request, answering
	// every consumer, rather than one per section or one per mount.
	useEffect( () => {
		fetchWorkflowStatus();
	}, [ fetchWorkflowStatus ] );

	// Every move goes through the transition flow, which owns the confirms,
	// the assignee popover and the refusal dialogs (see TransitionFlow).
	// `anchor` is the rail button that was clicked: a transition that requires
	// input opens a popover anchored to it, beside the sidebar.
	const handleTransitionClick = ( transition, anchor = null ) =>
		requestTransition( transition, anchor, 'panel' );

	// The failed AI stage's two actions. Run again retries the agent in place,
	// started by — and so acting as — whoever presses it; the transition flow
	// runs it, saving unsaved edits first, as it does before any move into an
	// AI stage. Go back returns the post to the stage it came from. Both are
	// shared with the header's button, so they are the same moves.
	const handleAgentRerun = () => requestRerun( 'panel' );

	const handleAgentRevert = async () => {
		clearErrors();
		try {
			await revertAgentStage();
		} catch ( err ) {
			setActionError(
				err.message ||
					__(
						'Could not move the post back. Try again.',
						'vip-workflows'
					)
			);
		}
	};

	const handleClaim = () => {
		setWorkflowWriting( true );
		clearErrors();
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/claim`,
			method: 'POST',
		} )
			.then( () => {
				speak( __( 'Post claimed.', 'vip-workflows' ) );
			} )
			.catch( ( err ) => {
				setActionError(
					err.message ||
						__(
							'Could not claim the post. Try again.',
							'vip-workflows'
						)
				);
				// A refusal is news about the post (someone else claimed it,
				// or it left the queue): re-read it below, so the panel shows
				// the post rather than the attempt.
			} )
			// Busy until the re-read lands, so the button can't be pressed
			// again against the state the write just changed.
			.then( () => fetchWorkflowStatus() )
			.finally( () => {
				setWorkflowWriting( false );
				// Claim was disabled while the write ran, so it has already
				// lost focus, and a successful claim removes it.
				setRestoreFocus( true );
			} );
	};

	const handleUnclaim = () => {
		setWorkflowWriting( true );
		clearErrors();
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/unclaim`,
			method: 'DELETE',
		} )
			.then( () => {
				speak( __( 'Claim released.', 'vip-workflows' ) );
			} )
			.catch( ( err ) => {
				setActionError(
					err.message ||
						__(
							'Could not release the post. Try again.',
							'vip-workflows'
						)
				);
				// The claim may already be gone (another release, or the post
				// taken out of its workflow): re-read it below, so the row and
				// its Release button match the post rather than the attempt.
			} )
			// Busy until the re-read lands: re-enabled any earlier, Release
			// could be pressed again on a claim that's already gone.
			.then( () => fetchWorkflowStatus() )
			.finally( () => {
				setWorkflowWriting( false );
				// Release was disabled while the write ran, so it has already
				// lost focus, and either way the re-read can remove its row.
				setRestoreFocus( true );
			} );
	};

	// Keyed, because it lands at a different child index in every branch below
	// and React matches unkeyed siblings by position. Without the key the panel
	// is torn down and rebuilt — re-running its ideation read — the moment the
	// status read resolves and the panel swaps branches.
	const ideationSlot = <IdeationPanel key="ideation" postId={ postId } />;

	if ( loading ) {
		return (
			<Stack
				ref={ panelRef }
				tabIndex={ -1 }
				className="vip-workflows-panel"
				direction="column"
				gap="lg"
			>
				<Stack
					className="vip-workflows-loading"
					direction="row"
					align="center"
					gap="sm"
				>
					<Spinner />
					{ __( 'Loading workflow…', 'vip-workflows' ) }
				</Stack>
				{ ideationSlot }
			</Stack>
		);
	}

	// The post's sequence row was deleted out from under it. There is no
	// workflow to move through — and the post is not free either: the save
	// layer reads its surviving sequence meta and refuses every status change
	// until the identity is cleared. The way out is the Workflow row in the
	// Summary panel, which says the sequence is gone and offers removal; this
	// panel only says why there is nothing to move.
	if ( workflow?.orphaned ) {
		return (
			<Stack
				ref={ panelRef }
				tabIndex={ -1 }
				className="vip-workflows-panel"
				direction="column"
				gap="lg"
			>
				<Text variant="body-md" className="vip-workflows-panel__empty">
					{ __(
						'This post’s workflow was deleted, so its status is locked.',
						'vip-workflows'
					) }
				</Text>
				{ ideationSlot }
			</Stack>
		);
	}

	// No workflow assigned. Choosing one is the Workflow row's job, in the
	// Summary panel — a post's workflow is one property with one control.
	if ( ! workflow?.has_workflow ) {
		const hasSequences = ( workflow?.available_sequences || [] ).length > 0;

		return (
			<Stack
				ref={ panelRef }
				tabIndex={ -1 }
				className="vip-workflows-panel"
				direction="column"
				gap="lg"
			>
				<Text variant="body-md" className="vip-workflows-panel__empty">
					{ hasSequences
						? __(
								'Not in a workflow. Choose one in the Workflow row.',
								'vip-workflows'
							)
						: __(
								'No workflow available for this post type.',
								'vip-workflows'
							) }
				</Text>
				{ ideationSlot }
			</Stack>
		);
	}

	// `transitions` is deliberately NOT taken from here: the projected list
	// above is the one this panel acts on, and destructuring the payload's raw
	// one would shadow it with the server's stale metadata locks.
	const {
		current,
		all_statuses: allStatuses,
		assigned_to: assignedTo,
		claimed_by: claimedBy,
		can_claim: canClaim,
		agent_pending: agentPending,
		agent_job: agentJob,
	} = workflow;

	const agentFailed = agentJob?.status === 'failed';

	return (
		<Stack
			ref={ panelRef }
			tabIndex={ -1 }
			className="vip-workflows-panel"
			direction="column"
			gap="lg"
		>
			{ /* Who holds the post: its transition assignee and its claimer, in
			     one group so the two rows line up. They are
			     stored separately, so each keeps its own row, and Release —
			     which clears the claim (/unclaim) and nothing else — sits on the
			     claim's row. */ }
			{ ( assignedTo || claimedBy ) && (
				<Stack
					className="vip-workflows-panel__holders"
					direction="column"
					gap="xs"
				>
					{ assignedTo && (
						<HolderRow
							label={ __( 'Assigned to:', 'vip-workflows' ) }
							actor={ assignedTo }
						/>
					) }
					{ claimedBy && (
						<HolderRow
							label={ __( 'Claimed by:', 'vip-workflows' ) }
							actor={ claimedBy }
						>
							{ claimedBy.is_current && (
								<Button
									ref={ releaseButtonRef }
									variant="link"
									size="small"
									onClick={ handleUnclaim }
									disabled={ transitioning }
									isDestructive
								>
									{ __( 'Release', 'vip-workflows' ) }
								</Button>
							) }
						</HolderRow>
					) }
				</Stack>
			) }

			{ /* Claim button - server determines eligibility based on stage + role */ }
			{ canClaim && (
				<Stack
					className="vip-workflows-panel__claim"
					direction="column"
				>
					<Button
						ref={ claimButtonRef }
						variant="secondary"
						size="compact"
						onClick={ handleClaim }
						isBusy={ transitioning }
						disabled={ transitioning }
					>
						{ __( 'Claim', 'vip-workflows' ) }
					</Button>
				</Stack>
			) }

			{ /* AI stage failed: surface the error and its two actions. Run
			     again retries in place when the job allows it (can_rerun). Go
			     back returns the post the way it came; the server names that
			     destination (agent_job.revert_to) exactly when it will honor the
			     move. Without either, the stage's routed transitions are
			     released and the rail below carries them. */ }
			{ ! agentPending && agentFailed && (
				// wpds-allow R7 -- error surface (background + border + radius) whose title, error line and button sit at three different distances; <Stack> draws none of the three and has one uniform gap.
				<div className="vip-workflows-panel__agent-failed">
					<Text
						variant="body-md"
						render={ <p /> }
						className="vip-workflows-panel__agent-failed-title"
					>
						{ __(
							'The AI agent could not finish.',
							'vip-workflows'
						) }
					</Text>
					{ agentJob?.error && (
						<Text
							variant="body-sm"
							render={ <p /> }
							className="vip-workflows-panel__agent-failed-error"
						>
							{ agentJob.error }
						</Text>
					) }
					{ ( agentJob?.can_rerun || agentJob?.revert_to ) && (
						<Stack direction="row" gap="sm" wrap="wrap">
							{ agentJob?.can_rerun && (
								<Button
									variant="primary"
									size="compact"
									onClick={ handleAgentRerun }
									isBusy={ transitioningTo === current?.key }
									disabled={ transitioning }
								>
									{ __( 'Run again', 'vip-workflows' ) }
								</Button>
							) }
							{ agentJob?.revert_to && (
								<Button
									variant={
										agentJob?.can_rerun
											? 'secondary'
											: 'primary'
									}
									size="compact"
									onClick={ handleAgentRevert }
									isBusy={
										transitioningTo ===
										agentJob.revert_to.key
									}
									disabled={ transitioning }
								>
									{ sprintf(
										/* translators: %s: the stage the post is returned to. */
										__( 'Go back to %s', 'vip-workflows' ),
										agentJob.revert_to.label
									) }
								</Button>
							) }
						</Stack>
					) }
				</div>
			) }

			{ /* Where this post came from, if it came from ideation. */ }
			{ ideationSlot }

			{ /* Every action failure (transition / go-back /
			     claim / release). A dismissible Notice rather than a browser
			     alert, per the no-browser-dialogs convention. A transition's
			     refusal is the flow's, kept in the store; a move started from
			     the header reports there instead. The refusal reads first:
			     every write of the panel's own clears it on the way in, so
			     where both stand, it is the newer of the two. */ }
			{ ( actionError || transitionError ) && (
				<DismissibleNotice
					status="error"
					isDismissible
					onRemove={ clearErrors }
					className="vip-workflows-panel__action-error"
				>
					{ transitionError || actionError }
				</DismissibleNotice>
			) }

			{ /* The transition rail: the current stage and every way out of
			     it, as one drawing. An AI stage's exits are withheld while its
			     agent works AND while it sits failed with a go-back available
			     (StatusManager::agent_owns_stage_exits) — the rail renders the
			     sequence's routed outcomes in their place, and the failed
			     state's ways out are the Run again and Go back buttons above.
			     Only a failure whose
			     origin cannot be resolved releases the routed transitions here,
			     so a failed agent never strands the post.

			     The transition flow still confirms before interrupting a run:
			     the buttons can be on screen when a job starts (the flow
			     polls), and the ability, Kanban board and Quick Edit paths
			     reach transition() without going through this list at all. */ }
			<TransitionRail
				current={ current }
				transitions={ transitions }
				allStatuses={ allStatuses }
				agentPending={ !! agentPending }
				agentFailed={ agentFailed }
				agentLastRun={ workflow?.agent_last_run || null }
				transitioning={ transitioning }
				transitioningTo={ transitioningTo }
				onTransition={ handleTransitionClick }
				postStatus={ postStatus }
			/>

			{ /* The panel's foot: the post's record in the workflow. Ruled off
			     from the transition buttons above because reading the trail is
			     not another way to move through it. */ }
			<Stack
				className="vip-workflows-panel__footer-actions"
				direction="column"
				gap="sm"
			>
				<Button
					variant="secondary"
					onClick={ () => setHistoryOpen( true ) }
				>
					{ __( 'Show history', 'vip-workflows' ) }
				</Button>
			</Stack>

			{ /* The history dialog and the DataViews inside it are fetched on
			     first open. The fallback is a dialog of its own so the click
			     always produces one immediately, rather than appearing to do
			     nothing while the chunk loads. */ }
			{ historyOpen && (
				<Suspense
					fallback={
						<Modal
							title={ __( 'Workflow history', 'vip-workflows' ) }
							onRequestClose={ () => setHistoryOpen( false ) }
							size="medium"
						>
							<Spinner />
						</Modal>
					}
				>
					<WorkflowHistoryModal
						postId={ postId }
						onClose={ () => setHistoryOpen( false ) }
					/>
				</Suspense>
			) }
		</Stack>
	);
}
