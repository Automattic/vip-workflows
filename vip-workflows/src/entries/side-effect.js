/**
 * Build entry that publishes the shared workflow side-effect module for the
 * classic list-table surfaces.
 *
 * `class-posts-columns.php` enqueues this file's bundle (`build/side-effect.js`)
 * and its inline Quick Edit / Bulk Edit script reads
 * `window.vipWorkflowsSideEffect`. An inline script cannot import, and a second
 * implementation of the region math or the copy is exactly how the surfaces
 * drift apart. The decision table itself lives in
 * `src/common/confirm-workflow-side-effect.js`, which the React surfaces import
 * directly; this file only publishes it.
 *
 * @package
 */

import {
	DECISION_SILENT,
	DECISION_WARN,
	DECISION_VETO,
	statusToRegion,
	evaluateStatusChange,
	getRegionLabel,
	getStatusChangeConfirmTitle,
	getStatusChangeConfirmLabel,
	getAgentInterruptWarning,
	getTransitionWarningsTitle,
	getTransitionWarningsMessage,
	getTransitionPublishConfirmTitle,
	getTransitionPublishConfirmLabel,
	getTransitionPublishWarning,
	getStatusChangeWarning,
	getPublishVetoMessage,
	getOrphanedWorkflowMessage,
	getOrphanedWorkflowRemoveConfirmation,
	getRemoveFromWorkflowLabel,
	getRemoveFromWorkflowConfirmation,
	getSwitchWorkflowConfirmTitle,
	getSwitchWorkflowConfirmLabel,
	getSwitchWorkflowConfirmation,
} from '../common/confirm-workflow-side-effect';

window.vipWorkflowsSideEffect = {
	DECISION_SILENT,
	DECISION_WARN,
	DECISION_VETO,
	statusToRegion,
	evaluateStatusChange,
	getRegionLabel,
	getStatusChangeConfirmTitle,
	getStatusChangeConfirmLabel,
	getAgentInterruptWarning,
	getTransitionWarningsTitle,
	getTransitionWarningsMessage,
	getTransitionPublishConfirmTitle,
	getTransitionPublishConfirmLabel,
	getTransitionPublishWarning,
	getStatusChangeWarning,
	getPublishVetoMessage,
	getOrphanedWorkflowMessage,
	getOrphanedWorkflowRemoveConfirmation,
	getRemoveFromWorkflowLabel,
	getRemoveFromWorkflowConfirmation,
	getSwitchWorkflowConfirmTitle,
	getSwitchWorkflowConfirmLabel,
	getSwitchWorkflowConfirmation,
};
