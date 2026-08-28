/**
 * Stage color helpers.
 *
 * Derive a set of visually distinct stage colors from a single base color so a
 * workflow of any length gets harmonious, evenly-spread colors from one pick —
 * instead of choosing each stage's color from a fixed hex list. Stages keep the
 * base color's saturation/lightness; only the hue is rotated.
 */

const FALLBACK_BASE = '#3498db';

// Hue rotation only yields distinct colors when the base has some saturation and
// a mid-range lightness. Grayscale, near-black, and near-white bases would
// otherwise collapse every derived stage to the same swatch, so nudge only those
// degenerate inputs into a usable band. Saturated, mid-lightness picks (the
// common case) fall through unchanged.
const MIN_SATURATION = 0.35;
const MIN_LIGHTNESS = 0.25;
const MAX_LIGHTNESS = 0.75;

/**
 * Parse a hex color (#rgb or #rrggbb) to HSL.
 *
 * @param {string} hex Hex color string.
 * @return {{h:number,s:number,l:number}|null} HSL (h:0-360, s/l:0-1) or null.
 */
export function hexToHsl( hex ) {
	if ( typeof hex !== 'string' ) {
		return null;
	}
	let value = hex.trim().replace( /^#/, '' );
	if ( value.length === 3 ) {
		value = value
			.split( '' )
			.map( ( c ) => c + c )
			.join( '' );
	}
	if ( ! /^[0-9a-f]{6}$/i.test( value ) ) {
		return null;
	}

	const r = parseInt( value.slice( 0, 2 ), 16 ) / 255;
	const g = parseInt( value.slice( 2, 4 ), 16 ) / 255;
	const b = parseInt( value.slice( 4, 6 ), 16 ) / 255;

	const max = Math.max( r, g, b );
	const min = Math.min( r, g, b );
	const delta = max - min;
	const l = ( max + min ) / 2;

	let h = 0;
	let s = 0;
	if ( delta !== 0 ) {
		s = delta / ( 1 - Math.abs( 2 * l - 1 ) );
		if ( max === r ) {
			h = ( ( g - b ) / delta ) % 6;
		} else if ( max === g ) {
			h = ( b - r ) / delta + 2;
		} else {
			h = ( r - g ) / delta + 4;
		}
		h *= 60;
		if ( h < 0 ) {
			h += 360;
		}
	}

	return { h, s, l };
}

/**
 * Convert HSL to a #rrggbb hex string.
 *
 * @param {number} h Hue (degrees).
 * @param {number} s Saturation (0-1).
 * @param {number} l Lightness (0-1).
 * @return {string} Hex color.
 */
export function hslToHex( h, s, l ) {
	const c = ( 1 - Math.abs( 2 * l - 1 ) ) * s;
	const hp = ( ( ( h % 360 ) + 360 ) % 360 ) / 60;
	const x = c * ( 1 - Math.abs( ( hp % 2 ) - 1 ) );

	let r = 0;
	let g = 0;
	let b = 0;
	if ( hp < 1 ) {
		[ r, g, b ] = [ c, x, 0 ];
	} else if ( hp < 2 ) {
		[ r, g, b ] = [ x, c, 0 ];
	} else if ( hp < 3 ) {
		[ r, g, b ] = [ 0, c, x ];
	} else if ( hp < 4 ) {
		[ r, g, b ] = [ 0, x, c ];
	} else if ( hp < 5 ) {
		[ r, g, b ] = [ x, 0, c ];
	} else {
		[ r, g, b ] = [ c, 0, x ];
	}

	const m = l - c / 2;
	const toHex = ( v ) =>
		Math.min( 255, Math.max( 0, Math.round( ( v + m ) * 255 ) ) )
			.toString( 16 )
			.padStart( 2, '0' );

	return `#${ toHex( r ) }${ toHex( g ) }${ toHex( b ) }`;
}

/**
 * Derive `count` distinct stage colors from a base color by spreading hue evenly.
 *
 * @param {string} baseColor Base hex color.
 * @param {number} count     Number of colors to generate.
 * @return {string[]} Hex colors.
 */
export function deriveStageColors( baseColor, count ) {
	const n = Math.max( 0, Math.floor( count ) );
	const base = hexToHsl( baseColor ) || hexToHsl( FALLBACK_BASE );

	// Normalize only degenerate bases so hue rotation stays visible; leave a
	// saturated, mid-lightness pick exactly as chosen.
	const s = Math.max( base.s, MIN_SATURATION );
	const l = Math.min( MAX_LIGHTNESS, Math.max( MIN_LIGHTNESS, base.l ) );

	const colors = [];
	for ( let i = 0; i < n; i++ ) {
		const hue = base.h + ( i * 360 ) / Math.max( n, 1 );
		colors.push( hslToHex( hue, s, l ) );
	}
	return colors;
}

/**
 * Derive the color for a single stage at `index` within a workflow of `count`
 * stages. Used when appending a stage without recoloring the others.
 *
 * @param {string} baseColor Base hex color.
 * @param {number} index     Zero-based stage index.
 * @param {number} count     Total stage count.
 * @return {string} Hex color.
 */
export function deriveStageColorAt( baseColor, index, count ) {
	const palette = deriveStageColors( baseColor, count );
	return palette[ index ] || palette[ palette.length - 1 ] || FALLBACK_BASE;
}

/**
 * Build a readable tinted style for a status pill from its stage color: a light
 * background and a dark, same-hue text. Returns undefined for unset/invalid
 * colors so the caller can fall back to its default styling.
 *
 * @param {string} color Stage hex color.
 * @return {Object|undefined} Inline style ({ backgroundColor, color }), or undefined.
 */
export function statusPillStyle( color ) {
	const hsl = hexToHsl( color );
	if ( ! hsl ) {
		return undefined;
	}
	return {
		backgroundColor: hslToHex( hsl.h, hsl.s, 0.9 ),
		color: hslToHex( hsl.h, Math.min( hsl.s, 0.7 ), 0.3 ),
	};
}
