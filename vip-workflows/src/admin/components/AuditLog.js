/**
 * Audit Log component — DataViews implementation.
 *
 * The whole workflow-events stream, for every post and every event type.
 *
 * The event itself — its icon, its title, its description, its sequence, its
 * actor and its date — is rendered by the shared fields in
 * `workflow-event-fields`, which the editor's Workflow History modal also
 * composes. What is left here is what only this screen has: the type and user
 * filters, the post an event is about, its fetching, and the search box.
 *
 * The `activity` layout's field roles are set in activityView(), plus:
 *
 * - `titleField: post` — the post an event happened to, which is what a reader
 *   scanning the whole stream is looking for; the description under it says what
 *   the event was. The history modal leaves this unset, where every entry is the
 *   same post and a repeated title would say nothing.
 * - `fields: [ created_at, actor, sequence ]` — the inline meta row under the
 *   description. The layout renders each label visually hidden, so these read as
 *   "30 Nov 2025 · Ada Lovelace · Editorial" rather than as headed columns.
 *
 * @package
 */
import { useState, useEffect, useMemo } from '@wordpress/element';
// DataViews JS is bundled via the /wp subpath. Its stylesheet cannot be imported
// here — the dependency-extraction plugin externalizes every `@wordpress/*`
// request, including the CSS — so it is copied into build/ at build time and
// enqueued as `vip-workflow-dataviews` (see class-admin.php).
import { DataViews } from '@wordpress/dataviews/wp';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { EventNotesModal } from '../../common/EventNotesModal';
import {
	activityView,
	eventActorField,
	eventDateField,
	eventDescriptionField,
	eventIconField,
	eventPostField,
	eventTypeField,
	eventWorkflowField,
	viewNotesAction,
} from '../../common/workflow-event-fields';

const PER_PAGE = 25;

// Maps DataViews field ids to the orderby values the REST controller accepts.
const ORDERBY_MAP = {
	created_at: 'created_at',
	event_type: 'event_type',
	post: 'post_id',
};

const DEFAULT_VIEW = activityView( {
	perPage: PER_PAGE,
	titleField: 'post',
	// The title, description and media fields are named here and in
	// activityView(); listing them below too would render each of them twice.
	fields: [ 'created_at', 'actor', 'sequence' ],
} );

/**
 * Build the REST query string from the current DataViews view object.
 *
 * @param {Object} view - DataViews view state.
 * @return {string} URL-encoded query string.
 */
function buildQuery( view ) {
	const params = new URLSearchParams( {
		page: String( view.page ),
		per_page: String( view.perPage ),
		orderby: ORDERBY_MAP[ view.sort?.field ] || 'created_at',
		order: view.sort?.direction || 'desc',
	} );

	if ( view.search ) {
		params.set( 'search', view.search );
	}

	for ( const filter of view.filters || [] ) {
		const values = Array.isArray( filter.value )
			? filter.value
			: [ filter.value ];
		if ( filter.field === 'event_type' ) {
			values.forEach( ( value ) =>
				params.append( 'event_type[]', value )
			);
		}
		if ( filter.field === 'actor' ) {
			values.forEach( ( value ) => params.append( 'user_id[]', value ) );
		}
	}

	return params.toString();
}

