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

import Inspector from '../../src/admin/components/graph/Inspector';
import InspectorShell from '../../src/admin/components/graph/InspectorShell';

const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		status: 'draft',
		region_entry: true,
		transitions: [ { to: 'review', label: 'Submit' } ],
	},
	{ key: 'review', label: 'Review', status: 'pending', transitions: [] },
];

const SEQUENCE_SETTINGS = {
	name: 'Editorial Review',
	onNameChange: () => {},
	description: '',
	onDescriptionChange: () => {},
	isActive: true,
	onActiveChange: () => {},
	postTypes: [ { label: 'Posts', value: 'post' } ],
	selectedPostTypes: [ 'post' ],
	onTogglePostType: () => {},
	metadataFields: [],
	onMetadataChange: () => {},
	isNew: false,
	onDelete: () => {},
	deleting: false,
};

function renderInspector( overrides = {} ) {
	const props = {
		selection: { type: 'node', key: 'draft' },
		isPhase: false,
		stages: STAGES,
		selectedStage: STAGES[ 0 ],
		selectedTransition: null,
		availableAgents: [],
		availableRoles: [],
		availableTools: [],
		availableChannels: [],
		onUpdateStage: () => {},
		onDeleteStage: () => {},
		onUpdateTransition: () => {},
		onDeleteTransition: () => {},
		sequenceSettings: SEQUENCE_SETTINGS,
		...overrides,
	};
	const view = render( <Inspector { ...props } /> );
	return {
		...view,
		reselect: ( next ) =>
			view.rerender( <Inspector { ...props } { ...next } /> ),
	};
}

const toggle = () =>
	screen.getByRole( 'button', { name: /Collapse panel|Expand panel/ } );
const body = () => document.querySelector( '.wf-inspector__body' );

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
		const { reselect } = renderInspector();
		fireEvent.click( toggle() );

		// Node → nothing selected: a different panel component entirely, so the
		// shell unmounts. The flag lives above it and has to survive.
		reselect( { selection: null, selectedStage: null } );

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
