/**
 * My Dashboard Page Component
 *
 * Author's personal dashboard showing their work and ideation.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';
import AdminPage from '../components/AdminPage';
import { MyDashboardPage } from './MyDashboardPage';

/**
 * My Dashboard page component.
 *
 * @return {JSX.Element} My Dashboard page.
 */
export default function MyDashboard() {
	return (
		<AdminPage
			breadcrumbs={ [
				{
					label: __( 'Workflows', 'vip-workflow' ),
					href: 'admin.php?page=vip-workflow',
				},
				{ label: __( 'My Dashboard', 'vip-workflow' ) },
			] }
			title={ __( 'My Dashboard', 'vip-workflow' ) }
			subtitle={ __(
				'Your personal workspace for work and ideation.',
				'vip-workflow'
			) }
		>
			<MyDashboardPage />
		</AdminPage>
	);
}
