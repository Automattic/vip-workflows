/**
 * Agents settings.
 *
 * One tab per agent origin, each panel listing that origin's agents as cards,
 * and one Save for the whole screen. See docs/guides/settings-standard.md.
 *
 * The cards are list items, which is what earns them a container: the panel is
 * already a bounded, named region, so a card inside it is only justified when
 * the panel lists N entities. An agent is one of N.
 *
 * The origin split used to be two `h3` sections wrapping cards, which collided
 * with the cards' own heading level. Origin is a fixed set of kinds — the REST
 * schema declares it as an enum — so it is a topic split like any other, and as
 * a tab strip it lets the cards sit directly under the page `h1`.
 *
 * Tab panels keep their agents mounted (`keepMounted`). Base UI unmounts a
 * hidden panel by default, which would discard a reader's edits the moment they
 * looked at another tab — and would take the plugin-supplied settings components
 * with it, since those hold their own state and hand this screen a save callback
 * that only stays valid while they are mounted.
 *
 * @package
 */

import { useState, useEffect, useRef, useCallback } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';
import { Stack, Tabs, Text } from '@wordpress/ui';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import { HowToModal } from './HowToModal';
import { SettingsLoading } from './SettingsLoading';
import { AssistantCard } from './AssistantCard';

/**
 * The registration examples this screen hands extension authors.
 *
 * @param {Object}   props         Component props.
 * @param {Function} props.onClose Close handler.
 * @return {JSX.Element} The modal.
 */
