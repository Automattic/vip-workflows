/**
 * Unit tests for status regions on the sequence canvas — which groups are drawn,
 * what `buildGraph` projects for them, and how `layoutSequence` bands them.
 *
 * @package
 */

// dagre calls `structuredClone`, which the browser has and jest's jsdom
// environment does not expose (Node's global is shadowed by jsdom's window).
// V8's own serializer is the same algorithm, so this is the real thing rather
// than a JSON round-trip that would drop anything non-plain.
if ( typeof global.structuredClone !== 'function' ) {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const v8 = require( 'node:v8' );
	global.structuredClone = ( value ) =>
		v8.deserialize( v8.serialize( value ) );
}

import {
	REGION_ORDER,
	regionLabel,
	regionOptions,
	visibleRegions,
} from '../../src/admin/components/graph/regions';
import {
	buildGraph,
	addStage,
	addTransition,
	connectEdge,
	insertStageOnEdge,
	reconnectEdge,
	routeOutcome,
	regionEntryStage,
	regionNodeId,
	setRegionEntry,
	setStageStatus,
	validateSequence,
	NODE_TYPE,
	REGION_NODE_TYPE,
	START_ID,
	END_ID,
	STAGE_WIDTH,
	STAGE_HEIGHT,
} from '../../src/admin/components/graph/graph-model';
import {
	layoutSequence,
	bandAtPoint,
	checkpointSlot,
	checkpointSlotAtPoint,
	contentOrigin,
	offsetIn,
	BAND_PADDING,
	BAND_TOP_CLEARANCE,
	BAND_GAP,
	CHECKPOINT_OVERHANG,
} from '../../src/admin/components/graph/layout';

const stages = () => [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
		is_terminal: false,
		transitions: [ { to: 'review', label: 'Submit' } ],
	},
	{
		key: 'review',
		label: 'Review',
		status: 'pending',
		region_entry: true,
		is_terminal: false,
		transitions: [ { to: 'live', label: 'Approve' } ],
	},
	{
		key: 'live',
		label: 'Live',
		status: 'publish',
		region_entry: true,
		is_terminal: true,
		transitions: [],
	},
];

describe( 'visibleRegions', () => {
	it( 'always includes draft, even for a sequence that uses none of it', () => {
		expect( visibleRegions( [ { key: 'a', status: 'publish' } ] ) ).toEqual(
			[ 'draft', 'publish' ]
		);
	} );

	it( 'returns every region its stages occupy, in REGION_ORDER', () => {
		expect( visibleRegions( stages() ) ).toEqual( [
			'draft',
			'pending',
			'publish',
		] );
	} );

	it( 'includes regions added with no stage in them yet', () => {
		expect( visibleRegions( stages(), [ 'private' ] ) ).toEqual( [
			'draft',
			'pending',
			'private',
			'publish',
		] );
	} );

	it( 'does not duplicate an added region that stages already occupy', () => {
		expect( visibleRegions( stages(), [ 'pending' ] ) ).toEqual( [
			'draft',
			'pending',
			'publish',
		] );
	} );

	it( 'still surfaces a region outside REGION_ORDER rather than hiding its stages', () => {
		const regions = visibleRegions( [ { key: 'a', status: 'future' } ] );
		expect( regions ).toContain( 'future' );
		// Appended after the known ones, since it has no place in the order.
		expect( regions[ regions.length - 1 ] ).toBe( 'future' );
	} );
} );

describe( 'region vocabulary', () => {
	it( 'labels every region in REGION_ORDER', () => {
		REGION_ORDER.forEach( ( region ) => {
			expect( regionLabel( region ) ).not.toBe( region );
		} );
	} );

	it( 'falls through to the slug for an unknown region', () => {
		expect( regionLabel( 'future' ) ).toBe( 'future' );
	} );

	it( 'builds select options for a subset', () => {
		expect( regionOptions( [ 'draft', 'publish' ] ) ).toEqual( [
			{ label: 'Draft', value: 'draft' },
			{ label: 'Published', value: 'publish' },
		] );
	} );
} );

