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
				'The posts assigned to you, your review queue, and your ideation projects.',
				'vip-workflows'
			) }
		>
			<MyDashboardPage />
		</AdminPage>
	);
}
