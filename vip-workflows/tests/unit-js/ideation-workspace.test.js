/**
 * Unit tests for what the ideation workspace does with a turned-off agent.
 *
 * The workspace owns the one fetch of the abilities response that the board and
 * the panel both read, so it is where a single filter could — and did — decide
 * three unrelated questions at once. Filtering that fetch to `enabled` agents
 * removed a turned-off agent's section from the render order while its cards were
 * still grouped into it, so sources that were in the database, counted, and
 * possibly pinned rendered nowhere and reported nothing.
 *
 * These assert the two halves that the component-level tests cannot see, because
 * they are handed a `researchAbilities` list rather than fetching one:
 *
 *   - the fetch keeps turned-off agents, so the board can name and show them;
 *   - the first-load batch still refuses to run one.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

/*
 * `@wordpress/notices` pulls an ESM-only `uuid` build that Jest cannot parse, and
 * the workspace only uses it to name the store it dispatches error snackbars to.
 * `@wordpress/data` itself is left alone — `@wordpress/components` reaches into it
 * for `combineReducers` — so the store it names is registered for real instead.
 */
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

import { createReduxStore, register } from '@wordpress/data';

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: { createErrorNotice: () => ( { type: 'NOOP' } ) },
	} )
);

import IdeationWorkspace from '../../src/admin/components/ideation/IdeationWorkspace';

import { disabledVipAbility, vipAbility } from './helpers/abilities-fixture';

const ABILITY = 'vip-workflows/web-researcher';
const OFF_ABILITY = 'workflow-discovery-foresight/foresight-research';

const ABILITIES_PATH = '/vip-workflows/v1/abilities?category=research';

/*
 * The abilities response as `AbilitiesController::get_items()` builds it, from the
 * shared builder in ./helpers/abilities-fixture — generated from
 * tests/fixtures/abilities-response-contract.json and guarded in both directions by
 * ./abilities-response-contract.test.js. Every ability in the category is listed,
 * each carrying `enabled`: the endpoint does not filter turned-off agents out, which
 * is what makes naming one on the board possible.
 */
const ABILITIES = [
	vipAbility( {
		id: ABILITY,
		label: 'Web Researcher',
		display_order: 1,
	} ),
	disabledVipAbility( {
		id: OFF_ABILITY,
		label: 'Foresight News',
		icon: 'book-alt',
		display_order: 2,
	} ),
];

/**
 * Ideation state with one card found by each agent.
 *
 * @param {Object} assistants Stored assistant results, keyed by ability id.
 * @return {Object} Ideation state.
 */
const stateWith = ( assistants ) => ( {
	project_id: 222,
	seed: 'Bears Ears',
	cards: [
		{
			source_id: 'src-1',
			ability_id: ABILITY,
			title: 'Modifying the Bears Ears National Monument',
			url: 'https://example.test/one',
			card_status: 'default',
		},
		{
			source_id: 'src-2',
			ability_id: OFF_ABILITY,
			title: 'Interior Department budget hearing',
			url: 'https://example.test/two',
			card_status: 'default',
		},
	],
	pinned_ids: [],
	assistants,
	seed_analysis: {},
	query_log: [],
	server_time: '2026-07-30 12:00:00',
} );

/**
 * The ability ids the workspace asked the run-assistant route to run.
 *
 * @return {string[]} Ability ids.
 */
function assistantsRun() {
	return apiFetch.mock.calls
		.filter( ( [ options ] ) =>
			options?.path?.endsWith( '/run-assistant' )
		)
		.map( ( [ options ] ) => options.data.assistant );
}

/**
 * Mount the workspace and let the abilities fetch settle.
 *
 * @param {Object} state Ideation state.
 * @return {Promise<Object>} Render result.
 */
async function mountWorkspace( state ) {
	let result;
	await act( async () => {
		result = render(
			<IdeationWorkspace
				state={ state }
				onStateChange={ () => {} }
				onBack={ () => {} }
			/>
		);
	} );
	return result;
}

describe( 'ideation workspace — the abilities fetch', () => {
	beforeEach( () => {
		// Auto-refresh off, so the mentor never runs and the only requests under
		// test are the ones this fixture drives.
		localStorage.setItem( 'vip_workflows_mentor_auto', '0' );

		apiFetch.mockReset();
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path === ABILITIES_PATH ) {
				return Promise.resolve( ABILITIES );
			}
			if ( path.endsWith( '/summary' ) ) {
				return Promise.reject( new Error( 'no summary yet' ) );
			}
			return Promise.resolve( stateWith( {} ) );
		} );
	} );

	it( 'keeps a turned-off agent, so its cards reach the board', async () => {
		await mountWorkspace( stateWith( {} ) );

		await waitFor( () =>
			expect(
				screen.getByText( 'Interior Department budget hearing' )
			).toBeInTheDocument()
		);
	} );

	it( 'gives that agent a section named after it', async () => {
		const { container } = await mountWorkspace( stateWith( {} ) );

		await waitFor( () => {
			const titles = Array.from(
				container.querySelectorAll(
					'.vip-workflows-ideation-section__title'
				)
			).map( ( node ) => node.textContent );

			expect( titles ).toContain( 'Foresight News' );
		} );
		expect( container.textContent ).not.toMatch(
			/workflow-discovery-foresight\//
		);
	} );

	it( 'still shows a live agent’s cards and section', async () => {
		const { container } = await mountWorkspace( stateWith( {} ) );

		await waitFor( () =>
			expect(
				screen.getByText( 'Modifying the Bears Ears National Monument' )
			).toBeInTheDocument()
		);
		const titles = Array.from(
			container.querySelectorAll(
				'.vip-workflows-ideation-section__title'
			)
		).map( ( node ) => node.textContent );
		expect( titles ).toContain( 'Web Researcher' );
	} );
} );

describe( 'ideation workspace — the first-load batch', () => {
	beforeEach( () => {
		localStorage.setItem( 'vip_workflows_mentor_auto', '0' );

		apiFetch.mockReset();
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path === ABILITIES_PATH ) {
				return Promise.resolve( ABILITIES );
			}
			if ( path.endsWith( '/summary' ) ) {
				return Promise.reject( new Error( 'no summary yet' ) );
			}
			return Promise.resolve( stateWith( {} ) );
		} );
	} );

	// A `pending` entry only says the agent was queued when the project was
	// created. An administrator turning it off in between is exactly the state
	// this install is in, and firing it would ask a route that refuses it.
	const bothPending = {
		[ ABILITY ]: { status: 'pending', label: 'Web Researcher' },
		[ OFF_ABILITY ]: { status: 'pending', label: 'Foresight News' },
	};

	it( 'runs a pending live agent', async () => {
		await mountWorkspace( stateWith( bothPending ) );

		await waitFor( () => expect( assistantsRun() ).toContain( ABILITY ) );
	} );

	it( 'does not run a pending turned-off agent', async () => {
		await mountWorkspace( stateWith( bothPending ) );

		await waitFor( () => expect( assistantsRun() ).toContain( ABILITY ) );
		expect( assistantsRun() ).not.toContain( OFF_ABILITY );
	} );
} );
