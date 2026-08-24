/**
 * Jobs Page Component
 *
 * Configure background jobs registered with the workflow system.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';
import AdminPage from '../components/AdminPage';
import { JobsTab } from '../components/JobsTab';

/**
 * Jobs page component.
 *
 * @return {JSX.Element} Jobs page.
 */
export default function Jobs() {
	return (
		<AdminPage
			breadcrumbs={ [
				{
					label: __( 'Workflows', 'vip-workflow' ),
					href: 'admin.php?page=vip-workflow',
				},
				{ label: __( 'Jobs', 'vip-workflow' ) },
			] }
			title={ __( 'Jobs', 'vip-workflow' ) }
			subtitle={ __(
				'Manage background jobs that run on a schedule.',
				'vip-workflow'
			) }
		>
			<JobsTab />
		</AdminPage>
	);
}
