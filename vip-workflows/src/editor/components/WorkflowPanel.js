/**
 * Workflow Panel Component
 *
 * The whole of a post's workflow state in one place: which sequence it belongs
 * to, where it sits, how far along that is, who holds it, and every way out.
 *
 * It used to be two components — this one in the plugin sidebar and a
 * `WorkflowStatusPanel` in the document sidebar — which independently requested
 * the same status endpoint and independently rendered the sequence name, the
 * current stage and the terminal state from it. Two panels disagreeing about
 * the same post (one of them a request behind) is the failure that split
 * invited, so the transition actions moved here and the panel became the single
 * home. The save-layer guard did NOT come with them: it stays mounted
 * unconditionally from `src/editor/index.js`, outside the sidebar's sections.
 * See WorkflowSaveGuard.
 *
 * Running a transition is not the panel's either. The editor header offers the
 * same moves (WorkflowHeaderAction), so the confirms, input popover and refusal
 * dialogs a move can open live in TransitionFlow, mounted once beside the save
 * guard; the rail here hands it a request through the store. Waiting on a stage
 * agent went with it: the poll, and the reload once the agent has rewritten the
 * post, have to run whether or not this sidebar is open.
 *
 * The state itself is not the panel's. It lives in the `vip-workflows/editor`
 * store, which performs the one read of the status endpoint and answers every
 * consumer from it — this panel, the Metadata section below it, and the save
 * guard's veto notice, which removes a post from its workflow while standing
 * outside the sidebar entirely. A private copy here is what let that notice
 * delete a workflow the panel went on drawing until the page was reloaded.
 *
 * @package
 */

import {
	useState,
	useEffect,
	lazy,
	Fragment,
	Suspense,
} from '@wordpress/element';
import {
	Button,
	Modal,
	Spinner,
	Notice as DismissibleNotice,
} from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { useSelect, useDispatch, useRegistry } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { STORE_NAME } from '../store';
import { AuthorCell } from '../../common/DataViewCells';
import { useConfirm } from '../../common/use-confirm';
import {
	getOrphanedWorkflowRemoveConfirmation,
	getRemoveFromWorkflowConfirmation,
	getRemoveFromWorkflowLabel,
	getSwitchWorkflowConfirmLabel,
	getSwitchWorkflowConfirmTitle,
	getSwitchWorkflowConfirmation,
} from '../../entries/confirm-workflow-side-effect';
import { refreshPostEntity } from '../refresh-post-entity';
import { useRequiredMetadataGate } from '../required-metadata';
import { TransitionRail } from './TransitionRail';
import { WorkflowRow } from './WorkflowRow';
import { IdeationPanel } from './IdeationPanel';

// Loaded on demand. The history dialog is the editor's only DataViews consumer,
// and DataViews is bundled rather than externalized — keeping it out of the
// editor entry means the sidebar costs nothing extra for the readers who never
// open the trail.
const WorkflowHistoryModal = lazy( () => import( './WorkflowHistoryModal' ) );

/**
 * The post's workflow state, and everything that acts on it.
 *
 * @param {Object}      root0          Component props.
 * @param {JSX.Element} root0.children Seated between the transition rail and
 *                                     the panel's foot — the editorial metadata
 *                                     section (see src/editor/index.js). A slot
 *                                     rather than a sibling section because the
 *                                     foot is inside this panel: the two
 *                                     workflow-level buttons must come after
 *                                     the fields the writer fills in, and
 *                                     lifting the foot out would mean lifting
 *                                     its `transitioning`/`historyOpen` state
 *                                     and the lazily-loaded history dialog with
 *                                     it, purely for a reorder.
 *
 *                                     Every return below renders the slot,
 *                                     including the ones that draw no workflow.
 *                                     Nesting made this panel the only thing
 *                                     that decides whether the section reaches
 *                                     the screen, so a branch that drops the
 *                                     slot silently swallows the post's
 *                                     editorial fields — and whether there are
 *                                     any is the section's own question, which
 *                                     it answers by rendering nothing.
 */
