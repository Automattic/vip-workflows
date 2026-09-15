/**
 * Held publication routes use the sequence setting in both inspector panels.
 *
 * @package
 */

import { render, within } from './helpers/render-wp-component';
import Inspector from '../../src/admin/components/graph/Inspector';

function renderInspector(
	routing = { pass: 'published' },
	selection = 'edge'
) {
	const stage = {
		key: 'review',
		label: 'Review',
		status: 'pending',
		agent: { ability_id: 'test/review', routing },
		transitions: [ { to: 'published', label: 'Approve' } ],
	};
	const props = {
		selection:
			selection === 'node'
				? { type: 'node', key: stage.key }
				: {
						type: 'edge',
						from: stage.key,
						to: 'published',
						outcome: 'pass',
				  },
		isPhase: false,
		stages: [
			stage,
			{ key: 'published', label: 'Published', status: 'publish' },
		],
		selectedStage: stage,
		selectedTransition: stage.transitions[ 0 ],
		availableAgents: [],
		availableRoles: [],
		availableTools: [],
		availableChannels: [],
		onUpdateStage: () => {},
		onDeleteStage: () => {},
		onUpdateTransition: () => {},
		onDeleteTransition: () => {},
	};
	const panel = ( allow ) => (
		<Inspector
			{ ...props }
			sequenceSettings={ { settings: { allow_agent_publish: allow } } }
		/>
	);
	const view = render( panel( false ) );
	return {
		...within( view.container ),
		setPublish: ( allow ) => view.rerender( panel( allow ) ),
	};
}

describe( 'Inspector held publication routes', () => {
	it( 'updates the selected pass route when publication is enabled', () => {
		const panel = renderInspector();
		expect( panel.getByText( 'On pass · Disabled' ) ).toBeInTheDocument();
		expect(
			panel.getByText( /This transition is disabled\./ )
		).toHaveTextContent(
			'turning on “Let AI stages publish” in the sequence settings makes it live again'
		);

		// Imported truthy strings must not waive the runtime's strict opt-in.
		panel.setPublish( 'true' );
		expect( panel.getByText( 'On pass · Disabled' ) ).toBeInTheDocument();
		panel.setPublish( true );
		expect( panel.getByText( 'On pass' ) ).toBeInTheDocument();
		expect(
			panel.queryByText( /This transition is disabled\./ )
		).not.toBeInTheDocument();
	} );

	it( 'warns about failed runs when pass shares the held destination', () => {
		const panel = renderInspector( {
			pass: 'published',
			fail: 'published',
		} );
		expect(
			panel.getByText( 'On pass, On fail · Disabled' )
		).toBeInTheDocument();
		const warning = panel.getByText( /This transition is disabled\./ );
		expect( warning ).toHaveTextContent( 'would publish failed runs too' );
		expect( warning ).not.toHaveTextContent( 'makes it live again' );
	} );

	it( 'updates the selected stage’s route status with the same setting', () => {
		const panel = renderInspector( { pass: 'published' }, 'node' );
		expect( panel.getByText( 'Published (disabled)' ) ).toBeInTheDocument();
		panel.setPublish( true );
		expect(
			panel.queryByText( 'Published (disabled)' )
		).not.toBeInTheDocument();
		expect( panel.getByText( 'Published' ) ).toBeInTheDocument();
	} );
} );
