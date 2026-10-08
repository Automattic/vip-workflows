/**
 * Transition Flow — everything that happens between pressing a transition and
 * the post arriving at its new stage.
 *
 * Two surfaces start moves: the transition rail in the Workflow sidebar, and
 * the split button that stands in the editor header. A move can stop to ask
 * something on the way — whether to interrupt a running agent, whether to take
 * the post live, who to assign — and can come back refused or with warnings to
 * acknowledge. None of that may belong to the surface that was pressed. The
 * sidebar only exists while it is open, and the header's rail sits in a
 * dropdown that closes the moment focus leaves it, so a dialog owned by either
 * would be unmounted mid-question.
 *
 * So this component is mounted once, at the plugin root beside the save guard,
 * and owns the whole flow. Surfaces hand it a request through the editor store
 * (`requestTransition`) and read the move in flight back out of it
 * (`getTransitioningTo`), which is what keeps the rail and the header button
 * disabled together while either one's move runs.
 *
 * Following a move into an AI stage is part of the same job, for the same
 * reason: the header can start one with the sidebar closed, so the poll that
 * waits for the agent and the reload that brings its rewrite into the editor
 * live here too, not in the sidebar panel.
 *
 * @package
 */

import { useEffect, useRef, useState } from '@wordpress/element';
import { Button } from '@wordpress/components';
import { useSelect, useDispatch, useRegistry } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { STORE_NAME } from '../store';
import { useConfirm } from '../../common/use-confirm';
import {
	getAgentInterruptWarning,
	getStatusChangeConfirmLabel,
	getStatusChangeConfirmTitle,
	getTransitionPublishConfirmLabel,
	getTransitionPublishConfirmTitle,
	getTransitionPublishWarning,
} from '../../entries/confirm-workflow-side-effect';
import { refreshPostEntity } from '../refresh-post-entity';
import {
	REQUIRED_METADATA_LOCK,
	useRequiredMetadataGate,
} from '../required-metadata';
import { TransitionAssignmentPopover } from './TransitionInputPopover';
import { ToolFailuresModal } from '../../common/ToolFailuresModal';

/**
 * The id a refusal reported from the header is posted under, so a second
 * refusal replaces the first rather than stacking beneath it.
 *
 * @type {string}
 */
const HEADER_NOTICE_ID = 'vip-workflows-transition-refused';

/**
 * The id of the notice offering a reload after a stage agent rewrote the post
 * under unsaved edits.
 *
 * @type {string}
 */
const AGENT_REFRESH_NOTICE_ID = 'vip-workflows-agent-refresh';

/**
 * Resolves once core is not in the middle of saving the post.
 *
 * savePost() returns at once, without saving, while another save is in flight
 * — the Save draft pressed a moment ago, the autosave tick — and the post
 * still reads as dirty until that one lands. Asked then, the flow would take a
 * save that is about to succeed for one that failed.
 *
 * @param {Object} registry Data registry.
 * @return {Promise<void>} Settles when no save is in flight.
 */
function whenSaveSettles( registry ) {
	const { isSavingPost } = registry.select( editorStore );

	return new Promise( ( resolve ) => {
		if ( ! isSavingPost() ) {
			resolve();
			return;
		}

		const unsubscribe = registry.subscribe( () => {
			if ( ! isSavingPost() ) {
				unsubscribe();
				resolve();
			}
		} );
	} );
}

/**
 * Runs the transitions the rail and the header button ask for.
 *
 * @return {JSX.Element} The flow's dialogs, whichever are open.
 */
