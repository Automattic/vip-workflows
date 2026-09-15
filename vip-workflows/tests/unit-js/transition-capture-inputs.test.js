/**
 * What a transition captures: an assignment, and nothing else.
 *
 * A transition used to capture a list of inputs of two kinds — free-text notes
 * and an assignment. Notes are no longer collected, so the section is
 * "Assignments" and adds only that. A note a stored sequence still carries stays
 * on the list, so the author can see and remove it, but says it does nothing.
 *
 * Assignments are capped at one, the one slot the editor collects an assignee
 * for when the transition is taken. The write gate refuses a config carrying
 * two; these cover the half of that promise the author actually meets — an Add
 * control that is gone once the transition has its assignment.
 *
 * @package
 */

import {
	render,
	screen,
	fireEvent,
	act,
	within,
} from './helpers/render-wp-component';

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

const assignment = () => ( {
	type: 'assignment',
	assignee_type: 'user',
	label: 'Pick a reviewer',
	meta_key: 'wfp_n1abcde',
} );

const addControl = () =>
	screen.queryByRole( 'button', { name: 'Add an assignment' } );

describe( 'Transition assignments', () => {
	it( 'says the transition assigns nothing when it has no assignment', () => {
		renderInspector( { to: 'review' } );

		expect(
			screen.getByText( /This transition assigns nothing/ )
		).toBeInTheDocument();
	} );

	it( 'mints a new assignment its key, so nobody is asked to type one', async () => {
		const onChange = jest.fn();
		renderInspector( { to: 'review' }, onChange );

		// One kind to add, so one button rather than a menu of one.
		await act( async () => {
			fireEvent.click( addControl() );
		} );

		const [ added ] = onChange.mock.calls[ 0 ][ 0 ].inputs;

		expect( added.type ).toBe( 'assignment' );
		expect( added.meta_key ).toMatch( /^wfp_n\d+[a-z0-9]+$/ );
	} );

	it( 'offers no way to restrict the transition to an assignee', () => {
		renderInspector( { to: 'review', inputs: [ assignment() ] } );

		expect( screen.queryByText( 'Restrict to an assignee' ) ).toBeNull();
		// `hidden`, because the toggle lived in a section that renders
		// collapsed for this transition — a default query would skip it there
		// and pass whether or not it still existed.
		expect(
			screen.queryByRole( 'checkbox', {
				name: 'Requires assignment',
				hidden: true,
			} )
		).toBeNull();
	} );

	it( 'caps assignments at one — nothing left to add once it has one', () => {
		renderInspector( { to: 'review', inputs: [ assignment() ] } );

		expect( addControl() ).toBeNull();
		expect( screen.getByText( '1 assignment' ) ).toBeInTheDocument();
	} );

	it( 'still offers an assignment beside a stored note', () => {
		renderInspector( { to: 'review', inputs: [ note( 'Why' ) ] } );

		expect( addControl() ).toBeInTheDocument();
	} );

	it( 'lists a stored note as no longer collected, with nothing to open', () => {
		renderInspector( {
			to: 'review',
			inputs: [ note( 'Why' ), assignment() ],
		} );

		// An inert row with a tip, not a "Configure" button: a popover with
		// nothing focusable in it could not be dismissed from the keyboard.
		expect(
			screen.queryByRole( 'button', { name: 'Configure Why' } )
		).toBeNull();
		expect( screen.getByText( 'No longer collected' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'About Why' } )
		).toBeInTheDocument();

		// Stored notes to remove are what a shut section reports.
		expect( screen.getByText( '1 input to remove' ) ).toBeInTheDocument();
	} );

	it( 'does not flag an assignment whose key a stored note also carries', () => {
		// Only an assignment writes under its key, so a note's stale key is no
		// collision.
		renderInspector( {
			to: 'review',
			inputs: [
				{ ...note( 'Why' ), meta_key: 'wfp_n1abcde' },
				assignment(),
			],
		} );

		expect( screen.queryByText( 'Duplicate key' ) ).toBeNull();
		expect( screen.getByText( 'Assignment' ) ).toBeInTheDocument();
	} );

	it( 'removes the input the row belongs to, leaving the rest in order', async () => {
		const onChange = jest.fn();
		renderInspector(
			{
				to: 'review',
				inputs: [
					note( 'Why', 'n1' ),
					assignment(),
					note( 'What', 'n2' ),
				],
			},
			onChange
		);

		await act( async () => {
			fireEvent.click(
				screen.getAllByRole( 'button', { name: 'Remove input' } )[ 0 ]
			);
		} );

		expect( onChange ).toHaveBeenCalledWith( {
			inputs: [ assignment(), note( 'What', 'n2' ) ],
		} );
	} );

	it( 'flags a stored assignment with no key, since Save is already blocked', async () => {
		// The editor mints a key with every assignment it adds, so one without
		// a key arrived with a stored config — and `validateSequence` refuses
		// the save while it is there. A row that stayed quiet would leave Save
		// switched off with nothing on the list to point at.
		renderInspector( {
			to: 'review',
			inputs: [ { type: 'assignment', assignee_type: 'user' } ],
		} );

		expect( screen.getByText( 'Needs a key' ) ).toBeInTheDocument();

		// And the row it points at says what to do: there is no key field to
		// fix, so the popover names the fix that exists.
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Configure Untitled' } )
			);
		} );

		expect(
			within(
				screen.getByRole( 'dialog', { name: 'Untitled' } )
			).getByText( /Remove it and add it again/ )
		).toBeInTheDocument();
	} );
} );
