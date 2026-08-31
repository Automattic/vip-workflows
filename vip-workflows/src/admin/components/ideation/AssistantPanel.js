/**
 * Assistant Panel Component.
 *
 * Collapsible right-side panel showing what each assistant found
 * and the editorial mentor's guidance.
 */

import { useState, useCallback, useEffect, useRef } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	Spinner,
	ToggleControl,
	SelectControl,
	TextControl,
	Icon,
} from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { check } from '@wordpress/icons';

import { AgentRequirements } from '../../../common/AgentRequirements';
import { useConfirm } from '../../../common/use-confirm';
import { renderAssistantIcon } from './assistant-icon';

import './AssistantPanel.css';

export const SEED_ANALYST_ID = 'vip-workflows/seed-analyst';

const READINESS_LABELS = {
	'needs-context': {
		text: __( 'Needs more context', 'vip-workflows' ),
		className: 'is-needs-context',
	},
	developing: {
		text: __( 'Developing', 'vip-workflows' ),
		className: 'is-developing',
	},
	'looking-solid': {
		text: __( 'Looking solid', 'vip-workflows' ),
		className: 'is-looking-solid',
	},
	'ready-to-pitch': {
		text: __( 'Ready to pitch', 'vip-workflows' ),
		className: 'is-ready',
	},
};

/**
 * Resolve the status label shown next to an assistant.
 *
 * @param {string} effectiveStatus The assistant's effective status.
 * @param {number} cardCount       Number of cards the assistant found.
 * @return {JSX.Element|string|null} The status label, or null to render nothing.
 */
function getAssistantStatusLabel( effectiveStatus, cardCount ) {
	if ( effectiveStatus === 'completed' ) {
		return (
			<>
				<Icon icon={ check } size={ 14 } />
				{ cardCount > 0 &&
					` ${ sprintf(
						// translators: %d: number of cards found.
						__( '%d found', 'vip-workflows' ),
						cardCount
					) }` }
			</>
		);
	}
	if ( effectiveStatus === 'running' ) {
		return null;
	}
	if ( effectiveStatus === 'pending' ) {
		return __( 'waiting…', 'vip-workflows' );
	}
	return effectiveStatus;
}

/**
 * Resolve the result label for a follow-up query thread entry.
 *
 * @param {string} status    The query entry's status.
 * @param {number} cardCount Number of cards the query found.
 * @return {string} The result label.
 */
function getQueryResultLabel( status, cardCount ) {
	if ( status !== 'completed' ) {
		return __( 'failed', 'vip-workflows' );
	}
	return cardCount > 0
		? `${ __( 'found', 'vip-workflows' ) } ${ cardCount }`
		: __( 'found nothing', 'vip-workflows' );
}

/**
 * Why an agent could not run, phrased for whoever is reading it.
 *
 * The requirement rendering itself is `AgentRequirements`, shared with the Agents
 * card and the AI-stage picker — a reader who has seen one should recognise the
 * others, and a second implementation here is how they drift apart. What stays
 * local is the surrounding treatment this surface owns: the stored generic line
 * for an agent that reported no requirements at all, and the neutral body style
 * rather than the error style, because an unconfigured dependency is a
 * configuration state and not a failure the reader caused.
 *
 * @param {Object}  props                Component props.
 * @param {Object}  props.availability   Serialized availability for this reader.
 * @param {?string} props.genericMessage Line stored for an agent that reported no
 *                                       requirements (a legacy bool callback).
 * @param {string}  props.ownerLabel     This assistant's name, to suppress
 *                                       self-referential source attribution.
 * @return {JSX.Element|null} Requirement rows, or null when there is nothing to say.
 */
function UnavailableDetail( { availability, genericMessage, ownerLabel } ) {
	const groups = availability?.groups || [];

	if ( groups.length === 0 ) {
		return genericMessage ? (
			<Text variant="body-sm" render={ <p /> }>
				{ genericMessage }
			</Text>
		) : null;
	}

	return <AgentRequirements groups={ groups } ownerLabel={ ownerLabel } />;
}

