/**
 * Top Bar Component.
 *
 * Sticky bar carrying two things and nothing else: the project's identity, and
 * how far its agents have got.
 *
 * Topics and the news angle were removed on purpose. Both are already on screen
 * in full — the topics as the board's tag-cloud card, the angle in the Analysis
 * panel — so the header was showing a second, clipped copy of each while crowding
 * the seed text it sits next to into illegibility.
 */

import { __, sprintf } from '@wordpress/i18n';
import { Button, Icon } from '@wordpress/components';
import { Badge, Stack, Text, VisuallyHidden } from '@wordpress/ui';
import { arrowLeft, pencil, trash, caution } from '@wordpress/icons';

import { AgentRequirements } from '../../../common/AgentRequirements';
import { useConfirm } from '../../../common/use-confirm';

import './TopBar.css';

/**
 * Map an assistant's effective status to a Badge intent.
 *
 * `unavailable` deliberately reads neutral rather than sharing `failed`'s high
 * intent: nothing went wrong with the run, an agent's dependency is simply not
 * configured, and the reader is often an editor who cannot reach the screen where
 * it would be. A severity tone would frame a configuration state as an error the
 * reader caused.
 *
 * @param {string} status Effective assistant status.
 * @return {string} Badge intent.
 */
function statusIntent( status ) {
	switch ( status ) {
		case 'running':
			return 'informational';
		case 'completed':
			return 'stable';
		case 'failed':
			return 'high';
		case 'unavailable':
			return 'none';
		default:
			return 'none';
	}
}

/**
 * The word and the classes each status renders with.
 *
 * `className` lands on the row, `toneClassName` on the tone dot. They are separate
 * names rather than one name matched by descendant selector because the CSS
 * hygiene gate resolves every class in a selector back to the element carrying it,
 * and a shared name would read a dot's `background` as a `Stack` override.
 */
const STATUS_INDICATORS = {
	pending: {
		label: __( 'waiting…', 'vip-workflow' ),
		className: 'is-pending',
		toneClassName: 'is-tone-pending',
	},
	running: {
		label: __( 'searching…', 'vip-workflow' ),
		className: 'is-running',
		toneClassName: 'is-tone-running',
	},
	completed: {
		label: __( 'done', 'vip-workflow' ),
		className: 'is-completed',
		toneClassName: 'is-tone-completed',
	},
	failed: {
		label: __( 'failed', 'vip-workflow' ),
		className: 'is-failed',
		toneClassName: 'is-tone-failed',
	},
	// No `toneClassName`: an unavailable agent is not in the status row at all, and
	// its own line leads with a caution glyph rather than a tone dot.
	unavailable: {
		label: __( 'Setup needed', 'vip-workflow' ),
		className: 'is-unavailable',
	},
};

/**
 * Resolve one stored assistant entry into everything the row needs to render.
 *
 * The label comes from the server, beside the status, for every assistant the
 * project has stored — including one whose plugin has since been deactivated.
 * Building it here from the research-abilities response instead is what leaked raw
 * ability ids into the header: that response is a different population from the
 * stored map (it excludes the Seed Analyst entirely, and anything no longer
 * registered), so every id missing from it rendered as itself.
 *
 * @param {string} id                Ability name.
 * @param {Object} data              Stored assistant result, as returned by the ideation state.
 * @param {Object} runningQuery      The currently running follow-up query, if any.
 * @param {Object} initialAssistants Initial assistant statuses keyed by ability id.
 * @return {Object} `{ id, label, status, statusInfo, statusLabel, isActive, groups }`.
 */
function resolveAssistant( id, data, runningQuery, initialAssistants ) {
	const isQuerying = runningQuery?.assistant === id;
	const isActive =
		isQuerying ||
		initialAssistants[ id ] === 'running' ||
		data?.status === 'pending' ||
		data?.status === 'running';
	const status = isActive ? 'running' : data?.status || 'pending';
	const statusInfo = STATUS_INDICATORS[ status ] || STATUS_INDICATORS.pending;
	const cardCount = data?.card_count || 0;

	let statusLabel = statusInfo.label;
	if ( ! isActive && 'completed' === status && cardCount > 0 ) {
		statusLabel = sprintf(
			/* translators: %d: number of sources the agent found. */
			__( '%d found', 'vip-workflow' ),
			cardCount
		);
	}

	return {
		id,
		label: data?.label,
		status,
		statusInfo,
		statusLabel,
		/*
		 * A completed agent that found nothing has nothing to add beyond the dot's
		 * own tone, and five chips each reading "done" is the noise that made this
		 * row unreadable. The word is still exposed to assistive technology, so the
		 * status is never carried by colour alone.
		 */
		statusIsRedundant: 'completed' === status && 0 === cardCount,
		groups: data?.availability?.groups || [],
	};
}

