/**
 * Unit tests for reading a channel group's destination list.
 *
 * Add and remove both read the whole list, change one entry, and POST the result
 * back as the new authoritative list. That makes the read a write in disguise: a
 * response without a `destinations` array means "the current list is unknown",
 * and if that is quietly read as "the list is empty", the very next POST replaces
 * every configured destination with one entry — or, on the remove path, with
 * none at all. So it has to fail loudly instead.
 *
 * @package
 */

import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );
// The package's untranspiled ESM cannot be required here, and the module under
// test only needs the store's key to dispatch its success snackbars.
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

// eslint-disable-next-line import/first
import { fetchChannelDestinations } from '../../src/admin/components/NotificationChannelsTab';

const group = {
	prefix: 'slack-',
	label: 'Slack',
	addEndpoint: '/vip-workflow/v1/slack-destinations',
};

describe( 'fetchChannelDestinations', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'returns the list the endpoint reports', async () => {
		const destinations = [ { id: 'a', name: 'Newsroom' } ];
		apiFetch.mockResolvedValue( { destinations } );

		await expect( fetchChannelDestinations( group ) ).resolves.toEqual(
			destinations
		);
	} );

	it( 'returns an empty list when the group genuinely has none', async () => {
		apiFetch.mockResolvedValue( { destinations: [] } );

		await expect( fetchChannelDestinations( group ) ).resolves.toEqual(
			[]
		);
	} );

	it( 'throws when the response carries no destinations at all', async () => {
		apiFetch.mockResolvedValue( { ok: true } );

		await expect( fetchChannelDestinations( group ) ).rejects.toThrow(
			'/vip-workflow/v1/slack-destinations'
		);
	} );

	it( 'throws when destinations is not an array', async () => {
		apiFetch.mockResolvedValue( { destinations: { 'slack-1': {} } } );

		await expect( fetchChannelDestinations( group ) ).rejects.toThrow(
			'Nothing was changed'
		);
	} );

	it( 'throws rather than treating a missing body as an empty list', async () => {
		apiFetch.mockResolvedValue( undefined );

		await expect( fetchChannelDestinations( group ) ).rejects.toThrow(
			'Nothing was changed'
		);
	} );

	it( 'never writes: the failure happens before any POST', async () => {
		apiFetch.mockResolvedValue( {} );

		await expect( fetchChannelDestinations( group ) ).rejects.toThrow();
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: group.addEndpoint,
		} );
	} );
} );
