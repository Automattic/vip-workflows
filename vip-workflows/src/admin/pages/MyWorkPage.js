/**
 * My Work Page Component.
 *
 * Shows all active work items (posts) for the current user as a
 * `@wordpress/dataviews` table. The dataset is small and fully loaded from a
 * single endpoint, so filtering/sorting/pagination run client-side via
 * `filterSortAndPaginate` (the documented plugin pattern).
 *
 * The list mixes workflow-managed posts with the user's own posts that no
 * workflow manages, so stage and core status are two columns, never one:
 * Stage renders the sequence's stage as the shared `@wordpress/ui` Badge
 * tinted with its per-stage color (consistent with the CPT and Audit Log
 * DataViews) and is empty for a post in no workflow, while Status renders the
 * core post status every post has.
 */

import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Spinner, Notice } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews/wp';
import { Badge, Stack, Text } from '@wordpress/ui';
import { pencil } from '@wordpress/icons';

import StatusBadge from '../components/StatusBadge';
import { TitleLink } from '../../common/DataViewCells';
import {
	Timestamp,
	siteDateTimeFormat,
	sortByTimestamp,
} from '../../common/datetime';
import { toElements } from '../utils/dataview-elements';

import './MyWorkPage.css';

// Editorial urgency (SLA): labels plus the Badge intent that conveys severity.
const URGENCY_LABELS = {
	breaking: __( 'Breaking', 'vip-workflow' ),
	urgent: __( 'Urgent', 'vip-workflow' ),
	normal: __( 'Normal', 'vip-workflow' ),
};
const URGENCY_INTENT = {
	breaking: 'high',
	urgent: 'medium',
	normal: 'none',
};

// Core post statuses a work item can carry: the four editorial regions a
// sequence can model, plus the `future` overlay. Fixed on purpose — a filter
// whose elements are scraped from the rows empties out when no row carries a
// value, and a field with no elements is filtered by typed text instead.
const CORE_STATUS_ELEMENTS = [
	{ value: 'draft', label: __( 'Draft', 'vip-workflow' ) },
	{ value: 'pending', label: __( 'Pending Review', 'vip-workflow' ) },
	{ value: 'future', label: __( 'Scheduled', 'vip-workflow' ) },
	{ value: 'private', label: __( 'Private', 'vip-workflow' ) },
	{ value: 'publish', label: __( 'Published', 'vip-workflow' ) },
];

const DEFAULT_VIEW = {
	type: 'table',
	search: '',
	filters: [],
	page: 1,
	perPage: 20,
	// No default sort: the /my-work endpoint already orders items by urgency
	// (breaking > urgent > normal) then date, and re-sorting client-side would
	// discard that triage ordering. Column headers still sort on demand.
	sort: {},
	titleField: 'title',
	fields: [
		'workflow_name',
		'status_label',
		'post_status',
		'urgency',
		'modified_date',
		'created_date',
	],
	layout: {},
};

export function MyWorkPage() {
	const [ items, setItems ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ view, setView ] = useState( DEFAULT_VIEW );

	const fetchWork = useCallback( async () => {
		setLoading( true );
		setError( null );

		try {
			const response = await apiFetch( {
				path: '/vip-workflow/v1/workflow/my-work',
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
				label: __( 'Title', 'vip-workflow' ),
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
				label: __( 'Workflow', 'vip-workflow' ),
				enableGlobalSearch: true,
				elements: toElements( items, 'workflow_name' ),
				filterBy: { operators: [ 'isAny' ] },
				getValue: ( { item } ) => item.workflow_name || '',
				render: ( { item } ) => item.workflow_name || '—',
			},
			{
				id: 'status_label',
				label: __( 'Stage', 'vip-workflow' ),
				elements: toElements( items, 'status_label' ),
				filterBy: { operators: [ 'isAny' ], isPrimary: true },
				enableSorting: false,
				getValue: ( { item } ) => item.status_label,
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
				label: __( 'Status', 'vip-workflow' ),
				elements: CORE_STATUS_ELEMENTS,
				filterBy: { operators: [ 'isAny' ] },
				enableSorting: false,
				getValue: ( { item } ) => item.post_status,
				render: ( { item } ) => item.post_status_label || '—',
			},
			{
				id: 'urgency',
				label: __( 'SLA', 'vip-workflow' ),
				elements: Object.entries( URGENCY_LABELS ).map(
					( [ value, label ] ) => ( { value, label } )
				),
				filterBy: { operators: [ 'isAny' ] },
				enableSorting: false,
				getValue: ( { item } ) => item.urgency || 'normal',
				render: ( { item } ) => (
					<Badge intent={ URGENCY_INTENT[ item.urgency ] || 'none' }>
						{ URGENCY_LABELS[ item.urgency ] || item.urgency }
					</Badge>
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
				label: __( 'Last Updated', 'vip-workflow' ),
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
				label: __( 'Created', 'vip-workflow' ),
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
				label: __( 'Edit', 'vip-workflow' ),
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
				className="vip-workflow-page-loading"
				align="center"
				justify="center"
				gap="md"
			>
				<Spinner />
				<span>{ __( 'Loading your work…', 'vip-workflow' ) }</span>
			</Stack>
		);
	}

	return (
		<div className="vip-workflow-my-work">
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
					className="vip-workflow-my-work__empty"
					direction="column"
					gap="sm"
				>
					<Text variant="body-md" render={ <p /> }>
						{ __( 'No active work items.', 'vip-workflow' ) }
					</Text>
					<Text
						variant="body-sm"
						render={ <p /> }
						className="vip-workflow-description"
					>
						{ __(
							'New work assigned to you will appear here.',
							'vip-workflow'
						) }
					</Text>
				</Stack>
			) : (
				<div className="vip-workflow-card-surface">
					<DataViews
						data={ data }
						fields={ fields }
						view={ view }
						onChangeView={ setView }
						actions={ actions }
						paginationInfo={ paginationInfo }
						defaultLayouts={ { table: {} } }
						searchLabel={ __( 'Search your work', 'vip-workflow' ) }
						getItemId={ ( item ) => String( item.post_id ) }
					/>
				</div>
			) }
		</div>
	);
}
