/**
 * Provider-supplied URLs at the elements that render them.
 *
 * A research provider, a discovery provider or a scraped page hands back URLs,
 * and eleven anchors put one in an `href`: nine on the ideation screens, and
 * two in the editor's ideation panel, which shows the stored prompt and the
 * stored cards beside the post they led to. The link components do not inspect
 * a scheme, and the installed React still renders a `javascript:` URL, so each
 * of those anchors has to refuse a URL that could run script.
 *
 * This file is about the render layer only. Every URL reaches its component
 * the way it does on the screen — as a prop, or for the editor panel as the
 * answer of its endpoint — so a check made when a URL is stored cannot make
 * these pass, and a value that was stored before any such check existed is
 * covered too.
 *
 * What an anchor "links to" is decided the way a browser decides it: each
 * `href` in the document is run through the URL parser, which discards the
 * leading whitespace and control characters a string comparison would miss.
 * The anchor under test must also have stopped being a link: its siblings
 * share the document, so the document alone could not say which one failed.
 *
 * Each anchor is also rendered with a web address first. Without that, a case
 * would pass just as well if its modal never opened.
 *
 * Six more elements load one of these URLs: the image or the video of a card
 * takes it in `src`. The same rule holds there. A URL that the allowlist does
 * not permit does not reach the element, and the card shows what it shows when
 * an image will not load.
 */

import apiFetch from '@wordpress/api-fetch';

import { render, screen, fireEvent } from './helpers/render-wp-component';

import ArticleCard from '../../src/admin/components/ideation/cards/ArticleCard';
import DocumentCard from '../../src/admin/components/ideation/cards/DocumentCard';
import ImageCard from '../../src/admin/components/ideation/cards/ImageCard';
import PromptPreviewModal from '../../src/admin/components/ideation/PromptPreviewModal';
import { IdeationPanel } from '../../src/editor/components/IdeationPanel';

// Only the editor panel fetches: it reads its links from the ideation endpoint.
jest.mock( '@wordpress/api-fetch', () => jest.fn() );

const WEB_URL = 'https://source.example.test/story';

