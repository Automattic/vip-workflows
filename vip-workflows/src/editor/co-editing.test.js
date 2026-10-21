/**
 * External dependencies
 */
import { renderHook } from '@testing-library/react';

/**
 * Internal dependencies
 */
import { includesOtherEditors, useHasOtherEditorsOpen } from './co-editing';

const mockUseActiveCollaborators = jest.fn();

jest.mock( '@wordpress/core-data', () => ( {
	privateApis: {
		useActiveCollaborators: ( ...args ) =>
			mockUseActiveCollaborators( ...args ),
	},
} ) );

jest.mock( '@wordpress/private-apis', () => ( {
	__dangerousOptInToUnstableAPIsOnlyForCoreModules: () => ( {
		unlock: ( object ) => object,
	} ),
} ) );

describe( 'includesOtherEditors', () => {
	it( 'is false when only this editor is present', () => {
		expect( includesOtherEditors( [] ) ).toBe( false );
		expect( includesOtherEditors( [ { isMe: true } ] ) ).toBe( false );
	} );

	it( 'is true when anyone else is present', () => {
		expect(
			includesOtherEditors( [ { isMe: true }, { isMe: false } ] )
		).toBe( true );
	} );
} );

describe( 'useHasOtherEditorsOpen', () => {
	it( 'asks Gutenberg about this post', () => {
		mockUseActiveCollaborators.mockReturnValue( [
			{ isMe: true },
			{ isMe: false },
		] );

		const { result } = renderHook( () =>
			useHasOtherEditorsOpen( 46, 'post' )
		);

		expect( result.current ).toBe( true );
		expect( mockUseActiveCollaborators ).toHaveBeenCalledWith( 46, 'post' );
	} );
} );
