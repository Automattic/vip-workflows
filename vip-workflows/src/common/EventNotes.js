/**
 * Event notes — the input a transition collected, previewed under the entry.
 *
 * A transition can ask for input before it is allowed through (an assignment, a
 * reason, a checklist). Those answers used to be reachable only from the entry's
 * ellipsis menu, so a stream of stage changes gave no sign of which ones anyone
 * had written anything on. The first two lines sit under the description
 * instead, and the rest is a click away in the same dialog the menu opens.
 *
 * Two lines, because that is enough to tell whether a note is worth opening
 * without letting one long answer push the entries after it off the screen.
 *
 * "View more" appears only when there is more — the clamp is CSS, so whether it
 * caught anything is a question only the laid-out element can answer, and it is
 * re-asked whenever the element's width changes. A link that opened a dialog
 * showing exactly what was already on screen would be a small lie, and the
 * column is narrow enough that a note fits or does not depending on the window.
 *
 * @package
 */

import { Button } from '@wordpress/components';
import { useEffect, useRef, useState } from '@wordpress/element';
import { Text } from '@wordpress/ui';
import { __, sprintf } from '@wordpress/i18n';

import './EventNotes.css';

/**
 * The notes an event actually collected.
 *
 * A transition's input fields are answered into `event_data.notes` whether or
 * not the author filled them in, so an optional field left blank arrives as a
 * note with an empty value. Those are dropped here rather than printed as a
 * label with nothing after it — and dropped in one place, so an entry that
 * offers to show its notes has notes to show.
 *
 * @param {Object} event Event in canonical shape.
 * @return {Array} Notes with something written in them.
 */
export function collectedNotes( event ) {
	return ( event.event_data.notes ?? [] ).filter( ( note ) =>
		note.value?.trim()
	);
}

/**
 * What to hand the notes dialog for an event.
 *
 * Built here so the two ways in — this preview's link and the entry's ellipsis
 * menu — open the same dialog under the same title.
 *
 * @param {Object} event Event in canonical shape.
 * @return {Object} Props for EventNotesModal.
 */
export function notesDialogProps( event ) {
	return {
		notes: collectedNotes( event ),
		title: __( 'Transition Notes', 'vip-workflows' ),
	};
}

/**
 * The notes as one run of text.
 *
 * Labelled, because several answers to several questions read as a list of
 * values otherwise — "Ada Lovelace · needs a second pass" says much less than
 * "Assignee: Ada Lovelace · Reason: needs a second pass". The dialog lays the
 * same pairs out properly; this is the two-line version of them.
 *
 * @param {Array} notes Notes with something written in them.
 * @return {string} The preview text.
 */
function previewText( notes ) {
	return notes
		.map( ( note ) =>
			sprintf(
				/* translators: 1: the question a transition asked. 2: the answer written to it. */
				__( '%1$s: %2$s', 'vip-workflows' ),
				note.label,
				// Answers are free text and may be typed across several lines.
				// The preview is a run of text, so its own line breaks are the
				// only ones that should decide where it wraps.
				note.value.trim().replace( /\s+/g, ' ' )
			)
		)
		.join( ' · ' );
}

/**
 * @param {Object}   props             Props.
 * @param {Array}    props.notes       Notes with something written in them.
 * @param {Function} props.onShowNotes Opens the notes dialog.
 * @return {JSX.Element} The preview.
 */
export function EventNotes( { notes, onShowNotes } ) {
	const [ isClamped, setIsClamped ] = useState( false );
	const previewRef = useRef( null );
	const text = previewText( notes );

	useEffect( () => {
		const preview = previewRef.current;

		// The clamp hides the overflow, so the element's full height is the only
		// evidence of whether anything was cut. The one-pixel margin is for
		// sub-pixel line heights, which round the two measurements apart on a
		// note that in fact fits exactly.
		const measure = () =>
			setIsClamped( preview.scrollHeight > preview.clientHeight + 1 );

		measure();

		const observer = new ResizeObserver( measure );
		observer.observe( preview );

		return () => observer.disconnect();
	}, [ text ] );

	return (
		<>
			<Text
				ref={ previewRef }
				render={ <div /> }
				className="vip-workflows-event-notes"
			>
				{ text }
			</Text>
			{ isClamped && (
				<Button
					variant="link"
					className="vip-workflows-event-notes__more"
					onClick={ onShowNotes }
				>
					{ __( 'View more', 'vip-workflows' ) }
				</Button>
			) }
		</>
	);
}

export default EventNotes;
