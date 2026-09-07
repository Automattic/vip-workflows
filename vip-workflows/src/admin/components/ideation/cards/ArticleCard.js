/**
 * Article Card Component.
 *
 * Compact clickable card. Clicking opens a detail modal
 * with Summary and Notes tabs.
 */

import { __ } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/components';
import { Badge, Card, Link, Stack, Text } from '@wordpress/ui';
import { external } from '@wordpress/icons';

import {
	AI_ICON,
	NOTES_ICON,
	parseAiAnalysis,
	useCardModal,
	useSummarize,
	useNotes,
	CardDetailModal,
	CardActions,
	CardThumb,
	getCardPreview,
} from './shared';

import { MarkdownText } from '../../markdown';
import { formatDate } from '../../../../common/datetime';

import './ArticleCard.css';

export default function ArticleCard( {
	card,
	isPinned,
	isDismissed,
	onPin,
	onDismiss,
	onUnpin,
	onSummarize,
	onRestore,
	onDelete,
	onFindSimilar,
} ) {
	const { modalOpen, setModalOpen, handleCardClick, handleCardKeyDown } =
		useCardModal();
	const preview = getCardPreview( card );
	const { summarizing, summary, summarizeError, handleSummarize } =
		useSummarize( onSummarize );

	const { notes, setNotes, savingNotes, handleSaveNotes } = useNotes(
		card.source_id,
		card.project_id,
		card.notes
	);

	const ai = parseAiAnalysis( card.ai_analysis );
	const isArchive =
		ai.assistant === 'archive-scout' || card.origin === 'archive';
	const variant = isArchive ? 'archive' : 'web';

	const existingSummary = ai.summary || card.ai_summary;
	const displaySummary = summary || existingSummary;
	const hasSummary = !! displaySummary;

	return (
		<Card.Root
			className={ `vip-workflows-ideation-card vip-workflows-ideation-card--article vip-workflows-ideation-card--${ variant } ${
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
			<Card.Content className="vip-workflows-ideation-card__row">
				<Stack gap="sm">
					{ card.image && (
						<div className="vip-workflows-ideation-card__thumb">
							<CardThumb src={ card.image } />
						</div>
					) }
					<Stack
						direction="column"
						gap="xs"
						className="vip-workflows-ideation-card__content"
					>
						<Stack align="center" gap="sm">
							<Badge
								intent="none"
								className={ `vip-workflows-ideation-card__badge vip-workflows-ideation-card__badge--${ variant }` }
							>
								{ isArchive
									? __( 'Archive', 'vip-workflows' )
									: card.domain ||
									  __( 'Web', 'vip-workflows' ) }
							</Badge>
							{ hasSummary && (
								<Stack
									render={ <span /> }
									className="vip-workflows-ideation-card__summarized"
									title={ __(
										'AI Summarized',
										'vip-workflows'
									) }
								>
									{ AI_ICON }
								</Stack>
							) }
							{ notes && (
								<Stack
									render={ <span /> }
									className="vip-workflows-ideation-card__has-notes"
									title={ __( 'Has notes', 'vip-workflows' ) }
								>
									{ NOTES_ICON }
								</Stack>
							) }
						</Stack>
						{ card.title && (
							<Text
								variant="heading-md"
								render={ <h4 /> }
								className="vip-workflows-ideation-card__title"
							>
								{ card.title }
							</Text>
						) }
						{ preview && (
							<Text
								variant="body-sm"
								render={ <p /> }
								className="vip-workflows-ideation-card__excerpt"
							>
								{ preview }
							</Text>
						) }
					</Stack>
				</Stack>
			</Card.Content>

			<Stack className="vip-workflows-ideation-card__actions" gap="xs">
				<CardActions
					isDismissed={ isDismissed }
					isPinned={ isPinned }
					onRestore={ onRestore }
					onDelete={ onDelete }
					onPin={ onPin }
					onUnpin={ onUnpin }
					onDismiss={ onDismiss }
					onFindSimilar={ onFindSimilar }
					url={ card.url }
				/>
			</Stack>

			{ modalOpen && (
				<CardDetailModal
					title={
						card.title || __( 'Source Detail', 'vip-workflows' )
					}
					onClose={ () => setModalOpen( false ) }
					media={
						<CardThumb
							src={ card.image }
							className="vip-workflows-ideation-detail-modal__image"
						/>
					}
					meta={
						<Stack
							className="vip-workflows-ideation-detail-modal__meta"
							align="center"
							gap="sm"
						>
							{ /*
							   The domain is the source's identity, so in the modal it
							   links to it — matching ImageCard, which already does.
							   Not on the compact card: the whole card is a click
							   target that opens this modal, and a link inside it
							   would be a nested interactive element that swallows
							   the card's own click.
							 */ }
							{ card.url && ! isArchive ? (
								<Link href={ card.url } openInNewTab>
									{ card.domain ||
										__( 'Open source', 'vip-workflows' ) }
								</Link>
							) : (
								<Badge intent="none">
									{ isArchive
										? __( 'Archive', 'vip-workflows' )
										: card.domain ||
										  __( 'Web', 'vip-workflows' ) }
								</Badge>
							) }
							{ card.author && (
								<Text variant="body-sm">{ card.author }</Text>
							) }
							{ card.published_at && (
								<Text variant="body-sm">
									{ formatDate( card.published_at ) }
								</Text>
							) }
						</Stack>
					}
					excerpt={
						<>
							{ card.excerpt &&
								( ! card.content ||
									card.content.length >= 200 ) && (
									<Stack
										direction="column"
										gap="sm"
										className="vip-workflows-ideation-detail-modal__excerpt"
									>
										<Text
											variant="heading-sm"
											render={ <h4 /> }
											className="vip-workflows-eyebrow"
										>
											{ __( 'Excerpt', 'vip-workflows' ) }
										</Text>
										<MarkdownText text={ card.excerpt } />
									</Stack>
								) }

							{ card.content && (
								<Stack
									direction="column"
									gap="sm"
									className="vip-workflows-ideation-detail-modal__content"
								>
									<Text
										variant="heading-sm"
										render={ <h4 /> }
										className="vip-workflows-eyebrow"
									>
										{ __( 'Content', 'vip-workflows' ) }
									</Text>
									<MarkdownText text={ card.content } />
								</Stack>
							) }
						</>
					}
					summary={
						<>
							{ displaySummary ? (
								<MarkdownText text={ displaySummary } />
							) : (
								<Text render={ <p /> }>
									{ __(
										'No AI summary yet.',
										'vip-workflows'
									) }
								</Text>
							) }
							{ summarizeError && (
								<Notice status="error" isDismissible={ false }>
									{ summarizeError }
								</Notice>
							) }
						</>
					}
					actions={
						<>
							{ card.url && (
								<Button
									variant="tertiary"
									icon={ external }
									href={ card.url }
									target="_blank"
								>
									{ __( 'Open source', 'vip-workflows' ) }
								</Button>
							) }
							{ card.source_id && onSummarize && (
								<Button
									variant="secondary"
									icon={ AI_ICON }
									onClick={ handleSummarize }
									isBusy={ summarizing }
									disabled={ summarizing }
								>
									{ displaySummary
										? __( 'Regenerate', 'vip-workflows' )
										: __(
												'Generate AI summary',
												'vip-workflows'
										  ) }
								</Button>
							) }
						</>
					}
					notes={ notes }
					setNotes={ setNotes }
					savingNotes={ savingNotes }
					handleSaveNotes={ handleSaveNotes }
					notesPlaceholder={ __(
						'Add your notes about this source…',
						'vip-workflows'
					) }
				/>
			) }
		</Card.Root>
	);
}