export function AgentsHowToModal( { onClose } ) {
	return (
		<HowToModal
			title={ __( 'Add custom agents', 'vip-workflow' ) }
			skillType="agent"
			onClose={ onClose }
		>
			<Text variant="body-md" render={ <p /> }>
				{ __(
					'Agents can provide research, story discovery, or AI-stage workflow automation. Each plugin appears as a single card here.',
					'vip-workflow'
				) }
			</Text>

			<Text variant="heading-md" render={ <h2 /> }>
				{ __( 'Research ability (PHP)', 'vip-workflow' ) }
			</Text>
			<pre className="vip-workflow-code">{ `use VIPWorkflow\\Abilities\\AbilitySettings;
use VIPWorkflow\\Abilities\\Availability;
use VIPWorkflow\\Abilities\\RequirementFactory;
use VIPWorkflow\\Abilities\\RequirementGroup;

add_action( 'wp_abilities_api_init', function() {
    vip_workflow_register_ability(
        'my-plugin/my-researcher',
        [
            'label'       => 'My Source',
            'description' => 'Searches my data source.',
            'category'    => 'research',
            'input_schema'  => [
                'type' => 'object',
                'properties' => [
                    'seed'          => [ 'type' => 'string' ],
                    'seed_analysis' => [ 'type' => 'object' ],
                    'query'         => [ 'type' => 'string' ],
                ],
                'required' => [ 'seed' ],
            ],
            'execute_callback'    => 'my_researcher_execute',
            'permission_callback' => function() {
                return current_user_can( 'edit_posts' );
            },
            'meta' => [
                'type'             => 'research',
                'display_order'    => 50,
                'icon'             => 'search',
                'thinking_message' => 'Searching...',
                'success_message'  => 'Search complete.',
                'settings_schema'  => [
                    'api_key' => [
                        'type'     => 'string',
                        'label'    => 'API Key',
                        'required' => true,
                        'secret'   => true,
                    ],
                ],
                'availability_callback' => 'my_plugin_availability',
            ],
        ]
    );
} );

// Return true as soon as the dependencies are met; otherwise name what is
// missing. A bare false still works, but the card can then only say that
// something is unconfigured. Build requirements with RequirementFactory so the
// destination resolves against this install.
function my_plugin_availability(): bool|Availability {
    $options = AbilitySettings::get_instance()->get_options( 'my-plugin/my-researcher' );

    if ( ! empty( $options['api_key'] ) ) {
        return true;
    }

    return Availability::unmet(
        RequirementGroup::all(
            RequirementFactory::in_card(
                'settings:my-plugin',
                'My Source has no API key. Add it in the fields below.',
                'My Source is not connected. Ask an administrator to connect it.',
                'Complete the API Key field below.',
                [ 'My Source' ]
            )
        )
    );
}` }</pre>

			<Text variant="heading-md" render={ <h2 /> }>
				{ __( 'Discovery provider (PHP)', 'vip-workflow' ) }
			</Text>
			<pre className="vip-workflow-code">{ `add_action( 'vip_workflow_register_discovery_providers', function( $registry ) {
    $registry->register( 'my-source', [
        'label'       => 'My Source',
        'description' => 'Surfaces story ideas from my data source.',
        'icon'        => 'search',
        'features'    => [ 'recommend', 'search' ],
        'callbacks'   => [
            'recommend' => 'my_source_recommend',
            'search'    => 'my_source_search',
            'filters'   => 'my_source_filters',
            'seed'      => 'my_source_seed',
        ],
        // Same callback as the ability above: one shared requirement id means the
        // card renders one row naming both capabilities.
        'availability_callback' => 'my_plugin_availability',
    ] );
} );` }</pre>

			<Text variant="heading-md" render={ <h2 /> }>
				{ __( 'Unified card (both capabilities)', 'vip-workflow' ) }
			</Text>
			<Text variant="body-md" render={ <p /> }>
				{ __(
					'If your plugin provides both a discovery provider and a research ability, group them under one card with a manifest:',
					'vip-workflow'
				) }
			</Text>
			<pre className="vip-workflow-code">{ `add_action( 'vip_workflow_register_assistant_meta', function( $registry ) {
    $registry->register( 'my-plugin', [
        'label'          => 'My Plugin',
        'description'    => 'Expert sources and story ideas.',
        'icon'           => 'microphone',
        'ability_ids'    => [ 'my-plugin/researcher' ],
        'provider_slugs' => [ 'my-source' ],
        'settings_schema' => [
            'api_key' => [
                'type'     => 'string',
                'label'    => 'API Key',
                'required' => true,
                'secret'   => true,
            ],
        ],
    ] );
} );` }</pre>

			<Text variant="heading-md" render={ <h2 /> }>
				{ __( 'AI stage ability (PHP)', 'vip-workflow' ) }
			</Text>
			<pre className="vip-workflow-code">{ `add_action( 'vip_workflow_register_abilities', function() {
    vip_workflow_register_ability( 'my-plugin/fact-check', [
        'label'               => 'Fact Check',
        'category'            => 'vip-workflow',
        'input_schema'        => [
            'type'                 => 'object',
            'additionalProperties' => false,
            'required'             => [ 'post_id' ],
            'properties'           => [
                'post_id' => [ 'type' => 'integer' ],
            ],
        ],
        'execute_callback'    => 'my_plugin_fact_check',
        'permission_callback' => function() {
            return current_user_can( 'edit_posts' );
        },
        'meta'                => [
            'type'           => 'agent',
            'supports'       => [ 'workflow', 'stage' ],
            'stage_eligible' => true,
        ],
    ] );
} );

add_action( 'vip_workflow_register_assistant_meta', function( $registry ) {
    $registry->register( 'my-plugin', [
        'label'        => 'Fact Check',
        'ability_ids'  => [ 'my-plugin/fact-check' ],
        'capabilities' => [ 'stage' ],
    ] );
} );` }</pre>

			<Text variant="heading-md" render={ <h2 /> }>
				{ __( 'Custom React settings UI', 'vip-workflow' ) }
			</Text>
			<Text variant="body-md" render={ <p /> }>
				{ __(
					'For complex configuration, replace the auto-rendered form with a React component:',
					'vip-workflow'
				) }
			</Text>
			<pre className="vip-workflow-code">{ `import { addFilter } from '@wordpress/hooks';

addFilter(
    'vipWorkflow.assistantSettings',
    'my-plugin/settings',
    ( content, assistant ) => {
        // Match on your ability id, not on assistant.slug — a slug is derived,
        // and only a manifest controls its own.
        if ( ! assistant.ability_ids?.includes( 'my-plugin/my-ability' ) ) {
            return content;
        }
        // Return your React settings component here.
    }
);` }</pre>
		</HowToModal>
	);
}

/**
 * The screen's data and its one save.
 *
 * Lives in a hook rather than the component because the Save it drives is a
 * page-level action, rendered in the header beside the other one — and the page
 * owns that slot. What the hook returns is handed straight back down to
 * `AssistantsTab`, so there is still exactly one copy of this state.
 *
 * @return {Object} Agents state, and the handlers a card and the header need.
 */
