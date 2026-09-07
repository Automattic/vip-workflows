/**
 * Unit tests for StageInspector — its read-outs and its AI-stage config.
 *
 * Most of what a stage is set to is set on the canvas: the status section the
 * node sits in, the boundary line it straddles, the connections drawn out of
 * it, and where an agent's outcomes lead. The panel reports all of it in text
 * and offers a control for none of it, so these tests pin both halves — the
 * value each read-out names, and the absence of anything to edit it with.
 *
 * The panel holds one AI control: the Agent picker, a combobox — the list is
 * every stage-eligible ability on the site, so it is searched rather than
 * scrolled. Choosing an ability is what makes a stage AI-owned — there is no
 * separate toggle — and it emits an `agent_ability_id` change the editor turns
 * into the `stage.agent` shape, so clearing it can drop the whole agent rather
 * than leave a partial behind.
 *
 * Where each outcome leads is assigned on the canvas by dragging from the node's
 * pass / fail / error handles, so this panel only reads those routes back. These
 * pin both halves: the picker's emissions, and the read-out.
 *
 * The picker sits in the open, beside Label and Color, on every stage — it used
 * to be inside a collapsible "AI stage" section that these tests had to open
 * first. The absence of that section is asserted below, so bringing it back
 * breaks a test rather than quietly re-hiding the control.
 *
 * Everything the canvas sets is read back in one untitled group: what the stage
 * is (its status, its checkpoint), then every way out of it (transitions and an
 * agent's outcome routes together). The tests reach rows by their label text
 * rather than by section, which is what that group leaves to reach them by.
 *
 * That exit list is deduplicated: a routed outcome's row absorbs the transition
 * it travels (the row reads "transition name · on outcome"), and only
 * transitions no outcome claims — disabled leftovers, dangling repairs — keep
 * rows of their own. The dedup describe pins the row count, the composed
 * names, and the leftovers' reachability.
 *
 * @package
 */

import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from './helpers/render-wp-component';

import StageInspector from '../../src/admin/components/graph/StageInspector';

const AGENTS = [
	{ id: 'workflow-agent-copy-edit/copy-edit', label: 'Copy Edit' },
	{ id: 'workflow-agent-fact-check/fact-check', label: 'Fact Check' },
];

const stage = ( overrides = {} ) => ( {
	key: 'review',
	label: 'Review',
	color: '#C36EFF',
	transitions: [ { to: 'done', label: 'Approve' } ],
	...overrides,
} );

function renderInspector( stageProps, onChange = jest.fn(), extraProps = {} ) {
	render(
		<StageInspector
			stage={ stageProps }
			availableAgents={ AGENTS }
			resolveStageLabel={ ( key ) => ( key === 'done' ? 'Done' : key ) }
			stageExists={ ( key ) => key === 'done' }
			onChange={ onChange }
			onDelete={ () => {} }
			canDelete={ true }
			isKeyInUse={ () => false }
			{ ...extraProps }
		/>
	);
	return onChange;
}

const agentPicker = () => screen.getByRole( 'combobox', { name: 'Agent' } );

// The picker is a combobox: its options exist only while it is open, and it
// displays the chosen agent's label rather than the ability id underneath.
// Opening by click rather than typing, since every test here wants the whole
// list — the filtering is the control's, not ours.
function pickAgent( name ) {
	fireEvent.click( agentPicker() );
	fireEvent.click( screen.getByRole( 'option', { name } ) );
}

