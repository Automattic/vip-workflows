/**
 * Kanban Board Component
 *
 * Trello-style drag-and-drop board for workflow management.
 *
 * @package
 */

import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	Button,
	Spinner,
	Notice,
	SelectControl,
	ComboboxControl,
} from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	rectIntersection,
} from '@dnd-kit/core';

import AdminPage from './AdminPage';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { useConfirm } from '../../common/use-confirm';
import {
	getTransitionWarningsMessage,
	getTransitionWarningsTitle,
} from '../../entries/confirm-workflow-side-effect';

import './KanbanBoard.css';

const BREADCRUMBS = [
	{
		label: __( 'Workflows', 'vip-workflows' ),
		href: 'admin.php?page=vip-workflows',
	},
	{ label: __( 'Kanban Board', 'vip-workflows' ) },
];
const TITLE = __( 'Kanban Board', 'vip-workflows' );

/**
 * The legal drop targets for a dragged card, read off the transition payload
 * of `GET /workflow/post/{id}/status` — the same server answer
 * (StatusManager::get_available_transitions) the editor's transition rail
 * renders. Nothing is decided client-side beyond reading it: a transition the
 * server withholds, or marks `_locked`, is not a target.
 *
 * Returns null — "legality unknown, disable nothing" — whenever the stage
 * carries an agent job marker, in either of its states. While the agent RUNS
 * (`agent_pending`), the offered list is deliberately empty even though the
 * transition endpoint still accepts a deliberate move behind the warnings
 * confirm. And when the job FAILED or timed out (`agent_job` non-null with
 * `agent_pending` false), the offered list is empty too, yet the server
 * accepts a drop to a routed destination outright. This board is one of the
 * callers meant to rescue a stuck post either way (see
 * StatusManager::get_available_transitions), so neither state may read as
 * "every column is illegal".
 *
 * @param {Object} status Payload of the post-status route.
 * @return {?{sequenceId: ?number, stageKeys: string[]}} Legal targets, or null when unknown.
 */
export function legalDropTargets( status ) {
	if ( ! status || status.agent_pending || status.agent_job ) {
		return null;
	}

	return {
		sequenceId: status.sequence?.id ?? null,
		stageKeys: ( status.transitions || [] )
			.filter( ( transition ) => ! transition._locked )
			.map( ( transition ) => String( transition.to ) ),
	};
}

/**
 * Main Kanban Board component.
 *
 * @return {JSX.Element} Kanban board.
 */
