/**
 * Ideation Page Component.
 *
 * Entry point for story ideation. Shows seed input on landing,
 * routes to the workspace when a project is active.
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Spinner, Notice } from '@wordpress/components';
import { Stack } from '@wordpress/ui';

import SeedInput from '../components/ideation/SeedInput';
import IdeationWorkspace from '../components/ideation/IdeationWorkspace';
import StoryDiscovery from '../components/ideation/StoryDiscovery';
import RecentProjects from '../components/ideation/RecentProjects';

import './Ideation.css';

/**
 * Ideation page with seed input landing and workspace view.
 *
 * @param {Object}   props            Component props.
 * @param {Object}   props.route      Current route info.
 * @param {Function} props.onNavigate Navigation callback.
 * @return {JSX.Element} Ideation page component.
 */
export default function Ideation( { route, onNavigate } ) {
	const [ projectId, setProjectId ] = useState( null );
	const [ projectState, setProjectState ] = useState( null );
	const [ loading, setLoading ] = useState( false );
	const [ submitting, setSubmitting ] = useState( false );
	const [ error, setError ] = useState( null );

	// Check if route has a project ID.
	useEffect( () => {
		const id = route?.params?.project;
		if ( id ) {
			setProjectId( parseInt( id, 10 ) );
		}
	}, [ route ] );

	// Fetch project state when projectId is set.
	useEffect( () => {
		if ( ! projectId ) {
			return;
		}

		const fetchState = async () => {
			setLoading( true );
			try {
				const state = await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ projectId }`,
				} );
				setProjectState( state );
			} catch ( err ) {
				setError(
					err.message ||
						__( 'Failed to load project.', 'vip-workflows' )
				);
			} finally {
				setLoading( false );
			}
		};

		fetchState();
	}, [ projectId ] );

	/**
	 * Submit a new seed and create an ideation project.
	 *
	 * @param {string} seed The seed text.
	 */
	const handleSeedSubmit = useCallback(
		async ( seed ) => {
			setSubmitting( true );
			setError( null );

			try {
				const state = await apiFetch( {
					path: '/vip-workflows/v1/ideation/seed',
					method: 'POST',
					data: { seed },
				} );

				setProjectId( state.project_id );
				setProjectState( state );
				onNavigate( 'workspace', { project: state.project_id } );
			} catch ( err ) {
				setError(
					err.message ||
						__(
							'Failed to create ideation project.',
							'vip-workflows'
						)
				);
			} finally {
				setSubmitting( false );
			}
		},
		[ onNavigate ]
	);

	const handleDiscoverySelect = useCallback( ( state ) => {
		setProjectId( state.project_id );
		setProjectState( state );
	}, [] );

	const handleProjectSelect = useCallback(
		( id ) => {
			setProjectId( id );
			onNavigate( 'workspace', { project: id } );
		},
		[ onNavigate ]
	);

	const handleBackToLanding = useCallback( () => {
		setProjectId( null );
		setProjectState( null );
		onNavigate( 'list' );
	}, [ onNavigate ] );

	if ( loading ) {
		return (
			<Stack
				align="center"
				justify="center"
				gap="md"
				className="vip-workflows-ideation-loading"
			>
				<Spinner />
			</Stack>
		);
	}

	if ( projectId && projectState ) {
		return (
			<IdeationWorkspace
				state={ projectState }
				onStateChange={ setProjectState }
				onBack={ handleBackToLanding }
			/>
		);
	}

	return (
		// wpds-allow R7 -- block-flow page column; the sections below carry their own margin-top, which a flex Stack would stop collapsing (see Ideation.css)
		<div className="vip-workflows-ideation-landing">
			{ error && (
				<Notice
					status="error"
					isDismissible
					onDismiss={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }

			<SeedInput
				onSubmit={ handleSeedSubmit }
				isSubmitting={ submitting }
			/>
			<StoryDiscovery
				onSelect={ handleDiscoverySelect }
				onNavigate={ onNavigate }
			/>
			<RecentProjects onSelect={ handleProjectSelect } />
		</div>
	);
}
