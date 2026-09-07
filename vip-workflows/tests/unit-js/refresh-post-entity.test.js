/**
 * The post-entity refresh that follows a server-side workflow write.
 *
 * Two properties are pinned here because each has already been the bug:
 *
 * 1. The refresh must FORCE the refetch, not just invalidate — invalidation
 *    alone waits for something to re-select the record through the resolver.
 * 2. The args must reach the store exactly as given. The resolution cache is
 *    keyed by deep equality, so a string post id from a localized script
 *    missed the numeric key the editor resolved under and the invalidation
 *    silently did nothing — the top bar kept offering "Publish" on a post the
 *    workflow had already published.
 *
 * @package
 */

jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );

// eslint-disable-next-line import/first
import { refreshPostEntity } from '../../src/editor/refresh-post-entity';

/**
 * A registry double exposing the two seams the helper touches.
 *
 * @return {Object} Registry with spies at `spies`.
 */
function registryDouble() {
	const invalidateResolution = jest.fn();
	const getEntityRecord = jest.fn( () => Promise.resolve( null ) );

	return {
		dispatch: jest.fn( () => ( { invalidateResolution } ) ),
		resolveSelect: jest.fn( () => ( { getEntityRecord } ) ),
		spies: { invalidateResolution, getEntityRecord },
	};
}

describe( 'refreshPostEntity', () => {
	it( 'invalidates the cached resolution and forces the refetch', () => {
		const registry = registryDouble();

		refreshPostEntity( registry, 'post', 42 );

		expect( registry.dispatch ).toHaveBeenCalledWith( 'core' );
		expect( registry.spies.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'post', 42 ]
		);
		expect( registry.resolveSelect ).toHaveBeenCalledWith( 'core' );
		expect( registry.spies.getEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'post',
			42
		);
	} );

	it( 'passes the post id through untouched, so the caller owns its type', () => {
		const registry = registryDouble();

		refreshPostEntity( registry, 'page', 7 );

		expect( registry.spies.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'page', 7 ]
		);
	} );

	it( 'does nothing without a post type or id', () => {
		const registry = registryDouble();

		refreshPostEntity( registry, null, 42 );
		refreshPostEntity( registry, 'post', null );

		expect( registry.dispatch ).not.toHaveBeenCalled();
		expect( registry.resolveSelect ).not.toHaveBeenCalled();
	} );
} );
