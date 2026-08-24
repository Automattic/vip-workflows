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
 * The state itself is not the panel's. It lives in the `vip-workflow/editor`
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
	useRef,
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
	getAgentInterruptWarning,
	getOrphanedWorkflowRemoveConfirmation,
	getRemoveFromWorkflowConfirmation,
	getRemoveFromWorkflowLabel,
	getStatusChangeConfirmLabel,
	getStatusChangeConfirmTitle,
	getSwitchWorkflowConfirmLabel,
	getSwitchWorkflowConfirmTitle,
	getSwitchWorkflowConfirmation,
	getTransitionPublishConfirmLabel,
	getTransitionPublishConfirmTitle,
	getTransitionPublishWarning,
} from '../../entries/confirm-workflow-side-effect';
import { refreshPostEntity } from '../refresh-post-entity';
import {
	REQUIRED_METADATA_LOCK,
	useRequiredMetadataGate,
} from '../required-metadata';
import {
	TransitionAssignmentPopover,
	TransitionTextInputPopover,
} from './TransitionInputPopover';
import { ToolFailuresModal } from '../../common/ToolFailuresModal';
import { TransitionRail } from './TransitionRail';
import { WorkflowRow } from './WorkflowRow';
import { IdeationPanel } from './IdeationPanel';

// Loaded on demand. The history dialog is the editor's only DataViews consumer,
// and DataViews is bundled rather than externalized — keeping it out of the
// editor entry means the sidebar costs nothing extra for the readers who never
// open the trail.
const WorkflowHistoryModal = lazy( () => import( './WorkflowHistoryModal' ) );

/**
 * The kinds of capture input this sidebar can ask a writer for.
 *
 * `text` is here alongside `textarea` because sequences stored before the editor
 * settled on one name still carry it, and both are collected by the same
 * popover. Anything else — a kind added by a newer version, or by an extension
 * that ships its own authoring UI — has nothing here to render it, and is passed
 * over rather than allowed to block the move.
 */