export function AuditLog() {
	const [ data, setData ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ paginationInfo, setPaginationInfo ] = useState( {
		totalItems: 0,
		totalPages: 1,
	} );
	const [ view, setView ] = useState( DEFAULT_VIEW );
	const [ notesModal, setNotesModal ] = useState( null ); // { notes: [], title: '' }

	// Filter option elements.
	const [ eventTypeElements, setEventTypeElements ] = useState( [] );
	const [ userElements, setUserElements ] = useState( [] );

	// Fetch filter options on mount.
	useEffect( () => {
		Promise.all( [
			apiFetch( { path: '/vip-workflow/v1/audit-log/event-types' } ),
			apiFetch( { path: '/vip-workflow/v1/audit-log/users' } ),
		] )
			.then( ( [ typesRes, usersRes ] ) => {
				setEventTypeElements(
					typesRes.map( ( t ) => ( {
						value: t.value,
						label: t.label,
					} ) )
				);
				setUserElements(
					usersRes.map( ( u ) => ( {
						value: String( u.value ),
						label: u.label,
					} ) )
				);
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Failed to load filter options:', err );
			} );
	}, [] );

	const query = useMemo( () => buildQuery( view ), [ view ] );

	// Fetch events whenever the view (and therefore the query) changes.
	useEffect( () => {
		let cancelled = false;
		setIsLoading( true );

		apiFetch( { path: `/vip-workflow/v1/audit-log?${ query }` } )
			.then( ( response ) => {
				if ( cancelled ) {
					return;
				}
				setData( response.events );
				setPaginationInfo( {
					totalItems: response.total,
					totalPages: response.total_pages,
				} );
				setIsLoading( false );
			} )
			.catch( ( err ) => {
				if ( cancelled ) {
					return;
				}
				// eslint-disable-next-line no-console
				console.error( 'Failed to load audit log:', err );
				setIsLoading( false );
			} );

		return () => {
			cancelled = true;
		};
	}, [ query ] );

	const fields = useMemo(
		() => [
			eventIconField(),
			// This screen is the one that lets a reader re-sort; ORDERBY_MAP
			// carries the choice through to the route.
			eventDateField( { enableSorting: true } ),
			eventTypeField( {
				elements: eventTypeElements,
				enableFiltering: true,
			} ),
			eventActorField( {
				elements: userElements,
				enableFiltering: true,
			} ),
			eventWorkflowField(),
			// Only this screen serves a post object — a post's own history is
			// one post's — but the field belongs with the rest of the entry's
			// anatomy rather than beside its fetching. ORDERBY_MAP carries its
			// sort through to the route as post_id.
			eventPostField(),
			eventDescriptionField( { onShowNotes: setNotesModal } ),
		],
		[ eventTypeElements, userElements ]
	);

	// Everything a reader can do with an entry, in the layout's own ellipsis
	// menu. Neither is primary: an audit log is read down the page, and a button
	// per row would compete with the entries for attention.
	const actions = useMemo(
		() => [
			// "Edit", not "Open": the destination is the editor. The object
			// keeps the verb honest on an event row — bare "Edit" would read
			// as editing the log entry (the same reason Save keeps its noun
			// where two Saves share a screen).
			{
				id: 'view-post',
				label: __( 'Edit post', 'vip-workflow' ),
				isEligible: ( item ) => !! item.post?.edit_link,
				callback: ( [ item ] ) => {
					window.location.assign( item.post.edit_link );
				},
			},
			viewNotesAction( { onShowNotes: setNotesModal } ),
		],
		[]
	);

	return (
		// The panel is the shared card surface wrapped around DataViews — the
		// same block <div> every other DataViews panel uses. The class beside
		// it styles nothing of its own: it scopes the two vendored-DataViews
		// fixes in workflow-event-fields.css, which the history modal shares.
		// wpds-allow R7 -- not a styled <div>: .vip-workflow-audit-log is a scope hook with no declarations of its own, and <Stack> is display:flex, which would change the box DataViews lays itself out in
		<div className="vip-workflow-audit-log vip-workflow-card-surface">
			<DataViews
				data={ data }
				fields={ fields }
				actions={ actions }
				view={ view }
				onChangeView={ setView }
				paginationInfo={ paginationInfo }
				isLoading={ isLoading }
				defaultLayouts={ { activity: {} } }
				searchLabel={ __( 'Search audit log', 'vip-workflow' ) }
				getItemId={ ( item ) => String( item.id ) }
			/>

			{ notesModal && (
				<EventNotesModal
					notes={ notesModal.notes }
					title={ notesModal.title }
					onClose={ () => setNotesModal( null ) }
				/>
			) }
		</div>
	);
}

export default AuditLog;
