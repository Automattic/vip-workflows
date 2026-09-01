/**
 * SummaryCard
 *
 * One record of a list, drawn as a card: a title with badges beside it, a
 * description, a meta line, and a row of actions pinned to the card's bottom
 * edge. Sequences and Jobs both draw their lists through it, so a card means the
 * same thing on both screens and a change to one reaches both.
 *
 * The card owns its anatomy — which slot sits where, the gaps between them, the
 * rule above the actions row, and the size every action button is drawn at. What
 * a card *says* stays with the screen that renders it:
 *
 * - `badges` are nodes, because what a badge means, and what colour a
 *   categorical one takes, is the screen's to decide.
 * - `actions` name their own `variant`, because which verb is primary differs
 *   per screen: one card's Edit is another's Run Now.
 *
 * @package
 */

import { Button } from '@wordpress/components';
import { Card, Stack, Text } from '@wordpress/ui';

import { ActionRow } from '../../common/ActionRow';
import './SummaryCard.css';

/**
 * @param {Object} props               Props.
 * @param {string} props.title         Card title.
 * @param {Array}  [props.badges]      Badge nodes, drawn beside the title.
 * @param {string} [props.description] Description paragraph.
 * @param {Node}   [props.meta]        Meta line under the description.
 * @param {Array}  props.actions       Action descriptors, each
 *                                     `{ id, label, variant, onClick }`.
 *                                     `variant` is the screen's call: it is what
 *                                     says which of a card's verbs leads. An
 *                                     empty list draws no row, so a card with
 *                                     nothing to do carries no stray rule.
 * @return {JSX.Element} Card.
 */
export function SummaryCard( { title, badges, description, meta, actions } ) {
	return (
		// The surface — background, border, radius — is Card's, not ours. The
		// body is rendered as a <Stack> so the card keeps its gap: Card.Root is
		// a flex column but sets no gap, and Card.Content is padding only.
		<Card.Root className="vip-workflows-summary-card">
			<Card.Content
				className="vip-workflows-summary-card__body"
				render={ <Stack direction="column" gap="md" /> }
			>
				<Stack
					className="vip-workflows-summary-card__header"
					justify="space-between"
					align="flex-start"
					gap="sm"
				>
					<Text
						variant="heading-lg"
						render={ <h3 /> }
						className="vip-workflows-summary-card__title"
					>
						{ title }
					</Text>
					{ badges?.length > 0 && (
						<Stack
							className="vip-workflows-summary-card__badges"
							wrap="wrap"
							gap="sm"
						>
							{ badges }
						</Stack>
					) }
				</Stack>
				{ description && (
					<Text
						variant="body-md"
						render={ <p /> }
						className="vip-workflows-summary-card__description"
					>
						{ description }
					</Text>
				) }
				{ meta && (
					<Text
						variant="body-sm"
						className="vip-workflows-summary-card__meta"
					>
						{ meta }
					</Text>
				) }
				{ actions.length > 0 && (
					<ActionRow className="vip-workflows-summary-card__actions">
						{ /* A labeled card-footer verb carries no icon — icons are
						     for actions that repeat across surfaces or appear
						     icon-only — which is also what lets every action
						     take `small` instead of the icon-fitting compact. */ }
						{ actions.map( ( { id, label, variant, onClick } ) => (
							<Button
								key={ id }
								variant={ variant }
								size="small"
								onClick={ onClick }
							>
								{ label }
							</Button>
						) ) }
					</ActionRow>
				) }
			</Card.Content>
		</Card.Root>
	);
}
