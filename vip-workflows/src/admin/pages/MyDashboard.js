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
					label: __( 'Workflows', 'vip-workflows' ),
					href: 'admin.php?page=vip-workflows',
				},
				{ label: __( 'My Dashboard', 'vip-workflows' ) },
			] }
			title={ __( 'My Dashboard', 'vip-workflows' ) }
			subtitle={ __(
				'Your personal workspace for work and ideation.',
				'vip-workflows'
			) }
		>
			<MyDashboardPage />
		</AdminPage>
	);
}
