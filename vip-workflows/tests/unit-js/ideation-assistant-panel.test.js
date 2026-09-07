/**
 * Unit tests for the ideation panel's unavailable-agent rendering.
 *
 * This is the editor-facing half of the structured availability work: it renders
 * what an editor sees when a research assistant could not run. It matters more
 * than its size suggests, because the editor is the reader who may have no way
 * to fix the problem — agent execution is gated on `edit_posts`, while the
 * Agents screen and Settings → Connectors both need `manage_options`. So the
 * rules under test are:
 *
 *   - a requirement carrying only the user register (`message`, no `reason`)
 *     still renders, and never produces a link;
 *   - an `unavailable` assistant is not styled as a failure it caused;
 *   - a genuine `failed` assistant keeps its error styling.
 *
 * Asserted through `AssistantPanel` rather than by exporting its internals: the
 * branch that chooses between the unavailable detail and the error line is part
 * of what needs pinning.
 *
 * @package
 */

import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
	act,
} from './helpers/render-wp-component';

import AssistantPanel, {
	SEED_ANALYST_ID,
} from '../../src/admin/components/ideation/AssistantPanel';

import { disabledVipAbility, vipAbility } from './helpers/abilities-fixture';

const ABILITY = 'vip-workflows/web-researcher';

const OFF_ABILITY = 'workflow-discovery-foresight/foresight-research';

/*
 * The abilities response comes from the shared builder in
 * ./helpers/abilities-fixture, which is generated from
 * tests/fixtures/abilities-response-contract.json and guarded in both directions by
 * ./abilities-response-contract.test.js. This fixture used to be hand-built and set
 * `name: 'Web Researcher'`, which no endpoint ever returns — and that is why these
 * tests stayed green while the panel rendered `vip-workflows/web-researcher` on
 * screen. A fixture that encodes the bug's assumption cannot catch the bug, so it is
 * no longer written by hand here.
 */
const RESEARCH_ABILITIES = [
	vipAbility( { id: ABILITY, label: 'Web Researcher' } ),
];

const TURNED_OFF_ABILITY = disabledVipAbility( {
	id: OFF_ABILITY,
	label: 'Foresight News',
	icon: 'book-alt',
} );

const CONNECTORS_URL = 'https://example.com/wp-admin/options-connectors.php';

/**
 * Render the panel with one assistant in a given state.
 *
 * @param {Object} data       Assistant result payload.
 * @param {Object} extraProps Additional panel props to merge in.
 * @return {Object} Render result.
 */
function renderPanel( data, extraProps = {} ) {
	return render(
		<AssistantPanel
			assistants={ {
				[ ABILITY ]: { label: 'Web Researcher', ...data },
			} }
			researchAbilities={ RESEARCH_ABILITIES }
			seedAnalysis={ null }
			mentorResult={ null }
			mentorSuggestions={ [] }
			mentorLoading={ false }
			onRunMentor={ () => {} }
			onRunQuery={ () => {} }
			autoRefresh={ false }
			onToggleAutoRefresh={ () => {} }
			queryLog={ [] }
			runningQuery={ null }
			{ ...extraProps }
		/>
	);
}

/**
 * An unmet requirement in the admin register (reason + destination).
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Requirement.
 */
const adminRequirement = ( overrides = {} ) => ( {
	id: 'credential:tavily',
	kind: 'missing_credential',
	reason: 'Tavily is not connected.',
	destination: {
		kind: 'admin_url',
		url: CONNECTORS_URL,
		label: 'Settings → Connectors',
		hint: '',
	},
	...overrides,
} );

const group = ( satisfy, requirements ) => ( { satisfy, requirements } );

const unavailable = ( groups, error ) => ( {
	status: 'unavailable',
	error,
	availability: groups ? { available: false, groups } : undefined,
} );

