/**
 * Assignment slot keys, as typed in the transition inspector.
 *
 * Two fields name the same thing: the Assignment key on an assignment input
 * (which declares the slot) and the Assignment key under "Restrict to an
 * assignee" (which points at one). Both are stored through `sanitize_key()`,
 * which STRIPS a space rather than converting it — so an author who typed
 * "Legal Reviewer" on one side and `legal_reviewer` on the other got two values
 * that read as the same slot and silently never matched, leaving the gated
 * transition impossible to take.
 *
 * The fields sanitize as they are typed, on the same rule the stage Key field
 * uses, so what the author sees is what gets stored on both sides.
 *
 * @package
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import {
	AssignmentInputConfig,
	RequiresAssignmentConfig,
	expandRequiresAssignment,
	sanitizeAssignmentKey,
} from '../../src/admin/components/TransitionAssignmentConfig';

const keyField = () =>
	screen.getByRole( 'textbox', { name: 'Assignment key' } );

describe( 'sanitizeAssignmentKey', () => {
	it( 'turns a space into a separator instead of dropping it', () => {
		expect( sanitizeAssignmentKey( 'Legal Reviewer' ) ).toBe(
			'legal-reviewer'
		);
	} );

	it( 'keeps the characters the stored key may contain', () => {
		expect( sanitizeAssignmentKey( 'legal_reviewer' ) ).toBe(
			'legal_reviewer'
		);
		expect( sanitizeAssignmentKey( 'legal-reviewer2' ) ).toBe(
			'legal-reviewer2'
		);
	} );

	it( 'collapses a run of separators rather than stacking them', () => {
		expect( sanitizeAssignmentKey( 'legal // reviewer' ) ).toBe(
			'legal-reviewer'
		);
	} );
} );

describe( 'Assignment input key field', () => {
	it( 'reports the sanitized key, not the raw keystrokes', () => {
		const onUpdateInput = jest.fn();

		render(
			<AssignmentInputConfig
				input={ { type: 'assignment' } }
				availableRoles={ [] }
				onUpdateInput={ onUpdateInput }
				onToggleRoleFilter={ () => {} }
			/>
		);

		fireEvent.change( keyField(), {
			target: { value: 'Legal Reviewer' },
		} );

		expect( onUpdateInput ).toHaveBeenCalledWith(
			'meta_key',
			'legal-reviewer'
		);
	} );
} );

describe( 'Requires-assignment key field', () => {
	it( 'sanitizes the pointer the same way the slot is sanitized', () => {
		const onUpdate = jest.fn();

		render(
			<RequiresAssignmentConfig
				transition={ {
					requires_assignment: {
						meta_key: '',
						match: 'current_user',
					},
				} }
				onToggle={ () => {} }
				onUpdate={ onUpdate }
			/>
		);

		fireEvent.change( keyField(), {
			target: { value: 'Legal Reviewer' },
		} );

		expect( onUpdate ).toHaveBeenCalledWith( 'meta_key', 'legal-reviewer' );
	} );
} );

/*
 * The gate is stored two ways.
 *
 * `requires_assignment` is either `{ meta_key, match }` or the bare slot key as
 * a string — the shorthand `AssignmentManager::normalize_requirement()` accepts
 * and `build_config()` writes back verbatim, so a stored sequence really does
 * carry it. Read straight off, the string answers `undefined` for `.meta_key`:
 * the form drew an empty Key box over a gate that names one, and the update
 * spread the string into `{ 0: 'l', 1: 'e', … }` with no key left at all —
 * severing the gate as a side effect of touching the match mode.
 */
