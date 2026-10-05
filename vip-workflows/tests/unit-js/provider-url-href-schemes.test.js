/**
 * Provider-supplied URLs at the anchors that render them.
 *
 * A research provider, a discovery provider or a scraped page hands back URLs,
 * and nine anchors on the ideation screens put one in an `href`. The link
 * components do not inspect a scheme, and the installed React still renders a
 * `javascript:` URL, so each of those anchors has to refuse a URL that could
 * run script.
 *
 * This file is about the render layer only. Every URL is passed in as a
 * component prop, exactly as it would arrive from storage, so a check made
 * when a URL is stored cannot make these pass — and a value that was stored
 * before any such check existed is covered too.
 *
 * What an anchor "links to" is decided the way a browser decides it: each
 * `href` in the document is run through the URL parser, which discards the
 * leading whitespace and control characters a string comparison would miss.
 *
 * Each anchor is also rendered with a web address first. Without that, a case
 * would pass just as well if its modal never opened.
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import ArticleCard from '../../src/admin/components/ideation/cards/ArticleCard';
import DocumentCard from '../../src/admin/components/ideation/cards/DocumentCard';
import ImageCard from '../../src/admin/components/ideation/cards/ImageCard';
import PromptPreviewModal from '../../src/admin/components/ideation/PromptPreviewModal';

const WEB_URL = 'https://source.example.test/story';

const SCRIPT_URLS = [
	[ 'a javascript: URL', 'javascript:alert(1)' ],
	[ 'a javascript: URL behind a tab', '\tjavascript:alert(1)' ],
	[ 'a data: URL', 'data:text/html,<script>alert(1)</script>' ],
];

/*
 * The image address is also the card's own `<img src>`, and React's
 * development build reports a `javascript:` URL in a `src` on the console —
 * once per run, so in whichever case happens to render it first. An image
 * source does not run script, so that report is not what this file is about;
 * the cases for this one anchor use schemes React says nothing about.
 */
const SCRIPT_IMAGE_URLS = [
	[ 'a data: URL', 'data:text/html,<script>alert(1)</script>' ],
	[ 'a vbscript: URL', 'vbscript:msgbox(1)' ],
];

const SCRIPT_SCHEMES = [ 'javascript:', 'data:', 'vbscript:' ];

/**
 * Every `href` in the document that a browser would read as able to run
 * script. The document, not a container: the detail modals are portaled.
 *
 * @return {string[]} The offending `href` values, as written.
 */
const scriptHrefs = () =>
	[ ...document.querySelectorAll( '[href]' ) ]
		.map( ( element ) => element.getAttribute( 'href' ) )
		.filter( ( href ) =>
			SCRIPT_SCHEMES.includes(
				new URL( href, document.baseURI ).protocol
			)
		);

const article = {
	source_id: 'art1',
	project_id: 7,
	title: 'Reservoir levels fall for a third year',
	domain: 'news.example.test',
	excerpt: 'Levels are at a record low.',
};

const renderArticle = ( url ) =>
	render( <ArticleCard card={ { ...article, url } } /> );

const openArticle = ( url ) => {
	renderArticle( url );
	fireEvent.click( screen.getByText( article.title ) );
};

// An image found on a page: `url` is the page, `image` is the file.
const image = {
	source_id: 'img1',
	project_id: 7,
	title: 'The reservoir from the air',
	source_type: 'image',
	domain: 'photos.example.test',
	url: 'https://photos.example.test/reservoir',
	image: 'https://photos.example.test/reservoir.jpg',
};

const openImage = ( overrides ) => {
	const { container } = render(
		<ImageCard card={ { ...image, ...overrides } } />
	);
	fireEvent.click(
		container.querySelector( '.vip-workflows-ideation-card' )
	);
};

const uploadedDocument = {
	source_id: 'doc1',
	project_id: 7,
	title: 'Annual levels report',
	source_type: 'document',
	origin: 'manual',
	file_type: 'application/pdf',
	file_size: 482113,
	processing_status: 'complete',
	excerpt: 'Levels fell for a third year.',
};

const openDocument = ( url ) => {
	render( <DocumentCard card={ { ...uploadedDocument, url } } /> );
	fireEvent.click( screen.getByText( uploadedDocument.title ) );
};

const prompt = {
	id: 'wire-703721',
	provider: 'wire',
	title: 'Reservoir authority publishes annual levels',
	description: 'The authority publishes its yearly figures.',
	date: '2026-10-12T09:00:00+00:00',
	tags: [ 'Environment' ],
	importance: 'normal',
	meta: { links: [] },
};

const openPrompt = ( overrides ) =>
	render(
		<PromptPreviewModal
			prompt={ { ...prompt, ...overrides } }
			provider={ { slug: 'wire', label: 'Wire' } }
			onSelect={ () => {} }
			onClose={ () => {} }
			submitting={ false }
		/>
	);

