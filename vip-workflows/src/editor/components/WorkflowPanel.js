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
import { useSelect, useDispatch, useRegistry } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { STORE_NAME } from '../store';
import { AuthorCell } from '../../common/DataViewCells';
import { useConfirm } from '../../common/use-confirm';
import {
	getAgentInterruptWarning,
	getStatusChangeConfirmLabel,
	getStatusChangeConfirmTitle,
	getTransitionPublishConfirmLabel,
	getTransitionPublishConfirmTitle,
	getTransitionPublishWarning,
} from '../../common/confirm-workflow-side-effect';
import { refreshPostEntity } from '../refresh-post-entity';
import {
	REQUIRED_METADATA_LOCK,
	useRequiredMetadataGate,
} from '../required-metadata';
import { TransitionAssignmentPopover } from './TransitionInputPopover';
import { ToolFailuresModal } from '../../common/ToolFailuresModal';
import { TransitionRail } from './TransitionRail';
import { IdeationPanel } from './IdeationPanel';

// Loaded on demand. The history dialog is the editor's only DataViews consumer,
// and DataViews is bundled rather than externalized — keeping it out of the
// editor entry means the sidebar costs nothing extra for the readers who never
// open the trail.
const WorkflowHistoryModal = lazy( () => import( './WorkflowHistoryModal' ) );

/**
 * The post's place in its workflow, and everything that moves it.
 */
