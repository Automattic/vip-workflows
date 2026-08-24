/**
 * Tools settings.
 *
 * One tab per tool type, each panel listing that type's tools as cards, and one
 * Save for the whole screen. See docs/guides/settings-standard.md.
 *
 * The cards are list items, which is what earns them a container: the panel is
 * already a bounded, named region, so a card inside it is only justified when
 * the panel lists N entities. A tool is one of N.
 *
 * Tab panels keep their tools mounted (`keepMounted`). Base UI unmounts a hidden
 * panel by default, which would discard a reader's edits the moment they looked
 * at another tab — and would take the plugin-supplied settings components with
 * it, since those hold their own state and hand this screen a save callback that
 * only stays valid while they are mounted.
 *
 * @package
 */

import { useState, useEffect, useRef, useCallback } from '@wordpress/element';
import { ToggleControl, Notice } from '@wordpress/components';
import { Card, Stack, Tabs, Text } from '@wordpress/ui';
import { applyFilters } from '@wordpress/hooks';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { AgentRequirements } from '../../common/AgentRequirements';
import { SchemaSettings } from './SchemaSettings';
import { HowToModal } from './HowToModal';
import { SettingsLoading } from './SettingsLoading';

/**
 * The registration example this screen hands extension authors.
 *
 * @param {Object}   props         Component props.
 * @param {Function} props.onClose Close handler.
 * @return {JSX.Element} The modal.
 */
export function ToolsHowToModal( { onClose } ) {
	return (
		<HowToModal
			title={ __( 'Add custom tools', 'vip-workflow' ) }
			skillType="tool"
			onClose={ onClose }
		>
			<Text variant="body-md" render={ <p /> }>
				{ __(
					'Register custom tools using vip_workflow_register_ability(). Tools must set meta.type to appear here.',
					'vip-workflow'
				) }
			</Text>
			<pre className="vip-workflow-code">{ `add_action( 'wp_abilities_api_init', function() {
    vip_workflow_register_ability(
        'my-plugin/my-check',
        [
            'label'       => 'My Custom Check',
            'description' => 'Analyzes content for custom rules.',
            'category'    => 'vip-workflow',
            'input_schema'  => [
                'type' => 'object',
                'properties' => [
                    'post_id' => [ 'type' => 'integer' ],
                ],
            ],
            'output_schema' => [
                'type' => 'object',
                'properties' => [
                    'score'  => [ 'type' => 'number' ],
                    'issues' => [ 'type' => 'array' ],
                ],
            ],
            'meta' => [
                'type'                => 'check',
                'transition_eligible' => true,
                'settings_schema'     => [
                    'threshold' => [
                        'type'        => 'integer',
                        'default'     => 80,
                        'label'       => 'Score threshold',
                        'enforceable' => true,
                    ],
                ],
            ],
            'execute_callback'    => 'my_check_execute',
            'permission_callback' => function() {
                return current_user_can( 'edit_posts' );
            },
        ]
    );
} );

function my_check_execute( array $input ): array {
    $settings  = \\VIPWorkflow\\Abilities\\AbilitySettings
        ::get_instance()->get_options( 'my-plugin/my-check' );
    $threshold = $settings['threshold'] ?? 80;

    // Your analysis logic here...

    return [
        'score'   => 85,
        'summary' => 'Check passed with minor issues.',
        'issues'  => [],
    ];
}` }</pre>
		</HowToModal>
	);
}

/**
 * Which transitions a tool can run on, as a sentence for the toggle that turns
 * that on. This was a pair of badges in the card header; it is a capability, so
 * it belongs to the control it qualifies.
 *
 * @param {Array} supports The tool's meta.supports entries.
 * @return {string} The help line, or '' when the tool declares nothing.
 */
function getTransitionHelp( supports ) {
	const phase = supports.includes( 'phase' );
	const workflow = supports.includes( 'workflow' );

	if ( phase && workflow ) {
		return __(
			'Available on workflow and phase transitions.',
			'vip-workflow'
		);
	}
	if ( phase ) {
		return __( 'Available on phase transitions.', 'vip-workflow' );
	}
	if ( workflow ) {
		return __( 'Available on workflow transitions.', 'vip-workflow' );
	}
	return '';
}

/**
 * One tool.
 *
 * Holds its own draft and reports two things upward: whether it has unsaved
 * work, and how to save it. The screen's one Save calls back into every dirty
 * card, so the card owns the request and the footer owns the decision to make
 * it.
 *
 * @param {Object}   props               Component props.
 * @param {Object}   props.ability       The tool, as the REST list returned it.
 * @param {Function} props.onUpdate      Called with the saved tool.
 * @param {Function} props.onDirtyChange Called with ( id, hasChanges ).
 * @param {Function} props.registerSave  Called with ( id, saveFn ).
 * @return {JSX.Element} The tool card.
 */
