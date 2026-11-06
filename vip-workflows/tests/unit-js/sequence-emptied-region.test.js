/**
 * Unit tests for a status group emptied by moving or deleting its last stage.
 *
 * A group is drawn while a stage lives in it, so taking the only stage out of
 * one used to take the group with it — off the canvas, out of the Post status
 * picker, out of the stage context menu — and moving the stage back meant
 * adding the status again by hand first. The editor now keeps drawn every
 * group the stored stages use, until it is removed or the sequence is saved,
 * and keeps a group the author added for the rest of the session.
 *
 * The canvas is stubbed: React Flow measures a viewport jsdom does not lay out.
 * The stub prints the groups it is asked to draw and exposes the canvas's own
 * gestures — a drop into a band, the context menu's status move, deleting a
 * stage, selecting, adding and removing a group — as buttons.
 *
 * @package
 */

import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from './helpers/render-wp-component';

import apiFetch from '@wordpress/api-fetch';

import {
	keptRegions,
	prunedRemovals,
} from '../../src/admin/components/graph/regions';

jest.mock( '@wordpress/api-fetch' );

jest.mock(
	'../../src/admin/components/graph/GraphCanvas',
	() =>
		function GraphCanvasStub( {
			regions,
			onSelectNode,
			onPlaceStage,
			onSetStageStatus,
			onRemoveRegion,
			onAddRegion,
			onSelectRegion,
			onDeleteNode,
		} ) {
			return (
				<div data-testid="canvas">
					<output data-testid="regions">
						{ regions.join( ',' ) }
					</output>
					<button onClick={ () => onSelectNode( 'review' ) }>
						select review
					</button>
					<button
						onClick={ () =>
							onSetStageStatus( 'review', 'publish' )
						}
					>
						menu: review to published
					</button>
					<button
						onClick={ () =>
							onSetStageStatus( 'review', 'pending' )
						}
					>
						menu: review to pending review
					</button>
					<button
						onClick={ () =>
							onPlaceStage( 'review', 'publish', false )
						}
					>
						drop review in published
					</button>
					<button onClick={ () => onRemoveRegion( 'pending' ) }>
						remove pending review
					</button>
					<button onClick={ () => onSelectRegion( 'pending' ) }>
						select pending review
					</button>
					<button onClick={ () => onDeleteNode( 'review' ) }>
						delete review
					</button>
					<button onClick={ () => onAddRegion() }>
						add a status
					</button>
				</div>
			);
		}
);

import SequenceGraphEditor from '../../src/admin/components/graph/SequenceGraphEditor';

// Draft → Review → Published, one stage per group, each holding its group's
// checkpoint: the validator is happy with it as loaded.
const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		color: '#C36EFF',
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'review', label: 'Submit' } ],
	},
	{
		key: 'review',
		label: 'Review',
		color: '#3858E9',
		status: 'pending',
		region_entry: true,
		transitions: [ { to: 'published', label: 'Approve' } ],
	},
	{
		key: 'published',
		label: 'Published',
		color: '#00A32A',
		status: 'publish',
		region_entry: true,
		is_terminal: true,
		transitions: [],
	},
];

const sequence = ( statuses = STAGES ) => ( {
	id: 7,
	name: 'Editorial',
	description: '',
	status: 'active',
	stages_missing_region: [],
	config: {
		statuses,
		post_types: [ 'post' ],
		settings: {},
		metadata_fields: [],
	},
} );

const OPTIONS = {
	post_types: [ { value: 'post', label: 'Posts' } ],
	phase_transitions: [],
	required_phase_transitions: [],
};

