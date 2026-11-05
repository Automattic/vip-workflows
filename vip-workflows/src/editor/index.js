/**
 * VIP Workflows Editor Sidebar
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { registerPlugin } from '@wordpress/plugins';
import {
	PluginPostStatusInfo,
	PluginSidebar,
	PluginSidebarMoreMenuItem,
} from '@wordpress/editor';
import { Stack } from '@wordpress/ui';
import { replace as workflowIcon } from '@wordpress/icons';
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
			     not the sidebar happens to be open, and it evaluates nothing for
			     a post that is not in a workflow. */ }
			<WorkflowSaveGuard />

			{ /* Every transition, from the sidebar rail or the header button,
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

			{ /* Same icon the plugin uses for its top-level wp-admin menu. */ }
			<PluginSidebarMoreMenuItem
				target="vip-workflows-sidebar"
				icon={ workflowIcon }
			>
				{ __( 'Workflow', 'vip-workflows' ) }
			</PluginSidebarMoreMenuItem>
			<PluginSidebar
				name="vip-workflows-sidebar"
				icon={ workflowIcon }
				title={ __( 'Workflow', 'vip-workflows' ) }
			>
				{ /* `PluginSidebar` hands its children an edge-to-edge scroll
				     region that draws nothing of its own. What sits inside it
				     is flat — the pattern core's document sidebar uses
				     (`PostPanelSection`): no card, no border of its own, just
				     the standard panel inset, which lives on
				     `.vip-workflows-sidebar` in style.css keyed to the direct
				     child. The sidebar's own header already says "Workflow".

				     What is here acts on the post's movement through its
				     workflow. Which workflow it is in, and the fields that
				     workflow declares, are rows in the document sidebar's
				     Summary panel. Where that panel cannot show them, the
				     same rows are drawn here instead, above the panel. */ }
				<Stack className="vip-workflows-sidebar" direction="column">
					<SummaryRowsFallback />
					<WorkflowPanel />
				</Stack>
			</PluginSidebar>
		</>
	);
}

/**
 * Register the plugin sidebar
 */
registerPlugin( 'vip-workflows', {
	render: WorkflowPlugin,
} );
