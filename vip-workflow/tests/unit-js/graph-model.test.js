/**
 * Unit tests for the sequence graph model.
 *
 * @package
 */

import {
	edgeId,
	parseEdgeId,
	buildGraph,
	addStage,
	removeStage,
	updateStage,
	addTransition,
	rewireTransition,
	updateTransition,
	removeTransition,
	findTransition,
	addStageFromNode,
	insertStageOnEdge,
	setEntryStage,
	setRegionEntry,
	setStageStatus,
	stageRegion,
	connectEdge,
	reconnectEdge,
	reconnectEdgeToNewStage,
	canReconnectToNewStage,
	entryStageKey,
	disconnectEdge,
	setStageAgent,
	routeOutcome,
	clearOutcome,
	isAgentStage,
	isTransitionDisabled,
	outcomesRoutedTo,
	agentOutcomeNames,
	validateSequence,
	NODE_TYPE,
	START_ID,
	canReconnect,
	END_ID,
	TERMINAL_NODE_TYPE,
} from '../../src/admin/components/graph/graph-model';

const stages = () => [
	{
		key: 'draft',
		label: 'Draft',
		color: '#C36EFF',
		is_terminal: false,
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'review', label: 'Submit' } ],
	},
	{
		key: 'review',
		label: 'Review',
		color: '#FF51A8',
		is_terminal: false,
		status: 'draft',
		region_entry: false,
		transitions: [
			{
				to: 'done',
				label: 'Approve',
				allowed_roles: [ 'editor' ],
				required_tools: [ 'seo' ],
			},
		],
	},
	{
		key: 'done',
		label: 'Done',
		color: '#00A2C3',
		is_terminal: true,
		status: 'publish',
		region_entry: true,
		transitions: [],
	},
];

// A phase sequence and the hand-off the server requires of it. The list is the
// server's answer, not a constant the editor keeps — it is passed in here the
// same way `/sequences/options` passes it to the canvas.
const IDEATION_TO_EDITORIAL = [ { from: 'ideation', to: 'editorial' } ];

const LIFECYCLE = [
	{
		key: 'ideation',
		label: 'Ideation',
		transitions: [ { to: 'editorial', label: 'Go' } ],
	},
	{ key: 'editorial', label: 'Editorial', transitions: [] },
];

describe( 'edgeId / parseEdgeId', () => {
	it( 'round-trips endpoints', () => {
		expect( edgeId( 'a', 'b' ) ).toBe( 'a->b' );
		expect( parseEdgeId( 'a->b' ) ).toEqual( {
			from: 'a',
			to: 'b',
			outcome: null,
		} );
	} );

	it( 'handles keys containing hyphens', () => {
		expect( parseEdgeId( 'in-progress->ready' ) ).toEqual( {
			from: 'in-progress',
			to: 'ready',
			outcome: null,
		} );
	} );

	it( 'round-trips an agent outcome, so two outcomes sharing a destination stay distinct edges', () => {
		expect( edgeId( 'review', 'done', 'pass' ) ).toBe(
			'review:pass->done'
		);
		expect( parseEdgeId( 'review:pass->done' ) ).toEqual( {
			from: 'review',
			to: 'done',
			outcome: 'pass',
		} );
		expect( edgeId( 'review', 'done', 'pass' ) ).not.toBe(
			edgeId( 'review', 'done', 'fail' )
		);
	} );
} );

describe( 'buildGraph', () => {
	it( 'projects stage nodes and transition edges', () => {
		const { nodes, edges } = buildGraph( stages() );
		expect( nodes.filter( ( n ) => n.type === NODE_TYPE ) ).toHaveLength(
			3
		);
		const ids = edges.map( ( e ) => e.id );
		expect( ids ).toContain( 'draft->review' );
		expect( ids ).toContain( 'review->done' );
	} );

	it( 'flags the entry node (no incoming edges)', () => {
		const { nodes } = buildGraph( stages() );
		const byId = Object.fromEntries( nodes.map( ( n ) => [ n.id, n ] ) );
		expect( byId.draft.data.isEntry ).toBe( true );
		expect( byId.review.data.isEntry ).toBe( false );
	} );

	it( 'marks terminal and publishing nodes', () => {
		const { nodes } = buildGraph( stages() );
		const done = nodes.find( ( n ) => n.id === 'done' );
		expect( done.data.isTerminal ).toBe( true );
		expect( done.data.publishes ).toBe( true );
	} );

	it( 'skips edges to a missing target', () => {
		const broken = [
			{ key: 'a', label: 'A', transitions: [ { to: 'ghost' } ] },
		];
		expect(
			buildGraph( broken ).edges.some( ( e ) => e.target === 'ghost' )
		).toBe( false );
	} );

	it( 'ignores terminal/publish flags in phase mode', () => {
		const { nodes } = buildGraph( stages(), { isPhase: true } );
		const done = nodes.find( ( n ) => n.id === 'done' );
		expect( done.data.isTerminal ).toBe( false );
		expect( done.data.publishes ).toBe( false );
	} );

	it( 'marks phase nodes non-deletable, workflow nodes deletable', () => {
		const phase = buildGraph( stages(), { isPhase: true } );
		phase.nodes
			.filter( ( n ) => n.type === NODE_TYPE )
			.forEach( ( n ) => expect( n.deletable ).toBe( false ) );

		const workflow = buildGraph( stages() );
		workflow.nodes
			.filter( ( n ) => n.type === NODE_TYPE )
			.forEach( ( n ) => expect( n.deletable ).toBe( true ) );
	} );

	it( 'reflects selection', () => {
		const { nodes, edges } = buildGraph( stages(), {
			selectedNodeKey: 'review',
			selectedEdgeId: 'draft->review',
		} );
		expect( nodes.find( ( n ) => n.id === 'review' ).selected ).toBe(
			true
		);
		expect( edges.find( ( e ) => e.id === 'draft->review' ).selected ).toBe(
			true
		);
	} );
} );

describe( 'Start / End endpoints', () => {
	it( 'adds Start and End nodes in workflow mode', () => {
		const { nodes } = buildGraph( stages() );
		const terminals = nodes.filter(
			( n ) => n.type === TERMINAL_NODE_TYPE
		);
		expect( terminals.map( ( n ) => n.id ) ).toEqual( [
			START_ID,
			END_ID,
		] );
	} );

	it( 'connects Start to the entry stage (statuses[0])', () => {
		const { edges } = buildGraph( stages() );
		expect(
			edges.some( ( e ) => e.source === START_ID && e.target === 'draft' )
		).toBe( true );
	} );

	it( 'connects Start to the draft region entry when it is not statuses[0]', () => {
		// Legacy/divergent data: review carries the draft checkpoint but sits
		// second. The Start edge follows the checkpoint, not the array order.
		const input = stages();
		input[ 0 ].region_entry = false;
		input[ 1 ].region_entry = true;
		const { edges } = buildGraph( input );
		expect(
			edges.some(
				( e ) => e.source === START_ID && e.target === 'review'
			)
		).toBe( true );
		expect(
			edges.some( ( e ) => e.source === START_ID && e.target === 'draft' )
		).toBe( false );
	} );

	it( 'connects each terminal stage to End', () => {
		const { edges } = buildGraph( stages() );
		const endEdges = edges.filter( ( e ) => e.target === END_ID );
		expect( endEdges.map( ( e ) => e.source ) ).toEqual( [ 'done' ] );
	} );

	it( 'omits Start/End in phase mode', () => {
		const { nodes } = buildGraph( stages(), { isPhase: true } );
		expect( nodes.some( ( n ) => n.type === TERMINAL_NODE_TYPE ) ).toBe(
			false
		);
	} );

	it( 'makes the Start edge non-deletable', () => {
		const { edges } = buildGraph( stages() );
		const startEdge = edges.find( ( e ) => e.source === START_ID );
		expect( startEdge.deletable ).toBe( false );
	} );

	it( 'keeps them out of the tab order, having nothing to do there', () => {
		// React Flow focuses every node unless told otherwise, and Start and End
		// can't be selected, moved or deleted — the edges either side of them
		// are the operable part. See A11Y-004.
		const { nodes } = buildGraph( stages() );
		nodes
			.filter( ( n ) => n.type === TERMINAL_NODE_TYPE )
			.forEach( ( n ) => {
				expect( n.focusable ).toBe( false );
				expect( n.selectable ).toBe( false );
			} );
	} );
} );

