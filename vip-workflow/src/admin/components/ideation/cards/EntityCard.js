/**
 * Entity Card Component.
 *
 * Compact card displaying extracted entities (people, organizations, places)
 * with type-specific iconography.
 */

import { Card, Stack } from '@wordpress/ui';

import { CardActions } from './shared';

import './EntityCard.css';

const ENTITY_ICONS = {
	people: (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
		>
			<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</svg>
	),
	organizations: (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
		>
			<rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
			<path d="M9 22V12h6v10M9 6h.01M15 6h.01M9 10h.01M15 10h.01" />
		</svg>
	),
	places: (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
		>
			<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
			<circle cx="12" cy="10" r="3" />
		</svg>
	),
};

export default function EntityCard( {
	card,
	isDismissed,
	onDismiss,
	onRestore,
	onDelete,
} ) {
	const entities = card.entities || [];
	const group = card.entity_group || 'people';
	const icon = ENTITY_ICONS[ group ] || ENTITY_ICONS.people;

	if ( entities.length === 0 ) {
		return null;
	}

	return (
		// The card's surface comes from <Card.Root>; rendering it as a <Stack>
		// keeps the single element that already owned this card's padding and
		// the gap between its header, list, and actions (Card.Root is a flex
		// column, but supplies no gap of its own).
		<Card.Root
			render={ <Stack direction="column" gap="sm" /> }
			className={ `vip-workflow-ideation-card vip-workflow-ideation-card--entity vip-workflow-ideation-card--entity-${ group }` }
		>
			<Stack
				className="vip-workflow-ideation-card--entity__header"
				align="center"
				gap="xs"
			>
				{ icon }
				{ /* wpds-allow R7 -- uppercase eyebrow label; no <Text> variant */ }
				<span className="vip-workflow-ideation-card--entity__label">
					{ card.title }
				</span>
			</Stack>
			<Stack wrap="wrap" gap="xs">
				{ entities.map( ( entity ) => (
					// wpds-allow R7 -- inline entity-name pill; no <Text> variant
					<span
						key={ entity }
						className="vip-workflow-ideation-card--entity__name"
					>
						{ entity }
					</span>
				) ) }
			</Stack>
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