describe( 'expandRequiresAssignment', () => {
	it( 'reads the bare key a stored sequence may carry', () => {
		expect( expandRequiresAssignment( 'legal_reviewer' ) ).toEqual( {
			meta_key: 'legal_reviewer',
			match: 'current_user',
		} );
	} );

	it( 'leaves the full shape alone', () => {
		expect(
			expandRequiresAssignment( {
				meta_key: 'legal_reviewer',
				match: 'completed',
			} )
		).toEqual( { meta_key: 'legal_reviewer', match: 'completed' } );
	} );

	it( 'answers an empty gate for a value that names nothing', () => {
		expect( expandRequiresAssignment( undefined ) ).toEqual( {
			meta_key: '',
			match: 'current_user',
		} );
	} );

	it( 'shows the key a shorthand gate names', () => {
		render(
			<RequiresAssignmentConfig
				transition={ { requires_assignment: 'legal_reviewer' } }
				onToggle={ () => {} }
				onUpdate={ () => {} }
			/>
		);

		expect( keyField() ).toHaveValue( 'legal_reviewer' );
	} );
} );

/*
 * The match mode does not choose the check.
 *
 * `AssignmentManager::user_satisfies_requirement()` picks the validator from the
 * stored assignment's TYPE — user, role, or agent — and only then hands the mode
 * to it. So `current_user_role` runs the same role-membership test as
 * `current_user` on a role assignment, and makes `validate_user_assignment()`
 * return false for everyone on a user assignment: a gate nobody can satisfy.
 * The dropdown offered it and `build_config()`'s whitelist then rewrote it to
 * `current_user` on save, which is the only reason it never reached disk.
 */
describe( 'Match mode options', () => {
	const modeSelect = () =>
		screen.getByRole( 'combobox', { name: 'Match mode' } );

	const renderGate = () =>
		render(
			<RequiresAssignmentConfig
				transition={ {
					requires_assignment: {
						meta_key: 'legal_reviewer',
						match: 'current_user',
					},
				} }
				onToggle={ () => {} }
				onUpdate={ () => {} }
			/>
		);

	it( 'does not offer a mode the server refuses to store', () => {
		renderGate();

		const values = Array.from( modeSelect().options ).map(
			( option ) => option.value
		);

		expect( values ).not.toContain( 'current_user_role' );
	} );

	it( 'offers the two modes that mean something', () => {
		renderGate();

		const values = Array.from( modeSelect().options ).map(
			( option ) => option.value
		);

		expect( values ).toEqual( [ 'current_user', 'completed' ] );
	} );
} );

/*
 * `agent` is not an authoring option.
 *
 * It was one, with nothing behind it: the editor's assignment popover drew an
 * "Automated task" panel, committed the literal id `default`, and advanced the
 * post — an assignment naming no agent at all, faithfully stored by the server.
 * The option is withdrawn until a real agent picker exists. The server side is
 * untouched, so a sequence that already carries one still parses; what these
 * pin is that a new one cannot be authored, and that an existing one is still
 * visible rather than silently redrawn as unset.
 */
describe( 'Assignee type options', () => {
	const typeSelect = () =>
		screen.getByRole( 'combobox', { name: 'Assignee type' } );

	const renderInput = ( input = {} ) =>
		render(
			<AssignmentInputConfig
				input={ { type: 'assignment', ...input } }
				availableRoles={ [ { slug: 'editor', name: 'Editor' } ] }
				onUpdateInput={ () => {} }
				onToggleRoleFilter={ () => {} }
			/>
		);

	it( 'does not offer agent', () => {
		renderInput();

		const values = Array.from( typeSelect().options ).map(
			( option ) => option.value
		);

		expect( values ).toEqual( [ 'user', 'role' ] );
	} );

	it( 'shows a stored agent as unavailable rather than as nothing', () => {
		renderInput( { assignee_type: 'agent' } );

		const stored = Array.from( typeSelect().options ).find(
			( option ) => option.value === 'agent'
		);

		expect( typeSelect() ).toHaveValue( 'agent' );
		expect( stored ).toBeDisabled();
		expect( stored.textContent ).toBe( 'agent (no longer available)' );
	} );

	it( 'offers the role filter only for a user assignment', () => {
		const { unmount } = renderInput( { assignee_type: 'user' } );

		expect( screen.getByText( 'Filter by role' ) ).toBeInTheDocument();
		unmount();

		renderInput( { assignee_type: 'agent' } );

		expect(
			screen.queryByText( 'Filter by role' )
		).not.toBeInTheDocument();
	} );
} );