describe( 'setEntryStage', () => {
	it( 'moves the chosen stage to the front', () => {
		const next = setEntryStage( stages(), 'done' );
		expect( next.map( ( s ) => s.key ) ).toEqual( [
			'done',
			'draft',
			'review',
		] );
	} );

	it( 'is a no-op when already first or missing', () => {
		expect( setEntryStage( stages(), 'draft' ) ).toEqual( stages() );
		expect( setEntryStage( stages(), 'nope' ) ).toEqual( stages() );
	} );

	it( 'claims the draft region entry checkpoint for a draft-region target', () => {
		// Start edge and the draft region_entry are the same concept: dragging
		// Start onto review reorders AND moves the draft checkpoint to it.
		const next = setEntryStage( stages(), 'review' );
		expect( next.map( ( s ) => s.key ) ).toEqual( [
			'review',
			'draft',
			'done',
		] );
		expect( next.find( ( s ) => s.key === 'review' ).region_entry ).toBe(
			true
		);
		expect( next.find( ( s ) => s.key === 'draft' ).region_entry ).toBe(
			false
		);
		// Other regions are untouched.
		expect( next.find( ( s ) => s.key === 'done' ).region_entry ).toBe(
			true
		);
	} );

	it( 'only reorders for a target outside the draft region', () => {
		const input = stages();
		input[ 2 ].region_entry = false; // publish region: no marked entry
		const next = setEntryStage( input, 'done' );
		expect( next[ 0 ].key ).toBe( 'done' );
		// The publish region's (absent) entry is NOT claimed…
		expect( next[ 0 ].region_entry ).toBe( false );
		// …and the draft region's checkpoint is untouched.
		expect( next.find( ( s ) => s.key === 'draft' ).region_entry ).toBe(
			true
		);
	} );
} );

describe( 'setRegionEntry', () => {
	it( 'moves the entry marker within the region (radio semantics)', () => {
		const next = setRegionEntry( stages(), 'review' );
		expect( next.find( ( s ) => s.key === 'review' ).region_entry ).toBe(
			true
		);
		expect( next.find( ( s ) => s.key === 'draft' ).region_entry ).toBe(
			false
		);
		// Another region's entry is untouched, and order is preserved.
		expect( next.find( ( s ) => s.key === 'done' ).region_entry ).toBe(
			true
		);
		expect( next.map( ( s ) => s.key ) ).toEqual( [
			'draft',
			'review',
			'done',
		] );
	} );

	it( 'is a no-op when the stage is already the sole entry or missing', () => {
		const input = stages();
		expect( setRegionEntry( input, 'draft' ) ).toBe( input );
		expect( setRegionEntry( input, 'nope' ) ).toBe( input );
	} );
} );

describe( 'setStageStatus', () => {
	it( 'drops the checkpoint of the region a stage leaves, promoting nobody', () => {
		// draft holds the draft region's checkpoint and moves to pending. It
		// can't be the entry of a region it isn't in any more, and which stage
		// takes over is a position the author sets — so draft leaves the slot
		// empty behind it rather than handing it to review.
		const next = setStageStatus( stages(), 'draft', 'pending' );
		const draft = next.find( ( s ) => s.key === 'draft' );
		expect( draft.status ).toBe( 'pending' );
		expect( draft.region_entry ).toBe( false );
		expect( next.find( ( s ) => s.key === 'review' ).region_entry ).toBe(
			false
		);
	} );

	it( 'does not claim the checkpoint of the region a stage arrives in', () => {
		// review (not an entry) moves into publish, where done is the entry.
		const next = setStageStatus( stages(), 'review', 'publish' );
		const review = next.find( ( s ) => s.key === 'review' );
		expect( review.status ).toBe( 'publish' );
		expect( review.region_entry ).toBe( false );
		expect( next.find( ( s ) => s.key === 'done' ).region_entry ).toBe(
			true
		);
		// The old (draft) region's entry didn't move — review wasn't it.
		expect( next.find( ( s ) => s.key === 'draft' ).region_entry ).toBe(
			true
		);
	} );

	it( 'leaves an empty new region without a checkpoint', () => {
		// pending holds no stages; arriving there does not fill its slot.
		const next = setStageStatus( stages(), 'review', 'pending' );
		expect( next.find( ( s ) => s.key === 'review' ).region_entry ).toBe(
			false
		);
	} );

	it( 'is a no-op for the same region and persists a missing explicit status', () => {
		const input = stages();
		expect( setStageStatus( input, 'draft', 'draft' ) ).toBe( input );

		// A legacy stage with no `status` sits in the draft region; selecting
		// draft still writes the explicit value.
		const legacy = [
			{ key: 'a', label: 'A', is_terminal: true, transitions: [] },
		];
		const next = setStageStatus( legacy, 'a', 'draft' );
		expect( next[ 0 ].status ).toBe( 'draft' );
	} );
} );

describe( 'stageRegion', () => {
	it( 'reads the stage status, defaulting a missing value to draft', () => {
		expect( stageRegion( { status: 'publish' } ) ).toBe( 'publish' );
		expect( stageRegion( {} ) ).toBe( 'draft' );
	} );
} );

describe( 'stage mutations', () => {
	it( 'addStage appends a uniquely-keyed stage', () => {
		const { stages: next, key } = addStage( stages() );
		expect( next ).toHaveLength( 4 );
		expect( next.some( ( s ) => s.key === key ) ).toBe( true );
		expect( new Set( next.map( ( s ) => s.key ) ).size ).toBe( 4 );
	} );

	it( 'removeStage drops the stage and inbound transitions', () => {
		const next = removeStage( stages(), 'review' );
		expect( next.map( ( s ) => s.key ) ).toEqual( [ 'draft', 'done' ] );
		// draft -> review is gone since review no longer exists.
		expect( next[ 0 ].transitions ).toHaveLength( 0 );
	} );

	it( 'updateStage rewires transitions when the key changes', () => {
		const next = updateStage( stages(), 'review', { key: 'qa' } );
		expect( next.find( ( s ) => s.key === 'qa' ) ).toBeTruthy();
		expect( next[ 0 ].transitions[ 0 ].to ).toBe( 'qa' );
	} );

	it( 'updateStage merges non-key fields', () => {
		const next = updateStage( stages(), 'draft', { label: 'Drafting' } );
		expect( next[ 0 ].label ).toBe( 'Drafting' );
		expect( next[ 0 ].key ).toBe( 'draft' );
	} );

	it( 'updateStage refuses a key rename onto an existing key', () => {
		const input = stages();
		const next = updateStage( input, 'review', { key: 'done' } );
		// No-op: same array back, no stage mutated, keys still unique.
		expect( next ).toBe( input );
		expect( next.map( ( s ) => s.key ) ).toEqual( [
			'draft',
			'review',
			'done',
		] );
		expect( next.find( ( s ) => s.key === 'done' ).label ).toBe( 'Done' );
	} );

	it( 'updateStage rejects the whole change when the key collides', () => {
		// Other fields riding along with a colliding key must not apply either —
		// a partial merge would desync the inspector from the model.
		const next = updateStage( stages(), 'review', {
			key: 'draft',
			label: 'Renamed',
		} );
		expect( next.find( ( s ) => s.label === 'Renamed' ) ).toBeUndefined();
		expect( next.filter( ( s ) => s.key === 'draft' ) ).toHaveLength( 1 );
	} );

	it( 'does not mutate the input array', () => {
		const input = stages();
		removeStage( input, 'review' );
		expect( input ).toHaveLength( 3 );
	} );
} );

describe( 'transition mutations', () => {
	it( 'addTransition adds a new edge', () => {
		const next = addTransition( stages(), 'draft', 'done' );
		expect( findTransition( next, 'draft', 'done' ) ).toBeTruthy();
	} );

	it( 'addTransition refuses self-loops and duplicates', () => {
		expect( addTransition( stages(), 'draft', 'draft' ) ).toEqual(
			stages()
		);
		// draft->review already exists.
		const same = addTransition( stages(), 'draft', 'review' );
		expect(
			same.find( ( s ) => s.key === 'draft' ).transitions
		).toHaveLength( 1 );
	} );

	it( 'rewireTransition repoints and preserves fields', () => {
		const next = rewireTransition( stages(), 'review', 'done', 'draft' );
		const t = findTransition( next, 'review', 'draft' );
		expect( t ).toBeTruthy();
		expect( t.allowed_roles ).toEqual( [ 'editor' ] );
		expect( findTransition( next, 'review', 'done' ) ).toBeNull();
	} );

	it( 'rewireTransition is a no-op for a duplicate target', () => {
		// review already -> done; add review -> draft, then try to rewire it to done.
		const withExtra = addTransition( stages(), 'review', 'draft' );
		const next = rewireTransition( withExtra, 'review', 'draft', 'done' );
		expect( next ).toEqual( withExtra );
	} );

	it( 'updateTransition merges fields', () => {
		const next = updateTransition( stages(), 'draft', 'review', {
			show_in_queue: true,
		} );
		expect( findTransition( next, 'draft', 'review' ).show_in_queue ).toBe(
			true
		);
	} );

	it( 'removeTransition deletes the edge', () => {
		const next = removeTransition( stages(), 'draft', 'review' );
		expect( findTransition( next, 'draft', 'review' ) ).toBeNull();
	} );
} );

