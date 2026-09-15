/**
 * Unit tests for GraphCanvas under edits made from outside it.
 *
 * The sequence panel's Add stage, the stage panel's Post status and the context
 * menu's Delete stage change the structure without a gesture on the canvas, so
 * nothing on the canvas has placed or frozen anything first. The structural
 * freeze has to cope with that on its own: a stage moved out of the only band
 * that held it takes the band with it, and a stage added from the panel has no
 * spot of its own.
 *
 * Also the keyboard: Enter on a focused card is how an author without a pointer
 * opens its panel, and it must not be undone by the next change of selection.
 *
 * Real React Flow under jsdom. Nodes render (edges do not, lacking measured
 * geometry), and their positions are read back off the transform React Flow
 * writes.
 *
 * @package
 */

import { render, act, fireEvent, screen } from './helpers/render-wp-component';
import { Component, useState, useMemo } from '@wordpress/element';

import GraphCanvas from '../../src/admin/components/graph/GraphCanvas';
import {
	addStage,
	setStageStatus,
	removeStage,
} from '../../src/admin/components/graph/graph-model';
import { visibleRegions } from '../../src/admin/components/graph/regions';

if ( ! global.structuredClone ) {
	global.structuredClone = ( value ) => JSON.parse( JSON.stringify( value ) );
}

class Boundary extends Component {
	constructor( props ) {
		super( props );
		this.state = { error: null };
	}

	static getDerivedStateFromError( error ) {
		return { error };
	}

	render() {
		return this.state.error ? (
			<p data-testid="crash">{ this.state.error.message }</p>
		) : (
			this.props.children
		);
	}
}

const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'writing' } ],
	},
	{
		key: 'writing',
		label: 'Writing',
		status: 'draft',
		region_entry: false,
		transitions: [ { to: 'publish' } ],
	},
	{
		key: 'publish',
		label: 'Published',
		status: 'publish',
		region_entry: true,
		is_terminal: true,
		transitions: [],
	},
];

// The editor's half, reduced to the state GraphCanvas reads and the buttons
// standing in for the panels.
function Editor() {
	const [ stages, setStages ] = useState( STAGES );
	const [ selectedKey, setSelectedKey ] = useState( null );
	const regions = useMemo( () => visibleRegions( stages, [] ), [ stages ] );
	const noop = () => {};

	return (
		<>
			<button
				onClick={ () =>
					setStages( ( current ) => addStage( current ).stages )
				}
			>
				Add stage
			</button>
			<button
				onClick={ () =>
					setStages( ( current ) =>
						setStageStatus( current, 'publish', 'draft' )
					)
				}
			>
				Move Published to Draft
			</button>
			<button
				onClick={ () =>
					setStages( ( current ) =>
						removeStage( current, 'publish' )
					)
				}
			>
				Delete Published
			</button>
			<button onClick={ () => setSelectedKey( null ) }>Clear</button>
			<output data-testid="selected">{ String( selectedKey ) }</output>
			<Boundary>
				<GraphCanvas
					stages={ stages }
					isPhase={ false }
					warnings={ {} }
					regions={ regions }
					selectedNodeKey={ selectedKey }
					selectedEdgeId={ null }
					selectedRegion={ null }
					onConnectTransition={ noop }
					onSelectNode={ setSelectedKey }
					onSelectEdge={ noop }
					onSelectRegion={ noop }
					onClearSelection={ () => setSelectedKey( null ) }
					onDeleteNode={ noop }
					onDeleteEdge={ noop }
					onPlaceStage={ noop }
					onSetStageStatus={ noop }
					isValidConnection={ () => true }
				/>
			</Boundary>
		</>
	);
}

// React Flow measures and lays out across a few ticks.
async function settle() {
	for ( let i = 0; i < 5; i++ ) {
		// eslint-disable-next-line no-await-in-loop
		await act( async () => {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		} );
	}
}

async function press( name ) {
	fireEvent.click( screen.getByRole( 'button', { name } ) );
	await settle();
}

describe( 'GraphCanvas and structure changed from outside it', () => {
	it( 'survives a status change that empties a band', async () => {
		render( <Editor /> );
		await settle();

		await press( 'Move Published to Draft' );

		expect( screen.queryByTestId( 'crash' ) ).toBeNull();
	} );

	it( 'survives a delete that empties a band', async () => {
		render( <Editor /> );
		await settle();

		await press( 'Delete Published' );

		expect( screen.queryByTestId( 'crash' ) ).toBeNull();
	} );

	it( 'gives each added stage a spot of its own', async () => {
		const { container } = render( <Editor /> );
		await settle();

		await press( 'Add stage' );
		await press( 'Add stage' );

		const spots = Array.from(
			container.querySelectorAll( '.react-flow__node-stage' ),
			( node ) => node.style.transform
		);
		expect( spots ).toHaveLength( 5 );
		expect( new Set( spots ).size ).toBe( spots.length );
	} );
} );

describe( 'GraphCanvas keyboard selection', () => {
	it( 'selects a focused stage on Enter, and a clear afterwards sticks', async () => {
		const { container } = render( <Editor /> );
		await settle();

		const card = container.querySelector(
			'.react-flow__node[data-id="writing"]'
		);
		card.focus();
		fireEvent.keyDown( card, { key: 'Enter' } );
		await settle();
		expect( screen.getByTestId( 'selected' ) ).toHaveTextContent(
			'writing'
		);

		// React Flow's store lags the editor's selection by a render; reading
		// selection back out of it re-selected the stage just cleared.
		await press( 'Clear' );
		expect( screen.getByTestId( 'selected' ) ).toHaveTextContent( 'null' );
	} );
} );