/**
 * One agent's progress.
 *
 * Read-only throughout: a tone dot, the agent's name, and a status word. It
 * carries no background pill and no border, because a row of bordered pills each
 * holding a coloured badge is what read as a set of status toggles — none of these
 * is clickable, and the treatment now says so.
 *
 * @param {Object} props           Component props.
 * @param {Object} props.assistant A resolved assistant.
 * @return {JSX.Element} Agent status row item.
 */
function AgentStatus( { assistant } ) {
	const { statusInfo, statusLabel, statusIsRedundant, label, status } =
		assistant;

	return (
		<Stack
			render={ <span /> }
			align="center"
			gap="xs"
			className={ `vip-workflow-ideation-topbar__assistant ${ statusInfo.className }` }
		>
			{ /* wpds-allow R7 -- tone dot: a decorative disc, not text; no WPDS analog */ }
			<span
				className={ `vip-workflow-ideation-topbar__assistant-dot ${ statusInfo.toneClassName }` }
				aria-hidden="true"
			/>
			<Text variant="body-sm" render={ <span /> }>
				{ label }
			</Text>
			{ statusIsRedundant ? (
				<VisuallyHidden>{ statusLabel }</VisuallyHidden>
			) : (
				<Badge
					intent={ statusIntent( status ) }
					className="vip-workflow-ideation-topbar__assistant-status"
				>
					{ statusLabel }
				</Badge>
			) }
		</Stack>
	);
}

/**
 * An agent that cannot run, and what it is waiting on.
 *
 * Gets its own line rather than a place in the status row: "unavailable" on its
 * own was a dead end, and naming the unmet requirement takes a sentence.
 *
 * The requirement text is whatever the server phrased for *this* reader.
 * `AgentRequirements` is the same component the Agents and Tools screens render, so
 * a reader who has seen one recognises the others. For an editor the payload is the
 * user register — no `reason`, no destination, no admin URL — so they are told which
 * service is unconfigured and to ask an administrator, and are never handed a link
 * to a screen they cannot open.
 *
 * Destinations are suppressed outright, because the register follows the reader and
 * not the surface: an administrator reading here receives the admin register, whose
 * destination is an `in_card` hint pointing at settings fields that live on the
 * Agents screen and not in this header.
 *
 * @param {Object} props           Component props.
 * @param {Object} props.assistant A resolved assistant whose status is `unavailable`.
 * @return {JSX.Element} Unmet-agent row.
 */
function AgentUnavailable( { assistant } ) {
	const { label, statusInfo, groups } = assistant;

	return (
		<Stack
			direction="row"
			align="center"
			gap="xs"
			className="vip-workflow-ideation-topbar__assistant-unmet"
		>
			<Icon icon={ caution } size={ 16 } />
			<Text variant="body-sm" render={ <span /> }>
				{ label }
			</Text>
			<Badge
				intent={ statusIntent( 'unavailable' ) }
				className="vip-workflow-ideation-topbar__assistant-status"
			>
				{ statusInfo.label }
			</Badge>
			<AgentRequirements
				groups={ groups }
				ownerLabel={ label }
				showDestinations={ false }
			/>
		</Stack>
	);
}

/**
 * Sticky top bar for the ideation workspace.
 *
 * @param {Object}   props                   Component props.
 * @param {Object}   props.state             Ideation state.
 * @param {Function} props.onBack            Navigate back to landing.
 * @param {Function} props.onDelete          Delete the ideation project.
 * @param {Function} props.onCreateDraft     Create a draft from this ideation.
 * @param {boolean}  props.creatingDraft     Whether a draft is currently being created.
 * @param {Object}   props.runningQuery      The currently running follow-up query, if any.
 * @param {Object}   props.initialAssistants Initial assistant statuses keyed by ability id.
 * @return {JSX.Element} Top bar component.
 */
