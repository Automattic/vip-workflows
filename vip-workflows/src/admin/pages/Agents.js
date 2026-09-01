/**
 * Agents Page Component
 *
 * Configure agents (assistants) registered with the system.
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import AdminPage from '../components/AdminPage';
import {
	AssistantsTab,
	AgentsHowToModal,
	useAssistantsSettings,
} from '../components/AssistantsTab';

/**
 * Agents page component.
 *
 * @return {JSX.Element} Agents page.
 */
export default function Agents() {
	const [ showHowTo, setShowHowTo ] = useState( false );
	const agents = useAssistantsSettings();

	return (
		<AdminPage
			breadcrumbs={ [
				{
					label: __( 'Workflows', 'vip-workflows' ),
					href: 'admin.php?page=vip-workflows',
				},
				{ label: __( 'Agents', 'vip-workflows' ) },
			] }
			title={ __( 'Agents', 'vip-workflows' ) }
			subtitle={ __(
				'Configure agents that assist with editorial work.',
				'vip-workflows'
			) }
			actions={
				<>
					<Button
						variant="secondary"
						onClick={ () => setShowHowTo( true ) }
					>
						{ __( 'Add custom agents', 'vip-workflows' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ agents.handleSave }
						isBusy={ agents.saving }
						disabled={ agents.saving || ! agents.canSave }
					>
						{ __( 'Save', 'vip-workflows' ) }
					</Button>
				</>
			}
			constrained
		>
			<AssistantsTab state={ agents } />
			{ showHowTo && (
				<AgentsHowToModal onClose={ () => setShowHowTo( false ) } />
			) }
		</AdminPage>
	);
}
