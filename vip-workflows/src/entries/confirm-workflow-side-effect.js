/**
 * confirmWorkflowSideEffect — the single client-side authority for "does this
 * post-status change touch the workflow, and how loudly do we say so?".
 *
 * A status change on a workflow-managed post is never just a status change: the
 * workflow re-seats the post at the target region's entry stage and cancels any
 * stage agent running there. This module decides whether that side effect is
 * silent, needs a confirm, or is vetoed outright, and owns the copy that
 * explains it — so the block editor panel, the Quick Edit inline script and the
 * Bulk Edit inline script cannot drift apart on either.
 *
 * Deliberately framework-free (plain functions, no React, no DOM): only the
 * block editor surface is React. Import the named exports; there is no default
 * export.
 *
 * The classic list-table surfaces (Quick Edit, Bulk Edit) cannot import — they
 * are an inline script printed by `class-posts-columns.php`. So this file is
 * also a webpack entry (`side-effect` → `build/side-effect.js`) and publishes
 * itself on `window.vipWorkflowsSideEffect` (see the bottom of this file) for
 * them to consume. Same module, same answers, same words: there is no second
 * copy of the decision table anywhere. Being a build entry is why it sits in
 * src/entries/ and not in src/common/ with the other shared modules; the React
 * surfaces import it from here.
 *
 * The decision here is UX, not enforcement. The publish veto is enforced
 * server-side at the save layer (`wp_insert_post_data` /
 * `rest_pre_insert_{post_type}`); this module keeps the user from walking into
 * that wall without being told why, and offers the audited way through.
 *
 * @package
 */

import { __, sprintf } from '@wordpress/i18n';
import {
	REGION_ORDER,
	regionEntryStage,
	regionLabel,
} from '../admin/components/graph/regions';

/**
 * The change has no workflow consequence — do nothing, say nothing.
 *
 * @type {string}
 */
export const DECISION_SILENT = 'silent';

/**
 * The change re-seats the stage (and may cancel an agent) — confirm first.
 *
 * @type {string}
 */
export const DECISION_WARN = 'warn';

/**
 * The change crosses the publish boundary for a non-bypass user — refuse, and
 * offer the audited escape (remove the post from its workflow).
 *
 * @type {string}
 */
export const DECISION_VETO = 'veto';

/**
 * Map a core post status to its editorial region.
 *
 * MIRRORS `StatusManager::status_to_region()` (PHP). The two implementations
 * are one rule expressed twice and MUST change together — if you edit this map,
 * edit `includes/workflow/class-status-manager.php` in the same change.
 *
 * `future` is publish-side HERE (and in the server predicates) because
 * scheduling is a delayed publish; the reseat path keeps treating it as an
 * overlay. The different mappings are deliberate: one describes workflow
 * placement while this one describes which side of the publish boundary a
 * status occupies.
 *
 * Every other status maps to itself, including statuses that are not editorial
 * regions at all (`trash`, `inherit`, custom statuses). Callers that must not
 * treat those as regions filter them out first, exactly as the PHP does.
 *
 * @param {string} status Core post status.
 * @return {string} The editorial region the status belongs to.
 */
export function statusToRegion( status ) {
	if ( status === 'future' ) {
		return 'publish';
	}

	if ( status === 'auto-draft' ) {
		return 'draft';
	}

	return status;
}

/**
 * Decide how a pending post-status change on a workflow-managed post is treated.
 *
 * Only call this for posts that ARE in a workflow — an unmanaged post has no
 * current region and nothing to guard.
 *
 * @param {Object}      options               Evaluation input.
 * @param {string|null} options.currentRegion The side of the publish line the post is currently on, as the server resolved it (`StatusManager::boundary_region()`) — the stage's region, EXCEPT that a live post is publish-side whatever its stage says. Never recompute this from the stage: the two disagree when a core publish had no publish-region stage to re-seat at. Falsy when it could not be resolved.
 * @param {string}      options.targetStatus  Core post status the change would write.
 * @param {boolean}     options.canBypass     Whether the user's role bypasses workflow rules.
 * @return {string} One of DECISION_SILENT, DECISION_WARN, DECISION_VETO.
 */