export function TransitionFlow() {
	const { postId, postType, savedStatus, workflow, request } = useSelect(
		( select ) => {
			const s = select( STORE_NAME );
			return {
				postId: s.getPostId(),
				postType: s.getPostType(),
				// The committed status, for the publish confirm: the server
				// decides the boundary crossing against what is persisted, so
				// an unsaved status edit must not change whether we ask.
				savedStatus:
					select( editorStore ).getCurrentPostAttribute( 'status' ),
				workflow: s.getWorkflowStatus(),
				request: s.getTransitionRequest(),
			};
		},
		[]
	);

	// The stage's ways out with the required-metadata locks re-decided against
	// the editor's fields — the same list the rail and the header button draw,
	// so a move they offer is a move this flow will run. See
	// required-metadata.js.
	const { transitions } = useRequiredMetadataGate();

	const [ toolFailures, setToolFailures ] = useState( null ); // blocked transition details
	const [ warningsModal, setWarningsModal ] = useState( null ); // { toStatus, warnings, inputData, comment }
	/*
	 * The transition currently asking for an assignee.
	 *
	 * A transition carries at most one assignment — the write gate refuses two —
	 * so this is one request, not a queue. Dismissing its popover abandons the
	 * transition: nothing is written until the move happens, so backing out
	 * costs the post nothing.
	 */
	const [ assignmentRequest, setAssignmentRequest ] = useState( null ); // { toStatus, input, transitionLabel, anchor, initialValue }

	// Which surface asked for the move being run, so its refusal is reported
	// where the author is looking. Survives the warnings re-fire, which is the
	// same move continued. 'header' is the editor's own notice area, which is
	// on screen whatever sidebar is open — so it is also where a refusal goes
	// when no surface asked (the agent-held warnings below).
	const sourceRef = useRef( 'panel' );

	// Whether an agent job has been seen pending in this session, so the
	// pending → finished edge can be acted on.
	const wasAgentPendingRef = useRef( false );

	// Set once a stage agent has finished under this editor and no reload
	// followed — unsaved edits were in the way, or its route is being held.
	// Until a reload the database holds what the agent wrote and the editor an
	// older copy, so a move must not save that copy back over it.
	const agentOutranEditorRef = useRef( false );

	const { savePost } = useDispatch( editorStore );
	const { createErrorNotice, createInfoNotice, removeNotice } =
		useDispatch( noticesStore );
	const {
		fetchWorkflowStatus,
		receiveWorkflowStatus,
		clearTransitionRequest,
		setTransitioningTo,
		setTransitionError,
	} = useDispatch( STORE_NAME );
	const registry = useRegistry();
	const [ confirm, confirmDialog ] = useConfirm();

	const agentIsPending = !! workflow?.agent_pending;
	const agentJobState = workflow?.agent_job;
	const transitioning = useSelect(
		( select ) => select( STORE_NAME ).isTransitioning(),
		[]
	);

	const reportError = ( message ) => {
		if ( 'header' === sourceRef.current ) {
			createErrorNotice( message, {
				id: HEADER_NOTICE_ID,
				isDismissible: true,
			} );
			return;
		}
		setTransitionError( message );
	};

	const clearErrors = () => {
		setTransitionError( null );
		removeNotice( HEADER_NOTICE_ID );
	};

	// While an agent is working, poll so every surface picks up the outcome
	// (transition away, or fail-in-place) without a manual reload.
	useEffect( () => {
		if ( ! agentIsPending ) {
			return;
		}

		const interval = setInterval( () => fetchWorkflowStatus(), 5000 );
		return () => clearInterval( interval );
	}, [ agentIsPending, fetchWorkflowStatus ] );

	// When a stage agent finishes, the post it rewrote lives in the database but
	// this open editor still shows the pre-agent content. React to the pending →
	// finished edge: auto-reload when the editor is clean (nothing to lose), or
	// offer a reload when there are unsaved edits so we never discard the
	// user's in-progress work without asking. The offer is an editor notice
	// rather than something drawn in the sidebar, which may not be open.
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
			// A held route is a finished run: the agent wrote before it was
			// stopped, and Continue must not save the editor's copy over it.
			if ( 'warnings_pending' === agentJobState.status ) {
				agentOutranEditorRef.current = true;
			}
			return;
		}

		// The agent finished and routed the post onward. Pull its result in.
		if ( registry.select( editorStore ).isEditedPostDirty() ) {
			// A: let the user choose (keeps edits).
			agentOutranEditorRef.current = true;
			createInfoNotice(
				__(
					'The AI agent updated this post. Reload to see its changes — this discards your unsaved edits.',
					'vip-workflows'
				),
				{
					id: AGENT_REFRESH_NOTICE_ID,
					isDismissible: true,
					actions: [
						{
							label: __( 'Reload', 'vip-workflows' ),
							onClick: () => window.location.reload(),
							variant: 'primary',
						},
					],
				}
			);
		} else {
			// B: clean editor — reload discards nothing. Held just long
			// enough for the rail's outcome flash and its announcement to
			// land first; nobody clicked, so the flash is the only thing
			// saying which way the agent routed.
			const timer = setTimeout( () => window.location.reload(), 800 );
			return () => clearTimeout( timer );
		}
	}, [
		agentIsPending,
		workflow,
		agentJobState,
		registry,
		createInfoNotice,
	] );

	// A stage agent cannot decide whether to proceed past a soft warning. Its
	// held route uses the same confirmation dialog as a human-started
	// transition, then retries the exact destination as the current person.
	useEffect( () => {
		if ( agentJobState?.status !== 'warnings_pending' ) {
			return;
		}

		// Nobody pressed anything for this dialog to open, and the sidebar may
		// be closed, so a refusal of its Continue goes to the editor notice.
		sourceRef.current = 'header';

		setWarningsModal( {
			toStatus: agentJobState.to_status,
			warnings: agentJobState.soft_warnings,
			inputData: null,
			comment: agentJobState.comment,
		} );
	}, [ agentJobState ] );

	// A workflow refresh can withdraw the transition an open input popover
	// belongs to (another user moved the post, an agent finished, polling
	// re-read the stage). Drop a stored request whose destination is no longer
	// offered: committing it would fire a move the current stage does not
	// declare — and the request also holds `anchor`, a raw DOM node the
	// Popover uses verbatim (no isConnected guard upstream), so a re-key must
	// never leave a popover anchored to a detached node.
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
		const editor = registry.select( editorStore );

		// Core can point the editor at another entity in place — "Edit
		// original" on a synced pattern, "Edit template" — while this plugin
		// stays mounted for the post the page was loaded with. Everything
		// below reads and saves the editor's current post, so a move run from
		// there would save the pattern and send on a post nobody saved.
		if ( editor.getCurrentPostId() !== postId ) {
			reportError(
				__(
					'Go back to the post before moving it through its workflow.',
					'vip-workflows'
				)
			);
			return;
		}

		setTransitioningTo( toStatus );
		clearErrors();
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

		// A move is judged, and acted on, against the *persisted* post: an AI
		// stage runs its agent against the database row, a required metadata
		// field is read with get_post_meta(), and the next person in the
		// workflow opens what was saved. The author's unsaved edits are only
		// in the editor store. So a dirty post is saved first, every time —
		// the header button stands where Publish did, and pressing it carries
		// the same promise that the work on screen is the work that moves on.
		// "Saved" has to mean it, though: a save core has in flight is waited
		// out rather than raced, and one core has locked is not forced.
		const targetTransition = transitions.find( ( t ) => t.to === toStatus );
		const targetIsAiStage =
			!! targetTransition?.status_info?.agent?.ability_id;
		let wasDirty = false;

		whenSaveSettles( registry )
			.then( () => {
				// The one exception to saving first: an editor a stage agent
				// has outrun holds the older copy, and saving it would undo
				// the agent's work without a word. The move goes on what the
				// database holds; the reload notice settles the rest.
				wasDirty =
					! agentOutranEditorRef.current &&
					editor.isEditedPostDirty();

				if ( ! wasDirty ) {
					return;
				}

				// Core's own save controls stand down while saving is locked
				// — an upload still in flight, a plugin's pre-publish check —
				// but savePost() itself never asks.
				if ( editor.isPostSavingLocked() ) {
					throw {
						code: 'save_locked',
						message: __(
							'The post cannot be saved yet, so it was not moved. Wait for any upload to finish, then try again.',
							'vip-workflows'
						),
					};
				}

				return savePost();
			} )
			.then( () => {
				// savePost() resolves even when the save request fails (the error
				// is recorded in the editor store). If the post is still dirty the
				// content never persisted, so bail rather than send a transition
				// the server will judge against a row that is not what the author
				// is looking at.
				if ( wasDirty && editor.isEditedPostDirty() ) {
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
					setTransitioningTo( null );
					return;
				}

				// A transition that leaves the user's role with no permitted
				// transitions is not a lockout: they keep `edit_post` and stay
				// in the editor with their unsaved work. The surfaces simply
				// have no move to offer at the new stage.
				//
				// The response IS a status payload, so it is adopted rather
				// than re-read; adopting it also retires any poll still in
				// flight, which would otherwise land afterwards carrying the
				// stage the post has just left.
				receiveWorkflowStatus( response );
				setTransitioningTo( null );
				setWarningsModal( null );

				// The write changed the post server-side, so the editor chrome
				// (Save button, Summary status) has to re-read the record.
				refreshPostEntity( registry, postType, postId );
			} )
			.catch( ( err ) => {
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
						// The lock this refusal enforces may be newer than the
						// editor's last status read — a sequence that gained a
						// required field since the editor loaded. Re-read so the
						// surfaces draw the move as held.
						fetchWorkflowStatus();
					}
				} else {
					reportError(
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

	// `anchor` is the button that was pressed: a transition that requires
	// input opens a popover anchored to it rather than a full-screen modal.
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
		// no status, and a live post seated at a draft-region stage (the
		// boundary anomaly) is already public, so there is no news to confirm.
		// A scheduled post is NOT exempt — its stage stayed put, so the
		// crossing still happens and publishes it now, ahead of its schedule.
		//
		// This asks about the status only. The save that precedes every move
		// (handleTransition) is not covered: on a live post it puts the
		// editor's unsaved edits live without a question of its own.
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
		 * An assignment is the only input the editor collects. Anything else a
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

	// Take up a request the moment a surface makes one. It is cleared before
	// it runs, so a re-render while a confirm is open cannot start it twice.
	useEffect( () => {
		if ( ! request ) {
			return;
		}

		clearTransitionRequest();

		// One move at a time. The surfaces disable themselves while one runs,
		// but the rail leaves the button in flight pressable, and a second run
		// would race the first one's save and its request.
		if ( transitioning ) {
			return;
		}

		sourceRef.current = request.source;
		handleTransitionClick( request.transition, request.anchor );
		// Only a new request starts a move; the handler is rebuilt every
		// render and reads the current state when it runs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ request ] );

	return (
		<>
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
						   last — rightmost). "Cancel", not "Close": this is a
						   dialog with choices, and it also keeps the footer
						   clear of the Modal X's own name. */
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
			     button that asked. Dismissing it (Close, Escape,
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
		</>
	);
}
