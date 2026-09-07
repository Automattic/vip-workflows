/**
 * WorkflowSaveGuard — the editor-side half of the workflow side-effect guard.
 *
 * A status change on a workflow-managed post is never just a status change: the
 * workflow re-seats the post at the target region's entry stage and cancels any
 * stage agent running there, and for a non-bypass user a change across the
 * publish boundary is refused outright at the save layer
 * (`PublishBoundaryGuard`). This component says so BEFORE the write.
 *
 * It renders no chrome of its own on purpose. It used to live inside
 * `WorkflowStatusPanel`, which is mounted by a `PluginDocumentSettingPanel` —
 * and the core `PanelBody` that panel is built on renders
 * `isOpened && children`, so collapsing the panel,
 * closing the settings sidebar, switching the sidebar to the Block tab, or
 * disabling the panel in Preferences all unmounted the panel and, with it, ran
 * the cleanup that REMOVED the `editor.preSavePost` filter. The guard has to
 * outlive every one of those, so it is mounted unconditionally from
 * `src/editor/index.js` instead.
 *
 * It also reads the workflow state on demand, inside the filter, rather than
 * mirroring a copy in React state: `editor.preSavePost` is awaited, the request
 * only happens on a save that actually changes the status, and a freshly read
 * region can never be stale after an in-editor transition.
 *
 * @package
 */

import { useCallback, useEffect, useRef } from '@wordpress/element';
import { useDispatch, useRegistry, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as noticesStore } from '@wordpress/notices';
import { addFilter, removeFilter } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

import {
	DECISION_SILENT,
	DECISION_VETO,
	evaluateStatusChange,
	getEntryStageLabels,
	getOrphanedWorkflowMessage,
	getOrphanedWorkflowRemoveConfirmation,
	getPublishVetoMessage,
	getRemoveFromWorkflowConfirmation,
	getRemoveFromWorkflowLabel,
	getStatusChangeConfirmLabel,
	getStatusChangeConfirmTitle,
	getStatusChangeWarning,
} from '../../entries/confirm-workflow-side-effect';
import { useConfirm } from '../../common/use-confirm';
import { STORE_NAME } from '../store';

/**
 * Hook namespace for the side-effect guard's `editor.preSavePost` filter.
 *
 * One guard is mounted per editor, so a fixed namespace is enough — and it also
 * means a hot-reloaded guard replaces its own filter instead of stacking a
 * second one.
 *
 * @type {string}
 */
const GUARD_HOOK_NAMESPACE = 'vip-workflows/workflow-save-guard';

/**
 * Notice id for the publish veto, so a second refusal replaces the first
 * instead of stacking.
 *
 * @type {string}
 */
const VETO_NOTICE_ID = 'vip-workflows/publish-veto';