describe( 'buildGraph with regions', () => {
	const regions = [ 'draft', 'pending', 'publish' ];
	const graph = () => buildGraph( stages(), { regions } );

	it( 'draws no groups when no regions are asked for', () => {
		const { nodes } = buildGraph( stages() );
		expect( nodes.some( ( n ) => n.type === REGION_NODE_TYPE ) ).toBe(
			false
		);
	} );

	it( 'emits one group node per region and no separate checkpoint marker', () => {
		const { nodes } = graph();
		regions.forEach( ( region ) => {
			expect(
				nodes.find( ( n ) => n.id === regionNodeId( region ) )?.type
			).toBe( REGION_NODE_TYPE );
		} );
		// Every node is either a group, a stage, or a flow endpoint — the
		// checkpoint is the stage docked on the border, not a node of its own.
		const types = new Set( nodes.map( ( n ) => n.type ) );
		expect( types.has( 'checkpoint' ) ).toBe( false );
	} );

	it( 'keeps the bands out of the tab order and out of the selection', () => {
		// A band is the ground the stages stand on: inert to the pointer
		// (`layout.js` sets `pointerEvents: 'none'`) and rendering nothing but
		// an `aria-hidden` slot outline. React Flow's `nodesFocusable` default
		// would still make each one a tab stop announced as a node. See
		// A11Y-004; the region's clickable identity is its `RegionBands` label.
		const { nodes } = graph();
		const bands = nodes.filter( ( n ) => n.type === REGION_NODE_TYPE );
		expect( bands ).toHaveLength( regions.length );
		bands.forEach( ( band ) => {
			expect( band.focusable ).toBe( false );
			expect( band.selectable ).toBe( false );
		} );
	} );

	it( 'paints group boxes under the stages that sit inside them', () => {
		const { nodes } = graph();
		const box = nodes.find( ( n ) => n.type === REGION_NODE_TYPE );
		const stage = nodes.find( ( n ) => n.type === NODE_TYPE );
		expect( box.zIndex ).toBeLessThan( stage.zIndex );
	} );

	it( 'counts each region’s stages and only offers to remove empty ones', () => {
		const { nodes } = buildGraph( stages(), {
			regions: [ ...regions, 'private' ],
		} );
		const box = ( region ) =>
			nodes.find( ( n ) => n.id === regionNodeId( region ) ).data;

		expect( box( 'draft' ).stageCount ).toBe( 1 );
		expect( box( 'private' ).stageCount ).toBe( 0 );
		expect( box( 'private' ).removable ).toBe( true );
		// Holds a stage.
		expect( box( 'pending' ).removable ).toBe( false );
		// Empty, but draft is where new content is created.
		expect( box( 'draft' ).removable ).toBe( false );
	} );

	it( 'marks the stage holding each region’s checkpoint', () => {
		const { nodes } = graph();
		const entry = ( key ) =>
			nodes.find( ( n ) => n.id === key ).data.isRegionEntry;
		expect( entry( 'review' ) ).toBe( true );
		// Only one per region, and only the marked ones.
		const marked = nodes
			.filter( ( n ) => n.type === NODE_TYPE && n.data.isRegionEntry )
			.map( ( n ) => n.id );
		expect( marked.sort() ).toEqual( [ 'draft', 'live', 'review' ] );
	} );

	it( 'tells a group whether its checkpoint slot is filled', () => {
		const filled = buildGraph( stages(), { regions } ).nodes;
		expect(
			filled.find( ( n ) => n.id === regionNodeId( 'pending' ) ).data
				.hasEntry
		).toBe( true );

		const input = stages();
		input[ 1 ].region_entry = false;
		const empty = buildGraph( input, { regions } ).nodes;
		expect(
			empty.find( ( n ) => n.id === regionNodeId( 'pending' ) ).data
				.hasEntry
		).toBe( false );
	} );

	it( 'tags each stage node with the group it belongs in', () => {
		const { nodes } = graph();
		const region = ( key ) =>
			nodes.find( ( n ) => n.id === key ).data.region;
		expect( region( 'draft' ) ).toBe( 'draft' );
		expect( region( 'review' ) ).toBe( 'pending' );
		expect( region( 'live' ) ).toBe( 'publish' );
	} );

	it( 'leaves phase sequences ungrouped', () => {
		const { nodes } = buildGraph( stages(), { isPhase: true, regions } );
		const draft = nodes.find( ( n ) => n.id === 'draft' );
		expect( draft.data.region ).toBeNull();
		expect( draft.data.isRegionEntry ).toBe( false );
	} );
} );

describe( 'creating a stage inside a region', () => {
	it( 'defaults to draft', () => {
		const { stages: next, key } = addStage( [] );
		expect( next.find( ( s ) => s.key === key ).status ).toBe( 'draft' );
	} );

	it( 'lands in the region it was created in', () => {
		const { stages: next, key } = addStage( stages(), {
			status: 'private',
		} );
		expect( next.find( ( s ) => s.key === key ).status ).toBe( 'private' );
	} );

	it( 'takes the checkpoint when it is the first stage in the region', () => {
		// The checkpoint is the only way a transition can enter a region, so a
		// stage arriving in an empty one has to hold it or nothing could ever
		// reach it. Matches the server gate, which makes the first stage in a
		// region its entry when no marker says otherwise.
		const { stages: next, key } = addStage( stages(), {
			status: 'private',
		} );
		expect( next.find( ( s ) => s.key === key ).region_entry ).toBe( true );
		expect( regionEntryStage( next, 'private' ).key ).toBe( key );
	} );

	it( 'leaves an existing entry checkpoint alone', () => {
		const { stages: next, key } = addStage( stages(), {
			status: 'pending',
		} );
		expect( next.find( ( s ) => s.key === key ).region_entry ).toBe(
			false
		);
		expect( regionEntryStage( next, 'pending' ).key ).toBe( 'review' );
	} );

	it( 'inserts into the middle of an edge in the source’s region', () => {
		// review (pending) → live (publish): the inserted stage is a step in the
		// pending run of work, not a new status boundary.
		const { stages: next, key } = insertStageOnEdge(
			stages(),
			'review',
			'live'
		);
		expect( next.find( ( s ) => s.key === key ).status ).toBe( 'pending' );
	} );
} );

