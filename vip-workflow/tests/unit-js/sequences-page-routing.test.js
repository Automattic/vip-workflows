/**
 * Unit tests for the Sequences page as a router.
 *
 * The page decides which editor is on screen and keys it by route, so a route
 * change tears the old editor down rather than handing the next sequence the
 * last one's state. Saving a NEW sequence used to break that: the editor moved
 * the address to `#/edit/{newId}` itself, with `replaceState` so nothing routed
 * — leaving the page still holding an editor keyed `new` while the address said
 * `edit/7`. Nothing was wrong on screen until the page re-rendered for some
 * unrelated reason (the shell re-renders on its own route transitions), and then
 * the very same editor resolved to a different key, remounted, and read the row
 * back over everything typed since the save.
 *
 * So the id comes back up to the page, and the page moves the address and
 * decides what that address now denotes. The bump button below is any
 * re-render the page did not ask for.
 *
 * The canvas is stubbed (React Flow measures a viewport jsdom does not lay out)
 * and so is the list (this is about routing, not about listing).
 *
 * @package
 */

import { useEffect, useState } from '@wordpress/element';

import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
} from './helpers/render-wp-component';

import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );

jest.mock( '../../src/admin/components/SequencesList', () => ( {
	SequencesList: function SequencesListStub() {
		return <div data-testid="list" />;
	},
} ) );

// The one gesture the canvas is needed for: a brand-new sequence starts with a
// single non-terminal stage, and the validator refuses to save until something
// ends the flow.
jest.mock(
	'../../src/admin/components/graph/GraphCanvas',
	() =>
		function GraphCanvasStub( { onConnectTransition, onClearSelection } ) {
			return (
				<div data-testid="canvas">
					<button
						onClick={ () =>
							onConnectTransition( 'draft', '__wf_end__', null )
						}
					>
						end the flow
					</button>
					<button onClick={ onClearSelection }>
						deselect everything
					</button>
				</div>
			);
		}
);

import Sequences from '../../src/admin/pages/Sequences';

const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		color: '#C36EFF',
		status: 'draft',
		region_entry: true,
		is_terminal: true,
		transitions: [],
	},
];

const storedSequence = ( id, name ) => ( {
	id,
	name,
	description: '',
	status: 'active',
	stages_missing_region: [],
	config: {
		statuses: STAGES,
		post_types: [ 'post' ],
		settings: {},
		metadata_fields: [],
	},
} );

const OPTIONS = {
	post_types: [ { value: 'post', label: 'Posts' } ],
	phase_transitions: [ { from: 'ideation', to: 'editorial' } ],
	required_phase_transitions: [ { from: 'ideation', to: 'editorial' } ],
};

/** Every request the page and its editor made, in order. */
let calls;
/** Every write, in order. */
let writes;

