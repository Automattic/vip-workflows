/**
 * AssistantCard
 *
 * One card per agent on the Agents screen — one per plugin, regardless of
 * whether the plugin provides research abilities, discovery providers, or both.
 *
 * The card holds its own draft and reports two things upward: whether it has
 * unsaved work, and how to save it. The screen's one Save calls back into every
 * dirty card, so the card owns the request and the header owns the decision to
 * make it. See docs/guides/settings-standard.md.
 *
 * Plugins inject a custom settings UI via the `vipWorkflow.assistantSettings`
 * JS filter. When no custom component is provided, settings fields are
 * auto-rendered from the assistant's `settings_schema`.
 *
 * An unavailable agent renders its structured `availability` requirements —
 * what is missing, which capabilities need it, and where to satisfy it — plus a
 * re-check control. The requirement block sits above the plugin settings branch
 * on purpose: a plugin supplying its own settings UI still needs it. It is also
 * the card's only statement of that state: a "Setup needed" badge above it was
 * one signal shown twice, and the requirements name *which* requirement is
 * unmet, so they are what stayed.
 *
 * @package
 */

import { useState, useEffect, useRef, useCallback } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Button, ToggleControl, Notice } from '@wordpress/components';
import { Card, Stack, Text } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { applyFilters } from '@wordpress/hooks';
import { AgentRequirements } from '../../common/AgentRequirements';
import { SchemaSettings } from './SchemaSettings';

import './AssistantCard.css';

/*
 * What each capability lets the agent do, phrased to sit inside a sentence.
 * These were a row of badges — `Research`, `Discovery`, `Available in AI stage`
 * — but a capability is a fact about the agent, not runtime state anyone can
 * act on, and the third was a whole sentence in a pill.
 */
const CAPABILITY_LABELS = {
	research: __( 'research', 'vip-workflow' ),
	discovery: __( 'story discovery', 'vip-workflow' ),
	stage: __( 'AI stage automation', 'vip-workflow' ),
};

/**
 * Which plugin an agent came from, for the card subtitle.
 *
 * Derived rather than read from `slug`: an entry slug is an addressing key and
 * carries the whole ability id, so rendering it would read as
 * "workflow-assistant-wikipedia-wikipedia". The vendor prefix is what actually
 * identifies the source plugin.
 *
 * @param {Object} assistant Assistant entry.
 * @return {string} Plugin identifier.
 */
function originLabel( assistant ) {
	const abilityId = assistant.ability_ids?.[ 0 ];

	if ( abilityId ) {
		return abilityId.split( '/' )[ 0 ];
	}

	return assistant.provider_slugs?.[ 0 ] ?? assistant.slug;
}

/**
 * The server-owned half of an entry: recomputed on every read, never edited here.
 *
 * @param {Object} entry Assistant entry.
 * @return {Object} Availability fields only.
 */
function availabilityOf( entry ) {
	return {
		available: entry.available,
		availability: entry.availability,
		availability_state: entry.availability_state,
		availability_sources: entry.availability_sources,
	};
}

/**
 * The user-owned half of an entry: what Save writes, and what dirtiness means.
 *
 * @param {Object} entry Assistant entry.
 * @return {Object} Editable fields only.
 */
function editableOf( entry ) {
	return { enabled: entry.enabled, options: entry.options };
}

/**
 * One agent.
 *
 * @param {Object}   props               Component props.
 * @param {Object}   props.assistant     The agent, as the REST list returned it.
 * @param {Function} props.onUpdate      Called with the saved agent.
 * @param {Function} props.onDirtyChange Called with ( slug, hasChanges ).
 * @param {Function} props.registerSave  Called with ( slug, saveFn ).
 * @param {Function} props.onError       Called with a message when a card action fails.
 * @return {JSX.Element} The agent card.
 */