export function evaluateStatusChange( {
	currentRegion,
	targetStatus,
	canBypass,
} ) {
	// `trash` and `inherit` are not regions: `trash` is an overlay that suspends
	// the workflow in place without moving the stage, in either direction, and
	// `inherit` is core-internal (revisions, attachments). Both have to be
	// filtered out before the compare below, exactly as
	// StatusManager::crosses_publish_boundary() filters them.
	if ( targetStatus === 'trash' || targetStatus === 'inherit' ) {
		return DECISION_SILENT;
	}

	// An unresolvable current region is a data-integrity condition, not a
	// region. StatusManager::crosses_publish_boundary() fails CLOSED on it —
	// it reports a crossing for EVERY target — so this must too, or the user is
	// walked through a friendly confirm straight into a server refusal. Bypass
	// users are never vetoed server-side (the bypass check runs before the
	// predicate), so they get the confirm instead.
	if ( ! currentRegion ) {
		return canBypass ? DECISION_WARN : DECISION_VETO;
	}

	const targetRegion = statusToRegion( targetStatus );

	if ( targetRegion === currentRegion ) {
		return DECISION_SILENT;
	}

	// The regions differ, so at most one of them can be `publish`: either side
	// being publish means the change crosses the publish boundary. That is the
	// one place the workflow has teeth — and only for non-bypass users.
	if ( currentRegion === 'publish' || targetRegion === 'publish' ) {
		return canBypass ? DECISION_WARN : DECISION_VETO;
	}

	return DECISION_WARN;
}

/**
 * Human-readable label for an editorial region.
 *
 * The words themselves come from `regions.js`, which already names the four
 * regions for the sequence editor — one home for them, so a region cannot be
 * called "Pending Review" on the canvas and something else in a confirm.
 *
 * What is added here is the guard: the four regions are the ones a sequence can
 * model (`Sequence::EDITORIAL_STATUSES`), and anything else reaching this
 * function is a data-integrity bug. `regionLabel()` hands an unknown slug back
 * verbatim, which is right on the canvas (the author is looking at the thing
 * that is broken) and wrong in a sentence, so it is logged and named generically
 * instead.
 *
 * @param {string} region Editorial region key.
 * @return {string} Translated label.
 */
export function getRegionLabel( region ) {
	if ( ! REGION_ORDER.includes( region ) ) {
		// eslint-disable-next-line no-console
		console.error(
			`VIP Workflows: "${ region }" is not an editorial region (expected draft, pending, private or publish).`
		);
		// Never interpolate the raw value: an unresolved region arrives here as
		// null or '', and "Changing the status from null to Draft" is worse than
		// saying plainly that the stage could not be named.
		return __( 'an unrecognized stage', 'vip-workflows' );
	}

	return regionLabel( region );
}

/**
 * Entry-stage labels for every region a sequence models, keyed by region.
 *
 * The input `getStatusChangeWarning()` needs to NAME the stage a status change
 * would re-seat at. A region is present only when the sequence models a
 * checkpoint for it; an absent region is exactly the case where
 * `StatusManager::resolve_reseat_stage()` returns null and leaves the stage in
 * place, so "no entry" and "nothing moves" are the same fact.
 *
 * The classic list-table surfaces get the same map from PHP, rendered into the
 * row's `data-entry-stages` attribute by `class-posts-columns.php`: their
 * preflight is contractually request-free, so it cannot resolve stages itself.
 * This is the React half of that one shape.
 *
 * A stage carrying no label is named by its key rather than dropped. Dropping it
 * would claim the region has no checkpoint — a statement about the workflow —
 * when the only thing missing is a display string.
 *
 * @param {Array} stages Sequence stage configs (the `all_statuses` payload).
 * @return {Object} Region slug → entry stage label.
 */
export function getEntryStageLabels( stages ) {
	return REGION_ORDER.reduce( ( labels, region ) => {
		const entry = regionEntryStage( stages, region );

		if ( entry ) {
			labels[ region ] = entry.label || entry.key;
		}

		return labels;
	}, {} );
}

