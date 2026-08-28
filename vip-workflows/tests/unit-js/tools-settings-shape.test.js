/**
 * Unit tests for the Tools screen's shape, per docs/guides/settings-standard.md.
 *
 * The screen used to be three headed groups of cards, each card carrying its own
 * Save. It is now one tab per tool type and a single Save for the whole screen,
 * which changes three things a test can hold still: how many Saves exist, what
 * enables the one that does, and what happens to a reader when a save fails —
 * previously nothing, because the failure went to `console.error` alone.
 *
 * @package
 */

import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { createReduxStore, register } from '@wordpress/data';
import { addFilter, removeFilter } from '@wordpress/hooks';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

// eslint-disable-next-line import/first
import Tools from '../../src/admin/pages/Tools';

const successNotices = [];

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = [] ) => state,
		actions: {
			createSuccessNotice: ( content ) => {
				successNotices.push( content );
				return { type: 'CREATE_SUCCESS_NOTICE' };
			},
		},
	} )
);

/**
 * A tool payload as `GET /vip-workflows/v1/tools` returns it.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Tool entry.
 */
const tool = ( overrides = {} ) => ( {
	id: 'vip-workflows/readability',
	name: 'Readability',
	description: 'Analyzes reading level.',
	category: 'check',
	enabled: true,
	available: true,
	availability: { available: true, groups: [] },
	meta: { type: 'check' },
	settings_schema: {},
	...overrides,
} );

/**
 * A tool with one of every configurable control the card can render: the two
 * secondary toggles, and a schema covering the number/enum/string/boolean
 * branches plus the enforceable one that adds a check-mode pill.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Tool entry.
 */
const configurableTool = ( overrides = {} ) =>
	tool( {
		meta: {
			type: 'check',
			show_in_commands: true,
			transition_eligible: true,
			supports: [ 'workflow' ],
		},
		settings_schema: {
			threshold: {
				type: 'integer',
				default: 80,
				label: 'Score threshold',
				enforceable: true,
			},
			strictness: {
				type: 'string',
				enum: [ 'low', 'high' ],
				default: 'low',
				label: 'Strictness',
			},
			note: { type: 'string', default: '', label: 'Note' },
			verbose: { type: 'boolean', default: false, label: 'Verbose' },
		},
		...overrides,
	} );

/**
 * Every control on the card except the Enabled toggle itself.
 *
 * @return {Array<HTMLElement>} The controls, in the order the card renders them.
 */
const configurationControls = () => [
	screen.getByRole( 'checkbox', { name: 'Show in command palette' } ),
	screen.getByRole( 'checkbox', { name: /Can be used in transitions/ } ),
	screen.getByRole( 'spinbutton', { name: 'Score threshold' } ),
	screen.getByRole( 'radio', { name: /soft/i } ),
	screen.getByRole( 'radio', { name: /hard/i } ),
	screen.getByRole( 'combobox', { name: 'Strictness' } ),
	screen.getByRole( 'textbox', { name: 'Note' } ),
	screen.getByRole( 'checkbox', { name: 'Verbose' } ),
];

/**
 * Render the screen with the given tools and wait for the fetch to settle.
 *
 * @param {Array} entries Tool payloads.
 * @return {Promise<Object>} Render result.
 */
async function renderTools( entries ) {
	apiFetch.mockImplementation( ( { method } ) =>
		method === 'POST'
			? Promise.resolve( entries[ 0 ] )
			: Promise.resolve( entries )
	);

	const result = render( <Tools /> );

	// The active panel's content mounts a tick after the strip, so waiting on a
	// tab alone would let a synchronous query run against an empty panel.
	await waitFor( () =>
		expect( screen.getByText( entries[ 0 ].name ) ).toBeInTheDocument()
	);

	return result;
}

describe( 'Tools screen shape', () => {
	afterEach( () => {
		apiFetch.mockReset();
		successNotices.length = 0;
		// The active tab round-trips through the URL, so a test that switched
		// tabs would otherwise decide which tab the next one opens on.
		window.history.replaceState( {}, '', '/' );
	} );

	it( 'splits the tool types across one tab strip', async () => {
		await renderTools( [ tool() ] );

		expect( screen.getByRole( 'tab', { name: 'Checks' } ) ).toBeVisible();
		expect(
			screen.getByRole( 'tab', { name: 'Validators' } )
		).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Helpers' } ) ).toBeVisible();
	} );

	it( 'keeps a type that has no tools, and says so', async () => {
		// Filtering empty types out would make the strip vary per site, and on a
		// site with only checks it would collapse to a single tab.
		await renderTools( [ tool() ] );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Helpers' } ) );

		expect(
			await screen.findByText( 'No helper tools are registered.' )
		).toBeInTheDocument();
	} );

	it( 'round-trips the active tab through the URL', async () => {
		await renderTools( [ tool() ] );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Helpers' } ) );

		await waitFor( () =>
			expect(
				new URLSearchParams( window.location.search ).get( 'tab' )
			).toBe( 'helper' )
		);
	} );

	it( 'opens on the tab the URL names', async () => {
		window.history.replaceState( {}, '', '/?tab=validator' );

		await renderTools( [ tool() ] );

		expect(
			await screen.findByText( 'No validation tools are registered.' )
		).toBeInTheDocument();
	} );

	it( 'offers exactly one Save for the whole screen', async () => {
		await renderTools( [
			tool(),
			tool( { id: 'vip-workflows/seo', name: 'SEO check' } ),
		] );

		expect(
			screen.getAllByRole( 'button', { name: 'Save' } )
		).toHaveLength( 1 );
	} );

	it( 'disables Save until a tool is edited', async () => {
		await renderTools( [ tool() ] );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);
	} );

	it( 'saves the edited tool through its own route', async () => {
		await renderTools( [ tool() ] );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/vip-workflows/v1/tools/vip-workflows/readability/settings',
					method: 'POST',
					data: expect.objectContaining( { enabled: false } ),
				} )
			)
		);

		await waitFor( () =>
			expect( successNotices ).toContain( 'Tools saved.' )
		);
	} );

	it( 'shows a failed save instead of swallowing it', async () => {
		// The old per-card handler reported failure to `console.error` alone, so
		// the reader watched a button stop spinning and change nothing.
		apiFetch.mockImplementation( ( { method } ) =>
			method === 'POST'
				? Promise.reject( new Error( 'Network down' ) )
				: Promise.resolve( [ tool() ] )
		);

		const { container } = render( <Tools /> );

		fireEvent.click(
			await screen.findByRole( 'checkbox', { name: 'Enabled' } )
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		// Scoped to the notice: `Notice` also mirrors its content into the
		// aria-live region, so an unscoped query matches the same text twice.
		await waitFor( () =>
			expect(
				container.querySelector( '.components-notice.is-error' )
			).toBeInTheDocument()
		);

		expect(
			within(
				container.querySelector( '.components-notice.is-error' )
			).getByText( /Readability: Network down/ )
		).toBeInTheDocument();
		expect( successNotices ).toHaveLength( 0 );
	} );
} );