describe( 'ideation panel — an assistant that could not run', () => {
	it( 'falls back to the stored generic line when there are no requirements', () => {
		// A third-party agent whose callback returns a bare `false` reports no
		// requirements. The bool contract is preserved on purpose, so the generic
		// line is all there is to show.
		const { container } = renderPanel(
			unavailable( [], 'Research agent is not configured.' )
		);

		expect(
			screen.getByText( 'Research agent is not configured.' )
		).toBeInTheDocument();
		expect(
			container.querySelector(
				'.vip-workflows-ideation-panel__assistant-error'
			)
		).not.toBeInTheDocument();
	} );

	it( 'renders nothing when there are neither requirements nor a message', () => {
		renderPanel( unavailable( [], undefined ) );

		expect( screen.queryByText( /not connected/ ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( /Configure at least one/ )
		).not.toBeInTheDocument();
	} );

	it( 'names the requirement and links to its destination', () => {
		renderPanel(
			unavailable( [ group( 'all', [ adminRequirement() ] ) ] )
		);

		expect(
			screen.getByText( /Tavily is not connected\./ )
		).toBeInTheDocument();

		const link = screen.getByRole( 'link', {
			name: /Settings → Connectors/,
		} );
		expect( link ).toHaveAttribute( 'href', CONNECTORS_URL );
	} );

	it( 'renders the user register and never links from it', () => {
		// The editor register omits `reason` and `destination` entirely, so this
		// is the shape an `edit_posts`-only reader actually receives. It must
		// still say something, and must not offer a link to a screen the reader
		// cannot open.
		const { container } = renderPanel(
			unavailable( [
				group( 'all', [
					{
						id: 'credential:tavily',
						kind: 'missing_credential',
						message:
							'Tavily is not connected. Ask an administrator to connect it.',
					},
				] ),
			] )
		);

		expect(
			screen.getByText( /Ask an administrator to connect it\./ )
		).toBeInTheDocument();
		expect( container.querySelector( 'a[href]' ) ).not.toBeInTheDocument();
		expect( container.innerHTML ).not.toContain( '/wp-admin/' );
	} );

	it( 'renders a hint as text when the destination is not a link', () => {
		const { container } = renderPanel(
			unavailable( [
				group( 'all', [
					adminRequirement( {
						destination: {
							kind: 'none',
							url: '',
							label: '',
							hint: 'Set the VIP_WORKFLOWS_TAVILY_KEY constant in wp-config.php.',
						},
					} ),
				] ),
			] )
		);

		expect(
			screen.getByText( /VIP_WORKFLOWS_TAVILY_KEY/ )
		).toBeInTheDocument();
		expect( container.querySelector( 'a[href]' ) ).not.toBeInTheDocument();
	} );

	it( 'leads an any-group of two with "at least one of"', () => {
		renderPanel(
			unavailable( [
				group( 'any', [
					adminRequirement(),
					adminRequirement( {
						id: 'credential:youtube',
						reason: 'YouTube Data API is not connected.',
					} ),
				] ),
			] )
		);

		expect(
			screen.getByText( 'Configure at least one of:' )
		).toBeInTheDocument();
		expect(
			screen.getByText( /YouTube Data API is not connected\./ )
		).toBeInTheDocument();
	} );

	it( 'omits the lead-in for an any-group of one', () => {
		// "At least one of" in front of a single item reads as a mistake.
		renderPanel(
			unavailable( [ group( 'any', [ adminRequirement() ] ) ] )
		);

		expect(
			screen.queryByText( 'Configure at least one of:' )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( /Tavily is not connected\./ )
		).toBeInTheDocument();
	} );

	it( 'keeps error styling for a genuine failure', () => {
		// `unavailable` is a configuration state; `failed` is an error. Retoning
		// the first must not have retoned the second.
		const { container } = renderPanel( {
			status: 'failed',
			error: 'The provider returned a 500.',
		} );

		expect(
			container.querySelector(
				'.vip-workflows-ideation-panel__assistant-error'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( 'The provider returned a 500.' )
		).toBeInTheDocument();
	} );
} );

describe( 'ideation panel — retrying an assistant that could not run', () => {
	const retryButton = () => screen.queryByRole( 'button', { name: 'Retry' } );

	it( 'offers a retry for an unavailable assistant', () => {
		renderPanel(
			unavailable( [ group( 'all', [ adminRequirement() ] ) ] ),
			{
				onRetryAssistant: () => Promise.resolve(),
			}
		);

		expect( retryButton() ).toBeInTheDocument();
	} );

	it( 'runs that assistant when clicked', async () => {
		const onRetryAssistant = jest.fn( () => Promise.resolve() );
		renderPanel(
			unavailable( [ group( 'all', [ adminRequirement() ] ) ] ),
			{ onRetryAssistant }
		);

		fireEvent.click( retryButton() );

		await waitFor( () =>
			expect( onRetryAssistant ).toHaveBeenCalledWith( ABILITY )
		);
		expect( onRetryAssistant ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not fire twice while the run is in flight', async () => {
		// The handler never settles, so the second click lands while the first
		// run is still open — the state a double-click produces.
		const onRetryAssistant = jest.fn( () => new Promise( () => {} ) );
		renderPanel(
			unavailable( [ group( 'all', [ adminRequirement() ] ) ] ),
			{ onRetryAssistant }
		);

		fireEvent.click( retryButton() );

		const busy = await screen.findByRole( 'button', {
			name: 'Retrying…',
		} );
		expect( busy ).toBeDisabled();

		fireEvent.click( busy );
		expect( onRetryAssistant ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'reports a failed run without discarding the requirement', async () => {
		const onRetryAssistant = jest.fn( () =>
			Promise.reject( new Error( 'nope' ) )
		);
		renderPanel(
			unavailable( [ group( 'all', [ adminRequirement() ] ) ] ),
			{ onRetryAssistant }
		);

		fireEvent.click( retryButton() );

		expect(
			await screen.findByText(
				'The agent could not run. Nothing changed.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( /Tavily is not connected\./ )
		).toBeInTheDocument();
		expect( retryButton() ).toBeEnabled();
	} );

	it( 'shows the working state instead of the retry while that agent runs', () => {
		// The panel's own running treatment owns the row while the run is open;
		// an absent control is also a control that cannot be double-fired.
		renderPanel(
			unavailable( [ group( 'all', [ adminRequirement() ] ) ] ),
			{
				onRetryAssistant: () => Promise.resolve(),
				initialAssistants: { [ ABILITY ]: 'running' },
			}
		);

		expect( retryButton() ).not.toBeInTheDocument();
	} );

	it( 'offers no retry for a completed assistant', () => {
		renderPanel(
			{ status: 'completed', card_count: 3, summary: 'Found three.' },
			{ onRetryAssistant: () => Promise.resolve() }
		);

		expect( retryButton() ).not.toBeInTheDocument();
	} );

	it( 'offers no retry for a genuine failure', () => {
		// `failed` is an error the run produced, not a configuration state a
		// retry can resolve.
		renderPanel(
			{ status: 'failed', error: 'The provider returned a 500.' },
			{ onRetryAssistant: () => Promise.resolve() }
		);

		expect( retryButton() ).not.toBeInTheDocument();
	} );

	it( 'offers no retry when the agent has no live availability', () => {
		// `add_reader_availability()` omits the key when the ability is gone —
		// the plugin was deactivated, and re-running cannot bring it back.
		renderPanel(
			unavailable( undefined, 'Research agent is unavailable.' ),
			{
				onRetryAssistant: () => Promise.resolve(),
			}
		);

		expect(
			screen.getByText( 'Research agent is unavailable.' )
		).toBeInTheDocument();
		expect( retryButton() ).not.toBeInTheDocument();
	} );
} );

describe( 'ideation panel — starting the seed analysis over', () => {
	/**
	 * Render the panel with the Seed Analyst in a given state.
	 *
	 * @param {Object} data       Seed Analyst result payload.
	 * @param {Object} extraProps Additional panel props to merge in.
	 * @return {Object} Render result.
	 */
	function renderSeedPanel( data, extraProps = {} ) {
		return render(
			<AssistantPanel
				assistants={ {
					[ SEED_ANALYST_ID ]: {
						label: 'Seed Analyst',
						...data,
					},
				} }
				researchAbilities={ [] }
				seedAnalysis={ null }
				mentorResult={ null }
				mentorSuggestions={ [] }
				mentorLoading={ false }
				onRunMentor={ () => {} }
				onRunQuery={ () => {} }
				autoRefresh={ false }
				onToggleAutoRefresh={ () => {} }
				queryLog={ [] }
				runningQuery={ null }
				{ ...extraProps }
			/>
		);
	}

	const startButton = () =>
		screen.queryByRole( 'button', { name: 'Start over' } );

	/**
	 * Open the confirmation and answer it.
	 *
	 * @param {string} answer Accessible name of the dialog button to press.
	 */
	async function answerConfirm( answer ) {
		fireEvent.click( startButton() );

		const dialog = await screen.findByRole( 'dialog' );
		const button = within( dialog ).getByRole( 'button', { name: answer } );

		// The control resumes in a microtask once the confirmation settles, so the
		// click has to be flushed inside `act` for that update to be observed.
		await act( async () => {
			fireEvent.click( button );
		} );
	}

	// The analyst is the one agent with no per-agent retry — it is not a
	// registered ability, so the panel never receives live availability for it —
	// and a stale analysis is just as stuck whichever state it settled in.
	it.each( [
		[ 'unavailable', unavailable( [], 'Anthropic is not configured.' ) ],
		[
			'failed',
			{ status: 'failed', error: 'The provider returned a 500.' },
		],
		[
			'completed',
			{ status: 'completed', summary: 'Extracted 4 topics.' },
		],
		[ 'pending', { status: 'pending' } ],
		[ 'running', { status: 'running' } ],
	] )( 'offers the control for a %s analyst', ( _status, data ) => {
		renderSeedPanel( data, { onRestartAnalysis: () => Promise.resolve() } );

		expect( startButton() ).toBeInTheDocument();
	} );

	it( 'does not run anything until the confirmation is accepted', async () => {
		const onRestartAnalysis = jest.fn( () => Promise.resolve() );
		renderSeedPanel(
			{ status: 'completed', summary: 'Extracted 4 topics.' },
			{ onRestartAnalysis }
		);

		fireEvent.click( startButton() );

		expect( await screen.findByRole( 'dialog' ) ).toBeInTheDocument();
		expect( onRestartAnalysis ).not.toHaveBeenCalled();
	} );

	it( 'names what a re-run replaces', async () => {
		renderSeedPanel(
			{ status: 'completed', summary: 'Extracted 4 topics.' },
			{ onRestartAnalysis: () => Promise.resolve() }
		);

		fireEvent.click( startButton() );

		const dialog = await screen.findByRole( 'dialog' );
		expect(
			within( dialog ).getByText( /Pinned board cards will be lost/ )
		).toBeInTheDocument();
	} );

	it( 'runs nothing when the confirmation is cancelled', async () => {
		const onRestartAnalysis = jest.fn( () => Promise.resolve() );
		renderSeedPanel(
			{ status: 'completed', summary: 'Extracted 4 topics.' },
			{ onRestartAnalysis }
		);

		await answerConfirm( 'Cancel' );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( onRestartAnalysis ).not.toHaveBeenCalled();
		expect( startButton() ).toBeEnabled();
	} );

	it( 'runs the analysis once the confirmation is accepted', async () => {
		const onRestartAnalysis = jest.fn( () => Promise.resolve() );
		renderSeedPanel( unavailable( [], 'Anthropic is not configured.' ), {
			onRestartAnalysis,
		} );

		await answerConfirm( 'Start over' );

		await waitFor( () =>
			expect( onRestartAnalysis ).toHaveBeenCalledTimes( 1 )
		);
	} );

	it( 'disables the control while the run is in flight', async () => {
		// The handler never settles, so the second click lands while the first run
		// is still open — the state a double-click produces.
		const onRestartAnalysis = jest.fn( () => new Promise( () => {} ) );
		renderSeedPanel(
			{ status: 'completed', summary: 'Extracted 4 topics.' },
			{ onRestartAnalysis }
		);

		await answerConfirm( 'Start over' );

		const busy = await screen.findByRole( 'button', {
			name: 'Starting over…',
		} );
		expect( busy ).toBeDisabled();

		fireEvent.click( busy );
		expect( onRestartAnalysis ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'reports a run that replaced nothing', async () => {
		const onRestartAnalysis = jest.fn( () =>
			Promise.reject( new Error( 'nope' ) )
		);
		renderSeedPanel(
			{ status: 'completed', summary: 'Extracted 4 topics.' },
			{ onRestartAnalysis }
		);

		await answerConfirm( 'Start over' );

		expect(
			await screen.findByText(
				'The analysis could not run. Nothing changed.'
			)
		).toBeInTheDocument();
		// The prior analysis is still what the row describes.
		expect( screen.getByText( 'Extracted 4 topics.' ) ).toBeInTheDocument();
		expect( startButton() ).toBeEnabled();
	} );

	it( 'blocks the control while the analyst itself is running', () => {
		renderSeedPanel(
			{ status: 'completed', summary: 'Extracted 4 topics.' },
			{
				onRestartAnalysis: () => Promise.resolve(),
				initialAssistants: { [ SEED_ANALYST_ID ]: 'running' },
			}
		);

		expect( startButton() ).toBeDisabled();
	} );

	it( 'offers no control to a host that cannot run one', () => {
		renderSeedPanel( {
			status: 'completed',
			summary: 'Extracted 4 topics.',
		} );

		expect( startButton() ).not.toBeInTheDocument();
	} );

	it( 'offers no restart for a research agent', () => {
		// The control is the analyst's; research agents have their own retry.
		renderPanel( unavailable( [], 'Research agent is not configured.' ), {
			onRestartAnalysis: () => Promise.resolve(),
		} );

		expect( startButton() ).not.toBeInTheDocument();
	} );
} );

describe( 'ideation panel — every agent is named, never identified', () => {
	it( 'names an agent from the stored label rather than its ability id', () => {
		const { container } = renderPanel( {
			status: 'completed',
			summary: 'Found four.',
		} );

		// Scoped to the row: the name is deliberately in the follow-up dropdown too,
		// so an unscoped query matches twice.
		expect(
			container.querySelector(
				'.vip-workflows-ideation-panel__assistant-name'
			)
		).toHaveTextContent( 'Web Researcher' );
		expect( container.textContent ).not.toMatch(
			/vip-workflows\/web-researcher/
		);
	} );

	it( 'names an agent the abilities response no longer contains', () => {
		// The regression: this agent's plugin was deactivated after its run, so it
		// is in no abilities response. The stored entry still carries its label.
		const rendered = render(
			<AssistantPanel
				assistants={ {
					'workflow-discovery-foresight/foresight-research': {
						status: 'completed',
						label: 'Foresight News',
						summary: 'Found two events.',
					},
				} }
				researchAbilities={ [
					vipAbility( {
						id: OFF_ABILITY,
						label: 'Foresight News',
						icon: 'book-alt',
					} ),
				] }
				seedAnalysis={ null }
				mentorResult={ null }
				mentorSuggestions={ [] }
				mentorLoading={ false }
				onRunMentor={ () => {} }
				onRunQuery={ () => {} }
				autoRefresh={ false }
				onToggleAutoRefresh={ () => {} }
				queryLog={ [] }
				runningQuery={ null }
			/>
		);

		const { container } = rendered;

		expect(
			container.querySelector(
				'.vip-workflows-ideation-panel__assistant-name'
			)
		).toHaveTextContent( 'Foresight News' );
		expect(
			screen.queryByText(
				'workflow-discovery-foresight/foresight-research'
			)
		).not.toBeInTheDocument();
	} );

	it( 'names the Seed Analyst from the payload, with no hardcoded special case', () => {
		// The panel used to seed its own map with `'Seed Analyst'`. The label now
		// arrives from the server like every other agent's, so a panel given no
		// abilities at all still names it.
		render(
			<AssistantPanel
				assistants={ {
					[ SEED_ANALYST_ID ]: {
						status: 'completed',
						label: 'Seed Analyst',
						summary: 'Extracted 4 topics.',
					},
				} }
				researchAbilities={ [] }
				seedAnalysis={ null }
				mentorResult={ null }
				mentorSuggestions={ [] }
				mentorLoading={ false }
				onRunMentor={ () => {} }
				onRunQuery={ () => {} }
				autoRefresh={ false }
				onToggleAutoRefresh={ () => {} }
				queryLog={ [] }
				runningQuery={ null }
			/>
		);

		expect( screen.getByText( 'Seed Analyst' ) ).toBeInTheDocument();
	} );

	it( 'names the agent in a completed query-thread entry', () => {
		renderPanel(
			{ status: 'completed', summary: 'Found four.' },
			{
				queryLog: [
					{
						id: 'q1',
						query: 'boundary review',
						assistant: ABILITY,
						status: 'completed',
						card_count: 2,
					},
				],
			}
		);

		const thread = screen.getByText( 'boundary review' ).closest( 'div' );

		expect(
			within( thread ).getByText( /Web Researcher/ )
		).toBeInTheDocument();
	} );

	it( 'names the agent in a running query-thread entry', () => {
		renderPanel(
			{ status: 'completed', summary: 'Found four.' },
			{
				runningQuery: {
					query: 'tribal sovereignty',
					assistant: ABILITY,
				},
			}
		);

		const thread = screen
			.getByText( 'tribal sovereignty' )
			.closest( 'div' );

		expect(
			within( thread ).getByText( /Web Researcher/ )
		).toBeInTheDocument();
	} );

	it( 'offers human names in the follow-up dropdown, not ability ids', () => {
		const { container } = renderPanel( {
			status: 'completed',
			summary: 'Found four.',
		} );

		const option = container.querySelector(
			`option[value="${ ABILITY }"]`
		);

		expect( option ).toBeInTheDocument();
		expect( option.textContent ).toBe( 'Web Researcher' );
	} );

	it( 'renders no raw ability id anywhere in the panel', () => {
		const { container } = renderPanel(
			{ status: 'completed', summary: 'Found four.' },
			{
				queryLog: [
					{
						id: 'q1',
						query: 'boundary review',
						assistant: ABILITY,
						status: 'completed',
						card_count: 2,
					},
				],
			}
		);

		expect( container.textContent ).not.toMatch( /vip-workflows\// );
	} );
} );

describe( 'ideation panel — an agent an administrator turned off', () => {
	/**
	 * Render the panel with a live and a turned-off agent side by side.
	 *
	 * @param {Object} offData    Result payload stored for the turned-off agent.
	 * @param {Object} extraProps Additional panel props to merge in.
	 * @return {Object} Render result.
	 */
	function renderWithTurnedOff( offData, extraProps = {} ) {
		return render(
			<AssistantPanel
				assistants={ {
					[ ABILITY ]: {
						label: 'Web Researcher',
						status: 'completed',
						summary: 'Found four.',
					},
					[ OFF_ABILITY ]: {
						label: 'Foresight News',
						...offData,
					},
				} }
				researchAbilities={ [
					...RESEARCH_ABILITIES,
					TURNED_OFF_ABILITY,
				] }
				seedAnalysis={ null }
				mentorResult={ null }
				mentorSuggestions={ [] }
				mentorLoading={ false }
				onRunMentor={ () => {} }
				onRunQuery={ () => {} }
				autoRefresh={ false }
				onToggleAutoRefresh={ () => {} }
				queryLog={ [] }
				runningQuery={ null }
				{ ...extraProps }
			/>
		);
	}

	it( 'is not offered in the follow-up dropdown', () => {
		const { container } = renderWithTurnedOff( {
			status: 'completed',
			summary: 'Found two events.',
		} );

		expect(
			container.querySelector( `option[value="${ OFF_ABILITY }"]` )
		).toBeNull();
	} );

	it( 'leaves a live agent in the follow-up dropdown', () => {
		const { container } = renderWithTurnedOff( {
			status: 'completed',
			summary: 'Found two events.',
		} );

		expect(
			container.querySelector( `option[value="${ ABILITY }"]` )
		).toBeInTheDocument();
	} );

	it( 'is still named in its row, from the stored label', () => {
		// The name map must stay complete even though the dropdown does not: this
		// agent found what is on the board, and a row that cannot name it is the
		// same class of bug as a section that cannot.
		const { container } = renderWithTurnedOff( {
			status: 'completed',
			summary: 'Found two events.',
		} );

		const names = Array.from(
			container.querySelectorAll(
				'.vip-workflows-ideation-panel__assistant-name'
			)
		).map( ( node ) => node.textContent );

		expect( names ).toContain( 'Foresight News' );
		expect( container.textContent ).not.toMatch(
			/workflow-discovery-foresight\//
		);
	} );

	it( 'is offered no retry, even with live availability', () => {
		// Availability is what normally earns the control. Running the agent is
		// exactly what an administrator has said no to, so it is withheld anyway.
		renderWithTurnedOff(
			unavailable( [ group( 'all', [ adminRequirement() ] ) ] ),
			{
				onRetryAssistant: () => Promise.resolve(),
			}
		);

		expect(
			screen.queryByRole( 'button', { name: 'Retry' } )
		).not.toBeInTheDocument();
	} );

	it( 'still says why it could not run', () => {
		renderWithTurnedOff(
			unavailable( [ group( 'all', [ adminRequirement() ] ) ] ),
			{
				onRetryAssistant: () => Promise.resolve(),
			}
		);

		expect(
			screen.getByText( 'Tavily is not connected.' )
		).toBeInTheDocument();
	} );

	it( 'still offers a live agent its retry', () => {
		render(
			<AssistantPanel
				assistants={ {
					[ ABILITY ]: {
						label: 'Web Researcher',
						...unavailable( [
							group( 'all', [ adminRequirement() ] ),
						] ),
					},
					[ OFF_ABILITY ]: {
						label: 'Foresight News',
						status: 'completed',
						summary: 'Found two events.',
					},
				} }
				researchAbilities={ [
					...RESEARCH_ABILITIES,
					TURNED_OFF_ABILITY,
				] }
				seedAnalysis={ null }
				mentorResult={ null }
				mentorSuggestions={ [] }
				mentorLoading={ false }
				onRunMentor={ () => {} }
				onRunQuery={ () => {} }
				autoRefresh={ false }
				onToggleAutoRefresh={ () => {} }
				queryLog={ [] }
				runningQuery={ null }
				onRetryAssistant={ () => Promise.resolve() }
			/>
		);

		expect(
			screen.getByRole( 'button', { name: 'Retry' } )
		).toBeInTheDocument();
	} );
} );
