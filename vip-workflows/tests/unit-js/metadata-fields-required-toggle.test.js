/**
 * The Required toggle on a sequence's metadata fields.
 *
 * Required fields are checked at one moment only: a transition that crosses
 * into the publish region (`Sequence::crosses_into_publish()`). A sequence with
 * no publish-region stage never reaches that moment, so the toggle there is
 * disabled and says why, rather than accepting a promise nothing keeps. On a
 * sequence that does publish, its help says when the value is due.
 *
 * A field already stored as required on a sequence that never publishes reads
 * back as on, because that is what is stored, and stays switchable so the
 * author can clear it. Nothing rewrites it for them.
 *
 * @package
 */

import { useState } from '@wordpress/element';

import { render, screen, fireEvent, act } from './helpers/render-wp-component';

import MetadataFieldsEditor from '../../src/admin/components/graph/MetadataFieldsEditor';
import { hasPublishStage } from '../../src/admin/components/graph/regions';

const ENABLED_HELP = 'Must have a value before the post is published.';
const DISABLED_HELP = 'Only checked at publish, and no stage here publishes.';
const STORED_HELP = 'Never checked, because no stage here publishes.';

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
	it( 'is live on a sequence with a publish stage, and says the deadline', async () => {
		const onChange = jest.fn();
		render(
			<MetadataFieldsEditor
				fields={ [ { key: 'desk', label: 'Desk', type: 'text' } ] }
				onChange={ onChange }
				hasPublishStage
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

	it( 'is disabled on a sequence with no publish stage, and says why', async () => {
		render(
			<MetadataFieldsEditor
				fields={ [ { key: 'desk', label: 'Desk', type: 'text' } ] }
				onChange={ () => {} }
				hasPublishStage={ false }
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
					hasPublishStage={ false }
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

		// Off now, and like every other field on a sequence that never
		// publishes, it cannot be turned back on.
		expect( requiredToggle() ).not.toBeChecked();
		expect( requiredToggle() ).toBeDisabled();
		expect( helpFor( requiredToggle() ) ).toBe( DISABLED_HELP );
	} );

	it( 'leaves Searchable alone either way', async () => {
		render(
			<MetadataFieldsEditor
				fields={ [ { key: 'desk', label: 'Desk', type: 'text' } ] }
				onChange={ () => {} }
				hasPublishStage={ false }
			/>
		);
		await openField( 'Desk' );

		expect(
			screen.getByRole( 'checkbox', { name: 'Searchable' } )
		).toBeEnabled();
	} );
} );

describe( 'hasPublishStage', () => {
	it( 'is true when any stage sits in publish', () => {
		expect(
			hasPublishStage( [
				{ key: 'draft', status: 'draft' },
				{ key: 'live', status: 'publish' },
			] )
		).toBe( true );
	} );

	it( 'is false for a sequence of drafts, including stages with no status', () => {
		expect(
			hasPublishStage( [
				{ key: 'idea', status: 'draft' },
				{ key: 'review', status: 'pending' },
				{ key: 'unset' },
			] )
		).toBe( false );
	} );

	it( 'is false for no stages at all', () => {
		expect( hasPublishStage( [] ) ).toBe( false );
	} );
} );
