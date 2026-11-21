/**
 * Sequence changes — what a `sequence.updated` row says an edit changed.
 *
 * The server diffs the stored config before and after the write and records a
 * bounded summary on the row (`event_data.changes`; see SequenceAudit). This
 * turns it into the `{ label, value }` pairs the notes preview and dialog
 * already lay out, and counts it for the entry's one-line description.
 *
 * Every stage, role and tool is named by the label copied onto the row when
 * the change was made, never re-resolved, so a later rename doesn't rewrite
 * history.
 *
 * Kept free of React so the description can import it.
 *
 * @package
 */

import { __, _n, sprintf } from '@wordpress/i18n';

import { regionLabel } from '../admin/components/graph/regions';

/**
 * The lists a summary can carry, in the order they are shown.
 */
const LISTS = [
	'stages_added',
	'stages_removed',
	'stages_renamed',
	'regions_changed',
	'agents_changed',
	'transitions_added',
	'transitions_removed',
	'transitions_changed',
];

/**
 * A field the summary names without its value.
 *
 * @param {string} field Field slug.
 * @return {string} Its name.
 */
function fieldName( field ) {
	switch ( field ) {
		case 'name':
			return __( 'name', 'vip-workflows' );
		case 'description':
			return __( 'description', 'vip-workflows' );
		case 'post_types':
			return __( 'post types', 'vip-workflows' );
		case 'settings':
			return __( 'settings', 'vip-workflows' );
		case 'metadata_fields':
			return __( 'metadata fields', 'vip-workflows' );
		case 'stages':
			return __( 'stage details', 'vip-workflows' );
		default:
			return field;
	}
}

/**
 * A pair of stages joined by an arrow.
 *
 * @param {string} from First.
 * @param {string} to   Second.
 * @return {string} "From → To".
 */
function arrow( from, to ) {
	return sprintf(
		/* translators: 1: where something was or started. 2: where it is now or ends. */
		__( '%1$s → %2$s', 'vip-workflows' ),
		from,
		to
	);
}

/**
 * A region by name, or "none" for a stage stored before regions existed.
 *
 * @param {?string} region Region slug.
 * @return {string} Its name.
 */
function regionName( region ) {
	return region ? regionLabel( region ) : __( 'none', 'vip-workflows' );
}

/**
 * How one stage's agent changed.
 *
 * @param {Object} entry `agents_changed` entry.
 * @return {string} The change, in words.
 */
function agentChange( entry ) {
	switch ( entry.change ) {
		case 'added':
			return __( 'agent added', 'vip-workflows' );
		case 'removed':
			return __( 'agent removed', 'vip-workflows' );
		case 'ability':
			return __( 'agent changed', 'vip-workflows' );
		default:
			return __( 'agent routing changed', 'vip-workflows' );
	}
}

/**
 * What changed on one transition: roles and tools, added and removed.
 *
 * @param {Object} entry `transitions_changed` entry.
 * @return {string} The changes, separated by semicolons.
 */
function transitionChange( entry ) {
	const parts = [
		[
			entry.roles_added,
			/* translators: %s: comma-separated role names. */
			__( 'roles added %s', 'vip-workflows' ),
			'name',
		],
		[
			entry.roles_removed,
			/* translators: %s: comma-separated role names. */
			__( 'roles removed %s', 'vip-workflows' ),
			'name',
		],
		[
			entry.tools_added,
			/* translators: %s: comma-separated tool names. */
			__( 'tools added %s', 'vip-workflows' ),
			'label',
		],
		[
			entry.tools_removed,
			/* translators: %s: comma-separated tool names. */
			__( 'tools removed %s', 'vip-workflows' ),
			'label',
		],
	]
		.filter( ( [ items ] ) => items?.length )
		.map( ( [ items, format, key ] ) =>
			sprintf( format, items.map( ( item ) => item[ key ] ).join( ', ' ) )
		);

	return sprintf(
		/* translators: 1: the transition, "From → To". 2: what changed on it. */
		__( '%1$s: %2$s', 'vip-workflows' ),
		arrow( entry.from_label, entry.to_label ),
		parts.join( '; ' )
	);
}

/**
 * One entry of a list, in words.
 *
 * @param {string} list  List name.
 * @param {Object} entry Entry.
 * @return {string} The entry.
 */
