/**
 * The way back to the Workflow panel when it is switched off and needed.
 *
 * Which workflow a post is in and its metadata fields are rows in core's
 * Summary panel. Where core cannot draw them there (the `post-status` panel is
 * removed), they are drawn in the Workflow document panel instead
 * (SummaryRowsFallback.js) — and that panel is one a person can switch off in
 * Preferences → Panels. With both true, a move held on an empty required
 * field, or an orphaned post, has no control left on screen that can clear it.
 *
 * So the header offers one, in exactly that configuration and only while
 * something is waiting on those rows: "Show Workflow panel" turns the panel
 * back on, expands it, opens the Settings sidebar on the Post tab and moves
 * focus into the panel. A panel that is on but collapsed is not offered this:
 * its heading is on screen, and expanding it is the person's own one click.
 *
 * @package
 */

import { useEffect, useRef } from '@wordpress/element';
import { Button, Fill } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { __ } from '@wordpress/i18n';

import { STORE_NAME, WORKFLOW_PANEL_NAME } from '../store';
import { useRequiredMetadataGate } from '../required-metadata';
import { useSummaryRowsFallback } from './SummaryRowsFallback';

/**
 * Whether the Summary rows are reachable only through a Workflow panel the
 * person has switched off.
 *
 * A panel removed in code (`removeEditorPanel`) is not "switched off":
 * turning its preference back on would not draw it, so nothing is offered.
 *
 * @return {boolean} True when the rows are drawn in the panel and it is off.
 */
export function useWorkflowPanelSwitchedOff() {
	const fallback = useSummaryRowsFallback();
	const switchedOff = useSelect( ( select ) => {
		const editor = select( editorStore );
		return (
			! editor.isEditorPanelRemoved( WORKFLOW_PANEL_NAME ) &&
			! editor.isEditorPanelEnabled( WORKFLOW_PANEL_NAME )
		);
	}, [] );

	return fallback && switchedOff;
}

/**
 * Whether the header should offer to show the Workflow panel: the rows are
 * out of reach, and something is waiting on them — a move held on an empty
 * required field, or an orphaned post, whose only way out is the Workflow row.
 *
 * @return {boolean} True when the recovery action is needed.
 */
export function useWorkflowPanelRecoveryNeeded() {
	const switchedOff = useWorkflowPanelSwitchedOff();
	const { blockingFieldKeys } = useRequiredMetadataGate();
	const { orphaned, onWorkflowPost } = useSelect( ( select ) => {
		const s = select( STORE_NAME );
		return {
			orphaned: !! s.getWorkflowStatus()?.orphaned,
			// The header belongs to whichever entity core is editing; see
			// WorkflowHeaderAction.
			onWorkflowPost:
				select( editorStore ).getCurrentPostId() === s.getPostId(),
		};
	}, [] );

	return (
		switchedOff &&
		onWorkflowPost &&
		( orphaned || blockingFieldKeys.length > 0 )
	);
}

/**
 * The header's "Show Workflow panel" action.
 *
 * Fills the same pinned-items slot as the header split button (see
 * WorkflowHeaderAction), after it. Tertiary: it sits beside the post's
 * call to action and must not compete with it.
 *
 * @return {?JSX.Element} The fill, or null when the panel is reachable.
 */
export function WorkflowPanelRecovery() {
	const needed = useWorkflowPanelRecoveryNeeded();
	const { showWorkflowPanel } = useDispatch( STORE_NAME );

	if ( ! needed ) {
		return null;
	}

	return (
		<Fill name="PinnedItems/core">
			<Button
				variant="tertiary"
				size="compact"
				className="vip-workflows-panel-recovery"
				onClick={ () => showWorkflowPanel() }
			>
				{ __( 'Show Workflow panel', 'vip-workflows' ) }
			</Button>
		</Fill>
	);
}

/**
 * The Workflow panel's body, which takes focus when the recovery action asked
 * for it.
 *
 * The panel is not mounted when it is asked to show itself, so the request
 * waits in the store and is answered here on mount. Focus lands on the body
 * itself (`tabIndex=-1`, out of the tab order), so the next Tab reaches the
 * first of the rows the person came for.
 *
 * @param {Object}      props
 * @param {JSX.Element} props.children The panel's sections.
 * @return {JSX.Element} The body.
 */
export function WorkflowPanelBody( { children } ) {
	const ref = useRef( null );
	const requested = useSelect(
		( select ) => select( STORE_NAME ).isWorkflowPanelFocusRequested(),
		[]
	);
	const { clearWorkflowPanelFocus } = useDispatch( STORE_NAME );

	useEffect( () => {
		if ( ! requested || ! ref.current ) {
			return;
		}
		ref.current.scrollIntoView?.( { block: 'nearest' } );
		ref.current.focus();
		clearWorkflowPanelFocus();
	}, [ requested, clearWorkflowPanelFocus ] );

	return (
		<Stack
			ref={ ref }
			tabIndex={ -1 }
			className="vip-workflows-document-panel__body"
			direction="column"
			gap="lg"
		>
			{ children }
		</Stack>
	);
}
