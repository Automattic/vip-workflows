/**
 * Unit tests for the Experiments panel's first paint.
 *
 * Saving an experiment reloads the page — enabling or disabling one registers
 * or removes server-side menus and REST routes, so the screen cannot show the
 * result without one (docs/guides/settings-standard.md). The panel then
 * remounted with `loading` true and fetched the registry over REST, so every
 * save flashed "Loading experiments…" in place of the toggles before they came
 * back. The reload is wanted; the flash is not.
 *
 * The registry is already rendered server-side for the request that serves the
 * page, so the panel has no reason to ask for it again. These tests pin the
 * seeded path rendering on first paint, and the unseeded path still fetching.
 *
 * @package
 */

import { render, waitFor } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

import { ExperimentsSettings } from '../../src/admin/components/ExperimentsSettings';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

const REGISTRY = [
	{
		id: 'ideation',
		name: 'Ideation',
		description: 'Research, discovery, and source management.',
		icon: 'lightbulb',
		enabled: false,
		available: true,
	},
];

const noop = () => {};

describe( 'ExperimentsSettings first paint', () => {
	afterEach( () => {
		delete window.vipWorkflowAdmin;
		jest.clearAllMocks();
	} );

	it( 'renders the toggles immediately when the server seeded the registry', () => {
		window.vipWorkflowAdmin = { experimentsRegistry: REGISTRY };
		// A request that never settles: anything the panel paints here is what
		// it paints on the first frame after the save-triggered reload.
		apiFetch.mockReturnValue( new Promise( () => {} ) );

		const { queryByText, getByLabelText } = render(
			<ExperimentsSettings onDirtyChange={ noop } registerSave={ noop } />
		);

		expect( queryByText( 'Loading experiments…' ) ).toBeNull();
		expect( getByLabelText( 'Ideation' ) ).toBeInTheDocument();
	} );

	it( 'does not re-request a registry the server already sent', () => {
		window.vipWorkflowAdmin = { experimentsRegistry: REGISTRY };
		apiFetch.mockReturnValue( new Promise( () => {} ) );

		render(
			<ExperimentsSettings onDirtyChange={ noop } registerSave={ noop } />
		);

		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'still fetches, and still shows the loading state, when unseeded', async () => {
		apiFetch.mockResolvedValue( REGISTRY );

		const { queryByText, findByLabelText } = render(
			<ExperimentsSettings onDirtyChange={ noop } registerSave={ noop } />
		);

		expect( queryByText( 'Loading experiments…' ) ).not.toBeNull();
		expect( await findByLabelText( 'Ideation' ) ).toBeInTheDocument();
		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/vip-workflow/v1/settings/experiments',
			} )
		);
	} );
} );
