/**
 * Workflow events, as DataViews fields and actions.
 *
 * Both activity views read the workflow-events table: the admin Audit Log serves
 * the whole stream, and the editor's Workflow History modal serves it filtered
 * to one post and one event type. Since the two REST routes hand back the same
 * event shape — `event_type`, its label, the recorded `event_data`, an actor and
 * a timestamp — the fields that render an event are built once, here, instead of
 * each view describing an event its own way.
 *
 * A field descriptor rather than a bare component because that is the seam
 * DataViews offers: `mediaField` / `titleField` / `descriptionField` take field
 * ids, and the meta row takes ids too, so a shared render has to arrive as a
 * field. What stays with each view is only what genuinely differs — which
 * fields it shows, its filters, and where its data comes from.
 *
 * An entry is drawn the way the `activity` layout draws one, with nothing built
 * on top:
 *
 *  - the disc on the rail is the media field, a glyph for the event type;
 *  - the title is the post the event happened to;
 *  - the description says what the event did in one natural sentence — "Stage
 *    changed from In Review to Published" — with the input the transition
 *    collected under it;
 *  - everything else — the sequence, the date, who did it — is a field in the
 *    meta row beneath, so the same attribute sits in the same place down the
 *    whole stream;
 *  - anything a reader can *do* with the entry is an action, and so lives in the
 *    layout's own ellipsis menu.
 *
 * Only four of these carry a render of their own, and each for a reason no
 * string covers: a glyph on the rail, an avatar beside a name, a heading for the
 * title, and the clamped notes under the description. The rest answer with
 * `getValue` and let DataViews render them.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';
import { Text } from '@wordpress/ui';

import { AuthorCell, systemActor } from './DataViewCells';
import { siteDateTimeFormat } from './datetime';
import { eventSummary } from './event-description';
import { collectedNotes, EventNotes, notesDialogProps } from './EventNotes';
import { EventTypeIcon } from './EventTypeIcon';

import './workflow-event-fields.css';

/**
 * The activity-layout view settings both streams share.
 *
 * Rendered with the `activity` layout rather than `table`: an event stream is
 * chronological, which is the shape that layout draws — a timeline rail with one
 * entry per row, newest first. The route serves newest-first in both cases.
 *
 * A function rather than a shared constant, so each view owns its `sort` and
 * `layout` objects outright: two views seeded from one literal would hold the
 * same nested references, and a write through either would reach both.
 *
 * `overrides` carries what is a view's own: its page size, which fields make up
 * the meta row, and whether it shows a title. Note that `titleField`,
 * `descriptionField` and `mediaField` are resolved on their own — an id named
 * there must NOT also appear in `fields`, or the layout draws it twice.
 *
 * @param {Object} overrides View settings this stream sets for itself.
 * @return {Object} A DataViews view object.
 */
export function activityView( overrides ) {
	return {
		type: 'activity',
		search: '',
		filters: [],
		page: 1,
		sort: { field: 'created_at', direction: 'desc' },
		descriptionField: 'details',
		mediaField: 'event_icon',
		layout: {},
		...overrides,
	};
}

/**
 * The disc on the timeline rail.
 *
 * The `activity` layout fills its disc from the view's `mediaField`, falling
 * back to a plain bullet with none set. These events have no avatar or thumbnail
 * of their own, so the disc carries a glyph for the event type instead.
 *
 * @return {Object} DataViews field descriptor.
 */
export function eventIconField() {
	return {
		id: 'event_icon',
		label: __( 'Event type', 'vip-workflow' ),
		// The icon restates what the entry already says, so there is nothing to
		// sort, filter or search by, and nothing worth letting a reader hide.
		enableHiding: false,
		enableSorting: false,
		filterBy: false,
		getValue: ( { item } ) => item.event_type,
		render: ( { item } ) => <EventTypeIcon eventType={ item.event_type } />,
	};
}

/**
 * The event type — what a stream can be filtered and sorted by.
 *
 * Not drawn anywhere of its own: the description already names the kind of
 * event in its sentence ("Stage changed from In Review to Published"), so a
 * column repeating it would say the same thing twice. `enableHiding: false`
 * keeps it out of the view's
 * properties list for that reason rather than offering it as a column a reader
 * can switch on.
 *
 * The value is the label the route resolved, not the raw slug, so sorting and
 * searching read as the reader does. `elements` is still the slug/label pairing,
 * because that is what the filter's option list and the query behind it are
 * keyed on.
 *
 * @param {Object}  [options]                 Options.
 * @param {Array}   [options.elements]        Filter options, `{ value, label }`.
 * @param {boolean} [options.enableFiltering] Whether to offer a type filter.
 * @return {Object} DataViews field descriptor.
 */
export function eventTypeField( { elements, enableFiltering = false } = {} ) {
	return {
		id: 'event_type',
		label: __( 'Event', 'vip-workflow' ),
		elements,
		enableHiding: false,
		filterBy: enableFiltering
			? { operators: [ 'isAny' ], isPrimary: true }
			: false,
		enableGlobalSearch: true,
		getValue: ( { item } ) => item.event_type_label,
	};
}

/**
 * The post the event happened to — the entry's title.
 *
 * A heading rather than the layout's unstyled default, because it is what a
 * reader scanning the whole stream is looking for and the description under it
 * is a sentence, not a subtitle. `heading-lg` is the smallest step that reads as
 * a heading beside body text rather than as bolder body text.
 *
 * Not a link: opening the post is the "View post" action, so the title is not
 * also a second way in.
 *
 * Not every event happened to a post — a sequence being edited did not — and
 * those answer with nothing at all rather than an empty heading, so the layout's
 * title slot collapses instead of leaving a blank band above the description.
 *
 * @return {Object} DataViews field descriptor.
 */
