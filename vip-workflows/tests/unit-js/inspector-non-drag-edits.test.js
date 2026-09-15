/**
 * Unit tests for the settings the canvas used to hold on its own.
 *
 * Five things about a sequence could be said only by dragging: creating a
 * transition, routing an agent's outcome, marking a stage final, moving it into
 * a status section, and — from the stage's side — its region's entry
 * checkpoint. A drag is a fine gesture; being the *only* gesture is the defect,
 * because a canvas whose settings answer to nothing else has no answer at all
 * for an author who cannot make one.
 *
 * The controls that answer them live in the panels, which is also where each
 * setting was already read back. What they may offer is not restated there: the
 * options come from `Inspector`, which asks the model one candidate at a time —
 * `canReconnect` for an endpoint, the stage's own transitions for a new exit —
 * so a destination this panel offers is one a drag would have accepted, and one
 * it withholds is one a drag would have refused.
 *
 * These render `Inspector` rather than a panel, because that computation is the
 * part worth pinning; the panels' own behaviour is covered in
 * `stage-inspector.test.js` and `transition-capture-inputs.test.js`.
 *
 * @package
 */

import { render, screen, fireEvent, act } from './helpers/render-wp-component';

import Inspector from '../../src/admin/components/graph/Inspector';

const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'review', label: 'Submit' } ],
	},
	{
		key: 'review',
		label: 'Review',
		status: 'pending',
		region_entry: true,
		transitions: [],
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

const SEQUENCE_SETTINGS = {
	name: 'Editorial Review',
	onNameChange: () => {},
	description: '',
	onDescriptionChange: () => {},
	isActive: true,
	onActiveChange: () => {},
	postTypes: [ { label: 'Posts', value: 'post' } ],
	selectedPostTypes: [ 'post' ],
	onTogglePostType: () => {},
	metadataFields: [],
	onMetadataChange: () => {},
	isNew: false,
	onDelete: () => {},
	deleting: false,
};

function renderInspector( overrides = {} ) {
	const props = {
		selection: { type: 'node', key: 'draft' },
		isPhase: false,
		stages: STAGES,
		selectedStage: STAGES[ 0 ],
		selectedTransition: null,
		regions: [ 'draft', 'pending', 'publish' ],
		availableAgents: [],
		availableRoles: [],
		availableTools: [],
		availableChannels: [],
		onUpdateStage: () => {},
		onDeleteStage: () => {},
		onUpdateTransition: () => {},
		onDeleteTransition: () => {},
		onConnectTransition: () => {},
		onReconnectTransition: () => {},
		onSetStageStatus: () => {},
		onSelectRegion: () => {},
		onSelectNode: () => {},
		onSelectEdge: () => {},
		sequenceSettings: SEQUENCE_SETTINGS,
		...overrides,
	};
	render( <Inspector { ...props } /> );
}

async function openMenu( name ) {
	await act( async () => {
		fireEvent.click( screen.getByRole( 'button', { name } ) );
	} );
}

const menuLabels = () =>
	screen.getAllByRole( 'menuitem' ).map( ( item ) => item.textContent );

describe( 'Where a new exit may go', () => {
	it( 'offers the stages this one does not already reach, and the flow’s exit', async () => {
		// Draft already reaches Review, and a stage holds at most one
		// transition per target — so Review is not a second exit to add, it is
		// the one that exists. Draft is not final, so End is on offer.
		renderInspector();

		await openMenu( 'Add exit' );

		expect( menuLabels() ).toEqual( [ 'Done', 'End of workflow' ] );
	} );

	it( 'withholds the flow’s exit from a stage that already has one', async () => {
		renderInspector( {
			selection: { type: 'node', key: 'done' },
			selectedStage: STAGES[ 2 ],
		} );

		await openMenu( 'Add exit' );

		expect( menuLabels() ).toEqual( [ 'Draft', 'Review' ] );
	} );

	it( 'creates the transition through the same mutation a dropped connection does', async () => {
		const onConnectTransition = jest.fn();
		const onSelectNode = jest.fn();
		renderInspector( { onConnectTransition, onSelectNode } );

		await openMenu( 'Add exit' );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Done' } ) );

		// Null handle: a plain transition, not an outcome route. What the model
		// does with an End target — set `is_terminal` rather than store a
		// transition — is the model's to know, and is not restated here.
		expect( onConnectTransition ).toHaveBeenCalledWith(
			'draft',
			'done',
			null
		);
		// That mutation selects the new edge, as a drop does; asked from the
		// stage's panel, the stage stays selected.
		expect( onSelectNode ).toHaveBeenCalledWith( 'draft' );
	} );

	it( 'names the destination even when there is only one', async () => {
		// Review already reaches Done and is not final: End is all that's left,
		// and a bare "+" would make the stage final without saying so.
		renderInspector( {
			selection: { type: 'node', key: 'review' },
			stages: [
				STAGES[ 0 ],
				{
					...STAGES[ 1 ],
					transitions: [ { to: 'draft' }, { to: 'done' } ],
				},
				STAGES[ 2 ],
			],
			selectedStage: {
				...STAGES[ 1 ],
				transitions: [ { to: 'draft' }, { to: 'done' } ],
			},
		} );

		await openMenu( 'Add exit' );

		expect( menuLabels() ).toEqual( [ 'End of workflow' ] );
	} );
} );

describe( 'Routing an outcome from the stage panel', () => {
	const aiDraft = ( routing ) => ( {
		...STAGES[ 0 ],
		agent: { ability_id: 'x', routing },
	} );
	const renderAiDraft = ( routing, overrides ) => {
		const stage = aiDraft( routing );
		renderInspector( {
			stages: [ stage, STAGES[ 1 ], STAGES[ 2 ] ],
			selectedStage: stage,
			availableAgents: [ { id: 'x', label: 'Agent X' } ],
			...overrides,
		} );
	};

	it( 'routes an unrouted outcome as a new connection', async () => {
		const onConnectTransition = jest.fn();
		renderAiDraft( {}, { onConnectTransition } );

		await openMenu( 'Route On pass' );
		fireEvent.click(
			screen.getByRole( 'menuitemradio', { name: 'Done' } )
		);

		expect( onConnectTransition ).toHaveBeenCalledWith(
			'draft',
			'done',
			'pass'
		);
	} );

	it( 'moves a routed outcome, so its transition’s settings go with it', async () => {
		// Routing it as a fresh connection would leave the old transition —
		// tools, roles, notifications — behind on a disabled edge, and send the
		// outcome along a bare one. The To select on that edge moves it; so
		// does this.
		const onReconnectTransition = jest.fn();
		const onConnectTransition = jest.fn();
		renderAiDraft(
			{ pass: 'review' },
			{ onReconnectTransition, onConnectTransition }
		);

		await openMenu( 'Route On pass' );
		fireEvent.click(
			screen.getByRole( 'menuitemradio', { name: 'Done' } )
		);

		expect( onReconnectTransition ).toHaveBeenCalledWith(
			'draft',
			'review',
			'draft',
			'done',
			'pass'
		);
		expect( onConnectTransition ).not.toHaveBeenCalled();
	} );
} );

describe( 'Re-pointing a transition without dragging its endpoint', () => {
	const edgeSelection = ( overrides = {} ) => ( {
		selection: { type: 'edge', from: 'draft', to: 'review', ...overrides },
		selectedStage: null,
		selectedTransition: { to: 'review', label: 'Submit' },
	} );

	const picker = ( name ) => screen.getByRole( 'combobox', { name } );

	it( 'offers both ends, each holding the ends it could actually take', () => {
		renderInspector( edgeSelection() );

		// Done → Review is a departure nothing forbids; Review → Review is not
		// a transition at all. Both answers are `canReconnect`'s.
		expect(
			Array.from( picker( 'From' ).options ).map( ( o ) => o.textContent )
		).toEqual( [ 'Draft', 'Done' ] );
		expect(
			Array.from( picker( 'To' ).options ).map( ( o ) => o.textContent )
		).toEqual( [ 'Review', 'Done', 'End of workflow' ] );
	} );

	it( 'moves the end through the same mutation a dragged endpoint does', () => {
		const onReconnectTransition = jest.fn();
		renderInspector( {
			...edgeSelection(),
			onReconnectTransition,
		} );

		fireEvent.change( picker( 'To' ), { target: { value: 'done' } } );

		expect( onReconnectTransition ).toHaveBeenCalledWith(
			'draft',
			'review',
			'draft',
			'done',
			null
		);
	} );

	it( 'gives an outcome edge no From control — its departure is fixed', () => {
		// An outcome belongs to the agent on its own stage: moving the source
		// would ask a different stage's agent to own the route, which
		// `canReconnect` refuses. So there is nowhere for that end to go, and a
		// control with one entry that cannot change is worse than none.
		const stages = [
			{
				...STAGES[ 0 ],
				agent: { ability_id: 'x', routing: { pass: 'review' } },
			},
			STAGES[ 1 ],
			STAGES[ 2 ],
		];
		renderInspector( {
			...edgeSelection( { outcome: 'pass' } ),
			stages,
		} );

		expect( screen.queryByRole( 'combobox', { name: 'From' } ) ).toBeNull();
		expect( picker( 'To' ) ).toBeInTheDocument();
	} );

	it( 'offers no re-pointing at all in a phase sequence', () => {
		// A phase sequence configures a lifecycle move; the pairs it may use
		// come from the server, not from this panel.
		renderInspector( { ...edgeSelection(), isPhase: true } );

		expect( screen.queryByRole( 'combobox', { name: 'From' } ) ).toBeNull();
		expect( screen.queryByRole( 'combobox', { name: 'To' } ) ).toBeNull();
	} );
} );

describe( 'The canvas’s creation verbs, in the sequence panel', () => {
	const nothingSelected = ( settings = {} ) => ( {
		selection: null,
		selectedStage: null,
		sequenceSettings: {
			...SEQUENCE_SETTINGS,
			onAddStage: () => {},
			onAddPostStatus: () => {},
			canAddPostStatus: true,
			...settings,
		},
	} );

	it( 'adds a stage — the verb the canvas never had an affordance for', () => {
		const onAddStage = jest.fn();
		renderInspector( nothingSelected( { onAddStage } ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add stage' } ) );

		expect( onAddStage ).toHaveBeenCalled();
	} );

	it( 'adds a post status — the verb that lived only in a right-click', () => {
		const onAddPostStatus = jest.fn();
		renderInspector( nothingSelected( { onAddPostStatus } ) );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add post status…' } )
		);

		expect( onAddPostStatus ).toHaveBeenCalled();
	} );

	it( 'keeps the menu item’s own gate: every status is already drawn', () => {
		const onAddPostStatus = jest.fn();
		renderInspector(
			nothingSelected( { canAddPostStatus: false, onAddPostStatus } )
		);

		// `aria-disabled`, not the native attribute: unavailable and still
		// reachable, so tabbing the panel finds the control and hears that it
		// is spoken for rather than skipping past a button that isn't there.
		// The canvas menu's item is the opposite — its roving focus is built on
		// native `disabled` — and the two differ because a menu holds its own
		// tab stop while a panel hands out one per control.
		const button = screen.getByRole( 'button', {
			name: 'Add post status…',
		} );
		expect( button ).toHaveAttribute( 'aria-disabled', 'true' );

		button.focus();
		expect( button ).toHaveFocus();

		fireEvent.click( button );
		expect( onAddPostStatus ).not.toHaveBeenCalled();
	} );
} );
