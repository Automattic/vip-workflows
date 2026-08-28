/**
 * Event notes modal — the input a transition collected, in full.
 *
 * A transition can ask for input before it is allowed through (an assignment, a
 * reason, a checklist). The answers are free text and would swamp a stream, so
 * an entry does not describe them — it offers a "View notes" action, and this is
 * where they are read.
 *
 * Opened from both activity views, so both spell a note the same way. In the
 * editor it opens on top of the history modal — a dialog raised from a dialog,
 * which is what the notes are: a detail of the entry underneath, not a new
 * place.
 *
 * @package
 */

import { Button, Modal } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';

import { ModalActions } from './ModalActions';

import './EventNotesModal.css';

/**
 * @param {Object}   props         Props.
 * @param {Array}    props.notes   Notes, each `{ label, value }`.
 * @param {string}   props.title   Dialog title.
 * @param {Function} props.onClose Close handler.
 * @return {JSX.Element} The dialog.
 */
export function EventNotesModal( { notes, title, onClose } ) {
	return (
		<Modal
			title={ title }
			onRequestClose={ onClose }
			className="vip-workflow-event-notes-modal vip-workflow-modal--truncate-title"
			size="medium"
		>
			<Stack
				direction="column"
				gap="lg"
				className="vip-workflow-event-notes-content"
			>
				{ notes.map( ( note, index ) => (
					<Stack
						key={ index }
						direction="column"
						gap="sm"
						className="vip-workflow-event-note-item"
					>
						<Text
							variant="heading-sm"
							render={ <div /> }
							className="vip-workflow-event-note-item__label vip-workflow-eyebrow"
						>
							{ note.label }
						</Text>
						{ /* The value is a box (tinted, ruled, padded) wrapping
						     author-written text, so the box and the type are
						     separate elements: no WPDS component draws that
						     surface, and <Text> styles type rather than a
						     container. */ }
						<div className="vip-workflow-event-note-item__value">
							<Text variant="body-lg">{ note.value }</Text>
						</div>
					</Stack>
				) ) }
			</Stack>
			<ModalActions>
				<Button variant="primary" onClick={ onClose }>
					{ __( 'Close', 'vip-workflow' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}

export default EventNotesModal;
