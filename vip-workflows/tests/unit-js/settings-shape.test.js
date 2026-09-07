/**
 * Unit tests for the Settings screen's shape, per docs/guides/settings-standard.md.
 *
 * The screen used to be four tabs each wrapped in a card named after itself,
 * running three save models between them — two panels saved inside their card,
 * one saved in a bar below its cards, and Experiments wrote on every toggle and
 * reloaded. It is now four panels of sections with a single Save in the footer,
 * which changes four things a test can hold still: how many Saves exist, what
 * enables the one that does, that an experiment toggle stages rather than
 * writes, and that a failed save names the tab it came from.
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

jest.mock( '@wordpress/api-fetch' );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

/**
 * Every prop `RadioControl` was rendered with, in render order.
 *
 * `RadioControl` destructures the props it knows and spreads the rest onto every
 * `<input type="radio">`, so what it is handed is the whole story — see the
 * enforcement-radio test below for what that guards.
 */
const mockRadioControlProps = [];

// A pass-through: the real component renders, and the props it was called with
// are recorded on the way past.
jest.mock( '@wordpress/components', () => {
	const actual = jest.requireActual( '@wordpress/components' );
	const { createElement } = jest.requireActual( '@wordpress/element' );

	return {
		...actual,
		RadioControl: ( props ) => {
			mockRadioControlProps.push( props );
			return createElement( actual.RadioControl, props );
		},
	};
} );

// eslint-disable-next-line import/first
import Settings from '../../src/admin/pages/Settings';

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
 * `GET /vip-workflows/v1/settings/general`, as the controller returns it.
 *
 * @return {Object} General settings payload.
 */
const generalSettings = () => ( {
	workflow_enforcement: false,
	workflow_enforcement_mode: 'require',
	allow_self_review: false,
	bypass_workflow_roles: [ 'administrator' ],
	bypass_tool_check_roles: [ 'administrator' ],
	audit_log_roles: [ 'administrator' ],
	audit_log_full_access_roles: [ 'administrator' ],
	ai_provider: 'openai',
	// Two providers are connected, so a resolved one can only have been stored:
	// the endpoint derives a provider from credentials alone when exactly one is
	// keyed. Without this the AI panel reads the provider as in-use-but-unsaved
	// and reports pending work before the screen has been touched.
	ai_provider_selected: true,
	ai_providers: [ 'openai', 'anthropic' ],
	ai_model: 'gpt-4o',
	ai_models: {
		openai: [ 'gpt-4o', 'gpt-4o-mini' ],
		anthropic: [ 'claude-sonnet' ],
	},
} );

const roles = () => [
	{ key: 'administrator', name: 'Administrator' },
	{ key: 'editor', name: 'Editor' },
];

const prompts = () => [
	{
		id: 'media/image-analysis',
		label: 'Image analysis',
		group: 'Media',
		description: 'Describes an uploaded image.',
		default: 'Describe this image.',
		override: '',
	},
	{
		id: 'media/alt-text',
		label: 'Alt text',
		group: 'Media',
		description: 'Writes alt text.',
		default: 'Write alt text.',
		override: '',
	},
];

const experiments = () => [
	{
		id: 'ideation',
		name: 'Ideation',
		description: 'Story ideation surfaces.',
		enabled: false,
		available: true,
	},
];

/**
 * Route the mocked `apiFetch` by path, letting a test override single routes.
 *
 * @param {Object} overrides Map of `${method} ${path}` => handler.
 */
function mockRoutes( overrides = {} ) {
	apiFetch.mockImplementation( ( { path, method = 'GET' } ) => {
		const override = overrides[ `${ method } ${ path }` ];
		if ( override ) {
			return override();
		}

		// The roles route is a child of the general one, so it is matched first.
		if ( path === '/vip-workflows/v1/settings/general/roles' ) {
			return Promise.resolve( roles() );
		}
		if ( path === '/vip-workflows/v1/settings/general' ) {
			return Promise.resolve( generalSettings() );
		}
		if ( path === '/vip-workflows/v1/settings/experiments' ) {
			return Promise.resolve( experiments() );
		}
		if ( path === '/vip-workflows/v1/prompts' ) {
			return Promise.resolve( prompts() );
		}
		if ( path.startsWith( '/vip-workflows/v1/prompts/' ) ) {
			return Promise.resolve( {
				...prompts()[ 0 ],
				override: 'Edited.',
			} );
		}

		throw new Error( `Unmocked request: ${ method } ${ path }` );
	} );
}