describe( 'StageInspector and the stage’s place on the canvas', () => {
	// Where a stage sits is said by the canvas: the status region section it is
	// in, and the boundary line it straddles when it holds that region's entry
	// checkpoint. Both were once editable here too, which made the panel a
	// second, mutable copy of what the canvas already showed. Dragging is the
	// gesture now, and `RegionInspector` names the checkpoint from the region's
	// side — so neither control belongs on the stage.
	it( 'offers no post status control', () => {
		renderInspector( stage( { status: 'publish' } ) );

		expect(
			screen.queryByRole( 'combobox', { name: 'Status' } )
		).not.toBeInTheDocument();
	} );

	it( 'offers no entry-checkpoint control', () => {
		renderInspector( stage( { status: 'publish', region_entry: true } ) );

		expect(
			screen.queryByRole( 'checkbox', { name: /Entry checkpoint/i } )
		).not.toBeInTheDocument();
	} );

	// Setting both by dragging is one thing; checking them by reading the canvas
	// back is another. The panel says what the selected stage is currently set
	// to, in text, without any of it being a control.
	const factRow = ( name ) => screen.getByText( name ).closest( 'li' );

	it( 'names the post status the stage sits in', () => {
		renderInspector( stage( { status: 'publish' } ) );

		expect( factRow( 'Post status' ) ).toHaveTextContent( 'Published' );
	} );

	it( 'falls back to the status a stage with none will be stored with', () => {
		// The server persists a stage carrying no `status` as draft, so an
		// unsaved or legacy one reads as the region it will land in, not blank.
		renderInspector( stage() );

		expect( factRow( 'Post status' ) ).toHaveTextContent( 'Draft' );
	} );

	it( 'says whether the stage holds its status’s entry checkpoint', () => {
		renderInspector( stage( { status: 'publish', region_entry: true } ) );

		expect( factRow( 'Entry checkpoint' ) ).toHaveTextContent( 'Yes' );
	} );

	it( 'says so when another stage holds it', () => {
		renderInspector( stage( { status: 'publish' } ) );

		expect( factRow( 'Entry checkpoint' ) ).toHaveTextContent( 'No' );
	} );

	// The section prose these replace explained two settings in one paragraph
	// above both of them. A tooltip belongs to one parameter, so the paragraph
	// had to split — and a read-out row is two `<Text>`s with nothing to hover
	// and nothing to focus, so each needed a real trigger built for it.
	it( 'explains the post status through a focusable trigger, not hover text', () => {
		renderInspector( stage( { status: 'publish' } ) );

		const trigger = within( factRow( 'Post status' ) ).getByRole(
			'button',
			{
				name: 'About Post status',
			}
		);
		// A button, so hover is not the only way in.
		expect( trigger ).toBeEnabled();
	} );

	it( 'explains the entry checkpoint separately, on its own row', () => {
		renderInspector( stage( { status: 'publish' } ) );

		expect(
			within( factRow( 'Entry checkpoint' ) ).getByRole( 'button', {
				name: 'About Entry checkpoint',
			} )
		).toBeEnabled();
	} );
} );

