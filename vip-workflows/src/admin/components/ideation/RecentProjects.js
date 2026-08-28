/**
 * Recent Ideation Projects Component.
 *
 * Shown on the ideation landing below the seed input.
 * Lists the user's recent ideation projects for quick access,
 * split into active ideas and projects that moved into the pipeline.
 *
 * Active ideas render as a `@wordpress/dataviews` grid. The dataset is small and
 * fully loaded from one endpoint, so search / filtering / pagination run
 * client-side via `filterSortAndPaginate`, the pattern the other list screens
 * use. DataViews' pagination replaces the old "Show more" button.
 */

import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Button } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews/wp';
import { Badge, Collapsible, Stack, Text } from '@wordpress/ui';

import { AuthorCell } from '../../../common/DataViewCells';
import { formatDate } from '../../../common/datetime';
import { PIPELINE_STATUSES, pipelineStatus } from '../../utils/pipeline-status';

import './RecentProjects.css';

// The statuses that mean an idea has left ideation, derived from the shared
// vocabulary rather than re-listed here — a hard-coded copy of three of its
// four slugs is exactly the drift this module exists to stop, and it would
// silently omit any status added later. `ideation` is the one it drops: that is
// the other list on this screen. Names and tones still come from the shared
// vocabulary too, so the two screens cannot disagree on what "In Editorial" is
// called or how it reads.
const PIPELINE_TABLE_STATUSES = Object.keys( PIPELINE_STATUSES ).filter(
	( status ) => 'ideation' !== status
);
const IDEAS_PER_PAGE = 6;

// An idea's own post status, and the badge tone it reads in.
const RECENT_STATUSES = {
	publish: { label: __( 'Active', 'vip-workflow' ), intent: 'stable' },
	draft: { label: __( 'Draft', 'vip-workflow' ), intent: 'none' },
	archive: { label: __( 'Archived', 'vip-workflow' ), intent: 'none' },
};

const RECENT_STATUS_ELEMENTS = Object.entries( RECENT_STATUSES ).map(
	( [ value, { label } ] ) => ( { value, label } )
);

// The author only earns a row when the reader is browsing everyone's ideas —
// in "Mine" every card would name the same person.
const MINE_FIELDS = [ 'status', 'source_count', 'updated_at' ];
const ALL_FIELDS = [ ...MINE_FIELDS, 'author' ];

const DEFAULT_VIEW = {
	type: 'grid',
	search: '',
	filters: [],
	page: 1,
	perPage: IDEAS_PER_PAGE,
	sort: { field: 'updated_at', direction: 'desc' },
	titleField: 'title',
	descriptionField: 'tags',
	fields: MINE_FIELDS,
	// An idea has no artwork, so the card's media slot is suppressed here and its
	// empty placeholder is hidden in RecentProjects.css.
	showMedia: false,
	layout: {},
};

/**
 * @param {Object}   props          Component props.
 * @param {Function} props.onSelect Called with project ID when one is selected.
 * @return {JSX.Element} Recent projects list.
 */
