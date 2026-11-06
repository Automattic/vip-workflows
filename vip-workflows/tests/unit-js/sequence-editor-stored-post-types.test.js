/**
 * A stored post type the options list does not offer stays on the sequence.
 *
 * The editor used to filter a sequence's stored post types against the options
 * list on load, and save what was left. A type that list stopped offering —
 * its plugin switched off, or registered without an editing screen — was
 * therefore removed by the next save, whatever that save was about, under an
 * error saying it no longer existed. The server keeps such a type on write for
 * the same reason the editor now does: removing it is a deliberate uncheck.
 *
 * @package
 */

import {
	fireEvent,
	render,
	screen,
	waitFor,
} from './helpers/render-wp-component';

import {
	nameField,
	saveButton,
	sequenceOptions,
	serveSequenceEditor,
	settle,
} from './helpers/sequence-editor';

jest.mock( '@wordpress/api-fetch' );
jest.mock(
	'../../src/admin/components/graph/GraphCanvas',
	() => require( './helpers/graph-canvas-stub' ).GraphCanvasStub
);

import SequenceGraphEditor from '../../src/admin/components/graph/SequenceGraphEditor';

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

const stored = {
	id: 7,
	name: 'Editorial Review',
	description: '',
	status: 'active',
	stages_missing_region: [],
	config: {
		statuses: STAGES,
		post_types: [ 'post', 'vip_ideation' ],
		settings: {},
		metadata_fields: [],
	},
};

let writes;

beforeEach( () => {
	( { writes } = serveSequenceEditor( {
		sequence: stored,
		options: sequenceOptions( {
			post_types: [
				{ value: 'post', label: 'Posts' },
				{ value: 'page', label: 'Pages' },
			],
		} ),
		write: ( { data } ) => ( {
			...stored,
			name: data.name,
			config: { ...stored.config, post_types: data.post_types },
		} ),
	} ) );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

async function renderEditor() {
	render( <SequenceGraphEditor sequenceId={ 7 } onCancel={ () => {} } /> );
	await waitFor( () => expect( saveButton() ).toBeInTheDocument() );
	await settle();
}

const unavailable = () =>
	screen.getByRole( 'checkbox', {
		name: 'vip_ideation (not available for new workflows)',
	} );

describe( 'A stored post type the options list does not offer', () => {
	it( 'is listed as attached and not available, with no error', async () => {
		await renderEditor();

		expect( unavailable() ).toBeChecked();
		expect(
			screen.queryByText( /no longer exist/ )
		).not.toBeInTheDocument();
	} );

	it( 'survives a save that was about something else', async () => {
		await renderEditor();

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].data.post_types ).toEqual( [
			'post',
			'vip_ideation',
		] );
	} );

	it( 'is removed only when unchecked on purpose', async () => {
		await renderEditor();

		fireEvent.click( unavailable() );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].data.post_types ).toEqual( [ 'post' ] );
	} );
} );

describe( 'A new sequence while the options list is loading', () => {
	it( 'shows the loading spinner, not its default type as unavailable', async () => {
		// Hold the options read open: the window the inspector is on screen
		// with `post` selected and no list to check it against.
		serveSequenceEditor( {
			sequence: stored,
			options: () => new Promise( () => {} ),
		} );

		render( <SequenceGraphEditor onCancel={ () => {} } /> );
		await settle();

		expect(
			screen.queryByText( /not available for new workflows/ )
		).not.toBeInTheDocument();

		const section = screen
			.getByText( 'Post types' )
			.closest( 'section, div' );
		expect(
			section.parentElement.querySelector( '.components-spinner' )
		).not.toBeNull();
	} );
} );
