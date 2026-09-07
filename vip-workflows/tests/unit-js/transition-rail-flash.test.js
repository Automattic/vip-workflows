/**
 * The agent three-beat resolve: when a run finishes, the taken outcome holds
 * its pressed state for a beat before the panel re-renders on the new stage,
 * and the move is announced — nobody clicked, so the flash and the
 * announcement are the only things saying which way the agent routed.
 *
 * The flash keys on `agent_last_run` matching the stage the rail was
 * watching; without the field (an older server), the rail degrades straight
 * to the re-render.
 *
 * @package
 */

import { render, act } from './helpers/render-wp-component';
import { screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import { speak } from '@wordpress/a11y';

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
			getEditedPostAttribute: () => 'draft',
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

const AGENT_STAGE = {
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
};

const ALL_STATUSES = [
	AGENT_STAGE,
	{ key: 'copyedit', label: 'Copyedit' },
	{ key: 'rework', label: 'Rework' },
];

const BASE_PROPS = {
	postId: 42,
	transitions: [],
	allStatuses: ALL_STATUSES,
	agentLastRun: null,
	transitioning: false,
	transitioningTo: null,
	onTransition: () => {},
	resultsVersion: 0,
};

/**
 * Props for the stage the run routed to.
 *
 * @param {?Object} agentLastRun The resolved-run record, or null.
 * @return {Object} Props.
 */
const landedProps = ( agentLastRun ) => ( {
	...BASE_PROPS,
	agentPending: false,
	agentLastRun,
	current: { key: 'copyedit', label: 'Copyedit' },
	transitions: [ { to: 'factcheck', label: 'Re-run fact check' } ],
} );

describe( 'TransitionRail agent resolve flash', () => {
	beforeEach( () => {
		jest.useFakeTimers();
		apiFetch.mockReset();
		speak.mockReset();
		apiFetch.mockImplementation( () => Promise.resolve( [] ) );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	it( 'presses the taken outcome for a beat, then re-renders on the new stage', async () => {
		let rerender;
		await act( async () => {
			( { rerender } = render(
				<TransitionRail
					{ ...BASE_PROPS }
					agentPending
					current={ AGENT_STAGE }
				/>
			) );
		} );

		await act( async () => {
			rerender(
				<TransitionRail
					{ ...landedProps( {
						stage_key: 'factcheck',
						outcome: 'pass',
						to: 'copyedit',
						finished_at: '2026-08-14 10:00:00',
					} ) }
				/>
			);
		} );

		// Beat two: the old agent view holds, the taken outcome pressed, the
		// other not — and the new stage's buttons are not on screen yet.
		expect(
			screen.getByRole( 'button', { name: 'Send to copyedit' } )
		).toHaveClass( 'is-pressed' );
		expect(
			screen.getByRole( 'button', { name: 'Send back for rework' } )
		).not.toHaveClass( 'is-pressed' );
		expect(
			screen.queryByRole( 'button', { name: 'Re-run fact check' } )
		).not.toBeInTheDocument();

		// The announcement lands with the flash, not after it.
		expect( speak ).toHaveBeenCalledWith(
			expect.stringContaining( 'Fact-check finished' ),
			'polite'
		);

		// Beat three: the flash releases and the new stage renders.
		await act( async () => {
			jest.advanceTimersByTime( 700 );
		} );

		expect(
			screen.getByRole( 'button', { name: 'Re-run fact check' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Send to copyedit' } )
		).not.toBeInTheDocument();
	} );

	it( 'degrades straight to the re-render when the server sends no agent_last_run', async () => {
		let rerender;
		await act( async () => {
			( { rerender } = render(
				<TransitionRail
					{ ...BASE_PROPS }
					agentPending
					current={ AGENT_STAGE }
				/>
			) );
		} );

		await act( async () => {
			rerender( <TransitionRail { ...landedProps( null ) } /> );
		} );

		// No flash to hold: the new stage is already on screen, and the move
		// is still announced.
		expect(
			screen.getByRole( 'button', { name: 'Re-run fact check' } )
		).toBeInTheDocument();
		expect( speak ).toHaveBeenCalledWith(
			expect.stringContaining( 'Moved to Copyedit' ),
			'polite'
		);
	} );

	it( 'never flashes on a stage change an agent did not make', async () => {
		let rerender;
		await act( async () => {
			( { rerender } = render(
				<TransitionRail
					{ ...BASE_PROPS }
					agentPending={ false }
					current={ { key: 'offer', label: 'Offer' } }
					transitions={ [ { to: 'copyedit', label: 'Hand off' } ] }
				/>
			) );
		} );

		await act( async () => {
			// A stale record from an earlier run rides the payload; the move
			// observed here was not agent-pending, so it must not flash.
			rerender(
				<TransitionRail
					{ ...landedProps( {
						stage_key: 'factcheck',
						outcome: 'pass',
						to: 'copyedit',
						finished_at: '2026-08-01 10:00:00',
					} ) }
				/>
			);
		} );

		expect(
			screen.getByRole( 'button', { name: 'Re-run fact check' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Send to copyedit' } )
		).not.toBeInTheDocument();
	} );
} );
