/**
 * Event description — one sentence saying what a workflow event did.
 *
 * The substance of an entry in an activity stream: which stages a post moved
 * between, why a transition was refused, which tool ran and what it returned.
 * Both activity views describe events with this — the admin Audit Log, which
 * serves every event type, and the editor's Workflow History modal, which serves
 * stage changes for one post.
 *
 * Every description is a complete natural-language sentence that names the kind
 * of event as well as what it did — "Stage changed from In Review to Published"
 * — because the entry's title is the post the event happened to, so nothing
 * else in the entry says what kind of event it was.
 *
 * A string rather than markup, because the `activity` layout's description slot
 * renders a field's value the way every other field is rendered: the entry's
 * title is the post it happened to, its attributes are the meta row beneath, and
 * what is left for the description is what the event was and what it did.
 * Attributes that used to be written into this block as extra lines — the
 * sequence's name above all — are fields now, so they line up down the stream
 * instead of being restated per event type.
 *
 * Prose the event carries (a transition's comment, a refusal's reason, a failed
 * ability's error) is folded into the sentence rather than boxed: someone's own
 * words are quoted, an explanation follows a colon.
 *
 * Every stage named here is the label snapshotted onto the event when it
 * happened, falling back to the stage key only for rows written before the label
 * was captured. Stage keys are internal identifiers (`status_3`) that never
 * change when the author renames the stage, so printing one is always a bug.
 * Snapshots are never re-resolved against the current sequence: an entry shows
 * the name the stage had at the time, which is what an audit log owes its reader.
 *
 * @package
 */

import { __, _n, sprintf } from '@wordpress/i18n';

/**
 * The per-stage event family, matched by pattern rather than named.
 *
 * The automation bus emits `stage.{key}.entered` with the stage's key inside the
 * slug, so the set is as open as the sequences an install has authored. The
 * branch it resolves to is named here rather than repeated per stage.
 */
const STAGE_EVENT_KINDS = [
	{ pattern: /^stage\..+\.entered$/, kind: 'stage.entered' },
	{ pattern: /^stage\..+\.completed$/, kind: 'stage.completed' },
];

/**
 * Which branch describes an event.
 *
 * Every slug but the per-stage family answers as itself; those resolve to the
 * one branch that describes them.
 *
 * @param {string} eventType Raw event-type slug.
 * @return {string} The branch to render.
 */
function detailKind( eventType ) {
	return (
		STAGE_EVENT_KINDS.find( ( { pattern } ) => pattern.test( eventType ) )
			?.kind ?? eventType
	);
}

/**
 * The stage a post left, by the name it had at the time.
 *
 * @param {Object} eventData Recorded event payload.
 * @return {string} Stage label.
 */
function fromStage( eventData ) {
	return eventData.from_label || eventData.from_status;
}

/**
 * The stage a post moved to, by the name it had at the time.
 *
 * @param {Object} eventData Recorded event payload.
 * @return {string} Stage label.
 */
function toStage( eventData ) {
	return eventData.to_label || eventData.to_status;
}

/**
 * Follow a summary with the explanation behind it.
 *
 * @param {string} summary What the event did.
 * @param {string} reason  Why — a refusal's reason, an ability's error.
 * @return {string} The sentence.
 */
function withReason( summary, reason ) {
	return sprintf(
		/* translators: 1: what the event did. 2: the reason behind it. */
		__( '%1$s: %2$s', 'vip-workflow' ),
		summary,
		reason
	);
}

/**
 * Follow a summary with what the person who caused it wrote.
 *
 * Quoted, because a comment is someone's own words rather than the plugin's
 * account of what happened.
 *
 * @param {string} summary What the event did.
 * @param {string} comment The comment left on the transition.
 * @return {string} The sentence.
 */
function withComment( summary, comment ) {
	return sprintf(
		/* translators: 1: what the event did. 2: the comment left on it. */
		__( '%1$s — “%2$s”', 'vip-workflow' ),
		summary,
		comment
	);
}

/**
 * One workflow event, described in a line.
 *
 * The description is a full sentence that already names the kind of event —
 * "Stage changed from In Review to Published" — so it stands on its own. An
 * event type with nothing else to say (a workflow removal, whose sequence is
 * the Workflow field) answers with its name instead, rather than an empty line.
 *
 * @param {Object} event Event in canonical shape (event_type_label, event_data).
 * @return {string} The line.
 */
export function eventSummary( event ) {
	return eventDescription( event ) || event.event_type_label;
}

/**
 * Describe what one workflow event did.
 *
 * An event type with nothing left to say once its fields are drawn — a workflow
 * removal, whose sequence is the Workflow field — answers with an empty string,
 * and eventSummary() names it and stops.
 *
 * @param {Object} event Event in canonical shape (event_type, event_data).
 * @return {string} The sentence, or '' when the entry says it all already.
 */
