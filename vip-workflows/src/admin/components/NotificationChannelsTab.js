/**
 * Notifications settings.
 *
 * Two tabs — `Channels` and `Routing` — and one Save for the whole screen. See
 * docs/guides/settings-standard.md.
 *
 * The tabs used to be instances: one per channel group, one more for every
 * channel that belonged to no group, then `System Events` and `Routing & Debug`
 * appended. A strip that grows as a site is configured is not a topic split, so
 * every channel is now a card in the one `Channels` tab — five Slack
 * destinations are five cards, not five tabs — and everything about which event
 * reaches which channel lives in `Routing`.
 *
 * There used to be two matrices over the same events: this screen's per-channel
 * `events` list, and the global routing option. They were not equivalent. The
 * routing option is a plain event→channels map that every channel type shares,
 * and both dispatchers consult it first; the per-channel list is stored by the
 * channel itself, and neither Slack nor ntfy stores it at all — their
 * `update_settings()` merges a fixed set of destination fields and drops the
 * rest, while still echoing the submitted value back in the response. So that
 * matrix reported success and saved nothing for every channel a site is likely
 * to have. It is gone, and `Routing` is the one place the mapping is edited.
 *
 * Saving is per entity through one control. Each channel has its own REST route,
 * so the screen's single Save walks the channels that changed and calls each
 * one's route, then the routing and debug routes if those moved; a partial
 * failure names what failed in the one error Notice. A channel's request carries
 * its WHOLE settings object, because the base-class route replaces the stored
 * option with the body it is given — a partial body dropped whatever it left
 * out.
 *
 * Both panels keep their contents mounted (`keepMounted`): Base UI unmounts a
 * hidden panel by default, which would discard a reader's edits the moment they
 * looked at the other tab.
 *
 * @package
 */

import { useState, useEffect } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	CheckboxControl,
	ExternalLink,
	Notice,
	TextControl,
	TextareaControl,
} from '@wordpress/components';
import { Badge, Card, Stack, Tabs, Text } from '@wordpress/ui';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import { applyFilters } from '@wordpress/hooks';
import { SchemaSettings } from './SchemaSettings';
import { SettingsLoading } from './SettingsLoading';
import { NotificationsApp } from './notifications/NotificationsApp';
import { useConfirm } from '../../common/use-confirm';
import { ActionRow } from '../../common/ActionRow';

import './NotificationChannelsTab.css';

/**
 * The built-in Slack group, described with the same shape plugins register via
 * the `vipWorkflow.channelGroups` filter, so add/remove is one code path for
 * every group rather than a Slack special case plus a plugin case.
 */
const SLACK_GROUP = {
	prefix: 'slack-',
	label: __( 'Slack', 'vip-workflow' ),
	addEndpoint: '/vip-workflow/v1/slack-destinations',
	newName: __( 'Slack (New)', 'vip-workflow' ),
	defaultConfig: {
		webhook_url: '',
		bot_name: 'Workflow Bot',
		bot_icon: ':newspaper:',
	},
};

/**
 * Every group a channel can be added to: Slack plus any plugin-registered ones.
 *
 * A group is exactly the five fields `SLACK_GROUP` declares — `prefix`, `label`,
 * `addEndpoint`, `newName`, `defaultConfig` — and nothing here reads anything
 * else. A group used to be able to carry an `icon` and a `description` too; both
 * stopped being rendered when the screen moved to topic tabs, so both are gone
 * rather than left as fields a plugin can set and never see.
 *
 * @return {Array} Channel groups.
 */
function getChannelGroups() {
	return [ SLACK_GROUP, ...applyFilters( 'vipWorkflow.channelGroups', [] ) ];
}

/**
 * The group's current destination list.
 *
 * Read before every add and remove, because the POST that follows sends back the
 * WHOLE list as the new authoritative one — so this list is not a convenience,
 * it is the thing about to be persisted. A response without a `destinations`
 * array does not mean "there are none"; it means the current list is unknown,
 * and treating the two as the same is how one shape drift wipes every configured
 * destination on the very next request. Required data that is missing is a bug
 * to report, never a default to substitute.
 *
 * @param {Object} group Channel group ( see `getChannelGroups` ).
 * @return {Promise<Array>} The destinations currently configured for the group.
 * @throws {Error} When the endpoint does not answer with a destination list.
 */
