/**
 * Unit tests for WPDS toggle/selected-state conversions.
 *
 * Covers the canonical selected-state wiring via CheckModePill, the one
 * stateful conversion that is a pure, prop-driven component. The WPDS
 * follow-up pass replaced the hand-rolled aria-pressed Button pills with a
 * `ToggleGroupControl`, whose accessible contract is a radiogroup of radio
 * options (aria-checked), so these tests pin that contract. The other toggle
 * conversions that share this pattern — the ideation card detail-modal tabs
 * (Summary/Notes) and the MoodBoard dismissed-cards toggle — are gated behind
 * a @wordpress/components Modal / heavy prop+store wiring, so their
 * user-facing behavior is covered by the e2e suite
 * (tests/e2e/ideation-feature.spec.js) rather than re-mocked here. ToolsPanel's
 * show-more toggle is likewise editor-store-coupled and covered via e2e. This
 * unit pins the toggle primitive; e2e pins the coupled flows.
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import { CheckModePill } from '../../src/admin/components/SchemaSettings';

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'CheckModePill', () => {
	it( 'renders both modes as radio options in a labeled radiogroup', () => {
		render( <CheckModePill value="soft" onChange={ jest.fn() } /> );

		expect(
			screen.getByRole( 'radiogroup', {
				name: 'Check enforcement mode',
			} )
		).toBeInTheDocument();
		expect( screen.getAllByRole( 'radio' ) ).toHaveLength( 2 );
	} );

	it( 'reflects the "soft" selection in aria-checked', () => {
		render( <CheckModePill value="soft" onChange={ jest.fn() } /> );

		expect(
			screen.getByRole( 'radio', { name: /soft/i } )
		).toHaveAttribute( 'aria-checked', 'true' );
		expect(
			screen.getByRole( 'radio', { name: /hard/i } )
		).toHaveAttribute( 'aria-checked', 'false' );
	} );

	it( 'reflects the "hard" selection in aria-checked', () => {
		render( <CheckModePill value="hard" onChange={ jest.fn() } /> );

		expect(
			screen.getByRole( 'radio', { name: /hard/i } )
		).toHaveAttribute( 'aria-checked', 'true' );
		expect(
			screen.getByRole( 'radio', { name: /soft/i } )
		).toHaveAttribute( 'aria-checked', 'false' );
	} );

	it( 'disables both options when the pill is disabled', () => {
		// `disabled` has to reach the options: passing it to the group would
		// land it on the Ariakit radio-group <div>, where it does nothing.
		render(
			<CheckModePill value="soft" onChange={ jest.fn() } disabled />
		);

		for ( const option of screen.getAllByRole( 'radio' ) ) {
			expect( option ).toBeDisabled();
		}
	} );

	it( 'calls onChange with the clicked mode', () => {
		const onChange = jest.fn();
		render( <CheckModePill value="soft" onChange={ onChange } /> );

		fireEvent.click( screen.getByRole( 'radio', { name: /hard/i } ) );
		expect( onChange ).toHaveBeenCalledWith( 'hard' );

		fireEvent.click( screen.getByRole( 'radio', { name: /soft/i } ) );
		expect( onChange ).toHaveBeenCalledWith( 'soft' );
	} );
} );