beforeEach( () => {
	calls = [];
	writes = [];
	window.location.hash = '';
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		calls.push( { path, method } );
		if ( path === '/vip-workflow/v1/sequences/options' ) {
			return Promise.resolve( OPTIONS );
		}
		if (
			path.startsWith( '/vip-workflow/v1/abilities' ) ||
			path === '/vip-workflow/v1/notifications/channels'
		) {
			return Promise.resolve( [] );
		}
		if ( method === 'POST' || method === 'PUT' ) {
			writes.push( { path, method, data } );
			return Promise.resolve( {
				...storedSequence( 7, data.name ),
				config: {
					...storedSequence( 7, data.name ).config,
					statuses: data.statuses,
					post_types: data.post_types,
				},
			} );
		}
		// A read of a stored row answers with the server's copy of the name,
		// which is how a remount makes itself visible.
		const id = parseInt( path.split( '/' ).pop(), 10 );
		return Promise.resolve( storedSequence( id, `Stored ${ id }` ) );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const saveButton = () =>
	screen.getByRole( 'button', { name: /^(Save|Saving…|Saved!)$/ } );
const nameField = () => screen.getByRole( 'textbox', { name: /^Name/ } );

/**
 * The page, under a host that re-renders it the way the shell does.
 *
 * The shell re-renders this page on every hash change AND on its own route
 * transition timer, neither of which the page controls — which is what turns a
 * stale route reading into a remount.
 *
 * @return {JSX.Element} Host.
 */
function Host() {
	const [ , bump ] = useState( 0 );

	useEffect( () => {
		const onHashChange = () => bump( ( n ) => n + 1 );
		window.addEventListener( 'hashchange', onHashChange );
		return () => window.removeEventListener( 'hashchange', onHashChange );
	}, [] );

	return (
		<>
			<button onClick={ () => bump( ( n ) => n + 1 ) }>
				re-render the page
			</button>
			<Sequences />
		</>
	);
}

/**
 * Render the page at a hash and wait for whatever it routes to to settle.
 *
 * @param {string} hash Starting address.
 * @return {Promise<void>} Resolves once the editor is up and its reads are in.
 */
async function renderPage( hash ) {
	window.location.hash = hash;
	render( <Host /> );
	await waitFor( () => expect( saveButton() ).toBeInTheDocument() );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
}

const reRender = async () => {
	fireEvent.click(
		screen.getByRole( 'button', { name: 're-render the page' } )
	);
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
};

describe( 'The sequence a new editor just created', () => {
	it( 'moves the address to the row that now exists', async () => {
		await renderPage( '#/new' );

		fireEvent.change( nameField(), { target: { value: 'Brand New' } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'end the flow' } )
		);
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].method ).toBe( 'POST' );
		// So a reload lands on the sequence rather than on a blank new one.
		expect( window.location.hash ).toBe( '#/edit/7' );
	} );

	it( 'stays the editor that created it, holding work typed since the save', async () => {
		await renderPage( '#/new' );

		fireEvent.change( nameField(), { target: { value: 'Brand New' } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'end the flow' } )
		);
		fireEvent.click( saveButton() );
		await waitFor( () => expect( writes ).toHaveLength( 1 ) );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'deselect everything' } )
		);
		fireEvent.change( nameField(), {
			target: { value: 'Renamed after saving' },
		} );

		// The re-render the page did not ask for.
		await reRender();

		expect( nameField() ).toHaveValue( 'Renamed after saving' );
		// Nothing re-read the row: a read here would be a remount, and the
		// server's copy would have replaced what was typed.
		expect(
			calls.filter(
				( call ) =>
					call.path === '/vip-workflow/v1/sequences/7' &&
					! call.method
			)
		).toHaveLength( 0 );
	} );

	it( 'still updates that row on the next save, rather than posting a second one', async () => {
		await renderPage( '#/new' );

		fireEvent.change( nameField(), { target: { value: 'Brand New' } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'end the flow' } )
		);
		fireEvent.click( saveButton() );
		await waitFor( () => expect( writes ).toHaveLength( 1 ) );

		await reRender();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'deselect everything' } )
		);
		fireEvent.change( nameField(), {
			target: { value: 'Brand New Again' },
		} );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 2 ) );
		expect( writes[ 1 ].method ).toBe( 'PUT' );
		expect( writes[ 1 ].path ).toBe( '/vip-workflow/v1/sequences/7' );
	} );

	it( 'gives a later navigation to another sequence its own editor', async () => {
		await renderPage( '#/new' );

		fireEvent.change( nameField(), { target: { value: 'Brand New' } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'end the flow' } )
		);
		fireEvent.click( saveButton() );
		await waitFor( () => expect( writes ).toHaveLength( 1 ) );

		// A real navigation, not the address the save moved to.
		await act( async () => {
			window.location.hash = '#/edit/9';
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		} );

		await waitFor( () => expect( nameField() ).toHaveValue( 'Stored 9' ) );
	} );

	it( 'reads the row back when the author returns to it', async () => {
		await renderPage( '#/new' );

		fireEvent.change( nameField(), { target: { value: 'Brand New' } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'end the flow' } )
		);
		fireEvent.click( saveButton() );
		await waitFor( () => expect( writes ).toHaveLength( 1 ) );

		// Out to the list, then back in by the same address the save left.
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		await screen.findByTestId( 'list' );

		await act( async () => {
			window.location.hash = '#/edit/7';
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		} );

		// The editor that created it is long gone, so this one loads the row —
		// rather than the blank new sequence that address once denoted.
		await waitFor( () => expect( nameField() ).toHaveValue( 'Stored 7' ) );
	} );
} );
