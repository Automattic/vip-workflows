/**
 * VIP Workflows in the post editor
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { registerPlugin } from '@wordpress/plugins';
import {
	PluginDocumentSettingPanel,
	PluginPostStatusInfo,
} from '@wordpress/editor';
import { Stack } from '@wordpress/ui';
import { useSelect, useDispatch, useRegistry } from '@wordpress/data';
import { __ } from '@wordpress/i18n';

import { STORE_NAME } from './store';
import { refreshPostEntity } from './refresh-post-entity';
import { WorkflowPanel } from './components/WorkflowPanel';
import { WorkflowSaveGuard } from './components/WorkflowSaveGuard';
import { TransitionFlow } from './components/TransitionFlow';
import { WorkflowHeaderAction } from './components/WorkflowHeaderAction';
import { WorkflowRequiredModal } from './components/WorkflowRequiredModal';
import { CommandPalette } from './components/CommandPalette';
import {
	SummaryRowsFallback,
	SummaryRowsFill,
} from './components/SummaryRowsFallback';

import './style.css';

// Hydrate the store from the server-rendered localized data. The status
// endpoint's answer, served with the page, goes in the way a fetched one does,
// so everything the store derives from it is derived in one place.
const { workflowStatus, ...bootstrap } = window.vipWorkflowsEditor || {};
wp.data.dispatch( STORE_NAME ).hydrate( bootstrap );
if ( workflowStatus ) {
	wp.data.dispatch( STORE_NAME ).receiveWorkflowStatus( workflowStatus );
}

/**
 * Main Workflow Plugin Component
 */
function WorkflowPlugin() {
	const { postId, postType, showWorkflowModal, workflowEnforcement } =
		useSelect( ( select ) => {
			const s = select( STORE_NAME );
			return {
				postId: s.getPostId(),
				postType: s.getPostType(),
				showWorkflowModal: s.getShowWorkflowModal(),
				workflowEnforcement: s.getWorkflowEnforcement(),
			};
		}, [] );

	const [ showModal, setShowModal ] = useState( showWorkflowModal );

	const registry = useRegistry();
	const { fetchWorkflowStatus } = useDispatch( STORE_NAME );

	// The enforcement modal assigns the sequence itself and then says so. One
	// read of the status endpoint re-sources everything that changed — the
	// Summary panel's Workflow row and metadata fields, and the panel's stage —
	// because the store answers all of them from the same payload.
	//
	// The panels used to be thrown away and rebuilt on a counter passed as
	// their `key` instead. A remount is not synchronisation: it re-runs each
	// panel's own fetch, it cannot reach the save guard (which is not a child
	// of anything here), and the two `key` prefixes existed only to stop React
	// warning about the duplicate keys that scheme produced. With one reactive
	// source there is nothing left to remount, so both are gone.
	const handleWorkflowSelected = () => {
		setShowModal( false );
		fetchWorkflowStatus();
		refreshPostEntity( registry, postType, postId );
	};

	const handleSkip = () => {
		setShowModal( false );
	};

	return (
		<>
			<CommandPalette />

			{ /* The save-layer guard. Mounted unconditionally and outside every
			     collapsible panel: a status change has to be caught whether or
			     not the workflow panel happens to be open, and it evaluates
			     nothing for a post that is not in a workflow. */ }
			<WorkflowSaveGuard />

			{ /* Every transition, from the panel's rail or the header button,
			     runs here: its confirms and dialogs must outlive whichever
			     surface was pressed. Mounted unconditionally for the same
			     reason as the guard. */ }
			<TransitionFlow />

			{ /* The post's next move in the editor header, standing in for
			     core's Publish button where that button could only fail. */ }
			<WorkflowHeaderAction />

			{ showModal && (
				<WorkflowRequiredModal
					postId={ postId }
					mode={ workflowEnforcement }
					onSelect={ handleWorkflowSelected }
					onSkip={ handleSkip }
				/>
			) }

			{ /* Which workflow the post is in, and the metadata fields its
			     sequence declares, are properties of the post — so they sit
			     with Status, Slug and Author in the document sidebar's Summary
			     panel. The fill lands after core's rows, above Move to trash.
			     `PluginPostStatusInfo` wraps its children in a `PanelRow`,
			     whose flex row layout is neutralised in style.css so the rows
			     keep their own full-width layout. The fill counts itself in the
			     store while it is mounted; see SummaryRowsFallback.js. */ }
			<PluginPostStatusInfo className="vip-workflows-post-summary">
				<SummaryRowsFill />
			</PluginPostStatusInfo>

			{ /* The post's movement through its workflow — where it sits, who
			     holds it, every way onward, and the record of how it got
			     there — as one panel in the document sidebar, below Summary.
			     One heading, for one subject: the post's properties stay in
			     the Summary rows above, and this panel holds only what moves
			     the post. The header's split button (WorkflowHeaderAction)
			     offers the same rail, so the panel being collapsed, or turned
			     off in Preferences → Panels, never leaves a move unreachable.

			     Where the Summary panel cannot show the Workflow and metadata
			     rows, the same rows are drawn here instead, above the rail.
			     The panel's body already carries core's standard inset, so
			     what sits inside it adds none of its own. */ }
			<PluginDocumentSettingPanel
				name="workflow"
				title={ __( 'Workflow', 'vip-workflows' ) }
				className="vip-workflows-document-panel"
			>
				<Stack
					className="vip-workflows-document-panel__body"
					direction="column"
					gap="lg"
				>
					<SummaryRowsFallback />
					<WorkflowPanel />
				</Stack>
			</PluginDocumentSettingPanel>
		</>
	);
}

/**
 * Register the editor plugin
 */
registerPlugin( 'vip-workflows', {
	render: WorkflowPlugin,
} );
