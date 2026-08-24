/**
 * Unit tests for the Run Now control on the Jobs cards.
 *
 * Running a job is the reason the screen exists, so Run Now has to be a plain
 * button on every card — reachable at a glance, not parked behind a hover or a
 * disclosure. It was not always so. Under the built-in DataViews grid layout
 * every action, `isPrimary` included, was routed into a "…" menu that stays
 * `opacity: 0` until the card is hovered, so the control was smuggled onto the
 * card as a *field* instead; and a field only reaches the card if its id is
 * named in `view.fields`, which is how Run Now came to render nowhere at all for
 * weeks.
 *
 * The screen composes its own card now, so neither trap is still there to fall
 * into: no hidden menu, and no field list to fall off. What these pin is the
 * behaviour that had to survive that move — a visible, per-job Run Now that
 * posts to the run endpoint, and a Settings button only where there is something
 * to configure.
 *
 * These drive the real DataViews rather than a stand-in, because everything
 * around the cards — the search box, the Source filter, pagination — is
 * DataViews' own, and a stub would have to reimplement it (and could reimplement
 * it wrongly). `@wordpress/dataviews/wp` — the entry point the component
 * imports, which expects the `wp.*` globals of a WordPress page — ships as
 * untransformed ESM that Jest cannot parse, so the package's CommonJS build
 * stands in for it. Same source, same code, bundled for a module loader instead
 * of for `wp_enqueue_script`.
 *
 * @package
 */

import {
	render,
	screen,
	waitFor,
	within,
	fireEvent,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );

jest.mock( '@wordpress/dataviews/wp', () => require( '@wordpress/dataviews' ) );

// eslint-disable-next-line import/first
import { JobsTab } from '../../src/admin/components/JobsTab';

const JOBS = [
	{
		id: 'vip_workflow_notifications',
		name: 'Notification Digest',
		description: 'Sends queued editorial notifications.',
		interval_text: 'Every hour',
		has_settings: false,
	},
	{
		id: 'airtable_daily_stats',
		name: 'Airtable Daily Stats',
		description: 'Pushes yesterday’s counts to Airtable.',
		interval_text: 'Daily',
		has_settings: true,
		settings: { table: 'Stats' },
	},
];

/**
 * Render the tab and wait for the fetched jobs to reach the cards.
 *
 * @return {Promise<void>} Resolves once the first card is on screen.
 */
async function renderJobsTab() {
	apiFetch.mockResolvedValue( { jobs: JOBS } );
	render( <JobsTab /> );
	await screen.findByText( JOBS[ 0 ].name );
}

/**
 * The card a given job was drawn as.
 *
 * Located by its block class: a card composed by the screen carries no ARIA
 * role of its own — `gridcell` belonged to the built-in grid and left with it —
 * so the class is the card's boundary, the same hook the e2e specs use.
 *
 * @param {Object} job One of JOBS.
 * @return {HTMLElement} The card element.
 */
function cardFor( job ) {
	return screen.getByText( job.name ).closest( '.vip-workflow-summary-card' );
}

describe( 'JobsTab Run Now', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'puts a visible Run Now button on every job card', async () => {
		await renderJobsTab();

		expect(
			document.querySelectorAll( '.vip-workflow-summary-card' )
		).toHaveLength( JOBS.length );

		// Per card, not merely somewhere on the page: one shared button would
		// have nothing to say about which job it runs.
		JOBS.forEach( ( job ) => {
			const runNow = within( cardFor( job ) ).getByRole( 'button', {
				name: 'Run now',
			} );
			expect( runNow ).toBeVisible();
			// And it carries the card's weight: running the job is what an
			// author opens this screen to do, so the button is the primary.
			expect( runNow ).toHaveClass( 'is-primary' );
		} );
	} );

	it( 'leaves Run Now in the open, behind no menu and under no label row', async () => {
		await renderJobsTab();

		// Both "Actions" queries are scoped to the card track rather than the
		// document: the menu and the label row they rule out were drawn inside
		// a card, so that is where a regression would put them, and an exact
		// text match over the whole page would break the day any unrelated
		// chrome elsewhere on the screen happens to say "Actions".
		const grid = within(
			document.querySelector( '.vip-workflow-card-grid' )
		);

		// The "…" toggle the built-in grid drew — accessible name "Actions",
		// `opacity: 0` until hover — is the surface Run Now must never be
		// inside. Composing the card removes it outright.
		expect( grid.queryByRole( 'button', { name: 'Actions' } ) ).toBeNull();

		// The field that used to carry Run Now was labelled "Actions", and the
		// grid printed that label as a visible row beside the control. There is
		// no label row to fill now; nothing should reintroduce one.
		expect( grid.queryByText( 'Actions' ) ).toBeNull();

		// Nothing collapsible between the button and the card, either: an
		// `aria-expanded` ancestor would mean the button is inside something a
		// reader has to open first.
		screen
			.getAllByRole( 'button', { name: 'Run now' } )
			.forEach( ( button ) => {
				expect( button.closest( '[aria-expanded]' ) ).toBeNull();
			} );
	} );

	it( 'posts to the run endpoint for the job whose button was pressed', async () => {
		await renderJobsTab();

		fireEvent.click(
			within( cardFor( JOBS[ 1 ] ) ).getByRole( 'button', {
				name: 'Run now',
			} )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: `/vip-workflow/v1/jobs/${ JOBS[ 1 ].id }/run`,
				method: 'POST',
			} )
		);
	} );

	it( 'offers Settings only for a job that has any, and opens its dialog', async () => {
		await renderJobsTab();

		// `has_settings: false` — the eligibility the DataViews action used to
		// declare, now the condition on the second button.
		expect(
			within( cardFor( JOBS[ 0 ] ) ).queryByRole( 'button', {
				name: 'Settings',
			} )
		).toBeNull();

		fireEvent.click(
			within( cardFor( JOBS[ 1 ] ) ).getByRole( 'button', {
				name: 'Settings',
			} )
		);

		// Titled with the job, as DataViews' `modalHeader` used to title it.
		const dialog = await screen.findByRole( 'dialog', {
			name: JOBS[ 1 ].name,
		} );
		expect(
			within( dialog ).getByRole( 'button', { name: 'Save' } )
		).toBeVisible();
	} );

	// The cards are a hand-composed grid, so the structure a reader navigates by
	// is ours to declare — the built-in layout used to announce itself. Without
	// this the panel is an undifferentiated run of buttons to a screen reader.
	it( 'announces the cards as a list, one item per job', async () => {
		await renderJobsTab();

		const list = screen.getByRole( 'list' );
		const items = within( list ).getAllByRole( 'listitem' );

		expect( items ).toHaveLength( JOBS.length );
		items.forEach( ( item ) => {
			expect(
				item.querySelector( '.vip-workflow-summary-card' )
			).not.toBeNull();
		} );
	} );

	// Free composition renders no chrome it is not asked for, so the view
	// options — and with them the only way to reorder the list or change its
	// page size — vanish silently if nobody names the control.
	it( 'keeps the view options, and offers sorting only by name', async () => {
		await renderJobsTab();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'View options' } )
		);

		const sort = await screen.findByRole( 'combobox', { name: 'Sort by' } );
		expect(
			within( sort )
				.getAllByRole( 'option' )
				.map( ( o ) => o.textContent )
		).toEqual( [ 'Job' ] );

		// Nothing on a card is a hideable column, so the section that would
		// offer to hide one does not render at all.
		expect( screen.queryByText( 'Properties' ) ).toBeNull();
	} );
} );
