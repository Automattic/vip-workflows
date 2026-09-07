/**
 * Editorial Mentor Hook.
 *
 * Waits for all initial assistants to settle, then re-runs when pinned cards change.
 * Queues a re-run if a call is already in-flight so pin changes
 * are never silently dropped.
 */

import { useState, useCallback, useEffect, useRef } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * @param {number}  projectId         Research project post ID.
 * @param {Object}  state             Current ideation state.
 * @param {boolean} assistantsSettled Whether all initial research assistants have finished.
 * @return {Object} Mentor state and trigger.
 */
export function useMentor( projectId, state, assistantsSettled ) {
	const [ mentorResult, setMentorResult ] = useState( null );
	const [ mentorLoading, setMentorLoading ] = useState( false );
	const [ autoRefresh, setAutoRefresh ] = useState( () => {
		const stored = localStorage.getItem( 'vip_workflows_mentor_auto' );
		return stored === null ? true : stored === '1';
	} );

	const handleSetAutoRefresh = useCallback( ( value ) => {
		setAutoRefresh( value );
		localStorage.setItem( 'vip_workflows_mentor_auto', value ? '1' : '0' );
	}, [] );
	const loadingRef = useRef( false );
	const pendingRerunRef = useRef( false );
	const lastPinnedRef = useRef( JSON.stringify( state.pinned_ids || [] ) );
	const hasRunOnceRef = useRef( false );
	const autoRefreshRef = useRef( autoRefresh );
	autoRefreshRef.current = autoRefresh;

	const runMentor = useCallback( async () => {
		if ( ! projectId ) {
			return;
		}

		if ( loadingRef.current ) {
			pendingRerunRef.current = true;
			return;
		}

		loadingRef.current = true;
		pendingRerunRef.current = false;
		setMentorLoading( true );
		try {
			const result = await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ projectId }/mentor`,
				method: 'POST',
			} );
			setMentorResult( result );
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( 'Editorial Mentor error:', err );
			setMentorResult( {
				status: 'failed',
				cards: [],
				summary: null,
				error: err.message || 'Mentor evaluation failed.',
			} );
		} finally {
			loadingRef.current = false;
			setMentorLoading( false );

			if ( pendingRerunRef.current && autoRefreshRef.current ) {
				pendingRerunRef.current = false;
				setTimeout( () => runMentor(), 500 );
			}
		}
	}, [ projectId ] );

	// Run once after all initial research assistants have settled.
	useEffect( () => {
		if (
			hasRunOnceRef.current ||
			! assistantsSettled ||
			! autoRefreshRef.current
		) {
			return;
		}
		hasRunOnceRef.current = true;
		const timeout = setTimeout( runMentor, 800 );
		return () => clearTimeout( timeout );
	}, [ assistantsSettled, runMentor ] );

	// Re-run when pinned cards change (only if auto-refresh is on).
	const pinnedIds = state.pinned_ids;
	useEffect( () => {
		if ( ! hasRunOnceRef.current || ! autoRefreshRef.current ) {
			return;
		}

		const pinnedKey = JSON.stringify( pinnedIds || [] );
		if ( pinnedKey === lastPinnedRef.current ) {
			return;
		}

		lastPinnedRef.current = pinnedKey;
		const timeout = setTimeout( runMentor, 5000 );
		return () => clearTimeout( timeout );
	}, [ pinnedIds, runMentor ] );

	const mentorSuggestions = mentorResult?.meta?.suggestions || [];

	return {
		mentorResult,
		mentorSuggestions,
		runMentor,
		mentorLoading,
		autoRefresh,
		setAutoRefresh: handleSetAutoRefresh,
	};
}
