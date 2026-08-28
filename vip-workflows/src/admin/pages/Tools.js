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
					label: __( 'Workflows', 'vip-workflows' ),
					href: 'admin.php?page=vip-workflows',
				},
				{ label: __( 'Tools', 'vip-workflows' ) },
			] }
			title={ __( 'Tools', 'vip-workflows' ) }
			subtitle={ __(
				'Configure workflow tools available to your team.',
				'vip-workflows'
			) }
			actions={
				<>
					<Button
						variant="secondary"
						onClick={ () => setShowHowTo( true ) }
					>
						{ __( 'Add custom tools', 'vip-workflows' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ tools.handleSave }
						isBusy={ tools.saving }
						disabled={ tools.saving || ! tools.canSave }
					>
						{ __( 'Save', 'vip-workflows' ) }
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