export async function fetchChannelDestinations( group ) {
	const response = await apiFetch( { path: group.addEndpoint } );

	if ( ! Array.isArray( response?.destinations ) ) {
		throw new Error(
			sprintf(
				/* translators: %s: REST endpoint path. */
				__(
					'%s did not return a list of destinations, so the current channels are unknown. Nothing was changed.',
					'vip-workflow'
				),
				group.addEndpoint
			)
		);
	}

	return response.destinations;
}

/**
 * The message for a write whose response does not say what was stored.
 *
 * Every save route answers with the persisted value, and the screen reseats its
 * baseline on that answer. A response without it leaves the screen unable to say
 * what is saved — a data-integrity bug to report, not a value to assume.
 *
 * @param {string} path The REST route that answered.
 * @return {string} The error message.
 */
function unknownResult( path ) {
	return sprintf(
		/* translators: %s: REST endpoint path. */
		__(
			'%s did not return what it stored, so what is now saved is unknown.',
			'vip-workflow'
		),
		path
	);
}

/**
 * Add a destination to a channel group and reload so the new channel's card
 * appears.
 *
 * @param {Object} group Channel group ( see `getChannelGroups` ).
 */
async function addChannelDestination( group ) {
	const destinations = await fetchChannelDestinations( group );

	destinations.push( {
		id: `${ group.prefix.replace( '-', '' ) }-${ Date.now() }`,
		name: group.newName || `${ group.label } (New)`,
		...( group.defaultConfig || {} ),
	} );

	await apiFetch( {
		path: group.addEndpoint,
		method: 'POST',
		data: destinations,
	} );

	window.location.reload();
}

/**
 * The screen's data and its one save.
 *
 * Lives in a hook rather than the component because the Save it drives is a
 * page-level action, rendered in the header beside the add-channel buttons — and
 * the page owns that slot. What the hook returns is handed straight back down to
 * `NotificationChannelsTab`, so there is still exactly one copy of this state.
 *
 * @return {Object} Channel state, and the handlers the cards and the header need.
 */