describe( 'addStageFromNode', () => {
	it( 'adds a stage and connects the source to it', () => {
		const { stages: next, key } = addStageFromNode( stages(), 'draft' );
		expect( next.some( ( s ) => s.key === key ) ).toBe( true );
		expect( findTransition( next, 'draft', key ) ).toBeTruthy();
		// The pre-existing draft -> review transition is untouched.
		expect( findTransition( next, 'draft', 'review' ) ).toBeTruthy();
	} );

	it( 'makes the new stage the entry when it flows out of Start', () => {
		const { stages: next, key } = addStageFromNode( stages(), START_ID );
		expect( next[ 0 ].key ).toBe( key );
		expect( next[ 0 ].region_entry ).toBe( true );
		// Start holds no transitions of its own.
		expect( next.some( ( s ) => s.key === START_ID ) ).toBe( false );
	} );

	it( 'connects a stage dropped into a region that already has its checkpoint', () => {
		// The new stage sits mid-region in publish, past the stage core lands a
		// post on, and the edge reaches it. Nothing about where a region's
		// checkpoint sits decides where an edge may point.
		const { stages: next, key } = addStageFromNode( stages(), 'draft', {
			status: 'publish',
		} );

		expect( key ).not.toBeNull();
		expect( next.find( ( s ) => s.key === key ).status ).toBe( 'publish' );
		expect( findTransition( next, 'draft', key ) ).not.toBeNull();
	} );

	it( 'connects a stage dropped into an earlier region — the "send back" shape', () => {
		const { stages: next, key } = addStageFromNode( stages(), 'done', {
			status: 'draft',
		} );

		expect( key ).not.toBeNull();
		expect( next.find( ( s ) => s.key === key ).status ).toBe( 'draft' );
		expect( findTransition( next, 'done', key ) ).not.toBeNull();
	} );

	it( 'routes an outcome at a stage dropped in another region', () => {
		const withAgent = setStageAgent( stages(), 'draft', 'test/agent' );
		const { stages: next, key } = addStageFromNode( withAgent, 'draft', {
			status: 'publish',
			outcome: 'pass',
		} );

		expect( key ).not.toBeNull();
		expect(
			next.find( ( s ) => s.key === 'draft' ).agent.routing.pass
		).toBe( key );
	} );

	it( 'creates nothing when the connection it exists to make is refused', () => {
		// The source is not a stage, so no edge can be made — and the gesture is
		// a connection, so a stage left behind would be an orphan no post could
		// ever reach.
		const before = stages();
		const { stages: next, key } = addStageFromNode( before, 'nowhere' );

		expect( key ).toBeNull();
		expect( next ).toBe( before );
	} );
} );

describe( 'insertStageOnEdge', () => {
	it( 'splits an edge into from -> new -> to', () => {
		const { stages: next, key } = insertStageOnEdge(
			stages(),
			'review',
			'done'
		);
		expect( findTransition( next, 'review', 'done' ) ).toBeNull();
		expect( findTransition( next, 'review', key ) ).toBeTruthy();
		expect( findTransition( next, key, 'done' ) ).toBeTruthy();
	} );

	it( 'keeps the original transition config on the first hop', () => {
		const { stages: next, key } = insertStageOnEdge(
			stages(),
			'review',
			'done'
		);
		// review -> done carried allowed_roles/required_tools; they ride to
		// review -> new, while new -> done is a fresh basic transition.
		expect( findTransition( next, 'review', key ).allowed_roles ).toEqual( [
			'editor',
		] );
		expect(
			findTransition( next, key, 'done' ).allowed_roles
		).toBeUndefined();
	} );
} );

describe( 'connectEdge', () => {
	it( 'Start → stage reassigns the entry stage and its region checkpoint', () => {
		const { stages: next, selection } = connectEdge(
			stages(),
			START_ID,
			'review'
		);
		expect( next[ 0 ].key ).toBe( 'review' );
		expect( next[ 0 ].region_entry ).toBe( true );
		expect( next.find( ( s ) => s.key === 'draft' ).region_entry ).toBe(
			false
		);
		expect( selection ).toEqual( { from: START_ID, to: 'review' } );
	} );

	it( 'stage → End marks the source stage terminal', () => {
		const { stages: next, selection } = connectEdge(
			stages(),
			'review',
			END_ID
		);
		expect( next.find( ( s ) => s.key === 'review' ).is_terminal ).toBe(
			true
		);
		// No transition object is created for the synthetic edge.
		expect( findTransition( next, 'review', END_ID ) ).toBeNull();
		expect( selection ).toEqual( { from: 'review', to: END_ID } );
	} );

	it( 'stage → stage adds a transition', () => {
		const { stages: next, selection } = connectEdge(
			stages(),
			'draft',
			'done'
		);
		expect( findTransition( next, 'draft', 'done' ) ).toBeTruthy();
		expect( selection ).toEqual( { from: 'draft', to: 'done' } );
	} );
} );

describe( 'reconnectEdge', () => {
	it( 'moving the Start edge re-points the flow entry', () => {
		const { stages: next, selection } = reconnectEdge(
			stages(),
			START_ID,
			'draft',
			START_ID,
			'review'
		);
		expect( next[ 0 ].key ).toBe( 'review' );
		expect( selection ).toEqual( { from: START_ID, to: 'review' } );
	} );

	it( 'refuses a source endpoint dragged onto Start', () => {
		// The edge draft -> review is grabbed at its source and dropped on
		// Start. Start has no transition to hand over, so the dragged edge
		// would stay where it is while the flow entry moved out from under it.
		// Reassigning the entry is the Start edge's own gesture.
		const input = stages();
		const { stages: next, selection } = reconnectEdge(
			input,
			'draft',
			'review',
			START_ID,
			'review'
		);
		expect( next ).toBe( input );
		expect( selection ).toBeNull();
		expect(
			canReconnect( input, 'draft', 'review', START_ID, 'review' )
		).toBe( false );
	} );

	it( 'dragging a target endpoint onto End marks the source terminal and drops the old transition', () => {
		const { stages: next, selection } = reconnectEdge(
			stages(),
			'draft',
			'review',
			'draft',
			END_ID
		);
		expect( next.find( ( s ) => s.key === 'draft' ).is_terminal ).toBe(
			true
		);
		// The endpoint moved to the exit — the original transition is gone
		// rather than left behind alongside the new terminal flag.
		expect( findTransition( next, 'draft', 'review' ) ).toBeNull();
		expect( selection ).toEqual( { from: 'draft', to: END_ID } );
	} );

	it( 'same source: repoints the transition target', () => {
		const { stages: next, selection } = reconnectEdge(
			stages(),
			'draft',
			'review',
			'draft',
			'done'
		);
		expect( findTransition( next, 'draft', 'review' ) ).toBeNull();
		expect( findTransition( next, 'draft', 'done' ) ).toBeTruthy();
		expect( selection ).toEqual( { from: 'draft', to: 'done' } );
	} );

	it( 'new source: carries roles/tools over to the new transition', () => {
		// review -> done (with allowed_roles + required_tools) moves to draft -> done.
		const { stages: next, selection } = reconnectEdge(
			stages(),
			'review',
			'done',
			'draft',
			'done'
		);
		expect( findTransition( next, 'review', 'done' ) ).toBeNull();
		const moved = findTransition( next, 'draft', 'done' );
		expect( moved.allowed_roles ).toEqual( [ 'editor' ] );
		expect( moved.required_tools ).toEqual( [ 'seo' ] );
		expect( selection ).toEqual( { from: 'draft', to: 'done' } );
	} );

	it( 'no-ops when the new source already has the transition', () => {
		// draft -> review exists; dragging review -> done onto draft -> review
		// would destroy the original and create nothing.
		const withExtra = addTransition( stages(), 'review', 'draft' );
		const { stages: next, selection } = reconnectEdge(
			withExtra,
			'review',
			'draft',
			'draft',
			'review'
		);
		expect( next ).toBe( withExtra );
		expect( selection ).toBeNull();
	} );

	it( 'no-ops when the Start edge is dropped outside the draft region', () => {
		// `done` is in `publish`, and the flow entry is the draft region's
		// checkpoint — so `setEntryStage` can only reorder, and the Start edge
		// would spring straight back to `draft`.
		const before = stages();
		const { stages: next, selection } = reconnectEdge(
			before,
			START_ID,
			'draft',
			START_ID,
			'done'
		);
		expect( next ).toBe( before );
		expect( selection ).toBeNull();
	} );

	it( 'no-ops when the target endpoint reaches End from a stage that already exits', () => {
		// `done` is already terminal, so its End edge is on the canvas: the
		// gesture would only delete `done -> draft` and its settings.
		const before = addTransition( stages(), 'done', 'draft' );
		const { stages: next, selection } = reconnectEdge(
			before,
			'done',
			'draft',
			'done',
			END_ID
		);
		expect( next ).toBe( before );
		expect( selection ).toBeNull();
	} );

	it( 'carries the route’s settings when an outcome edge is re-pointed', () => {
		const withAgent = setStageAgent( stages(), 'review', 'ability/x' );
		const routed = routeOutcome( withAgent, 'review', 'pass', 'done' );
		const { stages: next } = reconnectEdge(
			routed,
			'review',
			'done',
			'review',
			'draft',
			'pass'
		);
		const moved = findTransition( next, 'review', 'draft' );
		expect( moved.allowed_roles ).toEqual( [ 'editor' ] );
		expect( moved.required_tools ).toEqual( [ 'seo' ] );
	} );

	it( 'takes the transition with it when an outcome edge is re-pointed', () => {
		const withAgent = setStageAgent( stages(), 'review', 'ability/x' );
		const routed = routeOutcome( withAgent, 'review', 'pass', 'done' );
		const { stages: next } = reconnectEdge(
			routed,
			'review',
			'done',
			'review',
			'draft',
			'pass'
		);
		// The settings above were COPIED onto the new destination, so leaving
		// the old transition behind would put the same configuration — an
		// assignment slot included — on this stage twice, which neither
		// `validateSequence` nor the write gate will save.
		expect( findTransition( next, 'review', 'done' ) ).toBeNull();
	} );

	it( 'leaves the old transition when another outcome still travels it', () => {
		let routed = setStageAgent( stages(), 'review', 'ability/x' );
		routed = routeOutcome( routed, 'review', 'pass', 'done' );
		routed = routeOutcome( routed, 'review', 'fail', 'done' );
		const { stages: next } = reconnectEdge(
			routed,
			'review',
			'done',
			'review',
			'draft',
			'pass'
		);
		expect( findTransition( next, 'review', 'done' ) ).toBeTruthy();
		expect( findTransition( next, 'review', 'draft' ) ).toBeTruthy();
	} );
} );

