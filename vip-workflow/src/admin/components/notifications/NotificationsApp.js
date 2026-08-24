/**
 * Event routing.
 *
 * The `Routing` panel of the Notifications screen: which channels receive which
 * events, and the mirror-everything switch beside it. See
 * docs/guides/settings-standard.md.
 *
 * Presentational on purpose. It used to hold its own state, its own notices and
 * two Save buttons — so the screen showed three. State, saving and error
 * reporting all belong to `useNotificationSettings()` now; this file renders
 * what it is handed and reports changes back up, which is what leaves the screen
 * with one Save.
 *
 * Two things went with that rework. The `Available Channels` card listed every
 * channel with a `Configured` pill and a test button, all of which the `Channels`
 * tab says better, on the cards that own it. And the event tables were grouped
 * by `event.category`, a field the events route has never returned — so every
 * event landed in one bucket headed `Other Events`. One table, no bucket.
 *
 * @package
 */

import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	CheckboxControl,
	Notice,
	ToggleControl,
} from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { SettingsSection } from '../SettingsSection';

import './notifications.css';

/**
 * The routing matrix and the debug mirror.
 *
 * @param {Object}   props                            Component props.
 * @param {Array}    props.events                     Event types ( id, label ).
 * @param {Array}    props.channels                   Every registered channel.
 * @param {Object}   props.routing                    Event id → channel ids.
 * @param {Object}   props.debug                      `{ enabled, channels }`.
 * @param {Function} props.onToggleRoute              Called with ( eventId, channelId ).
 * @param {Function} props.onSetEventChannels         Called with ( eventId, channelIds ).
 * @param {Function} props.onRouteChannelToEveryEvent Called with ( channelId ).
 * @param {Function} props.onDebugChange              Called with the next debug settings.
 * @return {JSX.Element} The routing panel.
 */
