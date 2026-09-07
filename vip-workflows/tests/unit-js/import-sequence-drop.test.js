/**
 * Import sequence — the drop path.
 *
 * The modal used to be click-to-browse only: a file dragged onto it landed on
 * the page behind and the browser navigated away from wp-admin to render it.
 * A `<DropZone>` now covers the dialog body, and both ways in hand the file to
 * one reader — so what a drop does is fixed to what browsing already did,
 * rather than being a second, drifting import.
 *
 * That is what these hold still: the drop target is the body rather than the
 * box drawn inside it, so releasing a file beside the box cannot fall through
 * to the browser; a dropped file is parsed, de-duplicated against the stored
 * sequences and posted to the same endpoint with the same body; a file that is
 * not JSON says exactly what a browsed one says and leaves nothing of an
 * earlier file staged behind it; a file the reader cannot open at all says so
 * rather than changing nothing; and the browse control still works.
 *
 * @package
 */

import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { createReduxStore, register } from '@wordpress/data';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
// The package's untranspiled ESM cannot be required here, and the list only
// needs the store's key to dispatch its export-failure notice.
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/dataviews/wp', () => require( '@wordpress/dataviews' ) );

// eslint-disable-next-line import/first
import { SequencesList } from '../../src/admin/components/SequencesList';

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = [] ) => state,
		actions: {
			createErrorNotice: () => ( { type: 'CREATE_ERROR_NOTICE' } ),
		},
	} )
);

const DROP_HINT = '…or drop a sequence JSON file here.';

// One stored sequence, so a file carrying the same name has something to
// collide with and the offered name has to move off it.
const STORED = [
	{
		id: 1,
		name: 'Editorial',
		description: '',
		status: 'active',
		type: 'workflow',
		post_types: [ 'post' ],
		config: {},
	},
];

const SEQUENCE = { name: 'Editorial', type: 'workflow', statuses: [] };

/** Every import request, in order. */
let imports;

