/**
 * Unit tests for the status-region inspector's remove action.
 *
 * The button spends most of its life disabled — a region with stages in it, or
 * Draft, can't be removed — so the explanation of *why* is the part that
 * matters. It is said in place, under the button, and wired as its accessible
 * description; a plainly `disabled` button leaves the tab order and takes that
 * description with it, so the one state that needs explaining would be the one
 * state nobody could reach to hear it. `accessibleWhenDisabled` is what keeps
 * it focusable.
 *
 * The button now sits at the foot of the panel body rather than in its header,
 * and carries its label as text rather than as a tooltip — see
 * `InspectorDangerZone`.
 *
 * @package
 */

import { render, screen } from './helpers/render-wp-component';

import RegionInspector from '../../src/admin/components/graph/RegionInspector';

const STAGES = [ { key: 'draft', label: 'Draft' } ];

/**
 * Render the inspector for a region.
 *
 * @param {boolean} canRemove Whether the region may be removed.
 * @return {HTMLElement} The remove button.
 */
function renderInspector( canRemove ) {
	render(
		<RegionInspector
			region="pending"
			stages={ STAGES }
			entryKey="draft"
			onSetEntry={ () => {} }
			onRemove={ () => {} }
			canRemove={ canRemove }
		/>
	);
	return screen.getByRole( 'button', { name: 'Remove this status' } );
}

describe( 'RegionInspector remove action', () => {
	it( 'stays in the tab order while disabled', () => {
		const button = renderInspector( false );

		expect( button ).not.toBeDisabled();
		expect( button ).toHaveAttribute( 'aria-disabled', 'true' );
		button.focus();
		expect( button ).toHaveFocus();
	} );

	it( 'carries the reason it is disabled as its description', () => {
		const button = renderInspector( false );

		expect( button ).toHaveAccessibleDescription(
			/Only a status with no stages can be removed/
		);
	} );

	it( 'says the reason in place, not only on hover', () => {
		renderInspector( false );

		// A tooltip is unreachable by touch and needs a hover to read at all;
		// the reason a control is dead should not be the hardest thing on the
		// panel to find out.
		expect(
			screen.getByText( /Only a status with no stages can be removed/ )
		).toBeVisible();
	} );

	it( 'names itself in text rather than in a tooltip', () => {
		const button = renderInspector( true );

		expect( button ).toHaveTextContent( 'Remove this status' );
	} );

	it( 'is a plain enabled button when the region can be removed', () => {
		const button = renderInspector( true );

		expect( button ).not.toBeDisabled();
		expect( button ).not.toHaveAttribute( 'aria-disabled' );
	} );
} );
