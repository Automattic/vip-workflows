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
					label: __( 'Workflows', 'vip-workflow' ),
					href: 'admin.php?page=vip-workflow',
				},
				{ label: __( 'Audit Log', 'vip-workflow' ) },
			] }
			title={ __( 'Audit Log', 'vip-workflow' ) }
			subtitle={ __(
				'View all workflow activity and changes.',
				'vip-workflow'
			) }
		>
			<AuditLogComponent />
		</AdminPage>
	);
}
