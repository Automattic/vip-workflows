/**
 * The canvas half of "Show transition".
 *
 * The editor's half — selecting the fault, opening the panel, handing the
 * canvas a `reveal` — is pinned in `sequence-fault-reveal.test.js`, against a
 * stubbed canvas, and the arithmetic of a pan in `canvas-reveal`. What is left
 * is what `GraphCanvas` does with the request: which nodes it frames, what it
 * frames them by, how much of the pane it counts as visible, and when it acts
 * at all.
 *
 * Real React Flow under jsdom, so the geometry a reveal reads is the layout the
 * canvas actually computed. Only `setViewport` is replaced — recorded rather
 * than applied, so the viewport every reveal starts from is the same one —
 * and the pane is given the size a browser would measure.
 *
 * @package
 */

import { render, act } from './helpers/render-wp-component';

import GraphCanvas, {
	visibleCanvas,
} from '../../src/admin/components/graph/GraphCanvas';
import {
	REVEAL_MARGIN,
	revealViewport,
} from '../../src/admin/components/graph/canvas-reveal';
import {
	regionNodeId,
	STAGE_WIDTH,
	STAGE_HEIGHT,
} from '../../src/admin/components/graph/graph-model';
import { visibleRegions } from '../../src/admin/components/graph/regions';

if ( ! global.structuredClone ) {
	global.structuredClone = ( value ) => JSON.parse( JSON.stringify( value ) );
}

// Every viewport the canvas asked for, and the instance it asked through. The
// rest of the instance is React Flow's own, so a reveal measures real nodes.
const mockSetViewport = jest.fn();
let mockFlow = null;

jest.mock( '@xyflow/react', () => {
	const actual = jest.requireActual( '@xyflow/react' );
	return {
		...actual,
		useReactFlow: () => {
			const instance = actual.useReactFlow();
			mockFlow = instance;
			return { ...instance, setViewport: mockSetViewport };
		},
	};
} );

// The pane as a browser would measure it: wide enough that nothing here is
// off to one side, short enough that the first and last stages are out of
// view above and below.
const PANE = { width: 1000, height: 300 };

