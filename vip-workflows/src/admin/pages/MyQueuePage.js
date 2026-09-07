/**
 * My Queue Page Component.
 *
 * Posts in the workflow awaiting the current user's action, as a
 * `@wordpress/dataviews` table. The dataset is small and fully loaded, so
 * filter/sort/pagination run client-side via `filterSortAndPaginate`; the table
 * is wrapped in the shared `.vip-workflows-card-surface` panel and the status
 * renders as the shared `@wordpress/ui` Badge.
 *
 * The per-row quick-action transitions vary by item (each carries its own
 * target/label), which doesn't fit DataViews' static `actions` model, so they
 * render in a dedicated Actions column field. The standard "View the post"
 * action uses the DataViews `actions` API, like the other lists.
 */

import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Button, Spinner, Notice } from '@wordpress/components';
import { Card, Stack, Text } from '@wordpress/ui';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews/wp';
import { pencil } from '@wordpress/icons';

import StatusBadge from '../components/StatusBadge';
import { TitleLink, AuthorCell } from '../../common/DataViewCells';
import {
	Timestamp,
	siteDateTimeFormat,
	sortByTimestamp,
} from '../../common/datetime';
import { toElements } from '../utils/dataview-elements';
import { useConfirm } from '../../common/use-confirm';
import {
	getTransitionWarningsMessage,
	getTransitionWarningsTitle,
} from '../../entries/confirm-workflow-side-effect';

import './MyQueuePage.css';

// No default sort, matching My Work: the screen opens on the order the endpoint
// sent, and the reader chooses another. Waiting is genuinely sortable now — the
// column ranks on the instant rather than on the sentence — so oldest-first is
// one click away rather than a reading order imposed on everybody.
const DEFAULT_VIEW = {
	type: 'table',
	search: '',
	filters: [],
	page: 1,
	perPage: 20,
	sort: {},
	titleField: 'title',
	fields: [
		'author',
		'sequence_name',
		'status_label',
		'waiting',
		'queue_actions',
	],
	layout: {},
};