/**
 * Re-run one agent whose dependency was unmet.
 *
 * "Try again" and not "Re-check": this runs the agent, and a successful run is
 * what replaces the stored `unavailable` result. There is nothing to re-check
 * separately — the run re-gates availability on its way through.
 *
 * Busy and failure state are owned here rather than by the panel so that one
 * agent's retry cannot mark another one busy. A response that lands after this
 * row unmounted, or after a newer click superseded it, writes nothing.
 *
 * @param {Object}   props             Component props.
 * @param {string}   props.assistantId Ability name to re-run.
 * @param {Function} props.onRetry     Runs the agent; rejects when the run failed.
 * @param {boolean}  props.disabled    Whether this agent is already running.
 * @return {JSX.Element} The retry control.
 */
function UnavailableRetry( { assistantId, onRetry, disabled } ) {
	const [ retrying, setRetrying ] = useState( false );
	const [ retryFailed, setRetryFailed ] = useState( false );
	const generation = useRef( 0 );
	const mounted = useRef( true );

	useEffect( () => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, [] );

	const handleRetry = async () => {
		if ( retrying || disabled ) {
			return;
		}

		const current = ++generation.current;

		setRetrying( true );
		setRetryFailed( false );

		try {
			await onRetry( assistantId );
		} catch {
			if ( ! mounted.current || current !== generation.current ) {
				return;
			}
			// Prior state is preserved: nothing on screen is discarded.
			setRetryFailed( true );
		} finally {
			if ( mounted.current && current === generation.current ) {
				setRetrying( false );
			}
		}
	};

	return (
		<Stack
			direction="column"
			gap="xs"
			className="vip-workflows-ideation-panel__assistant-retry"
		>
			<Button
				variant="secondary"
				size="small"
				onClick={ handleRetry }
				isBusy={ retrying }
				disabled={ retrying || disabled }
			>
				{ retrying
					? __( 'Retrying…', 'vip-workflows' )
					: __( 'Retry', 'vip-workflows' ) }
			</Button>
			{ retryFailed && (
				<Text
					variant="body-sm"
					render={ <p /> }
					className="vip-workflows-ideation-panel__assistant-error"
				>
					{ __(
						'The agent could not run. Nothing changed.',
						'vip-workflows'
					) }
				</Text>
			) }
		</Stack>
	);
}

/**
 * Start the seed analysis over, from any state.
 *
 * Offered unconditionally rather than only for an `unavailable` analyst: a
 * project whose analysis completed against a misconfigured provider, or which
 * produced a board the writer has since outgrown, is just as stuck, and the
 * analyst is the one agent with no per-agent retry — it is not a registered
 * ability, so the panel never receives live availability for it.
 *
 * It is also the destructive control on this panel. A completed run replaces the
 * whole board, so it is gated on a confirmation that names what goes, and busy
 * and failure state are owned here for the same reasons the per-agent retry owns
 * its own: a response landing after this row unmounted writes nothing.
 *
 * @param {Object}   props           Component props.
 * @param {Function} props.onRestart Runs the analysis; rejects when it did not
 *                                   complete, in which case nothing was replaced.
 * @param {boolean}  props.disabled  Whether the analyst is already running.
 * @return {JSX.Element} The restart control.
 */
function SeedAnalystRestart( { onRestart, disabled } ) {
	const [ confirm, confirmDialog ] = useConfirm();
	const [ restarting, setRestarting ] = useState( false );
	const [ restartFailed, setRestartFailed ] = useState( false );
	const generation = useRef( 0 );
	const mounted = useRef( true );

	useEffect( () => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, [] );

	const handleRestart = async () => {
		if ( restarting || disabled ) {
			return;
		}

		const proceed = await confirm(
			__(
				'Re-running replaces the seed analysis and every board card, and re-runs every research agent. Pinned board cards will be lost. Sources stay on the board, and anything an agent finds again lands on the source it already added rather than a copy.',
				'vip-workflows'
			),
			{
				title: __( 'Start the analysis over?', 'vip-workflows' ),
				confirmLabel: __( 'Start over', 'vip-workflows' ),
				isDestructive: true,
			}
		);

		if ( ! proceed || ! mounted.current ) {
			return;
		}

		const current = ++generation.current;

		setRestarting( true );
		setRestartFailed( false );

		try {
			await onRestart();
		} catch {
			if ( ! mounted.current || current !== generation.current ) {
				return;
			}
			// Nothing was replaced: what is on screen is still the prior analysis.
			setRestartFailed( true );
		} finally {
			if ( mounted.current && current === generation.current ) {
				setRestarting( false );
			}
		}
	};

	return (
		<Stack
			direction="column"
			gap="xs"
			className="vip-workflows-ideation-panel__assistant-retry"
		>
			<Button
				variant="secondary"
				size="small"
				// Replaces the analysis and every board card, pinned ones
				// included — its confirm already says so destructively; the
				// trigger now matches.
				isDestructive
				onClick={ handleRestart }
				isBusy={ restarting }
				disabled={ restarting || disabled }
			>
				{ restarting
					? __( 'Starting over…', 'vip-workflows' )
					: __( 'Start over', 'vip-workflows' ) }
			</Button>
			{ restartFailed && (
				<Text
					variant="body-sm"
					render={ <p /> }
					className="vip-workflows-ideation-panel__assistant-error"
				>
					{ __(
						'The analysis could not run. Nothing changed.',
						'vip-workflows'
					) }
				</Text>
			) }
			{ confirmDialog }
		</Stack>
	);
}