export function useNotificationSettings() {
	const [ channels, setChannels ] = useState( [] );
	const [ settings, setSettings ] = useState( {} );
	const [ savedSettings, setSavedSettings ] = useState( {} );
	const [ events, setEvents ] = useState( [] );
	const [ routing, setRouting ] = useState( {} );
	const [ savedRouting, setSavedRouting ] = useState( {} );
	const [ debug, setDebug ] = useState( { enabled: false, channels: [] } );
	const [ savedDebug, setSavedDebug ] = useState( {
		enabled: false,
		channels: [],
	} );
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ error, setError ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ testing, setTesting ] = useState( {} );
	const [ addingGroup, setAddingGroup ] = useState( null );
	const [ confirm, confirmDialog ] = useConfirm();
	const { createSuccessNotice } = useDispatch( noticesStore );

	const groups = getChannelGroups();

	const tabs = [
		{ name: 'channels', title: __( 'Channels', 'vip-workflow' ) },
		{ name: 'routing', title: __( 'Routing', 'vip-workflow' ) },
	];

	// A `tab` query param selects the initial tab and `handleTabChange` writes
	// the selected name straight back into it. Values that match no tab — the
	// per-channel names the old strip generated — fall through to `channels`.
	const requestedTab = new URLSearchParams( window.location.search ).get(
		'tab'
	);
	const [ activeTab, setActiveTab ] = useState(
		tabs.some( ( tab ) => tab.name === requestedTab )
			? requestedTab
			: 'channels'
	);

	useEffect( () => {
		async function load() {
			try {
				const [ list, eventList, routingRes, debugRes ] =
					await Promise.all( [
						apiFetch( {
							path: '/vip-workflow/v1/notifications/channels',
						} ),
						apiFetch( {
							path: '/vip-workflow/v1/notifications/events',
						} ),
						apiFetch( {
							path: '/vip-workflow/v1/notification-routing',
						} ),
						apiFetch( {
							path: '/vip-workflow/v1/notification-debug',
						} ),
					] );

				// Settled, not all: one channel whose settings route answers
				// with an error must not take the screen down with it. The
				// screen used to read each channel's settings in its own
				// try/catch for exactly this reason; a bare Promise.all put
				// every card, the routing matrix and Delete behind one
				// channel's failure. A channel that could not be read is left
				// out of both the list and the settings map — rendering a card
				// with no settings would offer a Save that posts nothing —
				// and named in a non-blocking error.
				const results = await Promise.allSettled(
					list.map( ( channel ) =>
						apiFetch( {
							path: `/vip-workflow/v1/notifications/${ channel.id }/settings`,
						} )
					)
				);

				const bySlug = {};
				const unreadable = [];

				list.forEach( ( channel, index ) => {
					const result = results[ index ];
					if ( 'fulfilled' === result.status ) {
						bySlug[ channel.id ] = result.value;
					} else {
						unreadable.push( channel.name || channel.id );
					}
				} );

				if ( unreadable.length > 0 ) {
					setError(
						sprintf(
							/* translators: %s: comma-separated list of notification channel names. */
							__(
								'These channels could not be loaded and are not shown: %s',
								'vip-workflow'
							),
							unreadable.join( ', ' )
						)
					);
				}

				setChannels(
					list.filter( ( channel ) =>
						Object.hasOwn( bySlug, channel.id )
					)
				);
				setSettings( bySlug );
				setSavedSettings( JSON.parse( JSON.stringify( bySlug ) ) );
				// PHP encodes an empty associative array as `[]`, so an
				// unrouted site answers with a list where the shape is a map.
				// That is an encoding artefact, not missing data: normalise it
				// once here so dirty-checking compares like with like.
				const routingMap = Array.isArray( routingRes.routing )
					? {}
					: routingRes.routing;

				setEvents( eventList );
				setRouting( routingMap );
				setSavedRouting( JSON.parse( JSON.stringify( routingMap ) ) );
				setDebug( debugRes );
				setSavedDebug( JSON.parse( JSON.stringify( debugRes ) ) );
			} catch ( err ) {
				setLoadError( err.message );
			} finally {
				setLoading( false );
			}
		}

		load();
	}, [] );

	const isChannelDirty = ( channelId ) =>
		JSON.stringify( settings[ channelId ] ) !==
		JSON.stringify( savedSettings[ channelId ] );

	const dirtyIds = Object.keys( settings ).filter( isChannelDirty );

	const routingDirty =
		JSON.stringify( routing ) !== JSON.stringify( savedRouting );
	const debugDirty = JSON.stringify( debug ) !== JSON.stringify( savedDebug );
	const hasUnsavedChanges = dirtyIds.length > 0 || routingDirty || debugDirty;

	const nameOf = ( channelId ) =>
		channels.find( ( channel ) => channel.id === channelId )?.name ||
		channelId;

	const updateChannelSetting = ( channelId, key, value ) => {
		setSettings( ( prev ) => ( {
			...prev,
			[ channelId ]: {
				...( prev[ channelId ] || {} ),
				[ key ]: value,
			},
		} ) );
	};

	// Routing is one option, keyed by event, listing the channels that receive
	// it. Every channel type shares it, which is what makes it the one store the
	// matrix can write — see this file's header.
	// An event routed nowhere carries no key at all. The dispatcher reads
	// `isset( $routing[ $event ] ) && in_array( … )`, so an absent key and an
	// empty list are the same answer — but they are not the same JSON, and the
	// dirty check is a stringify against the saved snapshot. Leaving `[]`
	// behind made a checkbox ticked and unticked read as an unsaved change
	// that no further edit could clear.
	const setEventRoute = ( prev, eventId, channelIds ) => {
		if ( channelIds.length === 0 ) {
			const { [ eventId ]: removed, ...rest } = prev;
			return rest;
		}

		return { ...prev, [ eventId ]: channelIds };
	};

	const setEventChannels = ( eventId, channelIds ) => {
		setRouting( ( prev ) => setEventRoute( prev, eventId, channelIds ) );
	};

	const toggleRoute = ( eventId, channelId ) => {
		setRouting( ( prev ) => {
			const routed = prev[ eventId ] || [];

			return setEventRoute(
				prev,
				eventId,
				routed.includes( channelId )
					? routed.filter( ( entry ) => entry !== channelId )
					: [ ...routed, channelId ]
			);
		} );
	};

	const routeChannelToEveryEvent = ( channelId ) => {
		setRouting( ( prev ) => {
			const next = { ...prev };

			events.forEach( ( event ) => {
				const routed = next[ event.id ] || [];
				if ( ! routed.includes( channelId ) ) {
					next[ event.id ] = [ ...routed, channelId ];
				}
			} );

			return next;
		} );
	};

	/**
	 * Persist one channel, and reseat it on what the server says it stored.
	 *
	 * The base-class route replaces the channel's whole option with the body it
	 * is given, so the body is the whole settings object — including any keys
	 * this screen does not edit, which a partial body would drop.
	 *
	 * @param {string} channelId Channel to save.
	 */
	const saveChannel = async ( channelId ) => {
		const path = `/vip-workflow/v1/notifications/${ channelId }/settings`;
		const response = await apiFetch( {
			path,
			method: 'POST',
			data: settings[ channelId ],
		} );

		if ( ! response?.settings ) {
			throw new Error( unknownResult( path ) );
		}

		setSettings( ( prev ) => ( {
			...prev,
			[ channelId ]: response.settings,
		} ) );
		setSavedSettings( ( prev ) => ( {
			...prev,
			[ channelId ]: response.settings,
		} ) );
	};

	/**
	 * Persist the event→channel map, and reseat on what was stored.
	 */
	const saveRouting = async () => {
		const path = '/vip-workflow/v1/notification-routing';
		const response = await apiFetch( {
			path,
			method: 'POST',
			data: routing,
		} );

		if ( ! response?.routing ) {
			throw new Error( unknownResult( path ) );
		}

		const stored = Array.isArray( response.routing )
			? {}
			: response.routing;

		setRouting( stored );
		setSavedRouting( JSON.parse( JSON.stringify( stored ) ) );
	};

	/**
	 * Persist the mirror-everything settings, and reseat on what was stored.
	 */
	const saveDebug = async () => {
		const path = '/vip-workflow/v1/notification-debug';
		const response = await apiFetch( {
			path,
			method: 'POST',
			data: debug,
		} );

		if ( ! response?.settings ) {
			throw new Error( unknownResult( path ) );
		}

		setDebug( response.settings );
		setSavedDebug( JSON.parse( JSON.stringify( response.settings ) ) );
	};

	const handleSave = async () => {
		setSaving( true );
		setError( null );

		const failures = [];
		for ( const channelId of dirtyIds ) {
			try {
				await saveChannel( channelId );
			} catch ( err ) {
				failures.push( `${ nameOf( channelId ) }: ${ err.message }` );
			}
		}

		if ( routingDirty ) {
			try {
				await saveRouting();
			} catch ( err ) {
				failures.push(
					`${ __( 'Event routing', 'vip-workflow' ) }: ${
						err.message
					}`
				);
			}
		}

		if ( debugDirty ) {
			try {
				await saveDebug();
			} catch ( err ) {
				failures.push(
					`${ __( 'Debug mode', 'vip-workflow' ) }: ${ err.message }`
				);
			}
		}

		setSaving( false );

		if ( failures.length > 0 ) {
			setError(
				sprintf(
					/* translators: %s: semicolon-separated list of what failed and why. */
					__(
						'Some notification settings could not be saved: %s',
						'vip-workflow'
					),
					failures.join( '; ' )
				)
			);
			return;
		}

		createSuccessNotice( __( 'Notifications saved.', 'vip-workflow' ), {
			type: 'snackbar',
		} );
	};

	const testChannel = async ( channelId ) => {
		setTesting( ( prev ) => ( { ...prev, [ channelId ]: true } ) );
		setError( null );

		try {
			await apiFetch( {
				path: `/vip-workflow/v1/notifications/${ channelId }/test`,
				method: 'POST',
			} );

			createSuccessNotice(
				sprintf(
					/* translators: %s: notification channel name, e.g. "Slack". */
					__( 'Test notification sent to %s.', 'vip-workflow' ),
					nameOf( channelId )
				),
				{ type: 'snackbar' }
			);
		} catch ( err ) {
			setError(
				sprintf(
					/* translators: 1: notification channel name, 2: error message. */
					__( 'Test failed for %1$s: %2$s', 'vip-workflow' ),
					nameOf( channelId ),
					err.message
				)
			);
		} finally {
			setTesting( ( prev ) => ( { ...prev, [ channelId ]: false } ) );
		}
	};

	// Add and delete both reload the page, and every edit on the screen — any
	// channel, the routing matrix, debug mode — is staged until Save. So the
	// reload throws away the whole pending set, which is worth saying before it
	// happens.
	const addChannel = async ( group ) => {
		const addLabel = sprintf(
			/* translators: %s: channel group name, e.g. "Slack". */
			__( 'Add %s', 'vip-workflow' ),
			group.label
		);

		if (
			hasUnsavedChanges &&
			! ( await confirm(
				__(
					'Adding a channel reloads this page, which discards the unsaved changes on it. Add the channel anyway?',
					'vip-workflow'
				),
				{ confirmLabel: addLabel }
			) )
		) {
			return;
		}

		setAddingGroup( group.prefix );
		setError( null );

		try {
			// Reloads the page on success, so there is no success state to reset.
			await addChannelDestination( group );
		} catch ( err ) {
			setError( err.message );
			setAddingGroup( null );
		}
	};

	// Removing a destination discards its configuration for good, so it is a
	// delete: destructive weight, and a confirm that repeats the verb.
	const deleteChannel = async ( channelId, group ) => {
		const message = hasUnsavedChanges
			? __(
					'Delete this channel? The page reloads afterwards, which discards the unsaved changes on it.',
					'vip-workflow'
			  )
			: __( 'Delete this channel?', 'vip-workflow' );

		if (
			! ( await confirm( message, {
				isDestructive: true,
				confirmLabel: __( 'Delete', 'vip-workflow' ),
			} ) )
		) {
			return;
		}

		try {
			const destinations = await fetchChannelDestinations( group );

			const destId = channelId.replace( group.prefix, '' );
			const filtered = destinations.filter( ( d ) => d.id !== destId );

			// Nothing matched, so this POST would write the list back unchanged
			// and reload to show the channel still there. The card was built
			// from a destination the group no longer claims — a mismatch worth
			// saying out loud, not a deletion to report as done.
			if ( filtered.length === destinations.length ) {
				throw new Error(
					sprintf(
						/* translators: %s: channel id. */
						__(
							'“%s” is not in this group’s destinations, so there was nothing to delete. Reload the page to see the current channels.',
							'vip-workflow'
						),
						channelId
					)
				);
			}

			await apiFetch( {
				path: group.addEndpoint,
				method: 'POST',
				data: filtered,
			} );

			window.location.reload();
		} catch ( err ) {
			setError( err.message );
		}
	};

	const handleTabChange = ( value ) => {
		setActiveTab( value );
		const url = new URL( window.location.href );
		url.searchParams.set( 'tab', value );
		window.history.replaceState( {}, '', url );
	};

	// Which group a channel was added from, or null for one registered in code
	// ( Email ). Only a grouped channel can be deleted.
	const groupFor = ( channel ) =>
		groups.find( ( group ) => channel.id.startsWith( group.prefix ) ) ||
		null;

	return {
		channels,
		settings,
		events,
		routing,
		debug,
		setDebug,
		loading,
		loadError,
		error,
		setError,
		saving,
		canSave: hasUnsavedChanges,
		testing,
		groups,
		groupFor,
		addingGroup,
		isChannelDirty,
		updateChannelSetting,
		setEventChannels,
		toggleRoute,
		routeChannelToEveryEvent,
		handleSave,
		testChannel,
		addChannel,
		deleteChannel,
		tabs,
		activeTab,
		handleTabChange,
		confirmDialog,
	};
}

