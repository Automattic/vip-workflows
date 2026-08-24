/**
 * Unit tests for the AI services settings panel.
 *
 * The panel is the only place that writes `vip_workflow_ai_provider`, which makes
 * it the only way out of an unresolved provider — so the thing worth pinning is
 * that every state it can land in is both honest and escapable.
 *
 * It previously was neither. A `SelectControl` handed a value absent from its
 * options renders the first option instead, so a site whose resolved provider
 * was not among the connected ones displayed a provider the component was not
 * holding: the field read "Anthropic", state read "openai", the model list came
 * back empty because it was keyed by "openai", choosing "Anthropic" fired no
 * change because the control already showed it, and Save stayed disabled. The
 * one control that could have fixed the site was unreachable, and recovery
 * needed WP-CLI.
 *
 * The panel has no Save of its own: it stages its edits and reports two things
 * to the Settings page, which owns the screen's one Save — whether it holds
 * savable work, and how to commit it (docs/guides/settings-standard.md). So what
 * "Save is enabled" used to assert is now asserted on the dirty state the panel
 * reports, and what "clicking Save" used to do is now invoking the handler it
 * registered.
 *
 * `SelectControl` renders a native <select>, so these assertions read its value
 * directly rather than opening a menu — see the harness notes on WPDS popovers.
 *
 * @package
 */

