/**
 * Audit Log Page Component
 *
 * Displays workflow activity and changes.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';
import AdminPage from '../components/AdminPage';
import { AuditLog as AuditLogComponent } from '../components/AuditLog';

/**
 * Audit Log page component.
 *
 * @return {JSX.Element} Audit Log page.
 */
export default function AuditLog() {
	return (
		<AdminPage
			breadcrumbs={ [
				{
					label: __( 'Workflows', 'vip-workflows' ),
					href: 'admin.php?page=vip-workflows',
				},
				{ label: __( 'Audit Log', 'vip-workflows' ) },
			] }
			title={ __( 'Audit Log', 'vip-workflows' ) }
			subtitle={ __(
				'View all workflow activity and changes.',
				'vip-workflows'
			) }
		>
			<AuditLogComponent />
		</AdminPage>
	);
}