const SCRIPT_URLS = [
	[ 'a javascript: URL', 'javascript:alert(1)' ],
	[ 'a javascript: URL behind a tab', '\tjavascript:alert(1)' ],
	[ 'a javascript: URL in mixed case', 'JaVaScRiPt:alert(1)' ],
	[ 'a data: URL', 'data:text/html,<script>alert(1)</script>' ],
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

/**
 * The same for the URLs that an element loads: every `src` in the document
 * that has one of those schemes.
 *
 * @return {string[]} The offending `src` values, as written.
 */
const scriptSources = () =>
	[ ...document.querySelectorAll( '[src]' ) ]
		.map( ( element ) => element.getAttribute( 'src' ) )
		.filter( ( src ) =>
			SCRIPT_SCHEMES.includes( new URL( src, document.baseURI ).protocol )
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

// A video file that the board cannot embed, so the modal plays it itself.
const video = {
	source_id: 'vid1',
	project_id: 7,
	title: 'Reservoir flyover',
	source_type: 'video',
	domain: 'video.example.test',
	url: 'https://video.example.test/flyover.mp4',
	image: 'https://video.example.test/poster.jpg',
};

const openVideo = ( overrides ) => {
	const { container } = render(
		<ImageCard card={ { ...video, ...overrides } } />
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

// What the ideation endpoint answers for a post that came out of a project.
const openPanel = async ( ideation ) => {
	apiFetch.mockResolvedValue( { project_id: 19, items: [], ...ideation } );
	render( <IdeationPanel postId={ 42 } /> );
	await screen.findByText( 'From Ideation' );
};

const panel = () => screen.getByText( 'From Ideation' );

/*
 * One entry per anchor. `open` renders the component with the URL in the field
 * the anchor reads, and opens the detail modal when the anchor is inside it.
 * `anchor` finds it the way a reader would, by role and name — an element with
 * no `href` is not a link, so a refused URL leaves nothing to find. `rendered`
 * is what proves the part of the screen that holds the anchor is there.
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
		urls: SCRIPT_URLS,
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
	{
		name: 'IdeationPanel: the article the project was started from',
		field: 'source.url',
		urls: SCRIPT_URLS,
		open: ( url ) =>
			openPanel( {
				source: {
					title: 'Reservoir authority publishes annual levels',
					url,
					domain: 'wire.example.test',
				},
			} ),
		anchor: () =>
			screen.queryByRole( 'link', {
				name: /Reservoir authority publishes annual levels/,
			} ),
		rendered: panel,
	},
	{
		name: 'IdeationPanel: a source somebody pinned or added',
		field: 'items[].url',
		urls: SCRIPT_URLS,
		open: ( url ) =>
			openPanel( {
				items: [
					{
						id: 'src1',
						title: 'Annual levels report',
						url,
						domain: 'authority.example.test',
						pinned: true,
					},
				],
			} ),
		anchor: () =>
			screen.queryByRole( 'link', { name: /Annual levels report/ } ),
		rendered: panel,
	},
];

describe.each( ANCHORS )(
	'$name ($field)',
	( { urls, open, anchor, rendered } ) => {
		it( 'links to a web address', async () => {
			await open( WEB_URL );

			expect( anchor() ).toHaveAttribute( 'href', WEB_URL );
		} );

		it.each( urls )( 'does not link to %s', async ( label, url ) => {
			await open( url );

			expect( rendered() ).toBeInTheDocument();
			expect( anchor() ).toBeNull();
			expect( scriptHrefs() ).toEqual( [] );
			expect( scriptSources() ).toEqual( [] );
		} );
	}
);

// The face of a card, without the detail modal: that is portaled elsewhere.
const face = ( sourceId ) => () =>
	document.querySelector( `[data-source-id="${ sourceId }"]` );

/*
 * One entry per element that loads a provider-supplied URL. `open` renders the
 * component with the URL in the field the element reads, and opens the detail
 * modal when the element is inside it. `region` is the part of the screen that
 * holds the element — the face of the card or the modal — because a card shows
 * its image in both, and the two share the document.
 */
const SOURCES = [
	{
		name: 'ArticleCard: the thumbnail on the card face',
		field: 'card.image',
		open: ( url ) =>
			render(
				<ArticleCard
					card={ { ...article, url: WEB_URL, image: url } }
				/>
			),
		region: face( article.source_id ),
	},
	{
		name: 'ArticleCard: the image in the modal',
		field: 'card.image',
		open: ( url ) => {
			render(
				<ArticleCard
					card={ { ...article, url: WEB_URL, image: url } }
				/>
			);
			fireEvent.click( screen.getByText( article.title ) );
		},
		region: dialog,
	},
	{
		name: 'ImageCard: the image on the card face',
		field: 'card.image',
		open: ( url ) =>
			render( <ImageCard card={ { ...image, image: url } } /> ),
		region: face( image.source_id ),
	},
	{
		name: 'ImageCard: the image in the modal',
		field: 'card.image',
		open: ( url ) => openImage( { image: url } ),
		region: dialog,
	},
	{
		name: 'ImageCard: the poster of a video on the card face',
		field: 'card.image',
		open: ( url ) =>
			render( <ImageCard card={ { ...video, image: url } } /> ),
		region: face( video.source_id ),
	},
	{
		name: 'ImageCard: a video file in the modal',
		field: 'card.url',
		open: ( url ) => openVideo( { url } ),
		region: dialog,
	},
];

describe.each( SOURCES )( '$name ($field)', ( { open, region } ) => {
	it( 'loads a web address', () => {
		open( WEB_URL );

		expect( region().querySelector( 'img, video' ) ).toHaveAttribute(
			'src',
			WEB_URL
		);
	} );

	it.each( SCRIPT_URLS )( 'does not load %s', ( label, url ) => {
		open( url );

		// The place is there, and it holds no image and no video: the card
		// shows what it shows when an image will not load.
		expect( region() ).toBeInTheDocument();
		expect( region().querySelector( 'img, video' ) ).toBeNull();
		expect( scriptSources() ).toEqual( [] );
	} );
} );

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
