/**
 * Unit tests for the sequence canvas's context menus and keyboard selection of
 * transitions.
 *
 * What a right-click offers is decided by what it was opened on: a stage card
 * gets its own settings, a transition gets the one verb that removes it, and
 * anything that is not an author's to operate — the Start edge, a phase card —
 * gets the canvas's menu rather than an empty one or one that promises a change
 * the editor then refuses. Enter or Space on a focused transition opens its
 * panel, the way a click does.
 *
 * Real React Flow under jsdom. Edges only render once React Flow has measured
 * their nodes, and jsdom lays nothing out, so the size a browser would measure
 * is supplied for each card along with a `ResizeObserver` that reports it. The
 * canvas's callbacks are spies: what is pinned here is what the canvas asks the
 * editor to do, not what the editor does with it (that is
 * `sequence-editor-canvas-handlers.test.js`).
 *
 * @package
 */

import {
	render,
	act,
	fireEvent,
	screen,
	within,
} from './helpers/render-wp-component';

import GraphCanvas from '../../src/admin/components/graph/GraphCanvas';
import {
	edgeId,
	END_ID,
	START_ID,
	STAGE_HEIGHT,
	STAGE_WIDTH,
} from '../../src/admin/components/graph/graph-model';
import {
	REGION_ORDER,
	visibleRegions,
} from '../../src/admin/components/graph/regions';

if ( ! global.structuredClone ) {
	global.structuredClone = ( value ) => JSON.parse( JSON.stringify( value ) );
}

