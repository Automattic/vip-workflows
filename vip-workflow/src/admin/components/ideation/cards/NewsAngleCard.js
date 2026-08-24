/**
 * News Angle Card Component.
 *
 * Prominent quote-style card displaying the editorial insight
 * extracted from the seed by the Seed Analyst.
 */

import { __ } from '@wordpress/i18n';

import { Card, Stack } from '@wordpress/ui';

import { CardActions } from './shared';

import './NewsAngleCard.css';

export default function NewsAngleCard( {
	card,
	isDismissed,
	onDismiss,
	onRestore,
	onDelete,
} ) {
	const content = card.content || '';

	if ( ! content ) {
		return null;
	}

	return (
		// The card's surface comes from <Card.Root>; rendering it as a <Stack>
		// keeps the single element that already owned this card's padding and
		// the gap between quote, label, and actions (Card.Root is a flex column,
		// but supplies no gap of its own).
		<Card.Root
			render={ <Stack direction="column" gap="sm" /> }
			className="vip-workflow-ideation-card vip-workflow-ideation-card--angle"
		>
			<div className="vip-workflow-ideation-card--angle__icon">
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
				>
					<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
				</svg>
			</div>
			<blockquote className="vip-workflow-ideation-card--angle__quote">
				{ content }
			</blockquote>
			{ /* wpds-allow R7 -- uppercase news-angle label; no <Text> variant */ }
			<span className="vip-workflow-ideation-card--angle__label">
				{ __( 'News Angle', 'vip-workflow' ) }
			</span>
			<Stack
				justify="flex-end"
				className="vip-workflow-ideation-card__actions vip-workflow-ideation-card__actions--minimal"
				gap="xs"
			>
				<CardActions
					isDismissed={ isDismissed }
					onRestore={ onRestore }
					onDelete={ onDelete }
					onDismiss={ onDismiss }
				/>
			</Stack>
		</Card.Root>
	);
}
