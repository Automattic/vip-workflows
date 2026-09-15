/**
 * My Dashboard Page Component.
 *
 * Consolidated view with tabs for My Work, My Ideation, and My Queue.
 */

import { useState, useEffect, useMemo, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Tabs } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';

import { MyWorkPage } from './MyWorkPage';
import { MyQueuePage } from './MyQueuePage';
import { MyIdeationPage } from './MyIdeationPage';

import './MyDashboardPage.css';

export function MyDashboardPage() {
	const canEditOthersPosts =
		!! window.vipWorkflowsAdmin?.currentUser?.canManage;
	const ideationEnabled = !! window.vipWorkflowsAdmin?.experiments?.ideation;
	// My Queue is both role-gated (editors+) and, while it's still evolving,
	// experiment-gated — the same combination Calendar and Kanban use for a
	// surface that isn't ready for every site yet.
	const myQueueEnabled =
		canEditOthersPosts &&
		!! window.vipWorkflowsAdmin?.experiments?.my_queue;
	const [ counts, setCounts ] = useState( {} );

	useEffect( () => {
		const fetchCount = ( key, path, useHeader = false ) => {
			if ( useHeader ) {
				apiFetch( { path, parse: false } )
					.then( ( res ) => {
						const total = parseInt(
							res.headers.get( 'X-WP-Total' ) || '0',
							10
						);
						setCounts( ( prev ) => ( {
							...prev,
							[ key ]: total,
						} ) );
					} )
					.catch( () => {} );
			} else {
				apiFetch( { path } )
					.then( ( data ) => {
						setCounts( ( prev ) => ( {
							...prev,
							[ key ]: Array.isArray( data ) ? data.length : 0,
						} ) );
					} )
					.catch( () => {} );
			}
		};

		fetchCount( 'my-work', '/vip-workflows/v1/workflow/my-work' );
		if ( ideationEnabled ) {
			fetchCount(
				'my-ideation',
				'/vip-workflows/v1/ideation?per_page=50&author=me'
			);
		}
		if ( myQueueEnabled ) {
			fetchCount( 'my-queue', '/vip-workflows/v1/workflow/my-queue' );
		}
	}, [ ideationEnabled, myQueueEnabled ] );

	const formatTitle = useCallback(
		( label, tabName ) => {
			const count = counts[ tabName ];
			return count !== undefined ? `${ label } (${ count })` : label;
		},
		[ counts ]
	);

	// Build tabs based on user capabilities.
	const tabs = useMemo( () => {
		const baseTabs = [
			{
				name: 'my-work',
				title: formatTitle(
					__( 'My work', 'vip-workflows' ),
					'my-work'
				),
			},
		];

		// My Ideation is a vip-workflows-ideation-owned surface.
		if ( ideationEnabled ) {
			baseTabs.push( {
				name: 'my-ideation',
				title: formatTitle(
					__( 'My ideation', 'vip-workflows' ),
					'my-ideation'
				),
			} );
		}

		// My Queue: editors+ only, and only while the experiment is enabled.
		if ( myQueueEnabled ) {
			baseTabs.push( {
				name: 'my-queue',
				title: formatTitle(
					__( 'My queue', 'vip-workflows' ),
					'my-queue'
				),
			} );
		}

		return baseTabs;
	}, [ ideationEnabled, myQueueEnabled, formatTitle ] );

	const validTabNames = useMemo(
		() => tabs.map( ( t ) => t.name ),
		[ tabs ]
	);

	// Parse initial tab from URL hash.
	const getInitialTab = () => {
		const hash = window.location.hash.replace( '#', '' );
		if ( validTabNames.includes( hash ) ) {
			return hash;
		}
		return 'my-work';
	};

	const [ activeTab, setActiveTab ] = useState( getInitialTab );

	// Update URL when tab changes.
	useEffect( () => {
		window.location.hash = activeTab;
	}, [ activeTab ] );

	// Listen for hash changes (back/forward).
	useEffect( () => {
		const handleHashChange = () => {
			const hash = window.location.hash.replace( '#', '' );
			if ( validTabNames.includes( hash ) ) {
				setActiveTab( hash );
			}
		};

		window.addEventListener( 'hashchange', handleHashChange );
		return () =>
			window.removeEventListener( 'hashchange', handleHashChange );
	}, [ validTabNames ] );

	return (
		<div className="vip-workflows-ideation-dashboard">
			<Tabs.Root
				className="vip-workflows-tabs"
				value={ activeTab }
				onValueChange={ setActiveTab }
			>
				<Tabs.List>
					{ tabs.map( ( tab ) => (
						<Tabs.Tab key={ tab.name } value={ tab.name }>
							{ tab.title }
						</Tabs.Tab>
					) ) }
				</Tabs.List>
				{ tabs.map( ( tab ) => (
					<Tabs.Panel key={ tab.name } value={ tab.name }>
						{ tab.name === 'my-work' && <MyWorkPage /> }
						{ tab.name === 'my-ideation' && <MyIdeationPage /> }
						{ tab.name === 'my-queue' && <MyQueuePage /> }
					</Tabs.Panel>
				) ) }
			</Tabs.Root>
		</div>
	);
}