export function MyQueuePage() {
	const [ items, setItems ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ actionLoading, setActionLoading ] = useState( null );
	const [ view, setView ] = useState( DEFAULT_VIEW );
	const [ confirm, confirmDialog ] = useConfirm();

	const fetchQueue = useCallback( async () => {
		setLoading( true );
		setError( null );

		try {
			const response = await apiFetch( {
				path: '/vip-workflows/v1/workflow/my-queue',
			} );
			setItems( response );
		} catch ( err ) {
			setError( err.message );
		} finally {
			setLoading( false );
		}
	}, [] );

	useEffect( () => {
		fetchQueue();
	}, [ fetchQueue ] );

	const handleQuickAction = useCallback(
		async ( postId, toStatus ) => {
			setActionLoading( `${ postId }-${ toStatus }` );
			setError( null );

			const transition = ( acknowledgeWarnings ) =>
				apiFetch( {
					path: `/vip-workflows/v1/workflow/post/${ postId }/transition`,
					method: 'POST',
					data: {
						to_status: toStatus,
						...( acknowledgeWarnings
							? { acknowledge_warnings: true }
							: {} ),
					},
				} );

			try {
				const response = await transition( false );

				// `warnings_pending` is a 200 that means the transition did NOT
				// happen — the server is waiting to be told to override a soft
				// warning, most consequentially a stage agent that is mid-run and
				// would be stopped. Refreshing the queue on it, as this did,
				// showed the row unchanged with no explanation.
				if ( response?.warnings_pending ) {
					const proceed = await confirm(
						getTransitionWarningsMessage( response.soft_warnings ),
						{
							title: getTransitionWarningsTitle(),
							confirmLabel: __( 'Continue', 'vip-workflows' ),
						}
					);

					if ( ! proceed ) {
						return;
					}

					await transition( true );
				}

				fetchQueue();
			} catch ( err ) {
				setError( err.message );
			} finally {
				setActionLoading( null );
			}
		},
		[ fetchQueue, confirm ]
	);

	const fields = useMemo(
		() => [
			{
				id: 'title',
				type: 'text',
				label: __( 'Title', 'vip-workflows' ),
				enableHiding: false,
				enableGlobalSearch: true,
				// Titles have unbounded cardinality, so this filter takes typed
				// text rather than a chosen element. Name the text operators:
				// the type's own default, `isAny`, expects an array of chosen
				// elements and ends up asking whether the typed text contains
				// the whole title — backwards, and case-sensitive.
				filterBy: { operators: [ 'contains', 'notContains' ] },
				getValue: ( { item } ) => item.title,
				render: ( { item } ) => (
					<TitleLink href={ item.edit_url }>{ item.title }</TitleLink>
				),
			},
			{
				id: 'author',
				type: 'text',
				label: __( 'Author', 'vip-workflows' ),
				enableGlobalSearch: true,
				// Typed text, for the same reason as the title above.
				filterBy: { operators: [ 'contains', 'notContains' ] },
				getValue: ( { item } ) => item.author?.display_name || '',
				// A post whose author account is gone. The route says so with a
				// null actor, and the word is the view's to choose — but it is
				// not the audit log's "System": nothing acted on the site's
				// behalf here, a person simply cannot be resolved any more. The
				// column said "Unknown" before the actor shape landed and says
				// it still, as text rather than an invented person, so no
				// avatar is drawn for somebody who is not there.
				render: ( { item } ) =>
					item.author ? (
						<AuthorCell actor={ item.author } />
					) : (
						__( 'Unknown', 'vip-workflows' )
					),
			},
			{
				// Deliberately untyped: the elements are scraped from the rows, and
				// a `text` field whose element list comes back empty still offers a
				// filter — a free-text box seeded with `isAny`, which compares the
				// wrong way round. An untyped one drops out of the filter menu
				// instead, which is honest when there is nothing to pick from.
				id: 'sequence_name',
				label: __( 'Workflow', 'vip-workflows' ),
				enableGlobalSearch: true,
				elements: toElements( items, 'sequence_name' ),
				filterBy: { operators: [ 'isAny' ] },
				getValue: ( { item } ) => item.sequence_name || '',
			},
			{
				id: 'status_label',
				label: __( 'Stage', 'vip-workflows' ),
				elements: toElements( items, 'status_label' ),
				filterBy: { operators: [ 'isAny' ], isPrimary: true },
				enableSorting: false,
				getValue: ( { item } ) => item.status_label,
				render: ( { item } ) => (
					<StatusBadge color={ item.status_color }>
						{ item.status_label }
					</StatusBadge>
				),
			},
			{
				// The route sends the wait twice: `waiting` is the phrase a
				// Kanban card shows for the same post — a duration, which is
				// what this header asks for — and `modified` is the instant
				// behind it. The phrase is what a reader sees; the instant is
				// what the column ranks on and what its `<time>` announces.
				// The route used to send the phrase alone, so this column could
				// not be ordered by the very thing it reports — what was
				// unsortable was the payload, not the column.
				id: 'waiting',
				type: 'datetime',
				label: __( 'Waiting', 'vip-workflows' ),
				filterBy: false,
				// Declared for the same reason My Work declares it: the type's
				// own default is core's translatable literal rather than this
				// site's setting.
				format: { datetime: siteDateTimeFormat() },
				getValue: ( { item } ) => item.modified,
				sort: sortByTimestamp,
				render: ( { item } ) => (
					<Timestamp
						value={ item.modified }
						variant="body-sm"
						className="vip-workflows-my-queue__waiting"
					>
						{ item.waiting }
					</Timestamp>
				),
			},
			{
				id: 'queue_actions',
				label: __( 'Actions', 'vip-workflows' ),
				enableHiding: false,
				enableSorting: false,
				enableGlobalSearch: false,
				filterBy: false,
				getValue: () => '',
				render: ( { item } ) => {
					/*
					 * One primary per cell: the first quick action is the
					 * stage's leading move, the rest are level secondaries —
					 * three equally-loud primaries in one cell said nothing.
					 * First rather than chosen: authored order is the only
					 * ranking the sequence carries, and the stage inspector
					 * is where an author arranges it.
					 */
					return (
						<Stack wrap="wrap" gap="sm">
							{ item.quick_actions?.map( ( action, index ) => (
								<Button
									key={ action.to }
									variant={
										index === 0 ? 'primary' : 'secondary'
									}
									size="small"
									onClick={ () =>
										handleQuickAction(
											item.post_id,
											action.to
										)
									}
									isBusy={
										actionLoading ===
										`${ item.post_id }-${ action.to }`
									}
									disabled={ actionLoading !== null }
								>
									{ action.label }
								</Button>
							) ) }
						</Stack>
					);
				},
			},
		],
		[ items, actionLoading, handleQuickAction ]
	);

	// Editing the post is the standard per-row action (matching My Work);
	// only the dynamic transition buttons need the bespoke column. "Edit",
	// not "Open": the destination is the editor, and the pencil says so —
	// "Open" plus the external glyph promised a view of the published post.
	const actions = useMemo(
		() => [
			{
				id: 'view',
				label: __( 'Edit', 'vip-workflows' ),
				isPrimary: true,
				icon: pencil,
				callback: ( [ item ] ) => {
					if ( item?.edit_url ) {
						window.location.assign( item.edit_url );
					}
				},
			},
		],
		[]
	);

	const { data, paginationInfo } = useMemo(
		() => filterSortAndPaginate( items, view, fields ),
		[ items, view, fields ]
	);

	if ( loading ) {
		return (
			<Stack
				className="vip-workflows-page-loading"
				align="center"
				justify="center"
				gap="md"
			>
				<Spinner />
				<span>{ __( 'Loading your queue…', 'vip-workflows' ) }</span>
			</Stack>
		);
	}

	return (
		<div className="vip-workflows-my-queue">
			{ error && (
				<Notice
					status="error"
					isDismissible
					onDismiss={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }

			{ items.length === 0 ? (
				<Card.Root>
					<Card.Content>
						<Stack
							className="vip-workflows-my-queue__empty"
							direction="column"
							gap="sm"
						>
							<Text variant="body-md" render={ <p /> }>
								{ __(
									'No posts are waiting for your action.',
									'vip-workflows'
								) }
							</Text>
							<Text
								variant="body-sm"
								render={ <p /> }
								className="vip-workflows-description"
							>
								{ __(
									'Check back later or visit the full Queue page for team-wide items.',
									'vip-workflows'
								) }
							</Text>
						</Stack>
					</Card.Content>
				</Card.Root>
			) : (
				<div className="vip-workflows-card-surface">
					<DataViews
						data={ data }
						fields={ fields }
						view={ view }
						onChangeView={ setView }
						actions={ actions }
						paginationInfo={ paginationInfo }
						defaultLayouts={ { table: {} } }
						searchLabel={ __(
							'Search your queue',
							'vip-workflows'
						) }
						getItemId={ ( item ) => String( item.post_id ) }
					/>
				</div>
			) }
			{ confirmDialog }
		</div>
	);
}