import {
	render,
	fireEvent,
	waitFor,
	within,
	act,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

import { AiModelSettings } from '../../src/admin/components/AiModelSettings';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

/**
 * A general-settings payload, defaulting to the reported bug's site shape:
 * Anthropic connected, nothing ever chosen.
 *
 * @param {Object} overrides Fields to replace.
 * @return {Object} The payload.
 */
const payload = ( overrides = {} ) => ( {
	ai_provider: 'anthropic',
	ai_provider_selected: false,
	ai_providers: [ 'anthropic' ],
	ai_model: '',
	ai_models: { anthropic: [ 'claude-sonnet-5', 'claude-opus-5' ] },
	...overrides,
} );

/**
 * The panel's own subtree.
 *
 * Every query below is scoped to it rather than run against `screen`, because
 * `Notice` mirrors its text into the global `a11y-speak` live region — which
 * lives outside the render container and is not torn down between tests, so a
 * document-wide query both double-matches within a test and sees the previous
 * test's copy.
 *
 * @type {HTMLElement|null}
 */
let panel = null;

/**
 * The last dirty state the panel reported upward.
 *
 * This is the screen's Save button: the footer enables when any panel reports
 * true, and `handleSave` only calls the handlers of the panels that did. So
 * "Save is available" and "this reports dirty" are the same assertion.
 *
 * @type {boolean|null}
 */
let dirty = null;

/**
 * The save handler the panel registered, as the Settings page holds it.
 *
 * @type {Function|null}
 */
let save = null;

const onDirtyChange = ( id, isDirty ) => {
	expect( id ).toBe( 'ai-services' );
	dirty = isDirty;
};

const registerSave = ( id, fn ) => {
	save = fn;
};

/**
 * Render the panel with a stubbed endpoint, resolved before assertions run.
 *
 * @param {Object} data Payload the endpoint returns for both GET and POST.
 */
const renderPanel = async ( data ) => {
	apiFetch.mockImplementation( () => Promise.resolve( data ) );
	await mount();
};

/**
 * Mount the panel against whatever `apiFetch` is currently stubbed with, and
 * wait out the initial GET.
 */
const mount = async () => {
	panel = render(
		<AiModelSettings
			onDirtyChange={ onDirtyChange }
			registerSave={ registerSave }
		/>
	).container;

	await waitFor( () =>
		expect(
			within( panel ).queryByText( 'Loading AI settings…' )
		).not.toBeInTheDocument()
	);
};

/**
 * Run the registered save the way the Settings page does, and settle the state
 * updates its resolution causes.
 *
 * @return {Promise} Resolves once the panel has re-rendered.
 */
const runSave = async () => {
	await act( async () => {
		await save();
	} );
};

const providerSelect = () => within( panel ).getByLabelText( 'Provider' );
const modelSelect = () => within( panel ).getByLabelText( 'Model' );

beforeEach( () => {
	apiFetch.mockReset();
	panel = null;
	dirty = null;
	save = null;
} );

describe( 'a provider derived from the only connected credential', () => {
	it( 'names it, and offers to save it without any interaction', async () => {
		await renderPanel( payload() );

		expect( providerSelect() ).toHaveValue( 'anthropic' );
		expect( dirty ).toBe( true );
		expect(
			within( panel ).getByText( /No provider has been chosen/ )
		).toBeInTheDocument();
	} );

	/**
	 * The model half of the same defect. The derived provider arrives with no
	 * model, so the Model select was handed '' against a populated catalog and
	 * rendered the first entry — and the endpoint rejects an empty model, so the
	 * single obvious Save stored the provider, dropped the model, and went clean
	 * while the field still showed a model that was never stored.
	 */
	it( 'shows and posts the same model, rather than displaying one it never saved', async () => {
		await renderPanel( payload() );

		expect( modelSelect() ).toHaveValue( 'claude-sonnet-5' );

		await runSave();

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				method: 'POST',
				data: {
					ai_provider: 'anthropic',
					ai_model: 'claude-sonnet-5',
				},
			} )
		);
	} );

	/**
	 * Reachable after a save whose model the endpoint rejected: the response puts
	 * `''` back while the catalog is still populated, which is exactly the state
	 * the administrator has to get out of.
	 *
	 * The panel withholds its dirty flag rather than disabling a button it no
	 * longer owns — the screen's Save runs every panel that reports dirty, so a
	 * panel that reports a configuration it already knows will be half-rejected is
	 * how the half-written state gets re-submitted.
	 */
	it( 'withholds savable work when the catalog offers models and none is held', async () => {
		apiFetch.mockImplementation( ( { method } ) =>
			Promise.resolve(
				method === 'POST'
					? // The provider was stored; the model was rejected.
					  payload( {
							ai_provider_selected: true,
							ai_model: '',
					  } )
					: payload()
			)
		);

		await mount();
		await runSave();

		expect( dirty ).toBe( false );
		expect( modelSelect() ).toHaveValue( '' );

		fireEvent.change( modelSelect(), {
			target: { value: 'claude-opus-5' },
		} );

		expect( dirty ).toBe( true );
	} );

	/**
	 * The one case the endpoint accepts a provider with no model. Discovery could
	 * not reach the vendor, so there is nothing to choose — and the help text has
	 * to say what that actually means for this provider rather than promising a
	 * default only OpenAI has.
	 */
	it( 'stays savable on an empty catalog, and does not promise a default it lacks', async () => {
		await renderPanel(
			payload( { ai_models: { anthropic: [] }, ai_model: '' } )
		);

		expect( dirty ).toBe( true );
		expect(
			within( panel ).getByText( /cannot generate through it/ )
		).toBeInTheDocument();
		expect(
			within( panel ).queryByText( /the default will be used/ )
		).not.toBeInTheDocument();
	} );
} );

describe( 'a stored provider', () => {
	it( 'renders no pending notice and reports nothing to save', async () => {
		await renderPanel(
			payload( {
				ai_provider_selected: true,
				ai_model: 'claude-sonnet-5',
			} )
		);

		expect( providerSelect() ).toHaveValue( 'anthropic' );
		expect( dirty ).toBe( false );
		expect(
			within( panel ).queryByText( /No provider has been chosen/ )
		).not.toBeInTheDocument();
	} );

	it( 'reports savable work once the model changes', async () => {
		await renderPanel(
			payload( {
				ai_provider_selected: true,
				ai_model: 'claude-sonnet-5',
			} )
		);

		fireEvent.change( modelSelect(), {
			target: { value: 'claude-opus-5' },
		} );

		expect( dirty ).toBe( true );
	} );
} );

