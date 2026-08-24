/**
 * Unit tests for the agent card: its shape per docs/guides/settings-standard.md,
 * and the availability requirements it renders.
 *
 * The card used to carry its own Save, its own dirty hint, its own "Saved!"
 * label, a row of capability badges and a "Setup needed" badge above the notice
 * that said the same thing. It is now a list item: it reports dirtiness and a
 * save callback upward, and the screen owns the one Save and the one error
 * channel.
 *
 * The availability tests walk the five-row state matrix the card commits to
 * (available / fully unavailable and enabled / partially unavailable /
 * unavailable and switched off / unavailable with no requirements), plus the
 * per-destination-kind rendering rules. The rule the destination tests protect:
 * a destination the user cannot act on must never render as a link.
 *
 * @package
 */

import {
	render,
	screen,
	fireEvent,
	waitFor,
	act,
} from './helpers/render-wp-component';
import { addFilter, removeFilter } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';

import { AssistantCard } from '../../src/admin/components/AssistantCard';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

const baseAssistant = {
	slug: 'workflow-agent-fact-check',
	label: 'Fact Check',
	description: 'Flags unsupported factual claims.',
	origin: 'plugin',
	enabled: true,
	available: true,
	ability_ids: [ 'workflow-agent-fact-check/fact-check' ],
	provider_slugs: [],
	options: {},
	settings_schema: {},
};

const CONNECTORS_URL = 'https://example.com/wp-admin/options-connectors.php';

const tavilyRequirement = {
	id: 'credential:tavily',
	kind: 'missing_credential',
	sources: [ 'Web Search (Tavily)' ],
	reason: 'Tavily is not connected. Add its API key in Settings → Connectors.',
	destination: {
		kind: 'admin_url',
		url: CONNECTORS_URL,
		label: 'Settings → Connectors',
		hint: '',
	},
};

const youtubeRequirement = {
	id: 'credential:youtube',
	kind: 'missing_credential',
	sources: [ 'Web Videos (YouTube)' ],
	reason: 'YouTube is not connected. Add its API key in Settings → Connectors.',
	destination: {
		kind: 'admin_url',
		url: CONNECTORS_URL,
		label: 'Settings → Connectors',
		hint: '',
	},
};

/**
 * Render a card with the four callbacks the screen supplies.
 *
 * The card is a list item now: it reports dirtiness, hands back a save
 * callback, and routes its own action failures to the screen's one error
 * Notice — so a test that renders it in isolation still has to stand in for
 * the screen.
 *
 * @param {Object} assistant Assistant entry.
 * @param {Object} props     Callback overrides.
 * @return {Object} Render result, the callbacks, and a prop-preserving rerender.
 */
function renderCard( assistant, props = {} ) {
	const handlers = {
		onUpdate: jest.fn(),
		onDirtyChange: jest.fn(),
		registerSave: jest.fn(),
		onError: jest.fn(),
		...props,
	};

	const result = render(
		<AssistantCard assistant={ assistant } { ...handlers } />
	);

	return {
		...result,
		...handlers,
		rerenderWith: ( next ) =>
			result.rerender(
				<AssistantCard assistant={ next } { ...handlers } />
			),
	};
}

/**
 * Build an unavailable entry with the structured availability payload.
 *
 * @param {Array}  groups    Requirement groups.
 * @param {Object} overrides Additional entry overrides.
 * @return {Object} Assistant entry.
 */
function unavailableAssistant( groups = [], overrides = {} ) {
	return {
		...baseAssistant,
		available: false,
		availability_state: 'unavailable',
		availability: { available: false, groups },
		availability_sources: [
			{
				type: 'ability',
				id: 'workflow-agent-fact-check/fact-check',
				label: 'Web Search (Tavily)',
				available: false,
			},
		],
		...overrides,
	};
}

