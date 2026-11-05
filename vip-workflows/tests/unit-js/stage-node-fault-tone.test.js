/**
 * What colour a stage node's fault wears on the sequence canvas.
 *
 * Red means "blocks Save". `validateSequence` reports a Save-blocking rule into
 * both `errors` and the per-stage `warnings` (so the author is stopped *and*
 * shown which stage to open), and the Save-blocking subset alone into
 * `blockers`. The node reads that data, not the message text: a stage with a
 * blocker is `is-error`, a stage whose messages are all hints stays the amber
 * `is-warning`, and it is never both.
 *
 * `StageNode` renders React Flow handles and reads the in-flight connection and
 * the planned port order, none of which exist outside a mounted canvas, so
 * those are stubbed down to what the node needs to draw.
 *
 * @package
 */

import { render } from './helpers/render-wp-component';
import StageNode from '../../src/admin/components/graph/StageNode';
import { validateSequence } from '../../src/admin/components/graph/graph-model';

jest.mock( '@xyflow/react', () => ( {
	Handle: ( { children, className } ) => (
		<div className={ className }>{ children }</div>
	),
	Position: { Top: 'top', Bottom: 'bottom' },
	useConnection: ( selector ) => selector( { inProgress: false } ),
} ) );

jest.mock( '../../src/admin/components/graph/EdgePlanProvider', () => ( {
	usePortOrder: () => null,
} ) );

/**
 * Render a stage node with the given fault data and return its root element.
 *
 * @param {Object} data Node data overrides.
 * @return {HTMLElement} The `.wf-stage-node` element.
 */
function renderNode( data ) {
	const { container } = render(
		<StageNode
			id="review"
			selected={ false }
			data={ {
				label: 'Review',
				isAgent: false,
				routing: null,
				isTerminal: false,
				publishes: false,
				transitionCount: 1,
				isRegionEntry: false,
				warnings: [],
				blockers: [],
				...data,
			} }
		/>
	);
	return container.querySelector( '.wf-stage-node' );
}

describe( 'StageNode fault tone', () => {
	it( 'wears the error class, not the warning class, for a Save blocker', () => {
		const message = 'This stage has no way out.';
		const node = renderNode( {
			warnings: [ message ],
			blockers: [ message ],
		} );

		expect( node ).toHaveClass( 'is-error' );
		expect( node ).not.toHaveClass( 'is-warning' );
		expect(
			node.querySelector( '.wf-stage-node__flag--error' )
		).toBeInTheDocument();
		expect(
			node.querySelector( '.wf-stage-node__flag--warning' )
		).not.toBeInTheDocument();
	} );

	it( 'stays an error when a blocker sits alongside a hint', () => {
		const node = renderNode( {
			warnings: [ 'A hint.', 'A blocker.' ],
			blockers: [ 'A blocker.' ],
		} );

		expect( node ).toHaveClass( 'is-error' );
		expect( node ).not.toHaveClass( 'is-warning' );
	} );

	it( 'wears the warning class, not the error class, for hints only', () => {
		const node = renderNode( {
			warnings: [ 'Nothing reaches this stage.' ],
			blockers: [],
		} );

		expect( node ).toHaveClass( 'is-warning' );
		expect( node ).not.toHaveClass( 'is-error' );
		expect(
			node.querySelector( '.wf-stage-node__flag--warning' )
		).toBeInTheDocument();
	} );

	it( 'wears neither with no faults', () => {
		const node = renderNode( {} );

		expect( node ).not.toHaveClass( 'is-warning' );
		expect( node ).not.toHaveClass( 'is-error' );
	} );
} );

describe( 'validateSequence blockers', () => {
	// Draft enters and moves on to Done; Orphan is reached by nothing (a hint
	// the author can save past), and Unnamed has no label (refused on save).
	const stages = () => [
		{
			key: 'draft',
			label: 'Draft',
			status: 'draft',
			region_entry: true,
			transitions: [ { to: 'unnamed' }, { to: 'done' } ],
		},
		{
			key: 'unnamed',
			label: '',
			status: 'draft',
			transitions: [ { to: 'done' } ],
		},
		{
			key: 'orphan',
			label: 'Orphan',
			status: 'draft',
			transitions: [ { to: 'done' } ],
		},
		{
			key: 'done',
			label: 'Done',
			status: 'publish',
			region_entry: true,
			is_terminal: true,
			transitions: [],
		},
	];

	it( 'lists a Save-blocking stage fault in blockers as well as warnings', () => {
		const result = validateSequence( { name: 'Test', stages: stages() } );

		expect( result.blockers.unnamed ).toHaveLength( 1 );
		expect( result.warnings.unnamed ).toEqual(
			expect.arrayContaining( result.blockers.unnamed )
		);
		expect( result.errors.map( ( e ) => e.message ) ).toEqual(
			expect.arrayContaining( result.blockers.unnamed )
		);
	} );

	it( 'leaves a hint-only stage out of blockers', () => {
		const result = validateSequence( { name: 'Test', stages: stages() } );

		expect( result.warnings.orphan?.length ).toBeGreaterThan( 0 );
		expect( result.blockers.orphan ).toBeUndefined();
	} );
} );
