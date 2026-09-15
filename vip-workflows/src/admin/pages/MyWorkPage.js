/**
 * My Work Page Component.
 *
 * Shows work items (posts) for the current user as a
 * `@wordpress/dataviews` table (also offered as a grid, with the post's
 * featured image as its media). The user's dataset is loaded from a single
 * endpoint, so filtering/sorting/pagination run client-side via
 * `filterSortAndPaginate` (the documented plugin pattern).
 *
 * The list mixes workflow-managed posts with the user's own posts that no
 * workflow manages, so stage and core status are two columns, never one:
 * Stage renders the sequence's stage as the shared `@wordpress/ui` Badge
 * tinted with its per-stage color (consistent with the CPT and Audit Log
 * DataViews) and is empty for a post in no workflow, while Status renders the
 * core post status every post has.
 *
 * The view is free-composed (`CardGridView.js`'s pattern) rather than using
 * DataViews' default chrome, purely to slot in one control DataViews itself
 * doesn't offer: grouping. `view.groupBy` is supported end-to-end by
 * `filterSortAndPaginate` and the table layout, but ships no picker for it —
 * the "Group by" select below is the one hand-built piece of UI on this page.
 * The view (filters, sort, visible columns, group-by) persists per-user in
 * localStorage so a reader's customization survives a reload.
 */

import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Spinner, Notice, SelectControl } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews/wp';
import { Stack, Text } from '@wordpress/ui';
import { pencil } from '@wordpress/icons';

import StatusBadge from '../components/StatusBadge';
import { TitleLink, AuthorCell } from '../../common/DataViewCells';
import {
	Timestamp,
	siteDateTimeFormat,
	sortByTimestamp,
} from '../../common/datetime';
import { toElements } from '../utils/dataview-elements';

import './MyWorkPage.css';

/**
 * Alphabetical, but a blank value always sorts last regardless of direction.
 *
 * DataViews' own comparator treats `''` as an ordinary string, so it sorts
 * before every real value in ascending order — "no workflow" reads as if it
 * came alphabetically first, and leads both the table and (since grouping
 * reuses this same comparator, per `groupByField.sort` in
 * `filterSortAndPaginate`) the group order. A row with nothing to say about
 * a field belongs at the end of it, in either direction, not at the front of
 * ascending.
 *
 * @param {string} a         First value.
 * @param {string} b         Second value.
 * @param {string} direction 'asc' or 'desc'.
 * @return {number} Ordering of `a` against `b`.
 */
function sortTextEmptyLast( a, b, direction ) {
	if ( ! a && ! b ) {
		return 0;
	}
	if ( ! a ) {
		return 1;
	}
	if ( ! b ) {
		return -1;
	}
	const compared = a.localeCompare( b );
	return 'desc' === direction ? -compared : compared;
}

// Core post statuses a work item can carry: the four editorial regions a
// sequence can model, plus the `future` overlay. Fixed on purpose — a filter
// whose elements are scraped from the rows empties out when no row carries a
// value, and a field with no elements is filtered by typed text instead.
const CORE_STATUS_ELEMENTS = [
	{ value: 'draft', label: __( 'Draft', 'vip-workflows' ) },
	{ value: 'pending', label: __( 'Pending Review', 'vip-workflows' ) },
	{ value: 'future', label: __( 'Scheduled', 'vip-workflows' ) },
	{ value: 'private', label: __( 'Private', 'vip-workflows' ) },
	{ value: 'publish', label: __( 'Published', 'vip-workflows' ) },
];

// Fields a reader can group rows by. Deliberately not every filterable field:
// grouping renders a header from the field's raw `getValue()` (DataViews has
// no group-label lookup), and `post_status`'s getValue is the core slug
// (`draft`) rather than its label — a correct filter value, but a header
// nobody would want to read. Only fields whose getValue is already the
// human-readable string are offered here.
const GROUP_BY_FIELDS = [
	{ value: '', label: __( 'No grouping', 'vip-workflows' ) },
	{ value: 'status_label', label: __( 'Stage', 'vip-workflows' ) },
	{ value: 'workflow_name', label: __( 'Workflow', 'vip-workflows' ) },
	{ value: 'author', label: __( 'Author', 'vip-workflows' ) },
	{ value: 'assignee', label: __( 'Assignee', 'vip-workflows' ) },
];