describe( 'AssistantCard shape', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'names the agent in one h2 card title', () => {
		renderCard( baseAssistant );

		expect(
			screen.getByRole( 'heading', { level: 2, name: 'Fact Check' } )
		).toBeInTheDocument();
	} );

	it( 'gives the enable toggle a visible label', () => {
		// An unlabeled ToggleControl has no accessible name at all.
		renderCard( baseAssistant );

		expect(
			screen.getByRole( 'checkbox', { name: 'Enabled' } )
		).toBeChecked();
	} );

	it( 'carries no Save of its own', () => {
		// One Save per screen: twelve agents used to mean twelve Saves, twelve
		// dirty hints and twelve "Saved!" labels.
		renderCard( baseAssistant );

		expect(
			screen.queryByRole( 'button', { name: 'Save' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'Unsaved changes' )
		).not.toBeInTheDocument();
	} );

	it( 'states capabilities as prose rather than a row of badges', () => {
		// `Available in AI stage` was a whole sentence in a pill, and a capability
		// is a fact about the agent, not runtime state anyone can act on.
		renderCard( {
			...baseAssistant,
			capabilities: [ 'research', 'stage' ],
		} );

		expect(
			screen.getByText( 'Provides: research, AI stage automation' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Research' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'Available in AI stage' )
		).not.toBeInTheDocument();
	} );

	it( 'says nothing about capabilities when the agent declares none', () => {
		renderCard( baseAssistant );

		expect( screen.queryByText( /^Provides:/ ) ).not.toBeInTheDocument();
	} );

	it( 'reports dirtiness upward instead of holding it', () => {
		const { onDirtyChange } = renderCard( baseAssistant );

		expect( onDirtyChange ).toHaveBeenLastCalledWith(
			baseAssistant.slug,
			false
		);

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );

		expect( onDirtyChange ).toHaveBeenLastCalledWith(
			baseAssistant.slug,
			true
		);
	} );

	it( 'hands the screen a save callback that writes through its own route', async () => {
		let saveFn;
		apiFetch.mockResolvedValue( { ...baseAssistant, enabled: false } );

		renderCard( baseAssistant, {
			registerSave: ( slug, fn ) => {
				saveFn = fn;
			},
		} );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );

		await act( async () => {
			await saveFn();
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/vip-workflow/v1/assistants/workflow-agent-fact-check/settings',
			method: 'POST',
			data: { enabled: false, options: {} },
		} );
	} );

	it( 'lets a failed save reach the screen instead of swallowing it', async () => {
		// The old per-card handler reported failure to `console.error` alone, so
		// the reader watched a button stop spinning and change nothing. The save
		// callback now rejects and the screen names the agent in its one Notice.
		let saveFn;
		apiFetch.mockRejectedValue( new Error( 'Network down' ) );

		renderCard( baseAssistant, {
			registerSave: ( slug, fn ) => {
				saveFn = fn;
			},
		} );

		await act( async () => {
			await expect( saveFn() ).rejects.toThrow( 'Network down' );
		} );
	} );
} );

