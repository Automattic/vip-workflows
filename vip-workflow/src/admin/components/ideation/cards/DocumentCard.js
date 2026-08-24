/**
 * Document Card Component.
 *
 * Renders uploaded documents and PDFs as compact cards with
 * file type icon, processing status, and detail modal.
 */

import { __ } from '@wordpress/i18n';
import { Button, Notice, Spinner, Icon } from '@wordpress/components';
import { Badge, Card, Stack, Text } from '@wordpress/ui';
import { external, caution } from '@wordpress/icons';

import {
	AI_ICON,
	NOTES_ICON,
	parseAiAnalysis,
	useCardModal,
	useSummarize,
	useNotes,
	CardDetailModal,
	CardActions,
	getCardPreview,
} from './shared';

import { MarkdownText } from '../../markdown';

import './DocumentCard.css';

const FILE_ICONS = {
	pdf: (
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			className="vip-workflow-ideation-card--document__icon-svg vip-workflow-ideation-card--document__icon-svg--pdf"
		>
			<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
			<polyline points="14 2 14 8 20 8" />
			<text
				x="8"
				y="17"
				fill="currentColor"
				stroke="none"
				fontSize="6"
				fontWeight="bold"
				fontFamily="sans-serif"
			>
				PDF
			</text>
		</svg>
	),
	document: (
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			className="vip-workflow-ideation-card--document__icon-svg vip-workflow-ideation-card--document__icon-svg--document"
		>
			<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
			<polyline points="14 2 14 8 20 8" />
			<line x1="16" y1="13" x2="8" y2="13" />
			<line x1="16" y1="17" x2="8" y2="17" />
			<polyline points="10 9 9 9 8 9" />
		</svg>
	),
	audio: (
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			className="vip-workflow-ideation-card--document__icon-svg vip-workflow-ideation-card--document__icon-svg--audio"
		>
			<path d="M9 18V5l12-2v13" />
			<circle cx="6" cy="18" r="3" />
			<circle cx="18" cy="16" r="3" />
		</svg>
	),
};

function formatFileSize( bytes ) {
	if ( ! bytes ) {
		return '';
	}
	const size = parseInt( bytes, 10 );
	if ( size < 1024 ) {
		return `${ size } B`;
	}
	if ( size < 1024 * 1024 ) {
		return `${ Math.round( size / 1024 ) } KB`;
	}
	return `${ ( size / ( 1024 * 1024 ) ).toFixed( 1 ) } MB`;
}

function getFileIcon( card ) {
	const mime = card.file_type || '';
	if ( mime === 'application/pdf' ) {
		return FILE_ICONS.pdf;
	}
	if ( mime.startsWith( 'audio/' ) ) {
		return FILE_ICONS.audio;
	}
	return FILE_ICONS.document;
}

function getFileLabel( card ) {
	const mime = card.file_type || '';
	if ( mime === 'application/pdf' ) {
		return 'PDF';
	}
	if ( mime.startsWith( 'audio/' ) ) {
		return __( 'Audio', 'vip-workflow' );
	}
	return __( 'Document', 'vip-workflow' );
}