export function AssistantCard( {
	assistant,
	onUpdate,
	onDirtyChange,
	registerSave,
	onError,
} ) {
	const [ local, setLocal ] = useState( assistant );
	const [ saving, setSaving ] = useState( false );
	const [ pluginHasChanges, setPluginHasChanges ] = useState( false );
	const [ pluginSaveHandler, setPluginSaveHandler ] = useState( null );
	const [ rechecking, setRechecking ] = useState( false );

	/*
	 * Availability arrives from the list, which refetches whenever the Agents
	 * screen regains the foreground. `useState( assistant )` seeds once, so
	 * without this the card keeps rendering the unmet requirements the refetch
	 * exists to clear. Only the server-owned fields are merged: an in-progress
	 * edit to `enabled` or `options` must survive a refresh it did not ask for.
	 */
	useEffect( () => {
		setLocal( ( prev ) => ( { ...prev, ...availabilityOf( assistant ) } ) );
	}, [ assistant ] );

	/*
	 * Dirtiness is measured over the editable fields alone. Comparing whole
	 * entries would let a server-driven availability refresh enable the screen's
	 * Save for edits the user never made.
	 */
	const ownChanges =
		JSON.stringify( editableOf( local ) ) !==
		JSON.stringify( editableOf( assistant ) );
	const hasChanges = ownChanges || pluginHasChanges;

	useEffect( () => {
		onDirtyChange( assistant.slug, hasChanges );
	}, [ assistant.slug, hasChanges, onDirtyChange ] );

	// A card that leaves the screen takes its dirty flag with it. Without this
	// an agent (or tool) that the list's refetch drops while it had unsaved
	// edits leaves its id in the screen's dirty set for good: Save stays
	// enabled with nothing on screen to save, and pressing it calls a save
	// closure for a card that is gone. Unmount-only — the deps are stable, so
	// this never runs between edits.
	useEffect(
		() => () => onDirtyChange( assistant.slug, false ),
		[ assistant.slug, onDirtyChange ]
	);

	/*
	 * Re-check and Save both write the entry, so a Re-check GET issued before a
	 * Save completes could land afterwards and overwrite what was just saved.
	 * Each write bumps the generation; only a response from the newest one is
	 * allowed to apply.
	 */
	const writeGeneration = useRef( 0 );

	const handleToggle = ( value ) => {
		setLocal( ( prev ) => ( { ...prev, enabled: value } ) );
	};

	const handleOptionChange = ( key, value ) => {
		setLocal( ( prev ) => ( {
			...prev,
			options: { ...( prev.options || {} ), [ key ]: value },
		} ) );
	};

	/*
	 * Errors are deliberately re-thrown rather than caught: the screen's one
	 * Save walks every dirty card and collects what failed, so a partial failure
	 * can name the agents it happened to in a single Notice.
	 */
	const save = useCallback( async () => {
		const generation = ++writeGeneration.current;

		setSaving( true );

		try {
			const updated = await apiFetch( {
				path: `/vip-workflow/v1/assistants/${ encodeURIComponent(
					assistant.slug
				) }/settings`,
				method: 'POST',
				data: {
					enabled: local.enabled,
					options: local.options || {},
				},
			} );

			if ( pluginSaveHandler ) {
				await pluginSaveHandler();
			}

			if ( generation !== writeGeneration.current ) {
				return;
			}

			onUpdate( updated );
			setLocal( updated );
			setPluginHasChanges( false );
		} finally {
			// Always cleared: a stale response must not leave the card busy.
			setSaving( false );
		}
	}, [ assistant.slug, local, pluginSaveHandler, onUpdate ] );

	useEffect( () => {
		registerSave( assistant.slug, save );
	}, [ assistant.slug, save, registerSave ] );

	/*
	 * Re-check availability without changing anything.
	 *
	 * Pairs `onUpdate` with `setLocal` exactly as `save` does. Dirtiness is
	 * measured against the `assistant` prop, so updating only the local copy
	 * would leave the card falsely dirty with the screen's Save enabled.
	 */
	const handleRecheck = async () => {
		if ( rechecking || saving ) {
			return;
		}

		const generation = ++writeGeneration.current;

		setRechecking( true );

		try {
			const updated = await apiFetch( {
				path: `/vip-workflow/v1/assistants/${ encodeURIComponent(
					assistant.slug
				) }`,
			} );

			if ( generation !== writeGeneration.current ) {
				return;
			}

			onUpdate( updated );
			setLocal( updated );
		} catch ( err ) {
			if ( generation !== writeGeneration.current ) {
				return;
			}
			// Prior state is preserved: nothing is written on failure. The screen
			// owns the one error channel, so the message goes there rather than
			// into a status line beside the button.
			onError(
				sprintf(
					/* translators: 1: agent name, 2: error message. */
					__( 'Could not re-check %1$s: %2$s', 'vip-workflow' ),
					local.label,
					err.message
				)
			);
		} finally {
			// Always cleared: a stale response must not leave the card busy.
			setRechecking( false );
		}
	};

	/*
	 * Everything below the Enabled toggle describes how the agent behaves when
	 * it runs, so a switched-off agent offers none of it. The toggle stays live:
	 * it is the way back.
	 */
	const configDisabled = ! local.enabled;

	// Filter: vipWorkflow.assistantSettings
	//
	// Unified filter for injecting a custom settings component into any
	// assistant card, regardless of its underlying capabilities. Receives the
	// assistant entry and { disabled, onHasChangesChange, onSaveRef }.
	//
	// A plugin-supplied component owns its own controls, so the contract has to
	// hand it the state to own them with: `disabled` says the agent is switched
	// off, and a plugin that honours it neither lets a reader edit an agent that
	// does not run nor reports a change through `onHasChangesChange`.
	let pluginComponent = applyFilters(
		'vipWorkflow.assistantSettings',
		null,
		local,
		{
			disabled: configDisabled,
			onHasChangesChange: setPluginHasChanges,
			onSaveRef: ( fn ) => setPluginSaveHandler( () => fn ),
		}
	);

	if (
		! pluginComponent &&
		local.ability_ids &&
		local.ability_ids.length > 0
	) {
		const legacyAssistant = {
			...local,
			id: local.ability_ids[ 0 ],
			name: local.label,
		};
		pluginComponent = applyFilters(
			'vipWorkflow.assistantSettingsComponent',
			null,
			legacyAssistant,
			{
				disabled: configDisabled,
				onHasChangesChange: setPluginHasChanges,
				onSaveRef: ( fn ) => setPluginSaveHandler( () => fn ),
			}
		);
	}

	if (
		! pluginComponent &&
		local.provider_slugs &&
		local.provider_slugs.length > 0
	) {
		const LegacyProviderComponent = applyFilters(
			'vip_workflow_discovery_provider_settings',
			null,
			local.provider_slugs[ 0 ]
		);
		if ( LegacyProviderComponent ) {
			pluginComponent = (
				<LegacyProviderComponent
					providerSlug={ local.provider_slugs[ 0 ] }
					disabled={ configDisabled }
				/>
			);
		}
	}

	const settingsSchema = local.settings_schema || {};
	const hasSchema = Object.keys( settingsSchema ).length > 0;
	const isBuiltIn = local.origin === 'built-in';
	const capabilities = Array.isArray( local.capabilities )
		? local.capabilities
		: [];

	/*
	 * Availability presentation. The requirements are the whole statement: an
	 * enabled agent frames them as a warning `Notice`, a switched-off one as a
	 * low-emphasis hint, and the partial state adds what still works. The toggle
	 * is never disabled — it is an administrator preference, not a readiness
	 * signal — so the fresh-install contradiction (on, but unconfigured) is
	 * reconciled in the copy instead.
	 */
	const groups = Array.isArray( local.availability?.groups )
		? local.availability.groups
		: [];
	const isUnavailable = ! local.available;
	const isPartial = isUnavailable && 'partial' === local.availability_state;
	const workingSources = (
		Array.isArray( local.availability_sources )
			? local.availability_sources
			: []
	)
		.filter( ( source ) => source.available )
		.map( ( source ) => source.label );
	const namesWhatWorks = isPartial && workingSources.length > 0;

	const requirements = (
		<Stack
			className="vip-workflow-assistant-card__requirements"
			direction="column"
			gap="md"
		>
			{ groups.length > 0 ? (
				<AgentRequirements
					groups={ groups }
					ownerLabel={ local.label }
				/>
			) : (
				/*
				 * An agent whose `availability_callback` returns a bare `false`
				 * reports no requirements. That bool contract is preserved on
				 * purpose, so this generic line is a documented exception rather
				 * than a fallback for missing data.
				 */
				<Text variant="body-md">
					{ __(
						'This agent has required settings that are not yet configured.',
						'vip-workflow'
					) }
				</Text>
			) }

			{ namesWhatWorks && (
				<Text variant="body-sm">
					{ sprintf(
						/* translators: %s: comma-separated list of the capabilities on this card that are configured. */
						__( 'Still working: %s.', 'vip-workflow' ),
						workingSources.join( ', ' )
					) }
				</Text>
			) }

			<Stack align="center" gap="sm">
				<Button
					variant="secondary"
					size="small"
					onClick={ handleRecheck }
					isBusy={ rechecking }
					disabled={ rechecking || saving }
				>
					{ __( 'Retry', 'vip-workflow' ) }
				</Button>
			</Stack>
		</Stack>
	);

	return (
		<Card.Root
			className="vip-workflow-assistant-card"
			data-assistant-slug={ local.slug }
		>
			<Card.Header
				render={
					<Stack justify="space-between" align="center" gap="md" />
				}
			>
				<Stack direction="column" gap="xs">
					<Card.Title render={ <h2 /> }>{ local.label }</Card.Title>
					<Text
						variant="body-sm"
						className="vip-workflow-assistant-card__origin"
					>
						{ isBuiltIn
							? __( 'Built-in', 'vip-workflow' )
							: originLabel( local ) }
					</Text>
				</Stack>
				<ToggleControl
					__nextHasNoMarginBottom
					label={ __( 'Enabled', 'vip-workflow' ) }
					checked={ !! local.enabled }
					onChange={ handleToggle }
				/>
			</Card.Header>
			<Card.Content render={ <Stack direction="column" gap="lg" /> }>
				{ local.description && (
					<Text variant="body-md" render={ <p /> }>
						{ local.description }
					</Text>
				) }

				{ capabilities.length > 0 && (
					<Text variant="body-md" render={ <p /> }>
						{ sprintf(
							/* translators: %s: comma-separated list of what the agent provides. */
							__( 'Provides: %s', 'vip-workflow' ),
							capabilities
								.map(
									( capability ) =>
										CAPABILITY_LABELS[ capability ] ||
										capability
								)
								.join( ', ' )
						) }
					</Text>
				) }

				{ isUnavailable &&
					( local.enabled ? (
						<Notice status="warning" isDismissible={ false }>
							{ requirements }
						</Notice>
					) : (
						/*
						 * Switched off on purpose: the setup gap is still worth
						 * stating, but as a low-emphasis hint rather than a warning
						 * about an agent nobody is waiting on.
						 */
						<Stack
							className="vip-workflow-assistant-card__hint"
							direction="column"
						>
							{ requirements }
						</Stack>
					) ) }

				{ /*
				 * A switched-off agent offers no settings to edit: the schema
				 * describes how it behaves when it runs. Without this the card
				 * let a reader configure an agent that is off — and marked the
				 * screen dirty doing it. A plugin-supplied component takes this
				 * branch instead, and is told the same thing through the
				 * filter's `disabled`.
				 *
				 * The schema fields have no single owning control to hang `help`
				 * off, so the reason for the grey is stated once for the block —
				 * per docs/guides/settings-standard.md, visible text rather than
				 * a tooltip.
				 */ }
				{ pluginComponent
					? pluginComponent
					: hasSchema && (
							<>
								{ configDisabled && (
									<Text variant="body-md" render={ <p /> }>
										{ __(
											'Enable the agent to change these settings.',
											'vip-workflow'
										) }
									</Text>
								) }
								<SchemaSettings
									schema={ settingsSchema }
									values={ local.options || {} }
									onChange={ handleOptionChange }
									disabled={ configDisabled }
								/>
							</>
					  ) }
			</Card.Content>
		</Card.Root>
	);
}
