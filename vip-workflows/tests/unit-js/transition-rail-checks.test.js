/**
 * The transition rail's check dependency rows.
 *
 * Three rules from the data:
 * results are shared per post + ability with no transition column, so a check
 * required by two exits renders under both and one run updates both; a
 * disabled required tool blocks at transition time, so it remains visible but
 * cannot be run; and a result older than the post's last edit renders stale —
 * the glyph keeps its full tone (a faded tone fails non-text contrast) and
 * the verdict-and-age note carries the words — because a green check from
 * before the last edit is a promise the component can't keep.
 *
 * @package
 */

import {
	render,
	screen,
	waitFor,
	act,
	fireEvent,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';

// The post was last edited at 10:00 — a result before that is stale, one
// after it is current.
const POST_MODIFIED = '2026-08-14T10:00:00';

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			getEditedPostAttribute: ( state, attr ) =>
				'modified' === attr ? POST_MODIFIED : 'draft',
		},
	} )
);

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

// eslint-disable-next-line import/first
import { TransitionRail } from '../../src/editor/components/TransitionRail';

/**
 * An ability row as the endpoint annotates it.
 *
 * @param {string} id    Ability id.
 * @param {string} label Display label.
 * @param {Object} extra Overrides.
 * @return {Object} The ability.
 */
const ability = ( id, label, extra = {} ) => ( {
	id,
	label,
	enabled: true,
	check_modes: {},
	meta: {},
	...extra,
} );

/**
 * Render the rail, flushing the fetch effects.
 *
 * @param {Object} props Prop overrides.
 */
async function renderRail( props = {} ) {
	await act( async () => {
		render(
			<TransitionRail
				postId={ 42 }
				current={ { key: 'offer', label: 'Offer' } }
				transitions={ [] }
				allStatuses={ [] }
				agentPending={ false }
				agentLastRun={ null }
				transitioning={ false }
				transitioningTo={ null }
				onTransition={ () => {} }
				resultsVersion={ 0 }
				{ ...props }
			/>
		);
	} );
}

/**
 * Stub the abilities and results routes.
 *
 * @param {Array}  abilities Ability rows.
 * @param {Object} results   Latest result per ability id.
 * @param {Object} runResult What POST /run returns.
 */
function stubRoutes( abilities, results = {}, runResult = null ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( 'POST' === method && path.includes( '/run' ) ) {
			return runResult
				? Promise.resolve( runResult )
				: Promise.reject( new Error( 'no run stub' ) );
		}
		if ( path.startsWith( '/vip-workflows/v1/abilities?' ) ) {
			return Promise.resolve( abilities );
		}
		const match = path.match( /ability_id=([^&]+)/ );
		if ( match ) {
			const id = decodeURIComponent( match[ 1 ] );
			return Promise.resolve( results[ id ] ? [ results[ id ] ] : [] );
		}
		return Promise.resolve( {} );
	} );
}

