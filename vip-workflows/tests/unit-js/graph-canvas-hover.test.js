/**
 * Unit tests for the sequence canvas's hover state across a zoom or pan.
 *
 * A zoom or pan slides the canvas out from under a stationary pointer, and no
 * mouse event says so: the stage or edge that was under it is simply no longer
 * there. Hover that was set from `mouseenter` has to be dropped when the move
 * starts, or the transition pill stays up (and clickable) over whatever now
 * sits under it, and the line keeps its hover tone.
 *
 * Real React Flow under jsdom, with its `ReactFlow` component wrapped only to
 * read back the props `GraphCanvas` hands it. Edges do not render here (they
 * lack measured geometry), so hover is driven through the same handlers React
 * Flow would call and read off the `edges` prop it is given.
 *
 * @package
 */

import { render, act, waitFor } from './helpers/render-wp-component';

import GraphCanvas from '../../src/admin/components/graph/GraphCanvas';
import { visibleRegions } from '../../src/admin/components/graph/regions';

/** The props of the most recent `ReactFlow` render. */
let mockFlowProps = null;

jest.mock( '@xyflow/react', () => {
	const actual = jest.requireActual( '@xyflow/react' );
	return {
		...actual,
		ReactFlow: ( props ) => {
			mockFlowProps = props;
			return <actual.ReactFlow { ...props } />;
		},
	};
} );

if ( ! global.structuredClone ) {
	global.structuredClone = ( value ) => JSON.parse( JSON.stringify( value ) );
}

const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
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

function renderCanvas() {
	const noop = () => {};
	return render(
		<GraphCanvas
			stages={ STAGES }
			isPhase={ false }
			warnings={ {} }
			regions={ visibleRegions( STAGES, [] ) }
			selectedNodeKey={ null }
			selectedEdgeId={ null }
			selectedRegion={ null }
			onConnectTransition={ noop }
			onSelectNode={ noop }
			onSelectEdge={ noop }
			onSelectRegion={ noop }
			onClearSelection={ noop }
			onDeleteNode={ noop }
			onDeleteEdge={ noop }
			onPlaceStage={ noop }
			onSetStageStatus={ noop }
			isValidConnection={ () => true }
		/>
	);
}

// React Flow measures and lays out across a few ticks; wait until the canvas
// has handed it its edges. Then let the canvas's first centering frame pass:
// that centering is itself a viewport move, so it fires `onMoveStart`, and a
// hover set before it lands would be cleared by it rather than by the move
// the test makes.
async function settle() {
	await waitFor( () =>
		expect( mockFlowProps?.edges?.length ).toBeGreaterThan( 0 )
	);
	await act( async () => {
		await new Promise( ( resolve ) => requestAnimationFrame( resolve ) );
	} );
}

const hoveredEdges = () =>
	mockFlowProps.edges.filter( ( edge ) => edge.data?.hovered );

describe( 'GraphCanvas hover across a zoom or pan', () => {
	beforeEach( () => {
		mockFlowProps = null;
	} );

	it( 'drops the hovered edge when the viewport starts to move', async () => {
		renderCanvas();
		await settle();

		const [ edge ] = mockFlowProps.edges;

		await act( async () => {
			mockFlowProps.onEdgeMouseEnter( {}, edge );
		} );
		expect( hoveredEdges().map( ( e ) => e.id ) ).toEqual( [ edge.id ] );
		expect(
			mockFlowProps.edges.find( ( e ) => e.id === edge.id ).className
		).toContain( 'is-hovered' );

		// A scroll-zoom or pan with the pointer held still: no mouseleave.
		await act( async () => {
			mockFlowProps.onMoveStart( {}, { x: 0, y: 0, zoom: 1 } );
		} );

		expect( hoveredEdges() ).toEqual( [] );
		mockFlowProps.edges.forEach( ( e ) => {
			expect( e.className ?? '' ).not.toContain( 'is-hovered' );
		} );
	} );
} );
