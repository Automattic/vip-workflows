/**
 * Saying that a transition is shared by more than one agent outcome.
 *
 * An AI stage can route two of its outcomes to the same destination, and a
 * stage holds at most one transition per target — so both routes stand on one
 * record. The canvas draws an edge per outcome and each opens this panel, which
 * means each panel is the same one: a required tool typed into it arms every
 * outcome sharing the record, not the edge that was clicked.
 *
 * The panel therefore says so before the fields it changes the meaning of, and
 * names the whole set in the eyebrow rather than the one outcome that happened
 * to be selected.
 *
 * @package
 */

import { render, within } from './helpers/render-wp-component';
import TransitionInspector from '../../src/admin/components/graph/TransitionInspector';

/**
 * Render the inspector for a transition out of an AI stage.
 *
 * Queries are scoped to the render's own container rather than `screen`:
 * `<Notice>` announces itself through `speak()`, which parks a copy of the text
 * in the document-level `a11y-speak` live region — and that region outlives the
 * render, so a document-wide query matches both this panel and the last one.
 *
 * @param {Object} extra Props overriding the defaults.
 * @return {Object} Queries scoped to the rendered panel.
 */
function renderInspector( extra = {} ) {
	const { container } = render(
		<TransitionInspector
			transition={ { to: 'published' } }
			sourceLabel="Review"
			targetLabel="Published"
			availableRoles={ [] }
			availableTools={ [] }
			availableChannels={ [] }
			onChange={ () => {} }
			onRemove={ () => {} }
			{ ...extra }
		/>
	);
	return within( container );
}

describe( 'TransitionInspector shared outcomes', () => {
	it( 'warns that everything below applies to every outcome on the record', () => {
		const panel = renderInspector( {
			outcome: 'pass',
			sharedOutcomes: [ 'pass', 'fail' ],
		} );

		const notice = panel.getByText( /all lead to Published/i );
		expect( notice ).toHaveTextContent( 'On pass, On fail' );
		expect( notice ).toHaveTextContent( /applies to all of them/i );
	} );

	it( 'names every outcome in the eyebrow, not just the one clicked', () => {
		// The edge that was clicked was fail's; the panel edits pass's too, so
		// leading with "On fail" would name a scope it does not have.
		const panel = renderInspector( {
			outcome: 'fail',
			sharedOutcomes: [ 'pass', 'fail' ],
		} );

		expect( panel.getByText( 'On pass, On fail' ) ).toBeInTheDocument();
		expect( panel.queryByText( 'On fail' ) ).not.toBeInTheDocument();
	} );

	it( 'says nothing of the sort for an outcome with a destination of its own', () => {
		const panel = renderInspector( {
			outcome: 'pass',
			sharedOutcomes: null,
		} );

		expect( panel.getByText( 'On pass' ) ).toBeInTheDocument();
		expect(
			panel.queryByText( /share one transition|all lead to/i )
		).not.toBeInTheDocument();
	} );

	it( 'leaves the removal a single route’s, because that is what it removes', () => {
		// Un-routing one outcome leaves the transition standing for whoever
		// else is on it, so the button must not read as deleting the shared
		// record.
		const panel = renderInspector( {
			outcome: 'pass',
			sharedOutcomes: [ 'pass', 'fail' ],
		} );

		expect(
			panel.getByRole( 'button', { name: /remove this route/i } )
		).toBeInTheDocument();
	} );
} );
