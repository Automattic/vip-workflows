/**
 * Which transition button shows busy while a transition runs.
 *
 * The panel held one boolean for the whole sidebar, so clicking any transition
 * put every button into the busy state at once. A writer could not tell which
 * action was actually running, and a mis-click looked identical to the intended
 * click.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

/*
 * `@wordpress/core-data` pulls @wordpress/sync, which needs TextEncoder that
 * jsdom does not provide. The panel only uses it to name the store it
 * invalidates the post entity on, so the store name is all this needs.
 */
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );

/*
 * `@wordpress/editor` pulls @wordpress/blocks, whose ESM-only dependencies Jest
 * cannot parse. The panel only needs the store's name plus a few post-state
 * selectors, so a named test store stands in for all of it.
 */
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );

/*
 * `@wordpress/notices` pulls an ESM-only `uuid` build Jest cannot parse, and
 * `@wordpress/a11y` builds a live region against the real document. The rail
 * only dispatches notices and announces moves, so stubs stand in for both.
 */
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';

register(
	createReduxStore( 'core', {
		reducer: ( state = {} ) => state,
		selectors: { getEntityRecord: () => null },
		actions: { invalidateResolution: () => ( { type: 'NOOP' } ) },
	} )
);

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			getEditedPostAttribute: () => 'draft',
			getCurrentPostAttribute: () => 'draft',
			isEditedPostDirty: () => false,
		},
		actions: { savePost: () => ( { type: 'NOOP' } ) },
	} )
);

/*
 * The real editor store, seeded per test: the panel reads its workflow state
 * from it rather than holding a copy, so a stand-in would test the stand-in.
 */
// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';

const STATUS_RESPONSE = {
	has_workflow: true,
	sequence: { id: 1, name: 'Busy State Flow' },
	current: {
		key: 'draft',
		label: 'Draft',
		color: '#666',
		is_terminal: false,
	},
	transitions: [
		{
			to: 'fact_check',
			label: 'Send to Fact Check',
			status_info: { key: 'fact_check', label: 'Fact Check' },
		},
		{
			to: 'copy_desk',
			label: 'Send to Copy Desk',
			status_info: { key: 'copy_desk', label: 'Copy Desk' },
		},
		{
			to: 'review',
			label: 'Skip to Review',
			status_info: { key: 'review', label: 'Review' },
		},
	],
	can_remove: false,
};

/**
 * The <button> element carrying a given label.
 *
 * @param {string} label Button text.
 * @return {HTMLElement} The button.
 */
function button( label ) {
	return screen.getByRole( 'button', { name: label } );
}

describe( 'WorkflowPanel transition busy state', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore();
	} );

	/**
	 * Render the panel with a transition request that stays in flight, so the
	 * mid-transition render can be inspected.
	 *
	 * @return {Promise<Function>} Resolver that completes the pending request.
	 */
	async function renderWithPendingTransition() {
		let release;
		const pending = new Promise( ( resolve ) => {
			release = resolve;
		} );

		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === STATUS_PATH && method !== 'POST' ) {
				return Promise.resolve( STATUS_RESPONSE );
			}
			if ( path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			// The transition POST — left unresolved on purpose.
			if ( 'POST' === method ) {
				return pending;
			}
			return Promise.resolve( {} );
		} );

		render( <WorkflowPanel /> );

		await waitFor( () =>
			expect( button( 'Send to Fact Check' ) ).toBeInTheDocument()
		);

		return release;
	}

	it( 'shows busy only on the transition that was clicked', async () => {
		await renderWithPendingTransition();

		await act( async () => {
			button( 'Send to Fact Check' ).click();
		} );

		expect( button( 'Send to Fact Check' ) ).toHaveClass( 'is-busy' );
		expect( button( 'Send to Copy Desk' ) ).not.toHaveClass( 'is-busy' );
		expect( button( 'Skip to Review' ) ).not.toHaveClass( 'is-busy' );
	} );

	it( 'disables the other transitions while one is running', async () => {
		await renderWithPendingTransition();

		await act( async () => {
			button( 'Send to Fact Check' ).click();
		} );

		// Disabled, so a second transition cannot be started mid-flight — but
		// without the spinner that would claim they are each running.
		// `aria-disabled` rather than the `disabled` attribute: the rail keeps
		// its buttons in the tab order (accessibleWhenDisabled), so a
		// keyboard user never loses the column mid-flight.
		expect( button( 'Send to Copy Desk' ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( button( 'Skip to Review' ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'leaves every transition idle before anything is clicked', async () => {
		await renderWithPendingTransition();

		expect( button( 'Send to Fact Check' ) ).not.toHaveClass( 'is-busy' );
		expect( button( 'Send to Copy Desk' ) ).not.toHaveClass( 'is-busy' );
		expect( button( 'Skip to Review' ) ).not.toBeDisabled();
	} );
} );