// The publish region with two stages: `live` holds the checkpoint, `promote`
// doesn't. A region shaped like this is what makes "somewhere other than the
// checkpoint" a place an edge can actually point.
const withPromote = () => [
	...stages().map( ( s ) =>
		s.key === 'live'
			? {
					...s,
					is_terminal: false,
					transitions: [ { to: 'promote', label: 'Promote' } ],
			  }
			: s
	),
	{
		key: 'promote',
		label: 'Promote',
		status: 'publish',
		region_entry: false,
		is_terminal: true,
		transitions: [],
	},
];

describe( 'a transition may target any stage, in any region', () => {
	// `region_entry` says where a post lands when something OUTSIDE the workflow
	// puts it in a region — a core-driven status change, or a sequence assigned
	// to a post that already has a status. It is not a door an edge has to use.
	it( 'draws a crossing that lands mid-region', () => {
		const next = addTransition( withPromote(), 'draft', 'promote' );
		expect(
			next.find( ( s ) => s.key === 'draft' ).transitions
		).toContainEqual( { to: 'promote' } );
	} );

	it( 'draws a crossing back to an interior stage — "send this to the desk"', () => {
		// The shape the rule used to forbid outright, and the reason it went.
		const withDesk = [
			...withPromote(),
			{
				key: 'desk',
				label: 'Desk',
				status: 'draft',
				region_entry: false,
				is_terminal: false,
				transitions: [],
			},
		];
		const next = addTransition( withDesk, 'promote', 'desk' );
		expect(
			next.find( ( s ) => s.key === 'promote' ).transitions
		).toContainEqual( { to: 'desk' } );
	} );

	it( 'connectEdge selects the edge it just made', () => {
		const result = connectEdge( withPromote(), 'draft', 'promote' );
		expect( result.stages ).not.toBe( withPromote() );
		expect( result.selection ).toEqual( { from: 'draft', to: 'promote' } );
	} );

	it( 'reconnectEdge repoints onto a mid-region target', () => {
		const result = reconnectEdge(
			withPromote(),
			'draft',
			'review',
			'draft',
			'promote'
		);
		expect(
			result.stages.find( ( s ) => s.key === 'draft' ).transitions
		).toEqual( [ { to: 'promote', label: 'Submit' } ] );
		expect( result.selection ).toEqual( { from: 'draft', to: 'promote' } );
	} );

	it( 'reconnectEdge carries the transition’s settings when both ends move', () => {
		const result = reconnectEdge(
			withPromote(),
			'draft',
			'review',
			'review',
			'promote'
		);
		expect(
			result.stages.find( ( s ) => s.key === 'draft' ).transitions
		).toEqual( [] );
		expect(
			result.stages.find( ( s ) => s.key === 'review' ).transitions
		).toContainEqual( { to: 'promote', label: 'Submit' } );
	} );

	it( 'reconnectEdge still refuses an endpoint that is not a stage, keeping the original', () => {
		// The refusal has to happen BEFORE the original is removed, or the
		// gesture would delete an edge and put nothing back.
		const input = withPromote();
		const result = reconnectEdge(
			input,
			'draft',
			'review',
			'nowhere',
			'promote'
		);
		expect( result.stages ).toBe( input );
		expect( result.selection ).toBeNull();
	} );

	it( 'routes an agent outcome at a mid-region stage', () => {
		// An outcome travels on a transition, so wiring one mid-region has to
		// create the transition that carries it.
		const input = withPromote().map( ( s ) =>
			s.key === 'review'
				? {
						...s,
						agent: {
							ability_id: 'test/reviewer',
							routing: {},
						},
				  }
				: s
		);
		const next = routeOutcome( input, 'review', 'pass', 'promote' );
		const review = next.find( ( s ) => s.key === 'review' );

		expect( review.agent.routing.pass ).toBe( 'promote' );
		expect( review.transitions ).toContainEqual( { to: 'promote' } );
	} );

	it( 'does not block Save on a crossing that misses the checkpoint', () => {
		// Handing the publish checkpoint to `promote` leaves review → live
		// entering the region away from its entry stage. Once legal, that is a
		// shape the author chose, not a fault to report.
		const { valid, errors, warnings } = validateSequence( {
			name: 'Test',
			stages: setRegionEntry( withPromote(), 'promote' ),
		} );
		expect( valid ).toBe( true );
		expect( errors ).toEqual( [] );
		expect( warnings.review || [] ).toEqual( [] );
	} );

	it( 'does not block Save when a stage moves into another region', () => {
		// `promote` into draft: live → promote becomes a publish → draft crossing
		// that misses the draft checkpoint, and is fine.
		const { valid, errors } = validateSequence( {
			name: 'Test',
			stages: setStageStatus( withPromote(), 'promote', 'draft' ),
		} );
		expect( valid ).toBe( true );
		expect( errors ).toEqual( [] );
	} );
} );

