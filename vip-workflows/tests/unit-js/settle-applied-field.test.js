import '@testing-library/jest-dom';
/**
 * The dissolve played on a field a tool wrote to.
 *
 * Best-effort by design: the fields belong to core, so the only handle is a DOM
 * node. These pin that a missing node is silent rather than fatal — decoration
 * must never break the thing it decorates.
 *
 * @package
 */

import { settleAppliedField } from '../../src/common/settle-applied-field';

const SETTLE_CLASS = 'vip-workflows-field--settling';

describe( 'settleAppliedField', () => {
	afterEach( () => {
		document.body.innerHTML = '';
		jest.useRealTimers();
	} );

	it( 'marks the title field so the animation plays', () => {
		document.body.innerHTML =
			'<textarea class="editor-post-title__input"></textarea>';

		settleAppliedField( 'title' );

		expect(
			document.querySelector( '.editor-post-title__input' )
		).toHaveClass( SETTLE_CLASS );
	} );

	it( 'clears the marker once the animation is over', () => {
		jest.useFakeTimers();
		document.body.innerHTML =
			'<textarea class="editor-post-title__input"></textarea>';

		settleAppliedField( 'title' );
		jest.runAllTimers();

		expect(
			document.querySelector( '.editor-post-title__input' )
		).not.toHaveClass( SETTLE_CLASS );
	} );

	it( 'does nothing when the field is not on screen', () => {
		expect( () => settleAppliedField( 'title' ) ).not.toThrow();
	} );

	it( 'does nothing for a field it has no selector for', () => {
		document.body.innerHTML = '<div class="something-else"></div>';

		expect( () => settleAppliedField( 'made_up_field' ) ).not.toThrow();
	} );

	it( 'restarts on a second apply rather than coalescing', () => {
		jest.useFakeTimers();
		document.body.innerHTML =
			'<textarea class="editor-post-title__input"></textarea>';

		settleAppliedField( 'title' );
		jest.runAllTimers();
		settleAppliedField( 'title' );

		expect(
			document.querySelector( '.editor-post-title__input' )
		).toHaveClass( SETTLE_CLASS );
	} );
} );