describe( 'AssistantCard availability requirements', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	// Matrix row 1: available.
	it( 'renders no notice or re-check control when available', () => {
		const { container } = renderCard( {
			...baseAssistant,
			availability: { available: true, groups: [] },
			availability_state: 'available',
			availability_sources: [],
		} );

		expect(
			container.querySelector( '.components-notice' )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Retry' } )
		).not.toBeInTheDocument();
	} );

	it( 'names the missing credential and links to its destination', () => {
		renderCard(
			unavailableAssistant( [
				{ satisfy: 'all', requirements: [ tavilyRequirement ] },
			] )
		);

		expect(
			screen.getByText( tavilyRequirement.reason )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Needed by: Web Search (Tavily)' )
		).toBeInTheDocument();

		const link = screen.getByRole( 'link', {
			name: /Settings → Connectors/,
		} );
		expect( link ).toHaveAttribute( 'href', CONNECTORS_URL );
		expect( link ).toHaveAttribute( 'target', '_blank' );

		// The generic dead-end copy this feature replaces must be gone.
		expect(
			screen.queryByText(
				'This agent has required settings that are not yet configured.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'renders an any group as one "at least one of" block, not one per member', () => {
		renderCard(
			unavailableAssistant( [
				{
					satisfy: 'any',
					requirements: [ tavilyRequirement, youtubeRequirement ],
				},
			] )
		);

		expect(
			screen.getAllByText( 'Configure at least one of:' )
		).toHaveLength( 1 );
		expect(
			screen.getByText( tavilyRequirement.reason )
		).toBeInTheDocument();
		expect(
			screen.getByText( youtubeRequirement.reason )
		).toBeInTheDocument();
	} );

	it( 'renders a destination of kind none as text with no anchor', () => {
		renderCard(
			unavailableAssistant( [
				{
					satisfy: 'all',
					requirements: [
						{
							...tavilyRequirement,
							destination: {
								kind: 'none',
								url: '',
								label: '',
								hint: 'Define VIP_WORKFLOW_TAVILY_API_KEY in wp-config.php.',
							},
						},
					],
				},
			] )
		);

		expect(
			screen.getByText(
				'Define VIP_WORKFLOW_TAVILY_API_KEY in wp-config.php.'
			)
		).toBeInTheDocument();
		expect( screen.queryByRole( 'link' ) ).not.toBeInTheDocument();
	} );

	it( 'renders a destination of kind in_card as a hint with no link', () => {
		renderCard(
			unavailableAssistant( [
				{
					satisfy: 'all',
					requirements: [
						{
							...tavilyRequirement,
							id: 'settings:foresight-news',
							destination: {
								kind: 'in_card',
								url: '',
								label: '',
								hint: 'Complete the fields below on this card.',
							},
						},
					],
				},
			] )
		);

		expect(
			screen.getByText( 'Complete the fields below on this card.' )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'link' ) ).not.toBeInTheDocument();
	} );

	it( 'lists both capabilities on a requirement two sources share', () => {
		renderCard(
			unavailableAssistant( [
				{
					satisfy: 'all',
					requirements: [
						{
							...tavilyRequirement,
							sources: [
								'Web Images (Tavily)',
								'Web Videos (Tavily)',
							],
						},
					],
				},
			] )
		);

		expect( screen.getAllByText( tavilyRequirement.reason ) ).toHaveLength(
			1
		);
		expect(
			screen.getByText(
				'Needed by: Web Images (Tavily), Web Videos (Tavily)'
			)
		).toBeInTheDocument();
	} );

	// Matrix row 5: unavailable with no requirements (bare-bool source).
	it( 'keeps a generic line when available is false with no requirements', () => {
		const { container } = renderCard( unavailableAssistant( [] ) );

		expect(
			screen.getByText(
				'This agent has required settings that are not yet configured.'
			)
		).toBeInTheDocument();
		expect(
			container.querySelector( '.components-notice.is-warning' )
		).toBeInTheDocument();
	} );

	// Matrix row 2: fully unavailable, enabled — the fresh-install state.
	it( 'says it once — the requirements carry the state, with no badge repeating it', () => {
		// The header badge and this notice were two renderings of one fact, the
		// badge saying less. The notice names which requirement is unmet, so it is
		// the one that stayed — the same call the Tools screen made.
		const { container } = renderCard(
			unavailableAssistant( [
				{ satisfy: 'all', requirements: [ tavilyRequirement ] },
			] )
		);

		expect( screen.queryByText( /Setup needed/ ) ).not.toBeInTheDocument();
		expect(
			container.querySelector( '.components-notice.is-warning' )
		).toBeInTheDocument();
		expect(
			container.querySelector( '.vip-workflow-assistant-card__hint' )
		).not.toBeInTheDocument();

		// The toggle is a preference, never a readiness signal: it stays usable.
		const toggle = screen.getByRole( 'checkbox', { name: 'Enabled' } );
		expect( toggle ).toBeChecked();
		expect( toggle ).toBeEnabled();
		// The header carries no explanatory help text: the requirements below
		// already say what is needed, and two lines of prose beside the toggle
		// dominated the header.
		expect(
			container.querySelector( '.components-base-control__help' )
		).not.toBeInTheDocument();
	} );

	// Matrix row 4: unavailable, toggled off.
	it( 'demotes the notice to a low-emphasis hint when switched off', () => {
		const { container } = renderCard(
			unavailableAssistant(
				[ { satisfy: 'all', requirements: [ tavilyRequirement ] } ],
				{ enabled: false }
			)
		);

		expect(
			container.querySelector( '.components-notice' )
		).not.toBeInTheDocument();
		expect(
			container.querySelector( '.vip-workflow-assistant-card__hint' )
		).toBeInTheDocument();
		expect(
			screen.getByText( tavilyRequirement.reason )
		).toBeInTheDocument();

		const toggle = screen.getByRole( 'checkbox', { name: 'Enabled' } );
		expect( toggle ).not.toBeChecked();
		expect( toggle ).toBeEnabled();
		expect(
			container.querySelector( '.components-base-control__help' )
		).not.toBeInTheDocument();
	} );

	it( 'renders one shared destination link for an any-group, not one per member', () => {
		// Tavily and YouTube both resolve to Settings → Connectors, so a link per
		// row put the same link on screen twice under one "at least one of".
		const { container } = renderCard(
			unavailableAssistant( [
				{
					satisfy: 'any',
					requirements: [ tavilyRequirement, youtubeRequirement ],
				},
			] )
		);

		expect(
			screen.getByText( 'Configure at least one of:' )
		).toBeInTheDocument();
		expect(
			container.querySelectorAll( `a[href="${ CONNECTORS_URL }"]` )
		).toHaveLength( 1 );
	} );

	it( 'keeps a link per member when the destinations differ', () => {
		const elsewhere = {
			...youtubeRequirement,
			destination: {
				...youtubeRequirement.destination,
				url: 'https://example.com/wp-admin/options-general.php',
			},
		};

		const { container } = renderCard(
			unavailableAssistant( [
				{
					satisfy: 'any',
					requirements: [ tavilyRequirement, elsewhere ],
				},
			] )
		);

		expect( container.querySelectorAll( 'a[href]' ) ).toHaveLength( 2 );
	} );

	it( 'omits attribution when the only source is the card itself', () => {
		// "Needed by: Fact Check" under the Fact Check heading says nothing.
		renderCard(
			unavailableAssistant( [
				{
					satisfy: 'all',
					requirements: [
						{ ...tavilyRequirement, sources: [ 'Fact Check' ] },
					],
				},
			] )
		);

		expect( screen.queryByText( /Needed by:/ ) ).not.toBeInTheDocument();
	} );

	it( 'keeps attribution when the source differs from the card', () => {
		renderCard(
			unavailableAssistant( [
				{ satisfy: 'all', requirements: [ tavilyRequirement ] },
			] )
		);

		expect(
			screen.getByText( 'Needed by: Web Search (Tavily)' )
		).toBeInTheDocument();
	} );

	// Matrix row 3: partially unavailable.
	it( 'names what still works when only one capability is unconfigured', () => {
		// This was `Setup needed — Story Discovery works` in a pill. The pill is
		// gone; the prose it carried belongs in the body either way.
		const { container } = renderCard(
			unavailableAssistant(
				[ { satisfy: 'all', requirements: [ tavilyRequirement ] } ],
				{
					availability_state: 'partial',
					availability_sources: [
						{
							type: 'ability',
							id: 'workflow-agent/research',
							label: 'Web Search (Tavily)',
							available: false,
						},
						{
							type: 'provider',
							id: 'my-source',
							label: 'Story Discovery',
							available: true,
						},
					],
				}
			)
		);

		expect(
			screen.getByText( 'Still working: Story Discovery.' )
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'Setup needed — Story Discovery works' )
		).not.toBeInTheDocument();
		// The notice is scoped to the capability that is actually broken.
		expect(
			screen.getByText( 'Needed by: Web Search (Tavily)' )
		).toBeInTheDocument();
		expect(
			container.querySelector( '.components-notice.is-warning' )
		).toBeInTheDocument();
	} );
} );