describe( 'StageInspector transition read-out', () => {
	it( 'lists each way out by its button label and where it leads', () => {
		renderInspector(
			stage( { transitions: [ { to: 'done', label: 'Approve' } ] } )
		);

		// The button label, not the outcome vocabulary the AI section uses: this
		// is what an author sees on the transition in the post editor.
		expect(
			screen.getByText( 'Approve' ).closest( 'li' )
		).toHaveTextContent( 'Done' );
	} );

	it( 'names an unlabelled transition the way the runtime will', () => {
		// Not "Unlabelled transition": leaving the label blank does not leave
		// the transition nameless, it makes `StatusManager::transition_label()`
		// derive one from the destination on every read. The read-out has to
		// say the string a writer will actually see on the button.
		renderInspector( stage( { transitions: [ { to: 'done' } ] } ) );

		expect( screen.getByText( 'Move to Done' ) ).toBeInTheDocument();
	} );

	it( 'treats a whitespace-only label as unauthored, as the runtime does', () => {
		renderInspector(
			stage( { transitions: [ { to: 'done', label: ' ' } ] } )
		);

		expect( screen.getByText( 'Move to Done' ) ).toBeInTheDocument();
	} );

	it( 'derives from the destination stage, never from its missing marker', () => {
		// The value half reports a destination that no longer exists; the name
		// half must not, because the runtime would never put "(missing)" on a
		// button.
		renderInspector( stage( { transitions: [ { to: 'deleted' } ] } ) );

		expect( screen.getByText( 'Move to deleted' ) ).toBeInTheDocument();
		expect( screen.getByText( 'deleted (missing)' ) ).toBeInTheDocument();
	} );

	it( 'flags a transition whose destination stage is gone', () => {
		renderInspector(
			stage( { transitions: [ { to: 'deleted', label: 'Approve' } ] } )
		);

		expect( screen.getByText( 'deleted (missing)' ) ).toBeInTheDocument();
	} );

	it( 'shows both of two transitions to the same stage', () => {
		// A stage stored before the one-transition-per-target rule can hold
		// two, and this read-out is where an author is asked to look at them
		// before the repair collapses one — so the rows cannot be keyed on the
		// target, which would collide on exactly those configs and hide the
		// duplicate on the screen meant to show it.
		renderInspector(
			stage( {
				transitions: [
					{ to: 'done', label: 'Approve' },
					{ to: 'done', label: 'Approve anyway' },
				],
			} )
		);

		expect( screen.getByText( 'Approve' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Approve anyway' ) ).toBeInTheDocument();
	} );

	it( 'says what is empty, and how to fill it, when nothing leaves the stage', () => {
		renderInspector( stage( { transitions: [] } ) );

		// No heading above it supplies the subject any more, so the sentence
		// has to name what is empty itself — and it carries the instruction for
		// adding a transition, which is most needed on exactly this stage.
		expect(
			screen.getByText( /Nothing leaves this stage yet/ )
		).toHaveTextContent( 'Drag from one of its handles on the canvas' );
	} );

	it( 'marks a transition the stage’s agent has taken over', () => {
		// An agent owns every exit of the stage it runs on, so a transition no
		// outcome routes along cannot be used by anyone — the read-out would
		// otherwise offer it as a way out that content can never take.
		renderInspector(
			stage( {
				transitions: [ { to: 'done', label: 'Approve' } ],
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: {},
				},
			} )
		);

		expect(
			screen.getByText( 'Approve' ).closest( 'li' )
		).toHaveTextContent( 'Done (disabled)' );
	} );

	it( 'absorbs the transition an outcome routes along into the outcome’s row', () => {
		// One exit, one row: the routed outcome and the transition it travels
		// are the same way out, so the outcome row carries the transition's
		// name — qualified by the outcome — and no second row repeats it.
		renderInspector(
			stage( {
				transitions: [ { to: 'done', label: 'Approve' } ],
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: { pass: 'done' },
				},
			} )
		);

		const row = screen.getByText( 'Approve · on pass' ).closest( 'li' );
		expect( row ).toHaveTextContent( 'Done' );
		// A live exit, not a leftover: the (disabled) marker belongs only to
		// transitions no outcome claims.
		expect( row ).not.toHaveTextContent( 'disabled' );
		// And the transition renders nowhere else — no bare "Approve" row.
		expect( screen.queryByText( 'Approve' ) ).not.toBeInTheDocument();
	} );
} );

