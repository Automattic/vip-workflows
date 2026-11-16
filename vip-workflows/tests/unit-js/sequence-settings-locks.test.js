/**
 * The sequence panel locks what the server would refuse to write.
 *
 * The server refuses to delete a sequence any post holds, and to remove a stage
 * posts sit at. The panel says so up front: Delete sequence is disabled with the
 * post count under it, and an occupied stage has no remove button in the Stages
 * list. An unknown count (null) locks nothing; the server still refuses.
 *
 * @package
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import SequenceSettingsInspector from '../../src/admin/components/graph/SequenceSettingsInspector';

const STAGES = [
	{ key: 'writing', label: 'Writing', status: 'draft', transitions: [] },
	{ key: 'legal', label: 'Legal', status: 'draft', transitions: [] },
];

function renderPanel( extra = {} ) {
	const onDelete = jest.fn();

	render(
		<SequenceSettingsInspector
			name="Editorial Review"
			onNameChange={ () => {} }
			description=""
			onDescriptionChange={ () => {} }
			isActive
			onActiveChange={ () => {} }
			postTypes={ [] }
			selectedPostTypes={ [] }
			onTogglePostType={ () => {} }
			settings={ {} }
			onSettingsChange={ () => {} }
			metadataFields={ [] }
			onMetadataChange={ () => {} }
			isNew={ false }
			onDelete={ onDelete }
			deleting={ false }
			onAddStage={ () => {} }
			stages={ STAGES }
			onStagesChange={ () => {} }
			onRemoveStage={ () => {} }
			regions={ [ 'draft' ] }
			addableRegions={ [] }
			onAddRegion={ () => {} }
			onRemoveRegion={ () => {} }
			onSelectNode={ () => {} }
			onSelectRegion={ () => {} }
			{ ...extra }
		/>
	);

	return { onDelete };
}

const deleteButton = () =>
	screen.getByRole( 'button', { name: /Delete sequence/i } );

describe( 'Delete sequence', () => {
	it( 'is disabled while posts hold the sequence, and says how many', () => {
		const { onDelete } = renderPanel( { postCount: 4 } );

		expect( deleteButton() ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText(
				'4 posts are in this sequence. Remove them from the workflow first.'
			)
		).toBeInTheDocument();
		fireEvent.click( deleteButton() );
		expect( onDelete ).not.toHaveBeenCalled();
	} );

	it( 'says it in the singular for one post', () => {
		renderPanel( { postCount: 1 } );

		expect(
			screen.getByText(
				'1 post is in this sequence. Remove it from the workflow first.'
			)
		).toBeInTheDocument();
	} );

	it( 'deletes as before when no post holds the sequence', () => {
		const { onDelete } = renderPanel( { postCount: 0 } );

		expect( deleteButton() ).not.toHaveAttribute( 'aria-disabled' );
		fireEvent.click( deleteButton() );
		expect( onDelete ).toHaveBeenCalled();
	} );

	it( 'locks nothing when the count is unknown', () => {
		const { onDelete } = renderPanel( { postCount: null } );

		fireEvent.click( deleteButton() );
		expect( onDelete ).toHaveBeenCalled();
	} );
} );

describe( 'Stages list', () => {
	it( 'offers no remove button on a stage posts sit at', () => {
		renderPanel( {
			stagePostCount: ( key ) => ( key === 'legal' ? 2 : 0 ),
		} );

		// One remove button, for Writing; Legal's is gone.
		expect(
			screen.getAllByRole( 'button', { name: 'Remove stage' } )
		).toHaveLength( 1 );
	} );
} );