describe( 'AssistantCard re-check control', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'refetches the single agent and clears the notice once satisfied', async () => {
		const satisfied = {
			...baseAssistant,
			available: true,
			availability_state: 'available',
			availability: { available: true, groups: [] },
			availability_sources: [
				{
					type: 'ability',
					id: 'workflow-agent-fact-check/fact-check',
					label: 'Web Search (Tavily)',
					available: true,
				},
			],
		};
		apiFetch.mockResolvedValue( satisfied );

		const { container, onUpdate } = renderCard(
			unavailableAssistant( [
				{ satisfy: 'all', requirements: [ tavilyRequirement ] },
			] )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );

		await waitFor( () =>
			expect(
				container.querySelector( '.components-notice' )
			).not.toBeInTheDocument()
		);

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/vip-workflow/v1/assistants/workflow-agent-fact-check',
		} );
		// List state stays the single source of truth.
		expect( onUpdate ).toHaveBeenCalledWith( satisfied );
		expect(
			screen.queryByText( tavilyRequirement.reason )
		).not.toBeInTheDocument();
	} );

	it( 'leaves the card clean after a successful re-check', async () => {
		const assistant = unavailableAssistant( [
			{ satisfy: 'all', requirements: [ tavilyRequirement ] },
		] );
		// The re-check returns the same entry: nothing was configured yet, so the
		// card must not report itself dirty afterwards.
		apiFetch.mockResolvedValue( { ...assistant } );

		const { onDirtyChange } = renderCard( assistant );

		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Retry' } )
			).toBeEnabled()
		);

		expect( onDirtyChange ).not.toHaveBeenCalledWith(
			assistant.slug,
			true
		);
	} );

	it( 'keeps a static label while busy and rejects a second click', async () => {
		// `Retry` → `Retrying…` was a label swap beside `isBusy`, which is the
		// same defect as spinner-as-label.
		let resolveFetch;
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveFetch = resolve;
				} )
		);
		const assistant = unavailableAssistant( [
			{ satisfy: 'all', requirements: [ tavilyRequirement ] },
		] );

		renderCard( assistant );

		const button = screen.getByRole( 'button', { name: 'Retry' } );
		fireEvent.click( button );

		expect( screen.queryByText( 'Retrying…' ) ).not.toBeInTheDocument();
		const busy = screen.getByRole( 'button', { name: 'Retry' } );
		expect( busy ).toHaveClass( 'is-busy' );
		expect( busy ).toBeDisabled();

		fireEvent.click( busy );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );

		await act( async () => {
			resolveFetch( { ...assistant } );
		} );
	} );

	it( 'routes a failed re-check to the screen and preserves the prior requirements', async () => {
		// The failure used to go to `console.error` plus an inline status span.
		// The screen owns the one error channel now.
		apiFetch.mockRejectedValue( new Error( 'Network down' ) );

		const { onUpdate, onError } = renderCard(
			unavailableAssistant( [
				{ satisfy: 'all', requirements: [ tavilyRequirement ] },
			] )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );

		await waitFor( () =>
			expect( onError ).toHaveBeenCalledWith(
				'Could not re-check Fact Check: Network down'
			)
		);

		expect( onUpdate ).not.toHaveBeenCalled();
		expect(
			screen.getByText( tavilyRequirement.reason )
		).toBeInTheDocument();
	} );
} );

