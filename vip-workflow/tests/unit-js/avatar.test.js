/**
 * Unit tests for the shared avatar.
 *
 * A smaller avatar is not the same avatar scaled: the glyph it carries and the
 * number of letters it has room for both change with the box, and the component
 * owns that pairing so a call site cannot shrink the box and clip its contents.
 * These pin the pairing, since the box itself is set in CSS and so is invisible
 * to jsdom.
 */

import { render } from './helpers/render-wp-component';
import { Avatar } from '../../src/common/Avatar';
import { sparkle } from '../../src/common/icons';

const initialsOf = ( ui ) =>
	render( ui ).container.querySelector( '.vip-workflow-avatar__initials' )
		.textContent;

describe( 'Avatar initials', () => {
	it( 'takes the first and last name at the default size', () => {
		expect( initialsOf( <Avatar name="Ada Lovelace" /> ) ).toBe( 'AL' );
	} );

	it( 'takes one letter only where two would not fit', () => {
		// The widest pair runs past a 2xs box, and the box clips.
		expect( initialsOf( <Avatar name="Ada Lovelace" size="2xs" /> ) ).toBe(
			'A'
		);
	} );

	it( 'reads one letter from a single-word name at either size', () => {
		expect( initialsOf( <Avatar name="admin" /> ) ).toBe( 'A' );
		expect( initialsOf( <Avatar name="admin" size="2xs" /> ) ).toBe( 'A' );
	} );

	it( 'keeps a whole glyph from a name starting outside the BMP', () => {
		// Array.from rather than [0], so an astral character does not come back
		// as half a surrogate pair.
		expect( initialsOf( <Avatar name="🌟 Nova" /> ) ).toBe( '🌟N' );
	} );

	it( 'has nothing to show for a blank name', () => {
		expect( initialsOf( <Avatar name="" /> ) ).toBe( '' );
		expect( initialsOf( <Avatar name={ undefined } /> ) ).toBe( '' );
	} );
} );

describe( 'Avatar sizing', () => {
	it( 'names its size on the box, which is where the CSS sets one', () => {
		const at = ( size ) =>
			render( <Avatar name="Ada Lovelace" size={ size } /> ).container
				.firstChild.className;

		expect( at( undefined ) ).toContain( 'vip-workflow-avatar--sm' );
		expect( at( '2xs' ) ).toContain( 'vip-workflow-avatar--2xs' );
	} );

	it( 'scales the glyph with the box rather than fixing it', () => {
		const glyphWidth = ( size ) =>
			render(
				<Avatar
					name="Fact Check Agent"
					icon={ sparkle }
					size={ size }
				/>
			)
				.container.querySelector( 'svg' )
				.getAttribute( 'width' );

		expect( Number( glyphWidth( '2xs' ) ) ).toBeLessThan(
			Number( glyphWidth( 'sm' ) )
		);
	} );

	it( 'shows the glyph instead of initials, never both', () => {
		const { container } = render(
			<Avatar name="Fact Check Agent" icon={ sparkle } size="2xs" />
		);

		expect( container.querySelector( 'svg' ) ).not.toBeNull();
		expect( container.textContent ).toBe( '' );
	} );
} );