/**
 * The channels themselves, and the routing they feed.
 *
 * @param {Object} props       Component props.
 * @param {Object} props.state What `useNotificationSettings()` returned.
 * @return {JSX.Element} The screen body.
 */
export function NotificationChannelsTab( { state } ) {
	const {
		channels,
		settings,
		events,
		routing,
		debug,
		setDebug,
		loading,
		loadError,
		error,
		setError,
		testing,
		groupFor,
		isChannelDirty,
		updateChannelSetting,
		setEventChannels,
		toggleRoute,
		routeChannelToEveryEvent,
		testChannel,
		deleteChannel,
		tabs,
		activeTab,
		handleTabChange,
		confirmDialog,
	} = state;

	if ( loading ) {
		return (
			<SettingsLoading
				label={ __( 'Loading channels…', 'vip-workflow' ) }
			/>
		);
	}

	if ( loadError ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ loadError }
			</Notice>
		);
	}

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

				<Tabs.Panel value="channels" keepMounted>
					{ channels.length === 0 ? (
						<Text variant="body-md" render={ <p /> }>
							{ __(
								'No notification channels are registered yet.',
								'vip-workflow'
							) }
						</Text>
					) : (
						<Stack direction="column" gap="lg">
							{ channels.map( ( channel ) => {
								const group = groupFor( channel );

								return (
									<ChannelCard
										key={ channel.id }
										channel={ channel }
										settings={
											settings[ channel.id ] || {}
										}
										onSettingChange={ ( key, value ) =>
											updateChannelSetting(
												channel.id,
												key,
												value
											)
										}
										onTest={ () =>
											testChannel( channel.id )
										}
										onDelete={
											// Only a channel that belongs to a
											// group can be deleted; the rest are
											// registered in code.
											group
												? () =>
														deleteChannel(
															channel.id,
															group
														)
												: null
										}
										testing={ testing[ channel.id ] }
										isDirty={ isChannelDirty( channel.id ) }
									/>
								);
							} ) }
						</Stack>
					) }
				</Tabs.Panel>

				<Tabs.Panel value="routing" keepMounted>
					<NotificationsApp
						events={ events }
						channels={ channels }
						routing={ routing }
						debug={ debug }
						onToggleRoute={ toggleRoute }
						onSetEventChannels={ setEventChannels }
						onRouteChannelToEveryEvent={ routeChannelToEveryEvent }
						onDebugChange={ setDebug }
					/>
				</Tabs.Panel>
			</Tabs.Root>
			{ confirmDialog }
		</Stack>
	);
}

