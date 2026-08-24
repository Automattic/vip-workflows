/**
 * Unit tests for what the open Settings dialog on the Jobs tab is looking at.
 *
 * Saving a job's settings refreshes the whole list — `fetchJobs()` replaces the
 * `jobs` array wholesale — while the dialog that triggered the save is still
 * open. The screen therefore has to be careful about *what* it remembers while
 * a dialog is open. Holding the job object the card handed over reads fine and
 * is wrong: the object is a snapshot, the array under it is replaced, and from
 * the save onwards the dialog narrates a version of the job that no longer
 * exists — a stale title, and a stale descriptor passed on to anything that
 * registered a settings UI through `vipWorkflow.jobSettingsComponent`. Third
 * parties get the worst of it, because they render from a payload the screen
 * has already been told is out of date.
 *
 * The screen holds the job's *id* and re-finds it each render instead, so these
 * pin both halves of that: the dialog's own chrome tracks the refreshed job, and
 * so does the descriptor handed to the filter. The third test covers the case
 * the id lookup also has to answer for — a job that stops being registered while
 * its dialog is open has nothing left to show, so the dialog goes away.
 *
 * As in jobs-tab-run-now.test.js, these drive the real DataViews rather than a
 * stand-in; `@wordpress/dataviews/wp` ships as untransformed ESM that Jest
 * cannot parse, so the package's CommonJS build stands in for it.
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
import { addFilter, removeFilter } from '@wordpress/hooks';

jest.mock( '@wordpress/api-fetch' );

jest.mock( '@wordpress/dataviews/wp', () => require( '@wordpress/dataviews' ) );

// eslint-disable-next-line import/first
import { JobsTab } from '../../src/admin/components/JobsTab';

const CONFIGURABLE_JOB = {
	id: 'airtable_daily_stats',
	name: 'Airtable Daily Stats',
	description: 'Pushes yesterday’s counts to Airtable.',
	interval_text: 'Daily',
	has_settings: true,
	settings: { table: 'Stats' },
};

// The same job as the server reports it after a save. Renaming it is the
// cheapest way to make "which payload is on screen?" observable: nothing else
// about a job changes visibly on save, and a test that cannot tell the two
// payloads apart cannot fail when the stale one is used.
const SAVED_JOB = {
	...CONFIGURABLE_JOB,
	name: 'Airtable Daily Stats (renamed)',
	settings: { table: 'Stats2026' },
};

const FILTER_NAMESPACE = 'vip-workflow-test/job-settings-freshness';

/**
 * The list payload the next GET of the jobs endpoint should return.
 *
 * Held in a mutable box so a test can change what the refresh finds *after*
 * render, which is the whole point: the dialog is already open by then.
 *
 * @type {Array}
 */
let jobsPayload;

/**
 * Route apiFetch by path: the list endpoint serves `jobsPayload`, and the
 * settings POST just succeeds.
 *
 * @return {void}
 */
function mockEndpoints() {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === '/vip-workflow/v1/jobs' ) {
			return Promise.resolve( { jobs: jobsPayload } );
		}
		if ( path.endsWith( '/settings' ) && method === 'POST' ) {
			return Promise.resolve( {} );
		}
		return Promise.reject(
			new Error( `Unexpected request: ${ method || 'GET' } ${ path }` )
		);
	} );
}

/**
 * Render the tab and open the configurable job's Settings dialog.
 *
 * @return {Promise<HTMLElement>} The open dialog.
 */
async function openSettingsDialog() {
	render( <JobsTab /> );
	await screen.findByText( CONFIGURABLE_JOB.name );

	fireEvent.click(
		screen
			.getByText( CONFIGURABLE_JOB.name )
			.closest( '.vip-workflow-summary-card' )
			.querySelector( 'button.is-tertiary' )
	);

	return screen.findByRole( 'dialog', { name: CONFIGURABLE_JOB.name } );
}

/**
 * Press Save in the open dialog.
 *
 * @param {HTMLElement} dialog The open dialog.
 * @return {void}
 */
function save( dialog ) {
	fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Save' } ) );
}

describe( 'JobsTab settings dialog freshness', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		jobsPayload = [ CONFIGURABLE_JOB ];
		mockEndpoints();
	} );

	afterEach( () => {
		removeFilter( 'vipWorkflow.jobSettingsComponent', FILTER_NAMESPACE );
	} );

	it( 'retitles the open dialog from the refreshed job after a save', async () => {
		const dialog = await openSettingsDialog();

		// The refresh that the save kicks off now finds a renamed job.
		jobsPayload = [ SAVED_JOB ];
		save( dialog );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: `/vip-workflow/v1/jobs/${ CONFIGURABLE_JOB.id }/settings`,
					method: 'POST',
				} )
			)
		);

		// Still open, and now describing the job as saved rather than as it was
		// when the card handed it over.
		expect(
			await screen.findByRole( 'dialog', { name: SAVED_JOB.name } )
		).toBeVisible();
		expect(
			screen.queryByRole( 'dialog', { name: CONFIGURABLE_JOB.name } )
		).toBeNull();
	} );

	it( 'hands the refreshed job to vipWorkflow.jobSettingsComponent', async () => {
		// A stand-in for a plugin's own settings UI. It renders straight from
		// the `job` it is given, so what it prints is exactly what the filter
		// was handed.
		addFilter(
			'vipWorkflow.jobSettingsComponent',
			FILTER_NAMESPACE,
			( component, jobId, { job } ) => (
				<div data-testid="plugin-settings-ui">{ job.name }</div>
			)
		);

		const dialog = await openSettingsDialog();
		expect( screen.getByTestId( 'plugin-settings-ui' ) ).toHaveTextContent(
			CONFIGURABLE_JOB.name
		);

		jobsPayload = [ SAVED_JOB ];
		save( dialog );

		await waitFor( () =>
			expect(
				screen.getByTestId( 'plugin-settings-ui' )
			).toHaveTextContent( SAVED_JOB.name )
		);
	} );

	it( 'closes the dialog if the job stops being registered while it is open', async () => {
		const dialog = await openSettingsDialog();

		// The plugin that registered the job was deactivated behind the reader's
		// back; the refresh comes back without it. There is nothing left to
		// configure, so the dialog cannot stay open over it.
		jobsPayload = [];
		save( dialog );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).toBeNull()
		);
	} );
} );
