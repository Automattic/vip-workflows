/**
 * Where a blocking validation error points, and who says so.
 *
 * A rule the server would refuse the save for is reported twice: it stops Save,
 * and it marks the stage holding the fault so the canvas says which node to
 * open. Both halves named the stage and stopped there — which is only half an
 * answer for a fault that belongs to one way OUT of a stage. The author read
 * "the ‘Send to legal’ transition assigns work but names no assignment key",
 * looked at a node badge, opened the stage, and then had to match that name
 * against every row in its exit list by eye.
 *
 * So an error carries a target: the node, edge or status group whose panel
 * fixes it, in the vocabulary the editor's selection already speaks. The
 * blocked-save notice offers to open it, and the stage panel's exit list flags
 * the row it names.
 *
 * @package
 */

import { render, screen } from './helpers/render-wp-component';

import StageInspector from '../../src/admin/components/graph/StageInspector';
import {
	buildGraph,
	edgeId,
	isTransitionDisabled,
	validateSequence,
} from '../../src/admin/components/graph/graph-model';

// A two-stage workflow whose first transition captures an assignment. The key is
// left blank per-test, which is one of the four faults the server refuses
// (`invalid_assignment_key`).
const withAssignment = ( input, extra = {} ) => [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
		is_terminal: false,
		transitions: [
			{ to: 'legal', label: 'Send to legal', inputs: [ input ] },
		],
		...extra,
	},
	{
		key: 'legal',
		label: 'Legal',
		status: 'draft',
		region_entry: false,
		is_terminal: true,
		transitions: [],
	},
];

const blockers = ( stages ) =>
	validateSequence( { name: 'Flow', stages } ).errors;

