/**
 * getCardPreview — the text a card shows on the board.
 *
 * The bug: cards rendered `card.excerpt` only, so an assistant sending a
 * first-line excerpt for line-broken content (a poem, a list) had its body
 * dropped at render. The first attempt at this fix only changed DocumentCard,
 * which is reached solely by `type === 'document'` — the poems arrive as
 * `type: 'article'` and render through ArticleCard, so the board did not change.
 * These cover the shared helper both cards now use.
 */

import { render, screen } from './helpers/render-wp-component';

import {
	getCardPreview,
	CARD_PREVIEW_LIMIT,
} from '../../src/admin/components/ideation/cards/shared';
import ArticleCard from '../../src/admin/components/ideation/cards/ArticleCard';

const POEM =
	'Light cracks the horizon,\nsilence stirs to sound.\nThe world remakes itself\nin gold upon the ground.';

describe( 'getCardPreview', () => {
	it( 'prefers the whole body when it is short enough to read inline', () => {
		expect(
			getCardPreview( {
				excerpt: 'Light cracks the horizon,',
				content: POEM,
			} )
		).toBe( POEM );
	} );

	it( 'keeps the line breaks rather than collapsing them', () => {
		// The defect was structural, so assert on the structure, not just presence.
		expect(
			getCardPreview( { content: POEM } ).split( '\n' )
		).toHaveLength( 4 );
	} );

	it( 'falls back to the excerpt for a body too long to read inline', () => {
		const long = 'x'.repeat( CARD_PREVIEW_LIMIT + 1 );

		expect(
			getCardPreview( { excerpt: 'A short summary.', content: long } )
		).toBe( 'A short summary.' );
	} );

	it( 'does not let a short boilerplate body displace a real excerpt', () => {
		// A paywall or consent notice is short; without the length guard it
		// would outrank an editorial summary.
		expect(
			getCardPreview( {
				excerpt: 'A genuine editorial summary of the article body.',
				content: 'Subscribe to continue.',
			} )
		).toBe( 'A genuine editorial summary of the article body.' );
	} );

	it( 'ignores a whitespace-only body', () => {
		expect(
			getCardPreview( { excerpt: 'Real text.', content: '   \n\n  ' } )
		).toBe( 'Real text.' );
	} );

	it( 'truncates an over-long excerpt', () => {
		const preview = getCardPreview( { excerpt: 'y'.repeat( 400 ) } );

		expect( preview ).toHaveLength( CARD_PREVIEW_LIMIT + 3 );
		expect( preview.endsWith( '...' ) ).toBe( true );
	} );

	it( 'returns an empty string when the card has neither', () => {
		expect( getCardPreview( {} ) ).toBe( '' );
	} );
} );

describe( 'ArticleCard board preview', () => {
	it( 'renders the full poem, not the first line — the reported bug', () => {
		// ArticleCard is what `type: 'article'` reaches, which is what the poems
		// assistant sends. Fixing DocumentCard alone left this broken.
		render(
			<ArticleCard
				card={ {
					source_id: 'p1',
					title: 'Dawn',
					excerpt: 'Light cracks the horizon,',
					content: POEM,
				} }
			/>
		);

		const node = screen.getByText( /in gold upon the ground\./ );

		// getByText normalises whitespace, so check the raw node for the breaks.
		expect( node.textContent.split( '\n' ) ).toHaveLength( 4 );
	} );

	it( 'strips markdown from a scraped excerpt rather than showing its syntax', () => {
		// The preview is a truncated plain-text slot, so markup here reaches the
		// board as literal characters.
		expect(
			getCardPreview( {
				excerpt:
					'See the [trail guide](https://example.test/g) and **note** this.',
			} )
		).toBe( 'See the trail guide and note this.' );
	} );

	it( 'does not leave a stray bang from an image in the preview', () => {
		expect(
			getCardPreview( {
				excerpt: '![WildPathsAZ logo](https://x.test/l.png) Body text.',
			} )
		).toBe( 'WildPathsAZ logo Body text.' );
	} );

	it( 'strips before truncating, so the limit is not spent on markup', () => {
		// A 300-char limit applied to the raw string would cut inside the URL and
		// leave half a link on the card.
		const url = 'https://example.test/' + 'p'.repeat( 300 );
		const preview = getCardPreview( {
			excerpt: `[short label](${ url }) then prose.`,
		} );

		expect( preview ).toBe( 'short label then prose.' );
	} );
} );
