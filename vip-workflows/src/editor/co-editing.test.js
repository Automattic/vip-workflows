/**
 * Internal dependencies
 */
import { hasOtherEditorsOpen } from './co-editing';

describe( 'hasOtherEditorsOpen', () => {
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	it( 'is false when the editor shows no other collaborators', () => {
		document.body.innerHTML = '<div class="editor-header"></div>';
		expect( hasOtherEditorsOpen() ).toBe( false );
	} );

	it( 'is true when Gutenberg renders the collaborators presence', () => {
		document.body.innerHTML =
			'<div class="editor-header"><div class="editor-collaborators-presence"></div></div>';
		expect( hasOtherEditorsOpen() ).toBe( true );
	} );
} );
