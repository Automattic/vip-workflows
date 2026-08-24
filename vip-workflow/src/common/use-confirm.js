/**
 * useConfirm — a promise-based replacement for `window.confirm()` built on the
 * WPDS `Modal`.
 *
 * Browser-native `confirm()` is not a design-system component and cannot be
 * styled or made accessible to match the rest of the admin. This hook returns
 * an async `confirm( message, options )` that resolves `true`/`false`, plus the
 * dialog node to render once:
 *
 *   const [ confirm, confirmDialog ] = useConfirm();
 *   // …
 *   if ( ! ( await confirm( __( 'Delete this?', 'vip-workflow' ) ) ) ) {
 *       return;
 *   }
 *   // …
 *   return ( <>{ confirmDialog } …</> );
 *
 * `options` may set `title`, `confirmLabel`, `cancelLabel`, and `isDestructive`.
 *
 * @package
 */

import { Modal, Button } from '@wordpress/components';
import { Text } from '@wordpress/ui';
import { useState, useRef, useCallback, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import { ModalActions } from './ModalActions';

export function useConfirm() {
	const [ dialog, setDialog ] = useState( null );
	const resolverRef = useRef( null );

	const confirm = useCallback( ( message, options = {} ) => {
		return new Promise( ( resolve ) => {
			// A confirm opened while another is still pending: settle the prior
			// one as cancelled so its awaiter never hangs.
			resolverRef.current?.( false );
			resolverRef.current = resolve;
			setDialog( { message, ...options } );
		} );
	}, [] );

	// Resolve a still-pending confirm as cancelled if the host unmounts, so the
	// awaiting caller never hangs.
	useEffect(
		() => () => {
			resolverRef.current?.( false );
			resolverRef.current = null;
		},
		[]
	);

	const settle = useCallback( ( result ) => {
		setDialog( null );
		const resolve = resolverRef.current;
		resolverRef.current = null;
		resolve?.( result );
	}, [] );

	const confirmDialog = dialog ? (
		<Modal
			title={ dialog.title || __( 'Please confirm', 'vip-workflow' ) }
			onRequestClose={ () => settle( false ) }
			size="small"
		>
			{ typeof dialog.message === 'string' ? (
				<Text variant="body-md" render={ <p /> }>
					{ dialog.message }
				</Text>
			) : (
				dialog.message
			) }
			<ModalActions>
				<Button variant="tertiary" onClick={ () => settle( false ) }>
					{ dialog.cancelLabel || __( 'Cancel', 'vip-workflow' ) }
				</Button>
				<Button
					variant="primary"
					isDestructive={ dialog.isDestructive }
					onClick={ () => settle( true ) }
				>
					{ dialog.confirmLabel || __( 'Confirm', 'vip-workflow' ) }
				</Button>
			</ModalActions>
		</Modal>
	) : null;

	return [ confirm, confirmDialog ];
}