describe( 'two connected providers and no selection', () => {
	const ambiguous = payload( {
		ai_provider: '',
		ai_providers: [ 'openai', 'anthropic' ],
		ai_models: {
			openai: [ 'gpt-4o' ],
			anthropic: [ 'claude-sonnet-5' ],
		},
	} );

	/**
	 * The direct regression test for the reported wedge: with an absent value the
	 * control must show the placeholder, not silently adopt the first provider.
	 */
	it( 'shows a placeholder rather than the first provider', async () => {
		await renderPanel( ambiguous );

		expect( providerSelect() ).toHaveValue( '' );
		expect(
			within( panel ).getByText( /More than one provider is connected/ )
		).toBeInTheDocument();
	} );

	it( 'populates the models and becomes savable once a provider is chosen', async () => {
		await renderPanel( ambiguous );

		expect( dirty ).toBe( false );

		fireEvent.change( providerSelect(), {
			target: { value: 'anthropic' },
		} );

		expect( providerSelect() ).toHaveValue( 'anthropic' );
		expect( modelSelect() ).toHaveValue( 'claude-sonnet-5' );
		expect( dirty ).toBe( true );
	} );
} );

/**
 * Reachable by choosing a provider and then rotating or removing its key in
 * Settings → Connectors. `provider()` returns the stored selection whatever the
 * site is keyed for, while the options list only offers connected providers — so
 * the field named a vendor state was not holding, and every AI surface went on
 * reporting the stored vendor's missing credential with no way through the UI to
 * change it.
 */
describe( 'a stored provider that is no longer connected', () => {
	const stale = payload( {
		ai_provider: 'openai',
		ai_provider_selected: true,
		ai_providers: [ 'anthropic' ],
		ai_model: 'gpt-4o',
		ai_models: { anthropic: [ 'claude-sonnet-5' ] },
	} );

	it( 'names the disconnected provider rather than the connected one', async () => {
		await renderPanel( stale );

		expect( providerSelect() ).toHaveValue( 'openai' );
		expect(
			within( panel ).getByText( /no longer connected/ )
		).toBeInTheDocument();
		expect(
			within( panel ).queryByText( /No provider has been chosen/ )
		).not.toBeInTheDocument();
	} );

	it( 'lets the connected provider be chosen and saved', async () => {
		await renderPanel( stale );

		fireEvent.change( providerSelect(), {
			target: { value: 'anthropic' },
		} );

		expect( providerSelect() ).toHaveValue( 'anthropic' );
		expect( modelSelect() ).toHaveValue( 'claude-sonnet-5' );
		expect( dirty ).toBe( true );
	} );
} );

/**
 * The model half of the stale-value guard. A model saved before the provider's
 * catalog changed is no longer offered, and the select must name it rather than
 * silently adopting the first entry — the same rule the provider select follows.
 */
describe( 'a stored model no longer in its provider catalog', () => {
	it( 'names it rather than silently showing another', async () => {
		await renderPanel(
			payload( {
				ai_provider_selected: true,
				ai_model: 'claude-sonnet-3',
				ai_models: { anthropic: [ 'claude-sonnet-5' ] },
			} )
		);

		expect( modelSelect() ).toHaveValue( 'claude-sonnet-3' );
		expect(
			within( panel ).getByText( /claude-sonnet-3 \(not available\)/ )
		).toBeInTheDocument();
	} );
} );

describe( 'no connected provider', () => {
	it( 'points at Connectors and offers no controls to fill in', async () => {
		await renderPanel(
			payload( {
				ai_provider: '',
				ai_providers: [],
				ai_models: {},
			} )
		);

		expect(
			within( panel ).getByText( /No AI provider is connected/ )
		).toBeInTheDocument();
		expect(
			within( panel ).queryByLabelText( 'Provider' )
		).not.toBeInTheDocument();
		expect( dirty ).toBe( false );
	} );
} );

/**
 * The panel renders no save error of its own. `Settings::handleSave` catches per
 * panel and names the tab in one screen-level notice, which only works if the
 * handler rejects rather than swallowing — so what this pins is that the failure
 * reaches the caller at all.
 */
describe( 'a failing save', () => {
	it( 'propagates the failure to the screen', async () => {
		apiFetch.mockImplementation( ( { method } ) =>
			method === 'POST'
				? Promise.reject( new Error( 'Nope.' ) )
				: Promise.resolve( payload() )
		);

		await mount();

		await expect( save() ).rejects.toThrow( 'Nope.' );
		expect( dirty ).toBe( true );
	} );
} );
