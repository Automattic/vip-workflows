/**
 * Unit tests for the sequence panel's "Post statuses" group.
 *
 * Adding a status region used to have exactly one door: right-click the canvas.
 * That is a gesture nothing on the canvas advertises and that a keyboard reaches
 * only through Shift+F10, so the verb was effectively unfindable — a reviewer
 * who knew the feature existed still spent minutes looking for it. This group is
 * its second, visible home, so what these tests pin is findability: the statuses
 * are named where sequence-level settings live, and the Add beside them is a
 * real control rather than an icon that only means something on hover.
 *
 * Removing a status is deliberately NOT here — it lives on the region's own
 * panel (`RegionInspector`, covered by `region-inspector.test.js`), which is
 * what a single status is.
 *
 * @package
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import SequenceSettingsInspector from '../../src/admin/components/graph/SequenceSettingsInspector';

const ALL_STATUSES = [
	{ region: 'draft', stageCount: 2 },
	{ region: 'pending', stageCount: 1 },
	{ region: 'private', stageCount: 1 },
	{ region: 'publish', stageCount: 1 },
];

/**
 * Render the sequence panel.
 *
 * @param {Object} overrides Props to vary for the case under test.
 * @return {Object} The mock handed to `onAddRegion`.
 */
function renderPanel( overrides = {} ) {
	const onAddRegion = jest.fn();

	render(
		<SequenceSettingsInspector
			name="Editorial Review"
			onNameChange={ () => {} }
			description=""
			onDescriptionChange={ () => {} }
			isActive
			onActiveChange={ () => {} }
			postTypes={ [ { label: 'Posts', value: 'post' } ] }
			selectedPostTypes={ [ 'post' ] }
			onTogglePostType={ () => {} }
			regions={ [
				{ region: 'draft', stageCount: 2 },
				{ region: 'publish', stageCount: 1 },
			] }
			canAddRegion
			onAddRegion={ onAddRegion }
			settings={ {} }
			onSettingsChange={ () => {} }
			metadataFields={ [] }
			onMetadataChange={ () => {} }
			isNew={ false }
			onDelete={ () => {} }
			deleting={ false }
			{ ...overrides }
		/>
	);

	return onAddRegion;
}

const addButton = () => screen.getByRole( 'button', { name: /post status/i } );

describe( 'Sequence panel — post statuses', () => {
	it( 'names the group, so the verb is findable without being told', () => {
		renderPanel();

		expect(
			screen.getByRole( 'heading', { name: 'Post statuses' } )
		).toBeVisible();
	} );

	it( 'lists the statuses the sequence writes, with what each holds', () => {
		renderPanel();

		expect( screen.getByText( 'Draft' ) ).toBeVisible();
		expect( screen.getByText( '2 stages' ) ).toBeVisible();
		expect( screen.getByText( 'Published' ) ).toBeVisible();
		expect( screen.getByText( '1 stage' ) ).toBeVisible();
	} );

	it( 'reports a status nothing has been dragged into yet', () => {
		// The count is what tells scaffolding from a saved status: a section
		// still holding no stage is the one a reload forgets.
		renderPanel( {
			regions: [
				{ region: 'draft', stageCount: 1 },
				{ region: 'pending', stageCount: 0 },
			],
		} );

		expect( screen.getByText( 'Pending Review' ) ).toBeVisible();
		expect( screen.getByText( '0 stages' ) ).toBeVisible();
	} );

	it( 'says an added status is scaffolding until a stage lives there', () => {
		renderPanel();

		expect(
			screen.getByText( /it is scaffolding until a stage lives there/ )
		).toBeVisible();
	} );

	it( 'opens the dialog from the group rather than the canvas menu', () => {
		const onAddRegion = renderPanel();

		fireEvent.click( addButton() );

		expect( onAddRegion ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'goes dead once every status is already on the canvas', () => {
		const onAddRegion = renderPanel( {
			regions: ALL_STATUSES,
			canAddRegion: false,
		} );

		fireEvent.click( addButton() );

		expect( onAddRegion ).not.toHaveBeenCalled();
	} );

	it( 'stays in the tab order while dead, and says why it is', () => {
		// `disabled` would take the control out of the tab order and its name
		// with it, leaving the one state that needs explaining as the one
		// nobody can reach to hear — the bargain `InspectorDangerZone` strikes
		// with its own explanation.
		renderPanel( { regions: ALL_STATUSES, canAddRegion: false } );

		const button = screen.getByRole( 'button', {
			name: 'Every post status is already on the canvas',
		} );

		expect( button ).not.toBeDisabled();
		expect( button ).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'names itself plainly while there is something to add', () => {
		renderPanel();

		const button = screen.getByRole( 'button', {
			name: 'Add post status',
		} );

		expect( button ).not.toHaveAttribute( 'aria-disabled' );
	} );
} );
