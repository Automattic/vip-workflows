/**
 * ActionRow — the standard action group — and ModalActions, which is that row
 * plus the modal gap.
 *
 * The contract under test is the layout the consumers stopped owning: a row is
 * right-aligned with the primary landing rightmost via DOM order, a stretched
 * group is a column whose buttons all take the full width, and ModalActions
 * renders the same row (so no modal changed when it became an alias).
 *
 * @package
 */

import { render, screen } from './helpers/render-wp-component';
import { ActionRow } from '../../src/common/ActionRow';
import { ModalActions } from '../../src/common/ModalActions';

describe( 'ActionRow', () => {
	it( 'renders a right-aligned row in DOM order', () => {
		render(
			<ActionRow>
				<button>Cancel</button>
				<button>Save</button>
			</ActionRow>
		);

		const row = screen.getByText( 'Cancel' ).parentElement;
		expect( row ).toHaveClass( 'vip-workflows-action-row' );
		expect( row ).toHaveStyle( {
			flexDirection: 'row',
			justifyContent: 'flex-end',
		} );

		// DOM order is the order rule: dismiss first, primary last (rightmost).
		const labels = Array.from( row.querySelectorAll( 'button' ) ).map(
			( b ) => b.textContent
		);
		expect( labels ).toEqual( [ 'Cancel', 'Save' ] );
	} );

	it( 'stretch renders a column whose children fill the width', () => {
		render(
			<ActionRow stretch>
				<button>Go back to Draft</button>
			</ActionRow>
		);

		const row = screen.getByText( 'Go back to Draft' ).parentElement;
		expect( row ).toHaveStyle( {
			flexDirection: 'column',
			alignItems: 'stretch',
		} );
	} );

	it( 'merges a consumer className without dropping its own', () => {
		render(
			<ActionRow className="my-surface__actions">
				<button>Save</button>
			</ActionRow>
		);

		const row = screen.getByText( 'Save' ).parentElement;
		expect( row ).toHaveClass( 'vip-workflows-action-row' );
		expect( row ).toHaveClass( 'my-surface__actions' );
	} );
} );

describe( 'ModalActions', () => {
	it( 'is an ActionRow wearing the modal footer class', () => {
		render(
			<ModalActions>
				<button>Cancel</button>
				<button>Save</button>
			</ModalActions>
		);

		const row = screen.getByText( 'Cancel' ).parentElement;
		expect( row ).toHaveClass( 'vip-workflows-modal-actions' );
		expect( row ).toHaveClass( 'vip-workflows-action-row' );
		expect( row ).toHaveStyle( {
			flexDirection: 'row',
			justifyContent: 'flex-end',
		} );
	} );
} );
