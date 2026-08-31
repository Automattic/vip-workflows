/**
 * Unit tests for the stage-color derivation helpers.
 *
 * Guards that automatic stage colors stay visually distinct even for degenerate
 * base picks — grayscale, black, white, near-black, near-white — where rotating
 * hue alone (without normalizing saturation/lightness) would collapse every
 * stage to the same swatch.
 */

import {
	deriveStageColors,
	deriveStageColorAt,
} from '../../src/admin/utils/stage-colors';

const allDistinct = ( arr ) => new Set( arr ).size === arr.length;
const isHex = ( c ) => /^#[0-9a-f]{6}$/.test( c );

describe( 'deriveStageColors', () => {
	it.each( [
		[ 'grayscale', '#808080' ],
		[ 'black', '#000000' ],
		[ 'white', '#ffffff' ],
		[ 'near-black', '#111111' ],
		[ 'near-white', '#f7f7f7' ],
	] )( 'derives distinct, valid colors from a %s base', ( _label, base ) => {
		const colors = deriveStageColors( base, 5 );
		expect( colors ).toHaveLength( 5 );
		expect( allDistinct( colors ) ).toBe( true );
		expect( colors.every( isHex ) ).toBe( true );
	} );

	it( 'leaves a saturated, mid-lightness base untouched as the first swatch', () => {
		const colors = deriveStageColors( '#aa3377', 4 );
		expect( colors[ 0 ] ).toBe( '#aa3377' );
		expect( allDistinct( colors ) ).toBe( true );
	} );

	it( 'falls back to a usable palette for invalid input', () => {
		const colors = deriveStageColors( 'not-a-color', 3 );
		expect( colors ).toHaveLength( 3 );
		expect( allDistinct( colors ) ).toBe( true );
		expect( colors.every( isHex ) ).toBe( true );
	} );

	it( 'returns an empty array for a zero/negative count', () => {
		expect( deriveStageColors( '#aa3377', 0 ) ).toEqual( [] );
		expect( deriveStageColors( '#aa3377', -3 ) ).toEqual( [] );
	} );
} );

describe( 'deriveStageColorAt', () => {
	it( 'returns the palette entry at the requested index', () => {
		const palette = deriveStageColors( '#808080', 4 );
		expect( deriveStageColorAt( '#808080', 2, 4 ) ).toBe( palette[ 2 ] );
	} );

	it( 'clamps out-of-range indices to a valid color', () => {
		expect( isHex( deriveStageColorAt( '#808080', 99, 4 ) ) ).toBe( true );
	} );
} );