export function WorkflowSaveGuard() {
	const postId = useSelect(
		( select ) => select( STORE_NAME ).getPostId(),
		[]
	);

	const { editPost } = useDispatch( editorStore );
	const { removeWorkflow } = useDispatch( STORE_NAME );
	const { createErrorNotice, removeNotice } = useDispatch( noticesStore );
	const registry = useRegistry();
	const [ confirm, confirmDialog ] = useConfirm();

	// The filter is registered once and lives as long as the editor, so it reads
	// the post id from a ref rather than closing over a value that can change.
	const postIdRef = useRef( postId );
	useEffect( () => {
		postIdRef.current = postId;
	}, [ postId ] );

	// The audited escape offered alongside the veto: take the post out of the
	// workflow so it can then be published as an ordinary post. Reachable from
	// the notice, which survives the sidebar being closed.
	const removeFromWorkflow = useCallback(
		async ( workflowName ) => {
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

			// The same removal the sidebar panel's footer performs, because it
			// is literally the same call: the store deletes the workflow,
			// re-reads the post's state and refreshes the post entity. Setting
			// a couple of store flags here instead is what left the sidebar
			// panel — which held its own copy of the workflow — drawing the
			// sequence this notice had just deleted until the page was
			// reloaded.
			try {
				await removeWorkflow();
			} catch ( err ) {
				createErrorNotice(
					err.message ||
						__(
							'Failed to remove this post from its workflow',
							'vip-workflows'
						),
					{ type: 'snackbar' }
				);
				return;
			}

			removeNotice( VETO_NOTICE_ID );
		},
		[ confirm, createErrorNotice, removeNotice, removeWorkflow ]
	);

	// Guard the editor's own status controls.
	//
	// The seam is `editor.preSavePost`, the async filter core awaits between
	// snapshotting the pending edits and sending them (`savePost` in
	// @wordpress/editor). It is the only point that runs before the request on
	// every editor status path: Publish, Schedule and "Switch to draft" each
	// dispatch `editPost()` and `savePost()` back to back inside a single click
	// handler, so a React effect watching the edited status necessarily runs
	// after the write is already in flight. The Summary panel's Status dropdown
	// only edits and saves nothing on its own — it is caught here too, when the
	// user saves.
	//
	// Declining a warn drops the status from this save and puts the editor's own
	// edit back, leaving the rest of the save alone. A veto refuses the whole
	// save, exactly as the server-side veto behind it would.
	//
	// It deliberately does NOT fake editor dirtiness or touch `beforeunload`: a
	// workflow write makes the open copy stale, not dirty, and faking dirtiness
	// caused a P1 on this branch.
	useEffect( () => {
		const guardSave = async ( edits, options ) => {
			// Autosaves never write an edited status — core deliberately holds
			// it back (see `saveEntityRecord`'s autosave payload) — so there is
			// no status change on that path to guard.
			if ( options?.isAutosave ) {
				return edits;
			}

			// `edits` carries only pending, non-transient edits, so a `status`
			// key is present exactly when this save would write a status
			// different from the persisted one.
			if ( ! edits?.status || ! postIdRef.current ) {
				return edits;
			}

			// Read the workflow state now rather than mirroring it: this runs
			// only on a save that changes the status, and an in-editor
			// transition just before it would otherwise leave a stale region.
			let workflow;
			try {
				workflow = await apiFetch( {
					path: `/vip-workflows/v1/workflow/post/${ postIdRef.current }/status`,
				} );
			} catch {
				// The guard could not answer. Fail CLOSED for a workflow post,
				// but a failed request cannot tell us whether this even IS one —
				// so let the save through and rely on the server-side veto,
				// which is the authority either way.
				// eslint-disable-next-line no-console
				console.error(
					'VIP Workflows: could not read the workflow status before saving; the server-side guard remains in force.'
				);
				return edits;
			}

			// `orphaned` is a post whose sequence row was deleted out from under
			// it. It has no renderable workflow — no stages, no transitions, so
			// `has_workflow` is false — but it is still workflow-MANAGED as far as
			// the save layer is concerned: crosses_publish_boundary() reads the
			// sequence meta, which is still there, and refuses every status
			// change. Skipping the guard here is what walked the user into that
			// refusal with no explanation and no way out.
			if ( ! workflow?.has_workflow && ! workflow?.orphaned ) {
				return edits;
			}

			if ( ! workflow.guard ) {
				// The status endpoint owes every workflow-managed post a guard
				// object. Its absence is a data-integrity condition, so say so
				// loudly — and then fail CLOSED by evaluating with no region,
				// the same answer the server predicate gives on corrupt data.
				// eslint-disable-next-line no-console
				console.error(
					'VIP Workflows: the post status endpoint returned no guard payload for a workflow-managed post.'
				);
			}

			const decision = evaluateStatusChange( {
				currentRegion: workflow.guard?.current_region,
				targetStatus: edits.status,
				canBypass: !! workflow.guard?.can_bypass,
			} );

			if ( decision === DECISION_SILENT ) {
				return edits;
			}

			// Take the status back out of both the pending save and the editor.
			// `editPost` clears an edit that matches the persisted value, so
			// this leaves the post with no status change pending rather than
			// trading one pending edit for another.
			const restoreEditorStatus = () => {
				editPost( {
					status: registry.select( editorStore ).getCurrentPost()
						.status,
				} );
			};

			const workflowName = workflow.sequence?.name;

			if ( decision === DECISION_VETO ) {
				const title = registry
					.select( editorStore )
					.getEditedPostAttribute( 'title' );

				// An orphaned post is refused for a different reason and has a
				// different way out — there is no workflow left to move it
				// through, and no name to call it by.
				const message = workflow.orphaned
					? getOrphanedWorkflowMessage( { title } )
					: getPublishVetoMessage( { title, workflowName } );

				restoreEditorStatus();

				// The message is a dead end without the way through, so the
				// audited escape rides along with it — in a notice rather than
				// in the sidebar, so it is reachable with the sidebar closed.
				createErrorNotice( message, {
					id: VETO_NOTICE_ID,
					isDismissible: true,
					actions: [
						{
							label: getRemoveFromWorkflowLabel(),
							onClick: () => removeFromWorkflow( workflowName ),
						},
					],
				} );

				// Refuse the save outright, the way the server veto behind this
				// does.
				throw new Error( message );
			}

			// The warn copy names the stage the change would land on, so it needs
			// the sequence's stages — and it already has them: the status
			// endpoint answers `all_statuses` alongside the guard payload, so
			// resolving the checkpoint costs no second request.
			//
			// `stageRegion` is the region the post's STAGE declares, which is not
			// the guard's `current_region`: boundary_region() reports `publish`
			// for any live post whatever its stage says, and the reseat compares
			// the stage. Empty for an orphaned post (no stages left) and for a
			// stage the sequence no longer defines — both cases where nothing
			// re-seats, and the copy says so.
			const stage = ( workflow.all_statuses || [] ).find(
				( candidate ) => candidate.key === workflow.current?.key
			);

			const proceed = await confirm(
				getStatusChangeWarning( {
					currentRegion: workflow.guard?.current_region,
					stageRegion: stage?.status,
					targetStatus: edits.status,
					entryStageLabels: getEntryStageLabels(
						workflow.all_statuses
					),
					agentPending: !! workflow.guard?.agent_pending,
				} ),
				{
					title: getStatusChangeConfirmTitle(),
					confirmLabel: getStatusChangeConfirmLabel(),
				}
			);

			if ( proceed ) {
				return edits;
			}

			restoreEditorStatus();
			const { status, ...withoutStatus } = edits;
			return withoutStatus;
		};

		addFilter( 'editor.preSavePost', GUARD_HOOK_NAMESPACE, guardSave );

		return () => removeFilter( 'editor.preSavePost', GUARD_HOOK_NAMESPACE );
	}, [ confirm, createErrorNotice, editPost, registry, removeFromWorkflow ] );

	return confirmDialog;
}
