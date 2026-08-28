/**
 * ModalActions — the standard modal footer.
 *
 * An `ActionRow` plus the standard gap above it — a right-aligned row of
 * action buttons with consistent spacing above the modal body. Children render
 * left → right, so place the cancel/dismiss button first and the primary
 * action last (the primary always lands on the right). This is the one
 * sanctioned modal footer; do not hand-roll `<div>`/`Stack` footers.
 *
 * The footer owns all of its own layout. All actions are right-aligned and
 * consumers must NOT style the footer or its contents in place (no `className`
 * on the buttons for spacing, no `margin-right: auto`, no per-modal footer CSS).
 *
 * See docs/guides/modal-standard.md.
 *
 * @package
 */

import { ActionRow } from './ActionRow';

import './ModalActions.css';

export function ModalActions( { children, className } ) {
	const classNames = [ 'vip-workflows-modal-actions', className ]
		.filter( Boolean )
		.join( ' ' );

	return <ActionRow className={ classNames }>{ children }</ActionRow>;
}