describe( 'layoutSequence', () => {
	const regions = [ 'draft', 'pending', 'publish' ];

	// `review` holds the pending checkpoint, `copyedit` is an ordinary stage in
	// the same region — the layout treats the two completely differently.
	const withExtra = () => [
		...stages(),
		{
			key: 'copyedit',
			label: 'Copy edit',
			status: 'pending',
			region_entry: false,
			is_terminal: false,
			transitions: [],
		},
	];

	const laid = ( placements = {}, input = withExtra() ) => {
		const graph = buildGraph( input, { regions } );
		return layoutSequence( graph.nodes, graph.edges, {
			regions,
			placements,
		} );
	};

	it( 'refuses a stage whose region has no band, rather than reseating it', () => {
		// `visibleRegions()` builds the list from the stages, and the same list
		// builds the bands, so this is a caller that assembled the two from
		// different sources. Seating the stage in the first band would draw it
		// in a region it isn't in and let the mismatch through unnoticed.
		const partial = [ 'draft', 'pending' ];
		const graph = buildGraph( withExtra(), { regions: partial } );
		expect( () =>
			layoutSequence( graph.nodes, graph.edges, { regions: partial } )
		).toThrow( /has no band/ );
	} );

	it( 'stacks the bands in region order without overlapping', () => {
		const { bands } = laid();
		let previousBottom = -Infinity;
		regions.forEach( ( region ) => {
			expect( bands[ region ].y ).toBeGreaterThan( previousBottom );
			previousBottom = bands[ region ].y + bands[ region ].height;
		} );
	} );

	it( 'gives every band the same width, so the groups read as one column', () => {
		const { bands } = laid();
		const widths = regions.map( ( r ) => bands[ r ].width );
		expect( new Set( widths ).size ).toBe( 1 );
	} );

	it( 'docks the checkpoint stage in the slot on its band’s top border', () => {
		const { nodes, bands } = laid();
		const review = nodes.find( ( n ) => n.id === 'review' );
		expect( review.position ).toEqual( checkpointSlot( bands.pending ) );
		// Straddling the border, not sitting inside the group.
		expect( review.position.y ).toBeLessThan( bands.pending.y );
		expect( review.position.y + STAGE_HEIGHT ).toBeGreaterThan(
			bands.pending.y
		);
	} );

	it( 'leaves room for the slot between one band and the next', () => {
		const { bands } = laid();
		const slot = checkpointSlot( bands.pending );
		expect( slot.y ).toBeGreaterThan( bands.draft.y + bands.draft.height );
	} );

	it( 'places every other stage inside its own band', () => {
		const { nodes, bands } = laid();
		nodes
			.filter( ( n ) => n.type === NODE_TYPE && ! n.data.isRegionEntry )
			.forEach( ( node ) => {
				const band = bands[ node.data.region ];
				expect( node.position.x ).toBeGreaterThanOrEqual( band.x );
				expect( node.position.y ).toBeGreaterThanOrEqual( band.y );
				expect( node.position.x + STAGE_WIDTH ).toBeLessThanOrEqual(
					band.x + band.width
				);
				expect( node.position.y + STAGE_HEIGHT ).toBeLessThanOrEqual(
					band.y + band.height
				);
			} );
	} );

	it( 'honours a hand placement as an offset inside its band', () => {
		const { nodes, bands } = laid( {
			copyedit: { region: 'pending', x: 120, y: 40 },
		} );
		const band = bands.pending;
		expect( nodes.find( ( n ) => n.id === 'copyedit' ).position ).toEqual( {
			x: band.x + BAND_PADDING + 120,
			y: band.y + BAND_TOP_CLEARANCE + 40,
		} );
	} );

	it( 'honours a hand placement on the stage holding the checkpoint', () => {
		// Where along the border a checkpoint sits is the author's once the
		// canvas is frozen — otherwise a band widening around a new stage slides
		// every checkpoint back to centre while nothing else moves. Taking the
		// checkpoint clears the placement (`GraphCanvas`), so the default is
		// still the centred slot.
		//
		// Along the border, and only along it: the y in the placement is
		// ignored, because straddling the border is what the stage IS.
		const { nodes, bands } = laid( {
			review: { region: 'pending', x: 200, y: -40 },
		} );
		expect( nodes.find( ( n ) => n.id === 'review' ).position ).toEqual( {
			x: bands.pending.x + BAND_PADDING + 200,
			y: bands.pending.y - CHECKPOINT_OVERHANG,
		} );
	} );

	it( 'leaves the checkpoint centred on the border with no placement', () => {
		const { nodes, bands } = laid( {
			copyedit: { region: 'pending', x: 120, y: 40 },
		} );
		expect( nodes.find( ( n ) => n.id === 'review' ).position ).toEqual(
			checkpointSlot( bands.pending )
		);
		expect( bands.pending.slot ).toEqual( checkpointSlot( bands.pending ) );
	} );

	it( 'moves the drop slot with the checkpoint it holds', () => {
		// The slot is the rectangle a drop is tested against and the outline
		// `RegionNode` draws. Left centred while the stage on the border was
		// placed, it became a target sitting where the stage visibly wasn't.
		// Shoved to the left-hand end of the border, far enough from centre
		// that the moved slot and the centred one do not overlap — they sit at
		// the same height, so x is the whole of the difference.
		const placements = { review: { region: 'pending', x: 0, y: 0 } };
		const { nodes, bands } = laid( placements );
		const review = nodes.find( ( n ) => n.id === 'review' );
		expect( bands.pending.slot ).toEqual( review.position );

		// The region node carries the same rectangle, band-relative, for the
		// outline to be positioned from.
		const band = nodes.find(
			( n ) => n.type === REGION_NODE_TYPE && n.data.region === 'pending'
		);
		expect( band.data.slotX ).toBe(
			bands.pending.slot.x - bands.pending.x
		);
		expect( band.data.slotY ).toBe(
			bands.pending.slot.y - bands.pending.y
		);

		// And the hit test follows it: the centre of the moved slot is a
		// checkpoint drop, the centre of where it used to be is not.
		const centre = ( at ) => ( {
			x: at.x + STAGE_WIDTH / 2,
			y: at.y + STAGE_HEIGHT / 2,
		} );
		expect(
			checkpointSlotAtPoint( bands, regions, centre( review.position ) )
		).toBe( 'pending' );
		expect(
			checkpointSlotAtPoint(
				bands,
				regions,
				centre( checkpointSlot( bands.pending ) )
			)
		).toBeNull();
	} );

	it( 'takes a placed stage out of the cluster entirely', () => {
		// The point of the freeze: a placed stage is no longer dagre's to rank or
		// reserve room for, so its neighbours settle exactly as they would if it
		// were not in the region at all.
		const proof = {
			key: 'proof',
			label: 'Proof',
			status: 'pending',
			region_entry: false,
			is_terminal: false,
			transitions: [],
		};
		const both = [ ...withExtra(), proof ];
		const positionOf = ( result, id ) =>
			result.nodes.find( ( n ) => n.id === id ).position;

		const together = laid( {}, both );
		const placed = laid(
			{ copyedit: { region: 'pending', x: 0, y: 400 } },
			both
		);
		const alone = laid( {}, [ ...stages(), proof ] );

		// `copyedit` shared a rank with `proof`, so having it there moved it.
		expect( positionOf( together, 'proof' ) ).not.toEqual(
			positionOf( alone, 'proof' )
		);
		// Placed, it stops counting: `proof` lands where it does on its own.
		expect( positionOf( placed, 'proof' ) ).toEqual(
			positionOf( alone, 'proof' )
		);
	} );

	it( 'holds the band width at the floor it was frozen at', () => {
		const graph = buildGraph( withExtra(), { regions } );
		const wide = layoutSequence( graph.nodes, graph.edges, {
			regions,
			placements: { copyedit: { region: 'pending', x: 0, y: 0 } },
			minWidth: 2000,
		} );
		expect( wide.bands.pending.contentWidth ).toBe( 2000 );
		// A floor, not a width — content wider than it still wins.
		const wider = layoutSequence( graph.nodes, graph.edges, {
			regions,
			placements: { copyedit: { region: 'pending', x: 2400, y: 0 } },
			minWidth: 2000,
		} );
		expect( wider.bands.pending.contentWidth ).toBeGreaterThan( 2000 );
	} );

	it( 'grows a band to contain what was placed in it', () => {
		const tall = laid( { copyedit: { region: 'pending', x: 0, y: 600 } } );
		expect( tall.bands.pending.height ).toBeGreaterThan(
			laid().bands.pending.height
		);
		// And the band below is pushed down rather than overlapped.
		expect( tall.bands.publish.y ).toBeGreaterThan(
			tall.bands.pending.y + tall.bands.pending.height - 1
		);
	} );

	// A band used to hold a drop at or below its content origin, so a stage let
	// go in the top clearance — the 80px strip under the border the checkpoint
	// hangs into — was moved back down after the pointer was released, landing
	// on whatever it had been placed above. The band grows to reach it instead.
	//
	// These go through the gesture as `GraphCanvas` performs it: pin every stage
	// where it already sits, then apply the one placement the drag is about.
	// That is what makes "nothing else moved" a claim worth testing — an
	// unplaced stage has no recorded position to be moved *from*.
	const frozen = ( snapshot, override ) => {
		const placements = {};
		snapshot.nodes
			.filter( ( node ) => node.type === NODE_TYPE )
			.forEach( ( node ) => {
				const region = node.data.region;
				placements[ node.id ] = {
					region,
					...offsetIn( snapshot.bands[ region ], node.position ),
				};
			} );
		return { ...placements, ...override };
	};

	// A release inside `pending`'s top clearance: below the border, so the drop
	// lands in that band, but above the content origin, which is where the old
	// clamp would have dragged it back to.
	const droppedHigh = ( snapshot, above ) => {
		const band = snapshot.bands.pending;
		const position = { x: contentOrigin( band ).x + 40, y: band.y + above };
		return {
			position,
			placements: frozen( snapshot, {
				copyedit: { region: 'pending', ...offsetIn( band, position ) },
			} ),
		};
	};

	it( 'leaves a stage dropped above the content origin where it was put', () => {
		const plain = laid();
		const { position, placements } = droppedHigh( plain, 20 );
		const { nodes } = laid( placements );
		expect( nodes.find( ( n ) => n.id === 'copyedit' ).position ).toEqual(
			position
		);
	} );

	it( 'grows the band upward to contain a stage placed above its origin', () => {
		const plain = laid();
		const { position, placements } = droppedHigh( plain, 20 );
		const { bands } = laid( placements );
		// The border moved up past the stage rather than the stage moving down.
		expect( bands.pending.y ).toBeLessThan( position.y );
		expect( bands.pending.y ).toBeLessThan( plain.bands.pending.y );
		// And the content origin — what every placement is measured from — did
		// not move, which is what keeps the rest of the band still.
		expect( contentOrigin( bands.pending ) ).toEqual(
			contentOrigin( plain.bands.pending )
		);
	} );

	it( 'leaves every other stage in the band exactly where it was', () => {
		// The rejected way to grow upward is to push the content origin down,
		// which re-anchors every other placement in the band: one stage dropped
		// high would slide all its neighbours, which is the same complaint again.
		// It holds however far up the drop went — 600px here, well past what the
		// gap can absorb, so the band is also lifting the ones above it.
		//
		// Every stage in the band's content, that is. The checkpoint is not in
		// it: it is fixed to the top border, and the top border is the one thing
		// this gesture moves.
		const plain = laid();
		const { nodes } = laid(
			frozen( plain, {
				copyedit: { region: 'pending', x: 0, y: -600 },
			} )
		);
		nodes
			.filter(
				( n ) =>
					n.type === NODE_TYPE &&
					n.data.region === 'pending' &&
					n.id !== 'copyedit' &&
					! n.data.isRegionEntry
			)
			.forEach( ( node ) => {
				const before = plain.nodes.find( ( n ) => n.id === node.id );
				expect( node.position ).toEqual( before.position );
			} );
	} );

	it( 'carries the checkpoint up with the border when the band grows', () => {
		// The border climbs and the stage straddling it climbs with it. Read
		// from its own placement instead, the checkpoint stayed at the height
		// the freeze caught it at — every placement is measured from the content
		// origin, which upward growth deliberately holds still — and the band
		// grew out from under it, leaving it adrift inside the region with the
		// border drawn above it. Growing downward never showed it: `band.y` does
		// not move, so the placement and the border agreed by accident.
		const plain = laid();
		const { nodes, bands } = laid(
			frozen( plain, {
				copyedit: { region: 'pending', x: 0, y: -600 },
			} )
		);
		const review = nodes.find( ( n ) => n.id === 'review' );

		expect( bands.pending.y ).toBeLessThan( plain.bands.pending.y );
		expect( review.position.y ).toBe(
			bands.pending.y - CHECKPOINT_OVERHANG
		);
		// The outline and the drop target came with it, so what the author aims
		// at is still the stage they can see.
		expect( bands.pending.slot ).toEqual( review.position );
		const band = nodes.find(
			( n ) => n.type === REGION_NODE_TYPE && n.data.region === 'pending'
		);
		expect( band.data.slotY ).toBe(
			bands.pending.slot.y - bands.pending.y
		);
		// Along the border it has not budged: growing upward is not a reason to
		// re-centre a checkpoint the author moved.
		expect( review.position.x ).toBe(
			plain.nodes.find( ( n ) => n.id === 'review' ).position.x
		);
	} );

	it( 'keeps the bands clear of each other when one grows upward', () => {
		// Far enough up to eat the whole gap and then some, so the bands above
		// have to yield rather than the gap simply shrinking.
		const plain = laid();
		const { bands } = laid(
			frozen( plain, {
				copyedit: { region: 'pending', x: 0, y: -600 },
			} )
		);
		let previousBottom = -Infinity;
		regions.forEach( ( region ) => {
			expect( bands[ region ].y ).toBeGreaterThan( previousBottom );
			previousBottom = bands[ region ].y + bands[ region ].height;
		} );
		// The checkpoint hangs half a stage above its border, and never over the
		// band above: that much of the gap is the floor upward growth stops at.
		expect( bands.pending.y - ( bands.draft.y + bands.draft.height ) ).toBe(
			CHECKPOINT_OVERHANG
		);
	} );

	it( 'lifts the bands above rather than the band that grew', () => {
		const plain = laid();
		const { bands } = laid(
			frozen( plain, {
				copyedit: { region: 'pending', x: 0, y: -600 },
			} )
		);
		// `pending` is the band the author was working in, so it holds still,
		// along with everything below it. `draft` moves out of the way.
		expect( contentOrigin( bands.pending ) ).toEqual(
			contentOrigin( plain.bands.pending )
		);
		expect( contentOrigin( bands.publish ) ).toEqual(
			contentOrigin( plain.bands.publish )
		);
		expect( bands.draft.y ).toBeLessThan( plain.bands.draft.y );
	} );

	it( 'takes the slack in the gap before moving anything else', () => {
		// A reach the gap can absorb costs the rest of the canvas nothing at
		// all: the border moves up into space that was already empty, and no
		// stage in any band's content changes position. This band's checkpoint
		// is the exception that proves it — it is drawn on the border, so the
		// distance it travels is the distance the border did.
		const plain = laid();
		const { nodes, bands } = laid(
			frozen( plain, {
				copyedit: {
					region: 'pending',
					x: 0,
					y: -( BAND_GAP - CHECKPOINT_OVERHANG ),
				},
			} )
		);
		expect( bands.pending.y ).toBeLessThan( plain.bands.pending.y );
		expect( bands.draft.y ).toBe( plain.bands.draft.y );
		nodes
			.filter(
				( n ) =>
					n.type === NODE_TYPE &&
					n.id !== 'copyedit' &&
					! ( n.data.isRegionEntry && n.data.region === 'pending' )
			)
			.forEach( ( node ) => {
				const before = plain.nodes.find( ( n ) => n.id === node.id );
				expect( node.position ).toEqual( before.position );
			} );

		const review = nodes.find( ( n ) => n.id === 'review' );
		const before = plain.nodes.find( ( n ) => n.id === 'review' );
		expect( before.position.y - review.position.y ).toBe(
			plain.bands.pending.y - bands.pending.y
		);
	} );

	it( 'grows the whole column leftward for a stage placed left of it', () => {
		// Bands share one width so their edges line up; one cannot reach left
		// without the others, and moving them together leaves every content
		// origin where it was.
		const plain = laid();
		const band = plain.bands.pending;
		const position = { x: band.x, y: contentOrigin( band ).y + 10 };
		const { nodes, bands } = laid(
			frozen( plain, {
				copyedit: { region: 'pending', ...offsetIn( band, position ) },
			} )
		);
		expect( nodes.find( ( n ) => n.id === 'copyedit' ).position ).toEqual(
			position
		);
		expect( bands.pending.x ).toBeLessThan( plain.bands.pending.x );
		const edges = regions.map(
			( r ) => `${ bands[ r ].x }:${ bands[ r ].width }`
		);
		expect( new Set( edges ).size ).toBe( 1 );
	} );

	it( 'leaves the checkpoints and the endpoints where they were when it does', () => {
		// The column grows leftward from its content origin, so the band's
		// geometric middle is no longer the middle of the stages in it. Anything
		// that lines up with those stages has to measure from the content box,
		// or one stage dragged left slides every checkpoint — and both endpoint
		// markers — half the overshoot sideways, which is the non-local answer
		// this file's header promises a placement can never produce.
		const plain = laid();
		const band = plain.bands.pending;
		const position = { x: band.x - 60, y: contentOrigin( band ).y + 10 };
		const { nodes, bands } = laid(
			frozen( plain, {
				copyedit: { region: 'pending', ...offsetIn( band, position ) },
			} )
		);

		// The column really did grow, so the two middles really have parted.
		expect( bands.pending.x ).toBeLessThan( plain.bands.pending.x );

		regions.forEach( ( region ) => {
			expect( checkpointSlot( bands[ region ] ) ).toEqual(
				checkpointSlot( plain.bands[ region ] )
			);
		} );

		[ START_ID, END_ID ].forEach( ( id ) => {
			expect( nodes.find( ( n ) => n.id === id ).position ).toEqual(
				plain.nodes.find( ( n ) => n.id === id ).position
			);
		} );
	} );

	it( 'never grows a band for the checkpoint straddling its border', () => {
		// The checkpoint is *meant* to sit above the content origin. Counting it
		// would have the band reach up past its own border, moving the border,
		// which moves the slot the checkpoint is docked in — a band chasing
		// itself upward forever.
		const plain = laid();
		const { bands } = laid( frozen( plain ) );
		expect( bands.pending.y ).toBe( plain.bands.pending.y );
		expect( bands.pending.contentY ).toBe( BAND_TOP_CLEARANCE );
	} );

	it( 'reproduces itself exactly when every stage is pinned where it sits', () => {
		// The freeze is the editor's whole model — it pins the canvas on the
		// first gesture and lays out from placements thereafter. If pinning
		// changed the picture even slightly, every author's first click would
		// nudge the graph.
		const plain = laid();
		const refrozen = laid( frozen( plain ) );
		regions.forEach( ( region ) => {
			expect( refrozen.bands[ region ] ).toEqual( plain.bands[ region ] );
		} );
		refrozen.nodes.forEach( ( node ) => {
			const before = plain.nodes.find( ( n ) => n.id === node.id );
			expect( node.position ).toEqual( before.position );
		} );
	} );

	it( 'ignores a placement left behind by a stage that changed region', () => {
		const { nodes } = laid( {
			copyedit: { region: 'draft', x: 500, y: 500 },
		} );
		const plain = laid();
		expect( nodes.find( ( n ) => n.id === 'copyedit' ).position ).toEqual(
			plain.nodes.find( ( n ) => n.id === 'copyedit' ).position
		);
	} );

	it( 'bookends the stack with Start above and End below', () => {
		const { nodes, bands } = laid();
		const start = nodes.find( ( n ) => n.data?.kind === 'start' );
		const end = nodes.find( ( n ) => n.data?.kind === 'end' );
		// Clear of the draft band's checkpoint slot, which hangs above it.
		expect( start.position.y + start.height ).toBeLessThan(
			checkpointSlot( bands.draft ).y
		);
		expect( end.position.y ).toBeGreaterThan(
			bands.publish.y + bands.publish.height
		);
	} );

	it( 'falls back to the plain layout when there are no regions', () => {
		const graph = buildGraph( stages(), { isPhase: true } );
		const { bands, nodes } = layoutSequence( graph.nodes, graph.edges, {
			regions: [],
		} );
		expect( bands ).toEqual( {} );
		expect( nodes ).toHaveLength( graph.nodes.length );
	} );

	it( 'keeps absolute hand placements when there are no regions', () => {
		const graph = buildGraph( stages(), { isPhase: true } );
		const { nodes } = layoutSequence( graph.nodes, graph.edges, {
			regions: [],
			placements: { review: { region: null, x: 42, y: 84 } },
		} );
		expect( nodes.find( ( n ) => n.id === 'review' ).position ).toEqual( {
			x: 42,
			y: 84,
		} );
	} );
} );

