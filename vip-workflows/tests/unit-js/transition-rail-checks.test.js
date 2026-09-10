/**
 * The transition rail and a transition's required checks.
 *
 * The server runs a transition's required tools when it fires, so the rail
 * offers the move and nothing beside it — no row, mark or button per tool. A
 * tool switched off site-wide still reaches the rail, as a lock the server
 * puts on the transition, and that lock's reason is what the writer reads.
 *
 * @package
 */

import { render, screen } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

// Answers every route with the tools the transitions below require, so a rail
// that looked them up would have something to draw a row for.
jest.mock( '@wordpress/api-fetch', () =>
	jest.fn( () =>
		Promise.resolve( [
			{ id: 'x/seo', label: 'SEO check', enabled: true, meta: {} },
			{
				id: 'x/readability',
				label: 'Readability',
				enabled: true,
				meta: {},
			},
		] )
	)
);
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { TransitionRail } from '../../src/editor/components/TransitionRail';

/**
 * Render the rail at a stage with the given transitions.
 *
 * @param {Array} transitions The transitions payload.
 */
function renderRail( transitions ) {
	render(
		<TransitionRail
			current={ { key: 'offer', label: 'Offer' } }
			transitions={ transitions }
			allStatuses={ [] }
			agentPending={ false }
			agentLastRun={ null }
			transitioning={ false }
			transitioningTo={ null }
			onTransition={ () => {} }
		/>
	);
}

describe( 'TransitionRail required checks', () => {
	it( 'offers the move and no control for the tools it requires', () => {
		renderRail( [
			{
				to: 'hired',
				label: 'Hire',
				required_tools: [ 'x/seo', 'x/readability' ],
			},
		] );

		expect( screen.getAllByRole( 'button' ) ).toHaveLength( 1 );
		expect(
			screen.getByRole( 'button', { name: 'Hire' } )
		).not.toHaveAttribute( 'aria-disabled', 'true' );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'shows the lock a switched-off required tool puts on its transition', () => {
		renderRail( [
			{
				to: 'hired',
				label: 'Hire',
				required_tools: [ 'x/seo' ],
				_locked: true,
				_locked_reason: 'Required checks are switched off: x/seo',
			},
		] );

		expect(
			screen.getByRole( 'button', { name: 'Hire' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Required checks are switched off: x/seo' )
		).toBeVisible();
	} );
} );
