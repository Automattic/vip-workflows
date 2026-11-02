/**
 * The assignment input's configuration, as the transition inspector shows it.
 *
 * The slot key is not one of its fields. It is minted when the input is added,
 * and nothing an author does reads it, so there is nothing to type or to match.
 *
 * @package
 */

import { render, screen } from './helpers/render-wp-component';

import { AssignmentInputConfig } from '../../src/admin/components/TransitionAssignmentConfig';

describe( 'Assignment input key', () => {
	it( 'is not a field the author is asked to fill in', () => {
		render(
			<AssignmentInputConfig
				input={ { type: 'assignment', meta_key: 'wfp_n1abcde' } }
				availableRoles={ [] }
				onUpdateInput={ () => {} }
				onToggleRoleFilter={ () => {} }
			/>
		);

		expect(
			screen.queryByRole( 'textbox', { name: 'Assignment key' } )
		).toBeNull();
		expect( screen.queryByDisplayValue( 'wfp_n1abcde' ) ).toBeNull();
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
