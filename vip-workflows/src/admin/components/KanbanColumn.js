/**
 * Kanban Column Component
 *
 * A single column in the Kanban board representing a workflow status.
 *
 * @package
 */

import { memo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { unseen } from '@wordpress/icons';
import { Button } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { useDroppable } from '@dnd-kit/core';

import { KanbanCard } from './KanbanCard';

import './KanbanColumn.css';

/**
 * Kanban column component.
 *
 * @param {Object}      props                Component props.
 * @param {Object}      props.column         Column data.
 * @param {Function}    props.onHide         Callback to hide column.
 * @param {number|null} props.transitioning  ID of card being transitioned.
 * @param {boolean}     props.isDropDisabled Whether the dragged card cannot legally move here.
 * @return {JSX.Element} Kanban column.
 */
export const KanbanColumn = memo( function KanbanColumn( {
	column,
	onHide,
	transitioning,
	isDropDisabled = false,
} ) {
	const { setNodeRef, isOver } = useDroppable( {
		id: column.key,
		// Not merely a visual: a disabled droppable is invisible to dnd-kit's
		// collision detection, so an illegal drop cannot land here at all —
		// for the pointer and the keyboard sensor alike.
		disabled: isDropDisabled,
	} );

	const columnClasses = [
		'vip-workflows-kanban-column',
		isOver ? 'vip-workflows-kanban-column--over' : '',
		isDropDisabled ? 'vip-workflows-kanban-column--drop-disabled' : '',
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<div ref={ setNodeRef } className={ columnClasses }>
			<Stack
				className="vip-workflows-kanban-column__header"
				justify="space-between"
				align="center"
			>
				<Stack
					className="vip-workflows-kanban-column__header-left"
					align="center"
					gap="sm"
				>
					<span
						className="vip-workflows-kanban-column__indicator"
						style={ { backgroundColor: column.color } }
					/>
					<Text
						variant="heading-md"
						render={ <h3 /> }
						className="vip-workflows-kanban-column__title"
					>
						{ column.label }
					</Text>
					{ /* wpds-allow R7 -- count pill: its surface, tone and radius have no <Text> prop behind them, and <Badge>'s intents are semantic states, not counts */ }
					<span className="vip-workflows-kanban-column__count">
						{ column.count }
					</span>
				</Stack>
				<div className="vip-workflows-kanban-column__header-right">
					<Button
						icon={ unseen }
						label={ __( 'Hide column', 'vip-workflows' ) }
						showTooltip
						onClick={ onHide }
						className="vip-workflows-kanban-column__hide-btn"
						size="small"
					/>
				</div>
			</Stack>

			<Stack
				className="vip-workflows-kanban-column__body"
				direction="column"
				gap="sm"
			>
				{ column.cards.length === 0 ? (
					<Text
						variant="body-md"
						className="vip-workflows-kanban-column__empty"
					>
						{ __( 'No items', 'vip-workflows' ) }
					</Text>
				) : (
					column.cards.map( ( card ) => (
						<KanbanCard
							key={ card.id }
							card={ card }
							isTransitioning={ transitioning === card.id }
						/>
					) )
				) }
			</Stack>
		</div>
	);
} );
