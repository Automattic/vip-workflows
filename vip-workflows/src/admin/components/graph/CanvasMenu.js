/**
 * CanvasMenu — the sequence canvas's right-click menu.
 *
 * Hand-rolled rather than a `DropdownMenu`: this menu has no trigger to hang
 * off. It opens at a pointer position inside the canvas, which is a coordinate,
 * not an element, and it has to close on the same things that dismiss a canvas
 * selection (a click on the pane, a pan, Escape) rather than only on its own
 * blur. The parent owns *whether* it's open and at what coordinate; this owns
 * the rest.
 *
 * `role="menu"` is a promise about the keyboard, not a label: one tab stop for
 * the whole menu, Up/Down (and Home/End) between the items, Escape to dismiss,
 * and a name to announce it by. So the menu keeps its own roving focus rather
 * than leaving every item in the tab order — and hands focus back where it came
 * from on the way out, since the thing that opened it (a region label, or the
 * pane) is where the author was.
 *
 * @package
 */

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { Icon } from '@wordpress/components';

/**
 * Indexes of the items keyboard focus can land on.
 *
 * Disabled items render as `disabled` buttons, which are not focusable, so the
 * roving index steps over them rather than through them.
 *
 * @param {Array} items Menu items.
 * @return {number[]} Focusable indexes, in menu order.
 */
function focusableIndexes( items ) {
	return items.reduce( ( indexes, item, index ) => {
		if ( ! item.disabled ) {
			indexes.push( index );
		}
		return indexes;
	}, [] );
}

export default function CanvasMenu( { x, y, items, label, onClose } ) {
	const ref = useRef( null );
	const itemRefs = useRef( [] );

	const focusable = useMemo( () => focusableIndexes( items ), [ items ] );

	// Which item holds the menu's single tab stop. -1 is a menu whose items are
	// all disabled: the container takes the tab stop instead, so the menu is
	// still reachable, announced, and dismissible.
	const [ activeIndex, setActiveIndex ] = useState(
		() => focusableIndexes( items )[ 0 ] ?? -1
	);

	// Where focus was when the menu opened. Captured in an effect that is
	// declared before the one that moves focus, so it reads the opener and not
	// the menu itself.
	const openerRef = useRef( null );
	useEffect( () => {
		openerRef.current = ref.current.ownerDocument.activeElement;
	}, [] );

	const restoreFocus = useCallback( () => {
		const opener = openerRef.current;
		if ( opener instanceof HTMLElement && opener.isConnected ) {
			opener.focus();
		}
	}, [] );

	// Follow the roving index with real focus — on open, and on every move. A
	// menu that appears without taking focus is one the keyboard has no way
	// into, since it has no trigger to return to.
	useEffect( () => {
		if ( activeIndex < 0 ) {
			ref.current?.focus();
			return;
		}
		itemRefs.current[ activeIndex ]?.focus();
	}, [ activeIndex ] );

	useEffect( () => {
		// Escape is bound to the document rather than the menu, so it dismisses
		// from wherever focus has ended up. Nothing here has to be stopped from
		// travelling further: React Flow's own key handling is bound to
		// `document` too (`useKeyPress`), where `stopPropagation` between two
		// listeners on the same node does nothing at all, and what it watches is
		// Backspace and the modifier keys — never Escape.
		const onKeyDown = ( event ) => {
			if ( event.key !== 'Escape' ) {
				return;
			}
			// Dismissed from the keyboard, so focus goes back to whatever opened
			// the menu rather than onto the body.
			restoreFocus();
			onClose();
		};
		// Anything outside the menu dismisses it. Captured on pointerdown so a
		// click that lands on the canvas both closes the menu and still reaches
		// React Flow — a menu that eats the click it was dismissed by makes
		// "close it and select that node" take two clicks. Focus is left where
		// the pointer put it on this path; it already said where it wanted to be.
		const onPointerDown = ( event ) => {
			if ( ! ref.current?.contains( event.target ) ) {
				onClose();
			}
		};
		document.addEventListener( 'keydown', onKeyDown );
		document.addEventListener( 'pointerdown', onPointerDown, true );
		return () => {
			document.removeEventListener( 'keydown', onKeyDown );
			document.removeEventListener( 'pointerdown', onPointerDown, true );
		};
	}, [ onClose, restoreFocus ] );

	const moveFocus = useCallback(
		( step ) => {
			if ( focusable.length === 0 ) {
				return;
			}
			const at = focusable.indexOf( activeIndex );
			// Wraps. The menu is two items long; running off the end of it with
			// no way back would be the bigger surprise.
			const next = ( at + step + focusable.length ) % focusable.length;
			setActiveIndex( focusable[ next ] );
		},
		[ activeIndex, focusable ]
	);

	const handleKeyDown = ( event ) => {
		switch ( event.key ) {
			case 'ArrowDown':
				moveFocus( 1 );
				break;
			case 'ArrowUp':
				moveFocus( -1 );
				break;
			case 'Home':
				setActiveIndex( focusable[ 0 ] ?? -1 );
				break;
			case 'End':
				setActiveIndex( focusable[ focusable.length - 1 ] ?? -1 );
				break;
			default:
				return;
		}
		// These scroll the page by default, which would slide the canvas — and
		// the menu pinned to it — out from under the item being walked to.
		event.preventDefault();
	};

	return (
		<div
			ref={ ref }
			className="wf-canvas-menu"
			style={ { top: `${ y }px`, left: `${ x }px` } }
			role="menu"
			aria-label={ label }
			aria-orientation="vertical"
			tabIndex={ -1 }
			onKeyDown={ handleKeyDown }
		>
			{ items.map( ( item, index ) => (
				<button
					key={ item.id }
					ref={ ( el ) => {
						itemRefs.current[ index ] = el;
					} }
					type="button"
					role="menuitem"
					className="wf-canvas-menu__item"
					disabled={ item.disabled }
					tabIndex={ index === activeIndex ? 0 : -1 }
					onClick={ () => {
						// Before the item runs: an item that opens a dialog
						// takes focus itself once it mounts, and an item that
						// only edits the canvas leaves it back where it started.
						restoreFocus();
						onClose();
						item.onSelect();
					} }
				>
					{ item.icon && (
						<Icon
							icon={ item.icon }
							size={ 16 }
							className="wf-canvas-menu__icon"
						/>
					) }
					<span>{ item.label }</span>
				</button>
			) ) }
		</div>
	);
}