export function eventDescription( event ) {
	const { event_type: eventType, event_data: eventData } = event;

	switch ( detailKind( eventType ) ) {
		// The automation bus records the same stage change StatusManager does,
		// with the same from/to keys and labels on its payload, so it reads the
		// same way. It carries no comment, and that is conditional below, so the
		// branch is shared rather than copied.
		case 'post.stage_changed':
		case 'status_transition': {
			const moved = sprintf(
				/* translators: 1: stage the post left. 2: stage it moved to. */
				__( 'Stage changed from %1$s to %2$s', 'vip-workflow' ),
				fromStage( eventData ),
				toStage( eventData )
			);

			return eventData.comment
				? withComment( moved, eventData.comment )
				: moved;
		}

		// The per-stage events name the stage they are about rather than
		// redescribing the whole move: they exist for automation subscribers
		// keyed to one stage, and the stage change itself is its own entry that
		// already says where the post came from.
		case 'stage.entered':
			return sprintf(
				/* translators: %s: stage the post entered. */
				__( 'Entered the %s stage', 'vip-workflow' ),
				toStage( eventData )
			);

		case 'stage.completed':
			return sprintf(
				/* translators: %s: stage the post finished. */
				__( 'Completed the %s stage', 'vip-workflow' ),
				fromStage( eventData )
			);

		// Going live. Emitted from two places with slightly different payloads —
		// a workflow-driven publish names the stage it came from, a core-driven
		// one does not — so neither is read here.
		case 'post.published':
			return __( 'Went live', 'vip-workflow' );

		// Which sequence the post joined is the Workflow field's to say; what is
		// left is where in it the post starts.
		case 'workflow.assigned':
			return eventData.initial_stage
				? sprintf(
						/* translators: %s: stage the post starts at. */
						__(
							'Assigned to the workflow at the %s stage',
							'vip-workflow'
						),
						eventData.initial_stage_label || eventData.initial_stage
				  )
				: '';

		// The sequence the post left is the Workflow field, and a removal has
		// nothing else to report.
		case 'workflow.removed':
			return '';

		case 'post.claimed':
			return __( 'Claimed for review', 'vip-workflow' );

		case 'post.released':
			return __( 'Released back to the queue', 'vip-workflow' );

		case 'transition_blocked': {
			const refused = sprintf(
				/* translators: 1: stage the post was in. 2: stage it was refused entry to. */
				__(
					'Transition from %1$s to %2$s was blocked',
					'vip-workflow'
				),
				fromStage( eventData ),
				toStage( eventData )
			);

			if ( eventData.reason ) {
				return withReason( refused, eventData.reason );
			}

			// The count only stands in where nothing wrote a reason: a reason
			// names which checks failed, which is what the count says and more.
			if ( eventData.hard_failures?.length ) {
				return withReason(
					refused,
					sprintf(
						/* translators: %d: number of checks that failed. */
						_n(
							'%d failed check',
							'%d failed checks',
							eventData.hard_failures.length,
							'vip-workflow'
						),
						eventData.hard_failures.length
					)
				);
			}

			return refused;
		}

		case 'tool_warnings': {
			const count = eventData.warnings?.length ?? 0;

			return count
				? sprintf(
						/* translators: 1: stage the post moved to. 2: number of warnings. */
						_n(
							'Transition to %1$s raised %2$d warning',
							'Transition to %1$s raised %2$d warnings',
							count,
							'vip-workflow'
						),
						toStage( eventData ),
						count
				  )
				: sprintf(
						/* translators: %s: stage the post moved to. */
						__(
							'Transition to %s raised warnings',
							'vip-workflow'
						),
						toStage( eventData )
				  );
		}

		case 'ability.executed':
			return eventData.output?.score !== undefined
				? sprintf(
						/* translators: 1: ability id. 2: the score it returned. */
						__( 'Ran %1$s (score: %2$s)', 'vip-workflow' ),
						eventData.ability_id,
						eventData.output.score
				  )
				: sprintf(
						/* translators: %s: ability id. */
						__( 'Ran %s', 'vip-workflow' ),
						eventData.ability_id
				  );

		case 'ability.failed': {
			const failed = sprintf(
				/* translators: %s: ability id. */
				__( '%s failed', 'vip-workflow' ),
				eventData.ability_id
			);

			return eventData.error
				? withReason( failed, eventData.error )
				: failed;
		}

		// The sequence's name is the Workflow field; its size is what an edit
		// changed that the entry can state in a line.
		case 'sequence.updated':
			return eventData.statuses_count === undefined
				? ''
				: sprintf(
						/* translators: %d: number of stages in the sequence. */
						_n(
							'Sequence updated, now %d stage',
							'Sequence updated, now %d stages',
							eventData.statuses_count,
							'vip-workflow'
						),
						eventData.statuses_count
				  );

		// The direction is the whole fact: activation only ever moves
		// draft → active, and the payload's `previous_status` /
		// `sequence_status` are machine slugs this file must not print (its
		// header calls printing a raw key a bug). Anyone inspecting the event
		// still finds both states on its payload.
		case 'sequence.activated':
			return __( 'Sequence activated', 'vip-workflow' );

		case 'sequence.deactivated':
			return __( 'Sequence deactivated', 'vip-workflow' );

		// The nightly prune. Counts are the whole story when it worked; when a
		// DELETE failed the count is null and the error is what a reader needs,
		// so say that instead of printing "0 deleted" over a broken run.
		case 'maintenance.cleanup': {
			if ( eventData.errors?.length ) {
				return sprintf(
					/* translators: %s: the database error the cleanup run reported. */
					__( 'Cleanup failed: %s', 'vip-workflow' ),
					eventData.errors[ 0 ]
				);
			}

			const deleted =
				( eventData.ability_results_deleted ?? 0 ) +
				( eventData.events_deleted ?? 0 );

			return sprintf(
				/* translators: %d: number of expired rows deleted. */
				_n(
					'Cleanup removed %d expired row',
					'Cleanup removed %d expired rows',
					deleted,
					'vip-workflow'
				),
				deleted
			);
		}

		default:
			return '';
	}
}

export default eventDescription;