/**
 * Order, icons, working messages and follow-up options, from the abilities list.
 *
 * No label map: an agent's display name comes from the stored assistant entry the
 * row is already rendering (`data.label`), resolved server-side by
 * `IdeationOrchestrator::resolve_assistant_label()`. That is the only population
 * that covers every row — the analyst is not an ability, and an agent whose plugin
 * was deactivated after its run is in no abilities response at all.
 *
 * The follow-up dropdown is the one thing that cannot come from there: it offers
 * every *runnable* agent, including ones with no stored result yet, so it reads the
 * abilities response. It takes `label`, which is the human name. `name` is the
 * ability *identifier* — `WP_Ability::get_name()` — so the previous
 * `a.name || a.label || a.id` precedence resolved to the id every single time and
 * no label ever won.
 *
 * `enabled` is read for exactly the two things that start an agent — the dropdown
 * and the retry control, via `runnable` — and for nothing else. A turned-off agent
 * still gets a row, an icon and a name, because it may well have found what is on
 * the board; what it does not get is a way to be run again.
 *
 * @param {Array} researchAbilities Research abilities from the API.
 * @return {Object} `{ order, icons, workingMessages, options, runnable }`.
 */
function buildAssistantMaps( researchAbilities ) {
	const order = [ SEED_ANALYST_ID ];
	const icons = {};
	const workingMessages = {};
	const runnable = new Set();
	const options = [ { label: __( 'Auto', 'vip-workflows' ), value: 'auto' } ];

	( researchAbilities || [] ).forEach( ( a ) => {
		order.push( a.id );
		icons[ a.id ] = a.icon || 'search';
		workingMessages[ a.id ] =
			a.thinking_message || __( 'Working…', 'vip-workflows' );

		if ( a.enabled ) {
			runnable.add( a.id );
			options.push( { label: a.label, value: a.id } );
		}
	} );

	return { order, icons, workingMessages, options, runnable };
}

/**
 * Assistant panel showing assistant results and mentor guidance.
 *
 * @param {Object}   props                     Component props.
 * @param {Object}   props.assistants          Assistant results map keyed by ability id.
 * @param {Object}   props.seedAnalysis        Seed analysis metadata.
 * @param {Object}   props.mentorResult        Latest mentor evaluation result.
 * @param {Array}    props.mentorSuggestions   Suggested follow-up queries from the mentor.
 * @param {boolean}  props.mentorLoading       Whether the mentor is currently evaluating.
 * @param {Function} props.onRunMentor         Trigger a mentor evaluation.
 * @param {Function} props.onRunQuery          Run a follow-up query against an assistant.
 * @param {boolean}  props.autoRefresh         Whether mentor auto-refresh is enabled.
 * @param {Function} props.onToggleAutoRefresh Toggle mentor auto-refresh.
 * @param {Array}    props.queryLog            Log of completed follow-up queries.
 * @param {Object}   props.runningQuery        The currently running follow-up query, if any.
 * @param {Object}   props.initialAssistants   Initial assistant statuses keyed by ability id.
 * @param {Array}    props.researchAbilities   Research abilities from the API.
 * @param {Function} props.onRetryAssistant    Re-run a single assistant by ability id.
 * @param {Function} props.onRestartAnalysis   Re-run the seed analysis from scratch.
 * @return {JSX.Element} Assistant panel component.
 */
