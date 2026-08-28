/**
 * Workflow History Modal — a post's transition trail, in a dialog.
 *
 * The trail used to unroll inside the sidebar card, which made the card grow
 * with the post: a long-running article pushed everything below it out of
 * reach, and there was no paging, so it silently stopped at twenty entries.
 * A dialog gives it the room a list needs and the sidebar its length back.
 *
 * A post's history is the audit log filtered to one post and one event type, so
 * it is rendered with the same `activity` layout and the same event fields (see
 * workflow-event-fields): the disc on the rail, the description, the sequence,
 * the actor and the date all come from there. This screen used to interpret a
 * stage change on its own and had drifted — no sequence name, no transition
 * notes, and an actor cell that never marked an agent as one.
 *
 * The one role it sets differently is the title: the audit log titles each entry
 * with the post the event happened to, which here is the post being edited and
 * would repeat down the whole column. With the title unset the layout omits it
 * and the description — "Stage Changed: Ideas → Copy Desk" — leads the entry,
 * which is what a trail for one post wants. The route serves no post object
 * either, so there would be nothing to title with.
 *
 * This module is loaded on demand (see WorkflowPanel): DataViews is bundled
 * rather than externalized, so it is only worth the editor's download budget for
 * a reader who actually opens the history.
 *
 * @package
 */

import { useState, useEffect, useMemo } from '@wordpress/element';
import { DataViews } from '@wordpress/dataviews/wp';
import { Button, Modal } from '@wordpress/components';
import { Text } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { EventNotesModal } from '../../common/EventNotesModal';
import { ModalActions } from '../../common/ModalActions';
import {
	activityView,
	eventActorField,
	eventDateField,
	eventDescriptionField,
	eventIconField,
	eventWorkflowField,
	viewNotesAction,
} from '../../common/workflow-event-fields';

// Seeds both the view's `perPage` and the `per_page` the route is asked with,
// so a page is one number in one place. Five: the trail is read from the top —
// what happened last, and what happened before that — inside a dialog that has
// to sit beside the editor, not a full-width screen a reader scrolls. Anything
// older is a page turn away rather than a scroll away. It is deliberately not
// one of DataViews' default page sizes (10/20/50/100), which costs nothing
// here: the "View options" cog those sizes live behind is not rendered.
const PER_PAGE = 5;

// The route serves newest-first and offers no ordering of its own, so the date
// field is left unsortable (its default) rather than offering a control the
// query would ignore. A trail reads one way.
const DEFAULT_VIEW = activityView( {
	perPage: PER_PAGE,
	// The description and media fields are named in activityView(); listing them
	// here too would render each of them twice. No `titleField`: see above.
	fields: [ 'created_at', 'actor', 'sequence' ],
} );

/**
 * A post's transition history, as a modal.
 *
 * @param {Object}   props         Props.
 * @param {number}   props.postId  Post whose history to show.
 * @param {Function} props.onClose Close handler.
 * @return {JSX.Element} The dialog.
 */
export function WorkflowHistoryModal( { postId, onClose } ) {
	const [ data, setData ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ paginationInfo, setPaginationInfo ] = useState( {
		totalItems: 0,
		totalPages: 1,
	} );
	const [ view, setView ] = useState( DEFAULT_VIEW );
	const [ notesModal, setNotesModal ] = useState( null ); // { notes: [], title: '' }

	const query = useMemo(
		() =>
			new URLSearchParams( {
				page: String( view.page ),
				per_page: String( view.perPage ),
			} ).toString(),
		[ view.page, view.perPage ]
	);

	useEffect( () => {
		let cancelled = false;
		setIsLoading( true );

		// `parse: false` because the totals ride in the response headers, the way
		// core paginates a collection — the parsed body is the page's entries and
		// nothing else. It also turns off apiFetch's own error handling: an
		// unparsed response *resolves* whatever its status, so the status is
		// checked here rather than a 403's error body reaching the table as if it
		// were a page of entries.
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/history?${ query }`,
			parse: false,
		} )
			.then( async ( response ) => {
				const body = await response.json();
				if ( cancelled ) {
					return;
				}
				if ( ! response.ok ) {
					throw new Error(
						body?.message ||
							__( 'Could not load the history.', 'vip-workflows' )
					);
				}
				setData( body );
				setPaginationInfo( {
					totalItems: Number(
						response.headers.get( 'X-WP-Total' ) || 0
					),
					totalPages: Number(
						response.headers.get( 'X-WP-TotalPages' ) || 1
					),
				} );
				setError( null );
				setIsLoading( false );
			} )
			.catch( ( err ) => {
				if ( cancelled ) {
					return;
				}
				setError(
					err.message ||
						__( 'Could not load the history.', 'vip-workflows' )
				);
				setIsLoading( false );
			} );

		return () => {
			cancelled = true;
		};
	}, [ postId, query ] );

	const fields = useMemo(
		() => [
			eventIconField(),
			eventDateField(),
			eventActorField(),
			eventWorkflowField(),
			eventDescriptionField( { onShowNotes: setNotesModal } ),
		],
		[]
	);

	// The post is the one being edited, so the audit log's "View post" has
	// nothing to offer here; reading a transition's notes is the whole of what a
	// reader can do with an entry.
	const actions = useMemo(
		() => [ viewNotesAction( { onShowNotes: setNotesModal } ) ],
		[]
	);

	return (
		<Modal
			title={ __( 'Workflow History', 'vip-workflows' ) }
			onRequestClose={ onClose }
			className="vip-workflows-history-modal"
			size="medium"
		>
			{ error ? (
				<Text variant="body-md">{ error }</Text>
			) : (
				<DataViews
					data={ data }
					fields={ fields }
					actions={ actions }
					view={ view }
					onChangeView={ setView }
					paginationInfo={ paginationInfo }
					isLoading={ isLoading }
					defaultLayouts={ { activity: {} } }
					getItemId={ ( item ) => String( item.id ) }
				>
					{ /* Composed rather than left to `DefaultUI`, which draws
					     a whole view-actions row above the stream: a search
					     slot, a filters toggle and a layout switcher that all
					     render nothing here, and the "View options" cog, which
					     paints. A one-post transition trail has no view to
					     configure — one layout, one order the route serves,
					     no fields worth hiding — so the cog offered settings
					     for a view that does not vary, and the row existed to
					     hold it. The same composition the Calendar's day-posts
					     dialog uses.

					     The footer is pagination only: it hides itself at
					     `totalPages <= 1`, and its bulk-actions half is gated
					     to the table and grid layouts. */ }
					<DataViews.Layout />
					<DataViews.Footer />
				</DataViews>
			) }
			<ModalActions>
				<Button variant="primary" onClick={ onClose }>
					{ __( 'Close', 'vip-workflows' ) }
				</Button>
			</ModalActions>

			{ notesModal && (
				<EventNotesModal
					notes={ notesModal.notes }
					title={ notesModal.title }
					onClose={ () => setNotesModal( null ) }
				/>
			) }
		</Modal>
	);
}

export default WorkflowHistoryModal;
