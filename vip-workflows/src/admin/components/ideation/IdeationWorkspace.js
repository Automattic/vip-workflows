/**
 * Ideation Workspace Component.
 *
 * The creative workspace layout: sticky top bar with seed/tags/actions,
 * a grouped mood board of cards, and a collapsible assistant panel.
 */

import {
	useState,
	useCallback,
	useRef,
	useEffect,
	useMemo,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Snackbar, Spinner, Icon } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import {
	chevronRight,
	chevronLeft,
	check as checkIcon,
	closeSmall,
} from '@wordpress/icons';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';

import TopBar from './TopBar';
import MoodBoard from './MoodBoard';
import AssistantPanel, { SEED_ANALYST_ID } from './AssistantPanel';
import IdeationSummary from './IdeationSummary';
import { useCardActions } from './use-card-actions';
import { useMentor } from './use-mentor';
import { useDropZone } from './use-drop-zone';
import { ToolFailuresModal } from '../../../common/ToolFailuresModal';

import './IdeationWorkspace.css';

// A card processing longer than this is treated as stuck: polling stops for it
// and a Retry affordance is surfaced instead of spinning forever. Processing is
// async with no backend timeout, so the frontend is what bounds the wait; Retry
// re-enqueues the job and resets the row.
const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Parse a MySQL "YYYY-MM-DD HH:MM:SS" datetime into epoch milliseconds.
 *
 * Parsed in the local zone — only ever used to subtract two values produced in
 * the same frame (server_time and a card's updated_at), so the zone offset
 * cancels and the result is a timezone-agnostic elapsed duration.
 *
 * @param {string} value MySQL datetime string.
 * @return {number} Epoch milliseconds, or NaN if unparseable.
 */
function parseSqlTime( value ) {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
		value || ''
	);
	if ( ! m ) {
		return NaN;
	}
	return new Date(
		+m[ 1 ],
		+m[ 2 ] - 1,
		+m[ 3 ],
		+m[ 4 ],
		+m[ 5 ],
		+m[ 6 ]
	).getTime();
}

/**
 * @param {Object}   props               Component props.
 * @param {Object}   props.state         Full ideation state from the API.
 * @param {Function} props.onStateChange Update state callback.
 * @param {Function} props.onBack        Navigate back to landing.
 * @return {JSX.Element} Workspace component.
 */