/*
 * The card seeds `local` from the `assistant` prop once. The Agents screen
 * refetches the list whenever it regains the foreground, so without a sync the
 * card keeps rendering the requirements that the refetch exists to clear — the
 * refetch is inert. The sync must be narrow: only the server-owned availability
 * fields, so an in-progress edit is never discarded and a server-driven refresh
 * never reports the card dirty.
 */
describe( 'AssistantCard availability sync from the assistant prop', () => {
	const satisfiedAssistant = {
		...baseAssistant,
		available: true,
		availability_state: 'available',
		availability: { available: true, groups: [] },
		availability_sources: [
			{
				type: 'ability',
				id: 'workflow-agent-fact-check/fact-check',
				label: 'Web Search (Tavily)',
				available: true,
			},
		],
	};

	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'clears the notice when the prop reports the agent as available', () => {
		const unavailable = unavailableAssistant( [
			{ satisfy: 'all', requirements: [ tavilyRequirement ] },
		] );

		const { container, rerenderWith } = renderCard( unavailable );

		expect(
			container.querySelector( '.components-notice' )
		).toBeInTheDocument();

		rerenderWith( satisfiedAssistant );

		expect(
			container.querySelector( '.components-notice' )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( tavilyRequirement.reason )
		).not.toBeInTheDocument();
	} );

	it( 'keeps an in-progress edit when availability arrives from the server', () => {
		const unavailable = unavailableAssistant(
			[ { satisfy: 'all', requirements: [ tavilyRequirement ] } ],
			{
				settings_schema: {
					region: { type: 'string', label: 'Region' },
				},
				options: { region: '' },
			}
		);

		const { rerenderWith } = renderCard( unavailable );

		// The user types, and toggles the agent off, while the tab is in the
		// background and the list is refetching.
		fireEvent.change( screen.getByLabelText( 'Region' ), {
			target: { value: 'us-east' },
		} );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );

		// The same entry, now reported as configured by the server.
		rerenderWith( {
			...unavailable,
			available: true,
			availability_state: 'available',
			availability: { available: true, groups: [] },
			availability_sources: satisfiedAssistant.availability_sources,
		} );

		// The refresh landed…
		expect(
			screen.queryByText( tavilyRequirement.reason )
		).not.toBeInTheDocument();
		// …and the edits it did not ask about survived it.
		expect( screen.getByLabelText( 'Region' ) ).toHaveValue( 'us-east' );
		expect(
			screen.getByRole( 'checkbox', { name: 'Enabled' } )
		).not.toBeChecked();
	} );

	it( 'reports no dirtiness when only availability changed', () => {
		const unavailable = unavailableAssistant( [
			{ satisfy: 'all', requirements: [ tavilyRequirement ] },
		] );

		const { onDirtyChange, rerenderWith } = renderCard( unavailable );

		rerenderWith( satisfiedAssistant );

		expect( onDirtyChange ).not.toHaveBeenCalledWith(
			baseAssistant.slug,
			true
		);
	} );
} );

