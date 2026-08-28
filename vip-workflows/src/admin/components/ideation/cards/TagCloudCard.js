/**
 * Tag Cloud Card Component.
 *
 * Full-width card displaying extracted topics as large interactive pills.
 * Visually distinct from article cards.
 */

import { __ } from '@wordpress/i18n';

import { Card, Stack } from '@wordpress/ui';

import { CardActions } from './shared';

import './TagCloudCard.css';

export default function TagCloudCard( {
	card,
	isDismissed,
	onDismiss,
	onRestore,
	onDelete,
} ) {
	const tags = card.tags || [];

	if ( tags.length === 0 ) {
		return null;
	}

	return (
		// The card's surface comes from <Card.Root>; rendering it as a <Stack>
		// keeps the single element that already owned this card's padding and
		// the gap between header, cloud, and actions (Card.Root is a flex
		// column, but supplies no gap of its own).
		<Card.Root
			render={ <Stack direction="column" gap="sm" /> }
			className="vip-workflows-ideation-card vip-workflows-ideation-card--tags"
		>
			<Stack
				className="vip-workflows-ideation-card--tags__header"
				align="center"
				gap="xs"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				>
					<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
					<line x1="7" y1="7" x2="7.01" y2="7" />
				</svg>
				<span>{ __( 'Topics', 'vip-workflows' ) }</span>
			</Stack>
			<Stack wrap="wrap" gap="xs">
				{ tags.map( ( tag ) => (
					// wpds-allow R7 -- inline topic pill; no <Text> variant
					<span
						key={ tag }
						className="vip-workflows-ideation-card--tags__pill"
					>
						{ tag }
					</span>
				) ) }
			</Stack>
			<Stack
				justify="flex-end"
				className="vip-workflows-ideation-card__actions vip-workflows-ideation-card__actions--minimal"
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