export default function RecentProjects( { onSelect } ) {
	const canManage = window.vipWorkflowAdmin?.currentUser?.canManage;
	const [ projects, setProjects ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ showAll, setShowAll ] = useState( false );
	const [ view, setView ] = useState( DEFAULT_VIEW );

	useEffect( () => {
		const doFetch = async () => {
			try {
				const authorParam = showAll ? 'all' : 'me';
				const items = await apiFetch( {
					path: `/vip-workflow/v1/ideation?per_page=50&author=${ authorParam }`,
				} );
				setProjects( items );
			} catch {
				// Silently fail for recent projects.
			} finally {
				setLoading( false );
			}
		};

		doFetch();
	}, [ showAll ] );

	// Switching scope swaps the dataset, so the view goes back to its first page
	// and picks up (or drops) the author row with it.
	const setScope = useCallback( ( all ) => {
		setShowAll( all );
		setView( ( prev ) => ( {
			...prev,
			page: 1,
			fields: all ? ALL_FIELDS : MINE_FIELDS,
		} ) );
	}, [] );

	const fields = useMemo(
		() => [
			{
				id: 'title',
				type: 'text',
				label: __( 'Title', 'vip-workflow' ),
				enableHiding: false,
				enableGlobalSearch: true,
			},
			{
				id: 'tags',
				type: 'text',
				label: __( 'Tags', 'vip-workflow' ),
				filterBy: false,
				enableSorting: false,
				getValue: ( { item } ) => item.tags?.join( ', ' ) || '',
				render: ( { item } ) =>
					item.tags?.length > 0
						? item.tags.slice( 0, 3 ).join( ', ' )
						: null,
			},
			{
				id: 'status',
				label: __( 'Status', 'vip-workflow' ),
				elements: RECENT_STATUS_ELEMENTS,
				filterBy: { operators: [ 'isAny' ], isPrimary: true },
				enableSorting: false,
				getValue: ( { item } ) => item.status,
				render: ( { item } ) => {
					const status = RECENT_STATUSES[ item.status ];
					return (
						<Badge
							intent={ status?.intent || 'none' }
							className="vip-workflow-ideation-recent__badge"
						>
							{ status?.label || item.status }
						</Badge>
					);
				},
			},
			{
				id: 'source_count',
				type: 'integer',
				label: __( 'Sources', 'vip-workflow' ),
				filterBy: false,
				getValue: ( { item } ) => item.source_count || 0,
				// An idea with no sources yet drops the row entirely: the grid
				// hides a field whose value renders empty.
				render: ( { item } ) => item.source_count || null,
			},
			{
				id: 'updated_at',
				type: 'datetime',
				label: __( 'Updated', 'vip-workflow' ),
				filterBy: false,
				// These are recent items in a card's meta row, so the time of
				// day earns no space — the date alone, in the format the site
				// writes dates in. A `render` rather than a `format`, because
				// `format.datetime` is the only string the type reads and it
				// always carries a time; the render replaces the type's own
				// while its sorting and date operators still apply.
				render: ( { item } ) => formatDate( item.updated_at ),
			},
			{
				id: 'author',
				type: 'text',
				label: __( 'Author', 'vip-workflow' ),
				filterBy: false,
				enableSorting: false,
				getValue: ( { item } ) => item.author?.display_name || '',
				render: ( { item } ) => <AuthorCell actor={ item.author } />,
			},
		],
		[]
	);

	const activeIdeas = useMemo(
		() =>
			projects.filter(
				( p ) => ! p.pipeline_status || p.pipeline_status === 'ideation'
			),
		[ projects ]
	);

	const pipelineProjects = useMemo(
		() =>
			projects.filter( ( p ) =>
				PIPELINE_TABLE_STATUSES.includes( p.pipeline_status )
			),
		[ projects ]
	);

	const { data, paginationInfo } = useMemo(
		() => filterSortAndPaginate( activeIdeas, view, fields ),
		[ activeIdeas, view, fields ]
	);

	if ( loading || projects.length === 0 ) {
		return null;
	}

	return (
		<Stack
			direction="column"
			gap="2xl"
			className="vip-workflow-ideation-recent"
		>
			{ activeIdeas.length > 0 && (
				<Stack direction="column" gap="lg">
					<Stack
						align="center"
						justify="space-between"
						className="vip-workflow-ideation-recent__header"
					>
						<Text
							variant="heading-sm"
							render={ <h3 /> }
							className="vip-workflow-ideation-recent__title vip-workflow-eyebrow"
						>
							{ __( 'Recent ideas', 'vip-workflow' ) }
						</Text>
						{ canManage && (
							<Stack gap="xs">
								<Button
									variant={ showAll ? 'tertiary' : 'primary' }
									onClick={ () => setScope( false ) }
									size="small"
								>
									{ __( 'Mine', 'vip-workflow' ) }
								</Button>
								<Button
									variant={ showAll ? 'primary' : 'tertiary' }
									onClick={ () => setScope( true ) }
									size="small"
								>
									{ __( 'All', 'vip-workflow' ) }
								</Button>
							</Stack>
						) }
					</Stack>
					<DataViews
						data={ data }
						fields={ fields }
						view={ view }
						onChangeView={ setView }
						paginationInfo={ paginationInfo }
						defaultLayouts={ { grid: {} } }
						searchLabel={ __( 'Search ideas', 'vip-workflow' ) }
						getItemId={ ( item ) => String( item.id ) }
						onClickItem={ ( item ) => onSelect( item.id ) }
						// Only ever seen when a search or filter excludes
						// everything: the block is not rendered at all when
						// there are no active ideas to begin with.
						empty={
							<Text variant="body-md" render={ <p /> }>
								{ __( 'No ideas found.', 'vip-workflow' ) }
							</Text>
						}
					/>
				</Stack>
			) }

			{ pipelineProjects.length > 0 && (
				<Collapsible.Root className="vip-workflow-ideation-pipeline">
					<Collapsible.Trigger className="vip-workflow-ideation-pipeline__summary">
						{ /* wpds-allow R7 -- disclosure chevron glyph; a decorative marker, not text */ }
						<span
							className="vip-workflow-ideation-pipeline__chevron"
							aria-hidden="true"
						>
							&#9654;
						</span>
						{ __( 'In Pipeline', 'vip-workflow' ) }
						{ /* wpds-allow R7 -- styled count pill (inline-flex badge); not a Stack/Text */ }
						<span className="vip-workflow-ideation-pipeline__count">
							{ pipelineProjects.length }
						</span>
					</Collapsible.Trigger>
					<Collapsible.Panel>
						<table className="vip-workflow-ideation-pipeline__table">
							<thead>
								<tr>
									<Text
										variant="heading-sm"
										render={ <th /> }
										className="vip-workflow-eyebrow"
									>
										{ __( 'Title', 'vip-workflow' ) }
									</Text>
									<Text
										variant="heading-sm"
										render={ <th /> }
										className="vip-workflow-eyebrow"
									>
										{ __( 'Status', 'vip-workflow' ) }
									</Text>
									<Text
										variant="heading-sm"
										render={ <th /> }
										className="vip-workflow-eyebrow"
									>
										{ __( 'Date', 'vip-workflow' ) }
									</Text>
								</tr>
							</thead>
							<tbody>
								{ pipelineProjects.map( ( project ) => (
									// The row's onClick is a mouse convenience;
									// the keyboard path is the title button
									// below. A focusable <tr> would put a fake
									// control in the tab order without a role a
									// screen reader could announce truthfully.
									<tr
										key={ project.id }
										className="vip-workflow-ideation-pipeline__row"
										onClick={ () => onSelect( project.id ) }
									>
										<td className="vip-workflow-ideation-pipeline__cell-title">
											<Button
												variant="link"
												onClick={ ( e ) => {
													e.stopPropagation();
													onSelect( project.id );
												} }
											>
												{ project.title }
											</Button>
										</td>
										<td>
											<Badge
												intent={
													pipelineStatus(
														project.pipeline_status
													).intent
												}
												className="vip-workflow-ideation-pipeline__badge"
											>
												{
													pipelineStatus(
														project.pipeline_status
													).label
												}
											</Badge>
										</td>
										<td className="vip-workflow-ideation-pipeline__cell-date">
											{ formatDate( project.updated_at ) }
										</td>
									</tr>
								) ) }
							</tbody>
						</table>
					</Collapsible.Panel>
				</Collapsible.Root>
			) }
		</Stack>
	);
}