/**
 * The stage a core-driven status change would re-seat the post at, if any.
 *
 * MIRRORS `StatusManager::resolve_reseat_stage()` (PHP), which is the authority
 * for "does this status change move the stage, and where to". It returns null —
 * nothing moves — in four cases, and so does this:
 *
 * 1. The target is an overlay (`future`/`trash`): scheduling is in transit and
 *    trashing suspends the workflow in place. Neither touches the stage.
 * 2. The target is core-internal (`auto-draft`/`inherit`), never a region.
 * 3. The stage already lives in the target region.
 * 4. The sequence models no checkpoint for the target region.
 *
 * Case 3 compares the region the STAGE declares, never the boundary region the
 * guard payload carries: `StatusManager::boundary_region()` forces `publish`
 * whenever the committed status is publish-side, so a live post seated at a
 * draft-region stage reports `publish` while its stage sits in `draft`.
 * Unpublishing it re-seats nothing, and saying otherwise was the bug.
 *
 * @param {Object} options                  Input.
 * @param {string} options.stageRegion      Region the post's stage declares.
 * @param {string} options.targetStatus     Core post status the change would write.
 * @param {Object} options.entryStageLabels Region → entry stage label.
 * @return {string|null} The destination stage's label, or null when nothing moves.
 */
function reseatStageLabel( { stageRegion, targetStatus, entryStageLabels } ) {
	if (
		targetStatus === 'future' ||
		targetStatus === 'trash' ||
		targetStatus === 'auto-draft' ||
		targetStatus === 'inherit'
	) {
		return null;
	}

	if ( stageRegion === targetStatus ) {
		return null;
	}

	return ( entryStageLabels || {} )[ targetStatus ] || null;
}

/**
 * Title for the status-change confirm dialog.
 *
 * @return {string} Translated title.
 */
export function getStatusChangeConfirmTitle() {
	return __( 'This changes the workflow', 'vip-workflows' );
}

/**
 * Label for the button that proceeds with a warned status change.
 *
 * @return {string} Translated label.
 */
export function getStatusChangeConfirmLabel() {
	return __( 'Continue', 'vip-workflows' );
}

/**
 * Copy for any action that would interrupt a running stage agent.
 *
 * A stage agent runs on the user's behalf, not against them: anyone with edit
 * access may stop it, they just have to know they are.
 *
 * @return {string} Translated message.
 */
export function getAgentInterruptWarning() {
	return __(
		'An AI agent is working on this post — continuing will stop it.',
		'vip-workflows'
	);
}

/**
 * Title for the confirm that precedes overriding a transition's soft warnings.
 *
 * @return {string} Translated title.
 */
export function getTransitionWarningsTitle() {
	return __( 'This transition has warnings', 'vip-workflows' );
}

/**
 * Copy for the confirm that precedes overriding a transition's soft warnings.
 *
 * `StatusManager::transition()` answers `warnings_pending` for a transition it
 * refused to perform without acknowledgement — a required tool that soft-failed,
 * or a stage agent that is mid-run and would be stopped. Every surface that can
 * move a post gets the same answer from the server, so they share this sentence
 * rather than each inventing one (and rather than three of them, as before,
 * treating the refusal as a success).
 *
 * @param {Array} warnings The response's `soft_warnings` entries.
 * @return {string} Translated message.
 */
export function getTransitionWarningsMessage( warnings ) {
	const detail = ( warnings || [] )
		.map( ( warning ) => warning?.message )
		.filter( Boolean )
		.join( ' ' );

	return detail
		? `${ detail } ${ __( 'Continue anyway?', 'vip-workflows' ) }`
		: __(
				'This transition has unresolved warnings. Continue anyway?',
				'vip-workflows'
		  );
}

/**
 * Title for the confirm that precedes a transition that publishes the post.
 *
 * @return {string} Translated title.
 */
export function getTransitionPublishConfirmTitle() {
	return __( 'Publish this post?', 'vip-workflows' );
}

/**
 * Label for the button that proceeds with a publishing transition.
 *
 * @return {string} Translated label.
 */
export function getTransitionPublishConfirmLabel() {
	return __( 'Publish', 'vip-workflows' );
}

