/**
 * What a transition captures, as a list rather than a single input.
 *
 * A transition used to capture exactly one thing, chosen from a three-way select
 * whose first option — "None" — was the absence of an input wearing the costume
 * of a choice. It now captures any number, held in `inputs`, added from the
 * section's own header and configured one at a time.
 *
 * Notes are unbounded. Assignments are capped at one, because the assignment is
 * the slot `requires_assignment` gates on and the one AssignmentManager fills,
 * so a second names nothing distinguishable. The write gate refuses a config
 * carrying two; these cover the half of that promise the author actually meets —
 * an add menu that will not let them reach it.
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { render, screen, fireEvent, act } from './helpers/render-wp-component';

import TransitionInspector from '../../src/admin/components/graph/TransitionInspector';

const ROLES = [ { slug: 'editor', name: 'Editor' } ];

function renderInspector( transition, onChange = () => {} ) {
	render(
		<TransitionInspector
			transition={ transition }
			sourceLabel="Draft"
			targetLabel="Review"
			availableRoles={ ROLES }
			availableTools={ [] }
			availableChannels={ [] }
			onChange={ onChange }
			onRemove={ () => {} }
		/>
	);
}

const note = ( noteName, id = 'n1' ) => ( {
	type: 'textarea',
	note_id: id,
	note_name: noteName,
	meta_key: `wfp_${ id }_${ noteName.toLowerCase() }`,
} );

const addControl = () => screen.getByRole( 'button', { name: 'Add an input' } );

async function openAddMenu() {
	await act( async () => {
		fireEvent.click( addControl() );
	} );
}

describe( 'Transition capture inputs', () => {
	it( 'says the transition captures nothing, rather than offering a "None" type', () => {
		renderInspector( { to: 'review' } );

		expect(
			screen.getByText( /This transition captures nothing/ )
		).toBeInTheDocument();
		expect( screen.queryByLabelText( 'Input type' ) ).toBeNull();
	} );

	it( 'lists every input it captures, in the authored order', () => {
		renderInspector( {
			to: 'review',
			inputs: [ note( 'Why', 'n1' ), note( 'What changed', 'n2' ) ],
		} );

		const rows = screen
			.getAllByRole( 'button', { name: /^Configure / } )
			.map( ( button ) => button.textContent );

		expect( rows ).toHaveLength( 2 );
		expect( rows[ 0 ] ).toContain( 'Why' );
		expect( rows[ 1 ] ).toContain( 'What changed' );
	} );

	it( 'counts them on the closed section, since it can no longer name one', () => {
		renderInspector( {
			to: 'review',
			inputs: [ note( 'Why', 'n1' ), note( 'What changed', 'n2' ) ],
		} );

		expect( screen.getByText( '2 inputs' ) ).toBeInTheDocument();
	} );

	it( 'appends a note with an id of its own, so its key is stable from birth', async () => {
		const onChange = jest.fn();
		renderInspector(
			{ to: 'review', inputs: [ note( 'Why' ) ] },
			onChange
		);

		await openAddMenu();
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'menuitem', { name: 'Text area' } )
			);
		} );

		const next = onChange.mock.calls[ 0 ][ 0 ].inputs;

		expect( next ).toHaveLength( 2 );
		expect( next[ 1 ].type ).toBe( 'textarea' );
		expect( next[ 1 ].note_id ).toEqual( expect.any( String ) );
		expect( next[ 1 ].note_id ).not.toBe( next[ 0 ].note_id );
	} );

	it( 'offers an assignment while the transition has none', async () => {
		renderInspector( { to: 'review', inputs: [ note( 'Why' ) ] } );

		await openAddMenu();

		expect(
			screen.getByRole( 'menuitem', { name: 'Assignment' } )
		).toBeEnabled();
	} );

	it( 'caps assignments at one — offered but spoken for, never withdrawn', async () => {
		const onChange = jest.fn();
		renderInspector(
			{
				to: 'review',
				inputs: [
					note( 'Why' ),
					{ type: 'assignment', meta_key: 'legal_reviewer' },
				],
			},
			onChange
		);

		await openAddMenu();

		// Still listed, so the menu does not silently lose an entry. Marked
		// `aria-disabled` rather than `disabled` — it stays focusable, so a
		// keyboard user meets the entry and hears that it is spoken for instead
		// of tabbing straight past a gap.
		const assignment = screen.getByRole( 'menuitem', {
			name: 'Assignment',
		} );
		expect( assignment ).toHaveAttribute( 'aria-disabled', 'true' );

		// And it is inert, so the author cannot reach the shape the write gate
		// refuses.
		await act( async () => {
			fireEvent.click( assignment );
		} );
		expect( onChange ).not.toHaveBeenCalled();

		// Notes stay unbounded alongside it.
		expect(
			screen.getByRole( 'menuitem', { name: 'Text area' } )
		).not.toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'removes the input the row belongs to, leaving the rest in order', async () => {
		const onChange = jest.fn();
		renderInspector(
			{
				to: 'review',
				inputs: [
					note( 'Why', 'n1' ),
					note( 'What changed', 'n2' ),
					note( 'Who checked', 'n3' ),
				],
			},
			onChange
		);

		await act( async () => {
			fireEvent.click(
				screen.getAllByRole( 'button', { name: 'Remove input' } )[ 1 ]
			);
		} );

		expect( onChange ).toHaveBeenCalledWith( {
			inputs: [ note( 'Why', 'n1' ), note( 'Who checked', 'n3' ) ],
		} );
	} );

	it( 'mints an id for a note that arrived without one', async () => {
		// A note written by an import or an ability need not carry `note_id`,
		// and the key is derived from it. Without a mint here the transition
		// stores `wfp_undefined_…` and the runtime dead-ends on the missing id.
		const onChange = jest.fn();
		renderInspector(
			{ to: 'review', inputs: [ { type: 'textarea' } ] },
			onChange
		);

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Configure Untitled' } )
			);
		} );

		fireEvent.change(
			screen.getByRole( 'textbox', { name: 'Note name' } ),
			{
				target: { value: 'Review notes' },
			}
		);

		const [ input ] = onChange.mock.calls[ 0 ][ 0 ].inputs;
		expect( input.note_id ).toBeTruthy();
		expect( input.meta_key ).toBe( `wfp_${ input.note_id }_review_notes` );
		expect( input.meta_key ).not.toContain( 'undefined' );
	} );

	it( 'flags a fresh assignment as needing a key, since Save is already blocked', async () => {
		// An assignment's key is typed rather than derived, and
		// `validateSequence` refuses the save the moment one exists without a
		// key. A row that stayed quiet would leave Save switched off with
		// nothing on the list to point at.
		renderInspector( {
			to: 'review',
			inputs: [ { type: 'assignment', assignee_type: 'user' } ],
		} );

		expect( screen.getByText( 'Needs a key' ) ).toBeInTheDocument();
	} );

	it( 'derives a note key from the id and the name, the way the runtime rebuilds it', async () => {
		const onChange = jest.fn();
		renderInspector(
			{ to: 'review', inputs: [ { type: 'textarea', note_id: 'n1' } ] },
			onChange
		);

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Configure Untitled' } )
			);
		} );

		fireEvent.change(
			screen.getByRole( 'textbox', { name: 'Note name' } ),
			{
				target: { value: 'Review notes' },
			}
		);

		expect( onChange ).toHaveBeenCalledWith( {
			inputs: [
				{
					type: 'textarea',
					note_id: 'n1',
					note_name: 'Review notes',
					meta_key: 'wfp_n1_review_notes',
				},
			],
		} );
	} );

	// A note's storage key is derived from its name, so anything keyed on the
	// item's own content changes on every keystroke. When the row's React key
	// was one of those, naming a note remounted the row and shut the popover the
	// name was being typed into — after a single character. This needs the
	// controlled round trip to reproduce: the remount is caused by the edited
	// item coming back down as a prop.
	it( 'keeps the popover open while the note being named is typed into', async () => {
		function Harness() {
			const [ transition, setTransition ] = useState( {
				to: 'review',
				inputs: [ note( 'Why' ) ],
			} );

			return (
				<TransitionInspector
					transition={ transition }
					sourceLabel="Draft"
					targetLabel="Review"
					availableRoles={ ROLES }
					availableTools={ [] }
					availableChannels={ [] }
					onChange={ ( changes ) =>
						setTransition( ( prev ) => ( {
							...prev,
							...changes,
						} ) )
					}
					onRemove={ () => {} }
				/>
			);
		}

		render( <Harness /> );

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Configure Why' } )
			);
		} );

		await act( async () => {
			fireEvent.change(
				screen.getByRole( 'textbox', { name: 'Note name' } ),
				{ target: { value: 'Whyy' } }
			);
		} );

		expect(
			screen.getByRole( 'textbox', { name: 'Note name' } )
		).toHaveValue( 'Whyy' );
	} );
} );