// The second link of two, because the preview renders every link of a prompt.
const openPromptWithLink = ( url ) =>
	openPrompt( {
		meta: {
			links: [
				{
					url: 'https://authority.example.test/agenda',
					description: 'Agenda',
				},
				{ url, description: 'Live stream' },
			],
		},
	} );

const dialog = () => screen.getByRole( 'dialog' );

/*
 * One entry per anchor. `open` renders the component with the URL in the field
 * the anchor reads, and opens the detail modal when the anchor is inside it.
 * `anchor` finds it the way a reader would, by role and name. `rendered` is
 * what proves the part of the screen that holds the anchor is there.
 *
 * Link names are matched loosely where the anchor opens a new tab: the WPDS
 * Link appends screen-reader-only text to its name.
 */
const ANCHORS = [
	{
		name: 'ArticleCard: "Open" on the card face',
		field: 'card.url',
		urls: SCRIPT_URLS,
		open: renderArticle,
		anchor: () => screen.queryByRole( 'link', { name: 'Open' } ),
		rendered: () => screen.getByText( article.title ),
	},
	{
		name: 'ArticleCard: the source domain in the modal',
		field: 'card.url',
		urls: SCRIPT_URLS,
		open: openArticle,
		anchor: () =>
			screen.queryByRole( 'link', { name: /news\.example\.test/ } ),
		rendered: dialog,
	},
	{
		name: 'ArticleCard: "Open source" in the modal',
		field: 'card.url',
		urls: SCRIPT_URLS,
		open: openArticle,
		anchor: () => screen.queryByRole( 'link', { name: 'Open source' } ),
		rendered: dialog,
	},
	{
		name: 'ImageCard: the source domain in the modal',
		field: 'card.url',
		urls: SCRIPT_URLS,
		open: ( url ) => openImage( { url } ),
		anchor: () =>
			screen.queryByRole( 'link', { name: /photos\.example\.test/ } ),
		rendered: dialog,
	},
	{
		name: 'ImageCard: "Open source" in the modal',
		field: 'card.url',
		urls: SCRIPT_URLS,
		open: ( url ) => openImage( { url } ),
		anchor: () => screen.queryByRole( 'link', { name: 'Open source' } ),
		rendered: dialog,
	},
	{
		name: 'ImageCard: "Open full image" in the modal',
		field: 'card.image',
		urls: SCRIPT_IMAGE_URLS,
		open: ( url ) => openImage( { image: url } ),
		anchor: () => screen.queryByRole( 'link', { name: 'Open full image' } ),
		rendered: dialog,
	},
	{
		name: 'PromptPreviewModal: a link in the list of links',
		field: 'meta.links[].url',
		urls: SCRIPT_URLS,
		open: openPromptWithLink,
		anchor: () => screen.queryByRole( 'link', { name: /Live stream/ } ),
		rendered: dialog,
	},
	{
		name: 'PromptPreviewModal: "Open source"',
		field: 'prompt.url',
		urls: SCRIPT_URLS,
		open: ( url ) => openPrompt( { url } ),
		anchor: () => screen.queryByRole( 'link', { name: 'Open source' } ),
		rendered: dialog,
	},
	{
		name: 'DocumentCard: "Open file" in the modal',
		field: 'card.url',
		urls: SCRIPT_URLS,
		open: openDocument,
		anchor: () => screen.queryByRole( 'link', { name: 'Open file' } ),
		rendered: dialog,
	},
];

describe.each( ANCHORS )(
	'$name ($field)',
	( { urls, open, anchor, rendered } ) => {
		it( 'links to a web address', () => {
			open( WEB_URL );

			expect( anchor() ).toHaveAttribute( 'href', WEB_URL );
		} );

		it.each( urls )( 'does not link to %s', ( label, url ) => {
			open( url );

			expect( rendered() ).toBeInTheDocument();
			expect( scriptHrefs() ).toEqual( [] );
		} );
	}
);

describe( 'PromptPreviewModal: every link in the list', () => {
	it( 'does not link any of them to a script URL', () => {
		openPrompt( {
			meta: {
				links: [
					{ url: 'javascript:alert(1)', description: 'Agenda' },
					{ url: WEB_URL, description: 'Report' },
					{ url: 'javascript:alert(3)', description: 'Live stream' },
				],
			},
		} );

		expect( scriptHrefs() ).toEqual( [] );
		expect(
			screen.getByRole( 'link', { name: /Report/ } )
		).toHaveAttribute( 'href', WEB_URL );
		expect( screen.getByText( 'Agenda' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Live stream' ) ).toBeInTheDocument();
	} );
} );
