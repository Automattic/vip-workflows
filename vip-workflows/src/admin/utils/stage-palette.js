/**
 * Stage color palette.
 *
 * The sequence editor used to derive stage colors from a single freeform base
 * color via a `<input type="color">` picker (`stage-colors.js`, which still
 * powers read-only status pills elsewhere). That was too open-ended — any hex
 * was allowed, so stage colors drifted off the design system. The editor now
 * offers a fixed, named palette instead: the collaboration
 * qualitative palette (`collaborator.stroke`, slots 1–7), the shared categorical
 * palette VIP Workflows stage/badge colors are migrating onto.
 *
 * A palette only holds if everything is on it. The hexes those old pickers
 * wrote are still in stored sequences, so `snapToPalette` moves each onto the
 * slot nearest it as the sequence is read into the editor — there is no
 * "custom" slot to park one in, and nothing that reads a stage's color has to
 * cope with a value the palette doesn't name.
 *
 * Values are hex strings because the REST controller sanitizes the stored
 * `color` with `sanitize_hex_color()` — the name is for the picker only.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';

/**
 * The selectable stage colors, in slot order. `name` is shown in the picker;
 * `value` is the hex persisted to the sequence config.
 *
 * @type {Array<{ name: string, value: string }>}
 */
export const STAGE_PALETTE = [
	{ name: __( 'Purple', 'vip-workflows' ), value: '#C36EFF' },
	{ name: __( 'Pink', 'vip-workflows' ), value: '#FF51A8' },
	{ name: __( 'Orange', 'vip-workflows' ), value: '#E4780A' },
	{ name: __( 'Magenta', 'vip-workflows' ), value: '#FF35EE' },
	{ name: __( 'Green', 'vip-workflows' ), value: '#879F11' },
	{ name: __( 'Teal', 'vip-workflows' ), value: '#46A494' },
	{ name: __( 'Blue', 'vip-workflows' ), value: '#00A2C3' },
];

/** The color the canvas draws a stage that carries none. */
export const DEFAULT_STAGE_COLOR = STAGE_PALETTE[ 0 ].value;

/**
 * Pick a palette color for a new stage by its position, cycling through slots so
 * adjacent stages stay visually distinct.
 *
 * @param {number} index Zero-based stage position.
 * @return {string} Hex color.
 */
export function paletteColorAt( index ) {
	const slot =
		( ( index % STAGE_PALETTE.length ) + STAGE_PALETTE.length ) %
		STAGE_PALETTE.length;
	return STAGE_PALETTE[ slot ].value;
}

/**
 * SelectControl options for the color picker — the palette, and nothing else.
 *
 * There used to be a synthetic "Custom" entry here, carrying whatever
 * off-palette hex a stage had arrived with so the picker could show it. It made
 * the drift it was meant to end survivable: a stage could sit on a colour no
 * slot names indefinitely, and re-picking it was the only thing that ever moved
 * it. Off-palette values are migrated on the way in instead
 * (`snapToPalette`), so every stage the picker sees is on a slot and the list
 * of slots is the whole list.
 *
 * @return {Array<{ label: string, value: string }>} Options.
 */
export function paletteOptions() {
	return STAGE_PALETTE.map( ( { name, value } ) => ( {
		label: name,
		value,
	} ) );
}

/**
 * A hex colour's three channels, or null when the string isn't one.
 *
 * Both forms `sanitize_hex_color()` stores are read, since both can be in the
 * sequences this migrates.
 *
 * @param {string} hex Colour string.
 * @return {?number[]} `[ r, g, b ]` in 0–255, or null.
 */
function channelsOf( hex ) {
	const value = String( hex || '' ).trim();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec( value );
	if ( short ) {
		return short.slice( 1 ).map( ( c ) => parseInt( c + c, 16 ) );
	}
	const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec( value );
	if ( full ) {
		return full.slice( 1 ).map( ( c ) => parseInt( c, 16 ) );
	}
	return null;
}

/**
 * A colour's hue in degrees, or null when it hasn't got one.
 *
 * @param {number[]} rgb Channels in 0–255.
 * @return {?number} Hue in [0, 360), or null for a grey.
 */
function hueOf( [ r, g, b ] ) {
	const max = Math.max( r, g, b );
	const chroma = max - Math.min( r, g, b );
	if ( ! chroma ) {
		return null;
	}
	let sextant;
	if ( max === r ) {
		sextant = ( g - b ) / chroma;
	} else if ( max === g ) {
		sextant = ( b - r ) / chroma + 2;
	} else {
		sextant = ( r - g ) / chroma + 4;
	}
	return ( ( ( sextant * 60 ) % 360 ) + 360 ) % 360;
}

/**
 * The palette slot a stage's colour belongs on.
 *
 * Sequences written before the picker was a palette hold any hex the old
 * freeform `<input type="color">` allowed. Rather than carry those forever,
 * each is moved to the slot nearest it, so a stage that was some particular
 * purple comes back as the palette's purple and the author sees the colour they
 * chose named for the first time. A value already on a slot is its own nearest
 * slot, so this is an identity for everything the current editor writes.
 *
 * Nearest by *hue*, not by distance between the two colours. Straight-line
 * distance in sRGB is dominated by how light and how saturated each colour is,
 * which is exactly what a palette normalises and nobody is asking to preserve:
 * measured that way WordPress admin purple (`#826eb4`) comes out nearer this
 * palette's teal than its purple, because the teal happens to sit at a similar
 * lightness. Hue is the thing a stage's colour is *for* here — seven tags to
 * tell stages apart at a glance — and the palette's seven are far enough apart
 * (30°, 70°, 170°, 190°, 275°, 305°, 330°) that the nearest one is never a
 * close call.
 *
 * Two kinds of value have no hue to be matched on, and take the position-based
 * round robin instead — the same one a new stage gets, which keeps neighbours
 * distinct: a grey, black or white, and a value that is no colour at all
 * (absent, or a string no hex syntax matches).
 *
 * @param {string} color The stage's stored colour.
 * @param {number} index Its position in the sequence.
 * @return {string} A hex from `STAGE_PALETTE`.
 */
export function snapToPalette( color, index ) {
	const rgb = channelsOf( color );
	const hue = rgb ? hueOf( rgb ) : null;
	if ( hue === null ) {
		return paletteColorAt( index );
	}

	let nearest = STAGE_PALETTE[ 0 ].value;
	let shortest = Infinity;
	STAGE_PALETTE.forEach( ( slot ) => {
		const slotHue = hueOf( channelsOf( slot.value ) );
		// Around the wheel, so 350° and 10° are twenty degrees apart.
		const gap = Math.abs( hue - slotHue );
		const around = Math.min( gap, 360 - gap );
		if ( around < shortest ) {
			shortest = around;
			nearest = slot.value;
		}
	} );
	return nearest;
}