const DEFAULT_VIEW = {
	type: 'table',
	search: '',
	filters: [],
	page: 1,
	perPage: 20,
	sort: { field: 'modified_date', direction: 'desc' },
	titleField: 'title',
	// The grid layout's media, read regardless of `fields` visibility below —
	// a post with no featured image renders the same placeholder DataViews
	// itself draws when a media field has no render at all.
	mediaField: 'featured_image',
	showMedia: false,
	fields: [
		'workflow_name',
		'status_label',
		'post_status',
		'author',
		'assignee',
		'modified_date',
		'created_date',
	],
	layout: {},
};

/**
 * Build the localStorage key a user's customized view is stored under.
 *
 * @return {string} Storage key.
 */
function storageKey() {
	const userId = window.vipWorkflowsAdmin?.currentUser?.id;
	if ( ! Number.isInteger( userId ) || userId <= 0 ) {
		throw new Error( 'My Work requires the current user ID.' );
	}
	return `vip_workflows_my_work_view_${ userId }`;
}

/**
 * Read saved customizations. Missing preferences use the initial view;
 * unreadable preferences are reported by the page's error boundary.
 *
 * @return {Object} View.
 */
function loadStoredView() {
	const raw = window.localStorage.getItem( storageKey() );
	if ( raw === null ) {
		return DEFAULT_VIEW;
	}
	const storedView = JSON.parse( raw );
	if (
		! storedView ||
		typeof storedView !== 'object' ||
		Array.isArray( storedView )
	) {
		throw new Error( 'The saved My Work view must be an object.' );
	}
	return { ...DEFAULT_VIEW, ...storedView };
}

