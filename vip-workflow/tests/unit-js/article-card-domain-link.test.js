/**
 * The source domain in the article detail modal.
 *
 * The domain is the source's identity, so it links to the source — matching
 * ImageCard, which already did. The compact card deliberately does not: the whole
 * card is a click target that opens the modal, and a link inside it would be a
 * nested interactive element competing for the same click.
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import ArticleCard from '../../src/admin/components/ideation/cards/ArticleCard';

const card = {
	source_id: 'abc123',
	project_id: 7,
	title: 'Backpack the Clouds Rest and Half Dome Loop',
	domain: 'wildpathsaz.com',
	url: 'https://wildpathsaz.com/clouds-rest-half-dome/',
	excerpt: 'Clouds Rest and Half Dome are two of the best destinations.',
};

const openModal = ( props = {} ) => {
	const view = render( <ArticleCard card={ { ...card, ...props } } /> );
	fireEvent.click( screen.getByText( card.title ) );
	return view;
};

describe( 'ArticleCard domain', () => {
	it( 'links the domain to the source in the modal', () => {
		openModal();

		// Name matched loosely: WPDS Link with openInNewTab appends
		// screen-reader-only text, so the accessible name is not just the domain.
		const link = screen.getByRole( 'link', { name: /wildpathsaz\.com/ } );
		expect( link ).toHaveAttribute( 'href', card.url );
	} );

	it( 'does not link the domain on the compact card, which is itself a click target', () => {
		const { container } = render( <ArticleCard card={ card } /> );

		// The card's actions row does contain an "Open" anchor by design; what
		// must not appear is a second link wrapping the domain, competing with
		// the card's own click handler.
		const domainAnchors = [ ...container.querySelectorAll( 'a' ) ].filter(
			( a ) => a.textContent.trim() === 'wildpathsaz.com'
		);

		expect( domainAnchors ).toHaveLength( 0 );
		expect( container.textContent ).toContain( 'wildpathsaz.com' );
	} );

	it( 'falls back to a badge when the card has no URL', () => {
		openModal( { url: '' } );

		expect(
			screen.queryByRole( 'link', { name: /wildpathsaz\.com/ } )
		).toBeNull();
		expect(
			screen.getAllByText( 'wildpathsaz.com' ).length
		).toBeGreaterThan( 0 );
	} );

	it( 'keeps the Archive badge as a badge rather than linking it', () => {
		// An archive card's domain is not a place a reader can go.
		openModal( { origin: 'archive' } );

		expect( screen.queryByRole( 'link', { name: /Archive/ } ) ).toBeNull();
		expect( screen.getAllByText( 'Archive' ).length ).toBeGreaterThan( 0 );
	} );
} );