beforeEach( () => {
	imports = [];
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( path === '/wp/v2/types' ) {
			return Promise.resolve( { post: {} } );
		}
		if ( path === '/vip-workflows/v1/sequences' ) {
			return Promise.resolve( STORED );
		}
		if ( path === '/vip-workflows/v1/sequences/import' ) {
			imports.push( { method, data } );
			return Promise.resolve( { id: 2 } );
		}
		throw new Error( `unexpected request: ${ path }` );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const jsonFile = ( contents, name ) =>
	new File( [ contents ], name, { type: 'application/json' } );

/**
 * Open the import modal.
 *
 * @return {Promise<HTMLElement>} The box drawn around the browse control.
 */
async function openImportModal() {
	render( <SequencesList /> );
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Import sequence' } )
	);

	// Located from the hint a reader sees, so the box under test is the one
	// the copy points at rather than whichever element carries the class.
	return screen
		.getByText( DROP_HINT )
		.closest( '.vip-workflows-import-modal__drop-target' );
}

/**
 * Release a file over the modal's drop zone.
 *
 * @param {File} file The file dropped.
 */
function dropOn( file ) {
	fireEvent.drop(
		document.querySelector(
			'.components-modal__children-container > .components-drop-zone'
		),
		{
			dataTransfer: { files: [ file ], items: [], getData: () => '' },
		}
	);
}

/**
 * Release a file over the modal header's drop zone.
 *
 * @param {File} file The file dropped.
 */
function dropOnHeader( file ) {
	fireEvent.drop(
		document.querySelector(
			'.components-modal__header .components-drop-zone'
		),
		{
			dataTransfer: { files: [ file ], items: [], getData: () => '' },
		}
	);
}

// Scoped to the modal throughout: a <Notice> also speaks its message into the
// page's assertive a11y region, and the page behind carries its own Import
// sequence button, so both are on screen twice.
const modal = () => within( screen.getByRole( 'dialog' ) );

const nameField = () =>
	screen.queryByRole( 'textbox', { name: /Sequence Name/ } );

describe( 'A sequence file dropped on the import modal', () => {
	it( 'is taken anywhere in the dialog body, not only over the box', async () => {
		const box = await openImportModal();
		const zone = document.querySelector(
			'.components-modal__children-container > .components-drop-zone'
		);

		// The zone is an overlay filling its parent, so the parent is the area
		// that accepts a drop. It has to be the element holding the whole
		// body — a file released beside the box would otherwise fall through
		// to the browser, which navigates the tab away to render the JSON.
		expect( zone.parentElement ).toContainElement( box );
		expect( box.querySelector( '.components-drop-zone' ) ).toBeNull();

		// Including the footer, which only exists once a file is staged.
		dropOn( jsonFile( JSON.stringify( SEQUENCE ), 'editorial.json' ) );
		await waitFor( () => expect( nameField() ).toBeInTheDocument() );
		expect( zone.parentElement ).toContainElement(
			modal().getByRole( 'button', { name: 'Import sequence' } )
		);
	} );

	it( 'is read, named off the stored sequences and imported', async () => {
		await openImportModal();

		dropOn( jsonFile( JSON.stringify( SEQUENCE ), 'editorial.json' ) );

		// The stored sequence already answers to "Editorial".
		await waitFor( () =>
			expect( nameField() ).toHaveValue( 'Editorial 2' )
		);
		expect(
			document.querySelector(
				'.vip-workflows-import-modal__type-preview'
			)
		).toHaveTextContent( 'workflow' );

		fireEvent.click(
			modal().getByRole( 'button', { name: 'Import sequence' } )
		);

		await waitFor( () => expect( imports ).toHaveLength( 1 ) );
		expect( imports[ 0 ] ).toEqual( {
			method: 'POST',
			data: { sequence_json: SEQUENCE, name: 'Editorial 2' },
		} );
	} );

	it( 'is also taken over the title bar', async () => {
		await openImportModal();

		dropOnHeader(
			jsonFile(
				JSON.stringify( { ...SEQUENCE, name: 'Newsroom' } ),
				'newsroom.json'
			)
		);

		await waitFor( () => expect( nameField() ).toHaveValue( 'Newsroom' ) );
	} );

	it( 'fails on the message a browsed file of the same kind fails on', async () => {
		await openImportModal();

		dropOn(
			new File( [ 'notes, not a sequence' ], 'notes.txt', {
				type: 'text/plain',
			} )
		);

		expect(
			await modal().findByText( 'Invalid JSON file.' )
		).toBeInTheDocument();
		// Nothing was staged, so there is nothing to name or import.
		expect( nameField() ).not.toBeInTheDocument();
		expect( imports ).toHaveLength( 0 );
	} );

	it( 'clears the file staged before it when it does not parse', async () => {
		await openImportModal();

		dropOn( jsonFile( JSON.stringify( SEQUENCE ), 'editorial.json' ) );
		await waitFor( () =>
			expect( nameField() ).toHaveValue( 'Editorial 2' )
		);

		dropOn(
			new File( [ 'notes, not a sequence' ], 'notes.txt', {
				type: 'text/plain',
			} )
		);

		expect(
			await modal().findByText( 'Invalid JSON file.' )
		).toBeInTheDocument();
		// The rejected file replaces the one staged before it, so the modal
		// cannot go on offering to import a file the notice says was refused.
		await waitFor( () => expect( nameField() ).not.toBeInTheDocument() );
		expect(
			modal().queryByRole( 'button', { name: 'Import sequence' } )
		).not.toBeInTheDocument();
		expect( imports ).toHaveLength( 0 );
	} );

	it( 'says so when the reader cannot open it at all', async () => {
		await openImportModal();

		// A folder dragged from Finder arrives as a file the reader cannot
		// open: `error` fires instead of `load`. jsdom has no such file, so
		// the reader itself stands in for one.
		const RealFileReader = global.FileReader;
		global.FileReader = class {
			readAsText() {
				this.onerror();
			}
		};

		try {
			dropOn( jsonFile( '{}', 'a-folder' ) );
		} finally {
			global.FileReader = RealFileReader;
		}

		expect(
			await modal().findByText( 'That file could not be read.' )
		).toBeInTheDocument();
		expect( nameField() ).not.toBeInTheDocument();
		expect( imports ).toHaveLength( 0 );
	} );
} );

describe( 'The browse control', () => {
	it( 'still sits inside the box and still imports', async () => {
		const box = await openImportModal();
		const browse = box.querySelector( '#sequence-file-upload' );

		expect( browse ).toBeInTheDocument();

		fireEvent.change( browse, {
			target: {
				files: [
					jsonFile(
						JSON.stringify( { ...SEQUENCE, name: 'Newsroom' } ),
						'newsroom.json'
					),
				],
			},
		} );

		// Free name: nothing stored collides, so it is offered as it stands.
		await waitFor( () => expect( nameField() ).toHaveValue( 'Newsroom' ) );
	} );
} );