describe( 'StageInspector deduplicated exit list', () => {
	// The exit list showed every routed exit twice — once as a clickable
	// outcome row, once as the transition it travels — so an AI stage looked
	// like it had double the exits it has. One exit is one row now: a routed
	// outcome's row absorbs its transition (composed name), and only what no
	// outcome claims keeps a row of its own.
	const labels = {
		copyedit: 'Copy Edit',
		factcheck: 'Fact Check',
		draft: 'Draft',
		archive: 'Archive stage',
	};
	const routedStage = ( overrides = {} ) =>
		stage( {
			transitions: [
				{ to: 'copyedit', label: 'Send to copyedit' },
				{ to: 'factcheck' },
				{ to: 'draft' },
				{ to: 'archive', label: 'Archive' },
			],
			agent: {
				ability_id: 'workflow-agent-copy-edit/copy-edit',
				routing: {
					pass: 'copyedit',
					fail: 'factcheck',
					error: 'draft',
				},
			},
			...overrides,
		} );
	const props = {
		resolveStageLabel: ( key ) => labels[ key ] || key,
		stageExists: ( key ) => Boolean( labels[ key ] ),
	};

	it( 'renders one row per exit: three routed outcomes plus the unclaimed transition', () => {
		renderInspector( routedStage(), jest.fn(), props );

		const exits = screen
			.getByText( 'Send to copyedit · on pass' )
			.closest( 'ul' );
		expect( within( exits ).getAllByRole( 'listitem' ) ).toHaveLength( 4 );
	} );

	it( 'composes each routed outcome’s row from its transition’s name', () => {
		renderInspector( routedStage(), jest.fn(), props );

		// An authored label rides as authored; an unlabelled transition is
		// named the way the runtime names its button, derived from the
		// destination — the composition never invents a third wording.
		expect(
			screen.getByText( 'Send to copyedit · on pass' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Move to Fact Check · on fail' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Move to Draft · on error' )
		).toBeInTheDocument();
	} );

	it( 'keeps the unclaimed transition listed as a disabled leftover', () => {
		renderInspector( routedStage(), jest.fn(), props );

		expect(
			screen.getByText( 'Archive' ).closest( 'li' )
		).toHaveTextContent( 'Archive stage (disabled)' );
	} );

	it( 'reorders the listed rows around a claimed one, by original index', async () => {
		// The listed rows keep their positions in the STORED array, and with a
		// claimed row absorbed above them those positions are non-contiguous —
		// here the claimed transition holds index 0, the listed rows indices
		// 1–3. A reorder that renumbered the visible rows would move the wrong
		// transition; this drives the real keyboard path (the one that always
		// works in this narrow panel) and asserts the full array comes back
		// with the claimed row intact.
		const onChange = jest.fn();
		renderInspector(
			routedStage( {
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: { pass: 'copyedit' },
				},
			} ),
			onChange,
			props
		);

		// jsdom lays nothing out, so the sortable rows are given stacked
		// geometry for the keyboard coordinate getter to navigate by.
		screen
			.getAllByRole( 'button', { name: /^Reorder / } )
			.forEach( ( handle, i ) => {
				handle.closest( 'li' ).getBoundingClientRect = () => ( {
					x: 0,
					y: i * 30,
					width: 280,
					height: 28,
					top: i * 30,
					bottom: i * 30 + 28,
					left: 0,
					right: 280,
					toJSON: () => {},
				} );
			} );

		const grip = screen.getByRole( 'button', {
			name: 'Reorder Move to Fact Check',
		} );
		grip.focus();
		fireEvent.keyDown( grip, { code: 'Space' } );
		// Lifted — dnd-kit flags the active handle — before steering, so the
		// droppable rects have been measured by the time the move asks for
		// them.
		await waitFor( () =>
			expect( grip ).toHaveAttribute( 'aria-pressed', 'true' )
		);
		fireEvent.keyDown( grip, { code: 'ArrowDown' } );
		fireEvent.keyDown( grip, { code: 'Space' } );

		await waitFor( () => expect( onChange ).toHaveBeenCalled() );
		expect( onChange ).toHaveBeenCalledWith( {
			transitions: [
				{ to: 'copyedit', label: 'Send to copyedit' },
				{ to: 'draft' },
				{ to: 'factcheck' },
				{ to: 'archive', label: 'Archive' },
			],
		} );
	} );

	it( 'selects the outcome’s own edge from its composed row', () => {
		const onSelectEdge = jest.fn();
		renderInspector( routedStage(), jest.fn(), {
			...props,
			onSelectEdge,
		} );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Select Send to copyedit · on pass',
			} )
		);

		expect( onSelectEdge ).toHaveBeenCalledWith( 'review:pass->copyedit' );
	} );

	it( 'keeps a dangling transition listed and clickable', () => {
		// A transition to a deleted stage draws no edge on the canvas, so this
		// list is the only way to its panel and its Remove — the dedup must
		// never absorb it. Here nothing routes at it; the paired case, where a
		// route names the same missing stage, is pinned separately below.
		const onSelectEdge = jest.fn();
		renderInspector(
			stage( {
				transitions: [ { to: 'deleted' } ],
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: {},
				},
			} ),
			jest.fn(),
			{ onSelectEdge }
		);

		const row = screen.getByText( 'Move to deleted' ).closest( 'li' );
		expect( row ).toHaveTextContent( 'deleted (missing)' );

		fireEvent.click(
			within( row ).getByRole( 'button', {
				name: 'Select Move to deleted',
			} )
		);

		expect( onSelectEdge ).toHaveBeenCalledWith( 'review->deleted' );
	} );

	it( 'never absorbs a dangling transition, even when a route names its target', () => {
		// The editor cannot write this pair — deleting a stage drops the
		// transitions aimed at it — but imported JSON can hold both a route
		// and a transition naming a stage that no longer exists. Absorbing
		// that transition would bury the only reachable home of its Remove
		// inside an outcome row, so the route claims nothing: the outcome
		// reads as itself with the missing destination, and the transition
		// keeps its own listed, clickable row.
		const onSelectEdge = jest.fn();
		renderInspector(
			stage( {
				transitions: [ { to: 'deleted' } ],
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: { pass: 'deleted' },
				},
			} ),
			jest.fn(),
			{ onSelectEdge }
		);

		// The outcome row: bare name, flagged destination, nothing absorbed.
		const outcomeRow = screen.getByText( 'On pass' ).closest( 'li' );
		expect( outcomeRow ).toHaveTextContent( 'deleted (missing)' );
		expect(
			screen.queryByText( 'Move to deleted · on pass' )
		).not.toBeInTheDocument();

		// The transition's own row survives, and still opens its panel.
		const row = screen.getByText( 'Move to deleted' ).closest( 'li' );
		fireEvent.click(
			within( row ).getByRole( 'button', {
				name: 'Select Move to deleted',
			} )
		);
		expect( onSelectEdge ).toHaveBeenCalledWith( 'review->deleted' );
	} );

	it( 'absorbs only the first of two transitions to a routed target', () => {
		// A stage stored before the one-transition-per-target rule can hold a
		// duplicate pair, and this read-out is where an author is asked to
		// look at them before the repair collapses one. The outcome absorbs
		// the first — the one selecting the pair resolves — and the second
		// stays visible.
		renderInspector(
			stage( {
				transitions: [
					{ to: 'done', label: 'Approve' },
					{ to: 'done', label: 'Approve anyway' },
				],
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: { pass: 'done' },
				},
			} )
		);

		expect( screen.getByText( 'Approve · on pass' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Approve anyway' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Approve' ) ).not.toBeInTheDocument();
	} );

	it( 'names one transition on both outcome rows that share it', () => {
		// Two outcomes routed to the same destination travel the same
		// transition: each row composes its own qualifier onto the shared
		// name, and the transition itself is listed nowhere else.
		renderInspector(
			stage( {
				transitions: [ { to: 'done', label: 'Approve' } ],
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: { pass: 'done', fail: 'done' },
				},
			} )
		);

		expect( screen.getByText( 'Approve · on pass' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Approve · on fail' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Approve' ) ).not.toBeInTheDocument();
	} );
} );

