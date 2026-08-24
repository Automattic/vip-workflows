/**
 * Duplicate metadata field keys, said inline.
 *
 * Two fields sharing a key is refused server-side
 * (`duplicate_metadata_field_key`, on create, update and import alike), so the
 * collision was only ever reported as a 400 after Save — with nothing on the
 * field that caused it. The editor flags the offending key as it is typed.
 *
 * It now has to say so twice, because the list and the field's options are no
 * longer the same surface: the row carries a short flag where its type would
 * otherwise read, so a closed list still shows which field is wrong, and the
 * full sentence sits on the Key control inside that field's popover, where the
 * fix is made. A report only the open popover carries would be invisible on a
 * list of ten fields; a report only the row carries would not say what to do.
 *
 * @package
 */

import { useState } from '@wordpress/element';

import { render, screen, fireEvent, act } from './helpers/render-wp-component';

import MetadataFieldsEditor from '../../src/admin/components/graph/MetadataFieldsEditor';

const DUPLICATE_ROW = 'Duplicate key';
const DUPLICATE_HELP = 'Another field already uses this key.';

function renderFields( fields ) {
	render( <MetadataFieldsEditor fields={ fields } onChange={ () => {} } /> );
}

describe( 'MetadataFieldsEditor duplicate keys', () => {
	it( 'says nothing while every key is its own', () => {
		renderFields( [
			{ key: 'content_pillar', label: 'Content pillar', type: 'text' },
			{ key: 'desk', label: 'Desk', type: 'text' },
		] );

		expect( screen.queryByText( DUPLICATE_ROW ) ).toBeNull();
	} );

	it( 'flags the row of the second field to claim a key', () => {
		renderFields( [
			{ key: 'content_pillar', label: 'Content pillar', type: 'text' },
			{ key: 'content_pillar', label: 'Pillar', type: 'text' },
		] );

		// One flag, on the later of the two — the earlier field is not the one
		// that has to change.
		expect( screen.getAllByText( DUPLICATE_ROW ) ).toHaveLength( 1 );

		// And it is the later field's row that carries it, named by its label.
		const flagged = screen.getByRole( 'button', {
			name: 'Configure Pillar',
		} );
		expect( flagged ).toHaveTextContent( DUPLICATE_ROW );
	} );

	it( 'repeats the whole sentence on the key field that has to change', async () => {
		renderFields( [
			{ key: 'content_pillar', label: 'Content pillar', type: 'text' },
			{ key: 'content_pillar', label: 'Pillar', type: 'text' },
		] );

		// Popover settles its position after mount, so the open has to be
		// awaited or the update lands outside the test's act().
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Configure Pillar' } )
			);
		} );

		const keyField = screen.getByRole( 'textbox', { name: 'Key' } );

		expect( keyField ).toHaveValue( 'content_pillar' );
		expect(
			keyField.closest( '.components-base-control' )
		).toHaveTextContent( DUPLICATE_HELP );
	} );

	it( 'leaves an unfilled key alone — a new field is not a collision', () => {
		renderFields( [
			{ key: '', label: '', type: 'text' },
			{ key: '', label: '', type: 'text' },
		] );

		expect( screen.queryByText( DUPLICATE_ROW ) ).toBeNull();
	} );
} );

/**
 * A row's identity is its position (`InspectorFieldList.sortId`), so an open
 * popover has to belong to the LIST rather than to the row it opened from —
 * otherwise removing a row above it hands the still-open dialog to whatever
 * item slid into that position, and the author edits a field they never opened.
 */
describe( 'InspectorFieldList configuration popover', () => {
	function Harness( { initial } ) {
		const [ fields, setFields ] = useState( initial );
		return (
			<MetadataFieldsEditor fields={ fields } onChange={ setFields } />
		);
	}

	it( 'shuts rather than retargeting when a row above it is removed', async () => {
		render(
			<Harness
				initial={ [
					{ key: 'one', label: 'One', type: 'text' },
					{ key: 'two', label: 'Two', type: 'text' },
				] }
			/>
		);

		// Popover settles its position after mount, so the open has to be
		// awaited or the update lands outside the test's act().
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Configure Two' } )
			);
		} );

		expect(
			screen.getByRole( 'dialog', { name: 'Two' } )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click(
				screen.getAllByRole( 'button', { name: 'Remove field' } )[ 0 ]
			);
		} );

		// Not "One's dialog is now Two's": the row that took position 0 must not
		// inherit an open popover, and the row that moved up must not inherit
		// the one that was open at position 1.
		expect( screen.queryByRole( 'dialog' ) ).toBeNull();
	} );
} );
