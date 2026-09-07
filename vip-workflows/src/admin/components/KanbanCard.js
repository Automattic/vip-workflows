/**
 * Kanban Card Component
 *
 * A draggable card representing a post in the Kanban board.
 *
 * @package
 */

import { Badge, Card, Icon, Link, Stack, Text } from '@wordpress/ui';
import { calendar, scheduled } from '@wordpress/icons';
import { memo } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useDraggable } from '@dnd-kit/core';

import { AuthorCell } from '../../common/DataViewCells';
import { Timestamp, daysUntil, formatDate } from '../../common/datetime';

import './KanbanCard.css';

/**
 * Kanban card component.
 *
 * @param {Object}  props                 Component props.
 * @param {Object}  props.card            Card data.
 * @param {boolean} props.isDragging      Whether card is being dragged (for overlay).
 * @param {boolean} props.isTransitioning Whether card is transitioning.
 * @return {JSX.Element} Kanban card.
 */
export const KanbanCard = memo( function KanbanCard( {
	card,
	isDragging,
	isTransitioning,
} ) {
	const {
		attributes,
		listeners,
		setNodeRef,
		isDragging: isBeingDragged,
	} = useDraggable( {
		id: card.id,
		data: { card },
	} );

	const urgencyLabels = {
		breaking: __( 'Breaking', 'vip-workflows' ),
		urgent: __( 'Urgent', 'vip-workflows' ),
	};

	// Determine who to show (assigned takes priority over author).
	const displayPerson = card.assigned_to || card.author;

	// How far off the deadline is, in the newsroom's calendar days. Every branch
	// below reads that one number, so the card cannot say "Overdue" on the
	// browser's clock and then print a date on the site's — which is what it did
	// when the countdown was `new Date()` arithmetic and only the fallback went
	// through the shared formatter.
	const daysLeft = daysUntil( card.due_date );
	const isOverdue = daysLeft !== null && daysLeft < 0;

	const formatDueDate = () => {
		if ( daysLeft === null ) {
			return null;
		}
		if ( daysLeft < 0 ) {
			return __( 'Overdue', 'vip-workflows' );
		}
		if ( daysLeft === 0 ) {
			return __( 'Due today', 'vip-workflows' );
		}
		if ( daysLeft === 1 ) {
			return __( 'Due tomorrow', 'vip-workflows' );
		}
		if ( daysLeft <= 7 ) {
			return sprintf(
				/* translators: %d: number of days until the deadline. */
				_n( '%d day', '%d days', daysLeft, 'vip-workflows' ),
				daysLeft
			);
		}
		return formatDate( card.due_date );
	};

	const cardClasses = [
		'vip-workflows-kanban-card',
		isDragging ? 'vip-workflows-kanban-card--dragging' : '',
		isBeingDragged ? 'vip-workflows-kanban-card--placeholder' : '',
		isTransitioning ? 'vip-workflows-kanban-card--transitioning' : '',
		isOverdue ? 'vip-workflows-kanban-card--overdue' : '',
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<Card.Root
			ref={ setNodeRef }
			className={ cardClasses }
			{ ...attributes }
			{ ...listeners }
		>
			{ /* Urgency indicator — absolutely positioned, so it sits outside
			     the flow column below and over the card's top edge. */ }
			{ card.urgency && card.urgency !== 'normal' && (
				<Text
					variant="heading-sm"
					className={ `vip-workflows-kanban-card__urgency vip-workflows-kanban-card__urgency--${ card.urgency }` }
				>
					{ urgencyLabels[ card.urgency ] }
				</Text>
			) }

			{ /* The card's flow content. <Card.Root> is a flex column but sets
			     no gap, so this Stack owns the rhythm between the title, the
			     meta row and the due date. */ }
			<Stack direction="column" gap="sm">
				{ /* Title */ }
				<Text
					variant="heading-md"
					render={
						<Link
							href={ card.edit_url }
							className="vip-workflows-kanban-card__title"
							onClick={ ( e ) => e.stopPropagation() }
						/>
					}
				>
					{ card.title }
				</Text>

				{ /* Meta row */ }
				<Stack
					className="vip-workflows-kanban-card__meta"
					align="center"
					justify="space-between"
					gap="sm"
				>
					{ /* Person (assigned or author) */ }
					<AuthorCell
						actor={ displayPerson }
						size="sm"
						variant="body-sm"
						className="vip-workflows-kanban-card__person"
					>
						{ card.assigned_to && (
							<Badge intent="informational">
								{ __( 'assigned', 'vip-workflows' ) }
							</Badge>
						) }
					</AuthorCell>

					{ /* Waiting time. The route words it ("2 hours"); the
					     instant it was worded from rides along as `modified`,
					     so the phrase is anchored to a moment something can
					     read rather than being prose about nothing. */ }
					<Stack
						className="vip-workflows-kanban-card__waiting"
						align="center"
						gap="xs"
					>
						<Icon icon={ scheduled } size={ 16 } />
						<Timestamp value={ card.modified } variant="body-sm">
							{ card.waiting_time }
						</Timestamp>
					</Stack>
				</Stack>

				{ /* Due date. "Overdue" and "Due today" are the whole reason
				     the deadline is drawn as a <time>: the words say how the
				     date stands relative to now and never say the date, so
				     without the attribute the actual date is nowhere on the
				     page — unreadable to a screen reader offering to announce
				     it, and unrecoverable by anything else parsing the card.

				     `dateOnly` because every branch of formatDueDate() counts
				     calendar days and none of them names an hour. An attribute
				     carrying midnight would assert a precision the card never
				     claimed, and a reader turning the card into a calendar
				     entry would get a deadline of 00:00. */ }
				{ card.due_date && (
					<Stack
						className={ `vip-workflows-kanban-card__due ${
							isOverdue
								? 'vip-workflows-kanban-card__due--overdue'
								: ''
						}` }
						align="center"
						gap="xs"
					>
						<Icon icon={ calendar } size={ 16 } />
						<Timestamp value={ card.due_date } dateOnly>
							{ formatDueDate() }
						</Timestamp>
					</Stack>
				) }
			</Stack>

			{ /* Transitioning overlay */ }
			{ isTransitioning && (
				<Stack
					className="vip-workflows-kanban-card__transitioning-overlay"
					align="center"
					justify="center"
				>
					<span className="spinner is-active" />
				</Stack>
			) }
		</Card.Root>
	);
} );