export function eventPostField() {
	return {
		id: 'post',
		label: __( 'Post', 'vip-workflow' ),
		enableSorting: true,
		filterBy: false,
		enableGlobalSearch: true,
		getValue: ( { item } ) => item.post?.title || '',
		render: ( { item } ) =>
			item.post ? (
				<Text variant="heading-lg">{ item.post.title }</Text>
			) : null,
	};
}

/**
 * What happened — the entry's description.
 *
 * What the event did, said in one sentence that also names the kind of event —
 * "Stage changed from In Review to Published" — since the title above it is
 * the post rather than the event. That sentence is also the value, so search
 * and sort see what a reader sees.
 *
 * Where a transition collected input, the first two lines of it follow on their
 * own line. That is the one thing here the layout cannot draw from a string: a
 * clamp, and a link out to the rest.
 *
 * @param {Object}   options             Options.
 * @param {Function} options.onShowNotes Opens the notes dialog, `{ notes, title }`.
 * @return {Object} DataViews field descriptor.
 */
export function eventDescriptionField( { onShowNotes } ) {
	return {
		id: 'details',
		label: __( 'Details', 'vip-workflow' ),
		enableSorting: false,
		filterBy: false,
		getValue: ( { item } ) => eventSummary( item ),
		render: ( { item } ) => {
			const notes = collectedNotes( item );

			return (
				<>
					{ eventSummary( item ) }
					{ !! notes.length && (
						<EventNotes
							notes={ notes }
							onShowNotes={ () =>
								onShowNotes( notesDialogProps( item ) )
							}
						/>
					) }
				</>
			);
		},
	};
}

/**
 * Which sequence the event belongs to.
 *
 * Named on the payload of every event that has one, and absent from the rest —
 * an ability run outside a workflow, say. The layout hides a meta field whose
 * value is empty, so those entries drop the slot instead of carrying a
 * placeholder.
 *
 * @return {Object} DataViews field descriptor.
 */
export function eventWorkflowField() {
	return {
		id: 'sequence',
		label: __( 'Workflow', 'vip-workflow' ),
		enableSorting: false,
		filterBy: false,
		getValue: ( { item } ) => item.event_data.sequence_name || '',
	};
}

/**
 * When the event happened.
 *
 * The format is the site's own, composed from its `date_format` and
 * `time_format` settings (see `src/common/datetime.js`). It has to be named
 * rather than left off: the `datetime` field type falls back to
 * `formats.datetime`, which reads no option and is a translatable literal, so
 * the column would disagree with every timestamp the module renders.
 *
 * @param {Object}  [options]               Options.
 * @param {boolean} [options.enableSorting] Whether the reader may re-sort by date.
 * @return {Object} DataViews field descriptor.
 */
export function eventDateField( { enableSorting = false } = {} ) {
	return {
		id: 'created_at',
		type: 'datetime',
		label: __( 'Date', 'vip-workflow' ),
		enableHiding: false,
		enableSorting,
		filterBy: false,
		format: { datetime: siteDateTimeFormat() },
	};
}

/**
 * Who did it — a person, the agent that acted, or the site itself.
 *
 * An event no user can be credited for (a cron run, a deleted account) has a
 * null actor. The route says so by omitting it rather than inventing a user, so
 * the reading is made here: that event was the site's own doing, and it reads
 * as "System" behind the WordPress mark.
 *
 * @param {Object}  [options]                 Options.
 * @param {Array}   [options.elements]        Filter options, `{ value, label }`.
 * @param {boolean} [options.enableFiltering] Whether to offer a user filter.
 * @return {Object} DataViews field descriptor.
 */
export function eventActorField( { elements, enableFiltering = false } = {} ) {
	return {
		id: 'actor',
		label: __( 'User', 'vip-workflow' ),
		elements,
		filterBy: enableFiltering
			? { operators: [ 'isAny' ], isPrimary: true }
			: false,
		enableSorting: false,
		// Both halves resolve the actor the same way, so the value a reader can
		// search and sort on is the one they can see. Reading `item.actor`
		// directly here would hand back '' for a system event while the cell
		// beside it plainly says "System" — searching for the word on screen
		// would then match nothing.
		getValue: ( { item } ) => ( item.actor ?? systemActor() ).display_name,
		render: ( { item } ) => (
			<AuthorCell actor={ item.actor ?? systemActor() } />
		),
	};
}

/**
 * Read the input a transition collected, in full.
 *
 * The entry already previews the first two lines of it under the description,
 * and offers "View more" when the clamp caught anything. This is the other way
 * to the same dialog: the menu is where an entry's actions are, and it does not
 * depend on the preview having been cut. Only entries that collected input
 * offer it.
 *
 * @param {Object}   options             Options.
 * @param {Function} options.onShowNotes Opens the notes dialog, `{ notes, title }`.
 * @return {Object} DataViews action descriptor.
 */
export function viewNotesAction( { onShowNotes } ) {
	return {
		id: 'view-notes',
		label: __( 'Open notes', 'vip-workflow' ),
		isEligible: ( item ) => collectedNotes( item ).length > 0,
		callback: ( [ item ] ) => onShowNotes( notesDialogProps( item ) ),
	};
}
