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
	// same move continued.
	const sourceRef = useRef( 'panel' );

	const { savePost } = useDispatch( editorStore );
	const { createErrorNotice, removeNotice } = useDispatch( noticesStore );
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
		const targetTransition = transitions.find( ( t ) => t.to === toStatus );
		const targetIsAiStage =
			!! targetTransition?.status_info?.agent?.ability_id;
		const editor = registry.select( editorStore );
		const wasDirty = editor.isEditedPostDirty();
		const ensureSaved = wasDirty ? savePost() : Promise.resolve();

		ensureSaved
			.then( () => {
				// savePost() resolves even when the save request fails (the error
				// is recorded in the editor store). If the post is still dirty the
				// content never persisted, so bail rather than send a transition
				// the server will judge against a row that is not what the author
				// is looking at.
				if (
					wasDirty &&
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