beforeEach( () => {
	window.location.hash = '';
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( path === '/vip-workflows/v1/sequences/options' ) {
			return Promise.resolve( OPTIONS );
		}
		if (
			path.startsWith( '/vip-workflows/v1/abilities' ) ||
			path === '/vip-workflows/v1/notifications/channels'
		) {
			return Promise.resolve( [] );
		}
		if ( method === 'POST' || method === 'PUT' ) {
			return Promise.resolve( sequence( data.statuses ) );
		}
		return Promise.resolve( sequence() );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const saveButton = () =>
	screen.getByRole( 'button', { name: /^(Save|Saving…|Saved!)$/ } );
const drawn = () => screen.getByTestId( 'regions' ).textContent.split( ',' );
const click = ( name ) =>
	fireEvent.click( screen.getByRole( 'button', { name } ) );
const postStatusOptions = () =>
	within( screen.getByRole( 'combobox', { name: 'Post status' } ) )
		.getAllByRole( 'option' )
		.map( ( option ) => option.value );

async function renderEditor() {
	const view = render(
		<SequenceGraphEditor sequenceId={ 7 } onCancel={ jest.fn() } />
	);
	await waitFor( () => expect( saveButton() ).toBeInTheDocument() );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
	return view;
}

describe( 'keptRegions', () => {
	it( 'keeps every region the stored stages use', () => {
		expect( keptRegions( STAGES ).sort() ).toEqual( [
			'draft',
			'pending',
			'publish',
		] );
	} );

	it( 'adds the regions the author added', () => {
		expect( keptRegions( STAGES, [ 'private' ] ) ).toContain( 'private' );
	} );

	it( 'leaves out the regions the author removed', () => {
		expect( keptRegions( STAGES, [], [ 'pending' ] ) ).not.toContain(
			'pending'
		);
	} );

	it( 'keeps no status the server would refuse', () => {
		const stages = [ { key: 'odd', label: 'Odd', status: 'future' } ];
		expect( keptRegions( stages ) ).toEqual( [] );
	} );
} );

describe( 'prunedRemovals', () => {
	it( 'drops a removal the stored stages no longer need', () => {
		expect( prunedRemovals( [ 'private' ], [], STAGES ) ).toEqual( [] );
	} );

	it( 'keeps a removal made while the write was out', () => {
		expect( prunedRemovals( [ 'pending' ], [], STAGES ) ).toEqual( [
			'pending',
		] );
	} );

	it( 'drops a removal undone by refilling the group before the save', () => {
		expect(
			prunedRemovals( [ 'pending' ], [ 'pending' ], STAGES )
		).toEqual( [] );
	} );
} );

describe( 'moving the only stage out of a status group', () => {
	it( 'keeps the group drawn and in the Post status picker', async () => {
		await renderEditor();
		click( 'select review' );
		expect( drawn() ).toEqual( [ 'draft', 'pending', 'publish' ] );

		fireEvent.change(
			screen.getByRole( 'combobox', { name: 'Post status' } ),
			{ target: { value: 'publish' } }
		);

		expect( drawn() ).toEqual( [ 'draft', 'pending', 'publish' ] );
		expect( postStatusOptions() ).toContain( 'pending' );
	} );

	it( 'keeps the group drawn after a context-menu move, and moves back in one step', async () => {
		await renderEditor();
		click( 'select review' );

		click( 'menu: review to published' );
		expect( drawn() ).toContain( 'pending' );
		expect(
			screen.getByRole( 'combobox', { name: 'Post status' } )
		).toHaveValue( 'publish' );

		click( 'menu: review to pending review' );
		expect( drawn() ).toEqual( [ 'draft', 'pending', 'publish' ] );
		expect(
			screen.getByRole( 'combobox', { name: 'Post status' } )
		).toHaveValue( 'pending' );
	} );

	it( 'keeps the group drawn after a drag into another band', async () => {
		await renderEditor();
		click( 'drop review in published' );
		expect( drawn() ).toContain( 'pending' );
	} );

	it( 'does not block Save on the empty group', async () => {
		await renderEditor();
		click( 'menu: review to published' );

		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
		expect(
			screen.queryByText( /status group has no entry checkpoint/ )
		).toBeNull();
	} );

	it( 'stops drawing the empty group once the sequence is saved', async () => {
		await renderEditor();
		click( 'menu: review to published' );
		expect( drawn() ).toContain( 'pending' );

		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
		expect( drawn() ).toEqual( [ 'draft', 'publish' ] );
	} );

	it( 'keeps a group emptied while the save was in flight', async () => {
		await renderEditor();
		let respond;
		const defaultImpl = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( request ) =>
			request.method === 'PUT'
				? new Promise( ( resolve ) => {
						respond = () =>
							resolve( sequence( request.data.statuses ) );
				  } )
				: defaultImpl( request )
		);

		// Save needs unsaved work, and none of it may touch a status group.
		fireEvent.change( screen.getByRole( 'textbox', { name: /^Name/ } ), {
			target: { value: 'Editorial, renamed' },
		} );
		fireEvent.click( saveButton() );
		await waitFor( () => expect( respond ).toBeDefined() );

		click( 'menu: review to published' );
		expect( drawn() ).toContain( 'pending' );

		await act( async () => {
			respond();
		} );
		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
		expect( drawn() ).toEqual( [ 'draft', 'pending', 'publish' ] );
	} );

	it( 'keeps a group emptied again while the save was in flight', async () => {
		await renderEditor();

		// Emptied, then refilled: the group is already on the kept list when
		// the save goes out.
		click( 'menu: review to published' );
		click( 'menu: review to pending review' );

		let respond;
		const defaultImpl = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( request ) =>
			request.method === 'PUT'
				? new Promise( ( resolve ) => {
						respond = () =>
							resolve( sequence( request.data.statuses ) );
				  } )
				: defaultImpl( request )
		);

		fireEvent.change( screen.getByRole( 'textbox', { name: /^Name/ } ), {
			target: { value: 'Editorial, renamed' },
		} );
		fireEvent.click( saveButton() );
		await waitFor( () => expect( respond ).toBeDefined() );

		click( 'menu: review to published' );
		expect( drawn() ).toContain( 'pending' );

		await act( async () => {
			respond();
		} );
		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
		expect( drawn() ).toEqual( [ 'draft', 'pending', 'publish' ] );
	} );

	it( 'still removes the empty group when asked to', async () => {
		await renderEditor();
		click( 'menu: review to published' );
		expect( drawn() ).toContain( 'pending' );

		click( 'remove pending review' );

		expect( drawn() ).toEqual( [ 'draft', 'publish' ] );
	} );

	it( 'closes the panel of a selected group a save stops drawing', async () => {
		await renderEditor();
		click( 'menu: review to published' );
		click( 'select pending review' );
		expect(
			screen.getByRole( 'button', { name: 'Remove this status' } )
		).toBeInTheDocument();

		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
		expect( drawn() ).toEqual( [ 'draft', 'publish' ] );
		expect(
			screen.queryByRole( 'button', { name: 'Remove this status' } )
		).toBeNull();
	} );
} );