/*
 * The subtitle names the plugin an agent came from. The entry slug is an
 * addressing key that carries the whole ability id, so rendering it verbatim
 * reads as "workflow-assistant-wikipedia-wikipedia".
 */
describe( 'AssistantCard origin label', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	const originText = ( container ) =>
		container.querySelector( '.vip-workflow-assistant-card__origin' )
			?.textContent;

	it( 'uses the ability vendor prefix, not the doubled entry slug', () => {
		const { container } = renderCard( {
			...baseAssistant,
			slug: 'workflow-assistant-wikipedia-wikipedia',
			ability_ids: [ 'workflow-assistant-wikipedia/wikipedia' ],
		} );

		expect( originText( container ) ).toBe(
			'workflow-assistant-wikipedia'
		);
		expect(
			screen.queryByText( 'workflow-assistant-wikipedia-wikipedia' )
		).not.toBeInTheDocument();
	} );

	it( 'falls back to the provider slug when there are no ability ids', () => {
		const { container } = renderCard( {
			...baseAssistant,
			slug: 'workflow-discovery-foresight',
			ability_ids: [],
			provider_slugs: [ 'foresight-news' ],
		} );

		expect( originText( container ) ).toBe( 'foresight-news' );
	} );

	it( 'falls back to the entry slug when neither is present', () => {
		const { container } = renderCard( {
			...baseAssistant,
			slug: 'workflow-agent-orphan',
			ability_ids: [],
			provider_slugs: [],
		} );

		expect( originText( container ) ).toBe( 'workflow-agent-orphan' );
	} );

	it( 'reads "Built-in" for a first-party agent regardless of its ids', () => {
		const { container } = renderCard( {
			...baseAssistant,
			origin: 'built-in',
			slug: 'vip-workflow-web-researcher',
			ability_ids: [ 'vip-workflow/web-researcher' ],
		} );

		expect( originText( container ) ).toBe( 'Built-in' );
		expect( screen.queryByText( 'vip-workflow' ) ).not.toBeInTheDocument();
	} );
} );

/*
 * Re-check and Save both write the entry, so they must not overlap: a Re-check
 * GET issued before a Save completes can land afterwards and overwrite what was
 * just saved. Save is the screen's now, so the card guards the half it still
 * owns and the generation counter covers the rest.
 */
describe( 'AssistantCard re-check and save interlock', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	const editableAssistant = () =>
		unavailableAssistant(
			[ { satisfy: 'all', requirements: [ tavilyRequirement ] } ],
			{
				settings_schema: {
					region: { type: 'string', label: 'Region' },
				},
				options: { region: '' },
			}
		);

	it( 'disables Retry while its own save is in flight', async () => {
		let resolveSave;
		let saveFn;
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveSave = resolve;
				} )
		);
		const assistant = editableAssistant();

		renderCard( assistant, {
			registerSave: ( slug, fn ) => {
				saveFn = fn;
			},
		} );

		fireEvent.change( screen.getByLabelText( 'Region' ), {
			target: { value: 'us-east' },
		} );

		let pending;
		act( () => {
			pending = saveFn();
		} );

		expect(
			screen.getByRole( 'button', { name: 'Retry' } )
		).toBeDisabled();

		await act( async () => {
			resolveSave( { ...assistant, options: { region: 'us-east' } } );
			await pending;
		} );

		expect( screen.getByRole( 'button', { name: 'Retry' } ) ).toBeEnabled();
	} );

	it( 'drops a response that lands after a newer request', async () => {
		const resolvers = [];
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolvers.push( resolve );
				} )
		);
		const assistant = unavailableAssistant( [
			{ satisfy: 'all', requirements: [ tavilyRequirement ] },
		] );

		const { onUpdate } = renderCard( assistant );

		/*
		 * Both clicks are dispatched inside one React batch, so the second
		 * handler still reads the pre-click `rechecking` value and two requests
		 * go out. That is the shape the guard exists for: whichever response
		 * arrives last, only the newest request may write.
		 */
		const button = screen.getByRole( 'button', { name: 'Retry' } );
		act( () => {
			button.dispatchEvent(
				new MouseEvent( 'click', { bubbles: true } )
			);
			button.dispatchEvent(
				new MouseEvent( 'click', { bubbles: true } )
			);
		} );

		expect( resolvers ).toHaveLength( 2 );

		const newest = {
			...assistant,
			available: true,
			availability_state: 'available',
			availability: { available: true, groups: [] },
		};
		const stale = {
			...assistant,
			label: 'Stale Label',
		};

		// Newest first, then the superseded one.
		await act( async () => {
			resolvers[ 1 ]( newest );
		} );
		await act( async () => {
			resolvers[ 0 ]( stale );
		} );

		expect( onUpdate ).toHaveBeenCalledTimes( 1 );
		expect( onUpdate ).toHaveBeenCalledWith( newest );
		expect( screen.queryByText( 'Stale Label' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( tavilyRequirement.reason )
		).not.toBeInTheDocument();
	} );
} );

