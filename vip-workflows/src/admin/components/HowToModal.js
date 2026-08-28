/**
 * HowToModal — the "Creating Custom X" documentation modal.
 *
 * Shared chrome for the Tools, Agents, and Notification-channel settings tabs,
 * which each explain how to register a custom extension. Renders the
 * InstallSkillButton, the caller-supplied prose/code as children, and a single
 * "Close" dismiss button.
 *
 * See docs/guides/modal-standard.md.
 *
 * @package
 */

import { Modal, Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import { ModalActions } from '../../common/ModalActions';
import InstallSkillButton from './InstallSkillButton';

export function HowToModal( { title, skillType, onClose, children } ) {
	return (
		<Modal
			title={ title }
			onRequestClose={ onClose }
			className="vip-workflow-howto-modal"
			size="large"
			// The footer verb is "Close", so the header X needs its own name —
			// two buttons announced identically is a screen-reader dead end.
			closeButtonLabel={ __( 'Close dialog', 'vip-workflow' ) }
		>
			<InstallSkillButton skillType={ skillType } />
			{ children }
			<ModalActions>
				<Button variant="primary" onClick={ onClose }>
					{ __( 'Close', 'vip-workflow' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}
