/**
 * VIP Workflow Admin
 *
 * @package
 */

import { createRoot } from '@wordpress/element';
import AppShell from './components/AppShell';

// React Flow base styles for the sequence graph editor. Imported here (the
// non-lazy admin entry) rather than next to the canvas: the file is named
// `style.css`, which wp-scripts routes through a dedicated split-chunk
// cacheGroup that crashes when the owning chunk is an unnamed lazy one.
import '@xyflow/react/dist/style.css';
import './style.css';
import './layout.css';

// Initialize apps when DOM is ready.
document.addEventListener( 'DOMContentLoaded', () => {
	// Main workflow app with AppShell (all pages)
	const workflowRoot = document.getElementById( 'vip-workflow-root' );
	if ( workflowRoot ) {
		createRoot( workflowRoot ).render( <AppShell /> );
	}
} );
