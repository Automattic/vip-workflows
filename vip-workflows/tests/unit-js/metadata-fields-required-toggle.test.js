/**
 * The Required toggle on a sequence's metadata fields.
 *
 * Required fields are checked at one moment only: a transition that crosses
 * into the publish region (`Sequence::crosses_into_publish()`). A sequence with
 * no such transition never reaches that moment, so the toggle there is
 * disabled and says why, rather than accepting a promise nothing keeps. On a
 * sequence that has one, its help says when the value is due. Which edges
 * count is `transitionsIntoPublish()`, tested in graph-model.test.js.
 *
 * A field already stored as required on a sequence with no transition into
 * publish reads back as on, because that is what is stored, and stays
 * switchable so the author can clear it. Nothing rewrites it for them.
 *
 * @package
 */

import { useState } from '@wordpress/element';

import { render, screen, fireEvent, act } from './helpers/render-wp-component';

import MetadataFieldsEditor from '../../src/admin/components/graph/MetadataFieldsEditor';

const ENABLED_HELP =
	'Must have a value before a transition moves the post into Published.';
const DISABLED_HELP =
	'Only checked on transitions into Published, and this sequence has none.';
const STORED_HELP =
	'Never checked, because no transition here leads into Published.';

async function openField( label ) {
	// Popover settles its position after mount, so the open has to be awaited
	// or the update lands outside the test's act().
	await act( async () => {
		fireEvent.click(
			screen.getByRole( 'button', { name: `Configure ${ label }` } )
		);
	} );
}

function requiredToggle() {
	return screen.getByRole( 'checkbox', { name: 'Required' } );
}

function helpFor( control ) {
	const id = control.getAttribute( 'aria-describedby' );
	return id ? document.getElementById( id )?.textContent : null;
}

describe( 'MetadataFieldsEditor Required toggle', () => {
	it( 'is live on a sequence with a transition into publish, and says the deadline', async () => {
		const onChange = jest.fn();
		render(
			<MetadataFieldsEditor
				fields={ [ { key: 'desk', label: 'Desk', type: 'text' } ] }
				onChange={ onChange }
				hasTransitionIntoPublish
			/>
		);
		await openField( 'Desk' );

		const toggle = requiredToggle();
		expect( toggle ).toBeEnabled();
		expect( toggle ).not.toBeChecked();
		expect( helpFor( toggle ) ).toBe( ENABLED_HELP );

		await act( async () => {
			fireEvent.click( toggle );
		} );
		expect( onChange ).toHaveBeenCalledWith( [
			expect.objectContaining( { key: 'desk', required: true } ),
		] );
	} );

	it( 'is disabled on a sequence with no transition into publish, and says why', async () => {
		render(
			<MetadataFieldsEditor
				fields={ [ { key: 'desk', label: 'Desk', type: 'text' } ] }
				onChange={ () => {} }
				hasTransitionIntoPublish={ false }
			/>
		);
		await openField( 'Desk' );

		const toggle = requiredToggle();
		expect( toggle ).toBeDisabled();
		expect( toggle ).not.toBeChecked();
		// The reason is tied to the control, so a screen reader reaches it
		// even though the toggle cannot be focused.
		expect( helpFor( toggle ) ).toBe( DISABLED_HELP );
		expect( screen.queryByText( ENABLED_HELP ) ).toBeNull();
	} );

	it( 'shows a stored required flag truthfully, and lets the author clear it', async () => {
		function Harness() {
			const [ fields, setFields ] = useState( [
				{ key: 'desk', label: 'Desk', type: 'text', required: true },
			] );
			return (
				<MetadataFieldsEditor
					fields={ fields }
					onChange={ setFields }
					hasTransitionIntoPublish={ false }
				/>
			);
		}
		render( <Harness /> );
		await openField( 'Desk' );

		const toggle = requiredToggle();
		expect( toggle ).toBeChecked();
		expect( toggle ).toBeEnabled();
		expect( helpFor( toggle ) ).toBe( STORED_HELP );

		await act( async () => {
			fireEvent.click( toggle );
		} );

		// Off now, and like every other field on a sequence with no
		// transition into publish, it cannot be turned back on.
		expect( requiredToggle() ).not.toBeChecked();
		expect( requiredToggle() ).toBeDisabled();
		expect( helpFor( requiredToggle() ) ).toBe( DISABLED_HELP );
	} );

	it.each( [ true, false ] )(
		'leaves Searchable alone either way (hasTransitionIntoPublish: %s)',
		async ( publishes ) => {
			render(
				<MetadataFieldsEditor
					fields={ [ { key: 'desk', label: 'Desk', type: 'text' } ] }
					onChange={ () => {} }
					hasTransitionIntoPublish={ publishes }
				/>
			);
			await openField( 'Desk' );

			expect(
				screen.getByRole( 'checkbox', { name: 'Searchable' } )
			).toBeEnabled();
		}
	);
} );