function ToolCard( { ability, onUpdate, onDirtyChange, registerSave } ) {
	const [ localAbility, setLocalAbility ] = useState( ability );
	const [ pluginHasChanges, setPluginHasChanges ] = useState( false );
	const [ pluginSaveHandler, setPluginSaveHandler ] = useState( null );

	// Resync when the ability prop changes identity (e.g. an out-of-band parent
	// refresh), since useState( ability ) only seeds on the first render.
	useEffect( () => {
		setLocalAbility( ability );
	}, [ ability ] );

	const ownChanges =
		JSON.stringify( localAbility ) !== JSON.stringify( ability );
	const hasChanges = ownChanges || pluginHasChanges;

	useEffect( () => {
		onDirtyChange( ability.id, hasChanges );
	}, [ ability.id, hasChanges, onDirtyChange ] );

	// A card that leaves the screen takes its dirty flag with it. Without this
	// an agent (or tool) that the list's refetch drops while it had unsaved
	// edits leaves its id in the screen's dirty set for good: Save stays
	// enabled with nothing on screen to save, and pressing it calls a save
	// closure for a card that is gone. Unmount-only — the deps are stable, so
	// this never runs between edits.
	useEffect(
		() => () => onDirtyChange( ability.id, false ),
		[ ability.id, onDirtyChange ]
	);

	const save = useCallback( async () => {
		const updated = await apiFetch( {
			path: `/vip-workflow/v1/tools/${ ability.id }/settings`,
			method: 'POST',
			data: {
				enabled: localAbility.enabled,
				show_in_commands: localAbility.show_in_commands,
				transition_eligible: localAbility.transition_eligible,
				options: localAbility.options,
				check_modes: localAbility.check_modes,
			},
		} );

		if ( pluginSaveHandler ) {
			await pluginSaveHandler();
		}

		setPluginHasChanges( false );

		if ( updated ) {
			onUpdate( updated );
			setLocalAbility( updated );
		}
	}, [ ability.id, localAbility, pluginSaveHandler, onUpdate ] );

	useEffect( () => {
		registerSave( ability.id, save );
	}, [ ability.id, save, registerSave ] );

	const handleToggle = ( key, value ) => {
		setLocalAbility( ( prev ) => ( { ...prev, [ key ]: value } ) );
	};

	const handleCheckModeChange = ( optionKey, mode ) => {
		setLocalAbility( ( prev ) => ( {
			...prev,
			check_modes: { ...( prev.check_modes || {} ), [ optionKey ]: mode },
		} ) );
	};

	const handleOptionChange = ( optionKey, value ) => {
		setLocalAbility( ( prev ) => ( {
			...prev,
			options: { ...( prev.options || {} ), [ optionKey ]: value },
		} ) );
	};

	const toolType = localAbility.meta?.type || 'check';
	const supports = localAbility.meta?.supports || [];
	const showCheckModes = toolType === 'check';
	const settingsSchema = localAbility.settings_schema || {};
	const hasSettings = Object.keys( settingsSchema ).length > 0;

	/*
	 * The controller has always computed `available` for tools and this page has
	 * always ignored it, so a tool whose dependencies are unmet looked identical
	 * to a working one. The requirements come from the same serializer the Agents
	 * card and the AI-stage picker read, and render through the same component, so
	 * the three surfaces explain the same thing the same way.
	 */
	const isUnavailable = false === localAbility.available;
	const requirementGroups = localAbility.availability?.groups || [];

	/*
	 * Everything this card renders below the Enabled toggle describes how the
	 * tool behaves when it runs, so a switched-off tool offers none of it.
	 * Without this the card let a reader configure a tool that is off — and
	 * marked the screen dirty doing it. The Enabled toggle itself stays live: it
	 * is the way back. `configDisabled` is handed to the settings filter too, so
	 * a plugin-supplied component can switch off the controls it owns; a
	 * contract that told it nothing would just move the same bug one layer out.
	 */
	const configDisabled = ! localAbility.enabled;

	// Sentence-case reason for the grey, per docs/guides/settings-standard.md: a
	// control disabled by a precondition says why in `help`, not in a tooltip.
	const disabledHelp = __(
		'Enable the tool to change this.',
		'vip-workflow'
	);

	return (
		<Card.Root>
			<Card.Header
				render={
					<Stack justify="space-between" align="center" gap="md" />
				}
			>
				<Card.Title render={ <h2 /> }>{ localAbility.name }</Card.Title>
				<ToggleControl
					__nextHasNoMarginBottom
					label={ __( 'Enabled', 'vip-workflow' ) }
					checked={ localAbility.enabled }
					onChange={ ( val ) => handleToggle( 'enabled', val ) }
				/>
			</Card.Header>
			<Card.Content render={ <Stack direction="column" gap="lg" /> }>
				<Text variant="body-md" render={ <p /> }>
					{ localAbility.description }
				</Text>

				{ isUnavailable && (
					<Notice status="warning" isDismissible={ false }>
						{ requirementGroups.length > 0 ? (
							<AgentRequirements
								groups={ requirementGroups }
								ownerLabel={ localAbility.name }
							/>
						) : (
							/*
							 * A tool whose availability_callback returns a
							 * bare `false` reports no requirements. That bool
							 * contract is preserved on purpose, so this
							 * generic line is a documented exception rather
							 * than a fallback for missing data.
							 */
							<Text variant="body-md">
								{ __(
									'This tool has required settings that are not yet configured.',
									'vip-workflow'
								) }
							</Text>
						) }
					</Notice>
				) }

				<Stack direction="column" gap="sm">
					{ localAbility.meta?.show_in_commands && (
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Show in command palette',
								'vip-workflow'
							) }
							help={ configDisabled ? disabledHelp : undefined }
							checked={ localAbility.show_in_commands ?? false }
							onChange={ ( val ) =>
								handleToggle( 'show_in_commands', val )
							}
							disabled={ configDisabled }
						/>
					) }
					{ localAbility.meta?.transition_eligible && (
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Can be used in transitions',
								'vip-workflow'
							) }
							help={
								configDisabled
									? disabledHelp
									: getTransitionHelp( supports )
							}
							checked={
								localAbility.transition_eligible ?? false
							}
							onChange={ ( val ) =>
								handleToggle( 'transition_eligible', val )
							}
							disabled={ configDisabled }
						/>
					) }
				</Stack>

				{ hasSettings && (
					<Stack direction="column" gap="lg">
						<Text variant="heading-sm" render={ <h3 /> }>
							{ __( 'Settings', 'vip-workflow' ) }
						</Text>
						{ /*
						 * The schema fields have no single owning control to
						 * hang `help` off, so the reason for the grey is stated
						 * once for the block — and it replaces the soft/hard
						 * line, which describes behaviour a switched-off tool
						 * does not have.
						 */ }
						{ configDisabled ? (
							<Text variant="body-md" render={ <p /> }>
								{ __(
									'Enable the tool to change these settings.',
									'vip-workflow'
								) }
							</Text>
						) : (
							showCheckModes && (
								<Text variant="body-md" render={ <p /> }>
									{ __(
										'Soft flags a warning; hard blocks the transition.',
										'vip-workflow'
									) }
								</Text>
							)
						) }
						<SchemaSettings
							schema={ settingsSchema }
							values={ localAbility.options || {} }
							onChange={ handleOptionChange }
							checkModes={
								showCheckModes
									? localAbility.check_modes || {}
									: undefined
							}
							onCheckModeChange={
								showCheckModes
									? handleCheckModeChange
									: undefined
							}
							disabled={ configDisabled }
						/>
					</Stack>
				) }

				{ /*
				 * Filter: vipWorkflow.toolSettingsComponent
				 *
				 * A plugin-supplied component owns its own controls, so the
				 * contract has to hand it the state to own them with: `disabled`
				 * says the tool is switched off, and a plugin that honours it
				 * neither lets a reader edit a tool that does not run nor
				 * reports a change through `onHasChangesChange`.
				 */ }
				{ applyFilters(
					'vipWorkflow.toolSettingsComponent',
					null,
					localAbility,
					{
						disabled: configDisabled,
						onHasChangesChange: setPluginHasChanges,
						onSaveRef: ( fn ) => setPluginSaveHandler( () => fn ),
					}
				) }
			</Card.Content>
		</Card.Root>
	);
}