function entryText( list, entry ) {
	switch ( list ) {
		case 'stages_added':
		case 'stages_removed':
			return entry.label;
		case 'stages_renamed':
			return arrow( entry.from, entry.to );
		case 'regions_changed':
			return sprintf(
				/* translators: 1: stage name. 2: what changed about it. */
				__( '%1$s: %2$s', 'vip-workflows' ),
				entry.label,
				arrow( regionName( entry.from ), regionName( entry.to ) )
			);
		case 'agents_changed':
			return sprintf(
				/* translators: 1: stage name. 2: what changed about it. */
				__( '%1$s: %2$s', 'vip-workflows' ),
				entry.label,
				agentChange( entry )
			);
		case 'transitions_added':
		case 'transitions_removed':
			return arrow( entry.from_label, entry.to_label );
		case 'transitions_changed':
			return transitionChange( entry );
		default:
			return '';
	}
}

/**
 * The label for a list's line.
 *
 * @param {string} list List name.
 * @return {string} Label.
 */
function listLabel( list ) {
	switch ( list ) {
		case 'stages_added':
			return __( 'Stages added', 'vip-workflows' );
		case 'stages_removed':
			return __( 'Stages removed', 'vip-workflows' );
		case 'stages_renamed':
			return __( 'Stages renamed', 'vip-workflows' );
		case 'regions_changed':
			return __( 'Stage regions changed', 'vip-workflows' );
		case 'agents_changed':
			return __( 'AI stages changed', 'vip-workflows' );
		case 'transitions_added':
			return __( 'Transitions added', 'vip-workflows' );
		case 'transitions_removed':
			return __( 'Transitions removed', 'vip-workflows' );
		default:
			return __( 'Transitions changed', 'vip-workflows' );
	}
}

/**
 * A summary's changes as labeled notes.
 *
 * @param {?Object} changes `event_data.changes`.
 * @return {Array} Notes, each `{ label, value }`. Empty when there is no summary.
 */
export function sequenceChangeNotes( changes ) {
	if ( ! changes ) {
		return [];
	}

	const notes = [];

	if ( changes.previous_name ) {
		notes.push( {
			label: __( 'Name changed from', 'vip-workflows' ),
			value: changes.previous_name,
		} );
	}

	// The name has its own line when the old name was recorded.
	const fields = ( changes.fields_changed ?? [] ).filter(
		( field ) => ! ( 'name' === field && changes.previous_name )
	);
	if ( fields.length ) {
		notes.push( {
			label: __( 'Also changed', 'vip-workflows' ),
			value: fields.map( fieldName ).join( ', ' ),
		} );
	}

	LISTS.forEach( ( list ) => {
		const entries = changes[ list ];
		if ( ! entries?.length ) {
			return;
		}

		notes.push( {
			label: listLabel( list ),
			value: entries
				.map( ( entry ) => entryText( list, entry ) )
				.join( ', ' ),
		} );
	} );

	// A capped list keeps its first entries; the rest are counted, not named,
	// and the count closes the list as a line of its own.
	const more = unlistedCount( changes );
	if ( more > 0 ) {
		notes.push( {
			label: '',
			value: sprintf(
				/* translators: %d: how many changes the list leaves out. */
				_n(
					'And %d more change',
					'And %d more changes',
					more,
					'vip-workflows'
				),
				more
			),
		} );
	}

	return notes;
}

/**
 * How many changes a summary records: one per listed entry, one per field it
 * names, and every entry a capped list left out.
 *
 * @param {?Object} changes `event_data.changes`.
 * @return {number} The count.
 */
export function sequenceChangeCount( changes ) {
	if ( ! changes ) {
		return 0;
	}

	const listed = LISTS.reduce(
		( total, list ) => total + ( changes[ list ]?.length ?? 0 ),
		0
	);

	return (
		listed +
		unlistedCount( changes ) +
		( changes.fields_changed?.length ?? 0 )
	);
}

/**
 * How many entries the capped lists left out.
 *
 * @param {Object} changes `event_data.changes`.
 * @return {number} The count.
 */
function unlistedCount( changes ) {
	return Object.values( changes.truncated ?? {} ).reduce(
		( total, count ) => total + ( Number( count ) || 0 ),
		0
	);
}
