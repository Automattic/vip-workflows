/**
 * ToolFailuresModal — shared "transition blocked" / warnings dialog.
 *
 * Renders a message plus optional lists of hard failures (blocking) and soft
 * warnings (non-blocking). Used by both the editor (WorkflowStatusPanel) and the
 * admin Ideation workspace (IdeationWorkspace), and for the soft-warnings
 * confirmation those screens show before proceeding.
 *
 * Item shape: `{ tool?: string, label?: string, message: string }`. Whichever
 * of `label` and `tool` is present becomes the bold prefix — the required-field
 * refusal names the FIELD, the tool refusal names the TOOL, and both are the
 * "which of these is this row about" the reader needs before the message. An
 * item carrying neither (soft warning lists that are message-only) renders
 * without a prefix.
 *
 * Pass `actions` to supply the footer buttons (e.g. cancel + proceed). When
 * omitted, a single primary "Close" button that calls `onClose` is rendered.
 *
 * Styling lives in src/styles/tool-failures-modal.css (imported by both the
 * admin and editor style.css bundles).
 *
 * See docs/guides/modal-standard.md.
 *
 * @package
 */

import { Modal, Button, Icon } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { closeSmall, caution } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

import { ModalActions } from './ModalActions';

function FailureList( { items, variant } ) {
	const icon = variant === 'hard' ? closeSmall : caution;

	// A required-field row carries `label` (the field's authored label); a tool
	// row carries `tool` (the ability id). One prefix slot serves both, so a
	// mixed list reads as one list instead of bold rows next to bare ones.
	const prefixOf = ( item ) => item.label || item.tool;

	return (
		<Stack
			render={ <ul /> }
			direction="column"
			gap="sm"
			className={ `vip-workflow-tool-failures-modal__list vip-workflow-tool-failures-modal__list--${ variant }` }
		>
			{ items.map( ( item, i ) => (
				<Stack
					key={ i }
					render={ <li /> }
					direction="row"
					align="flex-start"
					gap="sm"
					className="vip-workflow-tool-failures-modal__item"
				>
					<span className="vip-workflow-tool-failures-modal__icon">
						<Icon icon={ icon } size={ 16 } />
					</span>
					{ /* wpds-allow R7 -- wraps mixed inline content (a bold tool prefix plus the message); <Text> exposes only `variant`, so the <strong> inside would still need its weight from CSS */ }
					<span className="vip-workflow-tool-failures-modal__text">
						{ prefixOf( item ) && (
							<>
								<strong>{ prefixOf( item ) }:</strong>{ ' ' }
							</>
						) }
						{ item.message }
					</span>
				</Stack>
			) ) }
		</Stack>
	);
}

export function ToolFailuresModal( {
	title,
	message,
	hardFailures = [],
	softWarnings = [],
	hardTitle = __( 'Required checks failed', 'vip-workflow' ),
	softTitle = __( 'Warnings (not blocking)', 'vip-workflow' ),
	onClose,
	actions,
	className,
} ) {
	const classNames = [ 'vip-workflow-tool-failures-modal', className ]
		.filter( Boolean )
		.join( ' ' );

	return (
		<Modal
			title={ title }
			onRequestClose={ onClose }
			className={ classNames }
			size="medium"
			// The default footer verb is "Close", so the header X needs its own
			// name — two buttons announced identically is a screen-reader dead
			// end, and an ambiguous role+name target for tests.
			closeButtonLabel={ __( 'Close dialog', 'vip-workflow' ) }
		>
			<Stack direction="column" gap="lg">
				{ message && (
					<Text
						variant="body-md"
						render={ <p /> }
						className="vip-workflow-tool-failures-modal__message"
					>
						{ message }
					</Text>
				) }

				{ hardFailures.length > 0 && (
					<Stack
						direction="column"
						gap="md"
						className="vip-workflow-tool-failures-modal__section"
					>
						<Text variant="heading-md" render={ <h4 /> }>
							{ hardTitle }
						</Text>
						<FailureList items={ hardFailures } variant="hard" />
					</Stack>
				) }

				{ softWarnings.length > 0 && (
					<Stack
						direction="column"
						gap="md"
						className="vip-workflow-tool-failures-modal__section"
					>
						<Text variant="heading-md" render={ <h4 /> }>
							{ softTitle }
						</Text>
						<FailureList items={ softWarnings } variant="soft" />
					</Stack>
				) }
			</Stack>

			<ModalActions>
				{ actions || (
					<Button variant="primary" onClick={ onClose }>
						{ __( 'Close', 'vip-workflow' ) }
					</Button>
				) }
			</ModalActions>
		</Modal>
	);
}