export function WorkflowPanel() {
	const {
		postId,
		postType,
		postStatus,
		savedStatus,
		workflow,
		hasRequiredMetadata,
		loading,
	} = useSelect( ( select ) => {
		const s = select( STORE_NAME );
		const editor = select( editorStore );
		return {
			postId: s.getPostId(),
			postType: s.getPostType(),
			// Live core visibility — decoupled from the workflow stage, so
			// the panel can show whether a post-publish-stage post is
			// actually live.
			postStatus: editor.getEditedPostAttribute( 'status' ),
			// The committed status, for the publish confirm: the server
			// decides the boundary crossing against what is persisted, so
			// an unsaved status edit must not change whether we ask.
			savedStatus: editor.getCurrentPostAttribute( 'status' ),
			// The whole of the post's workflow state, as the store last read
			// it. Not held here: an assignment or a removal performed anywhere
			// in the editor has to reach this panel, and a copy cannot be
			// reached.
			workflow: s.getWorkflowStatus(),
			// Whether the sequence declares any REQUIRED metadata field.
			// The server's gate reads those fields out of post meta, and the
			// Summary rows write them through useEntityProp — an editor-store edit
			// that is not in the database until the post is saved. So this,
			// together with whether the move crosses into the publish region,
			// is what tells a transition whether it depends on persisted meta.
			hasRequiredMetadata: ( s.getMetadataFields() || [] ).some(
				( field ) => !! field.required
			),
			// A resolved read that answered "no workflow" is not the same as
			// no read yet, and only the second is a spinner.
			loading: ! s.isWorkflowStatusResolved(),
		};
	}, [] );

	// The stage's ways out, with the required-metadata locks re-decided against
	// the fields as they stand in the editor rather than as they stand in the
	// database. Everything in this panel that reads a transition reads THIS
	// list — the rail it renders, the click handler's target lookup, and the
	// open-popover check below — because a rail that offers a move the handler
	// then refuses (or the reverse) is worse than either answer alone. See
	// required-metadata.js for why the editor is allowed to re-decide this one
	// lock, and only ever in the direction of releasing it.
	const { transitions } = useRequiredMetadataGate();

	const [ transitioning, setTransitioning ] = useState( false );

	/*
	 * Which destination is in flight, or null.
	 *
	 * `transitioning` still gates every button's disabled state — starting a
	 * second transition mid-flight is not allowed — but it cannot say *which*
	 * one is running. Applied as `isBusy` to all of them, it spun the whole row
	 * and made a mis-click indistinguishable from the intended click.
	 */
	const [ transitioningTo, setTransitioningTo ] = useState( null );
	const [ historyOpen, setHistoryOpen ] = useState( false );
	const [ toolFailures, setToolFailures ] = useState( null ); // For displaying blocked transition details
	const [ warningsModal, setWarningsModal ] = useState( null ); // { toStatus, warnings, inputData, comment }
	/*
	 * The transition currently asking for an assignee.
	 *
	 * A transition carries at most one assignment — the write gate refuses two —
	 * so this is one request, not a queue. Dismissing its popover abandons the
	 * transition: nothing is written until the move happens, so backing out
	 * costs the post nothing.
	 */
	const [ assignmentRequest, setAssignmentRequest ] = useState( null ); // { toStatus, input, transitionLabel, anchor }
	const [ showRefreshPrompt, setShowRefreshPrompt ] = useState( false ); // agent finished with unsaved edits open
	const [ actionError, setActionError ] = useState( null ); // every action failure — shown as a Notice, not a browser dialog

	const { savePost } = useDispatch( editorStore );
	const { fetchWorkflowStatus, receiveWorkflowStatus } =
		useDispatch( STORE_NAME );
	const registry = useRegistry();
	const [ confirm, confirmDialog ] = useConfirm();

	// Tracks whether we have observed an agent job pending in this session, so
	// we can react to the pending → finished edge.
	const wasAgentPendingRef = useRef( false );

	// Refetch the post entity after a workflow write changed it server-side, so
	// the editor chrome (Publish button, Summary status) reflects the change.
	// Assigning and removing carry their own — the store's thunks do it — so
	// this is for the writes only the panel performs.
	const refreshPost = () => refreshPostEntity( registry, postType, postId );

	// The panel is what puts the post's workflow state on screen, so it is what
	// asks for it. The read itself belongs to the store: one request, answering
	// every consumer, rather than one per section or one per mount.
	useEffect( () => {
		fetchWorkflowStatus();
	}, [ fetchWorkflowStatus ] );

	// While an agent is working, poll so the panel picks up the outcome
	// (transition away, or fail-in-place) without a manual reload.
	const agentIsPending = !! workflow?.agent_pending;
	const agentJobState = workflow?.agent_job;
	useEffect( () => {
		if ( ! agentIsPending ) {
			return;
		}

		const interval = setInterval( () => fetchWorkflowStatus(), 5000 );
		return () => clearInterval( interval );
	}, [ agentIsPending, fetchWorkflowStatus ] );

	// A stage agent cannot decide whether to proceed past a soft warning. Its
	// held route uses the same confirmation dialog as a human-started
	// transition, then retries the exact destination as the current person.
	useEffect( () => {
		if ( agentJobState?.status !== 'warnings_pending' ) {
			return;
		}

		setWarningsModal( {
			toStatus: agentJobState.to_status,
			warnings: agentJobState.soft_warnings,
			inputData: null,
			comment: agentJobState.comment,
		} );
	}, [ agentJobState ] );

	// When a stage agent finishes, the post it rewrote lives in the database but
	// this open editor still shows the pre-agent content. React to the pending →
	// finished edge: auto-reload when the editor is clean (nothing to lose), or
	// surface a reload prompt when there are unsaved edits so we never discard
	// the user's in-progress work without asking.
	useEffect( () => {
		const wasPending = wasAgentPendingRef.current;
		wasAgentPendingRef.current = agentIsPending;

		// Only act on a pending → not-pending edge we actually observed this
		// session (ignore the initial mount and steady states).
		if ( ! wasPending || agentIsPending ) {
			return;
		}

		// A fail-in-place or held warning keeps the post in the AI stage; its
		// dedicated UI handles the next human action and no refresh is needed.
		if (
			[ 'failed', 'warnings_pending' ].includes( agentJobState?.status )
		) {
			return;
		}

		// The agent finished and routed the post onward. Pull its result in.
		if ( registry.select( editorStore ).isEditedPostDirty() ) {
			setShowRefreshPrompt( true ); // A: let the user choose (keeps edits).
		} else {
			// B: clean editor — reload discards nothing. Held just long
			// enough for the rail's outcome flash and its announcement to
			// land first; nobody clicked, so the flash is the only thing
			// saying which way the agent routed.
			const timer = setTimeout( () => window.location.reload(), 800 );
			return () => clearTimeout( timer );
		}
	}, [ agentIsPending, workflow, agentJobState, registry ] );

	// A workflow refresh can withdraw the transition an open input popover
	// belongs to (another user moved the post, an agent finished, polling
	// re-read the stage). Drop a stored request whose destination is no longer
	// offered: committing it would fire a move the current stage does not
	// declare — and the request also holds `anchor`, a raw DOM node the
	// Popover uses verbatim (no isConnected guard upstream), so a future rail
	// re-key must never leave a popover anchored to a detached node.
	useEffect( () => {
		const offered = ( to ) => transitions.some( ( t ) => t.to === to );

		if ( assignmentRequest && ! offered( assignmentRequest.toStatus ) ) {
			setAssignmentRequest( null );
		}
	}, [ transitions, assignmentRequest ] );

	const handleTransition = (
		toStatus,
		acknowledgeWarnings = false,
		inputData = null,
		comment = ''
	) => {
		setTransitioning( true );
		setTransitioningTo( toStatus );
		setActionError( null );
		setToolFailures( null );

		const requestData = {
			to_status: toStatus,
			acknowledge_warnings: acknowledgeWarnings,
		};

		if ( inputData ) {
			requestData.input_data = inputData;
		}
		if ( comment ) {
			requestData.comment = comment;
		}

		// Two things the server judges against the *persisted* post, both of
		// which the author may have only in the editor store:
		//
		// - An AI stage runs its agent asynchronously against the database row,
		//   so unsaved edits would hand the agent a stale — or, for a
		//   never-saved post, empty — post.
		// - A required metadata field is read with get_post_meta(). The Summary rows
		//   writes those fields through useEntityProp, which edits the editor
		//   store and nothing else until a save. Without this, an author types
		//   "Politics" into Section, clicks the transition, and is refused with
		//   "Section is required and has no value" while the value sits on
		//   screen in front of them — and clicking again does the same thing.
		//   A required-field refusal is precisely the case where the fix IS an
		//   unsaved meta edit, so the edit has to go first.
		//
		//   The server only holds a move for required fields when it crosses
		//   INTO the publish region (Sequence::crosses_into_publish(), judged on
		//   stage regions: the target's is publish and the current stage's is
		//   not). Every other move is never refused for them, so it has no
		//   reason to write the post first. Same stage-region test the publish
		//   confirm below asks, minus the saved-status clause that is about
		//   whether going live is news, not about what the gate judges.
		//
		// Still narrowed rather than "save on every dirty transition": a
		// transition that depends on neither leaves the author's unsaved work
		// exactly where they left it.
		const targetTransition = transitions.find( ( t ) => t.to === toStatus );
		const targetIsAiStage =
			!! targetTransition?.status_info?.agent?.ability_id;
		const crossesIntoPublish =
			targetTransition?.status_info?.status === 'publish' &&
			workflow?.current?.status !== 'publish';
		const needsPersistedPost =
			targetIsAiStage || ( hasRequiredMetadata && crossesIntoPublish );
		const editor = registry.select( editorStore );
		const ensureSaved =
			needsPersistedPost && editor.isEditedPostDirty()
				? savePost()
				: Promise.resolve();

		ensureSaved
			.then( () => {
				// savePost() resolves even when the save request fails (the error
				// is recorded in the editor store). If the post is still dirty the
				// content never persisted, so bail rather than send a transition
				// the server will judge against a row that is not what the author
				// is looking at.
				if (
					needsPersistedPost &&
					registry.select( editorStore ).isEditedPostDirty()
				) {
					throw {
						code: 'save_failed',
						message: targetIsAiStage
							? __(
									'Could not save the post before starting the AI stage. Try again.',
									'vip-workflows'
							  )
							: __(
									'Could not save the post before the transition. Try again.',
									'vip-workflows'
							  ),
					};
				}

				return apiFetch( {
					path: `/vip-workflows/v1/workflow/post/${ postId }/transition`,
					method: 'POST',
					data: requestData,
				} );
			} )
			.then( ( response ) => {
				// Check if there are warnings pending acknowledgement. The
				// input captured for this attempt rides along: the server
				// processes input after the warning gates, so the acknowledge
				// re-fire must carry it again or the transition completes with
				// the note/assignee silently absent.
				if (
					response.warnings_pending &&
					response.soft_warnings?.length > 0
				) {
					setWarningsModal( {
						toStatus,
						warnings: response.soft_warnings,
						inputData,
						comment,
					} );
					setTransitioning( false );
					setTransitioningTo( null );
					return;
				}

				// A transition that leaves the user's role with no permitted
				// transitions is not a lockout: they keep `edit_post` and stay
				// in the editor with their unsaved work. The panel simply has
				// no buttons to offer at the new stage.
				//
				// The response IS a status payload, so it is adopted rather
				// than re-read; adopting it also retires any poll still in
				// flight, which would otherwise land afterwards carrying the
				// stage the post has just left.
				receiveWorkflowStatus( response );
				setTransitioning( false );
				setTransitioningTo( null );
				setWarningsModal( null );

				refreshPost();
			} )
			.catch( ( err ) => {
				setTransitioning( false );
				setTransitioningTo( null );

				// A refusal that carries per-item detail: a required tool's
				// hard check, or a required metadata field left empty. Both
				// arrive in the same `hard_failures` shape and both mean the
				// same thing to the author — the transition is blocked, here
				// is the list — so both open the one dialog.
				if (
					( err.code === 'tool_check_failed' ||
						err.code === REQUIRED_METADATA_LOCK ) &&
					err.data
				) {
					setToolFailures( {
						code: err.code,
						message: err.message,
						hardFailures: err.data.hard_failures || [],
						softWarnings: err.data.soft_warnings || [],
					} );

					if ( REQUIRED_METADATA_LOCK === err.code ) {
						// The decision to save before transitioning reads the
						// required fields off the last status read. A sequence
						// that gained one since the editor loaded would skip the
						// save, be refused here, and be refused again on the
						// next click — the loop this guard exists to end. Re-read
						// so the next attempt knows to persist first.
						fetchWorkflowStatus();
					}
				} else {
					setActionError(
						err.message ||
							__( 'Transition failed', 'vip-workflows' )
					);
				}
			} );
	};

	// Handle proceeding despite warnings — re-sending the attempt's input,
	// which the first request captured but the server has not yet consumed.
	const handleIgnoreWarnings = () => {
		if ( warningsModal ) {
			handleTransition(
				warningsModal.toStatus,
				true,
				warningsModal.inputData,
				warningsModal.comment
			);
		}
	};

	// Handle assignment selection (user, role, etc.)
	const handleAssignmentSelect = ( selectedValue, notes = '' ) => {
		if ( ! assignmentRequest ) {
			return;
		}

		const metaKey = assignmentRequest.input.meta_key;
		if ( ! metaKey ) {
			console.error(
				'Missing meta_key in assignment input configuration',
				assignmentRequest.input
			);
			return;
		}

		// Named the way a note is: the history labels each value by its
		// `__name`, and falls back to the raw key — a minted `wfp_n…` id.
		//
		// `selectedValue` is only null for an optional assignment Submitted
		// empty (or explicitly Cleared) — `?? ''` sends that as an explicit
		// empty value rather than omitting the key, so the server can tell
		// "clear this assignment" apart from "this transition carries no
		// assignment input at all" (an absent key is left untouched).
		const inputData = {
			[ metaKey ]: selectedValue ?? '',
			[ `${ metaKey }__name` ]:
				assignmentRequest.input.label ||
				__( 'Assignee', 'vip-workflows' ),
		};

		// Add notes if provided
		if ( notes ) {
			const notesKey = `${ metaKey }_notes`;
			inputData[ notesKey ] = notes;
			inputData[ `${ notesKey }__name` ] = __( 'Notes', 'vip-workflows' );
		}

		setAssignmentRequest( null );
		handleTransition( assignmentRequest.toStatus, false, inputData );
	};

	// `anchor` is the rail button that was clicked: a transition that requires
	// input opens a popover anchored to it, beside the sidebar, rather than a
	// full-screen modal over everything.
	const handleTransitionClick = async ( transition, anchor = null ) => {
		// Check if transition is locked
		if ( transition._locked ) {
			return; // Button should be disabled, but just in case
		}

		// Moving the stage while a stage agent runs cancels that agent. The
		// server no longer refuses this — a human can always stop an agent —
		// so the only thing owed to the user is knowing they are about to.
		if ( agentIsPending ) {
			const proceed = await confirm( getAgentInterruptWarning(), {
				title: getStatusChangeConfirmTitle(),
				confirmLabel: getStatusChangeConfirmLabel(),
			} );

			if ( ! proceed ) {
				return;
			}
		}

		// A transition into a publish-region stage takes the post live: the
		// edge crosses the publish boundary, so the server writes `publish`
		// before the stage move. Going publicly visible deserves an explicit
		// yes — core's own Publish button asks for one — so it is asked here,
		// once, before any input modal. Already-live posts are exempt on both
		// sides of the check: a move between two publish-region stages writes
		// nothing, and a live post seated at a draft-region stage (the
		// boundary anomaly) is already public, so there is no news to confirm.
		// A scheduled post is NOT exempt — its stage stayed put, so the
		// crossing still happens and publishes it now, ahead of its schedule.
		const publishes =
			transition.status_info?.status === 'publish' &&
			workflow?.current?.status !== 'publish' &&
			savedStatus !== 'publish';

		if ( publishes ) {
			const proceed = await confirm(
				getTransitionPublishWarning( {
					stageLabel: transition.status_info?.label || transition.to,
					scheduled: savedStatus === 'future',
				} ),
				{
					title: getTransitionPublishConfirmTitle(),
					confirmLabel: getTransitionPublishConfirmLabel(),
				}
			);

			if ( ! proceed ) {
				return;
			}
		}

		/*
		 * The assignment this transition asks for, if any.
		 *
		 * An assignment is the only input the sidebar collects. Anything else a
		 * stored transition carries — a retired note (`textarea`, or the older
		 * `text`), or a kind this build does not know — is passed over rather
		 * than allowed to block the move; the sequence editor lists it for the
		 * author to remove.
		 */
		const input = ( transition.inputs || [] ).find(
			( candidate ) => 'assignment' === candidate?.type
		);

		if ( ! input ) {
			handleTransition( transition.to );
			return;
		}

		setAssignmentRequest( {
			toStatus: transition.to,
			input,
			transitionLabel: transition.label,
			anchor,
			// The post's existing assignee for this input's slot, if any —
			// so reopening the popover shows who is already assigned rather
			// than asking the user to re-pick from scratch.
			initialValue:
				workflow?.assignments?.[ input.meta_key ]?.value ?? null,
		} );
	};

	// The failed AI stage's one action: return the post to the stage it came
	// from. Retrying the agent is going forward again — entering the stage
	// re-dispatches it — so there is no separate re-run. The response is a full
	// status payload, exactly like a transition's: a revert can cross a region
	// boundary, so the editor chrome must adopt the change too.
	const handleAgentRevert = () => {
		setTransitioning( true );
		setActionError( null );
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/agent-revert`,
			method: 'POST',
		} )
			.then( ( response ) => {
				receiveWorkflowStatus( response );
				setTransitioning( false );
				refreshPost();
			} )
			.catch( ( err ) => {
				setActionError(
					err.message ||
						__( 'Failed to move the post back', 'vip-workflows' )
				);
				setTransitioning( false );
			} );
	};

	const handleClaim = () => {
		setTransitioning( true );
		setActionError( null );
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/claim`,
			method: 'POST',
		} )
			.then( () => {
				fetchWorkflowStatus();
				setTransitioning( false );
			} )
			.catch( ( err ) => {
				setActionError(
					err.message || __( 'Failed to claim post', 'vip-workflows' )
				);
				setTransitioning( false );
			} );
	};

	const handleUnclaim = () => {
		setTransitioning( true );
		setActionError( null );
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/unclaim`,
			method: 'DELETE',
		} )
			.then( () => {
				fetchWorkflowStatus();
				setTransitioning( false );
			} )
			.catch( ( err ) => {
				setActionError(
					err.message ||
						__( 'Failed to release post', 'vip-workflows' )
				);
				setTransitioning( false );
			} );
	};

	// Keyed, because it lands at a different child index in every branch below
	// and React matches unkeyed siblings by position. Without the key the panel
	// is torn down and rebuilt — re-running its ideation read — the moment the
	// status read resolves and the panel swaps branches.
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
			<Stack className="vip-workflows-panel" direction="column" gap="lg">
				<Text variant="body-md" className="vip-workflows-panel__empty">
					{ __(
						'This post belongs to a workflow that no longer exists, so its status cannot be changed.',
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
			<Stack className="vip-workflows-panel" direction="column" gap="lg">
				<Text variant="body-md" className="vip-workflows-panel__empty">
					{ hasSequences
						? __(
								'This post is not in a workflow. Choose one from the Workflow row in the Summary panel.',
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
		can_claim: canClaim,
		agent_pending: agentPending,
		agent_job: agentJob,
	} = workflow;

	const agentFailed = agentJob?.status === 'failed';

	return (
		<Stack className="vip-workflows-panel" direction="column" gap="lg">
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

			{ /* AI stage finished while the editor held unsaved edits: the agent's
			     changes are in the database but not in this open editor. Offer a
			     reload rather than discarding the user's work automatically. */ }
			{ showRefreshPrompt && (
				<DismissibleNotice
					status="info"
					isDismissible
					onRemove={ () => setShowRefreshPrompt( false ) }
					className="vip-workflows-panel__agent-refresh"
					actions={ [
						{
							label: __( 'Reload', 'vip-workflows' ),
							onClick: () => window.location.reload(),
							variant: 'primary',
						},
					] }
				>
					{ __(
						'The AI agent updated this post. Reload to see its changes — this discards your unsaved edits.',
						'vip-workflows'
					) }
				</DismissibleNotice>
			) }

			{ /* Every action failure (assign / remove / transition / go-back /
			     claim / release). A dismissible Notice rather than a browser
			     alert, per the no-browser-dialogs convention. */ }
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

			{ /* The transition rail: the current stage and every way out of
			     it, as one drawing. An AI stage's exits are withheld while its
			     agent works AND while it sits failed with a go-back available
			     (StatusManager::agent_owns_stage_exits) — the rail renders the
			     sequence's routed outcomes in their place, and the failed
			     state's exit is the Go back button above. Only a failure whose
			     origin cannot be resolved releases the routed transitions here,
			     so a failed agent never strands the post.

			     `handleTransitionClick` still confirms before interrupting a
			     run: the buttons can be on screen when a job starts (the panel
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

			{ /* Tool Failures Modal. Shared with the admin Ideation workspace —
			     same dialog, same chrome, one component. */ }
			{ toolFailures && (
				<ToolFailuresModal
					title={ __( 'Transition blocked', 'vip-workflows' ) }
					message={ toolFailures.message }
					hardFailures={ toolFailures.hardFailures }
					softWarnings={ toolFailures.softWarnings }
					// The shared default reads "Required checks failed", which
					// describes a tool refusal. Nothing was checked here: the
					// sequence asked for these fields and they are blank, and
					// the heading has to say so or the list underneath looks
					// like output from a tool that does not exist.
					hardTitle={
						toolFailures.code === REQUIRED_METADATA_LOCK
							? __( 'Required fields are empty', 'vip-workflows' )
							: undefined
					}
					onClose={ () => setToolFailures( null ) }
				/>
			) }

			{ /* Warnings Confirmation Modal */ }
			{ warningsModal && (
				<ToolFailuresModal
					title={ __( 'Warnings detected', 'vip-workflows' ) }
					message={ __(
						'The following warnings were detected:',
						'vip-workflows'
					) }
					softWarnings={ warningsModal.warnings }
					// The shared default reads "(not blocking)", which is wrong
					// here: this dialog stands between the author and the
					// transition until they choose to continue past it.
					softTitle={ __( 'Warnings', 'vip-workflows' ) }
					onClose={ () => setWarningsModal( null ) }
					actions={
						/* Weight follows consequence: retreating is the
						   tertiary, first, and continuing past the warnings
						   is the action this dialog exists to gate (primary,
						   last — rightmost). It used to be the inverse: a
						   bold button that did nothing, and the consequential
						   one styled to be overlooked. "Cancel", not "Close":
						   this is a dialog with choices, and it also keeps
						   the footer clear of the Modal X's own name. */
						<>
							<Button
								variant="tertiary"
								onClick={ () => setWarningsModal( null ) }
							>
								{ __( 'Cancel', 'vip-workflows' ) }
							</Button>
							<Button
								variant="primary"
								onClick={ handleIgnoreWarnings }
								isBusy={ transitioning }
								disabled={ transitioning }
							>
								{ __( 'Continue', 'vip-workflows' ) }
							</Button>
						</>
					}
				/>
			) }

			{ /* The assignee the transition is asking for — anchored to the
			     rail transition that asked. Dismissing it (Close, Escape,
			     click-outside) abandons the transition: nothing is written
			     until the move happens. */ }
			{ assignmentRequest && (
				<TransitionAssignmentPopover
					title={
						assignmentRequest.input.label ||
						assignmentRequest.transitionLabel ||
						__( 'Select assignee', 'vip-workflows' )
					}
					anchor={ assignmentRequest.anchor }
					assigneeType={
						assignmentRequest.input.assignee_type || 'user'
					}
					roleFilter={ assignmentRequest.input.filter?.roles || [] }
					initialValue={
						// Stored assignment values pass through
						// sanitize_text_field server-side, so a user id
						// comes back as a numeric string — coerce it to
						// match the id type the combobox's options use.
						null !== assignmentRequest.initialValue &&
						'user' ===
							( assignmentRequest.input.assignee_type || 'user' )
							? Number( assignmentRequest.initialValue )
							: assignmentRequest.initialValue
					}
					required={ !! assignmentRequest.input.required }
					notesLabel={ __( 'Notes (optional)', 'vip-workflows' ) }
					notesRequired={ false }
					onSubmit={ handleAssignmentSelect }
					onClose={ () => setAssignmentRequest( null ) }
				/>
			) }

			{ confirmDialog }
		</Stack>
	);
}