describe( 'StageInspector AI-stage config', () => {
	it( 'offers the agent picker in the open on a stage with no agent', () => {
		renderInspector( stage() );

		// No disclosure to open: which agent runs a stage is part of what the
		// stage is, so it sits with the label and the color on every stage
		// rather than behind a section that stays shut on most of them.
		expect(
			screen.queryByRole( 'button', { name: /AI stage/i } )
		).not.toBeInTheDocument();
		expect( agentPicker() ).toHaveValue( '' );
	} );

	it( 'offers the agent picker with no toggle in front of it', () => {
		renderInspector( stage() );

		// The toggle it replaced is gone: picking an agent is the whole gesture.
		expect(
			screen.queryByRole( 'checkbox', { name: /Run an agent/i } )
		).not.toBeInTheDocument();
	} );

	it( 'picking an agent is what makes the stage an AI stage', () => {
		const onChange = renderInspector( stage() );

		pickAgent( 'Copy Edit' );

		expect( onChange ).toHaveBeenCalledWith( {
			agent_ability_id: 'workflow-agent-copy-edit/copy-edit',
		} );
	} );

	it( 'filters the agent list by what is typed', () => {
		renderInspector( stage() );

		fireEvent.click( agentPicker() );
		fireEvent.change( agentPicker(), { target: { value: 'fact' } } );

		expect(
			screen.getByRole( 'option', { name: 'Fact Check' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'option', { name: 'Copy Edit' } )
		).not.toBeInTheDocument();
	} );

	it( 'clearing the agent picker clears the stage’s agent', () => {
		const onChange = renderInspector(
			stage( {
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: {},
				},
			} )
		);

		// The combobox has no "none" entry — resetting is how the agent comes
		// off, and it hands back null, which the panel reads as "no agent".
		fireEvent.click( screen.getByRole( 'button', { name: 'Reset' } ) );

		expect( onChange ).toHaveBeenCalledWith( { agent_ability_id: '' } );
	} );

	it( 'keeps Reset reachable when the field is focused', () => {
		renderInspector(
			stage( {
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: {},
				},
			} )
		);

		// `ComboboxControl` unmounts its Reset button while the list is
		// expanded, and expands on focus by default — which would leave a
		// keyboard user tabbing into the field with the only way to clear an
		// agent gone. `expandOnFocus={ false }` is what stops that, and the
		// picker moving up beside Label and Color must not lose it.
		fireEvent.focus( agentPicker() );

		expect(
			screen.getByRole( 'button', { name: 'Reset' } )
		).toBeInTheDocument();
	} );

	it( 'reads back where each outcome leads instead of offering routing controls', () => {
		renderInspector(
			stage( {
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: { error: 'done' },
				},
			} )
		);

		// The picker shows the agent's name; the ability id stays underneath.
		expect( agentPicker() ).toHaveValue( 'Copy Edit' );

		// All three outcomes are listed. The two unrouted ones read by their
		// bare outcome names; the routed one has absorbed the transition it
		// travels, so its row is the transition's name qualified by the
		// outcome. None of them is a control — the routes are drawn on the
		// canvas.
		for ( const label of [ 'On pass', 'On fail' ] ) {
			expect( screen.getByText( label ) ).toBeInTheDocument();
			expect(
				screen.queryByRole( 'combobox', { name: label } )
			).not.toBeInTheDocument();
		}
		expect(
			within(
				screen.getByText( 'Approve · on error' ).closest( 'li' )
			).getByText( 'Done' )
		).toBeInTheDocument();
		expect( screen.getAllByText( 'Not routed' ) ).toHaveLength( 2 );
	} );

	it( 'flags a route whose destination stage is gone', () => {
		renderInspector(
			stage( {
				agent: { ability_id: 'x', routing: { error: 'deleted' } },
			} )
		);

		expect( screen.getByText( 'deleted (missing)' ) ).toBeInTheDocument();
	} );
} );