describe( 'a blocking error names what is at fault', () => {
	it( 'points an assignment-slot fault at the transition, not just its stage', () => {
		const found = blockers(
			withAssignment( { type: 'assignment', meta_key: '' } )
		).find( ( e ) => e.message.includes( 'Send to legal' ) );

		expect( found ).toBeDefined();
		expect( found.target ).toEqual( {
			type: 'edge',
			from: 'draft',
			to: 'legal',
			outcome: null,
		} );
	} );

	it( 'points a gate with no key at the transition holding the gate', () => {
		const stages = withAssignment( {
			type: 'assignment',
			meta_key: 'legal-reviewer',
		} );
		// The shape the "Restrict to an assignee" toggle creates: a gate that
		// exists and names nothing yet. A falsy `requires_assignment` is no
		// gate at all, and is rightly not reported.
		stages[ 1 ].transitions = [
			{
				to: 'draft',
				label: 'Send back',
				requires_assignment: { meta_key: '', match: 'current_user' },
			},
		];
		stages[ 1 ].is_terminal = false;
		stages[ 0 ].is_terminal = true;

		const found = blockers( stages ).find( ( e ) =>
			e.message.includes( 'Send back' )
		);

		expect( found ).toBeDefined();
		expect( found.target ).toEqual( {
			type: 'edge',
			from: 'legal',
			to: 'draft',
			outcome: null,
		} );
	} );

	// The canvas draws an AI stage's transition once per outcome routed along
	// it, and the edge id carries that outcome. A target naming the bare pair
	// would select an edge the canvas does not hold.
	it( 'carries the outcome an AI stage draws the transition under', () => {
		const found = blockers(
			withAssignment(
				{ type: 'assignment', meta_key: '' },
				{
					agent: {
						ability_id: 'a/b',
						routing: { pass: 'legal' },
					},
				}
			)
		).find( ( e ) => e.message.includes( 'Send to legal' ) );

		expect( found ).toBeDefined();
		expect( found.target.outcome ).toBe( 'pass' );
	} );

	// The whole point of naming the edge is that the canvas holds one by that
	// name. Every rule `buildGraph` draws by — a phase sequence routes no
	// outcomes, a transition to a stage that is gone draws no line — has to
	// reach the target too, or the notice offers to open something that is not
	// there. Asserted against `buildGraph` itself rather than against a
	// hand-written id, so the two cannot drift apart.
	const drawnEdgeIds = ( stages, options ) =>
		buildGraph( stages, options ).edges.map( ( e ) => e.id );

	it( 'names an edge the canvas actually drew', () => {
		const stages = withAssignment(
			{ type: 'assignment', meta_key: '' },
			{ agent: { ability_id: 'a/b', routing: { pass: 'legal' } } }
		);
		const found = blockers( stages ).find( ( e ) =>
			e.message.includes( 'Send to legal' )
		);

		expect( found ).toBeDefined();
		const { target } = found;
		expect( drawnEdgeIds( stages ) ).toContain(
			edgeId( target.from, target.to, target.outcome )
		);
	} );

	// A phase sequence carries no agent routing onto the canvas, so neither may
	// the target — the assignment rules run on every sequence type, and an
	// imported phase sequence can hold both an agent and the wiring it faults.
	it( 'drops the outcome in a phase sequence, as the canvas does', () => {
		const stages = [
			{
				key: 'ideation',
				label: 'Ideation',
				agent: { ability_id: 'a/b', routing: { pass: 'editorial' } },
				transitions: [
					{
						to: 'editorial',
						label: 'Promote',
						inputs: [ { type: 'assignment', meta_key: '' } ],
					},
				],
			},
			{ key: 'editorial', label: 'Editorial', transitions: [] },
		];
		const { errors } = validateSequence( {
			name: 'Flow',
			isPhase: true,
			stages,
		} );
		const found = errors.find( ( e ) => e.message.includes( 'Promote' ) );

		expect( found ).toBeDefined();
		const { target } = found;
		expect( target.outcome ).toBeNull();
		expect( drawnEdgeIds( stages, { isPhase: true } ) ).toContain(
			edgeId( target.from, target.to, target.outcome )
		);
	} );

	// A route to a stage that is gone claims nothing: the canvas draws no line
	// for it, and the stage panel refuses to absorb it into the outcome's row.
	// The target has to answer the same way or the fault is flagged nowhere.
	it( 'drops the outcome when the destination stage is gone', () => {
		const stages = withAssignment(
			{ type: 'assignment', meta_key: '' },
			{ agent: { ability_id: 'a/b', routing: { pass: 'ghost' } } }
		);
		stages[ 0 ].transitions[ 0 ].to = 'ghost';

		const found = blockers( stages ).find( ( e ) =>
			e.message.includes( 'Send to legal' )
		);

		expect( found ).toBeDefined();
		expect( found.target.outcome ).toBeNull();
	} );

	// Two halves of the same report: the notice can open the transition, and
	// the node still carries the message so the canvas says which stage to look
	// at. Losing the second half would leave a fault visible only after Save.
	it( 'still marks the stage the transition leaves', () => {
		const { warnings } = validateSequence( {
			name: 'Flow',
			stages: withAssignment( { type: 'assignment', meta_key: '' } ),
		} );

		expect( ( warnings.draft || [] ).join( ' ' ) ).toContain(
			'Send to legal'
		);
	} );

	// A fault of the sequence itself has nothing on the canvas to open, and
	// says so by carrying null rather than by naming a stage at random.
	it( 'leaves a sequence-level fault untargeted', () => {
		const { errors } = validateSequence( {
			name: '   ',
			stages: withAssignment( {
				type: 'assignment',
				meta_key: 'legal-reviewer',
			} ),
		} );

		const unnamed = errors.find( ( e ) =>
			e.message.includes( 'has no name' )
		);
		expect( unnamed ).toBeDefined();
		expect( unnamed.target ).toBeNull();
	} );

	it( 'points a status group with no checkpoint at the group', () => {
		const stages = withAssignment( {
			type: 'assignment',
			meta_key: 'legal-reviewer',
		} ).map( ( s ) => ( { ...s, region_entry: false } ) );

		const found = blockers( stages ).find( ( e ) =>
			e.message.includes( 'entry checkpoint' )
		);

		expect( found ).toBeDefined();
		expect( found.target ).toEqual( { type: 'region', region: 'draft' } );
	} );
} );