/*
 * The schema settings describe how the agent behaves when it runs, so a
 * switched-off agent offers none of them. Nothing but the toggle used to read
 * `enabled`, so a reader could configure an agent that was off — and mark the
 * screen dirty doing it.
 */
describe( 'AssistantCard settings on a switched-off agent', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	const configurable = ( enabled ) => ( {
		...baseAssistant,
		enabled,
		settings_schema: {
			region: { type: 'string', label: 'Region' },
			depth: { type: 'integer', default: 3, label: 'Depth' },
			verbose: { type: 'boolean', default: false, label: 'Verbose' },
		},
		options: { region: 'us-east' },
	} );

	const settingsControls = () => [
		screen.getByRole( 'textbox', { name: 'Region' } ),
		screen.getByRole( 'spinbutton', { name: 'Depth' } ),
		screen.getByRole( 'checkbox', { name: 'Verbose' } ),
	];

	it( 'keeps the settings live while the agent is on', () => {
		renderCard( configurable( true ) );

		for ( const control of settingsControls() ) {
			expect( control ).toBeEnabled();
		}
	} );

	it( 'switches the settings off with the agent', () => {
		renderCard( configurable( false ) );

		for ( const control of settingsControls() ) {
			expect( control ).toBeDisabled();
		}
	} );

	it( 'leaves the Enabled toggle live, since it is the way back', () => {
		renderCard( configurable( false ) );

		expect(
			screen.getByRole( 'checkbox', { name: 'Enabled' } )
		).toBeEnabled();
	} );

	it( 'hands the settings back the moment the agent is switched on', () => {
		renderCard( configurable( false ) );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );

		for ( const control of settingsControls() ) {
			expect( control ).toBeEnabled();
		}
	} );

	it( 'says why the settings are grey', () => {
		// On a fresh install every agent is off, so without this the screen's
		// default state is a slab of grey with no explanation. The standard puts
		// the reason in visible text, not a `title` tooltip; the schema fields
		// have no one control to hang `help` off, so it is one line for the
		// block.
		renderCard( configurable( false ) );

		expect(
			screen.getByText( 'Enable the agent to change these settings.' )
		).toBeInTheDocument();
	} );

	it( 'does not say it while the agent is on', () => {
		renderCard( configurable( true ) );

		expect(
			screen.queryByText( 'Enable the agent to change these settings.' )
		).not.toBeInTheDocument();
	} );
} );

describe( 'AssistantCard settings filter contract', () => {
	const seen = [];

	beforeEach( () => {
		apiFetch.mockReset();
		seen.length = 0;
		addFilter(
			'vipWorkflow.assistantSettings',
			'vip-workflow-test/assistant-disabled',
			( content, entry, callbacks ) => {
				seen.push( callbacks.disabled );
				return content;
			}
		);
	} );

	afterEach( () => {
		removeFilter(
			'vipWorkflow.assistantSettings',
			'vip-workflow-test/assistant-disabled'
		);
	} );

	// The card can only switch off the controls it renders itself, and a plugin
	// component replaces those outright. So the contract has to hand the plugin
	// `disabled` — without it the same bug just moves out one layer, into the
	// filter.
	it( 'tells a plugin-supplied component the agent is off', () => {
		renderCard( { ...baseAssistant, enabled: false } );

		expect( seen.length ).toBeGreaterThan( 0 );
		expect( seen.every( ( flag ) => flag === true ) ).toBe( true );
	} );

	it( 'tells it when the agent is on', () => {
		renderCard( { ...baseAssistant, enabled: true } );

		expect( seen.length ).toBeGreaterThan( 0 );
		expect( seen.every( ( flag ) => flag === false ) ).toBe( true );
	} );
} );