describe( 'StageInspector panel structure', () => {
	const deleteButton = () =>
		screen.getByRole( 'button', { name: /Delete stage/i } );

	it( 'deletes from a labelled control at the end of the body', () => {
		const onDelete = jest.fn();
		renderInspector( stage(), jest.fn(), { onDelete } );

		// Its name is its own text, not a tooltip: an icon-only control in the
		// header said "Delete stage" only on hover, which is nothing at all on
		// a touch screen.
		expect( deleteButton() ).toHaveTextContent( 'Delete stage' );
		// Inside the scrolling body, after the options — not in the header,
		// where it sat above every field it destroys.
		expect(
			deleteButton().closest( '.wf-inspector__head' )
		).not.toBeInTheDocument();

		fireEvent.click( deleteButton() );

		expect( onDelete ).toHaveBeenCalled();
	} );

	it( 'disables delete when the stage is the sequence’s last one, and says why', () => {
		renderInspector( stage(), jest.fn(), { canDelete: false } );

		// `aria-disabled`, not `disabled`: the button stays focusable so the
		// reason below it is announced, which a truly disabled control would
		// drop out of the tab order along with its description.
		expect( deleteButton() ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'A sequence needs at least one stage.' )
		).toBeInTheDocument();
	} );

	it( 'keeps the stage key behind Advanced, out of the collapsed row', () => {
		renderInspector( stage() );

		const advanced = screen.getByRole( 'button', { name: /Advanced/i } );
		expect( advanced ).toHaveAttribute( 'aria-expanded', 'false' );
		// The canvas and the rest of the inspector already say which stage is
		// selected, so the collapsed row does not repeat its key back.
		expect( advanced ).not.toHaveTextContent( 'review' );

		fireEvent.click( advanced );
		expect( screen.getByRole( 'textbox', { name: 'Key' } ) ).toHaveValue(
			'review'
		);
	} );

	// The read-out used to be three titled sections — Placement, Transitions,
	// AI stage — each restating in a heading what its rows already said.
	it( 'reads the canvas back without a heading over every kind of row', () => {
		renderInspector(
			stage( {
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: { pass: 'done' },
				},
			} )
		);

		for ( const gone of [ 'Placement', 'Transitions', 'AI stage' ] ) {
			expect(
				screen.queryByRole( 'heading', { name: gone } )
			).not.toBeInTheDocument();
		}
		// Two headings left: the panel's own title, naming the stage, and the
		// disclosure over the key. The outline is deliberately that flat — the
		// title already says what everything below it is about.
		expect(
			screen.getAllByRole( 'heading' ).map( ( h ) => h.textContent )
		).toEqual( [ 'Review', 'Advanced' ] );
	} );

	it( 'lists an agent’s outcomes and the stage’s transitions in one list', () => {
		// Two transitions: the outcome absorbs the one it routes along, and
		// the unclaimed one keeps a row of its own — in the same list.
		renderInspector(
			stage( {
				transitions: [
					{ to: 'done', label: 'Approve' },
					{ to: 'archive', label: 'Archive' },
				],
				agent: {
					ability_id: 'workflow-agent-copy-edit/copy-edit',
					routing: { pass: 'done' },
				},
			} )
		);

		const exits = screen.getByText( 'On fail' ).closest( 'ul' );
		// Both kinds of exit in the same list: to a post travelling them, a
		// button an author drew and a route an agent takes are the same thing.
		expect(
			within( exits ).getByText( 'Approve · on pass' )
		).toBeInTheDocument();
		expect( within( exits ).getByText( 'Archive' ) ).toBeInTheDocument();
		// And apart from the facts about the stage itself, which keep their own.
		expect( within( exits ).queryByText( 'Post status' ) ).toBeNull();
	} );

	it( 'keeps label and color open in place', () => {
		renderInspector( stage( { status: 'draft' } ) );

		expect( screen.getByRole( 'textbox', { name: 'Label' } ) ).toHaveValue(
			'Review'
		);
		expect(
			screen.getByRole( 'combobox', { name: 'Color' } )
		).toBeInTheDocument();
	} );

	// An unconfigured agent is marked, not withheld. Hiding it would
	// block designing a sequence before wiring credentials, and would not prevent
	// the stuck state anyway — an agent can go unavailable after the save.
	describe( 'an agent that cannot run', () => {
		const unconfigured = [
			{
				id: 'workflow-agent-copy-edit/copy-edit',
				label: 'Copy Edit',
				available: false,
				availability: {
					available: false,
					groups: [
						{
							satisfy: 'all',
							requirements: [
								{
									id: 'credential:tavily',
									kind: 'missing_credential',
									sources: [ 'Copy Edit' ],
									reason: 'Tavily is not connected.',
									destination: {
										kind: 'admin_url',
										url: 'https://example.com/wp-admin/options-connectors.php',
										label: 'Settings → Connectors',
										hint: '',
									},
								},
							],
						},
					],
				},
			},
		];

		it( 'marks it in the picker but leaves it selectable', () => {
			// No agent picked yet: the marker has to be legible *before* the
			// choice, which is the only moment it can steer one. The section
			// starts collapsed on a stage with no agent, so open it first —
			// there is no half-on "AI enabled, none picked" state to render.
			renderInspector( stage(), jest.fn(), {
				availableAgents: unconfigured,
			} );
			fireEvent.click( agentPicker() );

			const option = screen.getByRole( 'option', {
				name: 'Copy Edit — setup needed',
			} );

			expect( option ).toBeInTheDocument();
			expect( option ).not.toBeDisabled();
		} );

		it( 'names the requirement and the consequence once selected', () => {
			renderInspector(
				stage( {
					agent: {
						ability_id: 'workflow-agent-copy-edit/copy-edit',
						routing: {},
					},
				} ),
				jest.fn(),
				{ availableAgents: unconfigured }
			);

			expect(
				screen.getByText( 'Tavily is not connected.' )
			).toBeInTheDocument();
			expect(
				screen.getByRole( 'link', { name: /Settings → Connectors/ } )
			).toBeInTheDocument();
			expect(
				screen.getByText(
					/following the on-error route if one is set, stopping here otherwise/
				)
			).toBeInTheDocument();
		} );

		it( 'says so plainly when the agent is gone entirely', () => {
			renderInspector(
				stage( {
					agent: { ability_id: 'deactivated/agent', routing: {} },
				} ),
				jest.fn(),
				{ availableAgents: unconfigured }
			);

			expect(
				screen.getByText( /no longer available on this site/ )
			).toBeInTheDocument();
		} );

		it( 'still shows the ability it is holding when nothing matches it', () => {
			// The combobox displays whichever option matches its value, so an
			// unregistered ability needs an entry of its own — otherwise the
			// field reads empty and looks like a stage with no agent at all.
			renderInspector(
				stage( {
					agent: { ability_id: 'deactivated/agent', routing: {} },
				} ),
				jest.fn(),
				{ availableAgents: unconfigured }
			);

			expect( agentPicker() ).toHaveValue(
				'deactivated/agent (unavailable)'
			);
		} );

		it( 'stays quiet when the selected agent can run', () => {
			renderInspector(
				stage( {
					agent: {
						ability_id: 'workflow-agent-fact-check/fact-check',
						routing: {},
					},
				} )
			);

			expect(
				screen.queryByText( /following the on-error route/ )
			).not.toBeInTheDocument();
		} );
	} );
} );
