/**
 * The markdown renderer.
 *
 * The reported bug is the first case: a summary with a heading, bold runs and a
 * bullet list rendered as literal syntax, with the list collapsed into one
 * paragraph. The rest guard the three ways this can go wrong — markup that
 * should render and doesn't, text that should be inert and isn't, and content
 * that gets silently dropped instead of degrading to characters.
 */

import { render, screen } from './helpers/render-wp-component';

import {
	renderMarkdown,
	isSafeUrl,
	MarkdownText,
} from '../../src/admin/components/markdown';

describe( 'MarkdownText', () => {
	it( 'renders the reported summary as real formatting, not syntax', () => {
		const summary = [
			'## Summary: History of the National Park Service',
			'',
			'This article traces the evolution of the U.S. National Park System.',
			'',
			'- **63 National Parks** – the flagship designation',
			'- **National Monuments** – protecting historic sites',
		].join( '\n' );

		const { container } = render( <MarkdownText text={ summary } /> );

		expect(
			container.querySelector( '.vip-workflow-markdown__heading' )
				.textContent
		).toBe( 'Summary: History of the National Park Service' );

		const lists = container.querySelectorAll( 'ul' );
		expect( lists ).toHaveLength( 1 );
		expect( lists[ 0 ].querySelectorAll( 'li' ) ).toHaveLength( 2 );

		expect( container.querySelectorAll( 'strong' )[ 0 ].textContent ).toBe(
			'63 National Parks'
		);
		expect( container.textContent ).not.toContain( '**' );
		expect( container.textContent ).not.toContain( '##' );
	} );

	describe( 'safety', () => {
		it( 'does not interpret HTML in model or scraped output', () => {
			const { container } = render(
				<MarkdownText
					text={ '<img src=x onerror="alert(1)"> and <b>bold</b>' }
				/>
			);

			expect( container.querySelector( 'img' ) ).toBeNull();
			expect( container.querySelector( 'b' ) ).toBeNull();
			expect( container.textContent ).toContain( '<img src=x' );
		} );

		it( 'refuses dangerous URL schemes but keeps the link text', () => {
			const { container } = render(
				<MarkdownText
					text={
						'[click me](javascript:alert(1)) and [ok](https://example.test)'
					}
				/>
			);

			const links = container.querySelectorAll( 'a' );
			expect( links ).toHaveLength( 1 );
			expect( links[ 0 ] ).toHaveAttribute(
				'href',
				'https://example.test'
			);

			// The label survives; only the URL is dropped.
			expect( container.textContent ).toContain( 'click me' );
			expect( container.innerHTML ).not.toContain( 'javascript' );
		} );

		it( 'is not fooled by control characters or whitespace in a scheme', () => {
			// Browsers strip these before resolving the scheme, so a naive prefix
			// test would pass them through as links.
			expect( isSafeUrl( 'java\u0000script:alert(1)' ) ).toBe( false );
			expect( isSafeUrl( 'java\nscript:alert(1)' ) ).toBe( false );
			expect( isSafeUrl( '  javascript:alert(1)' ) ).toBe( false );
			expect( isSafeUrl( 'JaVaScRiPt:alert(1)' ) ).toBe( false );
			expect( isSafeUrl( 'data:text/html,<script>' ) ).toBe( false );
			expect( isSafeUrl( 'vbscript:x' ) ).toBe( false );
			expect( isSafeUrl( '' ) ).toBe( false );

			expect( isSafeUrl( 'https://example.test' ) ).toBe( true );
			expect( isSafeUrl( 'mailto:a@example.test' ) ).toBe( true );
			expect( isSafeUrl( '/wp-admin/admin.php' ) ).toBe( true );
			expect( isSafeUrl( '#anchor' ) ).toBe( true );
		} );

		it( 'blocks an unsafe image src and falls back to the alt text', () => {
			const { container } = render(
				<MarkdownText text={ '![the logo](javascript:alert(1))' } />
			);

			expect( container.querySelector( 'img' ) ).toBeNull();
			expect( container.textContent ).toContain( 'the logo' );
		} );

		it( 'opens links in a new tab without leaking the referrer', () => {
			const { container } = render(
				<MarkdownText text="[guide](https://example.test/g)" />
			);

			const link = container.querySelector( 'a' );
			expect( link ).toHaveAttribute( 'target', '_blank' );
			expect( link.getAttribute( 'rel' ) ).toContain( 'noopener' );
			expect( link.getAttribute( 'rel' ) ).toContain( 'noreferrer' );
		} );
	} );

	describe( 'the scraped-content constructs from the report', () => {
		it( 'renders links, images and rules rather than showing their syntax', () => {
			const scraped = [
				'[Skip to content](#wp--skip-link--target)',
				'',
				'![WildPathsAZ logo](https://wildpathsaz.com/logo.png)',
				'',
				'---',
				'',
				'* [YouTube](https://www.youtube.com/channel/UCIW)',
			].join( '\n' );

			const { container } = render( <MarkdownText text={ scraped } /> );

			expect( container.querySelectorAll( 'a' ).length ).toBe( 2 );
			expect( container.querySelector( 'img' ) ).toHaveAttribute(
				'src',
				'https://wildpathsaz.com/logo.png'
			);
			expect( container.querySelector( 'hr' ) ).toBeInTheDocument();

			// None of the syntax reaches the reader.
			expect( container.textContent ).not.toContain( '](' );
			expect( container.textContent ).not.toContain( '---' );
		} );

		it( 'renders a linked image whole, not as a stray bang plus a broken link', () => {
			// `[![alt](src)](href)` — a logo that links home. Scraped pages are
			// full of these, and both the link and the image rule match inside
			// one, so the longest match at the same offset has to win.
			const { container } = render(
				<MarkdownText
					text={
						'[![WildPathsAZ logo](https://wildpathsaz.com/logo.png)](https://wildpathsaz.com/)'
					}
				/>
			);

			const link = container.querySelector( 'a' );
			expect( link ).toHaveAttribute(
				'href',
				'https://wildpathsaz.com/'
			);
			expect( link.querySelector( 'img' ) ).toHaveAttribute(
				'src',
				'https://wildpathsaz.com/logo.png'
			);

			// The symptoms from the report: no stray bang, no leftover syntax.
			expect( container.textContent ).not.toContain( '!' );
			expect( container.textContent ).not.toContain( '](' );
		} );

		it( 'keeps a linked image inert when the href is unsafe', () => {
			const { container } = render(
				<MarkdownText
					text={
						'[![logo](https://example.test/l.png)](javascript:alert(1))'
					}
				/>
			);

			expect( container.querySelector( 'a' ) ).toBeNull();
			expect( container.querySelector( 'img' ) ).toBeInTheDocument();
		} );

		it( 'does not read an image as a link and leave a stray bang', () => {
			const { container } = render(
				<MarkdownText
					text={ '![alt text](https://example.test/i.png)' }
				/>
			);

			expect( container.querySelector( 'img' ) ).toBeInTheDocument();
			expect( container.textContent ).not.toContain( '!' );
		} );
	} );

	describe( 'block constructs', () => {
		it( 'renders ordered lists as ordered lists', () => {
			const { container } = render(
				<MarkdownText text={ '1. first\n2. second' } />
			);

			expect( container.querySelector( 'ol' ) ).toBeInTheDocument();
			expect( container.querySelectorAll( 'li' ) ).toHaveLength( 2 );
		} );

		it( 'nests an indented list inside the item above it', () => {
			const { container } = render(
				<MarkdownText text={ '- one\n  - nested\n- two' } />
			);

			const outer = container.querySelector( 'ul' );
			expect( outer.querySelector( 'ul' ) ).toBeInTheDocument();
			expect( outer.querySelector( 'ul' ).textContent ).toContain(
				'nested'
			);
		} );

		it( 'renders a block quote', () => {
			const { container } = render(
				<MarkdownText text={ '> A quoted **claim**.' } />
			);

			const quote = container.querySelector( 'blockquote' );
			expect( quote ).toBeInTheDocument();
			expect( quote.querySelector( 'strong' ).textContent ).toBe(
				'claim'
			);
		} );

		it( 'renders a fenced code block and does not format inside it', () => {
			const { container } = render(
				<MarkdownText text={ '```js\nconst a = **not bold**;\n```' } />
			);

			const pre = container.querySelector( 'pre' );
			expect( pre ).toBeInTheDocument();
			expect( pre.querySelector( 'strong' ) ).toBeNull();
			expect( pre.textContent ).toContain( '**not bold**' );
		} );

		it( 'renders a table with its header row', () => {
			const { container } = render(
				<MarkdownText
					text={
						'| Park | Year |\n| --- | --- |\n| Yosemite | 1890 |'
					}
				/>
			);

			expect( container.querySelectorAll( 'th' ) ).toHaveLength( 2 );
			expect( container.querySelectorAll( 'tbody tr' ) ).toHaveLength(
				1
			);
			expect( container.querySelectorAll( 'td' )[ 1 ].textContent ).toBe(
				'1890'
			);
		} );

		it( 'clamps headings so they cannot outrank the card title', () => {
			const { container } = render( <MarkdownText text="# Top level" /> );

			expect( container.querySelector( 'h1' ) ).toBeNull();
			expect( container.querySelector( 'h4' ) ).toBeInTheDocument();
		} );

		it( 'keeps paragraphs separate and joins wrapped lines within one', () => {
			const { container } = render(
				<MarkdownText
					text={ 'First line\nsame paragraph.\n\nSecond paragraph.' }
				/>
			);

			const paragraphs = container.querySelectorAll( 'p' );
			expect( paragraphs ).toHaveLength( 2 );
			expect( paragraphs[ 0 ].textContent ).toBe(
				'First line same paragraph.'
			);
		} );

		it( 'starts a new block when a list interrupts a paragraph', () => {
			const { container } = render(
				<MarkdownText text={ 'Intro line\n- one\n- two' } />
			);

			expect( container.querySelector( 'p' ).textContent ).toBe(
				'Intro line'
			);
			expect( container.querySelectorAll( 'li' ) ).toHaveLength( 2 );
		} );
	} );

	describe( 'inline constructs', () => {
		it( 'renders emphasis, strong, both, strike and code', () => {
			const { container } = render(
				<MarkdownText
					text={ '*em* **strong** ***both*** ~~gone~~ `code`' }
				/>
			);

			expect( container.querySelector( 'em' ) ).toBeInTheDocument();
			expect(
				container.querySelectorAll( 'strong' ).length
			).toBeGreaterThan( 0 );
			expect( container.querySelector( 's' ).textContent ).toBe( 'gone' );
			expect( container.querySelector( 'code' ).textContent ).toBe(
				'code'
			);
			expect(
				container.querySelector( 'strong > em' )
			).toBeInTheDocument();
		} );

		it( 'leaves lone asterisks and snake_case identifiers alone', () => {
			const { container } = render(
				<MarkdownText text="Press * to continue; 3 * 4; call max_length_here." />
			);

			expect( container.querySelectorAll( 'em' ) ).toHaveLength( 0 );
			expect( container.textContent ).toBe(
				'Press * to continue; 3 * 4; call max_length_here.'
			);
		} );

		it( 'takes the earliest construct so emphasis cannot pre-empt a link', () => {
			const { container } = render(
				<MarkdownText text="[a link](https://example.test) and *em*" />
			);

			expect( container.querySelector( 'a' ).textContent ).toBe(
				'a link'
			);
			expect( container.querySelector( 'em' ).textContent ).toBe( 'em' );
		} );
	} );

	describe( 'degradation', () => {
		it( 'renders nothing for empty input, so callers keep their empty state', () => {
			expect( renderMarkdown( '' ) ).toBeNull();
			expect( renderMarkdown( '   \n  ' ) ).toBeNull();
			expect( renderMarkdown( undefined ) ).toBeNull();
			expect( renderMarkdown( null ) ).toBeNull();

			const { container } = render( <MarkdownText text="" /> );
			expect( container ).toBeEmptyDOMElement();
		} );

		it( 'never drops content it cannot format', () => {
			// A footnote reference is not handled. It must survive as characters —
			// losing text silently is worse than showing syntax.
			const { container } = render(
				<MarkdownText text={ 'A claim[^1] worth checking.' } />
			);

			expect( container.textContent ).toContain( 'A claim' );
			expect( container.textContent ).toContain( 'worth checking.' );
		} );

		it( 'survives an unterminated code fence', () => {
			const { container } = render(
				<MarkdownText text={ '```\nnever closed' } />
			);

			expect( container.querySelector( 'pre' ).textContent ).toContain(
				'never closed'
			);
		} );

		it( "keeps the caller's class on the wrapper", () => {
			render(
				<MarkdownText
					text="Body."
					className="vip-workflow-ideation-summary__text"
				/>
			);

			expect(
				screen.getByText( 'Body.' ).closest( '.vip-workflow-markdown' )
			).toHaveClass( 'vip-workflow-ideation-summary__text' );
		} );
	} );
} );
