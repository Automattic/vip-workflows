/**
 * VIP Workflows Editor Sidebar
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { registerPlugin } from '@wordpress/plugins';
import { PluginSidebar, PluginSidebarMoreMenuItem } from '@wordpress/editor';
import { Stack } from '@wordpress/ui';
import { replace as workflowIcon } from '@wordpress/icons';
import { useSelect, useDispatch, useRegistry } from '@wordpress/data';
import { __ } from '@wordpress/i18n';

import { STORE_NAME } from './store';
import { refreshPostEntity } from './refresh-post-entity';
import { WorkflowPanel } from './components/WorkflowPanel';
import { WorkflowSaveGuard } from './components/WorkflowSaveGuard';
import { WorkflowRequiredModal } from './components/WorkflowRequiredModal';
import { CommandPalette } from './components/CommandPalette';
import { MetadataPanel } from './components/MetadataPanel';

import './style.css';

// Hydrate the store from the server-rendered localized data.
wp.data.dispatch( STORE_NAME ).hydrate( window.vipWorkflowsEditor || {} );

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
	// panel's sequence and stage, and the Metadata section's fields — because
	// the store answers both from the same payload.
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

			{ showModal && (
				<WorkflowRequiredModal
					postId={ postId }
					mode={ workflowEnforcement }
					onSelect={ handleWorkflowSelected }
					onSkip={ handleSkip }
				/>
			) }

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
				     child. The runs within the panel rule themselves apart.

				     Nothing here carries a heading of its own. The sidebar's
				     own header already says "Workflow", and the panel opens
				     with the document sidebar's label-beside-value rows — the
				     sequence the post is in, then the fields that sequence
				     declares — which name themselves. */ }
				<Stack className="vip-workflows-sidebar" direction="column">
					{ /* Editorial metadata is nested, not a sibling section.
					     The panel's foot — Show history, and the way out of
					     the workflow — lives inside WorkflowPanel, and those
					     two act on the workflow rather than on the post, so
					     they belong after the fields the writer fills in, not
					     between the rail and them. The panel seats this
					     between its rail and its foot. It still renders
					     nothing at all when the active sequence declares no
					     fields, and its hairline comes with it (style.css). */ }
					<WorkflowPanel>
						<MetadataPanel />
					</WorkflowPanel>
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