/**
 * The screen's data and its one save.
 *
 * Lives in a hook rather than the component because the Save it drives is a
 * page-level action, rendered in the header beside the other one — and the page
 * owns that slot. What the hook returns is handed straight back down to
 * `ToolsSettings`, so there is still exactly one copy of this state.
 *
 * @return {Object} Tools state, and the handlers a card and the header need.
 */
export function useToolsSettings() {
	const [ abilities, setAbilities ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ dirtyIds, setDirtyIds ] = useState( [] );
	const { createSuccessNotice } = useDispatch( noticesStore );

	const saveHandlers = useRef( {} );

	const tabs = [
		{
			name: 'check',
			title: __( 'Checks', 'vip-workflow' ),
			empty: __( 'No check tools are registered.', 'vip-workflow' ),
		},
		{
			name: 'validator',
			title: __( 'Validators', 'vip-workflow' ),
			empty: __( 'No validation tools are registered.', 'vip-workflow' ),
		},
		{
			name: 'helper',
			title: __( 'Helpers', 'vip-workflow' ),
			empty: __( 'No helper tools are registered.', 'vip-workflow' ),
		},
	];

	const requestedTab = new URLSearchParams( window.location.search ).get(
		'tab'
	);
	const [ activeTab, setActiveTab ] = useState(
		tabs.some( ( t ) => t.name === requestedTab ) ? requestedTab : 'check'
	);

	useEffect( () => {
		apiFetch( { path: '/vip-workflow/v1/tools' } )
			.then( ( data ) => {
				setAbilities( data || [] );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setLoading( false );
			} );
	}, [] );

	const handleAbilityUpdate = useCallback( ( updatedAbility ) => {
		setAbilities( ( prev ) =>
			prev.map( ( a ) =>
				a.id === updatedAbility.id ? updatedAbility : a
			)
		);
	}, [] );

	// Returning `prev` untouched when nothing moved is what keeps a card's
	// dirty-reporting effect from re-rendering the screen on every keystroke.
	const handleDirtyChange = useCallback( ( id, isDirty ) => {
		setDirtyIds( ( prev ) => {
			const listed = prev.includes( id );
			if ( isDirty === listed ) {
				return prev;
			}
			return isDirty
				? [ ...prev, id ]
				: prev.filter( ( entry ) => entry !== id );
		} );
	}, [] );

	const registerSave = useCallback( ( id, fn ) => {
		saveHandlers.current[ id ] = fn;
	}, [] );

	const handleTabChange = ( value ) => {
		setActiveTab( value );
		const url = new URL( window.location.href );
		url.searchParams.set( 'tab', value );
		window.history.replaceState( {}, '', url );
	};

	const handleSave = useCallback( async () => {
		setSaving( true );
		setError( null );

		const failures = [];
		for ( const id of dirtyIds ) {
			try {
				await saveHandlers.current[ id ]();
			} catch ( err ) {
				const name = abilities.find( ( a ) => a.id === id )?.name || id;
				failures.push( `${ name }: ${ err.message }` );
			}
		}

		setSaving( false );

		if ( failures.length > 0 ) {
			setError(
				sprintf(
					/* translators: %s: semicolon-separated list of tool names and their errors. */
					__( 'Some tools could not be saved: %s', 'vip-workflow' ),
					failures.join( '; ' )
				)
			);
			return;
		}

		createSuccessNotice( __( 'Tools saved.', 'vip-workflow' ), {
			type: 'snackbar',
		} );
	}, [ dirtyIds, abilities, createSuccessNotice ] );

	return {
		abilities,
		loading,
		error,
		setError,
		saving,
		canSave: dirtyIds.length > 0,
		handleSave,
		handleAbilityUpdate,
		handleDirtyChange,
		registerSave,
		tabs,
		activeTab,
		handleTabChange,
	};
}