/**
 * One channel.
 *
 * The card carries no Save: the screen has one, in the page header. What it does
 * carry is the pair of actions that belong to this channel alone — deleting it,
 * and sending a test through it.
 *
 * @param {Object}    props                 Component props.
 * @param {Object}    props.channel         Channel descriptor ( id, name, description, configured ).
 * @param {Object}    props.settings        Current settings values for this channel.
 * @param {Function}  props.onSettingChange Called with ( key, value ) when a setting changes.
 * @param {Function}  props.onTest          Sends a test notification through the channel.
 * @param {?Function} props.onDelete        Deletes the channel, or null when it is registered in code.
 * @param {boolean}   props.testing         Whether a test send is in progress.
 * @param {boolean}   props.isDirty         Whether the channel has unsaved changes.
 * @return {JSX.Element} The channel card.
 */
function ChannelCard( {
	channel,
	settings,
	onSettingChange,
	onTest,
	onDelete,
	testing,
	isDirty,
} ) {
	const hasActions = Boolean( onDelete ) || channel.configured;

	return (
		<Card.Root>
			<Card.Header
				render={
					<Stack justify="space-between" align="center" gap="md" />
				}
			>
				<Card.Title render={ <h2 /> }>{ channel.name }</Card.Title>
				{ /* The only badge this card earns: state the reader has to act
				     on. "Configured" was the same fact said the other way round,
				     on every card that had nothing wrong with it. */ }
				{ ! channel.configured && (
					<Badge intent="medium">
						{ __( 'Setup needed', 'vip-workflow' ) }
					</Badge>
				) }
			</Card.Header>
			<Card.Content render={ <Stack direction="column" gap="lg" /> }>
				<Text variant="body-md" render={ <p /> }>
					{ channel.description }
				</Text>

				<ChannelSettings
					channel={ channel }
					channelId={ channel.id }
					settings={ settings }
					onChange={ onSettingChange }
				/>

				{ hasActions && (
					<ActionRow>
						{ /* A test sends with the settings the server already
						     holds, so it waits for the save. Said in the row
						     rather than in a `title` tooltip, which assistive
						     tech does not reliably reach. */ }
						{ channel.configured && isDirty && (
							<Text variant="body-sm">
								{ __( 'Save to send a test.', 'vip-workflow' ) }
							</Text>
						) }
						{ onDelete && (
							<Button
								variant="secondary"
								isDestructive
								onClick={ onDelete }
							>
								{ __( 'Delete', 'vip-workflow' ) }
							</Button>
						) }
						{ channel.configured && (
							<Button
								variant="secondary"
								onClick={ onTest }
								isBusy={ testing }
								disabled={ testing || isDirty }
							>
								{ __( 'Send test', 'vip-workflow' ) }
							</Button>
						) }
					</ActionRow>
				) }
			</Card.Content>
		</Card.Root>
	);
}