describe( 'canReconnect', () => {
	// The predicate exists so the canvas can colour the lead line without
	// building a stages tree per pointer frame. Its only contract is that it
	// agrees with `reconnectEdge` — which gates on it — so these cases check
	// the two together rather than the boolean alone.
	const agrees = ( input, ...move ) => {
		const { selection } = reconnectEdge( input, ...move );
		const predicted = canReconnect( input, ...move );
		expect( predicted ).toBe( selection !== null );
		return predicted;
	};

	it( 'accepts a plain target-endpoint move', () => {
		expect( agrees( stages(), 'draft', 'review', 'draft', 'done' ) ).toBe(
			true
		);
	} );

	it( 'accepts a source-endpoint move onto another stage', () => {
		expect( agrees( stages(), 'draft', 'review', 'done', 'review' ) ).toBe(
			true
		);
	} );

	it( 'refuses a move that changes nothing', () => {
		expect( agrees( stages(), 'draft', 'review', 'draft', 'review' ) ).toBe(
			false
		);
	} );

	it( 'refuses a self-loop', () => {
		expect( agrees( stages(), 'draft', 'review', 'draft', 'draft' ) ).toBe(
			false
		);
	} );

	it( 'refuses an endpoint dropped on a key that is not a stage', () => {
		expect( agrees( stages(), 'draft', 'review', 'draft', 'nope' ) ).toBe(
			false
		);
	} );

	it( 'refuses a duplicate transition', () => {
		const withExtra = addTransition( stages(), 'review', 'draft' );
		expect(
			agrees( withExtra, 'review', 'draft', 'draft', 'review' )
		).toBe( false );
	} );

	it( 'refuses the Start edge outside the draft region, accepts it inside', () => {
		expect( agrees( stages(), START_ID, 'draft', START_ID, 'done' ) ).toBe(
			false
		);
		expect(
			agrees( stages(), START_ID, 'draft', START_ID, 'review' )
		).toBe( true );
	} );

	it( 'refuses End when the source already exits, accepts it otherwise', () => {
		expect( agrees( stages(), 'done', 'draft', 'done', END_ID ) ).toBe(
			false
		);
		expect( agrees( stages(), 'draft', 'review', 'draft', END_ID ) ).toBe(
			true
		);
	} );

	it( 'refuses a source endpoint dropped on an AI stage', () => {
		// An AI stage leaves only by an outcome, so a plain transition handed to
		// one is dead on arrival — and the gesture would take the original with
		// it.
		const withAgent = setStageAgent( stages(), 'done', 'ability/x' );
		expect( agrees( withAgent, 'draft', 'review', 'done', 'review' ) ).toBe(
			false
		);
	} );

	it( 'still moves the destination of a transition that leaves an AI stage', () => {
		// The rule above is about the end that MOVED. A transition already
		// leaving an AI stage (one no outcome claims, drawn disabled) keeps a
		// destination the author can re-point.
		const withAgent = setStageAgent( stages(), 'review', 'ability/x' );
		expect( agrees( withAgent, 'review', 'done', 'review', 'draft' ) ).toBe(
			true
		);
	} );

	it( "refuses an outcome edge's source endpoint, accepts its destination", () => {
		const routed = routeOutcome(
			setStageAgent( stages(), 'review', 'ability/x' ),
			'review',
			'pass',
			'done'
		);
		expect(
			agrees( routed, 'review', 'done', 'draft', 'done', 'pass' )
		).toBe( false );
		expect(
			agrees( routed, 'review', 'done', 'review', 'draft', 'pass' )
		).toBe( true );
	} );
} );

describe( 'canReconnectToNewStage', () => {
	// The canvas paints a ghost card wherever this says yes, so its only
	// contract is that it agrees with the mutation it predicts. A verdict that
	// promised a stage the release then refused to grow is a gesture that
	// silently does nothing.
	const agreesOnCreate = ( input, from, to, options ) => {
		const { key } = reconnectEdgeToNewStage( input, from, to, options );
		const predicted = canReconnectToNewStage( input, from, to, options );
		expect( predicted ).toBe( key !== null );
		return predicted;
	};

	it( 'accepts a plain destination released on open canvas', () => {
		expect( agreesOnCreate( stages(), 'draft', 'review', {} ) ).toBe(
			true
		);
	} );

	it( 'refuses a Start endpoint released outside the draft region', () => {
		expect(
			agreesOnCreate( stages(), START_ID, 'draft', { status: 'publish' } )
		).toBe( false );
	} );

	it( 'refuses a transition no outcome routes along', () => {
		const withAgent = setStageAgent( stages(), 'review', 'ability/x' );
		expect( agreesOnCreate( withAgent, 'review', 'done', {} ) ).toBe(
			false
		);
	} );
} );

describe( 'reconnectEdgeToNewStage', () => {
	it( 'moves the destination onto a stage it creates, leaving nothing behind', () => {
		const { stages: next, key } = reconnectEdgeToNewStage(
			stages(),
			'draft',
			'review'
		);
		expect( key ).toBeTruthy();
		// The gesture is one step: the endpoint moved, so the original is gone
		// rather than left alongside a second edge to the new stage.
		expect( findTransition( next, 'draft', 'review' ) ).toBeNull();
		expect( findTransition( next, 'draft', key ) ).toBeTruthy();
	} );

	it( 'carries the transition’s settings onto the new stage', () => {
		const { stages: next, key } = reconnectEdgeToNewStage(
			stages(),
			'review',
			'done'
		);
		const moved = findTransition( next, 'review', key );
		expect( moved.allowed_roles ).toEqual( [ 'editor' ] );
		expect( moved.required_tools ).toEqual( [ 'seo' ] );
	} );

	it( 'lands the new stage in the region it was released in', () => {
		const { stages: next, key } = reconnectEdgeToNewStage(
			stages(),
			'draft',
			'review',
			{ status: 'pending' }
		);
		expect( next.find( ( s ) => s.key === key ).status ).toBe( 'pending' );
	} );

	it( 'the Start edge re-points the flow entry at the new stage', () => {
		const { stages: next, key } = reconnectEdgeToNewStage(
			stages(),
			START_ID,
			'draft'
		);
		expect( next[ 0 ].key ).toBe( key );
		// The Start edge really lands on it, rather than the array merely being
		// reordered under an entry that stayed where it was.
		expect( entryStageKey( next ) ).toBe( key );
		// Start holds no transition to delete — the old entry stage survives.
		expect( next.some( ( s ) => s.key === 'draft' ) ).toBe( true );
	} );

	it( 'grows no stage for a Start edge released outside the draft region', () => {
		// The flow entry is the draft region's checkpoint, so a stage made in
		// another band could never take it — and would be left orphaned, with
		// nothing flowing into it.
		const before = stages();
		const { stages: next, key } = reconnectEdgeToNewStage(
			before,
			START_ID,
			'draft',
			{ status: 'publish' }
		);
		expect( key ).toBeNull();
		expect( next ).toBe( before );
	} );

	it( 'grows no stage off a disabled transition', () => {
		// `review` becomes an AI stage with nothing routed along `review -> done`,
		// so that edge is drawn disabled. A stage grown from it would be one no
		// content could ever reach.
		const before = setStageAgent( stages(), 'review', 'ability/x' );
		const { stages: next, key } = reconnectEdgeToNewStage(
			before,
			'review',
			'done'
		);
		expect( key ).toBeNull();
		expect( next ).toBe( before );
	} );

	it( 'carries the route’s settings onto a stage grown from an outcome edge', () => {
		const withAgent = setStageAgent( stages(), 'review', 'ability/x' );
		const routed = routeOutcome( withAgent, 'review', 'pass', 'done' );
		const { stages: next, key } = reconnectEdgeToNewStage(
			routed,
			'review',
			'done',
			{ outcome: 'pass' }
		);
		const moved = findTransition( next, 'review', key );
		expect( moved.allowed_roles ).toEqual( [ 'editor' ] );
		expect( moved.required_tools ).toEqual( [ 'seo' ] );
	} );

	it( 'routes an outcome to the new stage instead of adding a plain edge', () => {
		const withAgent = setStageAgent( stages(), 'review', 'ability/x' );
		const routed = routeOutcome( withAgent, 'review', 'pass', 'done' );
		const { stages: next, key } = reconnectEdgeToNewStage(
			routed,
			'review',
			'done',
			{ outcome: 'pass' }
		);
		expect(
			next.find( ( s ) => s.key === 'review' ).agent.routing.pass
		).toBe( key );
		expect( findTransition( next, 'review', key ) ).toBeTruthy();
	} );
} );

