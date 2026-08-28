/**
 * CardThumb — the shared remote-image slot for ideation cards.
 *
 * Card images are hotlinked from the source site, so a failed load is routine
 * rather than exceptional. These cover the swap to the fallback, that the
 * caller's own sizing class survives it, and that the failure does not stick to
 * the slot when a different image is shown.
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import { CardThumb } from '../../src/admin/components/ideation/cards/shared';

describe( 'CardThumb', () => {
	it( 'renders nothing without a src, so no empty box is reserved', () => {
		const { container } = render( <CardThumb src={ undefined } /> );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders the image while it is loading fine', () => {
		render( <CardThumb src="https://example.test/a.jpg" alt="Headline" /> );
		expect(
			screen.getByRole( 'img', { name: 'Headline' } )
		).toHaveAttribute( 'src', 'https://example.test/a.jpg' );
	} );

	it( 'swaps to a labelled fallback when the image fails, and drops the img', () => {
		const { container } = render(
			<CardThumb src="https://example.test/gone.jpg" />
		);

		fireEvent.error( container.querySelector( 'img' ) );

		// The broken <img> is gone rather than hidden, so no browser glyph.
		expect( container.querySelector( 'img' ) ).toBeNull();
		expect(
			screen.getByRole( 'img', { name: 'Image unavailable' } )
		).toBeInTheDocument();
	} );

	it( "keeps the caller's sizing class on the fallback", () => {
		// The caller owns layout; the fallback must inherit it or the modal
		// image collapses to nothing when the load fails.
		const { container } = render(
			<CardThumb
				src="https://example.test/gone.jpg"
				className="vip-workflow-ideation-detail-modal__image"
			/>
		);

		fireEvent.error( container.querySelector( 'img' ) );

		const fallback = screen.getByRole( 'img', {
			name: 'Image unavailable',
		} );
		expect( fallback ).toHaveClass(
			'vip-workflow-ideation-detail-modal__image'
		);
		expect( fallback ).toHaveClass(
			'vip-workflow-ideation-card__image-unavailable'
		);
	} );

	it( 'recovers for a different src, so one dead URL does not poison the slot', () => {
		const { container, rerender } = render(
			<CardThumb src="https://example.test/gone.jpg" />
		);
		fireEvent.error( container.querySelector( 'img' ) );
		expect( container.querySelector( 'img' ) ).toBeNull();

		rerender( <CardThumb src="https://example.test/fine.jpg" /> );

		expect( container.querySelector( 'img' ) ).toHaveAttribute(
			'src',
			'https://example.test/fine.jpg'
		);
	} );
} );
