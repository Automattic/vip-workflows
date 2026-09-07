/**
 * Prompt Preview Modal.
 *
 * Shows full details of a discovery prompt in a clean modal layout.
 */

import { __ } from '@wordpress/i18n';
import { Modal, Button } from '@wordpress/components';
import { Badge, Link, Stack, Text } from '@wordpress/ui';

import { ModalActions } from '../../../common/ModalActions';
import {
	formatDateTime,
	formatPartialDate,
	isSameDay,
} from '../../../common/datetime';

import './PromptPreviewModal.css';

/**
 * @param {Object}   props
 * @param {Object}   props.prompt     The full prompt object.
 * @param {Object}   props.provider   Provider info ({ slug, label, icon }).
 * @param {Function} props.onSelect   Called to use this prompt as a seed.
 * @param {Function} props.onClose    Called to dismiss.
 * @param {boolean}  props.submitting Whether a selection is in progress.
 */
export default function PromptPreviewModal( {
	prompt,
	provider,
	onSelect,
	onClose,
	submitting,
} ) {
	const meta = prompt.meta || {};

	return (
		<Modal
			title={ prompt.title }
			onRequestClose={ onClose }
			className="vip-workflows-ideation-prompt-preview vip-workflows-modal--truncate-title"
			size="medium"
		>
			<Stack
				direction="column"
				gap="xl"
				className="vip-workflows-ideation-prompt-preview__body"
			>
				<Stack
					wrap="wrap"
					gap="sm"
					className="vip-workflows-ideation-prompt-preview__badges"
				>
					{ provider?.label && (
						<Badge intent="none">{ provider.label }</Badge>
					) }
					{ prompt.importance && prompt.importance !== 'normal' && (
						<Badge
							intent={
								prompt.importance === 'key_event'
									? 'medium'
									: 'high'
							}
						>
							{ prompt.importance === 'key_event'
								? __( 'Key Event', 'vip-workflows' )
								: __( 'Top Story', 'vip-workflows' ) }
						</Badge>
					) }
					{ meta.is_embargoed && (
						<Badge intent="high">
							{ __( 'Embargoed', 'vip-workflows' ) }
						</Badge>
					) }
				</Stack>

				<Stack
					direction="column"
					gap="sm"
					className="vip-workflows-ideation-prompt-preview__section"
				>
					<DateDisplay prompt={ prompt } meta={ meta } />
				</Stack>

				{ prompt.description && (
					<Stack
						direction="column"
						gap="sm"
						className="vip-workflows-ideation-prompt-preview__section"
					>
						<Text
							variant="body-md"
							render={ <p /> }
							className="vip-workflows-ideation-prompt-preview__description"
						>
							{ meta.content || prompt.description }
						</Text>
					</Stack>
				) }

				<Stack
					direction="column"
					gap="sm"
					className="vip-workflows-ideation-prompt-preview__details"
				>
					{ prompt.tags?.length > 0 && (
						<DetailRow
							label={ __( 'Topics', 'vip-workflows' ) }
							value={ prompt.tags.join( ', ' ) }
						/>
					) }
					{ meta.event_types?.length > 0 && (
						<DetailRow
							label={ __( 'Event type', 'vip-workflows' ) }
							value={ meta.event_types.join( ', ' ) }
						/>
					) }
					{ meta.address && (
						<DetailRow
							label={ __( 'Location', 'vip-workflows' ) }
							value={ meta.address }
						/>
					) }
					{ meta.embargo_date && (
						<DetailRow
							label={ __( 'Embargo until', 'vip-workflows' ) }
							value={ formatDateTime( meta.embargo_date ) }
						/>
					) }
				</Stack>

				{ meta.links?.length > 0 && (
					<Stack
						direction="column"
						gap="sm"
						className="vip-workflows-ideation-prompt-preview__section"
					>
						<Text
							variant="heading-sm"
							render={ <h4 /> }
							className="vip-workflows-ideation-prompt-preview__section-title vip-workflows-eyebrow"
						>
							{ __( 'Links', 'vip-workflows' ) }
						</Text>
						<Stack
							render={ <ul /> }
							direction="column"
							gap="sm"
							className="vip-workflows-ideation-prompt-preview__links"
						>
							{ meta.links.map( ( link, i ) => (
								<li key={ i }>
									<Link href={ link.url } openInNewTab>
										{ link.description || link.url }
									</Link>
								</li>
							) ) }
						</Stack>
					</Stack>
				) }

				{ meta.contacts?.length > 0 && (
					<Stack
						direction="column"
						gap="sm"
						className="vip-workflows-ideation-prompt-preview__section"
					>
						<Text
							variant="heading-sm"
							render={ <h4 /> }
							className="vip-workflows-ideation-prompt-preview__section-title vip-workflows-eyebrow"
						>
							{ __( 'Contacts', 'vip-workflows' ) }
						</Text>
						<Stack
							render={ <ul /> }
							direction="column"
							gap="sm"
							className="vip-workflows-ideation-prompt-preview__contacts"
						>
							{ meta.contacts.map( ( contact, i ) => (
								<li
									key={ i }
									className="vip-workflows-ideation-prompt-preview__contact"
								>
									{ contact.name && (
										// wpds-allow R7 -- bold inline contact name; no Text variant for label weight
										<span className="vip-workflows-ideation-prompt-preview__contact-name">
											{ contact.name }
										</span>
									) }
									{ contact.role && (
										<span className="vip-workflows-ideation-prompt-preview__contact-role">
											{ contact.role }
										</span>
									) }
									{ contact.email && (
										<Link
											href={ `mailto:${ contact.email }` }
										>
											{ contact.email }
										</Link>
									) }
									{ contact.phone && (
										<span className="vip-workflows-ideation-prompt-preview__contact-phone">
											{ contact.phone }
										</span>
									) }
								</li>
							) ) }
						</Stack>
					</Stack>
				) }
			</Stack>

			<ModalActions>
				{ prompt.url && (
					<Button
						variant="tertiary"
						href={ prompt.url }
						target="_blank"
						rel="noopener noreferrer"
						__next40pxDefaultSize
					>
						{ __( 'Open source', 'vip-workflows' ) }
					</Button>
				) }
				<Button
					variant="primary"
					onClick={ onSelect }
					disabled={ submitting }
					__next40pxDefaultSize
				>
					{ __( 'Use as seed', 'vip-workflows' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}

function DateDisplay( { prompt, meta } ) {
	if ( ! prompt.date ) {
		return null;
	}

	// A prompt's date carries a time only when the source gave one — an event
	// announced for a day has no hour to show, and inventing midnight for it
	// would read as a real start time. `formatPartialDate` owns both halves of
	// that, including reading a day-only value back in UTC so it is not shifted
	// off the day the provider named.
	let dateStr = formatPartialDate( prompt.date, meta.start_has_time );

	if ( meta.month_tbc ) {
		dateStr += ' ' + __( '(month TBC)', 'vip-workflows' );
	} else if ( meta.year_tbc ) {
		dateStr += ' ' + __( '(year TBC)', 'vip-workflows' );
	}

	// A range that begins and ends on one day is that day, so only a genuinely
	// later day earns the second half. The question is asked on the site's
	// clock, where two timestamps hours apart in UTC can be one newsroom day.
	if ( prompt.date_end && ! isSameDay( prompt.date, prompt.date_end ) ) {
		dateStr += ` – ${ formatPartialDate(
			prompt.date_end,
			meta.end_has_time
		) }`;
	}

	return (
		<Text
			variant="heading-md"
			render={ <div /> }
			className="vip-workflows-ideation-prompt-preview__date"
		>
			{ dateStr }
		</Text>
	);
}

function DetailRow( { label, value } ) {
	return (
		<Stack
			gap="md"
			className="vip-workflows-ideation-prompt-preview__detail-row"
		>
			{ /* wpds-allow R7 -- bold inline field label; no Text variant for label weight */ }
			<span className="vip-workflows-ideation-prompt-preview__detail-label">
				{ label }
			</span>
			<span className="vip-workflows-ideation-prompt-preview__detail-value">
				{ value }
			</span>
		</Stack>
	);
}
