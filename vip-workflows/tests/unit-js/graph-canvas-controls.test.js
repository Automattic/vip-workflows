/**
 * How the Controls panel's "Fit view" and "Reset layout" move the canvas.
 *
 * Both travel the same 200ms linear pan, and both jump instead when the author
 * has asked for reduced motion: they asked to move the view, not to watch the
 * canvas slide.
 *
 * Real React Flow under jsdom, pressed through its real buttons. Reset layout
 * centers through `setViewport`, which is recorded rather than applied. Fit
 * view runs inside React Flow's own Controls, which hands its options to the
 * store to be fitted on the next pass, so those options are read off the store.
 *
 * @package
 */

import { render, act, fireEvent, screen } from './helpers/render-wp-component';

import GraphCanvas from '../../src/admin/components/graph/GraphCanvas';
import { visibleRegions } from '../../src/admin/components/graph/regions';

if ( ! global.structuredClone ) {
	global.structuredClone = ( value ) => JSON.parse( JSON.stringify( value ) );
}

const mockSetViewport = jest.fn();
let mockStore = null;

jest.mock( '@xyflow/react', () => {
	const actual = jest.requireActual( '@xyflow/react' );
	return {
		...actual,
		useReactFlow: () => ( {
			...actual.useReactFlow(),
			setViewport: mockSetViewport,
		} ),
		useStoreApi: () => {
			mockStore = actual.useStoreApi();
			return mockStore;
		},
	};
} );

// d3's zoom measures the renderer; jsdom's zero size divides by zero.
let paneMeasurements = [];
beforeEach( () => {
	mockSetViewport.mockClear();
	paneMeasurements = [
		[ 'clientWidth', 1000 ],
		[ 'clientHeight', 800 ],
	].map( ( [ property, size ] ) => {
		const original = Object.getOwnPropertyDescriptor(
			Element.prototype,
			property
		).get;
		return jest
			.spyOn( Element.prototype, property, 'get' )
			.mockImplementation( function () {
				return this.matches(
					'.wf-canvas__viewport, .react-flow__renderer'
				)
					? size
					: original.call( this );
			} );
	} );
} );

afterEach( () => {
	paneMeasurements.forEach( ( measurement ) => measurement.mockRestore() );
} );

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

const noop = () => {};

function Canvas() {
	return (
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

// React Flow measures and lays out across a few ticks, and centering waits a
// frame for it.
async function settle() {
	for ( let i = 0; i < 3; i++ ) {
		await act( async () => {
			await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );
		} );
	}
}

// Mounted and centered, with the centering's own call forgotten.
async function renderCanvas() {
	render( <Canvas /> );
	await settle();
	mockSetViewport.mockClear();
}

// The options each fit was queued with, from here on.
function recordFits() {
	const fits = [];
	mockStore.subscribe( ( state ) => {
		if ( state.fitViewQueued ) {
			fits.push( state.fitViewOptions );
		}
	} );
	return fits;
}

async function press( name ) {
	fireEvent.click( screen.getByRole( 'button', { name } ) );
	await settle();
}

// Run `body` with the reduced-motion preference set, or not.
async function withReducedMotion( reduced, body ) {
	const original = window.matchMedia;
	window.matchMedia = ( query ) => ( {
		...original( query ),
		matches: reduced && query === '( prefers-reduced-motion: reduce )',
	} );
	try {
		await body();
	} finally {
		window.matchMedia = original;
	}
}

describe.each( [
	[ 'by default', false, 200 ],
	[ 'when motion is reduced', true, 0 ],
] )( 'GraphCanvas Controls %s', ( _, reduced, duration ) => {
	it( `fits the view over ${ duration }ms`, async () => {
		await withReducedMotion( reduced, async () => {
			await renderCanvas();
			const fits = recordFits();

			await press( 'Fit View' );

			expect( fits.length ).toBeGreaterThan( 0 );
			expect( fits[ 0 ] ).toEqual( {
				duration,
				interpolate: 'linear',
			} );
		} );
	} );

	it( `resets the layout over ${ duration }ms`, async () => {
		await withReducedMotion( reduced, async () => {
			await renderCanvas();

			await press( 'Reset layout' );

			expect( mockSetViewport ).toHaveBeenCalledTimes( 1 );
			expect( mockSetViewport.mock.calls[ 0 ][ 1 ] ).toEqual( {
				duration,
				interpolate: 'linear',
			} );
		} );
	} );
} );
