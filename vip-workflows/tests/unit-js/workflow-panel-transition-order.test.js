/**
 * The order and treatment of transition buttons in the editor sidebar.
 *
 * Order is the stored `transitions` array, rendered straight through. The panel
 * once sorted it, lifting transitions that declared `kind: 'bypass'` into a
 * group of their own below the rest; that parameter is gone, so authored order
 * is the whole rule. It is also the only ranking the sequence carries, and the
 * stage inspector is where an author sets it — a sort here would silently
 * override the one control whose effect they can see.
 *
 * Treatment is the transition rail's rule (docs/specs/shipped/transition-rail.md):
 * with two or more ways out, every transition is the same ordinary secondary
 * button — no primary for a terminal edge. Nothing in the sequence declares a
 * preferred exit among several, so promoting one is an assertion the data
 * doesn't support.
 *
 * @package
 */

import { render, screen, waitFor } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-panel-transition-busy.test.js for why these are stubbed: ESM-only
// deps the panel names but does not otherwise exercise.
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
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

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice: () => ( { type: 'NOOP' } ),
		},
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

/**
 * One transition as the REST route delivers it.
 *
 * @param {string}  to     Destination stage key.
 * @param {string}  label  Button label.
 * @param {boolean} isTerm Whether the destination is terminal.
 * @return {Object} A transition.
 */
function transition( to, label, isTerm = false ) {
	return {
		to,
		label,
		status_info: { key: to, label, is_terminal: isTerm },
	};
}

/**
 * Render the panel with a given transition list.
 *
 * @param {Array} transitions Transitions in stored array order.
 */
async function renderWith( transitions ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( {
				has_workflow: true,
				sequence: { id: 35, name: 'AI Copy Desk' },
				current: {
					key: 'draft',
					label: 'Draft',
					color: '#666',
					is_terminal: false,
				},
				transitions,
				can_remove: false,
			} );
		}
		if ( path.startsWith( '/vip-workflows/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: transitions[ 0 ].label } )
		).toBeInTheDocument()
	);
}

/**
 * Transition button labels in rendered order.
 *
 * @return {string[]} Labels.
 */
function renderedOrder() {
	return Array.from(
		document.querySelectorAll( '.vip-workflows-rail__transition' )
	).map( ( el ) => el.textContent.trim() );
}

describe( 'WorkflowPanel transition order', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		seedEditorStore();
	} );

	// ── Authored order ───────────────────────────────────────────────

	/**
	 * The rule the whole file exists for. The panel renders the stored array
	 * as-is; a sort here would override the stage inspector's drag, and the
	 * cause would be invisible from the editor.
	 */
	it( 'renders transitions in the order the payload delivers them', async () => {
		await renderWith( [
			transition( 'review', 'Send to Review' ),
			transition( 'fact_check', 'Send to Fact Check' ),
			transition( 'copy_desk', 'Send to AI Copy Desk' ),
		] );

		expect( renderedOrder() ).toEqual( [
			'Send to Review',
			'Send to Fact Check',
			'Send to AI Copy Desk',
		] );
	} );

	/**
	 * Sequence 35's actual shape, and the case the retired `kind` parameter
	 * moved: a shortcut past the checks, authored third. It stays third — where
	 * its author put it.
	 */
	it( 'leaves a shortcut where its author placed it, among the steps it skips', async () => {
		await renderWith( [
			transition( 'fact_check', 'Send to Fact Check' ),
			transition( 'copy_desk', 'Send to AI Copy Desk' ),
			transition( 'review', 'Skip checks, send to Review' ),
			transition( 'smart_linking', 'Send to Smart Linking' ),
		] );

		expect( renderedOrder() ).toEqual( [
			'Send to Fact Check',
			'Send to AI Copy Desk',
			'Skip checks, send to Review',
			'Send to Smart Linking',
		] );
	} );

	/**
	 * `kind` was dropped from the transition payload. A cached or older
	 * response may still carry it; it must not resurrect the grouping, or an
	 * author's order would change under a stale cache.
	 */
	it( 'ignores a leftover kind field on a stale payload', async () => {
		await renderWith( [
			{
				...transition( 'fact_check', 'Send to Fact Check' ),
				kind: 'normal',
			},
			{
				...transition( 'review', 'Skip checks, send to Review' ),
				kind: 'bypass',
			},
			{
				...transition( 'copy_desk', 'Send to AI Copy Desk' ),
				kind: 'normal',
			},
		] );

		expect( renderedOrder() ).toEqual( [
			'Send to Fact Check',
			'Skip checks, send to Review',
			'Send to AI Copy Desk',
		] );
	} );

	// ── Treatment ────────────────────────────────────────────────────

	/**
	 * What is *available* carries no ranking once there is more than one way
	 * out, so every transition wears the same chrome.
	 */
	it( 'gives every transition the same treatment when several are offered', async () => {
		await renderWith( [
			transition( 'fact_check', 'Send to Fact Check' ),
			transition( 'review', 'Skip checks, send to Review' ),
		] );

		const shortcut = screen.getByRole( 'button', {
			name: 'Skip checks, send to Review',
		} );
		const ordinary = screen.getByRole( 'button', {
			name: 'Send to Fact Check',
		} );

		expect( shortcut.className ).toBe( ordinary.className );
		expect( shortcut ).toHaveClass( 'is-secondary' );
	} );

	/**
	 * The old panel promoted a terminal transition to primary. The rail does
	 * not: ending the post is a fact about the destination, not a
	 * recommendation, and nothing in the sequence ranks the exits.
	 */
	it( 'renders a terminal transition as an ordinary secondary button', async () => {
		await renderWith( [
			transition( 'fact_check', 'Send to Fact Check' ),
			transition( 'published', 'Skip checks and publish', true ),
		] );

		const button = screen.getByRole( 'button', {
			name: 'Skip checks and publish',
		} );

		expect( button ).toHaveClass( 'is-secondary' );
		expect( button ).not.toHaveClass( 'is-primary' );
		expect( button ).not.toHaveClass( 'is-tertiary' );
	} );

	// ── Locked transitions ───────────────────────────────────────────

	/**
	 * A locked transition keeps its place and its reason. `aria-disabled`
	 * rather than `disabled`, so the button stays in the tab order beside the
	 * helper text explaining why — and the reason renders as visible text, not
	 * a tooltip.
	 */
	it( 'renders a locked transition aria-disabled with its reason visible', async () => {
		await renderWith( [
			transition( 'fact_check', 'Send to Fact Check' ),
			{
				...transition( 'review', 'Skip checks, send to Review' ),
				_locked: true,
				_locked_reason: 'Only the assignee may do this.',
			},
		] );

		expect(
			screen.getByRole( 'button', {
				name: 'Skip checks, send to Review',
			} )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Only the assignee may do this.' )
		).toBeVisible();
	} );
} );
