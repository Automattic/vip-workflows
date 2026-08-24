/**
 * Error Boundary Component
 *
 * Catches React errors and displays a fallback UI.
 *
 * @package
 */

import { Component } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';

import AdminPage from './AdminPage';

/**
 * Error boundary component.
 */
export default class ErrorBoundary extends Component {
	constructor( props ) {
		super( props );
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError( error ) {
		return { hasError: true, error };
	}

	componentDidCatch( error, errorInfo ) {
		// eslint-disable-next-line no-console
		console.error( 'Error caught by boundary:', error, errorInfo );
	}

	render() {
		if ( this.state.hasError ) {
			return (
				<AdminPage
					title={ __( 'Something went wrong', 'vip-workflow' ) }
					subtitle={ __(
						'An error occurred while rendering this page.',
						'vip-workflow'
					) }
					constrained
				>
					<Button
						variant="primary"
						onClick={ () => window.location.reload() }
					>
						{ __( 'Reload page', 'vip-workflow' ) }
					</Button>
				</AdminPage>
			);
		}

		return this.props.children;
	}
}