export function WorkflowPanel( { children } ) {
	const {
		postId,
		postType,
		workflowEnforcement,
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
			postType: s.getPostType(),
			workflowEnforcement: s.getWorkflowEnforcement(),
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

	// The panel's own workflow-level writes — assign, remove, claim, release,
	// go back. A transition's busy state is the store's (`transitioningTo`).
	const [ writing, setWriting ] = useState( false );
	const [ historyOpen, setHistoryOpen ] = useState( false );
	const [ actionError, setActionError ] = useState( null ); // every action failure — shown as a Notice, not a browser dialog

	// Busy while either kind of write runs: nothing here starts while a move
	// is in flight, wherever that move was started.
	const transitioning = writing || null !== transitioningTo;

	const {
		fetchWorkflowStatus,
		receiveWorkflowStatus,
		assignSequence,
		removeWorkflow,
		requestTransition,
		setTransitionError,
	} = useDispatch( STORE_NAME );
	const registry = useRegistry();
	const [ confirm, confirmDialog ] = useConfirm();

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

	const isWorkflowRequired = workflowEnforcement === 'require';

	// Refetch the post entity after a workflow write changed it server-side, so
	// the editor chrome (Publish button, Summary status) reflects the change.
	// Assigning and removing carry their own — the store's thunks do it, so the
	// save guard's removal gets it too — leaving this for the writes only the
	// panel performs.
	const refreshPost = () => refreshPostEntity( registry, postType, postId );

	// The panel is what puts the post's workflow state on screen, so it is what
	// asks for it. The read itself belongs to the store: one request, answering
	// every consumer, rather than one per section or one per mount.
	useEffect( () => {
		fetchWorkflowStatus();
	}, [ fetchWorkflowStatus ] );

	// Put this post in a workflow — or move it to a different one.
	//
	// The post is always seated at the entry stage of the region its status is
	// already in, so starting a workflow never moves the post. A sequence with
	// no stage in that region is refused by the server, and the reason arrives
	// as an error message below — the author changes the status or picks another
	// sequence, rather than being offered a stage that would publish (or
	// unschedule) the post as the price of entry.
	//
	// Moving an enrolled post is the same call and the same seating rule, which
	// is exactly why it asks first: the post gives up wherever it had reached in
	// the sequence it is leaving, and choosing the old one back does not return
	// it. Starting from nothing gives nothing up, so that case asks nothing.
	const handleWorkflowSelect = async ( sequenceId ) => {
		if ( workflow?.has_workflow ) {
			// The id came from the list this row was rendered with, so the
			// destination is in it.
			const destination = ( workflow.available_sequences || [] ).find(
				( candidate ) => candidate.id === sequenceId
			);

			const proceed = await confirm(
				getSwitchWorkflowConfirmation( {
					fromWorkflowName: workflow.sequence?.name,
					toWorkflowName: destination?.name,
				} ),
				{
					title: getSwitchWorkflowConfirmTitle(),
					confirmLabel: getSwitchWorkflowConfirmLabel(),
				}
			);

			if ( ! proceed ) {
				return;
			}
		}

		setWriting( true );
		clearErrors();

		try {
			await assignSequence( sequenceId );
		} catch ( err ) {
			setActionError(
				err.message ||
					__( 'Could not assign the workflow.', 'vip-workflows' )
			);
		} finally {
			setWriting( false );
		}
	};

	// Remove workflow from this post.
	//
	// Same label, same copy and same dialog as the save guard's escape hatch —
	// and now the same call: both dispatch the store's removal, so neither can
	// be left rendering a workflow the other deleted.
	const handleRemoveWorkflow = async ( workflowName ) => {
		const confirmed = await confirm(
			// No name means the sequence row is gone, not that the lookup
			// failed: an orphaned post has nothing left to name.
			workflowName
				? getRemoveFromWorkflowConfirmation( { workflowName } )
				: getOrphanedWorkflowRemoveConfirmation(),
			{
				title: getRemoveFromWorkflowLabel(),
				confirmLabel: getRemoveFromWorkflowLabel(),
				isDestructive: true,
			}
		);

		if ( ! confirmed ) {
			return;
		}

		setWriting( true );
		clearErrors();

		try {
			await removeWorkflow();
		} catch ( err ) {
			setActionError(
				err.message ||
					__( 'Could not remove the workflow.', 'vip-workflows' )
			);
		} finally {
			// The panel stays mounted through a removal now, so the busy state
			// it entered with has to be left behind: the picker it re-renders
			// into is the same component instance.
			setWriting( false );
		}
	};

	// Every move goes through the transition flow, which owns the confirms,
	// the assignee popover and the refusal dialogs (see TransitionFlow).
	// `anchor` is the rail button that was clicked: a transition that requires
	// input opens a popover anchored to it, beside the sidebar.
	const handleTransitionClick = ( transition, anchor = null ) =>
		requestTransition( transition, anchor, 'panel' );

	// The failed AI stage's one action: return the post to the stage it came
	// from. Retrying the agent is going forward again — entering the stage
	// re-dispatches it — so there is no separate re-run. The response is a full
	// status payload, exactly like a transition's: a revert can cross a region
	// boundary, so the editor chrome must adopt the change too.
	const handleAgentRevert = () => {
		setWriting( true );
		clearErrors();
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/agent-revert`,
			method: 'POST',
		} )
			.then( ( response ) => {
				receiveWorkflowStatus( response );
				setWriting( false );
				refreshPost();
			} )
			.catch( ( err ) => {
				setActionError(
					err.message ||
						__( 'Failed to move the post back', 'vip-workflows' )
				);
				setWriting( false );
			} );
	};

	const handleClaim = () => {
		setWriting( true );
		clearErrors();
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/claim`,
			method: 'POST',
		} )
			.then( () => {
				fetchWorkflowStatus();
				setWriting( false );
			} )
			.catch( ( err ) => {
				setActionError(
					err.message || __( 'Failed to claim post', 'vip-workflows' )
				);
				setWriting( false );
			} );
	};

	const handleUnclaim = () => {
		setWriting( true );
		clearErrors();
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/unclaim`,
			method: 'DELETE',
		} )
			.then( () => {
				fetchWorkflowStatus();
				setWriting( false );
			} )
			.catch( ( err ) => {
				setActionError(
					err.message ||
						__( 'Failed to release post', 'vip-workflows' )
				);
				setWriting( false );
			} );
	};

	// The metadata slot, keyed, because it lands at a different child index in
	// every branch below and React matches unkeyed siblings by position. Without
	// the key the section is torn down and rebuilt the moment the status read
	// resolves and the panel swaps branches — every user field re-running its
	// lookup, any open popover closing — which is the blink the loading branch
	// renders it to avoid. One key, one instance, whichever branch draws it.
	const metadataSlot = <Fragment key="metadata">{ children }</Fragment>;
	const ideationSlot = <IdeationPanel key="ideation" postId={ postId } />;

	if ( loading ) {
		return (
			<Stack className="vip-workflows-panel" direction="column" gap="lg">
				<Stack
					className="vip-workflows-loading"
					direction="row"
					align="center"
					gap="sm"
				>
					<Spinner />
					{ __( 'Loading workflow…', 'vip-workflows' ) }
				</Stack>
				{ /* The metadata fields are hydrated by the server bootstrap,
				     not by the read this spinner waits on, so they are already
				     known and stay on screen rather than blinking out until the
				     status lands. */ }
				{ ideationSlot }
				{ metadataSlot }
			</Stack>
		);
	}

	// The post's sequence row was deleted out from under it. There is no
	// workflow to render — but the post is not free either: the save layer reads
	// its surviving sequence meta and refuses every status change until the
	// identity is cleared. Offering the sequence selector here (what the
	// `! has_workflow` branch below does) both hid that and invited the user to
	// bury it under a second workflow. Removal is the only way out, so it is the
	// only thing offered.
	if ( workflow?.orphaned ) {
		return (
			<Stack className="vip-workflows-panel" direction="column" gap="lg">
				<Stack
					className="vip-workflows-panel__empty"
					direction="column"
					align="center"
					gap="md"
				>
					<Text variant="body-md">
						{ __(
							'This post belongs to a workflow that no longer exists, so its status cannot be changed.',
							'vip-workflows'
						) }
					</Text>
					<Button
						variant="primary"
						isDestructive
						onClick={ () => handleRemoveWorkflow() }
						disabled={ transitioning }
						isBusy={ transitioning }
					>
						{ getRemoveFromWorkflowLabel() }
					</Button>
				</Stack>
				{ /* Removal is the only action this branch offers, but it is
				     still a network call that can fail — and with nothing
				     shown here, a failed removal looked identical to the
				     button doing nothing at all. */ }
				{ actionError && (
					<DismissibleNotice
						status="error"
						isDismissible
						onRemove={ () => setActionError( null ) }
						className="vip-workflows-panel__action-error"
					>
						{ actionError }
					</DismissibleNotice>
				) }
				{ /* The fields are the post's, not the deleted sequence's: they
				     are stored on the post and stay editable while its broken
				     workflow identity is cleared. */ }
				{ ideationSlot }
				{ metadataSlot }
				{ confirmDialog }
			</Stack>
		);
	}

	// No workflow assigned - show selector if sequences available.
	if ( ! workflow?.has_workflow ) {
		const availableSequences = workflow?.available_sequences || [];

		if ( availableSequences.length === 0 ) {
			return (
				<Stack
					className="vip-workflows-panel"
					direction="column"
					gap="lg"
				>
					<Text
						variant="body-md"
						className="vip-workflows-panel__empty"
					>
						{ __(
							'No workflow available for this post type.',
							'vip-workflows'
						) }
					</Text>
					{ ideationSlot }
					{ metadataSlot }
				</Stack>
			);
		}

		// The same row the assigned panel opens with, empty. A post's workflow
		// is one property with one control, whether or not it has been set —
		// so choosing from the list IS starting the workflow, and there is no
		// separate button to press afterwards. No confirm can open on this
		// branch (there is no place to give up), which is why the dialog node
		// is not rendered here.
		return (
			<Stack className="vip-workflows-panel" direction="column" gap="md">
				<WorkflowRow
					sequence={ null }
					availableSequences={ availableSequences }
					disabled={ transitioning }
					onSelect={ handleWorkflowSelect }
				/>
				{ /* The server can refuse an assignment — a sequence that
				     models no stage in the post's status region — and that
				     refusal is the answer the author needs. */ }
				{ actionError && (
					<DismissibleNotice
						status="error"
						isDismissible
						onRemove={ () => setActionError( null ) }
						className="vip-workflows-panel__action-error"
					>
						{ actionError }
					</DismissibleNotice>
				) }
				{ ideationSlot }
				{ metadataSlot }
			</Stack>
		);
	}

	// `transitions` is deliberately NOT taken from here: the projected list
	// above is the one this panel acts on, and destructuring the payload's raw
	// one would shadow it with the server's stale metadata locks.
	const {
		current,
		sequence,
		all_statuses: allStatuses,
		assigned_to: assignedTo,
		can_claim: canClaim,
		agent_pending: agentPending,
		agent_job: agentJob,
		available_sequences: availableSequences,
	} = workflow;

	const agentFailed = agentJob?.status === 'failed';

	return (
		<Stack className="vip-workflows-panel" direction="column" gap="lg">
			{ /* Which sequence this post belongs to, as the document sidebar
			     writes any other property of a post: the label beside a
			     value you can press. It used to be the sequence's name alone,
			     as an unlabelled heading — which named the panel but offered
			     no way to change what it named, so the only workflow-level
			     act available was leaving one. The same row now serves both
			     states, so starting a workflow and moving to another are the
			     same gesture rather than two unrelated shapes. */ }
			<WorkflowRow
				sequence={ sequence }
				availableSequences={ availableSequences }
				disabled={ transitioning }
				onSelect={ handleWorkflowSelect }
			/>

			{ /* Assignment info */ }
			{ assignedTo && (
				<Stack
					className="vip-workflows-panel__assigned"
					direction="row"
					align="center"
					wrap="wrap"
				>
					<span className="vip-workflows-panel__assigned-label">
						{ __( 'Assigned to:', 'vip-workflows' ) }
					</span>
					{ /* The same cell the lists draw an author with, so the
					     person waiting on this post looks like the same person
					     in the sidebar and in My Queue. "(you)" is the trailing
					     slot: it is something this reader's context adds about
					     the assignee, not part of their name. */ }
					<AuthorCell
						actor={ assignedTo }
						className="vip-workflows-panel__assigned-name"
					>
						{ assignedTo.is_current && (
							<Text
								variant="body-md"
								className="vip-workflows-panel__you"
							>
								{ '(' + __( 'you', 'vip-workflows' ) + ')' }
							</Text>
						) }
					</AuthorCell>
					{ assignedTo.is_current && (
						<Button
							variant="link"
							size="small"
							onClick={ handleUnclaim }
							disabled={ transitioning }
							isDestructive
						>
							{ __( 'Release', 'vip-workflows' ) }
						</Button>
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

			{ /* AI stage failed: surface the error, and offer the one exit a
			     failed stage has — back the way the post came. The server names
			     the destination (agent_job.revert_to) exactly when it will honor
			     the move; without it the stage's routed transitions are released
			     instead and the rail below carries them, so no button here. */ }
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
					{ agentJob?.revert_to && (
						<Button
							variant="primary"
							size="compact"
							onClick={ handleAgentRevert }
							isBusy={ transitioning }
							disabled={ transitioning }
						>
							{ sprintf(
								/* translators: %s: the stage the post is returned to. */
								__( 'Go back to %s', 'vip-workflows' ),
								agentJob.revert_to.label
							) }
						</Button>
					) }
				</div>
			) }

			{ /* Where this post came from, if it came from ideation. */ }
			{ ideationSlot }

			{ /* Every action failure (assign / remove / transition / go-back /
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
			     state's exit is the Go back button above. Only a failure whose
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

			{ /* Editorial metadata, seated directly under the rail. The fields
			     belong to the workflow — a sequence declares them — but they
			     are the writer's to fill in, so they continue the run of things
			     the post is made of rather than being interrupted by the two
			     buttons below, which act on the workflow itself. */ }
			{ metadataSlot }

			{ /* The panel's foot: what you can do to the workflow itself,
			     rather than to the post's place in it. Ruled off from the
			     transition buttons above because leaving the workflow is not
			     another way to move through it — and "Exit" used to be a small
			     underlined link tucked beside the sequence name, which is a
			     quiet home for the one irreversible action here.

			     Removal keeps its "require" gating: an enforced workflow offers
			     no way out. */ }
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
				{ ! isWorkflowRequired && (
					<Button
						variant="secondary"
						isDestructive
						onClick={ () => handleRemoveWorkflow( sequence?.name ) }
						disabled={ transitioning }
					>
						{ getRemoveFromWorkflowLabel() }
					</Button>
				) }
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

			{ confirmDialog }
		</Stack>
	);
}