describe( 'the stage panel flags the exit at fault', () => {
	const reviewStage = ( overrides = {} ) => ( {
		key: 'review',
		label: 'Review',
		transitions: [ { to: 'done', label: 'Approve' } ],
		...overrides,
	} );

	const renderInspector = ( stage, exitProblems ) =>
		render(
			<StageInspector
				stage={ stage }
				availableAgents={ [] }
				resolveStageLabel={ ( key ) =>
					key === 'done' ? 'Done' : key
				}
				stageExists={ () => true }
				isTransitionDisabled={ ( to ) =>
					isTransitionDisabled( stage, to, [ stage ], false )
				}
				onChange={ () => {} }
				onDelete={ () => {} }
				onSelectEdge={ () => {} }
				canDelete
				isKeyInUse={ () => false }
				exitProblems={ exitProblems }
			/>
		);

	it( 'reads normally when nothing is at fault', () => {
		renderInspector( reviewStage(), {} );

		expect( screen.queryByText( 'Needs attention' ) ).toBeNull();
		expect( screen.getByText( 'Done' ) ).toBeInTheDocument();
	} );

	it( 'flags the row of the transition the error names', () => {
		renderInspector( reviewStage(), {
			[ edgeId( 'review', 'done' ) ]: [
				'The “Approve” transition assigns work but names no assignment key.',
			],
		} );

		// The flag takes the value column, so a closed panel still shows which
		// exit is wrong without opening it.
		const row = screen.getByRole( 'button', {
			name: /assigns work but names no assignment key/,
		} );
		expect( row ).toHaveTextContent( 'Needs attention' );
		expect( row ).toHaveTextContent( 'Approve' );

		// The whole message joins the accessible name rather than replacing it:
		// a name that is only the complaint says neither what the button does
		// nor which exit it belongs to.
		expect( row ).toHaveAccessibleName(
			expect.stringContaining( 'Select Approve' )
		);
	} );

	// The transition an outcome routes along is absorbed into the outcome's
	// row, so that is the row the fault has to reach — there is no separate
	// transition row left to carry it.
	it( 'flags the outcome row that absorbed the transition', () => {
		renderInspector(
			reviewStage( {
				agent: { ability_id: 'a/b', routing: { pass: 'done' } },
			} ),
			{
				[ edgeId( 'review', 'done' ) ]: [
					'The “Approve” transition assigns to a key another transition already assigns.',
				],
			}
		);

		const row = screen.getByRole( 'button', {
			name: /a key another transition already assigns/,
		} );
		expect( row ).toHaveTextContent( 'Needs attention' );
	} );

	// Two outcomes routed to one destination are two rows naming one
	// transition. The fault is keyed by that transition, not by either
	// outcome — so both rows find it, or one of a pair of identical rows reads
	// clean and an author working from it concludes the panel is lying.
	it( 'flags every outcome row the faulted transition is named by', () => {
		renderInspector(
			reviewStage( {
				agent: {
					ability_id: 'a/b',
					routing: { pass: 'done', fail: 'done' },
				},
			} ),
			{
				[ edgeId( 'review', 'done' ) ]: [
					'The “Approve” transition assigns work but names no assignment key.',
				],
			}
		);

		expect( screen.getAllByText( /Needs attention/ ) ).toHaveLength( 2 );
	} );

	// A transition to a stage that is gone draws no edge, so its row in this
	// list is the only place the panel can say the exit points nowhere — and
	// the only reachable home of its panel and its Remove. A fault that took
	// the value column outright took the "(missing)" with it, leaving the row
	// saying something is wrong and no longer saying what.
	it( 'keeps reporting a missing destination on a row that is also at fault', () => {
		render(
			<StageInspector
				stage={ reviewStage( {
					transitions: [ { to: 'ghost', label: 'Approve' } ],
				} ) }
				availableAgents={ [] }
				resolveStageLabel={ ( key ) => key }
				stageExists={ () => false }
				isTransitionDisabled={ () => false }
				onChange={ () => {} }
				onDelete={ () => {} }
				onSelectEdge={ () => {} }
				canDelete
				isKeyInUse={ () => false }
				exitProblems={ {
					[ edgeId( 'review', 'ghost' ) ]: [
						'The “Approve” transition assigns work but names no assignment key.',
					],
				} }
			/>
		);

		const row = screen.getByRole( 'button', {
			name: /assigns work but names no assignment key/,
		} );
		expect( row ).toHaveTextContent( 'Needs attention' );
		expect( row ).toHaveTextContent( 'ghost (missing)' );
	} );

	// A disabled transition is a state someone chose; a refused save is not.
	it( 'lets the fault win the value column over “(disabled)”', () => {
		renderInspector(
			reviewStage( {
				transitions: [
					{ to: 'done', label: 'Approve' },
					{ to: 'spike', label: 'Spike' },
				],
				agent: { ability_id: 'a/b', routing: { pass: 'done' } },
			} ),
			{
				[ edgeId( 'review', 'spike' ) ]: [
					'The “Spike” transition is restricted to an assignee but names no assignment key.',
				],
			}
		);

		const row = screen.getByRole( 'button', {
			name: /restricted to an assignee but names no assignment key/,
		} );
		expect( row ).toHaveTextContent( 'Needs attention' );
		expect( row ).not.toHaveTextContent( '(disabled)' );
	} );
} );
