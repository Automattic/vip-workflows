/**
 * Workflow Header Action — the post's next move, in the editor header.
 *
 * A split button: the main half runs the stage's primary transition and is
 * labelled with that transition's own name ("Send to Review"); the arrow opens
 * the transition rail, so every other way out is one click further. When the
 * post sits on the draft side of the publish boundary and the person cannot
 * bypass the workflow, core's Publish button could only fail, so this button
 * takes its place (see `replacesCorePublish`). Everywhere else it stands beside
 * core's controls rather than instead of them.
 *
 * It fills the header's pinned-items slot. That slot is the one core's own
 * sidebar toggles fill, so its name is a private contract with the header —
 * filled through the bare `Fill` rather than `@wordpress/interface`, whose
 * index registers a store core has already registered.
 *
 * Nothing here runs a move. Both halves hand the transition to the flow
 * (TransitionFlow) through the store, anchored to the main button, so the
 * confirmations and the assignee popover are the rail's own and survive the
 * dropdown closing.
 *
 * @package
 */

import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { Button, Dropdown, Fill, Tooltip } from '@wordpress/components';
import { chevronDown } from '@wordpress/icons';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { __ } from '@wordpress/i18n';
import { STORE_NAME } from '../store';
import { useRequiredMetadataGate } from '../required-metadata';
import {
	getPrimaryTransition,
	replacesCorePublish,
} from '../primary-transition';
import { TransitionRail } from './TransitionRail';
import './WorkflowHeaderAction.css';

/**
 * The class on <body> that hides core's Publish button (WorkflowHeaderAction.css).
 *
 * @type {string}
 */
export const REPLACES_PUBLISH_CLASS = 'vip-workflows-replaces-publish';

/**
 * The split button.
 *
 * @return {?JSX.Element} The header fill, or null when there is no move to offer.
 */