// What a browser would measure: the viewport's size (d3's zoom divides by it),
// and every node's, which is what lets React Flow draw the edges between them.
let measurements;
let OriginalResizeObserver;
let OriginalDOMMatrixReadOnly;
beforeEach( () => {
	measurements = [];
	const sizes = {
		clientWidth: ( el ) =>
			el.matches( '.wf-canvas__viewport, .react-flow__renderer' )
				? 1000
				: null,
		clientHeight: ( el ) =>
			el.matches( '.wf-canvas__viewport, .react-flow__renderer' )
				? 800
				: null,
		offsetWidth: ( el ) =>
			el.matches( '.react-flow__node' ) ? STAGE_WIDTH : null,
		offsetHeight: ( el ) =>
			el.matches( '.react-flow__node' ) ? STAGE_HEIGHT : null,
	};
	for ( const [ property, sizeOf ] of Object.entries( sizes ) ) {
		const prototype = property.startsWith( 'offset' )
			? HTMLElement.prototype
			: Element.prototype;
		const original = Object.getOwnPropertyDescriptor(
			prototype,
			property
		).get;
		measurements.push(
			jest
				.spyOn( prototype, property, 'get' )
				.mockImplementation( function () {
					return sizeOf( this ) ?? original.call( this );
				} )
		);
	}

	// Measuring reads the zoom back off the viewport's CSS transform, through a
	// constructor jsdom does not have. Only the scale is read.
	OriginalDOMMatrixReadOnly = window.DOMMatrixReadOnly;
	window.DOMMatrixReadOnly = class {
		constructor( transform = '' ) {
			const scale = /scale\(\s*([-\d.]+)/.exec( transform );
			this.m22 = scale ? Number( scale[ 1 ] ) : 1;
		}
	};

	// React Flow measures a node when its observer reports it. Report every
	// observed element once, asynchronously, as a browser does.
	OriginalResizeObserver = global.ResizeObserver;
	global.ResizeObserver = class {
		constructor( callback ) {
			this.callback = callback;
		}
		observe( target ) {
			Promise.resolve().then( () =>
				this.callback( [ { target } ], this )
			);
		}
		unobserve() {}
		disconnect() {}
	};
} );

afterEach( () => {
	measurements.forEach( ( measurement ) => measurement.mockRestore() );
	global.ResizeObserver = OriginalResizeObserver;
	window.DOMMatrixReadOnly = OriginalDOMMatrixReadOnly;
} );

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
		transitions: [ { to: 'review' } ],
	},
	{
		key: 'review',
		label: 'Review',
		status: 'draft',
		agent: {
			ability_id: 'example/review',
			routing: { pass: 'publish', fail: 'writing' },
		},
		transitions: [ { to: 'publish' }, { to: 'writing' } ],
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

const PHASES = [
	{
		key: 'ideation',
		label: 'Ideation',
		transitions: [ { to: 'editorial' } ],
	},
	{ key: 'editorial', label: 'Editorial', transitions: [] },
];

/**
 * Render the canvas with spies for every callback it hands back up.
 *
 * @param {Object}  options            Options.
 * @param {Array}   options.stages     Stages to draw.
 * @param {boolean} options.isPhase    Whether the sequence is a phase sequence.
 * @param {Array}   options.required   Hand-offs a phase sequence owes.
 * @param {Object}  options.postCounts Posts at each stage, by key.
 * @return {Object} The spies, and the render's container.
 */
async function renderCanvas( {
	stages = STAGES,
	isPhase = false,
	required = [],
	postCounts = {},
} = {} ) {
	const spies = {
		onConnectTransition: jest.fn(),
		onSelectNode: jest.fn(),
		onSelectEdge: jest.fn(),
		onSelectRegion: jest.fn(),
		onClearSelection: jest.fn(),
		onDeleteNode: jest.fn(),
		onDeleteEdge: jest.fn(),
		onPlaceStage: jest.fn(),
		onSetStageStatus: jest.fn(),
		onAddRegion: jest.fn(),
		onRemoveRegion: jest.fn(),
	};
	// The regions drawn, and the statuses not drawn yet that "Add post
	// status…" offers — the editor works the second out from the first and
	// hands the canvas both.
	const regions = isPhase ? [] : visibleRegions( stages, [] );
	const addableRegions = REGION_ORDER.filter(
		( region ) => ! regions.includes( region )
	);
	const { container } = render(
		<GraphCanvas
			stages={ stages }
			isPhase={ isPhase }
			warnings={ {} }
			regions={ regions }
			addableRegions={ addableRegions }
			selectedNodeKey={ null }
			selectedEdgeId={ null }
			selectedRegion={ null }
			requiredTransitions={ required }
			isValidConnection={ () => true }
			stagePostCount={ ( key ) => postCounts[ key ] || 0 }
			{ ...spies }
		/>
	);
	await settle();
	// The canvas centers itself on the next frame, and a viewport move closes
	// the menu. Let that frame pass first, or a menu opened before it is
	// dismissed by it.
	await act( async () => {
		await new Promise( ( resolve ) => requestAnimationFrame( resolve ) );
	} );
	await settle();
	return { ...spies, container };
}

// React Flow measures and lays out across a few ticks.
async function settle() {
	for ( let i = 0; i < 5; i++ ) {
		await act( async () => {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		} );
	}
}

const stageCard = ( container, key ) =>
	container.querySelector( `.react-flow__node[data-id="${ key }"]` );

const edge = ( container, id ) => {
	const found = container.querySelector(
		`.react-flow__edge[data-id="${ id }"]`
	);
	// Without this, a test about an edge would pass vacuously on a canvas that
	// drew none.
	expect( found ).not.toBeNull();
	return found;
};

async function openContextMenu( element ) {
	fireEvent.contextMenu( element, { clientX: 40, clientY: 40 } );
	await settle();
	return screen.getByRole( 'menu' );
}

const itemNames = ( menu ) =>
	within( menu )
		.getAllByRole( 'menuitem' )
		.map( ( item ) => item.textContent );

async function choose( menu, name ) {
	fireEvent.click( within( menu ).getByRole( 'menuitem', { name } ) );
	await settle();
}

describe( 'Stage context menu', () => {
	it( 'selects the stage and offers its settings', async () => {
		const { container, onSelectNode } = await renderCanvas();

		const menu = await openContextMenu( stageCard( container, 'writing' ) );

		expect( onSelectNode ).toHaveBeenCalledWith( 'writing' );
		expect( menu ).toHaveAccessibleName( 'Stage actions' );
		expect( itemNames( menu ) ).toEqual( [
			'Set post status to “Published”',
			'Make this a final stage',
			'Delete stage',
		] );
	} );

	it( 'moves the stage to another post status', async () => {
		const { container, onSetStageStatus } = await renderCanvas();

		const menu = await openContextMenu( stageCard( container, 'writing' ) );
		await choose( menu, 'Set post status to “Published”' );

		expect( onSetStageStatus ).toHaveBeenCalledWith( 'writing', 'publish' );
		expect( screen.queryByRole( 'menu' ) ).toBeNull();
	} );

	it( 'makes the stage final and keeps it selected', async () => {
		const { container, onConnectTransition, onSelectNode } =
			await renderCanvas();

		const menu = await openContextMenu( stageCard( container, 'writing' ) );
		onSelectNode.mockClear();
		await choose( menu, 'Make this a final stage' );

		expect( onConnectTransition ).toHaveBeenCalledWith(
			'writing',
			END_ID,
			null
		);
		// Drawing the End edge selects it; the stage takes the selection back
		// afterwards, since the menu was opened on the stage.
		expect( onSelectNode ).toHaveBeenCalledWith( 'writing' );
		expect( onSelectNode.mock.invocationCallOrder[ 0 ] ).toBeGreaterThan(
			onConnectTransition.mock.invocationCallOrder[ 0 ]
		);
	} );

	it( 'clears a final stage and keeps it selected', async () => {
		const { container, onDeleteEdge, onSelectNode } = await renderCanvas();

		const menu = await openContextMenu( stageCard( container, 'publish' ) );
		expect( itemNames( menu ) ).toContain( 'Not a final stage' );
		onSelectNode.mockClear();
		await choose( menu, 'Not a final stage' );

		expect( onDeleteEdge ).toHaveBeenCalledWith( 'publish', END_ID, null );
		expect( onSelectNode ).toHaveBeenCalledWith( 'publish' );
		expect( onSelectNode.mock.invocationCallOrder[ 0 ] ).toBeGreaterThan(
			onDeleteEdge.mock.invocationCallOrder[ 0 ]
		);
	} );

	it( 'offers no final-stage toggle on an AI stage', async () => {
		const { container } = await renderCanvas();

		const menu = await openContextMenu( stageCard( container, 'review' ) );

		expect( itemNames( menu ) ).not.toContain( 'Make this a final stage' );
		expect( itemNames( menu ) ).toContain( 'Delete stage' );
	} );

	it( 'deletes the stage', async () => {
		const { container, onDeleteNode } = await renderCanvas();

		const menu = await openContextMenu( stageCard( container, 'writing' ) );
		await choose( menu, 'Delete stage' );

		expect( onDeleteNode ).toHaveBeenCalledWith( 'writing' );
	} );

	it( 'will not delete a stage posts sit at, and says how many', async () => {
		const { container, onDeleteNode } = await renderCanvas( {
			postCounts: { writing: 3 },
		} );

		const menu = await openContextMenu( stageCard( container, 'writing' ) );
		const remove = within( menu ).getByRole( 'menuitem', {
			name: 'Delete stage (3 posts here)',
		} );

		expect( remove ).toBeDisabled();
		fireEvent.click( remove );
		expect( onDeleteNode ).not.toHaveBeenCalled();
	} );

	it( 'will not delete the last stage', async () => {
		const { container, onDeleteNode } = await renderCanvas( {
			stages: [
				{
					key: 'draft',
					label: 'Draft',
					status: 'draft',
					region_entry: true,
					is_terminal: true,
					transitions: [],
				},
			],
		} );

		const menu = await openContextMenu( stageCard( container, 'draft' ) );
		const remove = within( menu ).getByRole( 'menuitem', {
			name: 'Delete stage',
		} );

		expect( remove ).toBeDisabled();
		fireEvent.click( remove );
		expect( onDeleteNode ).not.toHaveBeenCalled();
	} );

	it( 'gives a phase the canvas menu, and leaves the selection alone', async () => {
		const { container, onSelectNode } = await renderCanvas( {
			stages: PHASES,
			isPhase: true,
		} );

		const menu = await openContextMenu(
			stageCard( container, 'ideation' )
		);

		expect( onSelectNode ).not.toHaveBeenCalled();
		expect( menu ).toHaveAccessibleName( 'Canvas actions' );
		expect( itemNames( menu ) ).not.toContain( 'Delete stage' );
	} );
} );

describe( 'Transition context menu', () => {
	it( 'gives the Start edge the canvas menu', async () => {
		const { container, onSelectEdge } = await renderCanvas();

		const menu = await openContextMenu(
			edge( container, edgeId( START_ID, 'draft' ) )
		);

		expect( onSelectEdge ).not.toHaveBeenCalled();
		expect( menu ).toHaveAccessibleName( 'Canvas actions' );
		expect( itemNames( menu ) ).toEqual( [ 'Add post status…' ] );
	} );

	it( 'says "Not a final stage" on an End edge', async () => {
		const id = edgeId( 'publish', END_ID );
		const { container, onSelectEdge, onDeleteEdge } = await renderCanvas();

		const menu = await openContextMenu( edge( container, id ) );

		expect( onSelectEdge ).toHaveBeenCalledWith( id );
		expect( menu ).toHaveAccessibleName( 'Transition actions' );
		expect( itemNames( menu ) ).toEqual( [ 'Not a final stage' ] );
		await choose( menu, 'Not a final stage' );
		expect( onDeleteEdge ).toHaveBeenCalledWith( 'publish', END_ID, null );
	} );

	it( 'says "Remove this route" on an outcome edge', async () => {
		const id = edgeId( 'review', 'publish', 'pass' );
		const { container, onSelectEdge, onDeleteEdge } = await renderCanvas();

		const menu = await openContextMenu( edge( container, id ) );

		expect( onSelectEdge ).toHaveBeenCalledWith( id );
		expect( itemNames( menu ) ).toEqual( [ 'Remove this route' ] );
		await choose( menu, 'Remove this route' );
		expect( onDeleteEdge ).toHaveBeenCalledWith(
			'review',
			'publish',
			'pass'
		);
	} );

	it( 'says "Delete transition" on a plain edge', async () => {
		const id = edgeId( 'draft', 'writing' );
		const { container, onSelectEdge, onDeleteEdge } = await renderCanvas();

		const menu = await openContextMenu( edge( container, id ) );

		expect( onSelectEdge ).toHaveBeenCalledWith( id );
		expect( itemNames( menu ) ).toEqual( [ 'Delete transition' ] );
		await choose( menu, 'Delete transition' );
		expect( onDeleteEdge ).toHaveBeenCalledWith( 'draft', 'writing', null );
	} );

	it( 'offers no deletion of a hand-off a phase sequence owes', async () => {
		const id = edgeId( 'ideation', 'editorial' );
		const { container, onSelectEdge } = await renderCanvas( {
			stages: PHASES,
			isPhase: true,
			required: [ { from: 'ideation', to: 'editorial' } ],
		} );

		const menu = await openContextMenu( edge( container, id ) );

		expect( onSelectEdge ).not.toHaveBeenCalled();
		expect( menu ).toHaveAccessibleName( 'Canvas actions' );
		expect( itemNames( menu ) ).not.toContain( 'Delete transition' );
	} );
} );

describe( 'Transition keyboard selection', () => {
	it.each( [ [ 'Enter' ], [ ' ' ] ] )(
		'selects a focused transition on %p',
		async ( key ) => {
			const id = edgeId( 'draft', 'writing' );
			const { container, onSelectEdge } = await renderCanvas();

			const line = edge( container, id );
			line.focus();
			fireEvent.keyDown( line, { key } );

			expect( onSelectEdge ).toHaveBeenCalledWith( id );
		}
	);

	it( 'leaves the selection alone for any other key', async () => {
		const { container, onSelectEdge } = await renderCanvas();

		fireEvent.keyDown( edge( container, edgeId( 'draft', 'writing' ) ), {
			key: 'a',
		} );

		expect( onSelectEdge ).not.toHaveBeenCalled();
	} );
} );

describe( 'Transition pill description', () => {
	/**
	 * The texts a pill's `aria-describedby` points at, in order.
	 *
	 * @param {HTMLElement} pill The pill.
	 * @return {string[]} The descriptions.
	 */
	const descriptions = ( pill ) =>
		( pill.getAttribute( 'aria-describedby' ) || '' )
			.split( ' ' )
			.filter( Boolean )
			.map( ( id ) => document.getElementById( id )?.textContent );

	const REMOVE_HINT = 'Press Enter, then Backspace to remove.';

	it( 'tells a removable transition how to remove it, from one shared element', async () => {
		await renderCanvas();

		const draft = screen.getByRole( 'button', {
			name: 'Edit transition: Move to Writing, from Draft',
		} );
		const writing = screen.getByRole( 'button', {
			name: 'Edit transition: Move to Review, from Writing',
		} );

		// The name is unchanged; the hint is a description.
		expect( draft ).toHaveAccessibleDescription( REMOVE_HINT );
		// Said once for the canvas and pointed at, not once per pill.
		expect( draft.getAttribute( 'aria-describedby' ) ).toBe(
			writing.getAttribute( 'aria-describedby' )
		);
		expect( screen.getAllByText( REMOVE_HINT ) ).toHaveLength( 1 );
	} );

	it( 'does not mark a pill aria-disabled: every pill still selects', async () => {
		await renderCanvas();

		screen
			.getAllByRole( 'button', { name: /^Edit transition: / } )
			.forEach( ( pill ) =>
				expect( pill ).not.toHaveAttribute( 'aria-disabled' )
			);
	} );

	it( 'says a disabled transition is disabled before how to remove it', async () => {
		await renderCanvas();

		const pill = document.querySelector(
			'.wf-transition-edge__pill.is-disabled'
		);
		// Without this, the test would pass vacuously on a canvas with none.
		expect( pill ).not.toBeNull();

		expect( descriptions( pill ) ).toEqual( [
			'Disabled transition.',
			REMOVE_HINT,
		] );
	} );

	it( 'offers no removal hint on a hand-off a phase sequence owes', async () => {
		await renderCanvas( {
			stages: PHASES,
			isPhase: true,
			required: [ { from: 'ideation', to: 'editorial' } ],
		} );

		const pill = screen.getByRole( 'button', {
			name: /, from Ideation$/,
		} );

		expect( pill ).not.toHaveAttribute( 'aria-describedby' );
	} );

	it( 'offers the removal hint on a phase hand-off that is not owed', async () => {
		await renderCanvas( { stages: PHASES, isPhase: true } );

		expect(
			screen.getByRole( 'button', { name: /, from Ideation$/ } )
		).toHaveAccessibleDescription( REMOVE_HINT );
	} );
} );
