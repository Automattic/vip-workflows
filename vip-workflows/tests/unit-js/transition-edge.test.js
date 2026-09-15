/**
 * What an edge draws at its midpoint: the transition pill, and the mark an
 * outcome edge wears when its transition record is not its own.
 *
 * An AI stage can route two outcomes to the same destination, and a stage holds
 * at most one transition per target — so those two lines are one record drawn
 * twice, and a required tool typed into either arms both. The canvas has to say
 * that at rest, and it has to say it on *every* line of the set: the reader
 * asking "does editing this one reach anything else?" is following one line,
 * and a mark on the other one is no answer.
 *
 * The pill is the other occupant of that point. It renders through
 * `EdgeLabelRenderer`, which portals it out of the SVG edge group in the DOM
 * but not in the React tree — so React Flow's edge `<g>` handlers, which are
 * what select the edge and hold it hovered, have to keep answering for it.
 * The tests below put the edge inside such a `<g>` and move the pointer the way
 * a browser reports it, because a pill that handled its own leave would drop
 * the hover on the way back to its line and no bare `mouseLeave` would say so.
 *
 * Rendering `TransitionEdge` needs three things stubbed. Its geometry arrives
 * from `EdgePlanProvider` — planning is a cross-edge pass, and there is nothing
 * to plan from one edge and no measured nodes — `EdgeLabelRenderer` portals
 * into React Flow's own label layer, which exists only inside a mounted
 * `<ReactFlow>`, and the zoom comes from React Flow's store.
 *
 * @package
 */

import { createPortal as mockCreatePortal, useState } from '@wordpress/element';
import { render, screen, fireEvent } from './helpers/render-wp-component';
import TransitionEdge from '../../src/admin/components/graph/TransitionEdge';

/**
 * Where the stubbed label layer portals to, read when it renders rather than
 * closed over: a `jest.mock` factory may not reference `document`, and only
 * names beginning with `mock` may reach it from outside at all.
 *
 * @return {HTMLElement} The portal host.
 */
const mockLabelLayer = () => document.body;

/** The viewport zoom the stubbed store reports; set per test. */
let mockZoom = 1;

jest.mock( '@xyflow/react', () => ( {
	BaseEdge: ( { path, interactionWidth } ) => (
		<path
			data-testid="edge-line"
			d={ path }
			data-interaction-width={ interactionWidth }
		/>
	),
	// What the real one does: portal the label out of the SVG the edge is
	// drawn in, so the controls are ordinary HTML on top of the canvas.
	EdgeLabelRenderer: ( { children } ) =>
		mockCreatePortal( children, mockLabelLayer() ),
	useStore: ( selector ) => selector( { transform: [ 0, 0, mockZoom ] } ),
} ) );

beforeEach( () => {
	mockZoom = 1;
} );

jest.mock( '../../src/admin/components/graph/EdgePlanProvider', () => ( {
	useEdgePlan: () => ( {
		d: 'M 0,0 L 240,120',
		mid: { x: 120, y: 60 },
		tunnel: null,
	} ),
} ) );

/** The label every line of a pass/fail pair on one record carries. */
const SHARED_LABEL = 'On pass, On fail share one transition';

/** What `buildGraph` derived for this transition, as it arrives in `data`. */
const PILL_LABEL = 'Move to Done';

/**
 * Render one outcome edge of a pair routed to the same destination.
 *
 * @param {Object} data Edge `data` overrides.
 * @return {Object} RTL render result.
 */
function renderEdge( data = {} ) {
	// In an `<svg>`, because that is where React Flow renders an edge and where
	// the paths this one draws are elements rather than unknown tags.
	return render(
		<svg>
			<TransitionEdge
				id="review:pass->done"
				selected={ false }
				data={ {
					outcome: 'pass',
					sharedOutcomes: [ 'pass', 'fail' ],
					parallelIndex: 0,
					parallelCount: 2,
					label: PILL_LABEL,
					...data,
				} }
			/>
		</svg>
	);
}

/**
 * One edge inside a stand-in for React Flow's edge `<g>`, wired the way
 * `GraphCanvas` wires the real one: its enter/leave set the hover the edge is
 * drawn with, and its click selects.
 *
 * @param {Object}   props         Harness props.
 * @param {Function} props.onClick The edge `<g>`'s click handler.
 * @return {JSX.Element} The harness.
 */
function EdgeGroup( { onClick = () => {} } ) {
	const [ hovered, setHovered ] = useState( false );
	return (
		<svg>
			<g
				onClick={ onClick }
				onMouseEnter={ () => setHovered( true ) }
				onMouseLeave={ () => setHovered( false ) }
			>
				<TransitionEdge
					id="review->done"
					selected={ false }
					data={ { label: PILL_LABEL, hovered } }
				/>
			</g>
		</svg>
	);
}