export default function IdeationWorkspace( { state, onStateChange, onBack } ) {
	const [ panelOpen, setPanelOpen ] = useState( true );
	const [ researchAbilities, setResearchAbilities ] = useState( [] );
	const { createErrorNotice } = useDispatch( noticesStore );

	/*
	 * Every research agent, turned off ones included.
	 *
	 * `enabled` answers one question — whether this agent can be run — and the
	 * consumers that offer running are the ones that ask it. Naming an agent and
	 * showing what it already collected are different questions, and filtering here
	 * answered all three at once: a turned-off agent's cards were grouped into a
	 * section that was then never in the render order, so they left the board
	 * without a trace.
	 */
	useEffect( () => {
		apiFetch( { path: '/vip-workflows/v1/abilities?category=research' } )
			.then( ( data ) => {
				const sorted = ( data || [] ).sort(
					( a, b ) =>
						( a.display_order ?? 99 ) - ( b.display_order ?? 99 )
				);
				setResearchAbilities( sorted );
			} )
			.catch( () => {} );
	}, [] );

	const { pinCard, dismissCard, unpinCard, restoreCard } = useCardActions(
		state.project_id,
		state,
		onStateChange
	);

	const refreshState = useCallback( async () => {
		try {
			const updated = await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ state.project_id }`,
			} );
			onStateChange( updated );
		} catch {
			// Silently fail on poll.
		}
	}, [ state.project_id, onStateChange ] );

	const cardsRef = useRef( state.cards );
	cardsRef.current = state.cards;
	const serverTimeRef = useRef( state.server_time );
	serverTimeRef.current = state.server_time;

	const pollStartsRef = useRef( {} );
	const [ stuckIds, setStuckIds ] = useState( [] );

	useEffect( () => {
		const poll = () => {
			const now = Date.now();
			const active = ( cardsRef.current || [] ).filter(
				( card ) =>
					card.processing_status === 'pending' ||
					card.processing_status === 'processing'
			);

			// Drop timers for cards that have settled or been removed.
			const activeIds = new Set(
				active.map( ( card ) => card.source_id )
			);
			Object.keys( pollStartsRef.current ).forEach( ( id ) => {
				if ( ! activeIds.has( id ) ) {
					delete pollStartsRef.current[ id ];
				}
			} );

			// Start the clock the first time we observe each active card. Seed it
			// from how long the row has already been in its current state (server
			// time minus the card's updated_at) so a project opened mid-processing
			// surfaces as stuck without waiting a fresh full interval.
			const serverNow = parseSqlTime( serverTimeRef.current );
			active.forEach( ( card ) => {
				if ( ! pollStartsRef.current[ card.source_id ] ) {
					const updatedAt = parseSqlTime( card.updated_at );
					const priorElapsed =
						Number.isFinite( serverNow ) &&
						Number.isFinite( updatedAt )
							? Math.max( 0, serverNow - updatedAt )
							: 0;
					pollStartsRef.current[ card.source_id ] =
						now - priorElapsed;
				}
			} );

			const stuck = active
				.filter(
					( card ) =>
						now - pollStartsRef.current[ card.source_id ] >
						STUCK_AFTER_MS
				)
				.map( ( card ) => card.source_id );

			setStuckIds( ( prev ) =>
				prev.length === stuck.length &&
				prev.every( ( id ) => stuck.includes( id ) )
					? prev
					: stuck
			);

			// Keep polling only while something is still actively processing and
			// within the stuck window; once everything left is stuck, stop.
			const hasLive = active.some(
				( card ) =>
					now - pollStartsRef.current[ card.source_id ] <=
					STUCK_AFTER_MS
			);
			if ( hasLive ) {
				refreshState();
			}
		};

		const interval = setInterval( poll, 5000 );
		return () => clearInterval( interval );
	}, [ refreshState ] );

	const [ initialAssistants, setInitialAssistants ] = useState( {} );
	const firedInitialRef = useRef( false );

	/**
	 * Ability ids of the agents that may actually be run.
	 *
	 * The one place `enabled` belongs: everything that starts an agent reads this,
	 * and everything that only names one or shows what it already found reads the
	 * full list.
	 */
	const runnableAbilityIds = useMemo(
		() =>
			new Set(
				researchAbilities
					.filter( ( a ) => a.enabled )
					.map( ( a ) => a.id )
			),
		[ researchAbilities ]
	);

	const hasRunningInitial = Object.values( initialAssistants ).some(
		( s ) => s === 'running'
	);
	const hasPendingInState = Object.values( state.assistants || {} ).some(
		( data ) => data.status === 'pending'
	);
	const assistantsSettled = ! hasRunningInitial && ! hasPendingInState;

	const {
		mentorResult,
		mentorSuggestions,
		runMentor,
		mentorLoading,
		autoRefresh,
		setAutoRefresh,
	} = useMentor( state.project_id, state, assistantsSettled );

	const [ projectSummary, setProjectSummary ] = useState( null );
	const [ summaryKeyPoints, setSummaryKeyPoints ] = useState( [] );
	const [ summaryLoading, setSummaryLoading ] = useState( true );
	const [ summaryGenerating, setSummaryGenerating ] = useState( false );

	useEffect( () => {
		const loadSummary = async () => {
			try {
				const data = await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }/summary`,
				} );
				setProjectSummary( data.summary || null );
				setSummaryKeyPoints( data.key_points || [] );
			} catch {
				// No summary yet.
			} finally {
				setSummaryLoading( false );
			}
		};
		loadSummary();
	}, [ state.project_id ] );

	const handleGenerateSummary = useCallback( async () => {
		setSummaryGenerating( true );
		try {
			const data = await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ state.project_id }/summarize`,
				method: 'POST',
			} );
			setProjectSummary( data.summary || null );
			setSummaryKeyPoints( data.key_points || [] );
			return data;
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( 'Summary generation failed:', err );
			createErrorNotice(
				err.message ||
					__( 'Failed to generate summary.', 'vip-workflows' ),
				{ type: 'snackbar' }
			);
			return null;
		} finally {
			setSummaryGenerating( false );
		}
	}, [ state.project_id, createErrorNotice ] );

	useEffect( () => {
		if ( firedInitialRef.current ) {
			return;
		}

		/*
		 * A `pending` entry says the agent was queued when the project was created.
		 * Whether it may still be run is a live question, so it is asked now: an
		 * agent turned off in between is skipped rather than fired at a route that
		 * would refuse it. This also means the batch waits for the abilities
		 * response — with nothing runnable yet there is nothing to fire, and the
		 * effect re-runs once the list lands.
		 */
		const pending = Object.entries( state.assistants || {} )
			.filter(
				( [ id, data ] ) =>
					data.status === 'pending' && runnableAbilityIds.has( id )
			)
			.map( ( [ id ] ) => id );

		if ( pending.length === 0 ) {
			return;
		}

		firedInitialRef.current = true;

		const running = {};
		pending.forEach( ( id ) => {
			running[ id ] = 'running';
		} );
		setInitialAssistants( running );

		const runAll = async () => {
			const promises = pending.map( async ( assistantId ) => {
				try {
					const freshState = await apiFetch( {
						path: `/vip-workflows/v1/ideation/${ state.project_id }/run-assistant`,
						method: 'POST',
						data: { assistant: assistantId },
					} );
					setInitialAssistants( ( prev ) => ( {
						...prev,
						[ assistantId ]: 'completed',
					} ) );
					onStateChange( freshState );
				} catch ( err ) {
					// eslint-disable-next-line no-console
					console.error( `Assistant ${ assistantId } failed:`, err );
					setInitialAssistants( ( prev ) => ( {
						...prev,
						[ assistantId ]: 'failed',
					} ) );
				}
			} );

			await Promise.all( promises );

			try {
				const finalState = await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }`,
				} );
				onStateChange( finalState );
			} catch ( e ) {
				/* ignore */
			}
		};

		runAll();
	}, [
		state.assistants,
		state.project_id,
		onStateChange,
		runnableAbilityIds,
	] );

	/**
	 * Re-run one assistant on demand.
	 *
	 * The route re-gates availability and overwrites the stored result, so a
	 * successful run is what clears an `unavailable` state left behind by a
	 * dependency that has since been configured. Rejects on failure so the panel
	 * can say so next to that agent without discarding what is on screen.
	 *
	 * @param {string} assistantId Ability name to run.
	 */
	const handleRetryAssistant = useCallback(
		async ( assistantId ) => {
			if ( initialAssistants[ assistantId ] === 'running' ) {
				return;
			}

			setInitialAssistants( ( prev ) => ( {
				...prev,
				[ assistantId ]: 'running',
			} ) );

			try {
				const freshState = await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }/run-assistant`,
					method: 'POST',
					data: { assistant: assistantId },
				} );
				setInitialAssistants( ( prev ) => ( {
					...prev,
					[ assistantId ]: 'completed',
				} ) );
				onStateChange( freshState );
			} catch ( err ) {
				setInitialAssistants( ( prev ) => ( {
					...prev,
					[ assistantId ]: 'failed',
				} ) );
				// eslint-disable-next-line no-console
				console.error( `Assistant ${ assistantId } failed:`, err );
				throw err;
			}
		},
		[ state.project_id, onStateChange, initialAssistants ]
	);

	/**
	 * Start the seed analysis over.
	 *
	 * The route replaces the analysis and the board only when the run completed,
	 * and puts every research agent back to `pending`. Those are fired once per
	 * mount, so the batch has to be re-armed or they would sit waiting forever on
	 * a workspace that never remounted.
	 *
	 * Rejects when nothing was replaced, so the panel can say so; state is
	 * refetched first because the analyst's own stored result was still updated
	 * with why it could not run.
	 */
	const handleRestartAnalysis = useCallback( async () => {
		setInitialAssistants( ( prev ) => ( {
			...prev,
			[ SEED_ANALYST_ID ]: 'running',
		} ) );

		try {
			const freshState = await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ state.project_id }/restart-analysis`,
				method: 'POST',
			} );
			firedInitialRef.current = false;
			setInitialAssistants( {} );
			onStateChange( freshState );
		} catch ( err ) {
			setInitialAssistants( ( prev ) => ( {
				...prev,
				[ SEED_ANALYST_ID ]: 'failed',
			} ) );
			await refreshState();
			// eslint-disable-next-line no-console
			console.error( 'Restarting the seed analysis failed:', err );
			throw err;
		}
	}, [ state.project_id, onStateChange, refreshState ] );

	const [ runningQuery, setRunningQuery ] = useState( null );

	const handleQuery = useCallback(
		async ( assistantId, query ) => {
			if ( runningQuery ) {
				return;
			}
			setRunningQuery( { assistant: assistantId, query } );
			try {
				const fresh = await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }/query`,
					method: 'POST',
					data: { assistant: assistantId, query },
				} );
				onStateChange( fresh );
				if ( autoRefresh ) {
					setTimeout( runMentor, 1000 );
				}
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( 'Follow-up query failed:', err );
				createErrorNotice(
					err.message ||
						__( 'Follow-up query failed.', 'vip-workflows' ),
					{ type: 'snackbar' }
				);
			} finally {
				setRunningQuery( null );
			}
		},
		[
			state.project_id,
			onStateChange,
			runningQuery,
			autoRefresh,
			runMentor,
			createErrorNotice,
		]
	);

	const visibleCards = ( state.cards || [] ).filter(
		( card ) => card.card_status !== 'dismissed'
	);

	const dismissedCards = ( state.cards || [] ).filter(
		( card ) => card.card_status === 'dismissed'
	);

	const handleDeleteCard = useCallback(
		async ( cardId ) => {
			try {
				await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }/sources/${ cardId }`,
					method: 'DELETE',
				} );
				await refreshState();
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( 'Delete failed:', err );
				createErrorNotice(
					err.message ||
						__( 'Failed to delete source.', 'vip-workflows' ),
					{ type: 'snackbar' }
				);
			}
		},
		[ state.project_id, refreshState, createErrorNotice ]
	);

	const handleDeleteProject = useCallback( async () => {
		try {
			await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ state.project_id }`,
				method: 'DELETE',
			} );
			onBack();
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( 'Delete project failed:', err );
			createErrorNotice(
				err.message ||
					__( 'Failed to delete project.', 'vip-workflows' ),
				{ type: 'snackbar' }
			);
		}
	}, [ state.project_id, onBack, createErrorNotice ] );

	const [ creatingDraft, setCreatingDraft ] = useState( false );
	const [ toolFailures, setToolFailures ] = useState( null );
	const [ softWarningsModal, setSoftWarningsModal ] = useState( null );

	const runPreCheck = useCallback(
		async ( toPhase, action ) => {
			const check = await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ state.project_id }/check-phase-transition`,
				method: 'POST',
				data: { to_phase: toPhase },
			} );

			if ( check.allowed ) {
				return true;
			}

			if ( check.code === 'tool_check_failed' ) {
				setToolFailures( {
					message: check.message,
					hardFailures: check.hard_failures || [],
					softWarnings: check.soft_warnings || [],
				} );
			} else if ( check.code === 'tool_check_warnings' ) {
				setSoftWarningsModal( {
					action,
					warnings: check.soft_warnings || [],
				} );
			} else {
				setToolFailures( {
					message: check.message,
					hardFailures: [],
					softWarnings: [],
				} );
			}

			return false;
		},
		[ state.project_id ]
	);

	const handleCreateDraft = useCallback(
		async ( acknowledgeWarnings = false ) => {
			if ( creatingDraft ) {
				return;
			}
			setCreatingDraft( true );
			setToolFailures( null );

			if ( ! acknowledgeWarnings ) {
				const ok = await runPreCheck( 'editorial', 'draft' );
				if ( ! ok ) {
					setCreatingDraft( false );
					return;
				}
			}

			try {
				if ( ! projectSummary ) {
					await handleGenerateSummary();
				}
				const result = await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }/create-draft`,
					method: 'POST',
					data: {
						word_count: 500,
						acknowledge_warnings: acknowledgeWarnings,
					},
				} );
				window.location.href = result.edit_url;
			} catch ( err ) {
				setCreatingDraft( false );
				// eslint-disable-next-line no-console
				console.error( 'Create draft failed:', err );
				createErrorNotice(
					err.message ||
						__( 'Failed to create draft.', 'vip-workflows' ),
					{ type: 'snackbar' }
				);
			}
		},
		[
			state.project_id,
			creatingDraft,
			projectSummary,
			handleGenerateSummary,
			runPreCheck,
			createErrorNotice,
		]
	);

	const handleSummarize = useCallback(
		async ( sourceId ) => {
			try {
				const result = await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }/sources/${ sourceId }/summarize`,
					method: 'POST',
				} );
				await refreshState();
				return result;
			} catch ( err ) {
				const message =
					err?.message ||
					__( 'Summarization failed.', 'vip-workflows' );
				return { error: message };
			}
		},
		[ state.project_id, refreshState ]
	);

	const handleRetrySource = useCallback(
		async ( sourceId ) => {
			// Reset the stuck clock so the re-queued job gets a fresh window.
			delete pollStartsRef.current[ sourceId ];
			setStuckIds( ( prev ) => prev.filter( ( id ) => id !== sourceId ) );
			try {
				await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }/sources/${ sourceId }/retry`,
					method: 'POST',
				} );
				await refreshState();
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( 'Retry failed:', err );
				createErrorNotice(
					err.message || __( 'Retry failed.', 'vip-workflows' ),
					{ type: 'snackbar' }
				);
			}
		},
		[ state.project_id, refreshState, createErrorNotice ]
	);

	const handleSourceAdded = useCallback( async () => {
		await refreshState();
	}, [ refreshState ] );

	const [ isGeneratingImage, setIsGeneratingImage ] = useState( false );
	const generatingRef = useRef( false );
	const [ uploadQueue, setUploadQueue ] = useState( [] );
	const [ uploadErrors, setUploadErrors ] = useState( [] );

	const handleGenerateImage = useCallback(
		async ( prompt ) => {
			if ( generatingRef.current ) {
				return;
			}
			generatingRef.current = true;
			setIsGeneratingImage( true );

			try {
				await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ state.project_id }/generate-image`,
					method: 'POST',
					data: { prompt },
				} );
				await refreshState();
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( 'Image generation failed:', err );
				createErrorNotice(
					err.message ||
						__( 'Image generation failed.', 'vip-workflows' ),
					{ type: 'snackbar' }
				);
			} finally {
				generatingRef.current = false;
				setIsGeneratingImage( false );
			}
		},
		[ state.project_id, refreshState, createErrorNotice ]
	);

	const handleFileDrop = useCallback(
		async ( files ) => {
			setUploadErrors( [] );

			const queue = files.map( ( file ) => ( {
				name: file.name,
				status: 'uploading',
			} ) );
			setUploadQueue( queue );

			const errors = [];
			for ( let i = 0; i < files.length; i++ ) {
				const file = files[ i ];
				const formData = new FormData();
				formData.append( 'file', file );

				try {
					await apiFetch( {
						path: `/vip-workflows/v1/ideation/${ state.project_id }/sources/upload`,
						method: 'POST',
						body: formData,
					} );
					setUploadQueue( ( prev ) =>
						prev.map( ( item, idx ) =>
							idx === i ? { ...item, status: 'done' } : item
						)
					);
				} catch ( err ) {
					errors.push(
						`${ file.name }: ${ err.message || 'Upload failed' }`
					);
					setUploadQueue( ( prev ) =>
						prev.map( ( item, idx ) =>
							idx === i ? { ...item, status: 'error' } : item
						)
					);
				}
			}

			await refreshState();

			if ( errors.length > 0 ) {
				setUploadErrors( errors );
			}

			setTimeout( () => setUploadQueue( [] ), 2000 );
		},
		[ state.project_id, refreshState ]
	);

	const isUploading = uploadQueue.some(
		( item ) => item.status === 'uploading'
	);
	const { isDragging } = useDropZone( {
		onDrop: handleFileDrop,
		disabled: isUploading,
	} );

	return (
		<Stack direction="column" className="vip-workflows-ideation-workspace">
			{ isDragging && (
				// wpds-allow R7 -- fixed drop-zone scrim overlay (position/backdrop/scrim; flex only centers content)
				<div className="vip-workflows-ideation-workspace__drop-overlay">
					<Stack
						direction="column"
						align="center"
						gap="md"
						className="vip-workflows-ideation-workspace__drop-content"
					>
						<svg
							width="48"
							height="48"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
						>
							<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						<Text variant="heading-xl" render={ <span /> }>
							{ __(
								'Drop files to add to your workspace',
								'vip-workflows'
							) }
						</Text>
						{ /* wpds-allow R7 -- muted hint text (body-md token + fg-weak color; no Text color prop) */ }
						<span className="vip-workflows-ideation-workspace__drop-hint">
							{ __(
								'Images, videos, PDFs, and documents',
								'vip-workflows'
							) }
						</span>
					</Stack>
				</div>
			) }

			{ uploadQueue.length > 0 && (
				<Stack
					wrap="wrap"
					gap="sm"
					className="vip-workflows-ideation-workspace__upload-status"
				>
					{ uploadQueue.map( ( item, idx ) => (
						<span
							key={ idx }
							className={ `vip-workflows-ideation-workspace__upload-item vip-workflows-ideation-workspace__upload-item--${ item.status }` }
						>
							{ item.status === 'uploading' && <Spinner /> }
							{ item.status === 'done' && (
								<Icon icon={ checkIcon } size={ 16 } />
							) }
							{ item.status === 'error' && (
								<Icon icon={ closeSmall } size={ 16 } />
							) }{ ' ' }
							{ item.name }
						</span>
					) ) }
				</Stack>
			) }

			{ uploadErrors.map( ( err, idx ) => (
				<Snackbar
					key={ idx }
					className="vip-workflows-ideation-workspace__upload-error"
					onRemove={ () =>
						setUploadErrors( ( prev ) =>
							prev.filter( ( _, i ) => i !== idx )
						)
					}
				>
					{ err }
				</Snackbar>
			) ) }
			<TopBar
				state={ state }
				onBack={ onBack }
				onDelete={ handleDeleteProject }
				onCreateDraft={ handleCreateDraft }
				creatingDraft={ creatingDraft }
				runningQuery={ runningQuery }
				initialAssistants={ initialAssistants }
			/>

			<Stack
				direction="row"
				className="vip-workflows-ideation-workspace__body"
			>
				<div className="vip-workflows-ideation-workspace__main">
					<MoodBoard
						cards={ visibleCards }
						dismissedCards={ dismissedCards }
						pinnedIds={ state.pinned_ids || [] }
						projectId={ state.project_id }
						assistants={ state.assistants || {} }
						onPin={ pinCard }
						onDismiss={ dismissCard }
						onUnpin={ unpinCard }
						onRestore={ restoreCard }
						onDelete={ handleDeleteCard }
						onSummarize={ handleSummarize }
						onSourceAdded={ handleSourceAdded }
						onGenerateImage={ handleGenerateImage }
						onFindSimilar={ handleQuery }
						onRetry={ handleRetrySource }
						stuckIds={ stuckIds }
						isGenerating={ isGeneratingImage }
						initialAssistants={ initialAssistants }
						researchAbilities={ researchAbilities }
					/>

					<IdeationSummary
						summary={ projectSummary }
						keyPoints={ summaryKeyPoints }
						loading={ summaryLoading }
						generating={ summaryGenerating }
						onGenerate={ handleGenerateSummary }
						hasPinnedSources={
							( state.pinned_ids || [] ).length > 0
						}
					/>
				</div>

				<Button
					className="vip-workflows-ideation-workspace__panel-toggle"
					size="small"
					icon={ panelOpen ? chevronRight : chevronLeft }
					onClick={ () => setPanelOpen( ! panelOpen ) }
					label={
						panelOpen
							? __( 'Close agent panel', 'vip-workflows' )
							: __( 'Open agent panel', 'vip-workflows' )
					}
					showTooltip
				/>

				{ panelOpen && (
					// wpds-allow R7 -- app-shell panel scroll surface (fixed width/border/overflow, no flex)
					<div className="vip-workflows-ideation-workspace__panel">
						<AssistantPanel
							assistants={ state.assistants || {} }
							seedAnalysis={ state.seed_analysis || {} }
							mentorResult={ mentorResult }
							mentorSuggestions={ mentorSuggestions }
							mentorLoading={ mentorLoading }
							onRunMentor={ runMentor }
							onRunQuery={ handleQuery }
							autoRefresh={ autoRefresh }
							onToggleAutoRefresh={ setAutoRefresh }
							queryLog={ state.query_log || [] }
							runningQuery={ runningQuery }
							initialAssistants={ initialAssistants }
							researchAbilities={ researchAbilities }
							onRetryAssistant={ handleRetryAssistant }
							onRestartAnalysis={ handleRestartAnalysis }
						/>
					</div>
				) }
			</Stack>

			{ toolFailures && (
				<ToolFailuresModal
					title={ __( 'Transition Blocked', 'vip-workflows' ) }
					message={ toolFailures.message }
					hardFailures={ toolFailures.hardFailures.map(
						( failure ) => ( {
							tool: failure.tool_label || failure.tool,
							message: failure.message,
						} )
					) }
					softWarnings={ toolFailures.softWarnings.map(
						( warning ) => ( {
							tool: warning.tool_label || warning.tool,
							message: warning.message,
						} )
					) }
					onClose={ () => setToolFailures( null ) }
				/>
			) }

			{ softWarningsModal && (
				<ToolFailuresModal
					title={ __( 'Warnings', 'vip-workflows' ) }
					message={ __(
						'The following warnings were found. You can proceed or go back to fix them.',
						'vip-workflows'
					) }
					softWarnings={ ( softWarningsModal.warnings || [] ).map(
						( warning ) => ( {
							tool: warning.tool_label || warning.tool,
							message: warning.message,
						} )
					) }
					onClose={ () => setSoftWarningsModal( null ) }
					actions={
						<>
							<Button
								variant="tertiary"
								onClick={ () => setSoftWarningsModal( null ) }
							>
								{ __( 'Cancel', 'vip-workflows' ) }
							</Button>
							<Button
								variant="primary"
								onClick={ () => {
									const action = softWarningsModal.action;
									setSoftWarningsModal( null );
									if ( action === 'draft' ) {
										handleCreateDraft( true );
									}
								} }
							>
								{ __( 'Continue', 'vip-workflows' ) }
							</Button>
						</>
					}
				/>
			) }
		</Stack>
	);
}
