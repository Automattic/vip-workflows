/**
 * Unit tests for a status group emptied by moving its last stage out.
 *
 * A group is drawn while a stage lives in it, so moving the only stage out of
 * one used to take the group with it — off the canvas, out of the Post status
 * picker, out of the stage context menu — and moving the stage back meant
 * adding the status again by hand first. The editor now keeps an emptied group
 * drawn, the way it keeps one the author added, until it is removed or the
 * sequence is saved.
 *
 * The canvas is stubbed: React Flow measures a viewport jsdom does not lay out.
 * The stub prints the groups it is asked to draw and exposes the canvas's own
 * gestures — a drop into a band, the context menu's status move, and removing a
 * group — as buttons.
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

import { regionLeftEmpty } from '../../src/admin/components/graph/regions';

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
	render( <SequenceGraphEditor sequenceId={ 7 } onCancel={ jest.fn() } /> );
	await waitFor( () => expect( saveButton() ).toBeInTheDocument() );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
}

describe( 'regionLeftEmpty', () => {
	it( 'names the region a move takes the last stage out of', () => {
		expect( regionLeftEmpty( STAGES, 'review', 'publish' ) ).toBe(
			'pending'
		);
	} );

	it( 'is null while another stage remains in the region', () => {
		const stages = [
			...STAGES,
			{ key: 'legal', label: 'Legal', status: 'pending' },
		];
		expect( regionLeftEmpty( stages, 'review', 'publish' ) ).toBeNull();
	} );

	it( 'is null for a move into the region the stage is already in', () => {
		expect( regionLeftEmpty( STAGES, 'review', 'pending' ) ).toBeNull();
	} );

	it( 'is null for a stage that does not exist', () => {
		expect( regionLeftEmpty( STAGES, 'missing', 'publish' ) ).toBeNull();
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

	it( 'still removes the empty group when asked to', async () => {
		await renderEditor();
		click( 'menu: review to published' );
		expect( drawn() ).toContain( 'pending' );

		click( 'remove pending review' );

		expect( drawn() ).toEqual( [ 'draft', 'publish' ] );
	} );
} );