describe( 'disconnectEdge', () => {
	it( 'deleting a stage → End edge clears the terminal flag', () => {
		const next = disconnectEdge( stages(), 'done', END_ID );
		expect( next.find( ( s ) => s.key === 'done' ).is_terminal ).toBe(
			false
		);
	} );

	it( 'the Start edge cannot be deleted', () => {
		const input = stages();
		expect( disconnectEdge( input, START_ID, 'draft' ) ).toBe( input );
	} );

	it( 'deletes a normal transition', () => {
		const next = disconnectEdge( stages(), 'draft', 'review' );
		expect( findTransition( next, 'draft', 'review' ) ).toBeNull();
	} );
} );

describe( 'dangling transitions', () => {
	const withDangling = () => {
		const s = stages();
		s[ 1 ].transitions.push( { to: 'ghost', label: 'Schedule' } );
		return s;
	};

	it( 'excludes a dangling transition from the node count', () => {
		const { nodes } = buildGraph( withDangling() );
		const review = nodes.find( ( n ) => n.id === 'review' );
		// review keeps one routed transition (-> done); -> ghost is dropped.
		expect( review.data.transitionCount ).toBe( 1 );
	} );

	it( 'warns, naming the transition and the missing target', () => {
		const { warnings } = validateSequence( {
			name: 'Flow',
			stages: withDangling(),
		} );
		const message = ( warnings.review || [] ).join( ' ' );
		expect( message ).toContain( 'Schedule' );
		expect( message ).toContain( 'ghost' );
	} );
} );

describe( 'validateSequence', () => {
	it( 'accepts a well-formed workflow', () => {
		const result = validateSequence( { name: 'Flow', stages: stages() } );
		expect( result.valid ).toBe( true );
		expect( result.errors ).toHaveLength( 0 );
	} );

	it( 'requires a name', () => {
		const result = validateSequence( { name: '  ', stages: stages() } );
		expect( result.valid ).toBe( false );
	} );

	it( 'requires at least one terminal stage (workflow)', () => {
		const noTerminal = stages().map( ( s ) => ( {
			...s,
			is_terminal: false,
		} ) );
		const result = validateSequence( {
			name: 'Flow',
			stages: noTerminal,
		} );
		expect( result.valid ).toBe( false );
	} );

	/*
	 * A refused save has to say which stage and which gesture. "At least one
	 * stage must be marked as final" said neither, and it was the first thing
	 * anyone starting a sequence met.
	 */
	it( 'names the stage that should end the flow, and how to end it there', () => {
		const noTerminal = stages().map( ( s ) => ( {
			...s,
			is_terminal: false,
		} ) );
		const { errors } = validateSequence( {
			name: 'Flow',
			stages: noTerminal,
		} );
		const message = errors.join( ' ' );
		// The stage content would pile up in, by name, and the drag that fixes it.
		expect( message ).toContain( '“Done”' );
		expect( message ).toContain( 'End node' );
	} );

	it( 'uses a readable fallback when an unnamed, unkeyed stage is a dead end', () => {
		const { errors } = validateSequence( {
			name: 'Flow',
			stages: [
				{
					key: '',
					label: '',
					is_terminal: false,
					transitions: [],
				},
			],
		} );
		const message = errors.join( ' ' );

		expect( message ).toContain( 'an unnamed stage' );
		expect( message ).not.toContain( 'undefined' );
	} );

	it( 'says what to do when every stage has a way out but none ends the flow', () => {
		// draft ⇄ review, forever: nothing dead-ends, so there is no stage to
		// single out — but the gesture is still the answer.
		const loop = [
			{
				key: 'draft',
				label: 'Draft',
				status: 'draft',
				region_entry: true,
				is_terminal: false,
				transitions: [ { to: 'review' } ],
			},
			{
				key: 'review',
				label: 'Review',
				status: 'draft',
				is_terminal: false,
				transitions: [ { to: 'draft' } ],
			},
		];
		const { valid, errors } = validateSequence( {
			name: 'Flow',
			stages: loop,
		} );
		expect( valid ).toBe( false );
		expect( errors.join( ' ' ) ).toContain( 'End node' );
	} );

	it( 'warns about a non-terminal dead-end stage', () => {
		// Both stages are their region's checkpoint, so both are reachable from
		// outside the workflow and the only thing left to report is A's missing
		// way out.
		const deadEnd = [
			{
				key: 'a',
				label: 'A',
				status: 'draft',
				region_entry: true,
				is_terminal: false,
				transitions: [],
			},
			{
				key: 'b',
				label: 'B',
				status: 'publish',
				region_entry: true,
				is_terminal: true,
				transitions: [],
			},
		];
		const result = validateSequence( { name: 'Flow', stages: deadEnd } );
		expect( result.warnings.a ).toBeTruthy();
		expect( result.warnings.b ).toBeFalsy();
	} );

	it( 'rejects duplicate stage keys, naming the key the pair shares', () => {
		const collide = [
			{ key: 'a', label: 'A', is_terminal: false, transitions: [] },
			{ key: 'a', label: 'B', is_terminal: true, transitions: [] },
		];
		const result = validateSequence( { name: 'Flow', stages: collide } );
		expect( result.valid ).toBe( false );
		// The key is the one thing the two stages have in common, so it is what
		// identifies them; the node wears it too, so the canvas says which.
		expect( result.errors.join( ' ' ) ).toContain( '“a”' );
		expect( result.warnings.a.join( ' ' ) ).toContain( '“a”' );
	} );

	it( 'names the stage that has no name, by the key it is stored under', () => {
		const unnamed = stages().map( ( s ) =>
			s.key === 'review' ? { ...s, label: '' } : s
		);
		const { valid, errors, warnings } = validateSequence( {
			name: 'Flow',
			stages: unnamed,
		} );
		expect( valid ).toBe( false );
		expect( errors.join( ' ' ) ).toContain( '“review”' );
		expect( warnings.review.join( ' ' ) ).toContain( '“review”' );
	} );

	it( 'names the stage that has no key, by the name writers see', () => {
		const unkeyed = stages().map( ( s ) =>
			s.key === 'review' ? { ...s, key: '' } : s
		);
		const { valid, errors } = validateSequence( {
			name: 'Flow',
			stages: unkeyed,
		} );
		expect( valid ).toBe( false );
		expect( errors.join( ' ' ) ).toContain( '“Review”' );
	} );

	it( 'skips the terminal requirement in phase mode', () => {
		const result = validateSequence( {
			name: 'Phase',
			stages: LIFECYCLE,
			isPhase: true,
			requiredTransitions: IDEATION_TO_EDITORIAL,
		} );
		expect( result.valid ).toBe( true );
	} );

	it( 'blocks saving a phase sequence missing a required phase', () => {
		const result = validateSequence( {
			name: 'Phase',
			stages: [
				{
					key: 'ideation',
					label: 'Ideation',
					transitions: [ { to: 'editorial', label: 'Go' } ],
				},
			],
			isPhase: true,
			requiredTransitions: IDEATION_TO_EDITORIAL,
		} );
		expect( result.valid ).toBe( false );
		expect( result.errors.some( ( e ) => e.includes( 'editorial' ) ) ).toBe(
			true
		);
	} );

	// The rule counted nodes, and the "no way out" check that would have caught
	// this is only a warning on a phase sequence — so a lifecycle whose two
	// phases were never joined passed validation and shipped with the hand-off
	// it exists to configure missing.
	it( 'blocks saving a phase sequence whose phases never hand off', () => {
		const result = validateSequence( {
			name: 'Phase',
			stages: [
				{ key: 'ideation', label: 'Ideation', transitions: [] },
				{ key: 'editorial', label: 'Editorial', transitions: [] },
			],
			isPhase: true,
			requiredTransitions: IDEATION_TO_EDITORIAL,
		} );
		expect( result.valid ).toBe( false );
		const message = result.errors.join( ' ' );
		expect( message ).toContain( 'ideation' );
		expect( message ).toContain( 'editorial' );
		// And on the node the missing hand-off leaves from, so the canvas says
		// where to draw it.
		expect( ( result.warnings.ideation || [] ).join( ' ' ) ).toContain(
			'editorial'
		);
	} );

	// The obligation is the server's, same as the permission graph beside it: a
	// lifecycle that grows a phase in the middle is required to hand off through
	// it, and nothing in the editor has to be told twice.
	it( 'requires whatever hand-offs it is given, not the pair it used to know', () => {
		const throughTriage = [
			{ from: 'ideation', to: 'triage' },
			{ from: 'triage', to: 'editorial' },
		];
		const result = validateSequence( {
			name: 'Phase',
			stages: LIFECYCLE,
			isPhase: true,
			requiredTransitions: throughTriage,
		} );
		expect( result.valid ).toBe( false );
		expect( result.errors.some( ( e ) => e.includes( 'triage' ) ) ).toBe(
			true
		);
	} );

	it( 'does not require phase keys for workflow sequences', () => {
		const result = validateSequence( {
			name: 'Flow',
			stages: stages(),
			requiredTransitions: IDEATION_TO_EDITORIAL,
		} );
		expect( result.errors.some( ( e ) => e.includes( 'phase' ) ) ).toBe(
			false
		);
	} );

	it( 'rejects a region with more than one entry checkpoint, naming them', () => {
		const input = stages();
		input[ 1 ].region_entry = true; // draft AND review both claim draft
		const result = validateSequence( { name: 'Flow', stages: input } );
		expect( result.valid ).toBe( false );
		const message = result.errors.join( ' ' );
		expect( message ).toContain( 'Draft' );
		expect( message ).toContain( 'Review' );
	} );

	it( 'rejects a region holding stages with no entry checkpoint', () => {
		const input = stages().map( ( s ) => ( {
			...s,
			region_entry: false,
		} ) );
		const result = validateSequence( { name: 'Flow', stages: input } );
		expect( result.valid ).toBe( false );
		// One per region left without one, each naming the status.
		const message = result.errors.join( ' ' );
		expect( message ).toContain( 'Draft' );
		expect( message ).toContain( 'Published' );
	} );

	it( 'warns when the flow entry sits outside the draft region', () => {
		// done (publish region) dragged to the front of the sequence.
		const input = stages();
		const reordered = [ input[ 2 ], input[ 0 ], input[ 1 ] ];
		const result = validateSequence( {
			name: 'Flow',
			stages: reordered,
		} );
		expect( result.valid ).toBe( true );
		expect( ( result.warnings.done || [] ).join( ' ' ) ).toContain(
			'draft'
		);
	} );

	it( 'skips the region-entry rules in phase mode', () => {
		const phases = [
			{
				key: 'ideation',
				label: 'Ideation',
				region_entry: true,
				transitions: [ { to: 'editorial', label: 'Go' } ],
			},
			{
				key: 'editorial',
				label: 'Editorial',
				region_entry: true,
				transitions: [],
			},
		];
		const result = validateSequence( {
			name: 'Phase',
			stages: phases,
			isPhase: true,
		} );
		expect( result.valid ).toBe( true );
	} );

	it( 'warns about a stage nothing can reach, without blocking Save', () => {
		// Warned, not blocked: the REST controller and the create-sequence
		// ability both accept transition-less stages, and the write gate permits
		// them, so an author who opens such a sequence has to be able to save the
		// change they came for.
		const orphan = [
			...stages(),
			{
				key: 'orphan',
				label: 'Orphan',
				status: 'draft',
				region_entry: false,
				is_terminal: false,
				transitions: [ { to: 'done', label: 'Finish' } ],
			},
		];
		const result = validateSequence( { name: 'Flow', stages: orphan } );

		expect( result.valid ).toBe( true );
		expect( ( result.warnings.orphan || [] ).join( ' ' ) ).toContain(
			'no post can ever reach'
		);
	} );

	it( 'treats a region checkpoint as reachable with no inbound transition', () => {
		// Nothing in the sequence transitions into "done" — a core-driven publish
		// seats the post there, which is exactly what a checkpoint is for.
		const noInbound = stages().map( ( s ) =>
			s.key === 'review' ? { ...s, transitions: [] } : s
		);
		const result = validateSequence( { name: 'Flow', stages: noInbound } );

		expect( result.errors.join( ' ' ) ).not.toContain(
			'Nothing can reach'
		);
	} );

	it( 'catches a cycle that nothing outside it points into', () => {
		const island = [
			...stages(),
			{
				key: 'left',
				label: 'Left',
				status: 'draft',
				transitions: [ { to: 'right', label: 'Right' } ],
			},
			{
				key: 'right',
				label: 'Right',
				status: 'draft',
				transitions: [ { to: 'left', label: 'Left' } ],
			},
		];
		const result = validateSequence( { name: 'Flow', stages: island } );

		// Both ends of the island are flagged on the canvas — a cycle nothing
		// points into is still unreachable, even though each of its stages has an
		// inbound edge from the other.
		expect( ( result.warnings.left || [] ).join( ' ' ) ).toContain(
			'no post can ever reach'
		);
		expect( ( result.warnings.right || [] ).join( ' ' ) ).toContain(
			'no post can ever reach'
		);
	} );

	it( 'does not count a disabled transition as a way in', () => {
		// `review` is AI-owned with nothing routed, so its transition to `done`
		// is disabled — and `done` has no other way in once it stops being a
		// checkpoint.
		const input = agentStages().map( ( s ) =>
			s.key === 'done' ? { ...s, region_entry: false } : s
		);
		const result = validateSequence( { name: 'Flow', stages: input } );

		expect( ( result.warnings.done || [] ).join( ' ' ) ).toContain(
			'no post can ever reach'
		);
	} );
} );