/**
 * Render the screen and wait for the General panel to settle.
 *
 * @param {Object} overrides Route overrides for `mockRoutes`.
 * @return {Promise<Object>} Render result.
 */
async function renderSettings( overrides ) {
	mockRoutes( overrides );

	const result = render( <Settings /> );

	await waitFor( () =>
		expect(
			screen.getByRole( 'heading', { name: 'Workflow behavior' } )
		).toBeInTheDocument()
	);

	return result;
}

/**
 * The role-picker fieldset a group name belongs to.
 *
 * @param {string} name The group's name, as its heading reads.
 * @return {HTMLElement} The `<fieldset>` the group renders as.
 */
function roleGroup( name ) {
	return screen
		.getByRole( 'heading', { name, level: 3 } )
		.closest( 'fieldset' );
}

describe( 'Settings screen shape', () => {
	afterEach( () => {
		apiFetch.mockReset();
		successNotices.length = 0;
		// The active tab round-trips through the URL, so a test that switched
		// tabs would otherwise decide which tab the next one opens on.
		window.history.replaceState( {}, '', '/' );
	} );

	it( 'offers exactly one Save for the whole screen', async () => {
		await renderSettings();

		expect(
			screen.getAllByRole( 'button', { name: 'Save' } )
		).toHaveLength( 1 );
	} );

	it( 'names its groups as sections, not as cards repeating the tab', async () => {
		await renderSettings();

		// The card titled "General" inside the General tab is gone; what is left
		// is the three groups, each an h2 under the page h1.
		expect(
			screen.queryByRole( 'heading', { name: 'General' } )
		).not.toBeInTheDocument();

		for ( const title of [
			'Workflow behavior',
			'Bypass permissions',
			'Audit log access',
		] ) {
			expect(
				screen.getByRole( 'heading', { name: title, level: 2 } )
			).toBeInTheDocument();
		}
	} );

	it( 'stops a section and a control inside it sharing one name', async () => {
		await renderSettings();

		// "Audit log access" used to name both the group and the first role
		// picker in it. The section keeps the name; the pickers say which
		// activity they grant.
		expect(
			screen.queryByRole( 'heading', {
				name: 'Audit log access',
				level: 3,
			} )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'heading', { name: 'Own activity', level: 3 } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'heading', { name: 'All activity', level: 3 } )
		).toBeInTheDocument();
	} );

	it( 'puts a role group description above its checkboxes', async () => {
		await renderSettings();

		const group = roleGroup( 'Own activity' );
		const description = within( group ).getByText(
			'Selected roles can open the audit log and see their own activity in it.'
		);
		const firstCheckbox = within( group ).getAllByRole( 'checkbox' )[ 0 ];

		// Below the grid, the description reads as a note on the last checkbox.
		const order = Array.from( group.querySelectorAll( '*' ) );
		expect( order.indexOf( description ) ).toBeLessThan(
			order.indexOf( firstCheckbox )
		);
	} );

	it( 'names the role group from its legend and describes it separately', async () => {
		await renderSettings();

		// The group is a native `<fieldset>` with a native `<legend>`, so the
		// legend's text *is* the group's accessible name. That is why the
		// description sits outside it and is wired up with `aria-describedby`:
		// nested in the legend, as it once was, it was read out as part of the
		// name. Both halves are pinned here — the name is the label alone, and
		// the description still reaches the group.
		const group = roleGroup( 'Own activity' );
		const heading = screen.getByRole( 'heading', {
			name: 'Own activity',
			level: 3,
		} );

		expect( group.tagName ).toBe( 'FIELDSET' );
		expect( heading.closest( 'legend' ) ).toBe(
			group.querySelector( 'legend' )
		);
		expect( group ).toHaveAccessibleName( 'Own activity' );
		expect( group ).toHaveAccessibleDescription(
			'Selected roles can open the audit log and see their own activity in it.'
		);
	} );

	it( 'renders the enforcement radios without a prop RadioControl would spread onto every input', async () => {
		// `RadioControl` is the one control here that does not take
		// `__nextHasNoMarginBottom`. It pulls out the props it knows and spreads
		// the rest onto every `<input type="radio">`, where React rejects the
		// flag as a non-boolean attribute: it warns once and drops it, so the
		// DOM looks identical either way.
		//
		// The warning alone cannot carry this guard. React dedupes it per prop
		// name for the lifetime of the module registry, so a `console.error`
		// assertion — even the implicit one `@wordpress/jest-console` applies —
		// only fires for whichever test in this file renders the radios first,
		// and adding an earlier one would silently retire the guard. What the
		// component is handed is order-independent, so that is what is asserted.
		mockRadioControlProps.length = 0;

		await renderSettings( {
			'GET /vip-workflows/v1/settings/general': () =>
				Promise.resolve( {
					...generalSettings(),
					workflow_enforcement: true,
				} ),
		} );

		expect( await screen.findAllByRole( 'radio' ) ).toHaveLength( 2 );
		expect( mockRadioControlProps.length ).toBeGreaterThan( 0 );

		for ( const props of mockRadioControlProps ) {
			expect( props ).not.toHaveProperty( '__nextHasNoMarginBottom' );
		}
	} );

	it( 'disables Save until a panel is edited', async () => {
		await renderSettings();

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Allow users to review their own posts',
			} )
		);

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);
	} );

	it( 'saves the edited panel through its own route', async () => {
		await renderSettings();

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Allow users to review their own posts',
			} )
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/vip-workflows/v1/settings/general',
					method: 'POST',
					data: expect.objectContaining( {
						allow_self_review: true,
					} ),
				} )
			)
		);

		await waitFor( () =>
			expect( successNotices ).toContain( 'Settings saved.' )
		);
	} );

	it( 'sends only the fields the General panel owns', async () => {
		// The AI panel writes the provider and model through the same route, so
		// posting the whole payload back would undo whatever it just saved.
		await renderSettings();

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Allow users to review their own posts',
			} )
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( { method: 'POST' } )
			)
		);

		const [ [ request ] ] = apiFetch.mock.calls.filter(
			( [ args ] ) => args.method === 'POST'
		);
		expect( request.data ).not.toHaveProperty( 'ai_provider' );
		expect( request.data ).not.toHaveProperty( 'ai_model' );
	} );

	it( 'names the tab a failed save came from', async () => {
		const { container } = await renderSettings( {
			'POST /vip-workflows/v1/settings/general': () =>
				Promise.reject( new Error( 'Network down' ) ),
		} );

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Allow users to review their own posts',
			} )
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
			).getByText( /General: Network down/ )
		).toBeInTheDocument();
		expect( successNotices ).toHaveLength( 0 );
	} );

	it( 'keeps a panel edited on one tab when another is shown', async () => {
		// Base UI unmounts a hidden panel by default, which on a staged screen
		// throws the reader's edits away with no warning.
		await renderSettings();

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Allow users to review their own posts',
			} )
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		fireEvent.click( screen.getByRole( 'tab', { name: 'Prompts' } ) );
		await screen.findByRole( 'heading', { name: 'Media', level: 2 } );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();

		fireEvent.click( screen.getByRole( 'tab', { name: 'General' } ) );

		expect(
			await screen.findByRole( 'checkbox', {
				name: 'Allow users to review their own posts',
			} )
		).toBeChecked();
	} );

	it( 'round-trips the active tab through the URL', async () => {
		await renderSettings();

		fireEvent.click( screen.getByRole( 'tab', { name: 'Experiments' } ) );

		await waitFor( () =>
			expect(
				new URLSearchParams( window.location.search ).get( 'tab' )
			).toBe( 'experiments' )
		);
	} );

	it( 'stages an experiment toggle instead of writing it', async () => {
		// It used to POST on the toggle and reload the page, which made this the
		// one immediate-apply panel on a staged-and-saved screen.
		await renderSettings();

		fireEvent.click( screen.getByRole( 'tab', { name: 'Experiments' } ) );

		fireEvent.click(
			await screen.findByRole( 'checkbox', { name: 'Ideation' } )
		);

		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Save' } )
			).toBeEnabled()
		);

		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( { method: 'POST' } )
		);
	} );

	it( 'separates prompt fields with space, not rules', async () => {
		const { container } = await renderSettings();

		fireEvent.click( screen.getByRole( 'tab', { name: 'Prompts' } ) );
		await screen.findByRole( 'heading', { name: 'Media', level: 2 } );

		expect( container.querySelectorAll( 'hr' ) ).toHaveLength( 0 );
	} );

	it( 'drops the AI copy pointing at a setting that is not there', async () => {
		await renderSettings();

		fireEvent.click( screen.getByRole( 'tab', { name: 'AI services' } ) );

		expect(
			await screen.findByRole( 'heading', {
				name: 'AI model',
				level: 2,
			} )
		).toBeInTheDocument();
		expect(
			screen.queryByText( /own model setting below/ )
		).not.toBeInTheDocument();
	} );
} );