let paneMeasurements = [];
beforeEach( () => {
	mockSetViewport.mockClear();
	paneMeasurements = [
		[ 'clientWidth', PANE.width ],
		[ 'clientHeight', PANE.height ],
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

// Laid out top to bottom: Draft above the pane's top edge, Writing inside it,
// Published below its bottom edge.
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

const noop = () => {};

function Canvas( {
	stages = STAGES,
	warnings = {},
	selectedNodeKey = null,
	reveal,
} ) {
	return (
		<GraphCanvas
			stages={ stages }
			isPhase={ false }
			warnings={ warnings }
			regions={ visibleRegions( stages, [] ) }
			selectedNodeKey={ selectedNodeKey }
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
			reveal={ reveal }
		/>
	);
}

// React Flow measures and lays out across a few ticks, and a reveal waits a
// frame for it.
async function settle() {
	for ( let i = 0; i < 3; i++ ) {
		// eslint-disable-next-line no-await-in-loop
		await act( async () => {
			await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );
		} );
	}
}

// Mounted and centered, with the centering's own call forgotten: what is
// recorded from here on is what the test did.
async function renderCanvas( props = {} ) {
	const view = render( <Canvas { ...props } /> );
	await settle();
	mockSetViewport.mockClear();
	return {
		update: async ( next ) => {
			view.rerender( <Canvas { ...props } { ...next } /> );
			await settle();
		},
	};
}

const bounds = ( id ) => mockFlow.getNodesBounds( [ id ] );

// The viewport every reveal starts from (`setViewport` is never applied), and
// the whole pane as visible: jsdom sets none of the inspector's measurements.
const HOME = { x: 0, y: 0, zoom: 1 };
const VISIBLE = { x: 0, y: 0, ...PANE };

// Where a target's middle lands when it is centred vertically in the pane.
const PANE_MIDDLE = REVEAL_MARGIN + ( PANE.height - REVEAL_MARGIN * 2 ) / 2;

const reveals = () =>
	mockSetViewport.mock.calls.map( ( [ viewport ] ) => viewport );

describe( 'GraphCanvas showing a fault', () => {
	it( 'brings a stage below the fold into view', async () => {
		const { update } = await renderCanvas();
		const target = bounds( 'publish' );
		expect( target.y + target.height ).toBeGreaterThan(
			PANE.height - REVEAL_MARGIN
		);

		await update( {
			reveal: { target: { type: 'node', key: 'publish' } },
		} );

		expect( mockSetViewport ).toHaveBeenCalledTimes( 1 );
		const [ next, options ] = mockSetViewport.mock.calls[ 0 ];
		expect( next ).toEqual(
			revealViewport( target, { viewport: HOME, visible: VISIBLE } )
		);
		expect( next.y + target.y + target.height / 2 ).toBe( PANE_MIDDLE );
		// Linear: d3's default interpolation zooms out mid-flight on a long
		// pan, which is the canvas changing while nobody asked it to.
		expect( options ).toEqual( {
			duration: expect.any( Number ),
			interpolate: 'linear',
		} );
		expect( options.duration ).toBeGreaterThan( 0 );
	} );

	it( 'does not move for a stage already in view', async () => {
		const { update } = await renderCanvas();

		await update( {
			reveal: { target: { type: 'node', key: 'writing' } },
		} );

		expect( mockSetViewport ).not.toHaveBeenCalled();
	} );

	it( 'jumps rather than travels when motion is reduced', async () => {
		const original = window.matchMedia;
		window.matchMedia = ( query ) => ( {
			...original( query ),
			matches: query === '( prefers-reduced-motion: reduce )',
		} );

		try {
			const { update } = await renderCanvas();

			await update( {
				reveal: { target: { type: 'node', key: 'publish' } },
			} );

			expect( mockSetViewport ).toHaveBeenCalledTimes( 1 );
			expect( mockSetViewport.mock.calls[ 0 ][ 1 ] ).toEqual( {
				duration: 0,
				interpolate: 'linear',
			} );
		} finally {
			window.matchMedia = original;
		}
	} );

	// Draft to Published runs taller than the pane. Centred, it would show the
	// middle of a line and neither end; the stage it leaves is where the fault
	// is configured, so that is where it lands.
	it( 'lands a transition too tall to frame on the stage it leaves', async () => {
		const { update } = await renderCanvas();

		await update( {
			reveal: { target: { type: 'edge', from: 'draft', to: 'publish' } },
		} );

		expect( reveals() ).toHaveLength( 1 );
		expect( reveals()[ 0 ].y + bounds( 'draft' ).y ).toBe( REVEAL_MARGIN );
	} );

	// The same pair the other way round: a transition running back up the
	// flow. Aligned by the pair's own top it would land on Draft, and push
	// Published — the stage it leaves — off the bottom.
	it( 'lands an oversized back-edge on the stage it leaves', async () => {
		const { update } = await renderCanvas();

		await update( {
			reveal: { target: { type: 'edge', from: 'publish', to: 'draft' } },
		} );

		expect( reveals() ).toHaveLength( 1 );
		expect( reveals()[ 0 ].y + bounds( 'publish' ).y ).toBe(
			REVEAL_MARGIN
		);
	} );

	// A status group's faults are fixed at its checkpoint slot, which hangs
	// over the band's top edge. Framing the band instead would centre the
	// band's middle and leave the slot near the top of the pane.
	it( 'frames a status group by its checkpoint slot, not its band', async () => {
		const { update } = await renderCanvas();
		const band = mockFlow.getInternalNode( regionNodeId( 'publish' ) );
		const slot = {
			x: band.internals.positionAbsolute.x + band.data.slotX,
			y: band.internals.positionAbsolute.y + band.data.slotY,
			width: STAGE_WIDTH,
			height: STAGE_HEIGHT,
		};

		await update( {
			reveal: { target: { type: 'region', region: 'publish' } },
		} );

		expect( reveals() ).toEqual( [
			revealViewport( slot, { viewport: HOME, visible: VISIBLE } ),
		] );
		expect( reveals()[ 0 ] ).not.toEqual(
			revealViewport( bounds( band.id ), {
				viewport: HOME,
				visible: VISIBLE,
			} )
		);
	} );

	// A stage deleted since the save was refused. The end the canvas still
	// holds is what there is to show.
	it( 'frames only the ends of a transition the canvas still holds', async () => {
		const { update } = await renderCanvas();

		await update( {
			reveal: { target: { type: 'edge', from: 'publish', to: 'gone' } },
		} );

		expect( reveals() ).toEqual( [
			revealViewport( bounds( 'publish' ), {
				viewport: HOME,
				visible: VISIBLE,
			} ),
		] );
	} );

	it( 'does not guess at a target the canvas holds nothing of', async () => {
		const { update } = await renderCanvas();

		await update( { reveal: { target: { type: 'node', key: 'gone' } } } );

		expect( mockSetViewport ).not.toHaveBeenCalled();
	} );

	it( 'leaves the canvas alone for an ordinary selection', async () => {
		const { update } = await renderCanvas();

		await update( { selectedNodeKey: 'publish' } );

		expect( mockSetViewport ).not.toHaveBeenCalled();
	} );

	// The editor never clears a reveal, so every later render arrives with the
	// last one still in hand: a selection, a renamed stage, the warnings
	// recomputed. None of them is a second request.
	it( 'acts once per reveal, not on every rebuild of the nodes', async () => {
		const reveal = { target: { type: 'node', key: 'publish' } };
		const { update } = await renderCanvas();
		await update( { reveal } );
		expect( mockSetViewport ).toHaveBeenCalledTimes( 1 );

		await update( { reveal, selectedNodeKey: 'publish' } );
		await update( {
			reveal,
			selectedNodeKey: 'publish',
			stages: STAGES.map( ( stage ) =>
				stage.key === 'writing'
					? { ...stage, label: 'Writing up' }
					: stage
			),
			warnings: { writing: [ 'Something to look at' ] },
		} );

		expect( mockSetViewport ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'reveals again when the same fault is asked for twice', async () => {
		const { update } = await renderCanvas();

		await update( {
			reveal: { target: { type: 'node', key: 'publish' } },
		} );
		await update( {
			reveal: { target: { type: 'node', key: 'publish' } },
		} );

		expect( mockSetViewport ).toHaveBeenCalledTimes( 2 );
	} );
} );

// --- How much of the pane a reveal can use ----------------------------------

describe( 'the part of the canvas left visible', () => {
	let styles;
	let computedStyle;

	beforeEach( () => {
		styles = {};
		// A custom property holding a length, as `SequenceGraphEditor.css`
		// sets them; jsdom resolves none of that stylesheet.
		computedStyle = jest
			.spyOn( window, 'getComputedStyle' )
			.mockImplementation( () => ( {
				getPropertyValue: ( name ) => styles[ name ] ?? '',
			} ) );
	} );

	afterEach( () => {
		computedStyle.mockRestore();
		document.body.innerHTML = '';
	} );

	const at = ( el, top, bottom = top ) => {
		el.getBoundingClientRect = () => ( {
			top,
			bottom,
			left: 0,
			right: 0,
			width: 0,
			height: bottom - top,
			x: 0,
			y: top,
		} );
		return el;
	};

	const element = ( className, parent ) => {
		const el = document.createElement( 'div' );
		el.className = className;
		parent.appendChild( el );
		return el;
	};

	// The editor with its pane 1000 × 800, starting 100px down the page.
	function editor() {
		const root = element( 'wf-sequence-editor', document.body );
		const pane = at( element( 'wf-canvas__viewport', root ), 100, 900 );
		Object.defineProperty( pane, 'clientWidth', { value: 1000 } );
		Object.defineProperty( pane, 'clientHeight', { value: 800 } );
		return { root, pane };
	}

	const notice = ( root, top, bottom ) =>
		at( element( 'wf-sequence-editor__notice', root ), top, bottom );

	describe( 'beside the floating panel', () => {
		beforeEach( () => {
			styles[ '--wf-inspector-width' ] = '360px';
			styles[ '--wf-float-inset' ] = '16px';
		} );

		it( 'takes the panel and its insets off the right', () => {
			const { pane } = editor();

			expect( visibleCanvas( pane ) ).toEqual( {
				x: 0,
				y: 0,
				width: 1000 - 360 - 16 * 2,
				height: 800,
			} );
		} );

		// The refused-save notice holds the button a reveal is asked for
		// from, so it is always there: a fault under it is not in view.
		it( 'starts below the lowest notice', () => {
			const { root, pane } = editor();
			notice( root, 110, 150 );
			notice( root, 150, 190 );

			expect( visibleCanvas( pane ) ).toEqual( {
				x: 0,
				y: 90,
				width: 1000 - 360 - 16 * 2,
				height: 710,
			} );
		} );
	} );

	describe( 'with the panel docked along the bottom', () => {
		beforeEach( () => {
			styles[ '--wf-inspector-width' ] = '0px';
			styles[ '--wf-float-inset' ] = '8px';
		} );

		it( 'takes the docked panel off the bottom, at the height it is', () => {
			const { root, pane } = editor();
			at( element( 'wf-inspector', root ), 600, 900 );

			expect( visibleCanvas( pane ) ).toEqual( {
				x: 0,
				y: 0,
				width: 1000,
				height: 500,
			} );
		} );

		it( 'counts the strip between the notices and the panel', () => {
			const { root, pane } = editor();
			notice( root, 110, 160 );
			at( element( 'wf-inspector', root ), 600, 900 );

			expect( visibleCanvas( pane ) ).toEqual( {
				x: 0,
				y: 60,
				width: 1000,
				height: 440,
			} );
		} );

		it( 'counts the whole pane when no panel has rendered', () => {
			const { pane } = editor();

			expect( visibleCanvas( pane ).height ).toBe( 800 );
		} );

		// A rect at the origin is a panel nothing laid out. Trusting it would
		// leave no strip at all, and pan every target off the top.
		it( 'counts the whole pane when the panel measures at the origin', () => {
			const { root, pane } = editor();
			at( element( 'wf-inspector', root ), 0 );

			expect( visibleCanvas( pane ).height ).toBe( 800 );
		} );
	} );
} );