// ---------------------------------------------------------------------------
// AI stages.
//
// A stage is AI-owned once an agent ability is picked. Its exits are then the
// agent's outcomes: `agent.routing` maps each of pass / fail / error to a
// destination, and the canvas assigns them by dragging from the node's three
// colored handles. Routing and transitions are kept in lockstep — an outcome
// travels on a transition, so wiring one creates it and un-wiring takes it away
// unless another outcome still needs it.
// ---------------------------------------------------------------------------

// The three-stage fixture with `review` handed to an agent, nothing routed yet.
const agentStages = ( routing = {} ) =>
	stages().map( ( s ) =>
		s.key === 'review'
			? { ...s, agent: { ability_id: 'copy-edit', routing } }
			: s
	);

describe( 'setStageAgent', () => {
	it( 'picking an ability is what makes the stage AI-owned', () => {
		const next = setStageAgent( stages(), 'review', 'copy-edit' );
		const review = next.find( ( s ) => s.key === 'review' );
		expect( isAgentStage( review ) ).toBe( true );
		expect( review.agent ).toEqual( {
			ability_id: 'copy-edit',
			routing: {},
		} );
	} );

	it( 'keeps existing routing when the agent is swapped', () => {
		const next = setStageAgent(
			agentStages( { pass: 'done' } ),
			'review',
			'fact-check'
		);
		expect( next.find( ( s ) => s.key === 'review' ).agent ).toEqual( {
			ability_id: 'fact-check',
			routing: { pass: 'done' },
		} );
	} );

	it( 'clearing the agent drops it whole but leaves the transitions alone', () => {
		const next = setStageAgent(
			agentStages( { pass: 'done' } ),
			'review',
			''
		);
		const review = next.find( ( s ) => s.key === 'review' );
		expect( review.agent ).toBeUndefined();
		expect( findTransition( next, 'review', 'done' ) ).toBeTruthy();
	} );
} );

