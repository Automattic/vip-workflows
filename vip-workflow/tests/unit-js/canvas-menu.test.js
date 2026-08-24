/**
 * Unit tests for the sequence canvas's right-click menu.
 *
 * `CanvasMenu` claims `role="menu"`, and that is a promise about the keyboard:
 * one tab stop for the whole menu, arrow keys between the items, Escape to
 * dismiss, and a name to announce it by. It has no trigger element to fall back
 * on — it opens at a coordinate — so if it doesn't take focus on open and hand
 * it back on close, a keyboard user has no way in and nowhere to land.
 *
 * The component is plain React with no React Flow dependency, so all of that is
 * reachable here.
 *
 * @package
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';

import CanvasMenu from '../../src/admin/components/graph/CanvasMenu';

const MENU_LABEL = 'Canvas actions';

const ITEMS = [
	{ id: 'add', label: 'Add post status…' },
	{ id: 'remove', label: 'Remove “Draft”' },
	{ id: 'third', label: 'Third' },
];

/**
 * The menu and the thing that opened it.
 *
 * @param {Object}   props         Harness props.
 * @param {boolean}  props.open    Whether the menu is mounted.
 * @param {Array}    props.items   Menu items.
 * @param {Function} props.onClose Dismissal callback.
 * @return {JSX.Element} The harness.
 */
function Harness( { open, items, onClose } ) {
	return (
		<>
			<button type="button" data-testid="opener">
				Draft
			</button>
			{ open && (
				<CanvasMenu
					x={ 10 }
					y={ 20 }
					items={ items }
					label={ MENU_LABEL }
					onClose={ onClose }
				/>
			) }
		</>
	);
}

/**
 * Open the menu the way the canvas does: from something that already has focus
 * — the region label under a right-click or the Menu key.
 *
 * @param {Array} [items] Items, without their `onSelect`.
 * @return {Object} `{ onClose, onSelect }`.
 */
function openMenu( items = ITEMS ) {
	const onClose = jest.fn();
	const onSelect = jest.fn();
	const withSelect = items.map( ( item ) => ( { ...item, onSelect } ) );

	const { rerender } = render(
		<Harness open={ false } items={ withSelect } onClose={ onClose } />
	);
	screen.getByTestId( 'opener' ).focus();
	rerender( <Harness open items={ withSelect } onClose={ onClose } /> );

	return { onClose, onSelect };
}

describe( 'CanvasMenu', () => {
	it( 'names the menu, so it does not announce as an anonymous group', () => {
		openMenu();

		expect(
			screen.getByRole( 'menu', { name: MENU_LABEL } )
		).toBeInTheDocument();
	} );

	it( 'takes focus on the first item when it opens', () => {
		openMenu();

		expect(
			screen.getByRole( 'menuitem', { name: 'Add post status…' } )
		).toHaveFocus();
	} );

	it( 'opens on the first item that is not disabled', () => {
		openMenu( [
			{ id: 'add', label: 'Add', disabled: true },
			{ id: 'remove', label: 'Remove' },
		] );

		expect(
			screen.getByRole( 'menuitem', { name: 'Remove' } )
		).toHaveFocus();
	} );

	it( 'is a single tab stop — only the focused item is tabbable', () => {
		openMenu();

		const items = screen.getAllByRole( 'menuitem' );
		expect( items.map( ( item ) => item.tabIndex ) ).toEqual( [
			0, -1, -1,
		] );
	} );

	it( 'walks down and up with the arrow keys', () => {
		openMenu();
		const menu = screen.getByRole( 'menu' );

		fireEvent.keyDown( menu, { key: 'ArrowDown' } );
		expect(
			screen.getByRole( 'menuitem', { name: 'Remove “Draft”' } )
		).toHaveFocus();

		fireEvent.keyDown( menu, { key: 'ArrowUp' } );
		expect(
			screen.getByRole( 'menuitem', { name: 'Add post status…' } )
		).toHaveFocus();
	} );

	it( 'wraps at both ends', () => {
		openMenu();
		const menu = screen.getByRole( 'menu' );

		// Up from the first item lands on the last.
		fireEvent.keyDown( menu, { key: 'ArrowUp' } );
		expect(
			screen.getByRole( 'menuitem', { name: 'Third' } )
		).toHaveFocus();

		fireEvent.keyDown( menu, { key: 'ArrowDown' } );
		expect(
			screen.getByRole( 'menuitem', { name: 'Add post status…' } )
		).toHaveFocus();
	} );

	it( 'jumps to the ends with Home and End', () => {
		openMenu();
		const menu = screen.getByRole( 'menu' );

		fireEvent.keyDown( menu, { key: 'End' } );
		expect(
			screen.getByRole( 'menuitem', { name: 'Third' } )
		).toHaveFocus();

		fireEvent.keyDown( menu, { key: 'Home' } );
		expect(
			screen.getByRole( 'menuitem', { name: 'Add post status…' } )
		).toHaveFocus();
	} );

	it( 'steps over a disabled item rather than stalling on it', () => {
		// A disabled button is not focusable, so an arrow that landed on one
		// would leave focus where it was and the menu would feel stuck.
		openMenu( [
			{ id: 'a', label: 'First' },
			{ id: 'b', label: 'Middle', disabled: true },
			{ id: 'c', label: 'Last' },
		] );

		fireEvent.keyDown( screen.getByRole( 'menu' ), { key: 'ArrowDown' } );

		expect(
			screen.getByRole( 'menuitem', { name: 'Last' } )
		).toHaveFocus();
	} );

	it( 'keeps the menu itself focusable when every item is disabled', () => {
		openMenu( [ { id: 'a', label: 'First', disabled: true } ] );

		expect( screen.getByRole( 'menu' ) ).toHaveFocus();
	} );

	it( 'dismisses on Escape and gives focus back to whatever opened it', () => {
		const { onClose } = openMenu();

		fireEvent.keyDown( document, { key: 'Escape' } );

		expect( onClose ).toHaveBeenCalled();
		expect( screen.getByTestId( 'opener' ) ).toHaveFocus();
	} );

	it( 'dismisses on a pointer down outside itself', () => {
		const { onClose } = openMenu();

		fireEvent.pointerDown( document.body );

		expect( onClose ).toHaveBeenCalled();
	} );

	it( 'stays open on a pointer down inside itself', () => {
		const { onClose } = openMenu();

		fireEvent.pointerDown( screen.getByRole( 'menu' ) );

		expect( onClose ).not.toHaveBeenCalled();
	} );

	it( 'closes, runs the item, and returns focus when one is activated', () => {
		const { onClose, onSelect } = openMenu();

		fireEvent.click(
			screen.getByRole( 'menuitem', { name: 'Remove “Draft”' } )
		);

		expect( onClose ).toHaveBeenCalled();
		expect( onSelect ).toHaveBeenCalled();
		expect( screen.getByTestId( 'opener' ) ).toHaveFocus();
	} );

	it( 'stops listening once it is gone', () => {
		// The listeners are on the document, so an unmounted menu that kept them
		// would answer an Escape meant for whatever came after it.
		const onClose = jest.fn();
		const { unmount } = render(
			<CanvasMenu
				x={ 0 }
				y={ 0 }
				items={ [ { id: 'a', label: 'First', onSelect() {} } ] }
				label={ MENU_LABEL }
				onClose={ onClose }
			/>
		);

		unmount();
		fireEvent.keyDown( document, { key: 'Escape' } );

		expect( onClose ).not.toHaveBeenCalled();
	} );
} );