describe( 'Tools screen — a switched-off tool', () => {
	afterEach( () => {
		apiFetch.mockReset();
		successNotices.length = 0;
		window.history.replaceState( {}, '', '/' );
	} );

	it( 'keeps every control live while the tool is on', async () => {
		await renderTools( [ configurableTool( { enabled: true } ) ] );

		for ( const control of configurationControls() ) {
			expect( control ).toBeEnabled();
		}
	} );

	it( 'switches the whole card off with it', async () => {
		// Nothing but the toggle used to read `enabled`, so a reader could
		// configure a tool that was switched off — and mark the screen dirty
		// doing it. Every control below the toggle describes how the tool
		// behaves when it runs, so a tool that does not run offers none of them.
		await renderTools( [ configurableTool( { enabled: false } ) ] );

		for ( const control of configurationControls() ) {
			expect( control ).toBeDisabled();
		}
	} );

	it( 'leaves the Enabled toggle live, since it is the way back', async () => {
		await renderTools( [ configurableTool( { enabled: false } ) ] );

		expect(
			screen.getByRole( 'checkbox', { name: 'Enabled' } )
		).toBeEnabled();
	} );

	it( 'hands the controls back the moment the tool is switched on', async () => {
		await renderTools( [ configurableTool( { enabled: false } ) ] );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );

		await waitFor( () =>
			expect(
				screen.getByRole( 'textbox', { name: 'Note' } )
			).toBeEnabled()
		);
		for ( const control of configurationControls() ) {
			expect( control ).toBeEnabled();
		}
	} );

	it( 'says why the controls are grey', async () => {
		// On a fresh install every tool is off, so without this the screen's
		// default state is a slab of grey with no explanation. The standard puts
		// the reason in `help`, not a `title` tooltip — and the schema fields,
		// which have no one control to hang `help` off, get one line for the
		// block.
		await renderTools( [ configurableTool( { enabled: false } ) ] );

		expect(
			screen.getAllByText( 'Enable the tool to change this.' )
		).toHaveLength( 2 );
		expect(
			screen.getByText( 'Enable the tool to change these settings.' )
		).toBeInTheDocument();
		expect(
			screen.queryByText(
				'Soft flags a warning; hard blocks the transition.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'cannot be dirtied, so Save stays disabled', async () => {
		// The half of the complaint that mattered: a switched-off tool could be
		// configured *and saved*. Greying the controls is only the visible part
		// of that — this pins the consequence, that nothing a reader does to a
		// tool that is off can arm the screen's one Save.
		await renderTools( [ configurableTool( { enabled: false } ) ] );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();

		// Every control is disabled, so a browser delivers no event to any of
		// them. Only the check-mode pill can prove that here: it is a `<button>`
		// React itself refuses to run a handler on. React does still route a
		// synthetic click on a disabled `<input>` to `onChange` — something a
		// browser never does — so clicking the toggles would test jsdom rather
		// than the card. `fireEvent` runs inside `act`, so the dirty-reporting
		// effect behind any state change has flushed by the next line.
		for ( const control of configurationControls() ) {
			expect( control ).toBeDisabled();
		}
		fireEvent.click( screen.getByRole( 'radio', { name: /hard/i } ) );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();

		// And the way back still works, so the tool is not stranded.
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enabled' } ) );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);
	} );

	it( 'tells a plugin-supplied settings component it is off', async () => {
		// The card can only switch off the controls it renders itself. A plugin
		// component is rendered live beside them, so the contract has to hand it
		// `disabled` — without it the same bug just moves out one layer, into
		// the filter.
		const seen = [];
		addFilter(
			'vipWorkflows.toolSettingsComponent',
			'vip-workflows-test/tool-settings',
			( component, ability, callbacks ) => {
				seen.push( callbacks.disabled );
				return component;
			}
		);

		try {
			await renderTools( [ configurableTool( { enabled: false } ) ] );

			expect( seen.length ).toBeGreaterThan( 0 );
			expect( seen.every( ( flag ) => flag === true ) ).toBe( true );
		} finally {
			removeFilter(
				'vipWorkflows.toolSettingsComponent',
				'vip-workflows-test/tool-settings'
			);
		}
	} );
} );
