/**
 * My Ideation Page Component.
 *
 * Shows ideation projects created by the current user with their pipeline
 * status as a `@wordpress/dataviews` table. The dataset is small and fully
 * loaded, so filtering/sorting/pagination run client-side via
 * `filterSortAndPaginate`. Status renders as a `@wordpress/ui` Badge carrying a
 * semantic intent from `admin/utils/pipeline-status.js` — a fixed vocabulary the
 * plugin owns, so the design system decides its tone rather than an author-picked
 * stage colour.
 */

import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Button, Spinner, Notice } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews/wp';
import { external } from '@wordpress/icons';
import { Badge, Stack, Text } from '@wordpress/ui';

import { TitleLink } from '../../common/DataViewCells';
import { siteDateTimeFormat } from '../../common/datetime';
import {
	pipelineStatus,
	pipelineStatusElements,
} from '../utils/pipeline-status';

import './MyIdeationPage.css';

const DEFAULT_VIEW = {
	type: 'table',
	search: '',
	filters: [],
	page: 1,
	perPage: 20,
	sort: { field: 'updated_at', direction: 'desc' },
	titleField: 'title',
	fields: [ 'pipeline_status', 'source_count', 'updated_at' ],
	layout: {},
};

export function MyIdeationPage() {
	const [ projects, setProjects ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ view, setView ] = useState( DEFAULT_VIEW );

	const fetchProjects = useCallback( async () => {
		setLoading( true );
		setError( null );

		try {
			const items = await apiFetch( {
				path: '/vip-workflows/v1/ideation?per_page=50&author=me',
			} );
			setProjects( items );
		} catch ( err ) {
			setError( err.message );
		} finally {
			setLoading( false );
		}
	}, [] );

	useEffect( () => {
		fetchProjects();
	}, [ fetchProjects ] );

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
					<span>
						<TitleLink
							href={ `admin.php?page=vip-workflows-ideation#workspace?project=${ item.id }` }
						>
							{ item.title }
						</TitleLink>
						{ item.tags?.length > 0 && (
							<Text
								variant="body-sm"
								className="vip-workflows-my-ideation__tags"
							>
								{ item.tags.slice( 0, 3 ).join( ', ' ) }
							</Text>
						) }
					</span>
				),
			},
			{
				id: 'pipeline_status',
				label: __( 'Status', 'vip-workflows' ),
				elements: pipelineStatusElements(),
				filterBy: { operators: [ 'isAny' ], isPrimary: true },
				enableSorting: false,
				getValue: ( { item } ) => item.pipeline_status || 'ideation',
				render: ( { item } ) => {
					const { label, intent } = pipelineStatus(
						item.pipeline_status
					);
					return <Badge intent={ intent }>{ label }</Badge>;
				},
			},
			{
				id: 'source_count',
				type: 'integer',
				label: __( 'Sources', 'vip-workflows' ),
				filterBy: false,
				getValue: ( { item } ) => item.source_count || 0,
			},
			{
				id: 'updated_at',
				type: 'datetime',
				label: __( 'Updated', 'vip-workflows' ),
				filterBy: false,
				format: { datetime: siteDateTimeFormat() },
			},
		],
		[]
	);

	const actions = useMemo(
		() => [
			{
				id: 'open',
				label: __( 'Open', 'vip-workflows' ),
				isPrimary: true,
				icon: external,
				callback: ( [ item ] ) => {
					window.location.assign(
						`admin.php?page=vip-workflows-ideation#workspace?project=${ item.id }`
					);
				},
			},
		],
		[]
	);

	const { data, paginationInfo } = useMemo(
		() => filterSortAndPaginate( projects, view, fields ),
		[ projects, view, fields ]
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
				<span>
					{ __( 'Loading your ideation projects…', 'vip-workflows' ) }
				</span>
			</Stack>
		);
	}

	return (
		<div className="vip-workflows-my-ideation">
			{ error && (
				<Notice
					status="error"
					isDismissible
					onDismiss={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }

			{ projects.length === 0 ? (
				<div className="vip-workflows-my-ideation__empty">
					<Text variant="body-md" render={ <p /> }>
						{ __(
							"You haven't started any ideation projects yet.",
							'vip-workflows'
						) }
					</Text>
					<Button
						variant="primary"
						href="admin.php?page=vip-workflows-ideation"
					>
						{ __( 'Go to Ideation', 'vip-workflows' ) }
					</Button>
				</div>
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
							'Search your projects',
							'vip-workflows'
						) }
						getItemId={ ( item ) => String( item.id ) }
					/>
				</div>
			) }
		</div>
	);
}