/**
 * Move the pointer between two elements the way a browser reports it: `mouseout`
 * on the one left and `mouseover` on the one entered, each naming the other.
 *
 * @param {?Element} from Element the pointer leaves, or null from outside.
 * @param {?Element} to   Element the pointer enters, or null to outside.
 */
function movePointer( from, to ) {
	if ( from ) {
		fireEvent.mouseOut( from, { relatedTarget: to } );
	}
	if ( to ) {
		fireEvent.mouseOver( to, { relatedTarget: from } );
	}
}

/** @return {?Element} The pill, if it is currently shown. */
const visiblePill = () =>
	document.querySelector( '.wf-transition-edge__pill.is-visible' );

describe( 'TransitionEdge shared-transition mark', () => {
	it( 'marks every line of a shared set, not only the first of them', () => {
		// Both lines are the same record, and each is asked the same question
		// by whoever is following it.
		renderEdge( { outcome: 'pass', parallelIndex: 0 } );
		renderEdge( { outcome: 'fail', parallelIndex: 1 } );

		expect(
			screen.getAllByRole( 'img', { name: SHARED_LABEL } )
		).toHaveLength( 2 );
	} );

	it( 'names the whole record on each line, not the outcome that line is', () => {
		renderEdge( { outcome: 'fail', parallelIndex: 1 } );

		expect(
			screen.getByRole( 'img', { name: SHARED_LABEL } )
		).toBeInTheDocument();
	} );

	it( 'says nothing of the sort for an outcome with a destination of its own', () => {
		renderEdge( { sharedOutcomes: null } );

		expect( screen.queryByRole( 'img' ) ).not.toBeInTheDocument();
	} );

	it( 'goes with the line while an end of that line is being dragged', () => {
		// The line under it is hidden for the length of the gesture and the
		// midpoint it stands on is about to move — the condition the pill over
		// it already hides for.
		renderEdge( { reconnecting: true } );

		expect( screen.queryByRole( 'img' ) ).not.toBeInTheDocument();
	} );
} );

describe( 'TransitionEdge pill', () => {
	it( 'carries the label the transition was derived to have', () => {
		renderEdge();

		expect(
			screen.getByRole( 'button', { name: new RegExp( PILL_LABEL ) } )
		).toBeInTheDocument();
	} );

	it( 'selects through the edge it belongs to', () => {
		// Portalled in the DOM, but a child of the edge `<g>` in the React tree,
		// so its click reaches React Flow's `onEdgeClick` like the line's does.
		const onClick = jest.fn();
		render( <EdgeGroup onClick={ onClick } /> );

		fireEvent.click( screen.getByRole( 'button', { hidden: true } ) );

		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'stays up as the pointer moves between the line and the pill', () => {
		render( <EdgeGroup /> );
		const line = screen.getByTestId( 'edge-line' );
		const pill = screen.getByRole( 'button', { hidden: true } );

		movePointer( null, line );
		expect( visiblePill() ).toBeInTheDocument();

		movePointer( line, pill );
		expect( visiblePill() ).toBeInTheDocument();

		// The way back is the one a pill with its own leave handler gets wrong:
		// the edge never re-enters, because as far as React is concerned the
		// pointer never left it.
		movePointer( pill, line );
		expect( visiblePill() ).toBeInTheDocument();

		movePointer( line, pill );
		movePointer( pill, null );
		expect( visiblePill() ).not.toBeInTheDocument();
	} );

	it( 'is drawn on a hovered edge and not on a resting one', () => {
		// Visibility is a class rather than a mount, so the box is stable and
		// the mark under it never shifts.
		const { unmount } = renderEdge();
		expect( screen.getByRole( 'button' ) ).toBeInTheDocument();
		expect( visiblePill() ).not.toBeInTheDocument();
		unmount();

		renderEdge( { hovered: true } );
		expect( visiblePill() ).toBeInTheDocument();
	} );

	it( 'holds its size on screen, and its hit stroke, at any zoom', () => {
		// React Flow zooms with a CSS scale outside the edge's `<svg>`, so both
		// are undone by hand: at a quarter zoom the stroke is four times as wide
		// in flow px and the pill four times as large.
		mockZoom = 0.25;
		renderEdge( { hovered: true } );

		expect(
			screen.getByTestId( 'edge-line' ).dataset.interactionWidth
		).toBe( '80' );
		expect( visiblePill().style.transform ).toContain( 'scale(4)' );
	} );

	it( 'stays with the line while an end of that line is being dragged', () => {
		renderEdge( { hovered: true, reconnecting: true } );

		expect( visiblePill() ).not.toBeInTheDocument();
	} );

	it( 'draws none at all on a synthetic Start/End edge', () => {
		// Those are structural, not transitions: no label, and nothing to
		// select or configure.
		renderEdge( {
			label: undefined,
			sharedOutcomes: null,
			synthetic: 'start',
		} );

		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
} );
