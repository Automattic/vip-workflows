/**
 * Event type icon — the glyph on an activity stream's timeline rail.
 *
 * The DataViews `activity` layout draws a small disc per entry and fills it with
 * the view's `mediaField`; with no such field it falls back to a plain bullet,
 * which is what both of this plugin's activity views used to show. Every row
 * carried the same dot, so the rail said nothing until you read the entry.
 *
 * Both views read this module — the admin Audit Log, which serves every event
 * type, and the editor's Workflow History modal, whose route is filtered to
 * stage changes and so draws the one glyph throughout. Sharing the map is what
 * keeps a stage change looking like a stage change in both places.
 *
 * The icon is decorative: the entry names its event beside it, as the title in
 * words, so the SVG is hidden from assistive technology rather than announced
 * twice.
 *
 * @package
 */

import {
	arrowRight,
	caution,
	check,
	close,
	error,
	globe,
	info,
	linkOff,
	lock,
	login,
	notAllowed,
	pencil,
	plusCircle,
	published,
	tool,
	trash,
	unlock,
} from '@wordpress/icons';
import { Icon } from '@wordpress/ui';

import './EventTypeIcon.css';

/**
 * Glyph and tone for each event type the plugin writes.
 *
 * Keyed by the raw `event_type` slug stored on the row. The tones are the
 * semantic set the design tokens name (success / info / warning / error /
 * neutral), so an entry that went wrong reads as red on the rail without opening
 * it.
 *
 * Two subsystems write to the workflow-events table and the audit log serves
 * both, so both are covered here:
 *
 *  - StatusManager and the ability tools write the transition and configuration
 *    events (`status_transition`, `sequence.updated`, …), which are the ones
 *    StatusManager::event_type_label() names in words.
 *  - The automation EventBus stores every event it emits (see EventRegistry for
 *    the vocabulary): the lifecycle events below, plus the per-stage
 *    `stage.{key}.entered` family that STAGE_EVENT_ICONS matches.
 *
 * Glyphs are deliberately not all distinct. Some of these are the same
 * occurrence surfaced by two subsystems — `status_transition` and
 * `post.stage_changed` are one stage change — and drawing them alike is the
 * honest reading, not a collision.
 */
const EVENT_TYPE_ICONS = {
	// A post moved between stages: the arrow is the transition itself.
	status_transition: { icon: arrowRight, tone: 'success' },
	// A transition that was refused — a no-entry sign, not an error glyph, since
	// nothing failed: the move was simply not allowed.
	transition_blocked: { icon: notAllowed, tone: 'error' },
	tool_warnings: { icon: caution, tone: 'warning' },
	// A post entering a workflow, and leaving it: joined, then unlinked.
	'workflow.assigned': { icon: login, tone: 'info' },
	'workflow.removed': { icon: linkOff, tone: 'warning' },
	// Claim and release are one pair, so their glyphs are one pair.
	'post.claimed': { icon: lock, tone: 'info' },
	'post.released': { icon: unlock, tone: 'neutral' },
	'ability.executed': { icon: tool, tone: 'info' },
	'ability.failed': { icon: error, tone: 'error' },
	// Sequence configuration: edited, switched on, switched off.
	'sequence.updated': { icon: pencil, tone: 'neutral' },
	'sequence.activated': { icon: check, tone: 'success' },
	'sequence.deactivated': { icon: close, tone: 'neutral' },

	// Automation lifecycle events (EventRegistry). A stage change and a workflow
	// assignment reach the table from both subsystems, so they draw alike.
	'post.stage_changed': { icon: arrowRight, tone: 'success' },
	'post.workflow_assigned': { icon: login, tone: 'info' },
	'post.workflow_completed': { icon: published, tone: 'success' },
	// Went live, publicly — distinct from reaching the last stage of a workflow.
	'post.published': { icon: globe, tone: 'success' },
	// The nightly prune, which is the one thing that reaches the log with no
	// post and no actor behind it.
	'maintenance.cleanup': { icon: trash, tone: 'neutral' },
	'task.created': { icon: plusCircle, tone: 'info' },
	'task.completed': { icon: check, tone: 'success' },
};

/**
 * The per-stage event family, matched by pattern rather than listed.
 *
 * The automation bus emits `stage.{key}.entered` — the stage's key is part of
 * the slug, so the set is as open as the sequences an install has authored and
 * no literal map can hold it. Order matters only in that each pattern is tried
 * in turn; they are mutually exclusive.
 */
const STAGE_EVENT_ICONS = [
	{ pattern: /^stage\..+\.entered$/, icon: login, tone: 'info' },
	{ pattern: /^stage\..+\.completed$/, icon: check, tone: 'success' },
];

/**
 * The glyph for a slug nothing here claims.
 *
 * The Audit Log's type filter is built from `SELECT DISTINCT event_type`, so it
 * serves whatever the table holds: rows written by a version whose event type
 * has since been renamed or retired, and events an extension registered for
 * itself — `EventRegistry::register()` is public, so the vocabulary is open by
 * design. Those get a neutral glyph, so the row still draws a disc on the rail
 * instead of a hole.
 */
const UNCLAIMED_EVENT_ICON = { icon: info, tone: 'neutral' };

/**
 * Resolve the glyph and tone for an event type.
 *
 * @param {string} eventType Raw event-type slug.
 * @return {Object} `{ icon, tone }`.
 */
function resolveIcon( eventType ) {
	if ( EVENT_TYPE_ICONS[ eventType ] ) {
		return EVENT_TYPE_ICONS[ eventType ];
	}

	return (
		STAGE_EVENT_ICONS.find( ( { pattern } ) =>
			pattern.test( eventType )
		) ?? UNCLAIMED_EVENT_ICON
	);
}

/**
 * The icon for one event type.
 *
 * @param {Object} props           Props.
 * @param {string} props.eventType Raw event-type slug, e.g. `workflow.assigned`.
 * @return {JSX.Element} The icon.
 */
export function EventTypeIcon( { eventType } ) {
	const { icon, tone } = resolveIcon( eventType );

	return (
		<Icon
			icon={ icon }
			aria-hidden="true"
			className={ `vip-workflows-event-icon vip-workflows-event-icon--${ tone }` }
		/>
	);
}

export default EventTypeIcon;
