/**
 * Shared card utilities.
 *
 * Constants, helpers, and components reused across card types
 * to avoid duplication.
 */

import { useCallback, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import { markdownToPlainText } from '../../markdown';
import { Modal, Button, TextareaControl } from '@wordpress/components';
import { Card, CollapsibleCard } from '@wordpress/ui';
import {
	pin as pinIcon,
	closeSmall,
	trash,
	undo,
	external,
	search,
} from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';

import { ModalBody } from '../../../../common/ModalBody';
import { ModalActions } from '../../../../common/ModalActions';

import './shared.css';

export const AI_ICON = (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
	>
		<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
	</svg>
);

// Document-page "has notes" glyph. Shared by the article and document card
// "has notes" indicators. (ImageCard uses a smaller white-stroked overlay
// variant of its own, so it is intentionally not shared here.)
export const NOTES_ICON = (
	<svg
		width="12"
		height="12"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
	>
		<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
		<polyline points="14 2 14 8 20 8" />
		<line x1="16" y1="13" x2="8" y2="13" />
		<line x1="16" y1="17" x2="8" y2="17" />
	</svg>
);

/**
 * Parse the ai_analysis field which may be a JSON string or object.
 *
 * @param {*} raw The ai_analysis value from the card.
 * @return {Object} Parsed object.
 */
export function parseAiAnalysis( raw ) {
	if ( typeof raw === 'string' ) {
		try {
			return JSON.parse( raw || '{}' );
		} catch {
			return {};
		}
	}
	return raw || {};
}

/**
 * Card detail-modal open state plus the card's activation handlers: a click
 * handler that ignores clicks landing on interactive descendants (buttons, and
 * optionally links) so they don't also open the modal, and a keydown handler
 * giving the focused card the two keys a native button answers to.
 *
 * @param {Object}  [options]               Options.
 * @param {boolean} [options.ignoreAnchors] Also ignore clicks on `<a>` elements
 *                                          (true for article/document cards;
 *                                          false for the image card, whose
 *                                          overlay has no inline links).
 * @return {{modalOpen: boolean, setModalOpen: Function, handleCardClick: Function, handleCardKeyDown: Function}} Modal state and handlers.
 */
export function useCardModal( { ignoreAnchors = true } = {} ) {
	const [ modalOpen, setModalOpen ] = useState( false );
	const handleCardClick = useCallback(
		( e ) => {
			if (
				( ignoreAnchors && e.target.closest( 'a' ) ) ||
				e.target.closest( 'button' ) ||
				e.target.closest( '.components-button' )
			) {
				return;
			}
			e.currentTarget.blur();
			setModalOpen( true );
		},
		[ ignoreAnchors ]
	);
	const handleCardKeyDown = useCallback( ( e ) => {
		/*
		 * The card div is the focus target, so a keystroke meant for the card
		 * always targets it directly. Anything else started in a nested
		 * control — or in the portaled detail modal, whose synthetic events
		 * still bubble through the React tree — and must keep its own default:
		 * preventDefault here would cancel a nested button's activation, or
		 * eat the space typed into the modal's notes field.
		 */
		if ( e.target !== e.currentTarget ) {
			return;
		}
		if ( e.key === 'Enter' || e.key === ' ' ) {
			// Space included, with its default (page scroll) suppressed.
			e.preventDefault();
			e.currentTarget.blur();
			setModalOpen( true );
		}
	}, [] );
	return { modalOpen, setModalOpen, handleCardClick, handleCardKeyDown };
}

/**
 * Summarize-flow state for a card: tracks in-progress / result / error and
 * wraps the `onSummarize` callback with the shared success/error handling.
 *
 * @param {Function} onSummarize Async callback resolving to `{ summary }` or `{ error }`.
 * @return {{summarizing: boolean, summary: ?string, summarizeError: ?string, handleSummarize: Function}} Summarize state and handler.
 */
export function useSummarize( onSummarize ) {
	const [ summarizing, setSummarizing ] = useState( false );
	const [ summary, setSummary ] = useState( null );
	const [ summarizeError, setSummarizeError ] = useState( null );
	const handleSummarize = useCallback( async () => {
		if ( ! onSummarize ) {
			return;
		}
		setSummarizing( true );
		setSummarizeError( null );
		try {
			const result = await onSummarize();
			if ( result?.error ) {
				setSummarizeError( result.error );
			} else if ( result?.summary ) {
				setSummary( result.summary );
			}
		} catch {
			setSummarizeError( __( 'Summarization failed.', 'vip-workflows' ) );
		} finally {
			setSummarizing( false );
		}
	}, [ onSummarize ] );
	return { summarizing, summary, summarizeError, handleSummarize };
}

/**
 * Hook for saving notes on a card source.
 *
 * @param {string} sourceId  Source ID.
 * @param {number} projectId Project ID.
 * @param {string} initial   Initial notes value.
 * @return {Object} { notes, setNotes, savingNotes, handleSaveNotes }
 */
export function useNotes( sourceId, projectId, initial ) {
	const [ notes, setNotes ] = useState( initial || '' );
	const [ savingNotes, setSavingNotes ] = useState( false );

	const handleSaveNotes = useCallback( async () => {
		if ( ! sourceId || ! projectId ) {
			return;
		}
		setSavingNotes( true );
		try {
			await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ projectId }/sources/${ sourceId }`,
				method: 'PUT',
				data: { notes },
			} );
		} catch {
			// Silent.
		} finally {
			setSavingNotes( false );
		}
	}, [ sourceId, projectId, notes ] );

	return { notes, setNotes, savingNotes, handleSaveNotes };
}

/**
 * Shared card detail modal shell.
 *
 * Owns the chrome every card-detail modal shares. Layout: the source "preview"
 * at the top (media + meta + optional excerpt), a separator, then the AI summary
 * in a collapsible card and the user-notes textarea. Every action lives in the
 * footer — the card passes its own `actions` (open source, generate/regenerate)
 * and the shell appends the primary "Save notes" button.
 *
 * @param {Object}   props
 * @param {string}   props.title              Modal title.
 * @param {string}   [props.size]             Modal size (default `large`).
 * @param {string}   [props.className]        Extra modal className (e.g. the media variant).
 * @param {Function} props.onClose            Close handler.
 * @param {*}        [props.media]            Optional media node (image/preview) at the top.
 * @param {*}        props.meta               Meta node (badge + author/date/etc.).
 * @param {*}        [props.excerpt]          Optional source-preview node (excerpt/content).
 * @param {*}        props.summary            AI summary content, shown in the collapsible card.
 * @param {string}   [props.summaryTitle]     Collapsible card header (default "AI Summary").
 * @param {*}        [props.actions]          Footer action nodes (open source, generate/regenerate).
 * @param {string}   props.notes              Current notes.
 * @param {Function} props.setNotes           Notes setter.
 * @param {boolean}  props.savingNotes        Whether the notes save is in progress.
 * @param {Function} props.handleSaveNotes    Save handler.
 * @param {string}   [props.notesPlaceholder] Notes textarea placeholder.
 * @return {JSX.Element} The card detail modal.
 */
export function CardDetailModal( {
	title,
	size = 'large',
	className,
	onClose,
	media,
	meta,
	excerpt,
	summary,
	summaryTitle = __( 'AI Summary', 'vip-workflows' ),
	actions,
	notes,
	setNotes,
	savingNotes,
	handleSaveNotes,
	notesPlaceholder,
} ) {
	const classNames = [
		'vip-workflows-ideation-detail-modal',
		'vip-workflows-modal--truncate-title',
		className,
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<Modal
			title={ title }
			onRequestClose={ onClose }
			className={ classNames }
			size={ size }
		>
			<ModalBody>
				{ media }
				{ meta }
				{ excerpt }

				<hr className="vip-workflows-ideation-detail-modal__separator" />

				<CollapsibleCard.Root
					defaultOpen
					className="vip-workflows-ideation-detail-modal__summary-card"
				>
					<CollapsibleCard.Header>
						<Card.Title>{ summaryTitle }</Card.Title>
					</CollapsibleCard.Header>
					<CollapsibleCard.Content>
						{ summary }
					</CollapsibleCard.Content>
				</CollapsibleCard.Root>

				<TextareaControl
					__nextHasNoMarginBottom
					label={ __( 'Notes', 'vip-workflows' ) }
					value={ notes }
					onChange={ setNotes }
					placeholder={
						notesPlaceholder ||
						__( 'Add your notes…', 'vip-workflows' )
					}
					rows={ 6 }
				/>
			</ModalBody>

			<ModalActions>
				{ actions }
				<Button
					variant="primary"
					onClick={ handleSaveNotes }
					isBusy={ savingNotes }
					disabled={ savingNotes }
				>
					{ __( 'Save notes', 'vip-workflows' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}

/**
 * Build a search query from a card's content for the "Find similar" feature.
 *
 * @param {Object} card The card data.
 * @return {{ assistant: string, query: string }} Assistant ID and query string.
 */
/**
 * A remote image that degrades to a neutral tile instead of the browser's
 * broken-image glyph.
 *
 * Card images are hotlinked straight from the source site, so whether one
 * renders is outside our control: hotlink protection answers 403 to a request
 * whose Referer is this admin, scraped og:image URLs go stale, and the admin's
 * CSP or a cross-origin-resource-policy header can refuse the load. On a
 * research board that is a third of the grid showing a broken icon.
 *
 * State rather than the imperative `e.target.style.display` + reveal-a-sibling
 * approach used elsewhere: that sibling only exists when there is no image to
 * begin with, so it hides the broken image and reveals nothing. Failure is a
 * rendering decision, so it belongs in render.
 *
 * This owns the swap, not the layout — it renders the same `className` on either
 * branch so the caller's own sizing applies to both, and the caller keeps
 * whatever wrapper it already had. Reset on `src` change, or one dead URL would
 * poison the slot for every later card reusing the instance.
 *
 * @param {Object} props             Component props.
 * @param {string} props.src         Remote image URL.
 * @param {string} [props.alt]       Alt text; decorative by default.
 * @param {string} [props.className] Applied to the image and to the fallback.
 * @return {JSX.Element|null} Image, fallback tile, or nothing when there is no src.
 */
export function CardThumb( { src, alt = '', className = '' } ) {
	const [ failedSrc, setFailedSrc ] = useState( null );

	if ( ! src ) {
		return null;
	}

	if ( failedSrc === src ) {
		return (
			<span
				className={ `${ className } vip-workflows-ideation-card__image-unavailable`.trim() }
				role="img"
				aria-label={ __( 'Image unavailable', 'vip-workflows' ) }
			/>
		);
	}

	return (
		<img
			src={ src }
			alt={ alt }
			className={ className }
			loading="lazy"
			onError={ () => setFailedSrc( src ) }
		/>
	);
}

/**
 * How much card body to show on the board before the detail modal takes over.
 *
 * One number for every card type. There were four: DocumentCard truncated at
 * 100, ArticleCard at 120, the detail modal gates on 200, and an earlier version
 * of this change added a fourth at 300. None of the first three had a recorded
 * rationale. Four lines of clamped text is roughly this many characters.
 */
export const CARD_PREVIEW_LIMIT = 300;

/**
 * The text a card shows on the board.
 *
 * Prefers the full body when it is short enough to read inline, because content
 * whose meaning lives in its line structure — a poem, a list, a snippet — is
 * destroyed by an excerpt. Assistants routinely send a first-line excerpt for
 * exactly that kind of content, so rendering the excerpt alone dropped the
 * source on the floor.
 *
 * Two guards on that preference:
 *
 *   - the body must be at least as long as the excerpt. A paywall notice or a
 *     consent banner is short, and without this it would outrank a real
 *     editorial summary.
 *   - the body must be non-blank once trimmed, so whitespace never displaces
 *     text.
 *
 * Line breaks in the result survive to the DOM; `.vip-workflows-ideation-card__excerpt`
 * carries `white-space: pre-line` and clamps to four lines.
 *
 * @param {Object} card    The card.
 * @param {number} [limit] Max characters before truncation.
 * @return {string} Preview text, possibly truncated, or '' when the card has neither.
 */
export function getCardPreview( card, limit = CARD_PREVIEW_LIMIT ) {
	// Scraped excerpts and bodies are markdown, and the card preview is a
	// truncated plain-text slot rather than a rendered one — so the markup is
	// stripped here instead of rendered. Truncating first would also cut through
	// a `[label](url)` and leave half of it on screen.
	const excerpt = markdownToPlainText( card?.excerpt ?? '' );
	const content = markdownToPlainText( card?.content ?? '' );

	const preferBody =
		content && content.length <= limit && content.length >= excerpt.length;

	const body = preferBody ? content : excerpt;

	return body.length > limit ? body.substring( 0, limit ) + '...' : body;
}

export function buildSimilarQuery( card ) {
	const type = card.source_type || card.type || '';
	const title = card.title || '';
	const isMedia = type === 'image' || type === 'video';

	const query = title.length > 80 ? title.substring( 0, 80 ) : title;
	const fallback = isMedia
		? 'vip-workflows/media-scout'
		: 'vip-workflows/web-researcher';
	const assistant = card.ability_id || fallback;

	return { assistant, query };
}

/**
 * Action buttons shown on every card. Renders either
 * dismissed actions (restore + delete) or default actions
 * (pin + optional external + find similar + dismiss).
 *
 * @param {Object}   props
 * @param {boolean}  props.isDismissed   Whether the card is dismissed.
 * @param {boolean}  props.isPinned      Whether the card is pinned.
 * @param {Function} props.onRestore     Restore handler.
 * @param {Function} props.onDelete      Delete handler.
 * @param {Function} props.onPin         Pin handler.
 * @param {Function} props.onUnpin       Unpin handler.
 * @param {Function} props.onDismiss     Dismiss handler.
 * @param {Function} props.onFindSimilar Find similar handler (assistant, query).
 * @param {string}   props.url           Optional external URL.
 * @return {JSX.Element} Action buttons.
 */
export function CardActions( {
	isDismissed,
	isPinned,
	onRestore,
	onDelete,
	onPin,
	onUnpin,
	onDismiss,
	onFindSimilar,
	url,
} ) {
	if ( isDismissed ) {
		return (
			<>
				<Button
					icon={ undo }
					onClick={ onRestore }
					label={ __( 'Restore', 'vip-workflows' ) }
					showTooltip
					className="vip-workflows-ideation-card__action"
					size="small"
				/>
				<Button
					icon={ trash }
					onClick={ onDelete }
					label={ __( 'Delete', 'vip-workflows' ) }
					showTooltip
					className="vip-workflows-ideation-card__action vip-workflows-ideation-card__action--delete"
					size="small"
					isDestructive
				/>
			</>
		);
	}

	return (
		<>
			{ onPin && (
				<Button
					icon={ pinIcon }
					onClick={ isPinned ? onUnpin : onPin }
					label={
						isPinned
							? __( 'Unpin', 'vip-workflows' )
							: __( 'Pin', 'vip-workflows' )
					}
					showTooltip
					className={ `vip-workflows-ideation-card__action ${
						isPinned ? 'is-active' : ''
					}` }
					size="small"
				/>
			) }
			{ url && (
				<Button
					icon={ external }
					href={ url }
					target="_blank"
					label={ __( 'Open', 'vip-workflows' ) }
					showTooltip
					className="vip-workflows-ideation-card__action"
					size="small"
				/>
			) }
			{ onFindSimilar && (
				<Button
					icon={ search }
					onClick={ onFindSimilar }
					label={ __( 'Find similar', 'vip-workflows' ) }
					showTooltip
					className="vip-workflows-ideation-card__action"
					size="small"
				/>
			) }
			<Button
				icon={ closeSmall }
				onClick={ onDismiss }
				label={ __( 'Dismiss', 'vip-workflows' ) }
				showTooltip
				className="vip-workflows-ideation-card__action vip-workflows-ideation-card__action--dismiss"
				size="small"
			/>
		</>
	);
}