export function MyWorkPage() {
	const [ items, setItems ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ view, setView ] = useState( loadStoredView );

	const handleChangeView = useCallback( ( nextView ) => {
		try {
			window.localStorage.setItem(
				storageKey(),
				JSON.stringify( nextView )
			);
		} catch ( err ) {
			setError( err.message );
			return;
		}
		setView( nextView );
	}, [] );

	const handleChangeGroupBy = useCallback(
		( field ) => {
			handleChangeView( {
				...view,
				groupBy: field ? { field } : undefined,
			} );
		},
		[ view, handleChangeView ]
	);

	const fetchWork = useCallback( async () => {
		setLoading( true );
		setError( null );

		try {
			const response = await apiFetch( {
				path: '/vip-workflows/v1/workflow/my-work',
			} );
			setItems( response );
		} catch ( err ) {
			setError( err.message );
		} finally {
			setLoading( false );
		}
	}, [] );

	useEffect( () => {
		fetchWork();
	}, [ fetchWork ] );

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
				// Deliberately untyped: the elements are scraped from the rows, so
				// they are empty on a list of nothing but non-workflow posts. A
				// `text` field with no elements still offers a filter — a free-text
				// box seeded with `isAny`, which compares the wrong way round — while
				// an untyped one drops out of the filter menu, which is honest when
				// there is no workflow to filter by.
				id: 'workflow_name',
				label: __( 'Workflow', 'vip-workflows' ),
				enableGlobalSearch: true,
				elements: toElements( items, 'workflow_name' ),
				// `isPrimary`, like Stage below: a quick filter chip up front
				// rather than one more click behind "Add filter".
				filterBy: { operators: [ 'isAny' ], isPrimary: true },
				sort: sortTextEmptyLast,
				getValue: ( { item } ) => item.workflow_name || '',
				render: ( { item } ) => item.workflow_name || '—',
			},
			{
				id: 'status_label',
				label: __( 'Stage', 'vip-workflows' ),
				elements: toElements( items, 'status_label' ),
				filterBy: { operators: [ 'isAny' ], isPrimary: true },
				// Sortable on purpose, not left over: grouping and column-sort
				// share DataViews' one `enableSorting` gate (both look up a
				// field via `enableSorting !== false` in filterSortAndPaginate),
				// so Stage being offered in the Group By control requires this.
				sort: sortTextEmptyLast,
				getValue: ( { item } ) => item.status_label ?? '',
				// A post no workflow manages is at no stage. It still has a core
				// status, which is the Status column's job, not this one's.
				render: ( { item } ) =>
					item.status_label ? (
						<StatusBadge color={ item.status_color }>
							{ item.status_label }
						</StatusBadge>
					) : (
						'—'
					),
			},
			{
				id: 'post_status',
				label: __( 'Status', 'vip-workflows' ),
				elements: CORE_STATUS_ELEMENTS,
				filterBy: { operators: [ 'isAny' ] },
				enableSorting: false,
				getValue: ( { item } ) => item.post_status,
				render: ( { item } ) => item.post_status_label || '—',
			},
			{
				id: 'author',
				label: __( 'Author', 'vip-workflows' ),
				// `getValue` is the display name, not the author id or object:
				// both filter matching and group headers read a field's raw
				// `getValue()`, and a name is what a filter chip or a group
				// header should show. `render` still draws from the full actor.
				elements: toElements(
					items.map( ( item ) => ( {
						author_name: item.author?.display_name,
					} ) ),
					'author_name'
				),
				filterBy: { operators: [ 'isAny' ] },
				sort: sortTextEmptyLast,
				getValue: ( { item } ) => item.author?.display_name ?? '',
				render: ( { item } ) =>
					item.author ? <AuthorCell actor={ item.author } /> : '—',
			},
			{
				// The person currently claiming the post, not one of a sequence's
				// named assignment slots (a legal reviewer, an editorial approver,
				// …) — a post can have several of those pending at once, to
				// different people, so no single one of them is "the" assignee.
				// This is the one claim a post has at most one of at a time.
				id: 'assignee',
				label: __( 'Assignee', 'vip-workflows' ),
				elements: toElements(
					items.map( ( item ) => ( {
						assignee_name: item.assignee?.display_name,
					} ) ),
					'assignee_name'
				),
				filterBy: { operators: [ 'isAny' ] },
				sort: sortTextEmptyLast,
				getValue: ( { item } ) => item.assignee?.display_name ?? '',
				render: ( { item } ) =>
					item.assignee ? (
						<AuthorCell actor={ item.assignee } />
					) : (
						'—'
					),
			},
			{
				// Grid-only: rendered as the card's media via `view.mediaField`,
				// never a visible table column (kept out of `DEFAULT_VIEW.fields`
				// on purpose) — a table full of thumbnails wasn't asked for, and
				// the grid finds this field by id regardless of the visible-column
				// list. The library draws its own placeholder box whenever a media
				// field has no `render`, so it's reused here for "no image" rather
				// than inventing a second one.
				id: 'featured_image',
				type: 'media',
				label: __( 'Featured Image', 'vip-workflows' ),
				enableSorting: false,
				enableGlobalSearch: false,
				filterBy: false,
				getValue: ( { item } ) => item.featured_image_url ?? '',
				render: ( { item } ) =>
					item.featured_image_url ? (
						<img
							src={ item.featured_image_url }
							alt=""
							loading="lazy"
						/>
					) : (
						<span className="dataviews-view-grid__media-placeholder" />
					),
			},
			// Both dates render as the shared `<Timestamp>` rather than the
			// field type's bare string, so the instant is on the page in a form
			// something other than a human eye can read.
			//
			// `format` stays even though `render` covers every cell these
			// fields draw today. It is what `getValueFormatted` composes the
			// field's string form from, and DataViews reaches for that in two
			// places neither field currently goes: a filter chip's label (both
			// declare `filterBy: false`) and a grid layout's title (this page
			// offers only `table`). Left off, that string form would fall back
			// to the type's own default — core's translatable `datetime`
			// literal, a US pattern read from no site setting at all — so it is
			// declared here against these ever becoming filterable or gaining a
			// grid layout. The My Queue waiting column declares it likewise.
			{
				id: 'modified_date',
				type: 'datetime',
				label: __( 'Last updated', 'vip-workflows' ),
				filterBy: false,
				format: { datetime: siteDateTimeFormat() },
				sort: sortByTimestamp,
				render: ( { item } ) => (
					<Timestamp value={ item.modified_date } />
				),
			},
			{
				id: 'created_date',
				type: 'datetime',
				label: __( 'Created', 'vip-workflows' ),
				filterBy: false,
				format: { datetime: siteDateTimeFormat() },
				sort: sortByTimestamp,
				render: ( { item } ) => (
					<Timestamp value={ item.created_date } />
				),
			},
		],
		[ items ]
	);

	const actions = useMemo(
		() => [
			// "Edit", not "Open": the destination is the editor, and the
			// pencil says so — "Open" plus the external glyph promised a
			// view of the published post.
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
				<span>{ __( 'Loading your work…', 'vip-workflows' ) }</span>
			</Stack>
		);
	}

	return (
		<div className="vip-workflows-my-work">
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
				<Stack
					className="vip-workflows-my-work__empty"
					direction="column"
					gap="sm"
				>
					<Text variant="body-md" render={ <p /> }>
						{ __( 'No active work items.', 'vip-workflows' ) }
					</Text>
					<Text
						variant="body-sm"
						render={ <p /> }
						className="vip-workflows-description"
					>
						{ __(
							'New work assigned to you will appear here.',
							'vip-workflows'
						) }
					</Text>
				</Stack>
			) : (
				<div className="vip-workflows-my-work-panel vip-workflows-card-surface">
					<DataViews
						data={ data }
						fields={ fields }
						view={ view }
						onChangeView={ handleChangeView }
						actions={ actions }
						paginationInfo={ paginationInfo }
						defaultLayouts={ {
							table: { showMedia: false },
							grid: { showMedia: true },
						} }
						searchLabel={ __(
							'Search your work',
							'vip-workflows'
						) }
						getItemId={ ( item ) => String( item.post_id ) }
					>
						<Stack direction="column" gap="lg">
							<Stack
								gap="sm"
								align="center"
								justify="space-between"
							>
								<Stack gap="sm" align="center">
									<DataViews.Search
										label={ __(
											'Search your work',
											'vip-workflows'
										) }
									/>
									<DataViews.FiltersToggle />
									{ /* `compact` (32px), not `__next40pxDefaultSize`
									     (40px): this sits in the same row as
									     DataViews' own Search box and icon
									     buttons, all compact, and the taller
									     default size stood 8px above and below
									     them rather than lining up. */ }
									<SelectControl
										label={ __(
											'Group by',
											'vip-workflows'
										) }
										labelPosition="side"
										size="compact"
										value={ view.groupBy?.field ?? '' }
										options={ GROUP_BY_FIELDS }
										onChange={ handleChangeGroupBy }
										__nextHasNoMarginBottom
									/>
								</Stack>
								<Stack gap="sm" align="center">
									{ /* Free composition, unlike the default UI,
									     does not fold the layout switcher into
									     `<DataViews.ViewConfig>` — the gear only
									     ever renders sort/density/properties.
									     `LayoutSwitcher` is the separate piece
									     that offers table vs. grid; without it
									     here the grid layout above would exist
									     in config but have no way to reach it. */ }
									<DataViews.LayoutSwitcher />
									<DataViews.ViewConfig />
								</Stack>
							</Stack>
							<DataViews.FiltersToggled />
							<DataViews.Layout />
							<DataViews.Pagination />
						</Stack>
					</DataViews>
				</div>
			) }
		</div>
	);
}