describe( 'routeOutcome / clearOutcome', () => {
	it( 'creates the transition the route travels on', () => {
		// review has no transition to draft yet.
		const next = routeOutcome( agentStages(), 'review', 'fail', 'draft' );
		expect( findTransition( next, 'review', 'draft' ) ).toBeTruthy();
		expect(
			next.find( ( s ) => s.key === 'review' ).agent.routing
		).toEqual( {
			fail: 'draft',
		} );
	} );

	it( 're-routing leaves the transition behind, disabled, rather than deleting it', () => {
		const routed = routeOutcome(
			agentStages( { pass: 'done' } ),
			'review',
			'pass',
			'draft'
		);
		expect( findTransition( routed, 'review', 'draft' ) ).toBeTruthy();
		// review -> done keeps its configuration (allowed_roles, required_tools);
		// nothing travels it now, so it is disabled, not gone.
		const left = findTransition( routed, 'review', 'done' );
		expect( left.allowed_roles ).toEqual( [ 'editor' ] );
		expect(
			isTransitionDisabled(
				routed.find( ( s ) => s.key === 'review' ),
				'done'
			)
		).toBe( true );
	} );

	it( 'keeps a shared transition live while another outcome still routes along it', () => {
		const shared = agentStages( { pass: 'done', fail: 'done' } );
		const next = routeOutcome( shared, 'review', 'pass', 'draft' );
		const review = next.find( ( s ) => s.key === 'review' );
		// fail still goes to done, so that transition stays usable.
		expect( findTransition( next, 'review', 'done' ) ).toBeTruthy();
		expect( isTransitionDisabled( review, 'done' ) ).toBe( false );
		expect( review.agent.routing ).toEqual( {
			pass: 'draft',
			fail: 'done',
		} );
	} );

	it( 'refuses a self-loop, an unknown destination, and a non-AI stage', () => {
		const input = agentStages();
		expect( routeOutcome( input, 'review', 'pass', 'review' ) ).toBe(
			input
		);
		expect( routeOutcome( input, 'review', 'pass', 'nope' ) ).toBe( input );
		// `draft` has no agent, so it has no outcomes to route.
		expect( routeOutcome( input, 'draft', 'pass', 'done' ) ).toBe( input );
	} );

	it( 'routes an outcome into a region anywhere, not only at its checkpoint', () => {
		// `promoted` sits mid-region in publish, past the stage core would land a
		// post on. An outcome may name it like any other target, and the
		// transition it will travel on is created with it.
		const input = [
			...agentStages(),
			{
				key: 'promoted',
				label: 'Promoted',
				is_terminal: true,
				status: 'publish',
				region_entry: false,
				transitions: [],
			},
		];

		const next = routeOutcome( input, 'review', 'pass', 'promoted' );
		expect( findTransition( next, 'review', 'promoted' ) ).not.toBeNull();
		expect(
			next.find( ( s ) => s.key === 'review' ).agent.routing
		).toEqual( {
			pass: 'promoted',
		} );
	} );

	it( 'clearOutcome un-routes but keeps the transition, now disabled', () => {
		const next = clearOutcome(
			agentStages( { pass: 'done' } ),
			'review',
			'pass'
		);
		const review = next.find( ( s ) => s.key === 'review' );
		expect( review.agent.routing ).toEqual( {} );
		expect( findTransition( next, 'review', 'done' ) ).toBeTruthy();
		expect( isTransitionDisabled( review, 'done' ) ).toBe( true );
	} );
} );

describe( 'outcomesRoutedTo', () => {
	it( 'names every outcome standing on one transition, in outcome order', () => {
		const review = agentStages( { fail: 'done', pass: 'done' } ).find(
			( s ) => s.key === 'review'
		);
		// Reported in `AGENT_OUTCOMES` order, not the order the routes were
		// written: the phrase built from it is read by people, and "On pass,
		// On fail" must not depend on which handle was dragged first.
		expect( outcomesRoutedTo( review, 'done' ) ).toEqual( [
			'pass',
			'fail',
		] );
	} );

	it( 'answers empty for a target no outcome leads to, and for a stage with no agent', () => {
		const withAgent = agentStages( { pass: 'done' } );
		const review = withAgent.find( ( s ) => s.key === 'review' );
		expect( outcomesRoutedTo( review, 'draft' ) ).toEqual( [] );
		expect(
			outcomesRoutedTo(
				withAgent.find( ( s ) => s.key === 'draft' ),
				'review'
			)
		).toEqual( [] );
	} );

	it( 'is what makes a transition disabled — nobody on it', () => {
		const review = agentStages( { pass: 'done' } ).find(
			( s ) => s.key === 'review'
		);
		expect( isTransitionDisabled( review, 'done' ) ).toBe( false );
		expect( isTransitionDisabled( review, 'draft' ) ).toBe( true );
	} );
} );

describe( 'agentOutcomeNames', () => {
	it( 'joins the labels the surfaces name a shared record by', () => {
		expect( agentOutcomeNames( [ 'pass', 'fail' ] ) ).toBe(
			'On pass, On fail'
		);
	} );
} );

describe( 'buildGraph with an AI stage', () => {
	it( 'anchors each routed outcome to its own handle', () => {
		const { edges } = buildGraph(
			routeOutcome(
				agentStages( { pass: 'done' } ),
				'review',
				'error',
				'draft'
			)
		);
		const pass = edges.find( ( e ) => e.id === 'review:pass->done' );
		expect( pass.sourceHandle ).toBe( 'pass' );
		expect( pass.data.outcome ).toBe( 'pass' );
		const error = edges.find( ( e ) => e.id === 'review:error->draft' );
		expect( error.sourceHandle ).toBe( 'error' );
	} );

	it( 'draws two outcomes sharing a destination as two fanned-out edges', () => {
		const { edges } = buildGraph(
			agentStages( { pass: 'done', fail: 'done' } )
		);
		const shared = edges.filter(
			( e ) => e.source === 'review' && e.target === 'done'
		);
		expect( shared.map( ( e ) => e.data.outcome ) ).toEqual( [
			'pass',
			'fail',
		] );
		expect( shared.map( ( e ) => e.data.parallelIndex ) ).toEqual( [
			0, 1,
		] );
		expect( shared.every( ( e ) => e.data.parallelCount === 2 ) ).toBe(
			true
		);
	} );

	it( 'marks both of those edges as standing on one transition record', () => {
		// A stage holds at most one transition per target, so these two lines
		// are one record drawn twice and every setting on it is shared. Each
		// edge names the whole set, so whichever one is clicked can say who
		// else an edit reaches.
		const { edges } = buildGraph(
			agentStages( { pass: 'done', fail: 'done' } )
		);
		const shared = edges.filter(
			( e ) => e.source === 'review' && e.target === 'done'
		);
		expect( shared.map( ( e ) => e.data.sharedOutcomes ) ).toEqual( [
			[ 'pass', 'fail' ],
			[ 'pass', 'fail' ],
		] );
	} );

	it( 'leaves outcomes with destinations of their own unshared', () => {
		// Two routes, two transitions, two records — nothing to warn about.
		const { edges } = buildGraph(
			routeOutcome(
				agentStages( { pass: 'done' } ),
				'review',
				'fail',
				'draft'
			)
		);
		const out = edges.filter( ( e ) => e.source === 'review' );
		expect( out.map( ( e ) => e.data.outcome ) ).toEqual( [
			'pass',
			'fail',
		] );
		expect( out.map( ( e ) => e.data.sharedOutcomes ) ).toEqual( [
			null,
			null,
		] );
	} );

	it( 'draws a transition no outcome claims once, unattributed', () => {
		const { edges } = buildGraph( agentStages() );
		const edge = edges.find( ( e ) => e.id === 'review->done' );
		expect( edge.sourceHandle ).toBeNull();
		expect( edge.data.outcome ).toBeNull();
	} );

	it( 'tells the node which outcomes are wired, dropping routes to missing stages', () => {
		const { nodes } = buildGraph(
			agentStages( { pass: 'done', fail: 'gone' } )
		);
		const review = nodes.find( ( n ) => n.id === 'review' );
		expect( review.data.isAgent ).toBe( true );
		expect( review.data.routing ).toEqual( {
			pass: 'done',
			fail: null,
			error: null,
		} );
		// A stage with no agent says so, rather than reporting empty routes.
		expect(
			nodes.find( ( n ) => n.id === 'draft' ).data.routing
		).toBeNull();
	} );

	it( 'ignores agents in phase mode', () => {
		const { nodes } = buildGraph( agentStages( { pass: 'done' } ), {
			isPhase: true,
		} );
		expect( nodes.find( ( n ) => n.id === 'review' ).data.isAgent ).toBe(
			false
		);
	} );
} );

