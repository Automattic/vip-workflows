/**
 * Unit tests for what the sequence editor does with two structural edits that
 * arrive without a drag: a stage moved to another post status (the canvas's
 * context menu and the stage panel), and a stage added from the sequence panel.
 *
 * Moving a stage frees the checkpoint of the status it leaves, and does not
 * take the one in the status it joins — which stage holds that is the status's
 * own control. The one exception is a status no stage is in yet: nothing holds
 * that checkpoint, so the stage takes it, or the status would be left with no
 * way in and no control here to say otherwise.
 *
 * The canvas is stubbed: React Flow measures a viewport jsdom does not lay out
 * (`graph-canvas-menus.test.js` covers the canvas's half under real React
 * Flow). The shared stub records what the editor hands it — the stages and the
 * selection — and exposes the status callback so a test can call it the way
 * a menu item does.
 *
 * @package
 */

import { act, fireEvent, screen } from './helpers/render-wp-component';
import {
	canvas,
	renderSequenceEditor,
	resetCanvas,
	sequenceOptions,
	settle,
	storedSequence,
} from './helpers/sequence-editor';

jest.mock( '@wordpress/api-fetch' );

jest.mock(
	'../../src/admin/components/graph/GraphCanvas',
	() => require( './helpers/graph-canvas-stub' ).GraphCanvasStub
);

const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		color: '#C36EFF',
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'writing' } ],
	},
	{
		key: 'writing',
		label: 'Writing',
		color: '#3858E9',
		status: 'draft',
		region_entry: false,
		transitions: [ { to: 'review' } ],
	},
	{
		key: 'review',
		label: 'Review',
		color: '#008A20',
		status: 'pending',
		region_entry: true,
		transitions: [ { to: 'published' } ],
	},
	{
		key: 'published',
		label: 'Published',
		color: '#D63638',
		status: 'publish',
		region_entry: true,
		is_terminal: true,
		transitions: [],
	},
];

beforeEach( () => {
	resetCanvas();
	window.location.hash = '';
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const renderEditor = () =>
	renderSequenceEditor( {
		sequence: storedSequence( {
			id: 7,
			name: 'Editorial Review',
			config: {
				statuses: STAGES,
				post_types: [ 'post' ],
				settings: {},
				metadata_fields: [],
			},
		} ),
		options: sequenceOptions( { phase_transitions: [] } ),
	} );

const stage = ( key ) => canvas().stages.find( ( s ) => s.key === key );

async function setStageStatus( key, region ) {
	await act( async () => {
		canvas().onSetStageStatus( key, region );
	} );
}

describe( 'Moving a stage to another post status', () => {
	it( 'loads the stored stages onto the canvas', async () => {
		await renderEditor();

		expect( canvas().stages.map( ( s ) => s.key ) ).toEqual(
			STAGES.map( ( s ) => s.key )
		);
	} );

	it( 'joins a status other stages are in without taking its checkpoint', async () => {
		await renderEditor();

		await setStageStatus( 'writing', 'pending' );

		expect( stage( 'writing' ) ).toMatchObject( {
			status: 'pending',
			region_entry: false,
		} );
		expect( stage( 'review' ).region_entry ).toBe( true );
	} );

	it( 'frees the checkpoint of the status it leaves', async () => {
		await renderEditor();

		await setStageStatus( 'review', 'draft' );

		expect( stage( 'review' ) ).toMatchObject( {
			status: 'draft',
			region_entry: false,
		} );
		expect( stage( 'draft' ).region_entry ).toBe( true );
	} );

	it( 'takes the checkpoint of a status no stage is in yet', async () => {
		await renderEditor();

		await setStageStatus( 'writing', 'private' );

		expect( stage( 'writing' ) ).toMatchObject( {
			status: 'private',
			region_entry: true,
		} );
	} );

	it( 'changes nothing when the stage is already in that status', async () => {
		await renderEditor();
		const before = canvas().stages;

		await setStageStatus( 'writing', 'draft' );

		expect( canvas().stages ).toBe( before );
	} );
} );

describe( 'Adding a stage from the sequence panel', () => {
	it( 'adds a Draft stage and selects it', async () => {
		await renderEditor();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add stage' } ) );
		await settle();

		expect( canvas().stages ).toHaveLength( STAGES.length + 1 );
		const added = canvas().stages[ canvas().stages.length - 1 ];
		expect( added ).toMatchObject( {
			status: 'draft',
			region_entry: false,
			transitions: [],
		} );
		expect( canvas().selectedNodeKey ).toBe( added.key );
	} );
} );
