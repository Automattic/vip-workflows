/**
 * Unit tests for availability rendering on the Tools page.
 *
 * The tools controller has always computed `available`, and this page has always
 * ignored it — so a tool whose dependencies are unmet looked identical to a
 * working one. These pin the fix, and pin it against the *same* shape the Agents
 * card and the AI-stage picker read, since all three now render through
 * `AgentRequirements` and must not drift.
 *
 * Asserted through `ToolsSettings` because `ToolCard` is not exported; the page
 * fetches on mount, so `apiFetch` is mocked.
 *
 * @package
 */

import { render, screen, waitFor, within } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { createReduxStore, register } from '@wordpress/data';

jest.mock( '@wordpress/api-fetch' );
// The package's untranspiled ESM cannot be required here, and the screen only
// needs the store's key to dispatch its success snackbar.
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

// eslint-disable-next-line import/first
import Tools from '../../src/admin/pages/Tools';

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = [] ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'CREATE_SUCCESS_NOTICE' } ),
		},
	} )
);

const CONNECTORS_URL = 'https://example.com/wp-admin/options-connectors.php';

/**
 * A tool payload as `GET /vip-workflow/v1/tools` returns it.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Tool entry.
 */
const tool = ( overrides = {} ) => ( {
	id: 'workflow-tool-checklist/checklist',
	name: 'Editorial Checklist',
	description: 'Requires a checklist to be completed.',
	category: 'check',
	enabled: true,
	available: true,
	availability: { available: true, groups: [] },
	// The page groups by `meta.type` and skips anything without one, so this is
	// load-bearing rather than incidental fixture detail.
	meta: { type: 'check' },
	settings_schema: {},
	...overrides,
} );

const unavailable = ( groups, overrides = {} ) =>
	tool( {
		available: false,
		availability: { available: false, groups },
		...overrides,
	} );

const credentialGroup = [
	{
		satisfy: 'all',
		requirements: [
			{
				id: 'credential:tavily',
				kind: 'missing_credential',
				sources: [ 'Editorial Checklist' ],
				reason: 'Tavily is not connected.',
				destination: {
					kind: 'admin_url',
					url: CONNECTORS_URL,
					label: 'Settings → Connectors',
					hint: '',
				},
			},
		],
	},
];

/**
 * The requirement notice, scoped so queries do not also match the aria-live
 * region `Notice` mirrors its content into.
 *
 * @param {HTMLElement} container Render container.
 * @return {Object} Scoped queries.
 */
function requirements( container ) {
	const notice = container.querySelector( '.components-notice.is-warning' );

	expect( notice ).toBeInTheDocument();

	return within( notice );
}

/**
 * Render the page with one tool.
 *
 * @param {Object} entry Tool payload.
 * @return {Promise<Object>} Render result, after the fetch settles.
 */
async function renderTools( entry ) {
	apiFetch.mockResolvedValue( [ entry ] );

	const result = render( <Tools /> );

	await waitFor( () =>
		expect( screen.getByText( 'Editorial Checklist' ) ).toBeInTheDocument()
	);

	return result;
}

describe( 'Tools page — a tool that cannot run', () => {
	afterEach( () => {
		apiFetch.mockReset();
	} );

	it( 'leaves an available tool unmarked', async () => {
		const { container } = await renderTools( tool() );

		expect(
			container.querySelector( '.components-notice.is-warning' )
		).not.toBeInTheDocument();
	} );

	it( 'marks an unavailable tool and names its requirement', async () => {
		const { container } = await renderTools(
			unavailable( credentialGroup )
		);

		expect(
			container.querySelector( '.components-notice.is-warning' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Tavily is not connected.' )
		).toBeInTheDocument();
	} );

	it( 'says it once — the notice carries the state, with no badge repeating it', async () => {
		// The header badge and this notice were two renderings of one fact, the
		// badge saying less. The notice names which requirement is unmet, so it
		// is the one that stayed.
		await renderTools( unavailable( credentialGroup ) );

		expect( screen.queryByText( 'Setup needed' ) ).not.toBeInTheDocument();
	} );

	it( 'links to the destination when there is one', async () => {
		await renderTools( unavailable( credentialGroup ) );

		expect(
			screen.getByRole( 'link', { name: /Settings → Connectors/ } )
		).toHaveAttribute( 'href', CONNECTORS_URL );
	} );

	it( 'renders no anchor when the requirement has nowhere to go', async () => {
		// The legacy credential backend has no admin screen, so the requirement
		// names a wp-config.php constant instead. Rendering a link there is the
		// dead end this whole feature exists to remove.
		const { container } = await renderTools(
			unavailable( [
				{
					satisfy: 'all',
					requirements: [
						{
							id: 'credential:tavily',
							kind: 'missing_credential',
							sources: [ 'Editorial Checklist' ],
							reason: 'Tavily is not connected.',
							destination: {
								kind: 'none',
								url: '',
								label: '',
								hint: 'Set the VIP_WORKFLOW_TAVILY_KEY constant in wp-config.php.',
							},
						},
					],
				},
			] )
		);

		expect(
			requirements( container ).getByText( /VIP_WORKFLOW_TAVILY_KEY/ )
		).toBeInTheDocument();
		expect(
			requirements( container ).queryByRole( 'link' )
		).not.toBeInTheDocument();
	} );

	it( 'keeps a generic line for a tool that reports no requirements', async () => {
		// A bare-bool `false` from an availability_callback carries no reason. The
		// bool contract is preserved on purpose, so this is a documented exception
		// rather than a fallback for missing data.
		const { container } = await renderTools( unavailable( [] ) );

		expect(
			requirements( container ).getByText(
				'This tool has required settings that are not yet configured.'
			)
		).toBeInTheDocument();
	} );

	it( 'still states the requirement when the tool is switched off', async () => {
		// The toggle is a preference, not a readiness signal — same rule as the
		// Agents card, so the two surfaces do not disagree. A reader who turns a
		// tool off has not resolved what it needs, and turning it back on must
		// not be the way they find that out.
		const { container } = await renderTools(
			unavailable( credentialGroup, { enabled: false } )
		);

		expect(
			requirements( container ).getByText( 'Tavily is not connected.' )
		).toBeInTheDocument();
		expect(
			container.querySelector( 'input[type="checkbox"]' )
		).toBeEnabled();
	} );

	it( 'renders the user register without offering a link', async () => {
		// The tools route is edit_posts-gated, so unlike the Agents card this page
		// can genuinely receive the editor register — which carries `message` and
		// no destination at all.
		const { container } = await renderTools(
			unavailable( [
				{
					satisfy: 'all',
					requirements: [
						{
							id: 'credential:tavily',
							kind: 'missing_credential',
							sources: [ 'Editorial Checklist' ],
							message:
								'Tavily is not connected. Ask an administrator to connect it.',
						},
					],
				},
			] )
		);

		expect(
			requirements( container ).getByText(
				/Ask an administrator to connect it\./
			)
		).toBeInTheDocument();
		expect(
			requirements( container ).queryByRole( 'link' )
		).not.toBeInTheDocument();
		expect(
			container.querySelector( '.components-notice.is-warning' ).innerHTML
		).not.toContain( '/wp-admin/' );
	} );
} );
