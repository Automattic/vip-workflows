/**
 * Card Actions Hook.
 *
 * Handles pin/dismiss/unpin interactions with optimistic UI updates.
 */

import { useCallback } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * @param {number}   projectId     Research project post ID.
 * @param {Object}   state         Current ideation state.
 * @param {Function} onStateChange State update callback.
 * @return {Object} Card action handlers.
 */
export function useCardActions( projectId, state, onStateChange ) {
	const updateCardStatus = useCallback(
		( cardId, newStatus, listChanges ) => {
			const updated = { ...state };
			updated.cards = state.cards.map( ( card ) => {
				const id = card.source_id || card.card_id;
				if ( id === cardId ) {
					return { ...card, card_status: newStatus };
				}
				return card;
			} );

			if ( listChanges.addToPinned ) {
				updated.pinned_ids = [ ...( state.pinned_ids || [] ), cardId ];
			}
			if ( listChanges.removeFromPinned ) {
				updated.pinned_ids = ( state.pinned_ids || [] ).filter(
					( id ) => id !== cardId
				);
			}
			if ( listChanges.addToDismissed ) {
				updated.dismissed_ids = [
					...( state.dismissed_ids || [] ),
					cardId,
				];
			}
			if ( listChanges.removeFromDismissed ) {
				updated.dismissed_ids = ( state.dismissed_ids || [] ).filter(
					( id ) => id !== cardId
				);
			}

			onStateChange( updated );
		},
		[ state, onStateChange ]
	);

	const pinCard = useCallback(
		async ( cardId ) => {
			updateCardStatus( cardId, 'pinned', {
				addToPinned: true,
				removeFromDismissed: true,
			} );

			const freshState = await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ projectId }/pin`,
				method: 'POST',
				data: { source_id: cardId },
			} );
			onStateChange( freshState );
		},
		[ projectId, updateCardStatus, onStateChange ]
	);

	const dismissCard = useCallback(
		async ( cardId ) => {
			updateCardStatus( cardId, 'dismissed', {
				addToDismissed: true,
				removeFromPinned: true,
			} );

			await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ projectId }/dismiss`,
				method: 'POST',
				data: { source_id: cardId },
			} );
		},
		[ projectId, updateCardStatus ]
	);

	const unpinCard = useCallback(
		async ( cardId ) => {
			updateCardStatus( cardId, 'default', { removeFromPinned: true } );

			await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ projectId }/unpin`,
				method: 'POST',
				data: { source_id: cardId },
			} );
		},
		[ projectId, updateCardStatus ]
	);

	const restoreCard = useCallback(
		async ( cardId ) => {
			updateCardStatus( cardId, 'default', {
				removeFromDismissed: true,
			} );

			await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ projectId }/restore`,
				method: 'POST',
				data: { source_id: cardId },
			} );
		},
		[ projectId, updateCardStatus ]
	);

	return { pinCard, dismissCard, unpinCard, restoreCard };
}
