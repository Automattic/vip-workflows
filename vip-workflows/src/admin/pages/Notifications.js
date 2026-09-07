/**
 * Notifications Page Component
 *
 * Single home for notifications: one `Channels` tab listing every channel as a
 * card, and one `Routing` tab holding the event-to-channel matrix and the debug
 * mirror. The tab strip and all of the screen's state live in
 * `NotificationChannelsTab`; this page owns the header — the per-group add
 * actions and the screen's one Save.
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/components';
import { plus } from '@wordpress/icons';
import { Text } from '@wordpress/ui';
import AdminPage from '../components/AdminPage';
import { HowToModal } from '../components/HowToModal';
import {
	NotificationChannelsTab,
	useNotificationSettings,
} from '../components/NotificationChannelsTab';

/**
 * Notifications page component.
 *
 * @return {JSX.Element} Notifications page.
 */
export default function Notifications() {
	const [ showHowTo, setShowHowTo ] = useState( false );
	const notifications = useNotificationSettings();

	// The custom-channel how-to reads as part of the page description rather
	// than as an action — and the header already holds real "Add …" buttons for
	// the same noun, so a documentation button beside them would read as a
	// second way to add a channel. It trails the subtitle as a link instead.
	const subtitle = (
		<>
			{ __(
				'Configure notification channels and event-to-channel routing.',
				'vip-workflows'
			) }{ ' ' }
			<Button variant="link" onClick={ () => setShowHowTo( true ) }>
				{ __( 'How to add custom channels.', 'vip-workflows' ) }
			</Button>
		</>
	);

	return (
		<AdminPage
			breadcrumbs={ [
				{
					label: __( 'Workflows', 'vip-workflows' ),
					href: 'admin.php?page=vip-workflows',
				},
				{ label: __( 'Notifications', 'vip-workflows' ) },
			] }
			title={ __( 'Notifications', 'vip-workflows' ) }
			subtitle={ subtitle }
			actions={
				<>
					{ notifications.groups.map( ( group ) => (
						<Button
							key={ group.prefix }
							variant="secondary"
							icon={ plus }
							onClick={ () => notifications.addChannel( group ) }
							isBusy={
								notifications.addingGroup === group.prefix
							}
							disabled={ notifications.addingGroup !== null }
						>
							{ sprintf(
								/* translators: %s: channel group name, e.g. "Slack". */
								__( 'Add %s', 'vip-workflows' ),
								group.label
							) }
						</Button>
					) ) }
					<Button
						variant="primary"
						onClick={ notifications.handleSave }
						isBusy={ notifications.saving }
						disabled={
							notifications.saving || ! notifications.canSave
						}
					>
						{ __( 'Save', 'vip-workflows' ) }
					</Button>
				</>
			}
			constrained
		>
			<NotificationChannelsTab state={ notifications } />
			{ showHowTo && (
				<HowToModal
					title={ __( 'Add custom channels', 'vip-workflows' ) }
					skillType="notification-channel"
					onClose={ () => setShowHowTo( false ) }
				>
					<Text variant="body-md" render={ <p /> }>
						{ __(
							'Notification channels deliver workflow events to external services. Create one as a standalone WordPress plugin that extends the NotificationChannel base class:',
							'vip-workflows'
						) }
					</Text>
					<pre className="vip-workflows-code">{ `add_action( 'vip_workflows_register_notification_channels',
    function( $dispatcher ) {
        require_once __DIR__ . '/includes/class-my-channel.php';
        $dispatcher->register_channel( new MyChannel() );
    }
);` }</pre>

					<Text variant="heading-md" render={ <h2 /> }>
						{ __( 'Required methods', 'vip-workflows' ) }
					</Text>
					<Text variant="body-md" render={ <p /> }>
						{ __(
							'Your channel class must extend NotificationChannel and implement:',
							'vip-workflows'
						) }
					</Text>
					<ul>
						<li>
							<code>get_id()</code>{ ' ' }
							{ __(
								'Unique channel identifier',
								'vip-workflows'
							) }
						</li>
						<li>
							<code>get_name()</code>{ ' ' }
							{ __( 'Display name', 'vip-workflows' ) }
						</li>
						<li>
							<code>get_description()</code>{ ' ' }
							{ __( 'Short description', 'vip-workflows' ) }
						</li>
						<li>
							<code>get_icon()</code>{ ' ' }
							{ __( 'Icon slug', 'vip-workflows' ) }
						</li>
						<li>
							<code>is_configured()</code>{ ' ' }
							{ __( 'Check if ready to send', 'vip-workflows' ) }
						</li>
						<li>
							<code>send( Notification $notification )</code>{ ' ' }
							{ __(
								'Deliver the notification',
								'vip-workflows'
							) }
						</li>
						<li>
							<code>test_connection()</code>{ ' ' }
							{ __( 'Verify the connection', 'vip-workflows' ) }
						</li>
						<li>
							<code>sanitize_settings( array $input )</code>{ ' ' }
							{ __( 'Sanitize form input', 'vip-workflows' ) }
						</li>
					</ul>

					<Text variant="heading-md" render={ <h2 /> }>
						{ __( 'Settings', 'vip-workflows' ) }
					</Text>
					<Text variant="body-md" render={ <p /> }>
						{ __(
							'Override get_settings_schema() to define fields that are auto-rendered in the admin UI. Use $this->get_settings() and $this->update_settings() for storage.',
							'vip-workflows'
						) }
					</Text>
				</HowToModal>
			) }
		</AdminPage>
	);
}