describe( 'checkpointSlotAtPoint', () => {
	const regions = [ 'draft', 'pending', 'publish' ];
	const bands = () => {
		const graph = buildGraph( stages(), { regions } );
		return layoutSequence( graph.nodes, graph.edges, { regions } ).bands;
	};

	it( 'reports the region whose slot a point falls in', () => {
		const rects = bands();
		const slot = checkpointSlot( rects.pending );
		expect(
			checkpointSlotAtPoint( rects, regions, {
				x: slot.x + STAGE_WIDTH / 2,
				y: slot.y + STAGE_HEIGHT / 2,
			} )
		).toBe( 'pending' );
	} );

	it( 'is exactly the slot — a point beside it is not a checkpoint drop', () => {
		const rects = bands();
		const slot = checkpointSlot( rects.pending );
		expect(
			checkpointSlotAtPoint( rects, regions, {
				x: slot.x - 10,
				y: slot.y + STAGE_HEIGHT / 2,
			} )
		).toBeNull();
		// Well inside the band, below the border: an ordinary drop.
		expect(
			checkpointSlotAtPoint( rects, regions, {
				x: slot.x + STAGE_WIDTH / 2,
				y: rects.pending.y + rects.pending.height / 2,
			} )
		).toBeNull();
	} );

	it( 'reports nothing when there are no bands', () => {
		expect( checkpointSlotAtPoint( {}, [], { x: 0, y: 0 } ) ).toBeNull();
	} );
} );

