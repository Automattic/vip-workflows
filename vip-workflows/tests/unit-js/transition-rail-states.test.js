/**
 * The transition rail's empty and degenerate states, which must not
 * impersonate each other.
 *
 * A naive implementation collapses terminal, dead end, agent running,
 * all-locked and blocked-by-check into one blank box reading "dead end".
 * They are five different facts (six, counting a stage whose edges belong to
 * other roles), and each test here asserts its own marker present AND its
 * neighbours' markers absent.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			getEditedPostAttribute: ( state, attr ) =>
				'modified' === attr ? '2026-08-14T10:00:00' : 'draft',
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
 * Render the rail with defaults a test overrides, flushing the initial
 * abilities fetch so no state update lands outside act().
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

/** The rail's END pill, or null. */
const endPill = () => document.querySelector( '.vip-workflows-rail__end' );
/** The green finished check on the stage mark, or null. */
const doneMark = () => document.querySelector( '.vip-workflows-rail__done' );
/** The neutral (dead end) stage dot, or null. */
const neutralDot = () =>
	document.querySelector( '.vip-workflows-rail__dot--neutral' );
/** Everything in the actions column the drawing measures itself against. */
const railTargets = () => document.querySelectorAll( '[data-rail-target]' );
/** Every line, wave and arrowhead the rail's SVG track draws. */
const trackPaths = () =>
	document.querySelectorAll( '.vip-workflows-rail__track path' );

/**
 * Give jsdom a laid-out box for the duration of one test.
 *
 * The rail's `measure()` bails the moment its container reports a zero height,
 * which under jsdom is always — so without this the SVG track never renders at
 * all and an assertion about the drawing would pass against a component that
 * never drew. With a box, `measure()` runs for real: it queries the
 * `[data-rail-target]` elements and hands their midpoints to `railGeometry`,
 * which is exactly the chain the terminal states change.
 *
 * @return {Function} Restores the real `getBoundingClientRect`.
 */
function withLayout() {
	const original = Element.prototype.getBoundingClientRect;

	Element.prototype.getBoundingClientRect = () => ( {
		top: 0,
		left: 0,
		right: 260,
		bottom: 120,
		width: 260,
		height: 120,
		x: 0,
		y: 0,
	} );

	return () => {
		Element.prototype.getBoundingClientRect = original;
	};
}