const COLLECTABLE_INPUT_TYPES = [ 'textarea', 'text', 'assignment' ];

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
			workflowEnforcement: s.getWorkflowEnforcement(),
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
			// sidebar writes them through useEntityProp — an editor-store edit
			// that is not in the database until the post is saved. So this is
			// what tells a transition whether it depends on persisted meta.
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
	 * The transition currently asking for input, and how far through it we are.
	 *
	 * A transition captures a LIST of inputs, so this is a queue rather than a
	 * request: `pending` is what is still to be asked, `collected` is what has
	 * been answered so far, and the transition fires once the queue drains. One
	 * popover shows at a time — the one for `pending[0]` — because they anchor to
	 * the same rail button and stacking them would put two dialogs on one point.
	 *
	 * Dismissing any of them abandons the whole transition, including answers
	 * already given. That is the same promise the single popover made: nothing is
	 * written until the move happens, so backing out costs the post nothing.
	 */
	const [ inputQueue, setInputQueue ] = useState( null ); // { toStatus, pending, collected, transitionLabel, anchor }
	const [ showRefreshPrompt, setShowRefreshPrompt ] = useState( false ); // agent finished with unsaved edits open
	const [ actionError, setActionError ] = useState( null ); // every action failure — shown as a Notice, not a browser dialog

	/*
	 * Bumped after every transition attempt that reached the server. A
	 * transition re-runs its required checks server-side whatever the cache
	 * said, so fresh result rows exist after a success AND after a
	 * tool_check_failed refusal — the rail re-reads them on this signal so its
	 * indicators and the server's answer agree.
	 */
	const [ resultsVersion, setResultsVersion ] = useState( 0 );

	const { savePost } = useDispatch( editorStore );
	const {
		fetchWorkflowStatus,
		receiveWorkflowStatus,
		assignSequence,
		removeWorkflow,
	} = useDispatch( STORE_NAME );
	const registry = useRegistry();
	const [ confirm, confirmDialog ] = useConfirm();

	// Tracks whether we have observed an agent job pending in this session, so
	// we can react to the pending → finished edge.
	const wasAgentPendingRef = useRef( false );

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

		if ( inputQueue && ! offered( inputQueue.toStatus ) ) {
			setInputQueue( null );
		}
	}, [ transitions, inputQueue ] );

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

		setTransitioning( true );
		setActionError( null );

		try {
			await assignSequence( sequenceId );
		} catch ( err ) {
			setActionError(
				err.message || __( 'Failed to assign workflow', 'vip-workflow' )
			);
		} finally {
			setTransitioning( false );
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

		setTransitioning( true );
		setActionError( null );

		try {
			await removeWorkflow();
		} catch ( err ) {
			setActionError(
				err.message || __( 'Failed to remove workflow', 'vip-workflow' )
			);
		} finally {
			// The panel stays mounted through a removal now, so the busy state
			// it entered with has to be left behind: the picker it re-renders
			// into is the same component instance.
			setTransitioning( false );
		}
	};

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
		// - A required metadata field is read with get_post_meta(). The sidebar
		//   writes those fields through useEntityProp, which edits the editor
		//   store and nothing else until a save. Without this, an author types
		//   "Politics" into Section, clicks the transition, and is refused with
		//   "Section is required and has no value" while the value sits on
		//   screen in front of them — and clicking again does the same thing.
		//   A required-field refusal is precisely the case where the fix IS an
		//   unsaved meta edit, so the edit has to go first.
		//
		// Still narrowed rather than "save on every dirty transition": a
		// transition that depends on neither leaves the author's unsaved work
		// exactly where they left it.
		const targetTransition = transitions.find( ( t ) => t.to === toStatus );
		const targetIsAiStage =
			!! targetTransition?.status_info?.agent?.ability_id;
		const needsPersistedPost = targetIsAiStage || hasRequiredMetadata;
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
									'Could not save the post before starting the AI stage. Please try again.',
									'vip-workflow'
							  )
							: __(
									'Could not save the post before the transition. Please try again.',
									'vip-workflow'
							  ),
					};
				}

				return apiFetch( {
					path: `/vip-workflow/v1/workflow/post/${ postId }/transition`,
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
				setResultsVersion( ( v ) => v + 1 );

				refreshPost();
			} )
			.catch( ( err ) => {
				setTransitioning( false );
				setTransitioningTo( null );
				setResultsVersion( ( v ) => v + 1 );

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
						err.message || __( 'Transition failed', 'vip-workflow' )
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

	/*
	 * Take one input's answer and move to the next, or go once nothing is left.
	 *
	 * Every answer is merged into one flat `meta_key => value` map, which is what
	 * the server has always been handed — it is why two inputs on one transition
	 * must not share a storage key, and why the editor and the write gate both
	 * refuse a sequence where they do.
	 */
	// The input being asked for right now, or null when nothing is.
	const currentInput = inputQueue?.pending[ 0 ] || null;

	const advanceInputQueue = ( collectedFromInput ) => {
		if ( ! inputQueue ) {
			return;
		}

		const collected = { ...inputQueue.collected, ...collectedFromInput };
		const pending = inputQueue.pending.slice( 1 );

		if ( pending.length === 0 ) {
			setInputQueue( null );
			handleTransition( inputQueue.toStatus, false, collected );
			return;
		}

		setInputQueue( { ...inputQueue, pending, collected } );
	};

	// Handle text input submission.
	const handleTextInput = ( value ) => {
		const input = inputQueue?.pending[ 0 ];

		if ( ! input ) {
			return;
		}

		const noteName = input.note_name || 'Note';
		const noteId = input.note_id;

		if ( ! noteId ) {
			console.error(
				'Missing note_id in transition input configuration',
				input
			);
			return;
		}

		// Generate meta key: wfp_{note_id}_{slugified_note_name}
		const slug = noteName
			.toLowerCase()
			.replace( /[^a-z0-9]+/g, '_' )
			.replace( /(^_|_$)/g, '' );
		const metaKey = `wfp_${ noteId }_${ slug }`;

		advanceInputQueue( {
			[ metaKey ]: value,
			[ `${ metaKey }__name` ]: noteName,
		} );
	};

	// Handle assignment selection (user, role, etc.)
	const handleAssignmentSelect = ( selectedValue, notes = '' ) => {
		const input = inputQueue?.pending[ 0 ];

		if ( ! input ) {
			return;
		}

		const metaKey = input.meta_key;
		if ( ! metaKey ) {
			console.error(
				'Missing meta_key in assignment input configuration',
				input
			);
			return;
		}

		const inputData = {
			[ metaKey ]: selectedValue,
		};

		// Add notes if provided
		if ( notes ) {
			const notesKey = `${ metaKey }_notes`;
			inputData[ notesKey ] = notes;
			inputData[ `${ notesKey }__name` ] = __( 'Notes', 'vip-workflow' );
		}

		advanceInputQueue( inputData );
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
		 * What this transition asks for, in the order the author arranged it.
		 *
		 * An input of a kind this build has no popover for is dropped rather
		 * than blocking the move: it can only arrive from a config written by
		 * a newer version or an out-of-tree extension, and stopping the writer
		 * dead on a field nothing can render would strand the post. The move
		 * still happens; what that input would have captured is simply not.
		 */
		const pending = ( transition.inputs || [] ).filter( ( input ) =>
			COLLECTABLE_INPUT_TYPES.includes( input?.type )
		);

		if ( pending.length === 0 ) {
			handleTransition( transition.to );
			return;
		}

		setInputQueue( {
			toStatus: transition.to,
			pending,
			collected: {},
			transitionLabel: transition.label,
			anchor,
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
			path: `/vip-workflow/v1/workflow/post/${ postId }/agent-revert`,
			method: 'POST',
		} )
			.then( ( response ) => {
				receiveWorkflowStatus( response );
				setTransitioning( false );
				setResultsVersion( ( v ) => v + 1 );
				refreshPost();
			} )
			.catch( ( err ) => {
				setActionError(
					err.message ||
						__( 'Failed to move the post back', 'vip-workflow' )
				);
				setTransitioning( false );
			} );
	};

	const handleClaim = () => {
		setTransitioning( true );
		setActionError( null );
		apiFetch( {
			path: `/vip-workflow/v1/workflow/post/${ postId }/claim`,
			method: 'POST',
		} )
			.then( () => {
				fetchWorkflowStatus();
				setTransitioning( false );
			} )
			.catch( ( err ) => {
				setActionError(
					err.message || __( 'Failed to claim post', 'vip-workflow' )
				);
				setTransitioning( false );
			} );
	};

	const handleUnclaim = () => {
		setTransitioning( true );
		setActionError( null );
		apiFetch( {
			path: `/vip-workflow/v1/workflow/post/${ postId }/unclaim`,
			method: 'DELETE',
		} )
			.then( () => {
				fetchWorkflowStatus();
				setTransitioning( false );
			} )
			.catch( ( err ) => {
				setActionError(
					err.message ||
						__( 'Failed to release post', 'vip-workflow' )
				);
				setTransitioning( false );
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
			<Stack className="vip-workflow-panel" direction="column" gap="lg">
				<Stack
					className="vip-workflow-loading"
					direction="row"
					align="center"
					gap="sm"
				>
					<Spinner />
					{ __( 'Loading workflow…', 'vip-workflow' ) }
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
			<Stack className="vip-workflow-panel" direction="column" gap="lg">
				<Stack
					className="vip-workflow-panel__empty"
					direction="column"
					align="center"
					gap="md"
				>
					<Text variant="body-md">
						{ __(
							'This post belongs to a workflow that no longer exists, so its status cannot be changed.',
							'vip-workflow'
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
						className="vip-workflow-panel__action-error"
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
					className="vip-workflow-panel"
					direction="column"
					gap="lg"
				>
					<Text
						variant="body-md"
						className="vip-workflow-panel__empty"
					>
						{ __(
							'No workflow available for this post type.',
							'vip-workflow'
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
			<Stack className="vip-workflow-panel" direction="column" gap="md">
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
						className="vip-workflow-panel__action-error"
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
		<Stack className="vip-workflow-panel" direction="column" gap="lg">
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
					className="vip-workflow-panel__assigned"
					direction="row"
					align="center"
					wrap="wrap"
				>
					<span className="vip-workflow-panel__assigned-label">
						{ __( 'Assigned to:', 'vip-workflow' ) }
					</span>
					{ /* The same cell the lists draw an author with, so the
					     person waiting on this post looks like the same person
					     in the sidebar and in My Queue. "(you)" is the trailing
					     slot: it is something this reader's context adds about
					     the assignee, not part of their name. */ }
					<AuthorCell
						actor={ assignedTo }
						className="vip-workflow-panel__assigned-name"
					>
						{ assignedTo.is_current && (
							<Text
								variant="body-md"
								className="vip-workflow-panel__you"
							>
								{ '(' + __( 'you', 'vip-workflow' ) + ')' }
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
							{ __( 'Release', 'vip-workflow' ) }
						</Button>
					) }
				</Stack>
			) }

			{ /* Claim button - server determines eligibility based on stage + role */ }
			{ canClaim && (
				<Stack className="vip-workflow-panel__claim" direction="column">
					<Button
						variant="secondary"
						size="compact"
						onClick={ handleClaim }
						isBusy={ transitioning }
						disabled={ transitioning }
					>
						{ __( 'Claim', 'vip-workflow' ) }
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
				<div className="vip-workflow-panel__agent-failed">
					<Text
						variant="body-md"
						render={ <p /> }
						className="vip-workflow-panel__agent-failed-title"
					>
						{ __(
							'The AI agent could not finish.',
							'vip-workflow'
						) }
					</Text>
					{ agentJob?.error && (
						<Text
							variant="body-sm"
							render={ <p /> }
							className="vip-workflow-panel__agent-failed-error"
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
								__( 'Go back to %s', 'vip-workflow' ),
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
					className="vip-workflow-panel__agent-refresh"
					actions={ [
						{
							label: __( 'Reload', 'vip-workflow' ),
							onClick: () => window.location.reload(),
							variant: 'primary',
						},
					] }
				>
					{ __(
						'The AI agent updated this post. Reload to see its changes — this discards your unsaved edits.',
						'vip-workflow'
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
					className="vip-workflow-panel__action-error"
				>
					{ actionError }
				</DismissibleNotice>
			) }

			{ /* The transition rail: the current stage, every way out of it,
			     and the checks each way out depends on, as one drawing. An AI
			     stage's exits are withheld while its agent works AND while it
			     sits failed with a go-back available
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
				postId={ postId }
				current={ current }
				transitions={ transitions }
				allStatuses={ allStatuses }
				agentPending={ !! agentPending }
				agentFailed={ agentFailed }
				agentLastRun={ workflow?.agent_last_run || null }
				transitioning={ transitioning }
				transitioningTo={ transitioningTo }
				onTransition={ handleTransitionClick }
				resultsVersion={ resultsVersion }
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
				className="vip-workflow-panel__footer-actions"
				direction="column"
				gap="sm"
			>
				<Button
					variant="secondary"
					onClick={ () => setHistoryOpen( true ) }
				>
					{ __( 'Show history', 'vip-workflow' ) }
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
							title={ __( 'Workflow History', 'vip-workflow' ) }
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
					title={ __( 'Transition Blocked', 'vip-workflow' ) }
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
							? __( 'Required fields are empty', 'vip-workflow' )
							: undefined
					}
					onClose={ () => setToolFailures( null ) }
				/>
			) }

			{ /* Warnings Confirmation Modal */ }
			{ warningsModal && (
				<ToolFailuresModal
					title={ __( 'Warnings Detected', 'vip-workflow' ) }
					message={ __(
						'The following warnings were detected:',
						'vip-workflow'
					) }
					softWarnings={ warningsModal.warnings }
					// The shared default reads "(not blocking)", which is wrong
					// here: this dialog stands between the author and the
					// transition until they choose to continue past it.
					softTitle={ __( 'Warnings', 'vip-workflow' ) }
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
								{ __( 'Cancel', 'vip-workflow' ) }
							</Button>
							<Button
								variant="primary"
								onClick={ handleIgnoreWarnings }
								isBusy={ transitioning }
								disabled={ transitioning }
							>
								{ __( 'Continue', 'vip-workflow' ) }
							</Button>
						</>
					}
				/>
			) }

			{ /* Whatever the transition is asking for right now — anchored to
			     the rail transition that asked, one input at a time. Dismissing
			     any of them (Close, Escape, click-outside) abandons the whole
			     transition, answers already given included: nothing is written
			     until the move happens. */ }
			{ currentInput?.type === 'assignment' ? (
				<TransitionAssignmentPopover
					title={
						currentInput.label ||
						inputQueue.transitionLabel ||
						__( 'Select assignee', 'vip-workflow' )
					}
					anchor={ inputQueue.anchor }
					assigneeType={ currentInput.assignee_type || 'user' }
					roleFilter={ currentInput.filter?.roles || [] }
					notesLabel={ __( 'Notes (optional)', 'vip-workflow' ) }
					notesRequired={ false }
					onSubmit={ handleAssignmentSelect }
					onClose={ () => setInputQueue( null ) }
				/>
			) : (
				currentInput && (
					<TransitionTextInputPopover
						// Keyed by where we are in the queue, so moving to the
						// next input remounts the popover instead of
						// re-labelling the one on screen — which would leave
						// the previous answer sitting in the box as though it
						// were this question's. The position rather than the
						// input's own id: `note_id` is optional in stored
						// config, and two id-less notes in one queue would
						// share `undefined` and so share the box.
						key={ inputQueue.pending.length }
						title={ inputQueue.transitionLabel }
						anchor={ inputQueue.anchor }
						label={
							currentInput.note_name ||
							__( 'Note', 'vip-workflow' )
						}
						inputType="textarea"
						required={ currentInput.required || false }
						onSubmit={ handleTextInput }
						onClose={ () => setInputQueue( null ) }
					/>
				)
			) }

			{ confirmDialog }
		</Stack>
	);
}
