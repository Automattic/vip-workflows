/**
 * Unit tests for InspectorFieldList's row layout.
 *
 * Every list in the inspector is the same row, and the rows of every list have
 * to put their names and values on the same edges. A list nobody can reorder
 * has no grips, and a row nobody can remove has no trash button, so each holds
 * the room the missing control would take instead of closing up around it.
 *
 * @package
 */

import { render } from './helpers/render-wp-component';
import InspectorFieldList from '../../src/admin/components/graph/InspectorFieldList';

const ITEMS = [ { name: 'Draft' }, { name: 'Private' } ];

const renderList = ( props ) =>
	render(
		<InspectorFieldList
			items={ ITEMS }
			onChange={ () => {} }
			describe={ ( item ) => ( { label: item.name, value: '' } ) }
			removeLabel="Remove"
			emptyLabel="Nothing yet."
			{ ...props }
		/>
	);

describe( 'InspectorFieldList row layout', () => {
	it( 'holds a grip’s room on every row of a list that cannot be reordered', () => {
		const { container } = renderList( { sortable: false } );

		expect(
			container.querySelectorAll( '.wf-inspector__grip' )
		).toHaveLength( 0 );
		expect(
			container.querySelectorAll( '.wf-inspector__grip-spacer' )
		).toHaveLength( ITEMS.length );
	} );

	it( 'holds the remove button’s room on a row that cannot be removed', () => {
		const { container } = renderList( {
			sortable: false,
			canRemove: ( item ) => item.name === 'Private',
		} );

		const rows = container.querySelectorAll( '.wf-inspector__fact' );
		expect(
			rows[ 0 ].querySelector( '.wf-inspector__remove-spacer' )
		).not.toBeNull();
		expect(
			rows[ 1 ].querySelector( '.wf-inspector__remove-spacer' )
		).toBeNull();
	} );

	it( 'adds no spacer where the real control is there', () => {
		const { container } = renderList( {} );

		expect(
			container.querySelectorAll( '.wf-inspector__grip-spacer' )
		).toHaveLength( 0 );
		expect(
			container.querySelectorAll( '.wf-inspector__remove-spacer' )
		).toHaveLength( 0 );
	} );
} );
