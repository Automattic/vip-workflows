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
 * The pill is the other occupant of that point, and the reason most of these
 * tests exist: it renders through `EdgeLabelRenderer`, which portals it out of
 * the SVG edge group, so none of React Flow's edge events reach it. Both the
 * click that selects the edge and the hover that keeps the pill on screen have
 * to be answered by the pill itself, and each is a thing that silently does
 * nothing if the wiring is dropped.
 *
 * Rendering `TransitionEdge` needs two things stubbed. Its geometry arrives
 * from `EdgePlanProvider` — planning is a cross-edge pass, and there is nothing
 * to plan from one edge and no measured nodes — and `EdgeLabelRenderer` portals
 * into React Flow's own label layer, which exists only inside a mounted
 * `<ReactFlow>`.
 *
 * @package
 */

import { createPortal as mockCreatePortal } from '@wordpress/element';
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

jest.mock( '@xyflow/react', () => ( {
	BaseEdge: ( { path } ) => <path data-testid="edge-line" d={ path } />,
	// What the real one does: portal the label out of the SVG the edge is
	// drawn in, so the controls are ordinary HTML on top of the canvas.
	EdgeLabelRenderer: ( { children } ) =>
		mockCreatePortal( children, mockLabelLayer() ),
} ) );

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
					onSelect: () => {},
					onHover: () => {},
					...data,
				} }
			/>
		</svg>
	);
}

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

	it( 'selects the edge when clicked, which React Flow cannot do for it', () => {
		// The pill is portalled out of the SVG edge group, so a click on it
		// fires no `onEdgeClick`. Drop this handler and the enlarged target
		// silently stops selecting anything.
		const onSelect = jest.fn();
		renderEdge( { onSelect } );

		fireEvent.click( screen.getByRole( 'button' ) );

		expect( onSelect ).toHaveBeenCalled();
	} );

	it( 'holds the edge hovered while the pointer is on it', () => {
		// The regression the portal invites: moving off the line and onto the
		// pill fires React Flow's `onEdgeMouseLeave`, and without this the pill
		// disappears at the moment it is being reached for.
		const onHover = jest.fn();
		renderEdge( { onHover } );

		const pill = screen.getByRole( 'button' );
		fireEvent.mouseEnter( pill );
		expect( onHover ).toHaveBeenLastCalledWith( true );

		fireEvent.mouseLeave( pill );
		expect( onHover ).toHaveBeenLastCalledWith( false );
	} );

	it( 'is drawn on a hovered edge and not on a resting one', () => {
		// Visibility is a class rather than a mount, so the box is stable and
		// the mark under it never shifts.
		const { container } = renderEdge( { hovered: true } );
		expect(
			container.ownerDocument.querySelector(
				'.wf-transition-edge__pill.is-visible'
			)
		).toBeInTheDocument();
	} );

	it( 'stays with the line while an end of that line is being dragged', () => {
		renderEdge( { hovered: true, reconnecting: true } );

		expect(
			document.querySelector( '.wf-transition-edge__pill.is-visible' )
		).not.toBeInTheDocument();
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
