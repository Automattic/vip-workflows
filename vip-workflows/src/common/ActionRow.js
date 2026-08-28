/**
 * ActionRow — the standard action group, everywhere.
 *
 * A right-aligned row of action buttons. Children render left → right, so
 * place the cancel/dismiss button first and the primary action last (the
 * primary always lands on the right). `ModalActions` is this row plus the
 * modal-specific gap above it; card footers, settings bars and page-level
 * button groups use ActionRow directly instead of hand-rolling a `Stack`.
 *
 * `stretch` is for containers too narrow for a hugging row (the editor
 * sidebar, an inspector column): the group becomes a column and every button
 * takes the full width — never a mix of stretched and hugging buttons.
 *
 * The row owns all of its own layout. Consumers must NOT style the row or its
 * contents in place (no `className` on the buttons for spacing, no
 * `margin-left: auto`, no per-surface footer CSS beyond a border/padding on
 * the container that holds the row).
 *
 * @package
 */

import { Stack } from '@wordpress/ui';

export function ActionRow( { children, stretch = false, className } ) {
	const classNames = [ 'vip-workflow-action-row', className ]
		.filter( Boolean )
		.join( ' ' );

	if ( stretch ) {
		return (
			<Stack
				direction="column"
				align="stretch"
				gap="sm"
				className={ classNames }
			>
				{ children }
			</Stack>
		);
	}

	return (
		<Stack
			direction="row"
			align="center"
			justify="flex-end"
			gap="sm"
			className={ classNames }
		>
			{ children }
		</Stack>
	);
}