describe( 'deleting the only stage in a status group', () => {
	it( 'keeps the group drawn until the sequence is saved', async () => {
		await renderEditor();
		click( 'delete review' );

		expect( drawn() ).toEqual( [ 'draft', 'pending', 'publish' ] );

		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
		expect( drawn() ).toEqual( [ 'draft', 'publish' ] );
	} );

	it( 'treats a group emptied and refilled the same as one never emptied', async () => {
		const first = await renderEditor();
		click( 'menu: review to published' );
		click( 'menu: review to pending review' );
		click( 'delete review' );
		const refilled = drawn();

		first.unmount();
		await renderEditor();
		click( 'delete review' );

		expect( refilled ).toEqual( drawn() );
		expect( refilled ).toEqual( [ 'draft', 'pending', 'publish' ] );
	} );
} );

describe( 'a status group the author added', () => {
	it( 'stays drawn, still empty, after a save', async () => {
		await renderEditor();
		// Save needs unsaved work; the name field is in the panel that adding
		// a group replaces, so it is edited first.
		fireEvent.change( screen.getByRole( 'textbox', { name: /^Name/ } ), {
			target: { value: 'Editorial, renamed' },
		} );
		click( 'add a status' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add status' } ) );
		expect( drawn() ).toEqual( [
			'draft',
			'pending',
			'private',
			'publish',
		] );

		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
		expect( drawn() ).toEqual( [
			'draft',
			'pending',
			'private',
			'publish',
		] );
	} );

	it( 'is kept by a save that clears a group emptied before it', async () => {
		await renderEditor();
		click( 'menu: review to published' );

		let respond;
		const defaultImpl = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( request ) =>
			request.method === 'PUT'
				? new Promise( ( resolve ) => {
						respond = () =>
							resolve( sequence( request.data.statuses ) );
				  } )
				: defaultImpl( request )
		);
		fireEvent.click( saveButton() );
		await waitFor( () => expect( respond ).toBeDefined() );

		click( 'add a status' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add status' } ) );

		await act( async () => {
			respond();
		} );
		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
		expect( drawn() ).toEqual( [ 'draft', 'private', 'publish' ] );
	} );
} );