export default function AssistantPanel( {
	assistants,
	seedAnalysis,
	mentorResult,
	mentorSuggestions,
	mentorLoading,
	onRunMentor,
	onRunQuery,
	autoRefresh,
	onToggleAutoRefresh,
	queryLog,
	runningQuery,
	initialAssistants = {},
	researchAbilities = [],
	onRetryAssistant,
	onRestartAnalysis,
} ) {
	const {
		order: ASSISTANT_ORDER,
		icons: ASSISTANT_ICONS,
		workingMessages: ASSISTANT_WORKING_MESSAGES,
		options: ASSISTANT_OPTIONS,
		runnable: ASSISTANT_RUNNABLE,
	} = buildAssistantMaps( researchAbilities );

	/**
	 * Name one agent, for the query thread.
	 *
	 * A thread entry names the agent it queried by ability id, and querying an
	 * agent writes its stored result — so the stored map is guaranteed to hold a
	 * label for it, and is the same source the rows above use.
	 *
	 * @param {string} assistantId Ability name.
	 * @return {string} The agent's display name.
	 */
	const assistantLabel = ( assistantId ) => assistants[ assistantId ]?.label;

	const mentorGuidance =
		mentorResult?.cards?.[ 0 ]?.guidance || mentorResult?.summary;
	const mentorError = mentorResult?.error;
	const mentorReadiness =
		mentorResult?.meta?.readiness || mentorResult?.cards?.[ 0 ]?.readiness;
	const readinessInfo = READINESS_LABELS[ mentorReadiness ];

	const getMentorContent = () => {
		if ( mentorLoading ) {
			return (
				<Stack
					align="center"
					gap="sm"
					className="vip-workflows-ideation-panel__mentor-loading"
				>
					<Spinner />
					<span>{ __( 'Evaluating…', 'vip-workflows' ) }</span>
				</Stack>
			);
		}
		if ( mentorGuidance ) {
			return (
				<Text variant="body-md" render={ <p /> }>
					{ mentorGuidance }
				</Text>
			);
		}
		if ( mentorError ) {
			return (
				<Text
					variant="body-md"
					render={ <p /> }
					className="vip-workflows-ideation-panel__mentor-error"
				>
					{ mentorError }
				</Text>
			);
		}
		if ( ! mentorResult ) {
			if ( ! autoRefresh ) {
				return (
					<Text
						variant="body-md"
						render={ <p /> }
						className="vip-workflows-ideation-panel__mentor-placeholder"
					>
						{ __(
							'Auto-refresh is paused. Click "Refresh guidance" to run manually.',
							'vip-workflows'
						) }
					</Text>
				);
			}
			return (
				<Text
					variant="body-md"
					render={ <p /> }
					className="vip-workflows-ideation-panel__mentor-placeholder"
				>
					{ __( 'Mentor is warming up…', 'vip-workflows' ) }
				</Text>
			);
		}
		return (
			<Text
				variant="body-md"
				render={ <p /> }
				className="vip-workflows-ideation-panel__mentor-placeholder"
			>
				{ __(
					'Click "Refresh guidance" to get editorial feedback.',
					'vip-workflows'
				) }
			</Text>
		);
	};

	return (
		<Stack
			className="vip-workflows-ideation-panel"
			direction="column"
			gap="lg"
		>
			<div className="vip-workflows-ideation-panel__header">
				<Text
					variant="heading-sm"
					render={ <h3 /> }
					className="vip-workflows-ideation-panel__title vip-workflows-eyebrow"
				>
					{ __( 'Agents', 'vip-workflows' ) }
				</Text>
			</div>

			{ /* Mentor Section */ }
			{ /* wpds-allow R7 -- flex-column surface panel carrying the shared vip-workflows-panel-surface binding; kept as <div> to avoid rebinding that utility to a component */ }
			<div className="vip-workflows-ideation-panel__mentor vip-workflows-panel-surface">
				<Stack align="center" gap="sm">
					{ /* wpds-allow R7 -- emoji icon sized via font-size token; no Text variant for the glyph */ }
					<span className="vip-workflows-ideation-panel__mentor-icon">
						&#x1F393;
					</span>
					{ /* wpds-allow R7 -- bold inline label (heading-md token); no matching Text variant */ }
					<span className="vip-workflows-ideation-panel__mentor-label">
						{ __( 'Editorial Mentor', 'vip-workflows' ) }
					</span>
					{ readinessInfo && (
						// wpds-allow R7 -- status pill with semantic bg/color per readiness state; styled inline label
						<span
							className={ `vip-workflows-ideation-panel__readiness ${ readinessInfo.className }` }
						>
							{ readinessInfo.text }
						</span>
					) }
				</Stack>
				{ getMentorContent() }
				{ mentorSuggestions &&
					mentorSuggestions.length > 0 &&
					! mentorLoading && (
						<Stack direction="column" gap="sm">
							{ mentorSuggestions.map( ( suggestion, idx ) => (
								<Button
									key={ idx }
									size="small"
									className="vip-workflows-ideation-panel__suggestion-btn"
									onClick={ () =>
										onRunQuery &&
										onRunQuery(
											suggestion.assistant,
											suggestion.query
										)
									}
									disabled={ !! runningQuery }
								>
									{ /* wpds-allow R7 -- emoji icon sized via font-size token; no Text variant for the glyph */ }
									<span className="vip-workflows-ideation-panel__suggestion-icon">
										{ renderAssistantIcon(
											ASSISTANT_ICONS[
												suggestion.assistant
											] || 'search'
										) }
									</span>
									{ suggestion.label }
								</Button>
							) ) }
						</Stack>
					) }
				<Stack align="center" gap="xs">
					<Button
						variant="tertiary"
						onClick={ onRunMentor }
						disabled={ mentorLoading }
						className="vip-workflows-ideation-panel__mentor-refresh"
						size="small"
					>
						{ __( 'Refresh guidance', 'vip-workflows' ) }
					</Button>
					<ToggleControl
						checked={ autoRefresh }
						onChange={ onToggleAutoRefresh }
						className="vip-workflows-ideation-panel__mentor-auto-toggle"
						__nextHasNoMarginBottom
					/>
					{ /* wpds-allow R7 -- inline status label (Auto/Paused); min-width reserves space against layout shift */ }
					<span className="vip-workflows-ideation-panel__mentor-auto-label">
						{ autoRefresh
							? __( 'Auto', 'vip-workflows' )
							: __( 'Paused', 'vip-workflows' ) }
					</span>
				</Stack>
			</div>

			{ /* Seed Analysis */ }
			{ seedAnalysis?.news_angle && (
				<div className="vip-workflows-ideation-panel__section">
					<Text
						variant="heading-sm"
						render={ <h4 /> }
						className="vip-workflows-ideation-panel__section-title"
					>
						{ __( 'News Angle', 'vip-workflows' ) }
					</Text>
					<Text variant="body-md" render={ <p /> }>
						{ seedAnalysis.news_angle }
					</Text>
				</div>
			) }

			{ seedAnalysis?.entities &&
				Object.keys( seedAnalysis.entities ).some(
					( k ) => seedAnalysis.entities[ k ]?.length > 0
				) && (
					<div className="vip-workflows-ideation-panel__section">
						<Text
							variant="heading-sm"
							render={ <h4 /> }
							className="vip-workflows-ideation-panel__section-title"
						>
							{ __( 'Entities', 'vip-workflows' ) }
						</Text>
						<Stack direction="column" gap="xs">
							{ Object.entries( seedAnalysis.entities ).map(
								( [ category, items ] ) => {
									if ( ! items?.length ) {
										return null;
									}
									return (
										// wpds-allow R7 -- styled inline row: bold label + comma-joined items (body-sm)
										<div
											key={ category }
											className="vip-workflows-ideation-panel__entity-group"
										>
											{ /* wpds-allow R7 -- bold capitalized inline category label; no Text variant */ }
											<span className="vip-workflows-ideation-panel__entity-label">
												{ category }:
											</span>
											{ /* wpds-allow R7 -- inline items text with a small offset from the label */ }
											<span className="vip-workflows-ideation-panel__entity-items">
												{ items.join( ', ' ) }
											</span>
										</div>
									);
								}
							) }
						</Stack>
					</div>
				) }

			{ /* Assistant Results */ }
			<Stack direction="column" gap="sm">
				{ ASSISTANT_ORDER.map( ( id ) => {
					const data = assistants[ id ];
					if ( ! data ) {
						return null;
					}

					const isWorking =
						initialAssistants[ id ] === 'running' ||
						data.status === 'pending' ||
						data.status === 'running';
					const effectiveStatus = isWorking ? 'running' : data.status;
					const icon = ASSISTANT_ICONS[ id ] || '';

					return (
						// wpds-allow R7 -- flex-column surface card kept as <div> (owns its bg/border/radius chrome)
						<div
							key={ id }
							className={ `vip-workflows-ideation-panel__assistant ${
								isWorking ? 'is-working' : ''
							}` }
						>
							<Stack align="center" justify="space-between">
								{ icon && (
									// wpds-allow R7 -- assistant icon (dashicon slug or emoji) sized via font-size token; no Text variant for the glyph
									<span className="vip-workflows-ideation-panel__assistant-icon">
										{ renderAssistantIcon( icon ) }
									</span>
								) }
								{ /* wpds-allow R7 -- inline assistant name label (body-sm); no Text variant */ }
								<span className="vip-workflows-ideation-panel__assistant-name">
									{ data.label }
								</span>
								<span
									className={ `vip-workflows-ideation-panel__assistant-status is-${ effectiveStatus }` }
								>
									{ getAssistantStatusLabel(
										effectiveStatus,
										data.card_count
									) }
								</span>
							</Stack>
							{ effectiveStatus === 'running' && (
								<Stack align="center" gap="sm">
									<Stack
										render={ <span /> }
										direction="row"
										align="center"
										gap="xs"
										className="vip-workflows-ideation-panel__working-dots"
									>
										<span />
										<span />
										<span />
									</Stack>
									{ /* wpds-allow R7 -- italic brand-colored working message; no Text variant */ }
									<span className="vip-workflows-ideation-panel__working-text">
										{ ASSISTANT_WORKING_MESSAGES[ id ] ||
											__( 'Working…', 'vip-workflows' ) }
									</span>
								</Stack>
							) }
							{ effectiveStatus !== 'running' && data.summary && (
								<Text
									variant="body-sm"
									render={ <p /> }
									className="vip-workflows-ideation-panel__assistant-summary"
								>
									{ data.summary }
								</Text>
							) }
							{ effectiveStatus === 'unavailable' && (
								<>
									<UnavailableDetail
										availability={ data.availability }
										genericMessage={ data.error }
										ownerLabel={ data.label }
									/>
									{ /*
									 * Only offered when the stored result came back with
									 * live availability. Without it the agent's plugin is
									 * gone, and re-running cannot bring it back — and a
									 * turned-off agent is not offered it either, since
									 * running it is precisely what an administrator has
									 * said no to.
									 */ }
									{ onRetryAssistant &&
										data.availability &&
										ASSISTANT_RUNNABLE.has( id ) && (
											<UnavailableRetry
												assistantId={ id }
												onRetry={ onRetryAssistant }
												disabled={ isWorking }
											/>
										) }
								</>
							) }
							{ data.error &&
								effectiveStatus !== 'running' &&
								effectiveStatus !== 'unavailable' && (
									<Text
										variant="body-sm"
										render={ <p /> }
										className="vip-workflows-ideation-panel__assistant-error"
									>
										{ data.error }
									</Text>
								) }
							{ /*
							 * Last in the row, so whatever the analyst has to say
							 * about its own state is read before the control that
							 * discards it.
							 */ }
							{ id === SEED_ANALYST_ID && onRestartAnalysis && (
								<SeedAnalystRestart
									onRestart={ onRestartAnalysis }
									disabled={ isWorking }
								/>
							) }
						</div>
					);
				} ) }
			</Stack>

			{ /* Query Thread */ }
			{ ( ( queryLog && queryLog.length > 0 ) || runningQuery ) && (
				<Stack
					direction="column"
					gap="sm"
					className="vip-workflows-ideation-panel__thread"
				>
					<Text
						variant="heading-sm"
						render={ <h4 /> }
						className="vip-workflows-ideation-panel__section-title"
					>
						{ __( 'Follow-up Queries', 'vip-workflows' ) }
					</Text>
					{ ( queryLog || [] ).map( ( entry ) => (
						<Stack
							direction="column"
							gap="xs"
							key={ entry.id }
							className="vip-workflows-ideation-panel__thread-entry"
						>
							{ /* wpds-allow R7 -- bold quoted query text (::before/after quotes); no Text variant */ }
							<span className="vip-workflows-ideation-panel__thread-query">
								{ entry.query }
							</span>
							<Stack
								render={ <span /> }
								align="center"
								gap="xs"
								className="vip-workflows-ideation-panel__thread-result"
							>
								{ assistantLabel( entry.assistant ) }{ ' ' }
								{ getQueryResultLabel(
									entry.status,
									entry.card_count
								) }
							</Stack>
						</Stack>
					) ) }
					{ runningQuery && (
						<Stack
							direction="column"
							gap="xs"
							className="vip-workflows-ideation-panel__thread-entry is-running"
						>
							{ /* wpds-allow R7 -- bold quoted query text (::before/after quotes); no Text variant */ }
							<span className="vip-workflows-ideation-panel__thread-query">
								{ runningQuery.query }
							</span>
							<Stack
								render={ <span /> }
								align="center"
								gap="xs"
								className="vip-workflows-ideation-panel__thread-result"
							>
								<Spinner />
								{ assistantLabel(
									runningQuery.assistant
								) }{ ' ' }
								{ __( 'searching…', 'vip-workflows' ) }
							</Stack>
						</Stack>
					) }
				</Stack>
			) }

			{ /* Follow-up Query Input */ }
			<QueryInput
				onSubmit={ onRunQuery }
				disabled={ !! runningQuery }
				assistantOptions={ ASSISTANT_OPTIONS }
			/>
		</Stack>
	);
}

