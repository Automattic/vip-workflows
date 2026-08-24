/**
 * Application Shell Component
 *
 * Page dispatcher for the VIP Workflow admin screens. Each screen is a real
 * wp-admin page (registered server-side); this component reads the `?page=`
 * query parameter and mounts the matching screen into the standard wp-admin
 * canvas. Navigation between screens is handled by the native wp-admin menu;
 * hash routes (`#view?params`) drive sub-views within a single screen.
 *
 * @package
 */

import {
	useState,
	useEffect,
	useRef,
	useCallback,
	lazy,
	Suspense,
} from '@wordpress/element';
import { SnackbarList, Spinner } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import { __ } from '@wordpress/i18n';

import ErrorBoundary from './ErrorBoundary';
import AdminPage from './AdminPage';

const Sequences = lazy( () => import( '../pages/Sequences' ) );
const AuditLog = lazy( () => import( '../pages/AuditLog' ) );
const MyDashboard = lazy( () => import( '../pages/MyDashboard' ) );
const Kanban = lazy( () => import( '../pages/Kanban' ) );
const Calendar = lazy( () => import( '../pages/Calendar' ) );
const Ideation = lazy( () => import( '../pages/Ideation' ) );
const Settings = lazy( () => import( '../pages/Settings' ) );
const Notifications = lazy( () => import( '../pages/Notifications' ) );
const Agents = lazy( () => import( '../pages/Agents' ) );
const Tools = lazy( () => import( '../pages/Tools' ) );
const Jobs = lazy( () => import( '../pages/Jobs' ) );

/**
 * Parse hash URL for sub-routing within a page.
 *
 * @return {Object} Route info with view and params.
 */
const parseRoute = () => {
	const hash = window.location.hash.slice( 1 ); // Remove #
	const [ view, params ] = hash.split( '?' );

	const parsedParams = {};
	if ( params ) {
		params.split( '&' ).forEach( ( param ) => {
			const [ key, value ] = param.split( '=' );
			parsedParams[ key ] = decodeURIComponent( value );
		} );
	}

	return {
		view: view || 'list',
		params: parsedParams,
	};
};

/**
 * Main application shell.
 *
 * @return {JSX.Element} AppShell component.
 */
export default function AppShell() {
	const [ transitionState, setTransitionState ] = useState( 'idle' );
	const [ displayedRoute, setDisplayedRoute ] = useState( parseRoute() );
	const transitionTimeoutRef = useRef( null );

	// Handle route transitions with animation.
	const transitionToRoute = useCallback( ( newRoute ) => {
		if ( transitionTimeoutRef.current ) {
			clearTimeout( transitionTimeoutRef.current );
		}

		setTransitionState( 'entering' );
		setDisplayedRoute( newRoute );

		transitionTimeoutRef.current = setTimeout( () => {
			setTransitionState( 'idle' );
		}, 150 );
	}, [] );

	// Handle hash changes for sub-routing.
	useEffect( () => {
		const handleHashChange = () => {
			const newRoute = parseRoute();
			transitionToRoute( newRoute );
		};

		window.addEventListener( 'hashchange', handleHashChange );
		return () => {
			window.removeEventListener( 'hashchange', handleHashChange );
			if ( transitionTimeoutRef.current ) {
				clearTimeout( transitionTimeoutRef.current );
			}
		};
	}, [ transitionToRoute ] );

	/**
	 * Navigate to a hash route (for sub-views within a page).
	 *
	 * @param {string} view   View name.
	 * @param {Object} params Route params.
	 */
	const navigate = ( view, params = {} ) => {
		const paramString = Object.keys( params )
			.map(
				( key ) => `${ key }=${ encodeURIComponent( params[ key ] ) }`
			)
			.join( '&' );

		const hash = paramString ? `#${ view }?${ paramString }` : `#${ view }`;
		window.location.hash = hash;
	};

	// Determine current page from URL.
	const urlParams = new URLSearchParams( window.location.search );
	const page = urlParams.get( 'page' );

	/**
	 * Render the appropriate view based on current page.
	 */
	const renderContent = () => {
		// Sequences page (handles its own hash sub-routing internally)
		if ( page === 'vip-workflow-sequences' ) {
			return <Sequences />;
		}

		// Audit Log page
		if ( page === 'vip-workflow-audit-log' ) {
			return <AuditLog />;
		}

		// My Dashboard page (also the landing page at the bare `vip-workflow` slug)
		if ( page === 'vip-workflow-my-dashboard' || page === 'vip-workflow' ) {
			return <MyDashboard />;
		}

		// Kanban board page
		if ( page === 'vip-workflow-kanban' ) {
			return <Kanban />;
		}

		// Calendar page
		if ( page === 'vip-workflow-calendar' ) {
			return <Calendar />;
		}

		// Ideation page (only routed while the Ideation feature is enabled).
		// Ideation still drives sub-views through the shell's hash router.
		if (
			page === 'vip-workflow-ideation' &&
			window.vipWorkflowAdmin?.experiments?.ideation
		) {
			return (
				<Ideation route={ displayedRoute } onNavigate={ navigate } />
			);
		}

		// Settings page
		if ( page === 'vip-workflow-settings' ) {
			return <Settings />;
		}

		// Notifications page (Channels + Routing & Debug tabs)
		if ( page === 'vip-workflow-notifications' ) {
			return <Notifications />;
		}

		// Agents page
		if ( page === 'vip-workflow-agents' ) {
			return <Agents />;
		}

		// Tools page
		if ( page === 'vip-workflow-tools' ) {
			return <Tools />;
		}

		// Jobs page
		if ( page === 'vip-workflow-jobs' ) {
			return <Jobs />;
		}

		// Default fallback
		return (
			<AdminPage
				title={ __( 'Coming Soon', 'vip-workflow' ) }
				subtitle={ __(
					'This page is being migrated to the new design.',
					'vip-workflow'
				) }
				constrained
			/>
		);
	};

	// Get notices for Snackbar display.
	const notices = useSelect(
		( select ) =>
			select( noticesStore )
				.getNotices()
				.filter( ( notice ) => notice.type === 'snackbar' ),
		[]
	);
	const { removeNotice } = useDispatch( noticesStore );

	// Get transition class.
	const getTransitionClass = () => {
		if ( transitionState === 'entering' ) {
			return 'vip-workflow-view vip-workflow-view-entering';
		}
		return 'vip-workflow-view';
	};

	// Render the active screen into the standard wp-admin canvas.
	return (
		<>
			<div className="vip-workflow-view-container">
				<div className={ getTransitionClass() }>
					<ErrorBoundary>
						<Suspense
							fallback={
								<div>
									<Spinner />
								</div>
							}
						>
							{ renderContent() }
						</Suspense>
					</ErrorBoundary>
				</div>
			</div>
			<SnackbarList notices={ notices } onRemove={ removeNotice } />
		</>
	);
}
