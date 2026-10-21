/**
 * Unit tests for the stage palette's highlight role.
 *
 * Calendar event chips fill with `paletteHighlight()` of the event's status
 * color. These guard that the fill is always a palette slot at highlight
 * strength — never the stored hex, even when that hex is off the palette.
 */

import {
	STAGE_PALETTE,
	DEFAULT_STAGE_COLOR,
	paletteHighlight,
} from '../../src/admin/utils/stage-palette';

const slots = STAGE_PALETTE.map( ( { value } ) => value );
const slotOf = ( highlight ) => highlight.slice( 0, 7 );

describe( 'paletteHighlight', () => {
	it.each( slots )( 'keeps the on-palette slot %s', ( slot ) => {
		expect( paletteHighlight( slot ) ).toBe( `${ slot }1A` );
	} );

	it( 'is an eight-digit hex for every slot', () => {
		slots.forEach( ( slot ) => {
			expect( paletteHighlight( slot ) ).toMatch( /^#[0-9A-F]{8}$/i );
		} );
	} );

	it.each( [
		// Old freeform-picker values, moved to the slot nearest by hue.
		[ 'WordPress admin purple', '#826eb4', '#C36EFF' ],
		[ 'old default blue', '#3498db', '#00A2C3' ],
		[ 'a short-form green', '#8a2', '#879F11' ],
	] )(
		'moves %s (%s) onto its palette slot',
		( _label, stored, expected ) => {
			const highlight = paletteHighlight( stored );
			expect( slotOf( highlight ) ).toBe( expected );
			expect( slots ).toContain( slotOf( highlight ) );
		}
	);

	it.each( [
		'#808080',
		'#000000',
		'#ffffff',
		'',
		undefined,
		'not-a-color',
	] )( 'gives the default slot to a value with no hue (%s)', ( stored ) => {
		expect( paletteHighlight( stored ) ).toBe(
			`${ DEFAULT_STAGE_COLOR }1A`
		);
	} );
} );
