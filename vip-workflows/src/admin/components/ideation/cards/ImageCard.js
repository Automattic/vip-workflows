/**
 * Media Card Component (images and videos).
 *
 * Clickable card that opens a detail modal with full preview,
 * source info, and notes. Videos get an embedded player.
 */

import { useState, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/components';
import { Badge, Card, Link, Stack, Text } from '@wordpress/ui';
import { external } from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';

import {
	AI_ICON,
	parseAiAnalysis,
	useCardModal,
	useNotes,
	CardDetailModal,
	CardActions,
} from './shared';

import { MarkdownText } from '../../markdown';

import './ImageCard.css';

function isVideo( card ) {
	if ( card.source_type === 'video' ) {
		return true;
	}
	const url = card.url || card.image || '';
	return (
		/\.(mp4|webm|ogg)(\?|$)/i.test( url ) ||
		/youtube\.com|youtu\.be|vimeo\.com/i.test( url )
	);
}

function getEmbedUrl( url ) {
	const ytMatch = url.match(
		/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/
	);
	if ( ytMatch ) {
		return `https://www.youtube.com/embed/${ ytMatch[ 1 ] }`;
	}
	const vimeoMatch = url.match( /vimeo\.com\/(\d+)/ );
	if ( vimeoMatch ) {
		return `https://player.vimeo.com/video/${ vimeoMatch[ 1 ] }`;
	}
	return null;
}

export default function ImageCard( {
	card,
	isPinned,
	isDismissed,
	onPin,
	onDismiss,
	onUnpin,
	onRestore,
	onDelete,
	onFindSimilar,
} ) {
	const { modalOpen, setModalOpen, handleCardClick, handleCardKeyDown } =
		useCardModal( {
			ignoreAnchors: false,
		} );
	const [ analyzing, setAnalyzing ] = useState( false );
	const [ analysisText, setAnalysisText ] = useState( card.content || null );
	const [ analysisError, setAnalysisError ] = useState( null );
	const [ mediaError, setMediaError ] = useState( false );

	/*
	 * The grid thumbnail's failed src, not a boolean. Card images are hotlinked
	 * from the source site, so a failure is routine — and keying on the src means
	 * a later card reusing this instance with a working image recovers, where a
	 * boolean would poison the slot.
	 */
	const [ failedThumb, setFailedThumb ] = useState( null );

	const { notes, setNotes, savingNotes, handleSaveNotes } = useNotes(
		card.source_id,
		card.project_id,
		card.notes
	);

	const imageUrl = card.image || card.url || '';
	const sourceUrl = card.url || '';
	const isVideoCard = isVideo( card );

	/*
	 * A thumbnail that fails to load is shown as the card's own placeholder — the
	 * same face a card with no image gets. Not CardThumb: its fallback is a small
	 * inline span sized by the caller, and both images here are sized by element
	 * selectors (`--image > img`, `__video-thumb img`), so a span would collapse.
	 * The card already owns a full-face placeholder design; reusing it keeps a
	 * broken load looking deliberate rather than like a second kind of error.
	 */
	const thumbUnavailable = ! imageUrl || failedThumb === imageUrl;

	const ai = parseAiAnalysis( card.ai_analysis );
	const hasSummary = !! ( analysisText || ai.summary );

	// The modal media preview: fallback on load error, an embedded player or
	// <video> for videos, otherwise the image. Built here to avoid a nested
	// ternary in the JSX.
	const embedUrl = isVideoCard ? getEmbedUrl( sourceUrl ) : null;
	let mediaPreview;
	if ( mediaError ) {
		mediaPreview = (
			<Stack
				align="center"
				justify="center"
				className="vip-workflows-ideation-media-modal__fallback"
			>
				<Text variant="body-sm">
					{ __( 'Preview unavailable.', 'vip-workflows' ) }
				</Text>
			</Stack>
		);
	} else if ( embedUrl ) {
		mediaPreview = (
			<iframe
				src={ embedUrl }
				title={ card.title || '' }
				className="vip-workflows-ideation-media-modal__player"
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
				allowFullScreen
			/>
		);
	} else if ( isVideoCard ) {
		mediaPreview = (
			<video
				src={ sourceUrl || imageUrl }
				controls
				className="vip-workflows-ideation-media-modal__player"
				onError={ () => setMediaError( true ) }
			/>
		);
	} else {
		mediaPreview = (
			<img
				src={ imageUrl }
				alt={ card.title || '' }
				className="vip-workflows-ideation-media-modal__image"
				onError={ () => setMediaError( true ) }
			/>
		);
	}

	const handleAnalyze = useCallback( async () => {
		if ( ! card.source_id || ! card.project_id || analyzing ) {
			return;
		}
		setAnalyzing( true );
		setAnalysisError( null );
		try {
			const result = await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ card.project_id }/sources/${ card.source_id }/summarize`,
				method: 'POST',
			} );
			setAnalysisText( result.summary );
		} catch ( err ) {
			setAnalysisError(
				err.message || __( 'Analysis failed.', 'vip-workflows' )
			);
		} finally {
			setAnalyzing( false );
		}
	}, [ card.source_id, card.project_id, analyzing ] );

	let media = null;
	if ( isVideoCard ) {
		media = (
			<div className="vip-workflows-ideation-card--image__video-thumb">
				{ ! thumbUnavailable ? (
					<img
						src={ imageUrl }
						alt={ card.title || '' }
						loading="lazy"
						onError={ () => setFailedThumb( imageUrl ) }
					/>
				) : (
					<Stack
						align="center"
						justify="center"
						className="vip-workflows-ideation-card--image__video-placeholder"
					>
						<svg
							width="32"
							height="32"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<polygon points="5 3 19 12 5 21 5 3" />
						</svg>
					</Stack>
				) }
				<Stack
					render={ <span /> }
					align="center"
					justify="center"
					className="vip-workflows-ideation-card--image__play-badge"
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="currentColor"
						className="vip-workflows-ideation-card--image__on-media-glyph"
					>
						<polygon points="5 3 19 12 5 21 5 3" />
					</svg>
				</Stack>
			</div>
		);
	} else if ( ! thumbUnavailable ) {
		media = (
			<img
				src={ imageUrl }
				alt={ card.title || '' }
				loading="lazy"
				onError={ () => setFailedThumb( imageUrl ) }
			/>
		);
	}

	return (
		// No <Card.Content>: this card's body is the media itself, which runs
		// edge to edge, so the surface is all <Card.Root> contributes here.
		<Card.Root
			className={ `vip-workflows-ideation-card vip-workflows-ideation-card--image ${
				isPinned ? 'is-pinned' : ''
			}` }
			data-source-id={ card.source_id }
			onClick={ handleCardClick }
			// Stays a role="button" div: the card nests real <Button>s (the
			// action row, the AI summary control), and a <button> may not
			// contain interactive content. The shared keydown handler honors
			// both keys a native button answers to while leaving keystrokes
			// from nested controls (and the portaled modal) alone.
			role="button"
			tabIndex={ 0 }
			onKeyDown={ handleCardKeyDown }
		>
			{ media }
			{ thumbUnavailable && ! isVideoCard && (
				<Stack
					direction="column"
					align="center"
					justify="center"
					gap="sm"
					className="vip-workflows-ideation-card--image__placeholder"
				>
					<svg
						width="32"
						height="32"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<rect
							x="3"
							y="3"
							width="18"
							height="18"
							rx="2"
							ry="2"
						/>
						<circle cx="8.5" cy="8.5" r="1.5" />
						<polyline points="21 15 16 10 5 21" />
					</svg>
					{ card.title && <span>{ card.title }</span> }
				</Stack>
			) }
			<Stack
				direction="column"
				justify="flex-end"
				gap="xs"
				className="vip-workflows-ideation-card--image__overlay"
			>
				{ card.domain && (
					// wpds-allow R7 -- inline source-domain label with text-shadow; no <Text> variant
					<span className="vip-workflows-ideation-card--image__source">
						{ card.domain }
					</span>
				) }
				{ hasSummary && (
					<Stack
						render={ <span /> }
						className="vip-workflows-ideation-card--image__has-ai"
						align="center"
						title={ __( 'AI analyzed', 'vip-workflows' ) }
					>
						{ AI_ICON }
					</Stack>
				) }
				{ notes && (
					// wpds-allow R7 -- notes-flag icon wrapper; margin-auto aligns it, no Stack prop
					<span className="vip-workflows-ideation-card--image__has-notes">
						<svg
							width="10"
							height="10"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							className="vip-workflows-ideation-card--image__on-media-glyph"
						>
							<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
						</svg>
					</span>
				) }
				<Stack
					className="vip-workflows-ideation-card--image__actions"
					gap="xs"
				>
					<CardActions
						isDismissed={ isDismissed }
						isPinned={ isPinned }
						onRestore={ onRestore }
						onDelete={ onDelete }
						onPin={ onPin }
						onUnpin={ onUnpin }
						onDismiss={ onDismiss }
						onFindSimilar={ onFindSimilar }
					/>
				</Stack>
			</Stack>

			{ modalOpen && (
				<CardDetailModal
					title={
						card.title ||
						( isVideoCard
							? __( 'Video', 'vip-workflows' )
							: __( 'Image', 'vip-workflows' ) )
					}
					onClose={ () => setModalOpen( false ) }
					className="vip-workflows-ideation-media-modal"
					summaryTitle={ __( 'AI Analysis', 'vip-workflows' ) }
					media={
						<div className="vip-workflows-ideation-media-modal__preview">
							{ mediaPreview }
						</div>
					}
					meta={
						<Stack
							className="vip-workflows-ideation-detail-modal__meta"
							align="center"
							gap="sm"
						>
							{ card.domain && (
								<Badge intent="none">{ card.domain }</Badge>
							) }
							{ sourceUrl && (
								<Link href={ sourceUrl } openInNewTab>
									{ card.domain || sourceUrl }
								</Link>
							) }
						</Stack>
					}
					summary={
						<>
							{ hasSummary ? (
								<MarkdownText
									text={ analysisText || ai.summary }
								/>
							) : (
								<Text render={ <p /> }>
									{ __(
										'No AI analysis yet.',
										'vip-workflows'
									) }
								</Text>
							) }
							{ analysisError && (
								<Notice status="error" isDismissible={ false }>
									{ analysisError }
								</Notice>
							) }
						</>
					}
					actions={
						<>
							{ sourceUrl && sourceUrl !== imageUrl && (
								<Button
									variant="tertiary"
									icon={ external }
									href={ sourceUrl }
									target="_blank"
								>
									{ __( 'Open source', 'vip-workflows' ) }
								</Button>
							) }
							{ imageUrl && ! isVideoCard && (
								<Button
									variant="tertiary"
									icon={ external }
									href={ imageUrl }
									target="_blank"
								>
									{ __( 'Open full image', 'vip-workflows' ) }
								</Button>
							) }
							<Button
								variant="secondary"
								icon={ AI_ICON }
								onClick={ handleAnalyze }
								isBusy={ analyzing }
								disabled={ analyzing }
							>
								{ hasSummary
									? __( 'Regenerate', 'vip-workflows' )
									: __( 'Analyze with AI', 'vip-workflows' ) }
							</Button>
						</>
					}
					notes={ notes }
					setNotes={ setNotes }
					savingNotes={ savingNotes }
					handleSaveNotes={ handleSaveNotes }
					notesPlaceholder={ __(
						'Add your notes about this asset…',
						'vip-workflows'
					) }
				/>
			) }
		</Card.Root>
	);
}