export function KanbanBoard() {
	const [ data, setData ] = useState( null );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ activeCard, setActiveCard ] = useState( null );
	const [ selectedSequence, setSelectedSequence ] = useState( null );
	const [ hiddenColumns, setHiddenColumns ] = useState( [] );
	const [ transitioning, setTransitioning ] = useState( null );
	const [ authorFilter, setAuthorFilter ] = useState( null );
	const [ authorOptions, setAuthorOptions ] = useState( [] );
	// Legal targets for the card being dragged (see legalDropTargets); null
	// while no drag is active or the server's answer hasn't arrived.
	const [ dropTargets, setDropTargets ] = useState( null );
	const authorSearchTimer = useRef( null );
	// Monotonic token for the current drag's legality request. Bumped on every
	// drag start, end, and cancel, so an answer that arrives after its drag
	// ended can never apply — not even to a fast re-drag of the same card,
	// where a card-id guard would let request 1's answer (computed against the
	// pre-move stage) land on drag 2.
	const dragTokenRef = useRef( 0 );

	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const [ confirm, confirmDialog ] = useConfirm();

	const isNoWorkflow = selectedSequence === 'none';

	// Configure drag sensors.
	const sensors = useSensors(
		useSensor( PointerSensor, {
			activationConstraint: {
				distance: isNoWorkflow ? Infinity : 8,
			},
		} ),
		useSensor( KeyboardSensor )
	);

	const searchAuthors = ( input ) => {
		clearTimeout( authorSearchTimer.current );
		if ( ! input || input.length < 2 ) {
			setAuthorOptions( [] );
			return;
		}
		authorSearchTimer.current = setTimeout( async () => {
			try {
				// Plugin-owned route: the old `context=edit` call against
				// wp/v2/users required `list_users`.
				const users = await apiFetch( {
					path: `/vip-workflows/v1/assignable-users?search=${ encodeURIComponent(
						input
					) }&per_page=10`,
				} );
				setAuthorOptions(
					users.map( ( u ) => ( {
						value: u.id,
						label: u.name,
					} ) )
				);
			} catch {
				setAuthorOptions( [] );
			}
		}, 250 );
	};

	// Fetch Kanban data.
	const fetchData = useCallback( async () => {
		try {
			// First, get the list of sequences if we don't have one selected.
			if ( ! selectedSequence ) {
				const allData = await apiFetch( {
					path: '/vip-workflows/v1/workflow/kanban',
				} );

				// Default to first sequence.
				if ( allData.sequences?.length > 0 ) {
					setSelectedSequence( String( allData.sequences[ 0 ].id ) );
					return; // Will re-fetch with the selected sequence.
				}

				setData( allData );
				setError( null );
				setLoading( false );
				return;
			}

			const response = await apiFetch( {
				path: `/vip-workflows/v1/workflow/kanban?sequence_id=${ selectedSequence }`,
			} );

			setData( response );
			setError( null );
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to load board', 'vip-workflows' )
			);
		} finally {
			setLoading( false );
		}
	}, [ selectedSequence ] );

	useEffect( () => {
		fetchData();

		let interval = setInterval( fetchData, 30000 );

		const handleVisibility = () => {
			if ( document.hidden ) {
				clearInterval( interval );
				interval = null;
			} else {
				fetchData();
				interval = setInterval( fetchData, 30000 );
			}
		};

		document.addEventListener( 'visibilitychange', handleVisibility );
		return () => {
			clearInterval( interval );
			document.removeEventListener(
				'visibilitychange',
				handleVisibility
			);
		};
	}, [ fetchData ] );

	// Handle drag start.
	const handleDragStart = ( event ) => {
		const { active } = event;
		setActiveCard( active.data.current?.card || findCardById( active.id ) );

		// Ask the server which moves this card can make, so columns it cannot
		// reach render disabled for the duration of the drag. Until the answer
		// arrives every column stays enabled — the transition endpoint remains
		// the authority, and a refused drop is reported by handleDragEnd.
		setDropTargets( null );
		dragTokenRef.current += 1;
		const dragToken = dragTokenRef.current;
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ active.id }/status`,
		} )
			.then( ( status ) => {
				if ( dragTokenRef.current !== dragToken ) {
					return;
				}
				setDropTargets( legalDropTargets( status ) );
			} )
			.catch( () => {
				// Legality could not be read. Columns stay enabled; the
				// transition endpoint judges the drop, and its refusal is
				// reported by handleDragEnd's error path.
			} );
	};

	// Handle drag end.
	const handleDragEnd = async ( event ) => {
		const { active, over } = event;
		setActiveCard( null );
		setDropTargets( null );
		dragTokenRef.current += 1;

		// No droppable under the pointer: either the card was let go outside
		// the board, or over a column whose droppable is disabled because the
		// move is illegal — the drop was already prevented visually.
		if ( ! over ) {
			return;
		}

		// Get source column.
		const sourceColumnKey = findColumnKeyByCardId( active.id );

		// The 'over' is the column we dropped on.
		const destColumnKey = over.id;

		// If dropped on same column, do nothing.
		if ( sourceColumnKey === destColumnKey ) {
			return;
		}

		// Find the destination column to get status info.
		const destColumn = data.columns.find(
			( col ) => col.key === destColumnKey
		);
		if ( ! destColumn ) {
			// The droppable ids ARE the column keys, so this is a
			// data-integrity bug, not a user mistake — but the card still
			// snapped back, so say so rather than fail in silence.
			createErrorNotice( __( 'Failed to move card', 'vip-workflows' ), {
				type: 'snackbar',
			} );
			return;
		}

		// Get the card data.
		const card = findCardById( active.id );
		if ( ! card ) {
			// Same contract as above: the draggable ids are card ids, so a
			// drag whose card cannot be found is a bug worth reporting.
			createErrorNotice( __( 'Failed to move card', 'vip-workflows' ), {
				type: 'snackbar',
			} );
			return;
		}

		// Store original state for rollback.
		const originalData = { ...data };

		// Optimistic update.
		setData( ( prev ) => {
			const newColumns = prev.columns.map( ( col ) => {
				if ( col.key === sourceColumnKey ) {
					return {
						...col,
						cards: col.cards.filter( ( c ) => c.id !== active.id ),
						count: col.count - 1,
					};
				}
				if ( col.key === destColumnKey ) {
					return {
						...col,
						cards: [ card, ...col.cards ],
						count: col.count + 1,
					};
				}
				return col;
			} );
			return { ...prev, columns: newColumns };
		} );

		// Call transition API.
		setTransitioning( active.id );

		try {
			const transition = ( acknowledgeWarnings ) =>
				apiFetch( {
					path: `/vip-workflows/v1/workflow/post/${ active.id }/transition`,
					method: 'POST',
					data: {
						to_status: destColumn.status_key,
						...( acknowledgeWarnings
							? { acknowledge_warnings: true }
							: {} ),
					},
				} );

			let response = await transition( false );

			// The server REFUSED this move pending acknowledgement — most often
			// because a stage agent is mid-run and dropping the card would
			// discard its work. A 200 with `warnings_pending` is not a success;
			// this surface used to read it as one and report "Card moved".
			if ( response?.warnings_pending ) {
				const proceed = await confirm(
					getTransitionWarningsMessage( response.soft_warnings ),
					{
						title: getTransitionWarningsTitle(),
						confirmLabel: __( 'Continue', 'vip-workflows' ),
					}
				);

				if ( ! proceed ) {
					setData( originalData );
					return;
				}

				response = await transition( true );
			}

			createSuccessNotice(
				__( 'Card moved successfully', 'vip-workflows' ),
				{ type: 'snackbar' }
			);

			// Refresh to get accurate data.
			fetchData();
		} catch ( err ) {
			// Rollback on error.
			setData( originalData );

			// Extract error message from WP REST API error format.
			let errorMessage = __( 'Failed to move card', 'vip-workflows' );
			if ( err.message ) {
				errorMessage = err.message;
			} else if ( err.data?.message ) {
				errorMessage = err.data.message;
			} else if ( typeof err === 'string' ) {
				errorMessage = err;
			}

			createErrorNotice( errorMessage, { type: 'snackbar' } );
		} finally {
			setTransitioning( null );
		}
	};

	// Handle drag cancel.
	const handleDragCancel = () => {
		setActiveCard( null );
		setDropTargets( null );
		dragTokenRef.current += 1;
	};

	// Find card by ID across all columns.
	const findCardById = ( cardId ) => {
		for ( const column of data?.columns || [] ) {
			const card = column.cards.find( ( c ) => c.id === cardId );
			if ( card ) {
				return card;
			}
		}
		return null;
	};

	// Find column key that contains a card.
	const findColumnKeyByCardId = ( cardId ) => {
		for ( const column of data?.columns || [] ) {
			if ( column.cards.some( ( c ) => c.id === cardId ) ) {
				return column.key;
			}
		}
		return null;
	};

	// Toggle column visibility.
	const toggleColumnVisibility = ( columnKey ) => {
		setHiddenColumns( ( prev ) =>
			prev.includes( columnKey )
				? prev.filter( ( k ) => k !== columnKey )
				: [ ...prev, columnKey ]
		);
	};

	// Get visible columns, filtered by author if set.
	const visibleColumns = ( data?.columns || [] )
		.filter( ( col ) => ! hiddenColumns.includes( col.key ) )
		.map( ( col ) => {
			if ( ! authorFilter ) {
				return col;
			}
			const filtered = col.cards.filter(
				( c ) => c.author?.id === authorFilter
			);
			return { ...col, cards: filtered, count: filtered.length };
		} );

	// Get hidden column info for toggle menu.
	const hiddenColumnInfo = ( data?.columns || [] ).filter( ( col ) =>
		hiddenColumns.includes( col.key )
	);

	// The column the dragged card is leaving. Never disabled: letting go where
	// the card already is is a no-op, not a transition.
	const activeSourceColumnKey = activeCard
		? findColumnKeyByCardId( activeCard.id )
		: null;

	// Whether a column must refuse the current drag. Only the server's own
	// transition list decides — null dropTargets (no drag in progress, the
	// answer still in flight, or an agent-owned stage) disables nothing.
	const isColumnDropDisabled = ( column ) => {
		if ( ! activeCard || ! dropTargets ) {
			return false;
		}
		if ( column.key === activeSourceColumnKey ) {
			return false;
		}
		if (
			dropTargets.sequenceId !== null &&
			column.sequence_id !== dropTargets.sequenceId
		) {
			return true;
		}
		return ! dropTargets.stageKeys.includes( String( column.status_key ) );
	};

	if ( loading ) {
		return (
			<AdminPage fullBleed breadcrumbs={ BREADCRUMBS } title={ TITLE }>
				<Stack
					className="vip-workflows-kanban-loading"
					align="center"
					justify="center"
					gap="md"
				>
					<Spinner />
					<Text variant="body-lg">
						{ __( 'Loading board…', 'vip-workflows' ) }
					</Text>
				</Stack>
			</AdminPage>
		);
	}

	if ( error ) {
		return (
			<AdminPage fullBleed breadcrumbs={ BREADCRUMBS } title={ TITLE }>
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			</AdminPage>
		);
	}

	const sequenceOptions = [
		...( data?.sequences || [] ).map( ( bp ) => ( {
			label: bp.name,
			value: String( bp.id ),
		} ) ),
		{
			label: __( 'No Workflow', 'vip-workflows' ),
			value: 'none',
		},
	];

	const actions = (
		<>
			{ data?.sequences?.length > 0 && (
				<SelectControl
					className="vip-workflows-kanban-sequence-select"
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					value={ selectedSequence }
					options={ sequenceOptions }
					onChange={ setSelectedSequence }
				/>
			) }
			<div className="vip-workflows-kanban-header__author-filter">
				<ComboboxControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Author', 'vip-workflows' ) }
					hideLabelFromVision
					value={ authorFilter }
					options={ authorOptions }
					onChange={ setAuthorFilter }
					onFilterValueChange={ searchAuthors }
					placeholder={ __( 'Filter by author…', 'vip-workflows' ) }
				/>
			</div>
			{ hiddenColumnInfo.length > 0 && (
				<Stack align="center" gap="sm">
					<Text
						variant="body-md"
						className="vip-workflows-kanban-hidden-columns__label"
					>
						{ __( 'Hidden:', 'vip-workflows' ) }
					</Text>
					{ hiddenColumnInfo.map( ( col ) => (
						<Button
							key={ col.key }
							className="vip-workflows-kanban-hidden-column-badge"
							onClick={ () => toggleColumnVisibility( col.key ) }
							style={ { borderColor: col.color } }
						>
							<span
								className="vip-workflows-kanban-hidden-column-badge__dot"
								style={ { backgroundColor: col.color } }
							/>
							{ col.label }
						</Button>
					) ) }
				</Stack>
			) }
		</>
	);

	return (
		<AdminPage
			fullBleed
			breadcrumbs={ BREADCRUMBS }
			title={ TITLE }
			actions={ actions }
		>
			<Stack className="vip-workflows-kanban-wrapper" direction="column">
				<DndContext
					sensors={ sensors }
					collisionDetection={ rectIntersection }
					onDragStart={ handleDragStart }
					onDragEnd={ handleDragEnd }
					onDragCancel={ handleDragCancel }
				>
					<Stack
						className="vip-workflows-kanban-board"
						direction="row"
						align="flex-start"
						gap="md"
					>
						{ visibleColumns.map( ( column ) => (
							<KanbanColumn
								key={ column.key }
								column={ column }
								onHide={ () =>
									toggleColumnVisibility( column.key )
								}
								transitioning={ transitioning }
								isDropDisabled={ isColumnDropDisabled(
									column
								) }
							/>
						) ) }
					</Stack>

					<DragOverlay>
						{ activeCard ? (
							<KanbanCard card={ activeCard } isDragging />
						) : null }
					</DragOverlay>
				</DndContext>

				{ visibleColumns.length === 0 && (
					<Stack
						className="vip-workflows-kanban-empty"
						direction="column"
						align="center"
						justify="center"
						gap="sm"
					>
						<Text variant="body-md">
							{ __( 'No columns to display.', 'vip-workflows' ) }
						</Text>
						{ hiddenColumnInfo.length > 0 && (
							<Text variant="body-md">
								{ __(
									'Click a hidden column badge above to show it.',
									'vip-workflows'
								) }
							</Text>
						) }
					</Stack>
				) }
			</Stack>
			{ confirmDialog }
		</AdminPage>
	);
}
