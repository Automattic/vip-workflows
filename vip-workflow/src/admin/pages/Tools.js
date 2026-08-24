/**
 * Tools Page Component
 *
 * Configure workflow tools (abilities) registered with the system.
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import AdminPage from '../components/AdminPage';
import {
	ToolsSettings,
	ToolsHowToModal,
	useToolsSettings,
} from '../components/ToolsSettings';

/**
 * Tools page component.
 *
 * @return {JSX.Element} Tools page.
 */
export default function Tools() {
	const [ showHowTo, setShowHowTo ] = useState( false );
	const tools = useToolsSettings();

	return (
		<AdminPage
			breadcrumbs={ [
				{
					label: __( 'Workflows', 'vip-workflow' ),
					href: 'admin.php?page=vip-workflow',
				},
				{ label: __( 'Tools', 'vip-workflow' ) },
			] }
			title={ __( 'Tools', 'vip-workflow' ) }
			subtitle={ __(
				'Configure workflow tools available to your team.',
				'vip-workflow'
			) }
			actions={
				<>
					<Button
						variant="secondary"
						onClick={ () => setShowHowTo( true ) }
					>
						{ __( 'Add custom tools', 'vip-workflow' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ tools.handleSave }
						isBusy={ tools.saving }
						disabled={ tools.saving || ! tools.canSave }
					>
						{ __( 'Save', 'vip-workflow' ) }
					</Button>
				</>
			}
			constrained
		>
			<ToolsSettings state={ tools } />
			{ showHowTo && (
				<ToolsHowToModal onClose={ () => setShowHowTo( false ) } />
			) }
		</AdminPage>
	);
}