/**
 * The tools themselves: one tab per type, each listing that type's cards.
 *
 * @param {Object} props       Component props.
 * @param {Object} props.state What `useToolsSettings()` returned.
 * @return {JSX.Element} The screen body.
 */
export function ToolsSettings( { state } ) {
	const {
		abilities,
		loading,
		error,
		setError,
		handleAbilityUpdate,
		handleDirtyChange,
		registerSave,
		tabs,
		activeTab,
		handleTabChange,
	} = state;

	if ( loading ) {
		return (
			<SettingsLoading label={ __( 'Loading tools…', 'vip-workflow' ) } />
		);
	}

	const byType = ( type ) =>
		abilities.filter( ( a ) => a.meta?.type === type );

	return (
		<Stack direction="column" gap="lg">
			{ error && (
				<Notice
					status="error"
					isDismissible
					onRemove={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }

			<Tabs.Root
				className="vip-workflow-tabs"
				value={ activeTab }
				onValueChange={ handleTabChange }
			>
				<Tabs.List>
					{ tabs.map( ( tab ) => (
						<Tabs.Tab key={ tab.name } value={ tab.name }>
							{ tab.title }
						</Tabs.Tab>
					) ) }
				</Tabs.List>
				{ tabs.map( ( tab ) => {
					const tools = byType( tab.name );
					return (
						<Tabs.Panel
							key={ tab.name }
							value={ tab.name }
							keepMounted
						>
							{ tools.length === 0 ? (
								<Text variant="body-md" render={ <p /> }>
									{ tab.empty }
								</Text>
							) : (
								<Stack direction="column" gap="lg">
									{ tools.map( ( ability ) => (
										<ToolCard
											key={ ability.id }
											ability={ ability }
											onUpdate={ handleAbilityUpdate }
											onDirtyChange={ handleDirtyChange }
											registerSave={ registerSave }
										/>
									) ) }
								</Stack>
							) }
						</Tabs.Panel>
					);
				} ) }
			</Tabs.Root>
		</Stack>
	);
}
