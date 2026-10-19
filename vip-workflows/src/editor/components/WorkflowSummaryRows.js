/**
 * The workflow's rows in the document sidebar's Summary panel.
 *
 * Which sequence a post is in, and the editorial metadata that sequence
 * declares, are properties of the post in exactly the way Status, Slug, Author
 * and Template are. So they sit with those, in core's Summary panel, rather
 * than in a separate plugin sidebar the writer has to go and find. They already
 * draw as core's row pattern (SidebarRow), so the move is a relocation: the
 * Workflow row first, then one row per metadata field.
 *
 * Mounted through `PluginPostStatusInfo` (src/editor/index.js), whose fills all
 * land at one point — after core's own rows, above Move to trash — so there is
 * no placing these between Status and Slug. That slot is a render-prop slot,
 * not `bubblesVirtually`: these rows render inside the Summary panel's own
 * subtree, so they take nothing from React context around the fill. Everything
 * they read comes through `wp.data` and `useEntityProp`, which reach them
 * wherever they render.
 *
 * Assigning, switching and removing the workflow live here because the row that
 * offers them lives here. Each one goes through the editor store, so the
 * workflow panel, the save guard and these rows all draw the same answer.
 *
 * @package
 */

import { useEffect, useState } from '@wordpress/element';
import { Notice as DismissibleNotice } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { useDispatch, useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';

import { STORE_NAME } from '../store';
import { useConfirm } from '../../common/use-confirm';
import {
	getOrphanedWorkflowRemoveConfirmation,
	getRemoveFromWorkflowConfirmation,
	getRemoveFromWorkflowLabel,
	getSwitchWorkflowConfirmLabel,
	getSwitchWorkflowConfirmTitle,
	getSwitchWorkflowConfirmation,
} from '../../entries/confirm-workflow-side-effect';
import { MetadataPanel } from './MetadataPanel';
import { WorkflowRow } from './WorkflowRow';

/**
 * The Workflow row and the metadata rows, for the Summary panel.
 *
 * @return {JSX.Element} The rows.
 */
export function WorkflowSummaryRows() {
	const { workflow, loading, workflowEnforcement } = useSelect(
		( select ) => {
			const s = select( STORE_NAME );
			return {
				workflow: s.getWorkflowStatus(),
				loading: ! s.isWorkflowStatusResolved(),
				workflowEnforcement: s.getWorkflowEnforcement(),
			};
		},
		[]
	);

	const { fetchWorkflowStatus, assignSequence, removeWorkflow } =
		useDispatch( STORE_NAME );
	const [ confirm, confirmDialog ] = useConfirm();

	const [ busy, setBusy ] = useState( false );
	const [ actionError, setActionError ] = useState( null );

	// The Summary panel is open by default, and it is the one place the post's
	// workflow is named — so it asks for the state rather than waiting on a
	// sidebar the writer may never open. The read belongs to the store, so this
	// and the workflow panel answer from the same payload.
	useEffect( () => {
		fetchWorkflowStatus();
	}, [ fetchWorkflowStatus ] );

	// Put this post in a workflow — or move it to a different one.
	//
	// The post is always seated at the entry stage of the region its status is
	// already in, so starting a workflow never moves the post. A sequence with
	// no stage in that region is refused by the server, and the reason arrives
	// as an error notice under the row.
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

		setBusy( true );
		setActionError( null );

		try {
			await assignSequence( sequenceId );
		} catch ( err ) {
			setActionError(
				err.message ||
					__( 'Could not assign the workflow.', 'vip-workflows' )
			);
		} finally {
			setBusy( false );
		}
	};

	// Take this post out of its workflow.
	//
	// Same label, same copy and same dialog as the save guard's escape hatch,
	// and the same store action, so neither can be left rendering a workflow
	// the other deleted.
	const handleRemoveWorkflow = async () => {
		const workflowName = workflow?.sequence?.name;
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

		setBusy( true );
		setActionError( null );

		try {
			await removeWorkflow();
		} catch ( err ) {
			setActionError(
				err.message ||
					__( 'Could not remove the workflow.', 'vip-workflows' )
			);
		} finally {
			setBusy( false );
		}
	};

	/**
	 * The Workflow row for the state the store last read, or null where the
	 * post has no workflow property to show.
	 *
	 * @return {JSX.Element|null} The row.
	 */
	const renderWorkflowRow = () => {
		// No row until the first read lands: an empty row would say "Select a
		// workflow" over a post that may well be in one.
		if ( loading ) {
			return null;
		}

		// The post's sequence was deleted out from under it. The save layer
		// still reads the surviving sequence meta and refuses every status
		// change until the identity is cleared, so removal is offered whatever
		// the enforcement — it is the only way out — and nothing else is.
		if ( workflow?.orphaned ) {
			return (
				<WorkflowRow
					orphaned
					disabled={ busy }
					onRemove={ handleRemoveWorkflow }
				/>
			);
		}

		const availableSequences = workflow?.available_sequences || [];

		// No sequence covers this post type: there is nothing to choose, so
		// there is no property to show.
		if ( ! workflow?.has_workflow && availableSequences.length === 0 ) {
			return null;
		}

		return (
			<WorkflowRow
				sequence={ workflow?.has_workflow ? workflow.sequence : null }
				availableSequences={ availableSequences }
				disabled={ busy }
				onSelect={ handleWorkflowSelect }
				// An enforced workflow offers no way out.
				onRemove={
					'require' === workflowEnforcement
						? undefined
						: handleRemoveWorkflow
				}
			/>
		);
	};

	return (
		<Stack
			className="vip-workflows-summary-rows"
			direction="column"
			gap="xs"
		>
			{ renderWorkflowRow() }
			{ /* The server can refuse an assignment — a sequence that models
			     no stage in the post's status region — and a removal can fail;
			     either answer is what the author needs. */ }
			{ actionError && (
				<DismissibleNotice
					status="error"
					isDismissible
					onRemove={ () => setActionError( null ) }
					className="vip-workflows-summary-rows__error"
				>
					{ actionError }
				</DismissibleNotice>
			) }
			{ /* The fields are the post's, not the sequence's: they are stored
			     on the post, are known from the server bootstrap before the
			     status read lands, and stay editable whatever state the
			     workflow is in. Renders nothing when there are none. */ }
			<MetadataPanel />
			{ confirmDialog }
		</Stack>
	);
}