describe( 'TransitionRail check rows', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'renders a check required by two transitions under both, and one run updates both', async () => {
		stubRoutes(
			[ ability( 'x/seo', 'SEO check' ) ],
			{},
			{
				ability_id: 'x/seo',
				success: true,
				created_at: '2026-08-14 11:00:00',
				output: { status: 'pass', issues: [] },
			}
		);

		await renderRail( {
			transitions: [
				{ to: 'hired', label: 'Hire', required_tools: [ 'x/seo' ] },
				{
					to: 'published',
					label: 'Fast-track',
					required_tools: [ 'x/seo' ],
				},
			],
		} );

		const checkButtons = screen.getAllByRole( 'button', {
			name: 'SEO check',
		} );
		expect( checkButtons ).toHaveLength( 2 );

		// Nothing has run: two not-run marks, drawn as icon glyphs (the
		// neutral dash), not painted dots.
		expect(
			document.querySelectorAll( 'svg.vip-workflows-rail__outcome--none' )
		).toHaveLength( 2 );

		// Run it under ONE transition…
		await act( async () => {
			fireEvent.click( checkButtons[ 0 ] );
		} );

		// …and BOTH rows read from the one shared result row.
		await waitFor( () =>
			expect(
				document.querySelectorAll(
					'svg.vip-workflows-rail__outcome--pass'
				)
			).toHaveLength( 2 )
		);
	} );

	it( 'shows a disabled required tool and explains why it cannot run', async () => {
		stubRoutes( [
			ability( 'x/seo', 'SEO check', { enabled: false } ),
			ability( 'x/readability', 'Readability' ),
		] );

		await renderRail( {
			transitions: [
				{
					to: 'hired',
					label: 'Hire',
					required_tools: [ 'x/seo', 'x/readability' ],
				},
			],
		} );

		expect(
			screen.getByRole( 'button', { name: 'SEO check' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText(
				'This required check is switched off. Re-enable it, or remove it from this transition.'
			)
		).toBeVisible();
		expect(
			screen.getByRole( 'button', { name: 'Readability' } )
		).toBeInTheDocument();
	} );

	it( 'omits a tool that owns its own sidebar panel', async () => {
		stubRoutes( [
			ability( 'x/panel-tool', 'Panel tool', {
				meta: { has_sidebar_panel: true },
			} ),
		] );

		await renderRail( {
			transitions: [
				{
					to: 'hired',
					label: 'Hire',
					required_tools: [ 'x/panel-tool' ],
				},
			],
		} );

		expect(
			screen.queryByRole( 'button', { name: 'Panel tool' } )
		).not.toBeInTheDocument();
	} );

	it( 'renders a pass from before the last edit as stale, not passed', async () => {
		stubRoutes( [ ability( 'x/seo', 'SEO check' ) ], {
			'x/seo': {
				ability_id: 'x/seo',
				success: true,
				created_at: '2026-08-13 09:00:00', // before POST_MODIFIED
				output: { status: 'pass', issues: [] },
			},
		} );

		await renderRail( {
			transitions: [
				{ to: 'hired', label: 'Hire', required_tools: [ 'x/seo' ] },
			],
		} );

		await waitFor( () =>
			expect(
				document.querySelector( '.vip-workflows-rail__outcome--stale' )
			).toBeInTheDocument()
		);
		// The stale mark still names its outcome — the pass glyph, at full
		// tone — so which verdict aged is not erased.
		expect(
			document.querySelector( '.vip-workflows-rail__outcome--stale' )
		).toHaveClass( 'vip-workflows-rail__outcome--pass' );
		// The glyphs are aria-hidden, so the indicator's title is the whole
		// assistive-tech surface: it must name the verdict and the age.
		expect(
			document.querySelector( '.vip-workflows-rail__dep-indicator' )
		).toHaveAttribute( 'title', 'Passed — before the latest edit' );
		// The visible note carries the same pair — the title is hover-only,
		// so this line is where both facts are actually readable.
		expect(
			screen.getByText( 'Passed — before the latest edit' )
		).toBeVisible();
	} );

	it( 'renders a pass from after the last edit as current — no stale hook, no note', async () => {
		stubRoutes( [ ability( 'x/seo', 'SEO check' ) ], {
			'x/seo': {
				ability_id: 'x/seo',
				success: true,
				created_at: '2026-08-14 11:30:00', // after POST_MODIFIED
				output: { status: 'pass', issues: [] },
			},
		} );

		await renderRail( {
			transitions: [
				{ to: 'hired', label: 'Hire', required_tools: [ 'x/seo' ] },
			],
		} );

		await waitFor( () =>
			expect(
				document.querySelector( '.vip-workflows-rail__outcome--pass' )
			).toBeInTheDocument()
		);
		expect(
			document.querySelector( '.vip-workflows-rail__outcome--stale' )
		).not.toBeInTheDocument();
		// A current pass gets the bare verdict, no age: the tooltip says only
		// "Passed" and the verdict-and-age note does not render.
		expect(
			document.querySelector( '.vip-workflows-rail__dep-indicator' )
		).toHaveAttribute( 'title', 'Passed' );
		expect(
			screen.queryByText( 'Passed — before the latest edit' )
		).not.toBeInTheDocument();
	} );

	it( 'grades a mixed run with one roll-up and marks only the lines that differ', async () => {
		stubRoutes(
			[
				ability( 'x/seo', 'SEO check', {
					check_modes: { meta: 'hard' },
				} ),
			],
			{
				'x/seo': {
					ability_id: 'x/seo',
					success: true,
					created_at: '2026-08-14 11:00:00',
					output: {
						status: 'fail',
						issues: [
							{
								check_key: 'meta',
								message: 'Meta description is missing.',
							},
							{
								check_key: 'length',
								message: 'Article is short.',
							},
						],
					},
				},
			}
		);

		await renderRail( {
			transitions: [
				{ to: 'hired', label: 'Hire', required_tools: [ 'x/seo' ] },
			],
		} );

		await waitFor( () =>
			expect( screen.getByText( 'Blocks this move.' ) ).toBeVisible()
		);
		// The hard line matches the roll-up: unmarked. The soft line differs:
		// it carries its own grade word.
		expect( screen.getByText( 'Warns:' ) ).toBeVisible();
		expect( screen.queryByText( 'Blocks:' ) ).not.toBeInTheDocument();
	} );
} );