export default function TopBar( {
	state,
	onBack,
	onDelete,
	onCreateDraft,
	creatingDraft,
	runningQuery,
	initialAssistants = {},
} ) {
	// One confirm mechanic everywhere: the same useConfirm dialog the
	// assistant panel's Start over uses, replacing the armed double-click
	// (press to arm, press again inside 3s) this button carried — two
	// mechanics for equally destructive acts in one workspace.
	const [ confirm, confirmDialog ] = useConfirm();

	const handleDeleteClick = async () => {
		const proceed = await confirm(
			__(
				'This deletes the ideation project — its board, sources and analysis. This cannot be undone.',
				'vip-workflow'
			),
			{
				title: __( 'Delete this ideation?', 'vip-workflow' ),
				confirmLabel: __( 'Delete', 'vip-workflow' ),
				isDestructive: true,
			}
		);

		if ( proceed ) {
			onDelete();
		}
	};

	const pinnedCount = ( state.pinned_ids || [] ).length;
	const phaseConfig = window.vipWorkflowIdeation?.phaseConfig;
	const phaseTransitions = phaseConfig?.transitions || {};

	const assistants = Object.entries( state.assistants || {} ).map(
		( [ id, data ] ) =>
			resolveAssistant( id, data, runningQuery, initialAssistants )
	);
	const running = assistants.filter(
		( assistant ) => 'unavailable' !== assistant.status
	);
	const unmet = assistants.filter(
		( assistant ) => 'unavailable' === assistant.status
	);

	return (
		// wpds-allow R7 -- sticky app-shell surface bar (position/background/border)
		<div className="vip-workflow-ideation-topbar">
			<Stack
				direction="row"
				align="center"
				gap="md"
				className="vip-workflow-ideation-topbar__row vip-workflow-ideation-topbar__row--primary"
			>
				<Button
					icon={ arrowLeft }
					onClick={ onBack }
					label={ __( 'Back to Ideation', 'vip-workflow' ) }
					showTooltip
					className="vip-workflow-ideation-topbar__back"
				/>
				<Stack
					direction="row"
					align="baseline"
					gap="xs"
					className="vip-workflow-ideation-topbar__seed"
				>
					<Text
						variant="heading-sm"
						render={ <span /> }
						className="vip-workflow-ideation-topbar__seed-label vip-workflow-eyebrow"
					>
						{ __( 'Seed', 'vip-workflow' ) }
					</Text>
					{ /* wpds-allow R7 -- truncating heading label (font token + ellipsis, no Text prop) */ }
					<span className="vip-workflow-ideation-topbar__seed-text">
						{ state.seed }
					</span>
				</Stack>

				<Stack
					gap="sm"
					className="vip-workflow-ideation-topbar__actions"
				>
					<Button
						variant="tertiary"
						icon={ trash }
						onClick={ handleDeleteClick }
						className="vip-workflow-ideation-topbar__action vip-workflow-ideation-topbar__action--delete"
						isDestructive
					>
						{ __( 'Delete', 'vip-workflow' ) }
					</Button>
					{ phaseTransitions.editorial &&
						phaseTransitions.editorial.allowed && (
							<Button
								variant="primary"
								icon={ pencil }
								onClick={ () => onCreateDraft() }
								className="vip-workflow-ideation-topbar__action"
								isBusy={ creatingDraft }
								disabled={ creatingDraft }
							>
								{ creatingDraft
									? __( 'Creating…', 'vip-workflow' )
									: phaseTransitions.editorial.label ||
									  __( 'Create draft', 'vip-workflow' ) }
							</Button>
						) }
				</Stack>
			</Stack>

			{ assistants.length > 0 && (
				<Stack
					direction="column"
					gap="xs"
					className="vip-workflow-ideation-topbar__row vip-workflow-ideation-topbar__row--agents"
				>
					<Stack
						direction="row"
						wrap="wrap"
						align="center"
						gap="md"
						className="vip-workflow-ideation-topbar__assistants"
					>
						<Text
							variant="heading-sm"
							render={ <span /> }
							className="vip-workflow-eyebrow"
						>
							{ __( 'Agents', 'vip-workflow' ) }
						</Text>
						{ running.map( ( assistant ) => (
							<AgentStatus
								key={ assistant.id }
								assistant={ assistant }
							/>
						) ) }
						{ pinnedCount > 0 && (
							// wpds-allow R7 -- inline count; margin-auto alignment, no Text prop
							<span className="vip-workflow-ideation-topbar__pin-count">
								{ sprintf(
									/* translators: %d: number of cards the editor has pinned. */
									__( '%d pinned', 'vip-workflow' ),
									pinnedCount
								) }
							</span>
						) }
					</Stack>
					{ unmet.map( ( assistant ) => (
						<AgentUnavailable
							key={ assistant.id }
							assistant={ assistant }
						/>
					) ) }
				</Stack>
			) }
			{ confirmDialog }
		</div>
	);
}
