/**
 * ImageCard's grid thumbnail when the image will not load.
 *
 * Card images are hotlinked from the source site, so a failed load is routine.
 * The previous handler mutated the DOM — hid the `<img>` and removed `is-hidden`
 * from its next sibling — but no element in this tree carries that class, and the
 * placeholder it meant to reveal is only rendered when there is no image to begin
 * with. So a broken image produced a blank tile with the card's title as its only
 * content, which is the MEDIA SCOUT tile in the report.
 *
 * The video branch had no error handler at all, so a dead poster showed the
 * browser's broken-image glyph.
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import ImageCard from '../../src/admin/components/ideation/cards/ImageCard';

const PLACEHOLDER = '.vip-workflows-ideation-card--image__placeholder';
const VIDEO_PLACEHOLDER =
	'.vip-workflows-ideation-card--image__video-placeholder';

const imageCard = {
	source_id: 'img1',
	project_id: 7,
	title: 'The Westminster Tradition',
	source_type: 'image',
	image: 'https://example.test/photo.jpg',
};

const videoCard = {
	source_id: 'vid1',
	project_id: 7,
	title: 'A clip',
	source_type: 'video',
	url: 'https://example.test/watch',
	image: 'https://example.test/poster.jpg',
};

describe( 'ImageCard thumbnail fallback', () => {
	it( 'shows the image while it loads fine', () => {
		const { container } = render( <ImageCard card={ imageCard } /> );

		expect( container.querySelector( 'img' ) ).toHaveAttribute(
			'src',
			imageCard.image
		);
		expect( container.querySelector( PLACEHOLDER ) ).toBeNull();
	} );

	it( 'swaps a failed image for the card placeholder rather than a blank tile', () => {
		const { container } = render( <ImageCard card={ imageCard } /> );

		fireEvent.error( container.querySelector( 'img' ) );

		// The img is gone rather than hidden, so no browser glyph and no
		// zero-height element holding the layout open.
		expect( container.querySelector( 'img' ) ).toBeNull();
		expect( container.querySelector( PLACEHOLDER ) ).toBeInTheDocument();
	} );

	it( 'does not leave the failed image in the DOM with display:none', () => {
		// The old handler's approach. Asserted directly because a hidden <img>
		// looks identical to a removed one in a screenshot, but keeps its alt
		// text in the accessibility tree.
		const { container } = render( <ImageCard card={ imageCard } /> );

		fireEvent.error( container.querySelector( 'img' ) );

		const hidden = [ ...container.querySelectorAll( '*' ) ].filter(
			( el ) => el.style?.display === 'none'
		);
		expect( hidden ).toHaveLength( 0 );
	} );

	it( 'still shows the title on the placeholder, so the card stays identifiable', () => {
		const { container } = render( <ImageCard card={ imageCard } /> );

		fireEvent.error( container.querySelector( 'img' ) );

		expect(
			screen.getByText( 'The Westminster Tradition' )
		).toBeInTheDocument();
		expect( container.querySelector( PLACEHOLDER ) ).toBeInTheDocument();
	} );

	it( 'falls back for a video poster too, which had no handler at all', () => {
		const { container } = render( <ImageCard card={ videoCard } /> );

		const poster = container.querySelector( 'img' );
		expect( poster ).toHaveAttribute( 'src', videoCard.image );

		fireEvent.error( poster );

		expect( container.querySelector( 'img' ) ).toBeNull();
		expect(
			container.querySelector( VIDEO_PLACEHOLDER )
		).toBeInTheDocument();
	} );

	it( 'recovers for a different src, so one dead URL does not poison the slot', () => {
		const { container, rerender } = render(
			<ImageCard card={ imageCard } />
		);

		fireEvent.error( container.querySelector( 'img' ) );
		expect( container.querySelector( 'img' ) ).toBeNull();

		rerender(
			<ImageCard
				card={ {
					...imageCard,
					image: 'https://example.test/other.jpg',
				} }
			/>
		);

		expect( container.querySelector( 'img' ) ).toHaveAttribute(
			'src',
			'https://example.test/other.jpg'
		);
	} );

	it( 'shows the placeholder when there is no image at all', () => {
		const { container } = render(
			<ImageCard card={ { ...imageCard, image: '', url: '' } } />
		);

		expect( container.querySelector( 'img' ) ).toBeNull();
		expect( container.querySelector( PLACEHOLDER ) ).toBeInTheDocument();
	} );
} );