export default function DocumentCard( {
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
	onRetry,
	isStuck = false,
} ) {
	const { modalOpen, setModalOpen, handleCardClick, handleCardKeyDown } =
		useCardModal();
	const { summarizing, summary, summarizeError, handleSummarize } =
		useSummarize( onSummarize );

	const { notes, setNotes, savingNotes, handleSaveNotes } = useNotes(
		card.source_id,
		card.project_id,
		card.notes
	);

	const ai = parseAiAnalysis( card.ai_analysis );

	const preview = getCardPreview( card );

	const existingSummary = ai.summary || card.ai_summary;
	const displaySummary = summary || existingSummary;
	const hasSummary = !! displaySummary;
	const isProcessing =
		card.processing_status === 'pending' ||
		card.processing_status === 'processing';
	// A processing card the workspace has flagged as stuck: treat like a failure
	// in the UI (offer retry) rather than spinning indefinitely.
	const showStuck = isProcessing && isStuck;
	const isError = card.processing_status === 'error';
	const stuckMessage = __(
		'Still processing — this is taking longer than expected.',
		'vip-workflow'
	);

	let errorMessage = null;
	if ( isError ) {
		errorMessage = ai.error || __( 'Processing failed.', 'vip-workflow' );
	} else if ( showStuck ) {
		errorMessage = stuckMessage;
	}

	// AI summary body (content only — the generate/retry buttons live in the
	// modal footer). Reflects the document's processing state.
	let summaryContent;
	if ( displaySummary ) {
		summaryContent = <MarkdownText text={ displaySummary } />;
	} else if ( isError || showStuck ) {
		summaryContent = (
			<Notice status="error" isDismissible={ false }>
				{ errorMessage }
			</Notice>
		);
	} else if ( isProcessing ) {
		summaryContent = (
			<Text render={ <p /> }>
				{ __(
					'This document is being analyzed by AI. Check back shortly.',
					'vip-workflow'
				) }
			</Text>
		);
	} else {
		summaryContent = (
			<Text render={ <p /> }>
				{ __( 'No AI summary yet.', 'vip-workflow' ) }
			</Text>
		);
	}

	return (
		<Card.Root
			className={ `vip-workflow-ideation-card vip-workflow-ideation-card--document ${
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
			<Card.Content className="vip-workflow-ideation-card__row">
				<Stack gap="sm">
					<Stack
						align="center"
						justify="center"
						className="vip-workflow-ideation-card--document__icon"
					>
						{ getFileIcon( card ) }
					</Stack>
					<Stack
						direction="column"
						gap="xs"
						className="vip-workflow-ideation-card__content"
					>
						<Stack align="center" gap="sm">
							<Badge
								intent="none"
								className="vip-workflow-ideation-card__badge vip-workflow-ideation-card__badge--document"
							>
								{ getFileLabel( card ) }
							</Badge>
							{ card.file_size && (
								// wpds-allow R7 -- inline muted file-size label; no <Text> muted-body variant
								<span className="vip-workflow-ideation-card--document__size">
									{ formatFileSize( card.file_size ) }
								</span>
							) }
							{ isProcessing && ! showStuck && (
								<Stack
									render={ <span /> }
									className="vip-workflow-ideation-card--document__processing"
									title={ __(
										'Processing…',
										'vip-workflow'
									) }
								>
									<Spinner />
								</Stack>
							) }
							{ ( isError || showStuck ) && (
								<span title={ errorMessage }>
									<Icon icon={ caution } size={ 16 } />
								</span>
							) }
							{ hasSummary && (
								<Stack
									render={ <span /> }
									className="vip-workflow-ideation-card__summarized"
									title={ __(
										'AI Analyzed',
										'vip-workflow'
									) }
								>
									{ AI_ICON }
								</Stack>
							) }
							{ notes && (
								<Stack
									render={ <span /> }
									className="vip-workflow-ideation-card__has-notes"
									title={ __( 'Has notes', 'vip-workflow' ) }
								>
									{ NOTES_ICON }
								</Stack>
							) }
						</Stack>
						{ card.title && (
							<Text
								variant="heading-md"
								render={ <h4 /> }
								className="vip-workflow-ideation-card__title"
							>
								{ card.title }
							</Text>
						) }
						{ preview && (
							<Text
								variant="body-sm"
								render={ <p /> }
								className="vip-workflow-ideation-card__excerpt"
							>
								{ preview }
							</Text>
						) }
					</Stack>
				</Stack>
			</Card.Content>

			<Stack className="vip-workflow-ideation-card__actions" gap="xs">
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

			{ modalOpen && (
				<CardDetailModal
					title={ card.title || __( 'Document', 'vip-workflow' ) }
					onClose={ () => setModalOpen( false ) }
					meta={
						<Stack
							className="vip-workflow-ideation-detail-modal__meta"
							align="center"
							gap="sm"
						>
							<Badge intent="none">
								{ getFileLabel( card ) }
							</Badge>
							{ card.file_size && (
								<Text variant="body-sm">
									{ formatFileSize( card.file_size ) }
								</Text>
							) }
							{ isProcessing && ! showStuck && (
								<Text variant="body-sm">
									{ __(
										'AI processing in progress…',
										'vip-workflow'
									) }
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
										className="vip-workflow-ideation-detail-modal__excerpt"
									>
										<Text
											variant="heading-sm"
											render={ <h4 /> }
											className="vip-workflow-eyebrow"
										>
											{ __( 'Excerpt', 'vip-workflow' ) }
										</Text>
										<Text render={ <p /> }>
											{ card.excerpt }
										</Text>
									</Stack>
								) }

							{ card.content && (
								<Stack
									direction="column"
									gap="sm"
									className="vip-workflow-ideation-detail-modal__content"
								>
									<Text
										variant="heading-sm"
										render={ <h4 /> }
										className="vip-workflow-eyebrow"
									>
										{ __( 'Content', 'vip-workflow' ) }
									</Text>
									<Text render={ <p /> }>
										{ card.content }
									</Text>
								</Stack>
							) }
						</>
					}
					summary={
						<>
							{ summaryContent }
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
									{ __( 'Open file', 'vip-workflow' ) }
								</Button>
							) }
							{ ( isError || showStuck ) && onRetry ? (
								<Button
									variant="secondary"
									onClick={ () => onRetry( card.source_id ) }
								>
									{ __( 'Retry', 'vip-workflow' ) }
								</Button>
							) : (
								! isProcessing &&
								card.source_id &&
								onSummarize && (
									<Button
										variant="secondary"
										icon={ AI_ICON }
										onClick={ handleSummarize }
										isBusy={ summarizing }
										disabled={ summarizing }
									>
										{ displaySummary
											? __( 'Regenerate', 'vip-workflow' )
											: __(
													'Analyze document',
													'vip-workflow'
											  ) }
									</Button>
								)
							) }
						</>
					}
					notes={ notes }
					setNotes={ setNotes }
					savingNotes={ savingNotes }
					handleSaveNotes={ handleSaveNotes }
					notesPlaceholder={ __(
						'Add your notes about this document…',
						'vip-workflow'
					) }
				/>
			) }
		</Card.Root>
	);
}