/**
 * Copy for the confirm that precedes a transition that publishes the post.
 *
 * A transition into a publish-region stage crosses the publish boundary, so
 * `StatusManager::transition()` writes `publish` before the stage move — the
 * post goes publicly live as a side effect of what reads as a workflow step.
 * Core's own Publish button asks before doing that; a transition that does the
 * same thing owes the same question.
 *
 * The scheduled variant exists because a scheduled post's stage stays where it
 * was (scheduling is an overlay), so moving it into a publish-region stage
 * still crosses the boundary — and publishes it now, overriding the schedule.
 * Saying "publishes it" without saying "now, not at the scheduled time" would
 * hide the part the author most needs to know.
 *
 * @param {Object}  options            Message input.
 * @param {string}  options.stageLabel Destination stage label.
 * @param {boolean} options.scheduled  Whether the post is currently scheduled.
 * @return {string} Translated message.
 */
export function getTransitionPublishWarning( { stageLabel, scheduled } ) {
	if ( scheduled ) {
		return sprintf(
			/* translators: %s: destination workflow stage label, e.g. "Published". */
			__(
				'This post is scheduled. Moving it to “%s” publishes it now, instead of at its scheduled time.',
				'vip-workflows'
			),
			stageLabel
		);
	}

	return sprintf(
		/* translators: %s: destination workflow stage label, e.g. "Published". */
		__(
			'Moving this post to “%s” publishes it: it becomes publicly visible right away.',
			'vip-workflows'
		),
		stageLabel
	);
}

/**
 * Copy for a warn-level status change: what the workflow will do about it.
 *
 * Every sentence here names the destination stage rather than its region. The
 * region was never the answer — a region holds many stages, and the one a reseat
 * lands on is whichever carries `region_entry`, which the author may drag
 * anywhere in the band. The old copy said "the first {region} stage", which is
 * only the default the write gate assigns when nothing is marked, so it
 * misdescribed every sequence whose checkpoint had been moved.
 *
 * And it promises a reseat only where one happens: `reseatStageLabel()` mirrors
 * `StatusManager::resolve_reseat_stage()`, so the four cases the server leaves
 * the stage alone in are the four cases this says so in.
 *
 * @param {Object}  options                  Message input.
 * @param {string}  options.currentRegion    Side of the publish line the post is on, from `StatusManager::boundary_region()`. Names the "from" half of the sentence; NEVER the reseat decision — see reseatStageLabel().
 * @param {string}  options.stageRegion      Region the post's current stage declares. The reseat authority.
 * @param {string}  options.targetStatus     Core post status the change would write.
 * @param {Object}  options.entryStageLabels Region → entry stage label, for the regions the sequence models.
 * @param {boolean} options.agentPending     Whether a stage agent is running on the post.
 * @return {string} Translated message.
 */
export function getStatusChangeWarning( {
	currentRegion,
	stageRegion,
	targetStatus,
	entryStageLabels,
	agentPending,
} ) {
	const message = describeStatusChange( {
		currentRegion,
		stageRegion,
		targetStatus,
		entryStageLabels,
	} );

	if ( ! agentPending ) {
		return message;
	}

	return `${ message } ${ getAgentInterruptWarning() }`;
}

/**
 * The reseat half of the warn copy, without the agent sentence.
 *
 * @param {Object} options                  Message input, as getStatusChangeWarning().
 * @param {string} options.currentRegion    Boundary region the post is on.
 * @param {string} options.stageRegion      Region the post's current stage declares.
 * @param {string} options.targetStatus     Core post status the change would write.
 * @param {Object} options.entryStageLabels Region → entry stage label.
 * @return {string} Translated message.
 */
