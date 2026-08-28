/**
 * The mark an outcome edge wears when its transition record is not its own.
 *
 * An AI stage can route two outcomes to the same destination, and a stage holds
 * at most one transition per target — so those two lines are one record drawn
 * twice, and a required tool typed into either arms both. The canvas has to say
 * that at rest, and it has to say it on *every* line of the set: the reader
 * asking "does editing this one reach anything else?" is following one line,
 * and a mark on the other one is no answer.
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

/** The midpoint the stubbed plan hands the component. */
const MID = { x: 120, y: 60 };

/** The label every line of a pass/fail pair on one record carries. */
const SHARED_LABEL = 'On pass, On fail share one transition';

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
					onInsertStage: () => {},
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
		// midpoint it stands on is about to move — the condition the "+" beside
		// it already hides for.
		renderEdge( { reconnecting: true } );

		expect( screen.queryByRole( 'img' ) ).not.toBeInTheDocument();
	} );

	it( 'inserts a stage at the midpoint the row was drawn on', () => {
		// The mark is out of the row's flow precisely so it cannot push the "+"
		// off the point the click reports.
		const onInsertStage = jest.fn();
		renderEdge( { onInsertStage } );

		fireEvent.click( screen.getByRole( 'button', { name: /insert/i } ) );

		expect( onInsertStage ).toHaveBeenCalledWith( MID );
	} );
} );