describe( 'bandAtPoint', () => {
	const regions = [ 'draft', 'pending', 'publish' ];
	const bands = () => {
		const graph = buildGraph( stages(), { regions } );
		return layoutSequence( graph.nodes, graph.edges, { regions } ).bands;
	};

	it( 'reports the band a point falls inside', () => {
		const rects = bands();
		expect(
			bandAtPoint( rects, regions, {
				x: 10,
				y: rects.pending.y + rects.pending.height / 2,
			} )
		).toBe( 'pending' );
	} );

	// `RegionBands` paints each section from its own border down to the *next*
	// one, so the whole inter-band gap — including the drop-target tint — reads
	// as the region above it. Splitting the gap by nearest band would light one
	// section up and drop the stage in the other, for the lower half of every
	// gap on the canvas.
	it( 'gives the whole gap between two bands to the band above it', () => {
		const rects = bands();
		const gapTop = rects.draft.y + rects.draft.height;
		const gapBottom = rects.pending.y;
		expect( gapBottom ).toBeGreaterThan( gapTop );

		// Upper half.
		expect( bandAtPoint( rects, regions, { x: 0, y: gapTop + 2 } ) ).toBe(
			'draft'
		);
		// Lower half — nearer `pending`, but painted as `draft`.
		expect(
			bandAtPoint( rects, regions, { x: 0, y: gapBottom - 2 } )
		).toBe( 'draft' );
		// The next band's own border is where it takes over.
		expect( bandAtPoint( rects, regions, { x: 0, y: gapBottom } ) ).toBe(
			'pending'
		);
	} );

	it( 'snaps a point off the ends to the first or last band', () => {
		const rects = bands();
		expect( bandAtPoint( rects, regions, { x: 0, y: -9999 } ) ).toBe(
			'draft'
		);
		expect( bandAtPoint( rects, regions, { x: 0, y: 99999 } ) ).toBe(
			'publish'
		);
	} );

	it( 'reports nothing when there are no bands', () => {
		expect( bandAtPoint( {}, [], { x: 0, y: 0 } ) ).toBeNull();
	} );
} );
