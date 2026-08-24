/**
 * Ideation Card Dispatcher.
 *
 * Routes each card to its type-specific component based on
 * the card type field. Falls back to ArticleCard for unknown types.
 */

import ArticleCard from './cards/ArticleCard';
import TagCloudCard from './cards/TagCloudCard';
import EntityCard from './cards/EntityCard';
import NewsAngleCard from './cards/NewsAngleCard';
import ImageCard from './cards/ImageCard';
import DocumentCard from './cards/DocumentCard';
import { buildSimilarQuery } from './cards/shared';

function resolveType( card ) {
	if ( card.type ) {
		return card.type;
	}

	if ( card.source_type === 'image' || card.source_type === 'video' ) {
		return 'media';
	}

	if ( card.source_type === 'document' || card.source_type === 'audio' ) {
		return 'document';
	}

	const ai =
		typeof card.ai_analysis === 'string'
			? JSON.parse( card.ai_analysis || '{}' )
			: card.ai_analysis || {};

	if ( ai.assistant === 'archive-scout' || card.origin === 'archive' ) {
		return 'archive-article';
	}

	return 'web-article';
}

export default function IdeationCard( {
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
	stuckIds = [],
} ) {
	const type = resolveType( card );

	const cardId = card.source_id || card.card_id || card.type;

	const handleFindSimilar =
		onFindSimilar && card.title
			? () => {
					const { assistant, query } = buildSimilarQuery( card );
					onFindSimilar( assistant, query );
			  }
			: undefined;

	const commonProps = {
		card,
		isPinned,
		isDismissed,
		onPin: onPin ? () => onPin( cardId ) : undefined,
		onDismiss: onDismiss ? () => onDismiss( cardId ) : undefined,
		onUnpin: onUnpin ? () => onUnpin( cardId ) : undefined,
		onSummarize: onSummarize ? () => onSummarize( cardId ) : undefined,
		onRestore: onRestore ? () => onRestore( cardId ) : undefined,
		onDelete: onDelete ? () => onDelete( cardId ) : undefined,
		onFindSimilar: handleFindSimilar,
	};

	switch ( type ) {
		case 'news-angle':
			return <NewsAngleCard { ...commonProps } />;

		case 'tag-cloud':
			return <TagCloudCard { ...commonProps } />;

		case 'entity':
			return <EntityCard { ...commonProps } />;

		case 'image':
		case 'media':
			return <ImageCard { ...commonProps } />;

		case 'document':
			return (
				<DocumentCard
					{ ...commonProps }
					onRetry={ onRetry }
					isStuck={ ( stuckIds || [] ).includes( card.source_id ) }
				/>
			);

		case 'archive-article':
		case 'web-article':
		default:
			return <ArticleCard { ...commonProps } />;
	}
}