describe( 'TransitionRail degenerate states', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.startsWith( '/vip-workflows/v1/abilities' ) ) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( {} );
		} );
	} );

	it( 'completed: the green check and one heading say it — no name in the heading, no badge, no pill, no arrow', async () => {
		// The state used to say "finished" four times over: the check, the
		// stage's own name as the heading, a Live badge beside it, and an END
		// pill with an arrowhead aimed at it. One claim survives.
		const restoreLayout = withLayout();

		try {
			await renderRail( {
				postStatus: 'publish',
				current: { key: 'hired', label: 'Hired', is_terminal: true },
			} );

			expect( screen.getByText( 'Workflow Completed' ) ).toBeVisible();
			expect( doneMark() ).toBeInTheDocument();
			expect( neutralDot() ).not.toBeInTheDocument();

			// `is_terminal` is not a synonym for success — the seeded hiring
			// sequence marks Hired AND Rejected terminal — so which ending was
			// reached is demoted to the subline, never dropped.
			expect( screen.getByText( 'Hired' ) ).toBeVisible();

			expect( screen.queryByText( 'Live' ) ).not.toBeInTheDocument();
			expect( endPill() ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
			expect(
				screen.queryByText( 'you are here' )
			).not.toBeInTheDocument();

			// No target in the actions column is what removes the arrowhead:
			// the drawing is measured from those elements and railGeometry
			// returns nothing for zero rows.
			expect( railTargets() ).toHaveLength( 0 );
			expect( trackPaths() ).toHaveLength( 0 );
		} finally {
			restoreLayout();
		}
	} );

	it( 'dead end: END pill under a neutral dot — stopped is not done', async () => {
		const restoreLayout = withLayout();

		try {
			await renderRail( {
				postStatus: 'publish',
				current: {
					key: 'rejected',
					label: 'Rejected',
					is_terminal: true,
					is_dead_end: true,
				},
			} );

			expect( endPill() ).toBeInTheDocument();
			expect( neutralDot() ).toBeInTheDocument();
			expect( doneMark() ).not.toBeInTheDocument();

			// Both flags on one stage: the dead end wins, so the heading stays
			// the stage's own name and the panel never calls the stop a finish.
			expect(
				screen.queryByText( 'Workflow Completed' )
			).not.toBeInTheDocument();
			expect( screen.getByText( 'Rejected' ) ).toBeVisible();

			// And because the heading still names the stage rather than the
			// ending, the badge is still the only thing saying the post is
			// publicly live — "Rejected" does not imply it. Suppression tracks
			// the heading swap, not the terminal flag.
			expect( screen.getByText( 'Live' ) ).toBeVisible();

			// The contrast that proves the completed state's blank drawing is
			// its empty actions column rather than a measure() that never ran:
			// one target here draws a trunk, a spur and an arrowhead.
			expect( railTargets() ).toHaveLength( 1 );
			expect( trackPaths().length ).toBeGreaterThan( 0 );
		} finally {
			restoreLayout();
		}
	} );

	it( 'a non-terminal live post keeps its Live badge — the stage does not imply the status', async () => {
		await renderRail( {
			postStatus: 'publish',
			transitions: [
				{
					to: 'archived',
					label: 'Archive',
					status_info: { key: 'archived', label: 'Archived' },
				},
			],
			current: { key: 'published', label: 'Published' },
			allStatuses: [ { key: 'archived', label: 'Archived' } ],
		} );

		expect( screen.getByText( 'Live' ) ).toBeVisible();
		expect( screen.getByText( 'Published' ) ).toBeVisible();
		expect(
			screen.queryByText( 'Workflow Completed' )
		).not.toBeInTheDocument();
	} );

	it( 'agent running: spinner on the mark, routed outcomes as disabled labelled buttons', async () => {
		await renderRail( {
			agentPending: true,
			current: {
				key: 'factcheck',
				label: 'Fact-check',
				agent: {
					ability_id: 'x/fact-check',
					routing: { pass: 'copyedit', fail: 'rework' },
				},
				transitions: [
					{ to: 'copyedit', label: 'Send to copyedit' },
					{ to: 'rework', label: 'Send back for rework' },
				],
			},
			allStatuses: [
				{ key: 'copyedit', label: 'Copyedit' },
				{ key: 'rework', label: 'Rework' },
			],
		} );

		const pass = screen.getByRole( 'button', {
			name: 'Send to copyedit',
		} );
		const fail = screen.getByRole( 'button', {
			name: 'Send back for rework',
		} );

		expect( pass ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( fail ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			document.querySelector( '.vip-workflows-rail__spinner' )
		).toBeInTheDocument();
		expect( endPill() ).not.toBeInTheDocument();
		// An unrouted outcome draws no button.
		expect( screen.getAllByRole( 'button' ) ).toHaveLength( 2 );
	} );

	it( 'agent running: the outcome mark is spaced off its label', async () => {
		// The mark rides the Button's `icon` slot, and the icon–label gap comes
		// from the `has-text` class the Button sets from
		// `!! icon && hasChildren`. `hasChildren` counts a non-empty STRING
		// child or an ARRAY of children — a label wrapped in a lone element is
		// neither, so the class never landed and the icon-only rule
		// (`padding: 6px; justify-content: center`) butted the glyph against
		// the word.
		await renderRail( {
			agentPending: true,
			current: {
				key: 'factcheck',
				label: 'Fact-check',
				agent: {
					ability_id: 'x/fact-check',
					routing: { pass: 'copyedit' },
				},
				transitions: [ { to: 'copyedit', label: 'Send to copyedit' } ],
			},
			allStatuses: [ { key: 'copyedit', label: 'Copyedit' } ],
		} );

		const pass = screen.getByRole( 'button', { name: 'Send to copyedit' } );
		expect( pass ).toHaveClass( 'has-icon' );
		expect( pass ).toHaveClass( 'has-text' );
	} );

	it( 'agent running: outcome buttons come from routing, never from the transitions payload', async () => {
		await renderRail( {
			agentPending: true,
			// The payload's transitions are deliberately empty while an agent
			// owns the stage (StatusManager::agent_owns_stage_exits); a rail
			// reading them would render the blank box this file exists to
			// prevent.
			transitions: [],
			current: {
				key: 'factcheck',
				label: 'Fact-check',
				agent: {
					ability_id: 'x/fact-check',
					routing: { error: 'draft' },
				},
				transitions: [ { to: 'draft', label: '' } ],
			},
			allStatuses: [ { key: 'draft', label: 'Draft' } ],
		} );

		// The unauthored label derives, exactly as the server derives it.
		expect(
			screen.getByRole( 'button', { name: 'Move to Draft' } )
		).toBeInTheDocument();
	} );

	it( 'agent failed with exits withheld: routed outcomes stay drawn, disabled, and no spinner', async () => {
		// The server withholds the transitions while the failed job records a
		// resolvable origin — the way out is the panel's Go back action. The
		// rail keeps drawing the routed outcomes so the stage does not misread
		// as role-filtered or dead-ended.
		await renderRail( {
			agentPending: false,
			agentFailed: true,
			transitions: [],
			current: {
				key: 'factcheck',
				label: 'Fact-check',
				agent: {
					ability_id: 'x/fact-check',
					routing: { pass: 'copyedit', fail: 'rework' },
				},
				transitions: [
					{ to: 'copyedit', label: 'Send to copyedit' },
					{ to: 'rework', label: 'Send back for rework' },
				],
			},
			allStatuses: [
				{ key: 'copyedit', label: 'Copyedit' },
				{ key: 'rework', label: 'Rework' },
			],
		} );

		const pass = screen.getByRole( 'button', {
			name: 'Send to copyedit',
		} );
		expect( pass ).toHaveAttribute( 'aria-disabled', 'true' );
		// No run is in flight — the mark must not claim one.
		expect(
			document.querySelector( '.vip-workflows-rail__spinner' )
		).not.toBeInTheDocument();
		expect( endPill() ).not.toBeInTheDocument();
	} );

	it( 'agent failed with released transitions: live buttons, not the outcomes view', async () => {
		// A failure with no resolvable origin releases the stage's routed
		// transitions (the go-back cannot be honored); the rail renders them
		// as ordinary clickable buttons.
		await renderRail( {
			agentPending: false,
			agentFailed: true,
			transitions: [
				{
					to: 'copyedit',
					label: 'Send to copyedit',
					status_info: { key: 'copyedit', label: 'Copyedit' },
				},
			],
			current: {
				key: 'factcheck',
				label: 'Fact-check',
				agent: {
					ability_id: 'x/fact-check',
					routing: { pass: 'copyedit' },
				},
				transitions: [ { to: 'copyedit', label: 'Send to copyedit' } ],
			},
			allStatuses: [ { key: 'copyedit', label: 'Copyedit' } ],
		} );

		const button = screen.getByRole( 'button', {
			name: 'Send to copyedit',
		} );
		expect( button ).not.toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'all-locked: every button aria-disabled with its reason visible, no pill', async () => {
		await renderRail( {
			transitions: [
				{
					to: 'hired',
					label: 'Hire',
					_locked: true,
					_locked_reason: 'Requires the Editor role.',
				},
				{
					to: 'rejected',
					label: 'Reject',
					_locked: true,
					_locked_reason: 'You are not assigned to this post.',
				},
			],
		} );

		expect(
			screen.getByRole( 'button', { name: 'Hire' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect( screen.getByText( 'Requires the Editor role.' ) ).toBeVisible();
		expect(
			screen.getByText( 'You are not assigned to this post.' )
		).toBeVisible();
		expect( endPill() ).not.toBeInTheDocument();
	} );

	it( 'blocked-by-check: the transition stays live with the failing check beneath it', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.startsWith( '/vip-workflows/v1/abilities?' ) ) {
				return Promise.resolve( [
					{
						id: 'x/seo',
						label: 'SEO check',
						enabled: true,
						check_modes: { meta: 'hard' },
						meta: {},
					},
				] );
			}
			if ( path.includes( '/ability-results' ) ) {
				return Promise.resolve( [
					{
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
							],
						},
					},
				] );
			}
			return Promise.resolve( {} );
		} );

		await renderRail( {
			transitions: [
				{ to: 'hired', label: 'Hire', required_tools: [ 'x/seo' ] },
			],
		} );

		// The failing verdict is an icon glyph carrying the fail tone class,
		// not a painted dot.
		await waitFor( () =>
			expect(
				document.querySelector(
					'svg.vip-workflows-rail__outcome--fail'
				)
			).toBeInTheDocument()
		);

		// The server re-runs the check at transition time whatever the cache
		// says, so a cached failure must not disable the move.
		expect(
			screen.getByRole( 'button', { name: 'Hire' } )
		).not.toHaveAttribute( 'aria-disabled', 'true' );
		expect( screen.getByText( 'Blocks this move.' ) ).toBeVisible();
		expect(
			screen.getByText( 'Meta description is missing.' )
		).toBeVisible();
	} );

	it( 'role-filtered: edges the sequence declares but the user cannot see are named, not a dead end', async () => {
		await renderRail( {
			transitions: [],
			current: {
				key: 'legal',
				label: 'Legal',
				transitions: [ { to: 'published', label: 'Publish' } ],
			},
		} );

		expect(
			screen.getByText( 'Moves from this stage belong to other roles.' )
		).toBeVisible();
		expect( endPill() ).not.toBeInTheDocument();
	} );

	it( 'a stage that declares no moves says so — also not a dead end', async () => {
		await renderRail( {
			transitions: [],
			current: { key: 'limbo', label: 'Limbo', transitions: [] },
		} );

		expect(
			screen.getByText( 'This stage declares no moves.' )
		).toBeVisible();
		expect( endPill() ).not.toBeInTheDocument();
		expect( doneMark() ).not.toBeInTheDocument();
	} );

	it( 'a job-less AI stage with nothing usable names the agent, not other roles', async () => {
		// A zero-route agent stage reached with no job (the authored trap the
		// sequence editor warns about): the stage HAS authored transitions, but
		// they belong to its agent's routes, none of which exist. Saying "other
		// roles" here would send the reader chasing a permission that is not
		// the problem.
		await renderRail( {
			transitions: [],
			agentPending: false,
			agentFailed: false,
			current: {
				key: 'factcheck',
				label: 'Fact-check',
				agent: { ability_id: 'x/fact-check', routing: {} },
				transitions: [ { to: 'copyedit', label: 'Send to copyedit' } ],
			},
			allStatuses: [ { key: 'copyedit', label: 'Copyedit' } ],
		} );

		expect(
			screen.getByText( 'Moves from this stage belong to its AI agent.' )
		).toBeVisible();
		expect(
			screen.queryByText( 'Moves from this stage belong to other roles.' )
		).not.toBeInTheDocument();
		expect( endPill() ).not.toBeInTheDocument();
	} );

	it( 'a stage with one way forward renders it as the primary', async () => {
		await renderRail( {
			transitions: [
				{
					to: 'review',
					label: 'Submit for review',
					status_info: { key: 'review', label: 'Review' },
				},
			],
			current: { key: 'draft', label: 'Draft' },
			allStatuses: [ { key: 'review', label: 'Review' } ],
		} );

		expect(
			screen.getByRole( 'button', { name: 'Submit for review' } )
		).toHaveClass( 'is-primary' );
	} );

	it( 'two or more ways forward stay level secondaries — the rail promotes nobody', async () => {
		await renderRail( {
			transitions: [
				{
					to: 'review',
					label: 'Submit for review',
					status_info: { key: 'review', label: 'Review' },
				},
				{
					to: 'draft',
					label: 'Send back',
					status_info: { key: 'draft', label: 'Draft' },
				},
			],
			current: { key: 'copyedit', label: 'Copyedit' },
			allStatuses: [
				{ key: 'review', label: 'Review' },
				{ key: 'draft', label: 'Draft' },
			],
		} );

		expect(
			screen.getByRole( 'button', { name: 'Submit for review' } )
		).toHaveClass( 'is-secondary' );
		expect(
			screen.getByRole( 'button', { name: 'Send back' } )
		).toHaveClass( 'is-secondary' );
	} );

	it( 'a lone locked move is never the primary — a disabled button cannot carry the weight of the surface', async () => {
		await renderRail( {
			transitions: [
				{
					to: 'review',
					label: 'Submit for review',
					_locked: true,
					_locked_reason: 'You are not assigned to this post.',
					status_info: { key: 'review', label: 'Review' },
				},
			],
			current: { key: 'draft', label: 'Draft' },
			allStatuses: [ { key: 'review', label: 'Review' } ],
		} );

		const button = screen.getByRole( 'button', {
			name: 'Submit for review',
		} );
		expect( button ).toHaveClass( 'is-secondary' );
		expect( button ).toHaveAttribute( 'aria-disabled', 'true' );
	} );
} );
