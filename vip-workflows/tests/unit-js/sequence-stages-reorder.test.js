/**
 * Reordering the stages list must not change where new posts start.
 *
 * The server puts a new post in the stage flagged `is_initial`, and in the first
 * stage of the array when none is flagged. The stages list in the sequence
 * settings panel saves its order as that array, so a reorder that dropped or
 * ignored the flag would quietly send new posts past the earlier stages.
 *
 * @package
 */

import { render } from './helpers/render-wp-component';

import SequenceSettingsInspector from '../../src/admin/components/graph/SequenceSettingsInspector';
import { entryStageKey } from '../../src/admin/components/graph/graph-model';

// Captured from each list's `DndContext` so a drop can be reported without
// dnd-kit's pointer maths, which needs a layout jsdom does not do. The stages
// list is the first sortable list the panel renders.
const mockDragEnds = [];

jest.mock( '@dnd-kit/core', () => {
	const actual = jest.requireActual( '@dnd-kit/core' );
	const { createElement } = jest.requireActual( '@wordpress/element' );

	return {
		...actual,
		DndContext: ( props ) => {
			mockDragEnds.push( props.onDragEnd );
			return createElement( actual.DndContext, props );
		},
	};
} );

const stage = ( key, label, extra = {} ) => ( {
	key,
	label,
	status: 'draft',
	transitions: [],
	...extra,
} );

function renderPanel( stages ) {
	const onStagesChange = jest.fn();
	mockDragEnds.length = 0;

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
			onDelete={ () => {} }
			deleting={ false }
			onAddStage={ () => {} }
			stages={ stages }
			onStagesChange={ onStagesChange }
			onRemoveStage={ () => {} }
			regions={ [ 'draft' ] }
			addableRegions={ [] }
			onAddRegion={ () => {} }
			onRemoveRegion={ () => {} }
			onSelectNode={ () => {} }
			onSelectRegion={ () => {} }
		/>
	);

	return { onStagesChange, dragEnd: mockDragEnds[ 0 ] };
}

describe( 'Stages list reorder', () => {
	it( 'keeps the flagged start stage when a later stage is dragged to the top', () => {
		const { onStagesChange, dragEnd } = renderPanel( [
			stage( 'draft', 'Draft', { region_entry: true, is_initial: true } ),
			stage( 'review', 'In review' ),
			stage( 'ready', 'Ready to publish' ),
		] );

		// "Ready to publish" dropped on the first row.
		dragEnd( { active: { id: '2' }, over: { id: '0' } } );

		const next = onStagesChange.mock.calls[ 0 ][ 0 ];
		expect( next.map( ( s ) => s.key ) ).toEqual( [
			'ready',
			'draft',
			'review',
		] );
		expect(
			next.filter( ( s ) => s.is_initial ).map( ( s ) => s.key )
		).toEqual( [ 'draft' ] );
	} );

	it( 'flags the start stage it had before the move when none was flagged', () => {
		// No checkpoint and no flag: Start rests on the first stage, and the
		// move must pin it there rather than hand it to the stage moved up.
		const { onStagesChange, dragEnd } = renderPanel( [
			stage( 'draft', 'Draft' ),
			stage( 'review', 'In review' ),
		] );

		dragEnd( { active: { id: '1' }, over: { id: '0' } } );

		const next = onStagesChange.mock.calls[ 0 ][ 0 ];
		expect( next[ 0 ].key ).toBe( 'review' );
		expect( entryStageKey( next ) ).toBe( 'draft' );
		expect( next.find( ( s ) => s.key === 'draft' ).is_initial ).toBe(
			true
		);
	} );
} );