function QueryInput( { onSubmit, disabled, assistantOptions = [] } ) {
	const [ query, setQuery ] = useState( '' );
	const [ assistant, setAssistant ] = useState( 'auto' );

	const resolveAssistant = useCallback( ( q, selected ) => {
		if ( selected !== 'auto' ) {
			return selected;
		}
		const lower = q.toLowerCase();
		if ( /image|photo|picture|visual|graphic/.test( lower ) ) {
			return 'vip-workflows/media-scout';
		}
		if ( /video|youtube|clip|footage/.test( lower ) ) {
			return 'vip-workflows/media-scout';
		}
		if (
			/archive|our (article|post|coverage)|previous|past/.test( lower )
		) {
			return 'vip-workflows/archive-scout';
		}
		return 'vip-workflows/web-researcher';
	}, [] );

	const handleSubmit = useCallback( () => {
		const trimmed = query.trim();
		if ( ! trimmed || ! onSubmit ) {
			return;
		}
		onSubmit( resolveAssistant( trimmed, assistant ), trimmed );
		setQuery( '' );
	}, [ query, assistant, onSubmit, resolveAssistant ] );

	const handleKeyDown = useCallback(
		( e ) => {
			if ( e.key === 'Enter' && ! e.shiftKey ) {
				e.preventDefault();
				handleSubmit();
			}
		},
		[ handleSubmit ]
	);

	return (
		<Stack
			direction="column"
			gap="sm"
			className="vip-workflows-ideation-panel__query-input"
		>
			<Stack gap="sm" className="vip-workflows-ideation-panel__query-row">
				<TextControl
					value={ query }
					onChange={ setQuery }
					placeholder={ __(
						'Ask an agent to find more…',
						'vip-workflows'
					) }
					onKeyDown={ handleKeyDown }
					disabled={ disabled }
					__nextHasNoMarginBottom
					__next40pxDefaultSize
				/>
				<SelectControl
					value={ assistant }
					options={ assistantOptions }
					onChange={ setAssistant }
					className="vip-workflows-ideation-panel__query-assistant"
					disabled={ disabled }
					__nextHasNoMarginBottom
					__next40pxDefaultSize
				/>
			</Stack>
			<Button
				variant="primary"
				onClick={ handleSubmit }
				isBusy={ disabled }
				disabled={ disabled || ! query.trim() }
				className="vip-workflows-ideation-panel__query-submit"
				size="small"
			>
				{ __( 'Search', 'vip-workflows' ) }
			</Button>
		</Stack>
	);
}