export function WorkflowHeaderAction() {
	const {
		workflow,
		transitioningTo,
		postStatus,
		savedStatus,
		onWorkflowPost,
		coreButtonSaves,
	} = useSelect( ( select ) => {
		const s = select( STORE_NAME );
		const editor = select( editorStore );
		const edited = editor.getEditedPostAttribute( 'status' );
		const saved = editor.getCurrentPostAttribute( 'status' );
		return {
			workflow: s.getWorkflowStatus(),
			transitioningTo: s.getTransitioningTo(),
			postStatus: edited,
			savedStatus: saved,
			// Core can point this same editor at another entity in place
			// ("Edit original" on a synced pattern, "Edit template") while
			// the plugin stays mounted for the post the page was loaded
			// with. The header is that other entity's then, not the post's.
			onWorkflowPost: editor.getCurrentPostId() === s.getPostId(),
			// Core draws ONE header button for several jobs, and it is only
			// a Publish while the post is plainly unpublished. Once the post
			// is published or private, a status has been picked in Summary,
			// another entity has changes to save, or a person who cannot
			// publish has a pending post, that button is the Save — and in
			// each of those but the third, core has taken "Save draft" away,
			// so it is the only one. Mirrors PostPublishButton's own rules.
			coreButtonSaves:
				editor.isCurrentPostPublished() ||
				edited !== saved ||
				editor.hasNonPostEntityChanges() ||
				( 'pending' === saved &&
					! editor.getCurrentPost()._links?.[ 'wp:action-publish' ] ),
		};
	}, [] );
	const { transitions } = useRequiredMetadataGate();
	const { fetchWorkflowStatus, requestTransition } =
		useDispatch( STORE_NAME );

	// The header is on screen from the first paint, whether or not the
	// Workflow sidebar is ever opened, so it asks for the post's workflow
	// state itself — and asks again when the post's persisted status changes.
	// A status core wrote (its own Publish for a person who bypasses the
	// workflow, a status picked in Summary) re-seats the post at another stage
	// on the server, and nothing else here would hear of it: the button would
	// go on offering the move out of the stage the post has left.
	useEffect( () => {
		fetchWorkflowStatus();
	}, [ fetchWorkflowStatus, savedStatus ] );

	// The main half. Held in state as well as used as the popover anchor: the
	// header does not render the pinned-items slot at every width and
	// preference (core skips it when icon labels are on and the viewport is
	// not wide), and core's Publish button may only be hidden while this one
	// is there to stand in for it. Rendered is not the same as visible — in
	// distraction-free mode core hides the whole slot with CSS — which is the
	// stylesheet's half of this rule (WorkflowHeaderAction.css).
	const mainRef = useRef( null );
	const [ mounted, setMounted ] = useState( false );
	const setMain = useCallback( ( node ) => {
		mainRef.current = node;
		setMounted( !! node );
	}, [] );

	const primary = getPrimaryTransition( transitions );
	const shown =
		onWorkflowPost &&
		!! workflow?.has_workflow &&
		! workflow.orphaned &&
		!! primary;
	const replaces =
		shown && replacesCorePublish( workflow, transitions, coreButtonSaves );
	const hideCorePublish = replaces && mounted;

	useEffect( () => {
		if ( ! hideCorePublish ) {
			return;
		}
		document.body.classList.add( REPLACES_PUBLISH_CLASS );
		return () => document.body.classList.remove( REPLACES_PUBLISH_CLASS );
	}, [ hideCorePublish ] );

	if ( ! shown ) {
		return null;
	}

	const transitioning = null !== transitioningTo;
	const locked = !! primary._locked;

	// One primary button per header. Standing in for Publish, this is the
	// header's call to action; beside core's own Save or Publish it steps
	// down to secondary so the two never compete.
	const variant = replaces ? 'primary' : 'secondary';

	const main = (
		<Button
			ref={ setMain }
			variant={ variant }
			size="compact"
			className="vip-workflows-header-action__main"
			onClick={ () =>
				requestTransition( primary, mainRef.current, 'header' )
			}
			isBusy={ transitioningTo === primary.to }
			disabled={ locked || transitioning }
			accessibleWhenDisabled
		>
			{ primary.label }
		</Button>
	);

	return (
		<Fill name="PinnedItems/core">
			<div className="vip-workflows-header-action">
				{ /* Always wrapped, with nothing to say unless the move is
				     held: wrapping only while locked would swap the element
				     at this position each time the lock came or went, and
				     React would rebuild the button — dropping focus from it
				     and detaching the node the flow anchors a popover to. */ }
				<Tooltip text={ locked ? primary._locked_reason : undefined }>
					{ main }
				</Tooltip>
				<Dropdown
					className="vip-workflows-header-action__more"
					contentClassName="vip-workflows-header-action__popover"
					popoverProps={ { placement: 'bottom-end' } }
					renderToggle={ ( { isOpen, onToggle } ) => (
						<Button
							variant={ variant }
							size="compact"
							className="vip-workflows-header-action__toggle"
							icon={ chevronDown }
							label={ __(
								'Workflow transitions',
								'vip-workflows'
							) }
							onClick={ onToggle }
							aria-expanded={ isOpen }
						/>
					) }
					renderContent={ ( { onClose } ) => (
						<div className="vip-workflows-header-action__rail">
							<TransitionRail
								current={ workflow.current }
								transitions={ transitions }
								allStatuses={ workflow.all_statuses }
								agentPending={ !! workflow.agent_pending }
								agentFailed={
									'failed' === workflow.agent_job?.status
								}
								agentLastRun={ workflow.agent_last_run || null }
								transitioning={ transitioning }
								transitioningTo={ transitioningTo }
								// The dropdown closes as the move starts, so
								// any popover the move opens is anchored to
								// the main button, which stays.
								onTransition={ ( transition ) => {
									onClose();
									requestTransition(
										transition,
										mainRef.current,
										'header'
									);
								} }
								postStatus={ postStatus }
							/>
						</div>
					) }
				/>
			</div>
		</Fill>
	);
}