function describeStatusChange( {
	currentRegion,
	stageRegion,
	targetStatus,
	entryStageLabels,
} ) {
	// The post's seat did not resolve. Two posts land here: one whose sequence
	// row was deleted (no stages left to resolve), and one carrying a stage its
	// sequence no longer defines. Both are refused outright for a non-bypass
	// user; a bypass user gets this confirm, and for both of them
	// StatusManager::resolve_managed_stage() bails before any reseat, so nothing
	// moves. Saying so is the truthful copy, not a fallback — and it keeps the
	// sentence from naming a region it cannot name.
	//
	// Both regions come from the same resolution on both surfaces, so they are
	// filled together or empty together; either one being empty is the signal.
	if ( ! currentRegion || ! stageRegion ) {
		return __(
			'VIP Workflows cannot resolve this post’s workflow stage, so changing its status leaves the post where it is in the workflow.',
			'vip-workflows'
		);
	}

	// `future` is publish-side for the BOUNDARY (scheduling must not be a way
	// around the publish veto) but an OVERLAY for the reseat: on_status_transition()
	// leaves a scheduled post's stage exactly where it is, and cron's later
	// `future` -> `publish` is what re-seats it. So the stage this names is the
	// one the eventual go-live would land on — and when the sequence models no
	// publish checkpoint, or the stage is already publish-region, cron re-seats
	// nothing either and the copy must not assert a Published stage that does not
	// exist.
	if ( targetStatus === 'future' ) {
		const goLiveStage = reseatStageLabel( {
			stageRegion,
			targetStatus: 'publish',
			entryStageLabels,
		} );

		return goLiveStage
			? sprintf(
					/* translators: %s: name of the workflow stage the post will be moved to, e.g. "Ready to publish". */
					__(
						'Scheduling this post leaves it at its current workflow stage. When it goes live, the workflow re-seats it at “%s”.',
						'vip-workflows'
					),
					goLiveStage
			  )
			: __(
					'Scheduling this post leaves it at its current workflow stage, and it stays there when it goes live.',
					'vip-workflows'
			  );
	}

	const destination = reseatStageLabel( {
		stageRegion,
		targetStatus,
		entryStageLabels,
	} );
	const from = getRegionLabel( currentRegion );
	const to = getRegionLabel( statusToRegion( targetStatus ) );

	// Nothing re-seats, and the two reasons are not the same news. Either the
	// stage already lives in the region core is moving the post to — the case
	// boundary_region() hides, because it reports `publish` for a live post
	// whatever its stage says — or the sequence models no checkpoint there and
	// resolve_reseat_stage() logs and leaves the stage alone.
	if ( ! destination ) {
		return stageRegion === targetStatus
			? sprintf(
					/* translators: 1: current editorial region, e.g. "Published". 2: target editorial region, e.g. "Draft". */
					__(
						'Changing the status from %1$s to %2$s leaves this post at its current workflow stage, which is already a %2$s stage.',
						'vip-workflows'
					),
					from,
					to
			  )
			: sprintf(
					/* translators: 1: current editorial region, e.g. "Draft". 2: target editorial region, e.g. "Published". */
					__(
						'Changing the status from %1$s to %2$s leaves this post at its current workflow stage: its workflow has no %2$s stage to move it to.',
						'vip-workflows'
					),
					from,
					to
			  );
	}

	return sprintf(
		/* translators: 1: current editorial region, e.g. "Draft". 2: target editorial region, e.g. "Published". 3: name of the workflow stage the post will be moved to. */
		__(
			'Changing the status from %1$s to %2$s moves this post out of its current workflow stage and re-seats it at “%3$s”.',
			'vip-workflows'
		),
		from,
		to,
		destination
	);
}

/**
 * Copy for the publish veto: why the change was refused, and the two ways through.
 *
 * @param {Object} options              Message input.
 * @param {string} options.title        Post title.
 * @param {string} options.workflowName Sequence (workflow) name.
 * @return {string} Translated message.
 */
export function getPublishVetoMessage( { title, workflowName } ) {
	return sprintf(
		/* translators: 1: post title. 2: workflow (sequence) name. */
		__(
			'“%1$s” is in the “%2$s” workflow. To publish it directly, remove it from the workflow (this is logged), or move it through the workflow to a published stage.',
			'vip-workflows'
		),
		title,
		workflowName
	);
}

/**
 * Copy for a post whose workflow no longer exists.
 *
 * A post can outlive its sequence: deleting a sequence leaves every post that
 * named it carrying a workflow identity that resolves to nothing. Such a post
 * has no stages and no transitions, but the save-layer predicate still reads
 * its sequence meta and fails CLOSED — so it is frozen at whatever status it
 * happens to hold until it is removed from the workflow.
 *
 * It gets its own sentence rather than the ordinary veto's, because the veto's
 * "move it through the workflow to a published stage" is not available here,
 * and because there is no workflow name left to put in it.
 *
 * @param {Object} options       Message input.
 * @param {string} options.title Post title.
 * @return {string} Translated message.
 */