export function NotificationsApp( {
	events,
	channels,
	routing,
	debug,
	onToggleRoute,
	onSetEventChannels,
	onRouteChannelToEveryEvent,
	onDebugChange,
} ) {
	const configuredChannels = channels.filter(
		( channel ) => channel.configured
	);

	const isRouted = ( eventId, channelId ) =>
		( routing[ eventId ] || [] ).includes( channelId );

	const toggleDebugChannel = ( channelId ) => {
		const selected = debug.channels || [];

		onDebugChange( {
			...debug,
			channels: selected.includes( channelId )
				? selected.filter( ( entry ) => entry !== channelId )
				: [ ...selected, channelId ],
		} );
	};

	return (
		<Stack direction="column" gap="2xl">
			<SettingsSection
				title={ __( 'Event routing', 'vip-workflow' ) }
				description={ __(
					'Choose which channels receive each event. Only a configured channel can be selected — set one up on the Channels tab first.',
					'vip-workflow'
				) }
			>
				{ 0 === configuredChannels.length ? (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'No notification channel is configured yet, so no event can be routed anywhere.',
							'vip-workflow'
						) }
					</Notice>
				) : (
					<Stack direction="column" gap="lg">
						{ /* A row-scoped utility cluster, not an action bar:
						     each button fills one column of the grid below it,
						     so it belongs beside that grid rather than
						     right-aligned away from it. */ }
						<Stack direction="row" wrap="wrap" gap="sm">
							{ configuredChannels.map( ( channel ) => (
								<Button
									key={ channel.id }
									variant="secondary"
									size="small"
									onClick={ () =>
										onRouteChannelToEveryEvent( channel.id )
									}
								>
									{ sprintf(
										/* translators: %s: notification channel name, e.g. "Slack". */
										__(
											'Route every event to %s',
											'vip-workflow'
										),
										channel.name
									) }
								</Button>
							) ) }
						</Stack>

						{ /* wpds-allow R7 -- overflow container: the matrix
						     grows a column per channel, so it has to scroll
						     inside the page's constrained content column
						     rather than paint outside it. */ }
						<div className="vip-workflow-notifications__scroll">
							<table className="vip-workflow-notifications__table">
								<thead>
									<tr>
										<th>
											{ __( 'Event', 'vip-workflow' ) }
										</th>
										{ configuredChannels.map(
											( channel ) => (
												<th
													key={ channel.id }
													className="vip-workflow-notifications__channel-header"
												>
													{ channel.name }
												</th>
											)
										) }
										<th>
											{ __( 'Actions', 'vip-workflow' ) }
										</th>
									</tr>
								</thead>
								<tbody>
									{ events.map( ( event ) => (
										<tr key={ event.id }>
											<td className="vip-workflow-notifications__event-cell">
												<Stack direction="column">
													<Text variant="heading-md">
														{ event.label }
													</Text>
													{ /* wpds-allow R7 -- no <Text> variant pairs 11px with a monospace family, and a raw code element picks up wp-admin's unlayered background and padding chrome, so the event id keeps its type in CSS */ }
													<span className="vip-workflow-notifications__event-id">
														{ event.id }
													</span>
												</Stack>
											</td>
											{ configuredChannels.map(
												( channel ) => (
													<td key={ channel.id }>
														{ /* The checkbox centres itself in the column via
														     this row, not a `margin: 0 auto` reaching into
														     CheckboxControl's internals. The <td> stays a
														     real table cell so column widths still work. */ }
														<Stack
															direction="row"
															justify="center"
														>
															<CheckboxControl
																__nextHasNoMarginBottom
																aria-label={ sprintf(
																	/* translators: 1: event name, 2: notification channel name. */
																	__(
																		'%1$s via %2$s',
																		'vip-workflow'
																	),
																	event.label,
																	channel.name
																) }
																checked={ isRouted(
																	event.id,
																	channel.id
																) }
																onChange={ () =>
																	onToggleRoute(
																		event.id,
																		channel.id
																	)
																}
															/>
														</Stack>
													</td>
												)
											) }
											<td className="vip-workflow-notifications__actions-cell">
												{ /* A row-scoped utility pair beside the checkboxes it
												     toggles, not an action bar: a plain gapped row keeps
												     All/None adjacent to the grid — ActionRow's flex-end
												     would strand them at the far edge of the cell. */ }
												<Stack direction="row" gap="sm">
													<Button
														variant="tertiary"
														size="small"
														onClick={ () =>
															onSetEventChannels(
																event.id,
																configuredChannels.map(
																	( c ) =>
																		c.id
																)
															)
														}
													>
														{ __(
															'All',
															'vip-workflow'
														) }
													</Button>
													<Button
														variant="tertiary"
														size="small"
														onClick={ () =>
															onSetEventChannels(
																event.id,
																[]
															)
														}
													>
														{ __(
															'None',
															'vip-workflow'
														) }
													</Button>
												</Stack>
											</td>
										</tr>
									) ) }
								</tbody>
							</table>
						</div>
					</Stack>
				) }
			</SettingsSection>

			<SettingsSection
				title={ __( 'Debug mode', 'vip-workflow' ) }
				description={ __(
					'Mirror every event to the channels selected here, whatever the routing above says. Useful while testing a new channel.',
					'vip-workflow'
				) }
			>
				<ToggleControl
					__nextHasNoMarginBottom
					label={ __( 'Mirror all events', 'vip-workflow' ) }
					checked={ Boolean( debug.enabled ) }
					onChange={ ( enabled ) =>
						onDebugChange( { ...debug, enabled } )
					}
				/>

				{ debug.enabled &&
					( 0 === configuredChannels.length ? (
						<Text variant="body-md" render={ <p /> }>
							{ __(
								'No configured channel to mirror to yet.',
								'vip-workflow'
							) }
						</Text>
					) : (
						<Stack direction="column" gap="sm">
							{ configuredChannels.map( ( channel ) => (
								<CheckboxControl
									__nextHasNoMarginBottom
									key={ channel.id }
									label={ channel.name }
									checked={ ( debug.channels || [] ).includes(
										channel.id
									) }
									onChange={ () =>
										toggleDebugChannel( channel.id )
									}
								/>
							) ) }
						</Stack>
					) ) }
			</SettingsSection>
		</Stack>
	);
}