describe( 'AssistantCard legacy assistants filter contract', () => {
	const seen = [];

	beforeEach( () => {
		apiFetch.mockReset();
		seen.length = 0;
		addFilter(
			'vipWorkflow.assistantSettingsComponent',
			'vip-workflow-test/legacy-assistant-disabled',
			( content, entry, callbacks ) => {
				seen.push( callbacks.disabled );
				return content;
			}
		);
	} );

	afterEach( () => {
		removeFilter(
			'vipWorkflow.assistantSettingsComponent',
			'vip-workflow-test/legacy-assistant-disabled'
		);
	} );

	// The legacy hook is still honoured, so it is still a way for a plugin to
	// replace the card's own controls — and a contract that told it nothing
	// would leave every plugin still on the old hook shipping the bug.
	it( 'tells a component on the legacy hook the agent is off', () => {
		renderCard( { ...baseAssistant, enabled: false } );

		expect( seen.length ).toBeGreaterThan( 0 );
		expect( seen.every( ( flag ) => flag === true ) ).toBe( true );
	} );

	it( 'tells it when the agent is on', () => {
		renderCard( { ...baseAssistant, enabled: true } );

		expect( seen.length ).toBeGreaterThan( 0 );
		expect( seen.every( ( flag ) => flag === false ) ).toBe( true );
	} );
} );

describe( 'AssistantCard legacy discovery filter contract', () => {
	const seen = [];

	// The one entry that reaches the discovery branch: it must cover a provider
	// and no ability, or the legacy assistants hook above it answers first.
	const providerAssistant = ( enabled ) => ( {
		...baseAssistant,
		slug: 'workflow-discovery-test',
		label: 'Test Provider',
		enabled,
		ability_ids: [],
		provider_slugs: [ 'test-provider' ],
	} );

	beforeEach( () => {
		apiFetch.mockReset();
		seen.length = 0;
		addFilter(
			'vip_workflow_discovery_provider_settings',
			'vip-workflow-test/legacy-discovery-disabled',
			() =>
				function ProviderSettings( { disabled } ) {
					seen.push( disabled );
					return <p>Provider settings UI</p>;
				}
		);
	} );

	afterEach( () => {
		removeFilter(
			'vip_workflow_discovery_provider_settings',
			'vip-workflow-test/legacy-discovery-disabled'
		);
	} );

	// This path carries `disabled` differently from the other two: the filter
	// returns a component *type* and takes no callbacks object, so the card
	// passes the flag as a prop when it renders it. Pinning it here is the point
	// — a structurally different mechanism is the one most likely to be dropped.
	it( 'passes disabled as a prop when the agent is off', () => {
		renderCard( providerAssistant( false ) );

		expect(
			screen.getByText( 'Provider settings UI' )
		).toBeInTheDocument();
		expect( seen.length ).toBeGreaterThan( 0 );
		expect( seen.every( ( flag ) => flag === true ) ).toBe( true );
	} );

	it( 'passes it when the agent is on', () => {
		renderCard( providerAssistant( true ) );

		expect( seen.length ).toBeGreaterThan( 0 );
		expect( seen.every( ( flag ) => flag === false ) ).toBe( true );
	} );
} );

describe( 'AssistantCard with a plugin-supplied settings component', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		addFilter(
			'vipWorkflow.assistantSettings',
			'vip-workflow-test/assistant-settings',
			( content, entry ) =>
				entry.slug === baseAssistant.slug ? (
					<p>Plugin settings UI</p>
				) : (
					content
				)
		);
	} );

	afterEach( () => {
		removeFilter(
			'vipWorkflow.assistantSettings',
			'vip-workflow-test/assistant-settings'
		);
	} );

	it( 'still renders the requirement notice above the plugin UI', () => {
		renderCard(
			unavailableAssistant( [
				{ satisfy: 'all', requirements: [ tavilyRequirement ] },
			] )
		);

		expect( screen.getByText( 'Plugin settings UI' ) ).toBeInTheDocument();
		expect(
			screen.getByText( tavilyRequirement.reason )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: /Settings → Connectors/ } )
		).toBeInTheDocument();
	} );
} );