/**
 * Channel-specific settings fields.
 * Built-in channels (slack, email) have hardcoded UI.
 * Third-party plugins can register their UI via the 'vipWorkflow.channelSettingsComponent' filter.
 *
 * @param {Object}   props           Component props.
 * @param {Object}   props.channel   Channel descriptor, including any settings_schema.
 * @param {string}   props.channelId Unique channel identifier used to select the UI variant.
 * @param {Object}   props.settings  Current settings values for this channel.
 * @param {Function} props.onChange  Called with ( key, value ) when a field changes.
 * @return {JSX.Element} The channel-specific settings fields.
 */
function ChannelSettings( { channel, channelId, settings, onChange } ) {
	// Allow plugins to provide their own settings component (full React UI).
	const PluginComponent = applyFilters(
		'vipWorkflow.channelSettingsComponent',
		null,
		channelId,
		{ settings, onChange }
	);

	if ( PluginComponent ) {
		return PluginComponent;
	}

	// Slack channels (slack-default, slack-xxx, etc.)
	if ( channelId.startsWith( 'slack-' ) ) {
		return (
			<Stack direction="column" gap="sm">
				<TextControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Channel name', 'vip-workflow' ) }
					value={ settings.name || '' }
					onChange={ ( value ) => onChange( 'name', value ) }
					placeholder={ __(
						'e.g., Slack (#editorial)',
						'vip-workflow'
					) }
					help={ __(
						'A friendly name to identify this Slack channel',
						'vip-workflow'
					) }
				/>
				<TextControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Webhook URL', 'vip-workflow' ) }
					value={ settings.webhook_url || '' }
					onChange={ ( value ) => onChange( 'webhook_url', value ) }
					placeholder={ __(
						'https://hooks.slack.com/services/…',
						'vip-workflow'
					) }
					type="url"
					help={
						<ExternalLink href="https://api.slack.com/messaging/webhooks">
							{ __(
								'Create a webhook at api.slack.com',
								'vip-workflow'
							) }
						</ExternalLink>
					}
				/>
				<Stack
					className="vip-workflow-channel-settings__control-row"
					gap="lg"
				>
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Bot name', 'vip-workflow' ) }
						value={ settings.bot_name || 'Workflow Bot' }
						onChange={ ( value ) => onChange( 'bot_name', value ) }
					/>
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Bot icon', 'vip-workflow' ) }
						value={ settings.bot_icon || ':newspaper:' }
						onChange={ ( value ) => onChange( 'bot_icon', value ) }
						help={ __(
							'A Slack emoji shortcode, or an https image URL',
							'vip-workflow'
						) }
					/>
				</Stack>
			</Stack>
		);
	}

	// Built-in channel settings.
	switch ( channelId ) {
		case 'email':
			return (
				<Stack direction="column" gap="sm">
					<CheckboxControl
						label={ __( 'Notify post author', 'vip-workflow' ) }
						checked={ settings.notify_author ?? true }
						onChange={ ( value ) =>
							onChange( 'notify_author', value )
						}
						__nextHasNoMarginBottom
					/>
					<CheckboxControl
						label={ __( 'Notify administrators', 'vip-workflow' ) }
						checked={ settings.notify_admins ?? true }
						onChange={ ( value ) =>
							onChange( 'notify_admins', value )
						}
						__nextHasNoMarginBottom
					/>
					{ /* The placeholder is two example addresses on their own
					     lines. It stays untranslated: `example.com` is the
					     reserved example domain in every locale, and a
					     translation carrying the newline between them is
					     disallowed. */ }
					<TextareaControl
						__nextHasNoMarginBottom
						label={ __( 'Additional recipients', 'vip-workflow' ) }
						value={ settings.additional_recipients || '' }
						onChange={ ( value ) =>
							onChange( 'additional_recipients', value )
						}
						placeholder={ 'email1@example.com\nemail2@example.com' }
						help={ __( 'One email per line', 'vip-workflow' ) }
						rows={ 3 }
					/>
				</Stack>
			);

		default: {
			const schema = channel?.settings_schema;
			if ( schema && Object.keys( schema ).length > 0 ) {
				return (
					<SchemaSettings
						schema={ schema }
						values={ settings }
						onChange={ ( key, value ) => onChange( key, value ) }
					/>
				);
			}

			return (
				<Text variant="body-md" render={ <p /> }>
					{ __(
						'Configure this channel using its settings.',
						'vip-workflow'
					) }
				</Text>
			);
		}
	}
}