export function getOrphanedWorkflowMessage( { title } ) {
	return sprintf(
		/* translators: %s: post title. */
		__(
			'“%s” belongs to a workflow that no longer exists, so its status cannot be changed. Remove it from the workflow (this is logged) to edit it as an ordinary post.',
			'vip-workflows'
		),
		title
	);
}

/**
 * Copy for the confirm that precedes removing a post from a deleted workflow.
 *
 * The sibling of getRemoveFromWorkflowConfirmation() for the case where there
 * is no workflow name to name — and where removal is the only way forward
 * rather than one of two.
 *
 * @return {string} Translated message.
 */
export function getOrphanedWorkflowRemoveConfirmation() {
	return __(
		'Remove this post from its deleted workflow? The removal is recorded in the workflow log, with the stage it was removed from. It cannot be undone.',
		'vip-workflows'
	);
}

/**
 * Label for the escape-hatch action offered alongside the veto.
 *
 * @return {string} Translated label.
 */
export function getRemoveFromWorkflowLabel() {
	return __( 'Remove from workflow', 'vip-workflows' );
}

/**
 * Copy for the confirm that precedes removing a post from its workflow.
 *
 * States both consequences the user is agreeing to: the removal is recorded,
 * and it is not reversible — `StatusManager::assign_sequence()` seats the post
 * at the checkpoint of whatever region its status puts it in
 * (`Sequence::get_region_entry_stage()`), which is not necessarily the first
 * stage of that region and is never the stage it was removed from.
 *
 * @param {Object} options              Message input.
 * @param {string} options.workflowName Sequence (workflow) name.
 * @return {string} Translated message.
 */
export function getRemoveFromWorkflowConfirmation( { workflowName } ) {
	return sprintf(
		/* translators: %s: workflow (sequence) name. */
		__(
			'Remove this post from the “%s” workflow? The removal is recorded in the workflow log, with the stage it was removed from. It cannot be undone: re-assigning the workflow later seats the post at its region’s entry stage, not at the stage it was removed from.',
			'vip-workflows'
		),
		workflowName
	);
}

/**
 * Title for the confirm that precedes moving a post to a different workflow.
 *
 * @return {string} Translated title.
 */
export function getSwitchWorkflowConfirmTitle() {
	return __( 'Change this post’s workflow?', 'vip-workflows' );
}

/**
 * Label for the button that proceeds with the change.
 *
 * @return {string} Translated label.
 */
export function getSwitchWorkflowConfirmLabel() {
	return __( 'Change workflow', 'vip-workflows' );
}

/**
 * Copy for the confirm that precedes moving a post to a different workflow.
 *
 * The server allows it — `StatusManager::assign_sequence()` treats a second
 * assignment as a replacement — but it is not a rename. The post is re-seated
 * at the entry stage of whichever region its status puts it in
 * (`Sequence::get_region_entry_stage()`), so wherever it had got to in the
 * sequence it is leaving is gone, and picking the old sequence back does not
 * return it. That is the same consequence getRemoveFromWorkflowConfirmation()
 * spells out, and it is spelled out here for the same reason: the author is
 * agreeing to give up a place, not to re-label one.
 *
 * @param {Object} options                  Message input.
 * @param {string} options.fromWorkflowName Workflow (sequence) name the post is leaving.
 * @param {string} options.toWorkflowName   Workflow (sequence) name it would move to.
 * @return {string} Translated message.
 */
export function getSwitchWorkflowConfirmation( {
	fromWorkflowName,
	toWorkflowName,
} ) {
	return sprintf(
		/* translators: 1: workflow (sequence) name the post is leaving. 2: workflow (sequence) name it would move to. */
		__(
			'Move this post from the “%1$s” workflow to “%2$s”? It gives up its place in “%1$s”: the change is recorded in the workflow log, and the post starts at the “%2$s” entry stage for its current status, not at the stage it is on now.',
			'vip-workflows'
		),
		fromWorkflowName,
		toWorkflowName
	);
}

// Publish the module for the classic list-table surfaces. `class-posts-columns.php`
// enqueues this file's bundle (`build/side-effect.js`) and its inline Quick Edit /
// Bulk Edit script reads `window.vipWorkflowsSideEffect`; an inline script cannot
// import, and a second implementation of the region math or the copy is exactly
// how the surfaces drift apart. The React surfaces import the named exports and
// simply ignore this.
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