describe( 'outcome edge gestures', () => {
	it( 'connectEdge from an outcome handle routes that outcome', () => {
		const { stages: next, selection } = connectEdge(
			agentStages(),
			'review',
			'draft',
			'fail'
		);
		expect(
			next.find( ( s ) => s.key === 'review' ).agent.routing.fail
		).toBe( 'draft' );
		expect( selection ).toEqual( {
			from: 'review',
			to: 'draft',
			outcome: 'fail',
		} );
	} );

	it( 'reconnectEdge moves an outcome to a new destination', () => {
		const { stages: next, selection } = reconnectEdge(
			agentStages( { pass: 'done' } ),
			'review',
			'done',
			'review',
			'draft',
			'pass'
		);
		expect(
			next.find( ( s ) => s.key === 'review' ).agent.routing.pass
		).toBe( 'draft' );
		expect( selection ).toEqual( {
			from: 'review',
			to: 'draft',
			outcome: 'pass',
		} );
	} );

	it( 'reconnectEdge refuses to hand an outcome to another stage', () => {
		// The outcome belongs to review's agent; dragging its source endpoint
		// onto draft would be asking draft's (absent) agent to own it.
		const input = agentStages( { pass: 'done' } );
		const { stages: next, selection } = reconnectEdge(
			input,
			'review',
			'done',
			'draft',
			'done',
			'pass'
		);
		expect( next ).toBe( input );
		expect( selection ).toBeNull();
	} );

	it( 'disconnectEdge un-routes the outcome and disables the edge it left', () => {
		const next = disconnectEdge(
			agentStages( { pass: 'done' } ),
			'review',
			'done',
			'pass'
		);
		const review = next.find( ( s ) => s.key === 'review' );
		expect( review.agent.routing ).toEqual( {} );
		expect( findTransition( next, 'review', 'done' ) ).toBeTruthy();
		expect( isTransitionDisabled( review, 'done' ) ).toBe( true );
	} );

	it( 'deleting the disabled edge itself still removes the transition', () => {
		// Two gestures, deliberately: clearing a route never destroys config,
		// but the leftover is an ordinary edge that can be deleted outright.
		const unrouted = disconnectEdge(
			agentStages( { pass: 'done' } ),
			'review',
			'done',
			'pass'
		);
		const next = disconnectEdge( unrouted, 'review', 'done', null );
		expect( findTransition( next, 'review', 'done' ) ).toBeNull();
	} );

	it( 'addStageFromNode routes the new stage to the handle it was dragged from', () => {
		const { stages: next, key } = addStageFromNode(
			agentStages(),
			'review',
			{
				outcome: 'error',
			}
		);
		expect(
			next.find( ( s ) => s.key === 'review' ).agent.routing.error
		).toBe( key );
		expect( findTransition( next, 'review', key ) ).toBeTruthy();
	} );

	it( 'insertStageOnEdge re-points only the outcome it split', () => {
		const { stages: next, key } = insertStageOnEdge(
			agentStages( { pass: 'done', fail: 'done' } ),
			'review',
			'done',
			{ outcome: 'pass' }
		);
		const routing = next.find( ( s ) => s.key === 'review' ).agent.routing;
		expect( routing.pass ).toBe( key );
		// fail keeps going straight to done, so that transition stays.
		expect( routing.fail ).toBe( 'done' );
		expect( findTransition( next, 'review', 'done' ) ).toBeTruthy();
		expect( findTransition( next, key, 'done' ) ).toBeTruthy();
	} );
} );

describe( 'validateSequence for AI stages', () => {
	it( 'does not warn about a missing error destination — the error path is opt-in', () => {
		// An errored run on such a stage deliberately fails in place, where the
		// editor offers the way back; that is a designed state, not a problem.
		const result = validateSequence( {
			name: 'Flow',
			stages: agentStages( { pass: 'done' } ),
		} );
		expect( result.warnings.review || [] ).toEqual( [] );
	} );

	it( 'warns about a route to a stage that no longer exists', () => {
		const result = validateSequence( {
			name: 'Flow',
			stages: agentStages( { error: 'gone' } ),
		} );
		expect( ( result.warnings.review || [] ).join( ' ' ) ).toContain(
			'gone'
		);
	} );

	it( 'warns about a route with no transition to travel on', () => {
		// draft exists, but review has no transition to it.
		const result = validateSequence( {
			name: 'Flow',
			stages: agentStages( { error: 'draft' } ),
		} );
		expect( ( result.warnings.review || [] ).join( ' ' ) ).toContain(
			'no transition to travel on'
		);
	} );

	it( 'stays quiet on a fully routed agent stage', () => {
		const result = validateSequence( {
			name: 'Flow',
			stages: routeOutcome(
				agentStages( { pass: 'done', fail: 'done' } ),
				'review',
				'error',
				'draft'
			),
		} );
		expect( result.warnings.review || [] ).toEqual( [] );
	} );
} );

describe( 'disabled transitions on an AI stage', () => {
	it( 'disables every transition no outcome routes along', () => {
		// review -> done exists but nothing routes to it.
		const stage = agentStages().find( ( s ) => s.key === 'review' );
		expect( isTransitionDisabled( stage, 'done' ) ).toBe( true );
	} );

	it( 'leaves a routed transition alone', () => {
		const stage = agentStages( { pass: 'done' } ).find(
			( s ) => s.key === 'review'
		);
		expect( isTransitionDisabled( stage, 'done' ) ).toBe( false );
	} );

	it( 'disables nothing on a stage with no agent', () => {
		const stage = stages().find( ( s ) => s.key === 'review' );
		expect( isTransitionDisabled( stage, 'done' ) ).toBe( false );
	} );

	it( 'flags the disabled edge on the canvas', () => {
		const { edges } = buildGraph( agentStages() );
		const edge = edges.find( ( e ) => e.id === 'review->done' );
		expect( edge.data.disabled ).toBe( true );
		// A routed one is a live agent route, not a disabled transition.
		const routed = buildGraph( agentStages( { pass: 'done' } ) ).edges.find(
			( e ) => e.id === 'review:pass->done'
		);
		expect( routed.data.disabled ).toBe( false );
	} );

	it( 'keeps disabled transitions out of the node’s transition count', () => {
		const { nodes } = buildGraph( agentStages() );
		expect(
			nodes.find( ( n ) => n.id === 'review' ).data.transitionCount
		).toBe( 0 );
		const routed = buildGraph( agentStages( { pass: 'done' } ) ).nodes;
		expect(
			routed.find( ( n ) => n.id === 'review' ).data.transitionCount
		).toBe( 1 );
	} );

	it( 'warns that an agent stage with nothing routed traps content', () => {
		// review holds a transition, but it is disabled — so there is no way out
		// and the generic "no outgoing transition" wording would be wrong.
		const result = validateSequence( {
			name: 'Flow',
			stages: agentStages(),
		} );
		expect( ( result.warnings.review || [] ).join( ' ' ) ).toContain(
			'no outcome routed anywhere'
		);
	} );

	it( 'brings every transition back when the agent is cleared', () => {
		const withAgent = agentStages( { pass: 'done' } );
		const cleared = setStageAgent( withAgent, 'review', '' );
		const review = cleared.find( ( s ) => s.key === 'review' );
		expect( isTransitionDisabled( review, 'done' ) ).toBe( false );
		expect(
			findTransition( cleared, 'review', 'done' ).required_tools
		).toEqual( [ 'seo' ] );
	} );
} );

describe( 'validateSequence agent availability', () => {
	// StageAgentRunner fails an unavailable agent in place, so a post
	// entering the stage stops there. That must be visible on the node — a
	// sequence can go stale long after it was saved — but it must never block
	// Save, because sequences are designed before credentials are wired.
	//
	// Assertions target the agent message specifically: an isolated fixture stage
	// legitimately raises other warnings, and this suite is not about those.
	const aiStage = ( abilityId ) => ( {
		key: 'review',
		label: 'Review',
		is_terminal: true,
		agent: { ability_id: abilityId, routing: {} },
		transitions: [],
	} );

	const agentWarnings = ( warnings ) =>
		( warnings.review || [] ).filter( ( message ) =>
			/setup|no longer available|not available on this site/i.test(
				message
			)
		);

	it( 'warns without erroring when the stage agent needs setup', () => {
		const { errors, warnings } = validateSequence( {
			name: 'Editorial',
			stages: [ aiStage( 'a/b' ) ],
			agents: [ { id: 'a/b', label: 'Copy Edit', available: false } ],
		} );

		const found = agentWarnings( warnings );

		expect( found ).toHaveLength( 1 );
		expect( found[ 0 ] ).toContain( 'Copy Edit' );
		expect( found[ 0 ] ).toContain( 'error' );

		// A warning, never an error: Save must stay available.
		expect( errors.join( ' ' ) ).not.toContain( 'Copy Edit' );
	} );

	it( 'warns when the stage references an agent that is gone', () => {
		const { errors, warnings } = validateSequence( {
			name: 'Editorial',
			stages: [ aiStage( 'deactivated/agent' ) ],
			agents: [ { id: 'a/b', label: 'Copy Edit', available: true } ],
		} );

		const found = agentWarnings( warnings );

		expect( found ).toHaveLength( 1 );
		expect( found[ 0 ] ).toContain( 'deactivated/agent' );
		expect( errors.join( ' ' ) ).not.toContain( 'deactivated/agent' );
	} );

	it( 'stays quiet when the agent can run', () => {
		const { warnings } = validateSequence( {
			name: 'Editorial',
			stages: [ aiStage( 'a/b' ) ],
			agents: [ { id: 'a/b', label: 'Copy Edit', available: true } ],
		} );

		expect( agentWarnings( warnings ) ).toHaveLength( 0 );
	} );

	it( 'stays quiet for a stage with no agent', () => {
		const { warnings } = validateSequence( {
			name: 'Editorial',
			stages: [
				{
					key: 'review',
					label: 'Review',
					is_terminal: true,
					transitions: [],
				},
			],
			agents: [ { id: 'a/b', label: 'Copy Edit', available: false } ],
		} );

		expect( agentWarnings( warnings ) ).toHaveLength( 0 );
	} );

	it( 'stays quiet when no agent list was supplied', () => {
		// The editor fetches agents asynchronously; before they arrive every AI
		// stage would otherwise look broken.
		const { warnings } = validateSequence( {
			name: 'Editorial',
			stages: [ aiStage( 'a/b' ) ],
		} );

		expect( agentWarnings( warnings ) ).toHaveLength( 0 );
	} );
} );
