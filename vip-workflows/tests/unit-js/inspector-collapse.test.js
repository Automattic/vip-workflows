/**
 * Unit tests for the inspector panel's collapse.
 *
 * The panel collapses to its header bar: the body hides and the card goes on
 * naming what's selected. Two things make this worth pinning:
 *
 *   1. The flag lives in `Inspector`, not `InspectorShell`. The shell unmounts
 *      whenever the selection swaps one panel for another, so state held there
 *      would spring back open on every click.
 *   2. The body is hidden rather than unmounted, so the options keep their own
 *      state (an expanded "Advanced" section is still expanded on the way back).
 *
 * The header now holds nothing but the toggle — the panel's destructive control
 * ends its body — so collapsing puts Delete out of reach along with everything
 * else, which is the behaviour asserted below.
 *
 * @package
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';
import { body, renderInspector, toggle } from './helpers/inspector-fixture';

import InspectorShell from '../../src/admin/components/graph/InspectorShell';

describe( 'Inspector collapse', () => {
	it( 'starts open, with the options visible', () => {
		renderInspector();

		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( body() ).not.toHaveAttribute( 'hidden' );
		expect(
			screen.getByRole( 'textbox', { name: 'Label' } )
		).toBeInTheDocument();
	} );

	it( 'collapses to the header bar, keeping the title but not the options', () => {
		renderInspector();

		fireEvent.click( toggle() );

		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( body() ).toHaveAttribute( 'hidden' );
		// The bar still says what is selected. Matched on the heading, not the
		// text: the hidden body still holds "Draft" in the Label field.
		expect(
			screen.getByRole( 'heading', { name: 'Draft' } )
		).toBeInTheDocument();
		// Delete goes with the body it now ends — still mounted, so its state
		// survives the round trip, but no longer offered on a bar that has no
		// fields left to explain what it would destroy.
		expect(
			screen.getByRole( 'button', {
				name: /Delete stage/,
				hidden: true,
			} )
		).not.toBeVisible();
	} );

	it( 'points the toggle the other way once collapsed', () => {
		renderInspector();

		expect( toggle() ).toHaveAccessibleName( 'Collapse panel' );
		fireEvent.click( toggle() );
		expect( toggle() ).toHaveAccessibleName( 'Expand panel' );
	} );

	it( 'stays collapsed when the selection changes panel', () => {
		const { update } = renderInspector();
		fireEvent.click( toggle() );

		// Node → nothing selected: a different panel component entirely, so the
		// shell unmounts. The flag lives above it and has to survive.
		update( { selection: null, selectedStage: null } );

		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'false' );
		expect(
			screen.getByRole( 'heading', { name: 'Editorial Review' } )
		).toBeInTheDocument();
	} );

	it( 'keeps the options mounted while collapsed, so their state survives', () => {
		renderInspector();

		// Open a disclosure, collapse the panel, expand it again.
		fireEvent.click( screen.getByRole( 'button', { name: /Advanced/i } ) );
		expect(
			screen.getByRole( 'button', { name: /Advanced/i } )
		).toHaveAttribute( 'aria-expanded', 'true' );

		fireEvent.click( toggle() );
		fireEvent.click( toggle() );

		expect(
			screen.getByRole( 'button', { name: /Advanced/i } )
		).toHaveAttribute( 'aria-expanded', 'true' );
	} );
} );

describe( 'InspectorShell without a collapse provider', () => {
	it( 'renders no toggle at all', () => {
		render(
			<InspectorShell eyebrow="Stage" title="Draft">
				<p>Options</p>
			</InspectorShell>
		);

		expect(
			screen.queryByRole( 'button', {
				name: /Collapse panel|Expand panel/,
			} )
		).not.toBeInTheDocument();
		expect( screen.getByText( 'Options' ) ).toBeInTheDocument();
	} );
} );