export function useAssistantsSettings() {
	const [ assistants, setAssistants ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ dirtySlugs, setDirtySlugs ] = useState( [] );
	const { createSuccessNotice } = useDispatch( noticesStore );

	const saveHandlers = useRef( {} );

	const tabs = [
		{
			name: 'built-in',
			title: __( 'Built-in', 'vip-workflow' ),
			empty: __( 'No built-in agents are registered.', 'vip-workflow' ),
		},
		{
			name: 'plugin',
			title: __( 'From plugins', 'vip-workflow' ),
			empty: __( 'No agent plugins are installed.', 'vip-workflow' ),
		},
	];

	const requestedTab = new URLSearchParams( window.location.search ).get(
		'tab'
	);
	const [ activeTab, setActiveTab ] = useState(
		tabs.some( ( tab ) => tab.name === requestedTab )
			? requestedTab
			: 'built-in'
	);

	/*
	 * Load on mount, then reload whenever this screen regains the foreground.
	 *
	 * A card's requirement destination opens in a new tab, so the common flow is:
	 * leave, add the credential, come back. Without this the Agents screen sits on
	 * a stale unmet requirement for an agent that is now configured, and the fix
	 * reads as broken. `focus` and `visibilitychange` both fire on a tab return,
	 * so the timestamp guard collapses the pair into one request.
	 */
	useEffect( () => {
		let alive = true;
		let lastLoad = 0;

		const load = () => {
			lastLoad = Date.now();

			return apiFetch( { path: '/vip-workflow/v1/assistants' } )
				.then( ( data ) => {
					if ( ! alive ) {
						return;
					}
					setAssistants( Array.isArray( data ) ? data : [] );
					setLoading( false );
				} )
				.catch( ( err ) => {
					if ( ! alive ) {
						return;
					}
					setError( err.message );
					setLoading( false );
				} );
		};

		const onReturn = () => {
			if (
				'visible' === document.visibilityState &&
				Date.now() - lastLoad > 1000
			) {
				load();
			}
		};

		load();
		window.addEventListener( 'focus', onReturn );
		document.addEventListener( 'visibilitychange', onReturn );

		return () => {
			alive = false;
			window.removeEventListener( 'focus', onReturn );
			document.removeEventListener( 'visibilitychange', onReturn );
		};
	}, [] );

	const handleUpdate = useCallback( ( updated ) => {
		setAssistants( ( prev ) =>
			prev.map( ( entry ) =>
				entry.slug === updated.slug ? { ...entry, ...updated } : entry
			)
		);
	}, [] );

	// Returning `prev` untouched when nothing moved is what keeps a card's
	// dirty-reporting effect from re-rendering the screen on every keystroke.
	const handleDirtyChange = useCallback( ( slug, isDirty ) => {
		setDirtySlugs( ( prev ) => {
			const listed = prev.includes( slug );
			if ( isDirty === listed ) {
				return prev;
			}
			return isDirty
				? [ ...prev, slug ]
				: prev.filter( ( entry ) => entry !== slug );
		} );
	}, [] );

	const registerSave = useCallback( ( slug, fn ) => {
		saveHandlers.current[ slug ] = fn;
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
		for ( const slug of dirtySlugs ) {
			try {
				await saveHandlers.current[ slug ]();
			} catch ( err ) {
				const label =
					assistants.find( ( entry ) => entry.slug === slug )
						?.label || slug;
				failures.push( `${ label }: ${ err.message }` );
			}
		}

		setSaving( false );

		if ( failures.length > 0 ) {
			setError(
				sprintf(
					/* translators: %s: semicolon-separated list of agent names and their errors. */
					__( 'Some agents could not be saved: %s', 'vip-workflow' ),
					failures.join( '; ' )
				)
			);
			return;
		}

		createSuccessNotice( __( 'Agents saved.', 'vip-workflow' ), {
			type: 'snackbar',
		} );
	}, [ dirtySlugs, assistants, createSuccessNotice ] );

	return {
		assistants,
		loading,
		error,
		setError,
		saving,
		canSave: dirtySlugs.length > 0,
		handleSave,
		handleUpdate,
		handleDirtyChange,
		registerSave,
		tabs,
		activeTab,
		handleTabChange,
	};
}

/**
 * The agents themselves: one tab per origin, each listing that origin's cards.
 *
 * @param {Object} props       Component props.
 * @param {Object} props.state What `useAssistantsSettings()` returned.
 * @return {JSX.Element} The screen body.
 */
export function AssistantsTab( { state } ) {
	const {
		assistants,
		loading,
		error,
		setError,
		handleUpdate,
		handleDirtyChange,
		registerSave,
		tabs,
		activeTab,
		handleTabChange,
	} = state;

	if ( loading ) {
		return (
			<SettingsLoading
				label={ __( 'Loading agents…', 'vip-workflow' ) }
			/>
		);
	}

	const byOrigin = ( origin ) =>
		assistants.filter( ( entry ) =>
			'built-in' === origin
				? 'built-in' === entry.origin
				: 'built-in' !== entry.origin
		);

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
					const agents = byOrigin( tab.name );
					return (
						<Tabs.Panel
							key={ tab.name }
							value={ tab.name }
							keepMounted
						>
							{ agents.length === 0 ? (
								<Text variant="body-md" render={ <p /> }>
									{ tab.empty }
								</Text>
							) : (
								<Stack direction="column" gap="lg">
									{ agents.map( ( assistant ) => (
										<AssistantCard
											key={ assistant.slug }
											assistant={ assistant }
											onUpdate={ handleUpdate }
											onDirtyChange={ handleDirtyChange }
											registerSave={ registerSave }
											onError={ setError }
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
