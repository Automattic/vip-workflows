/**
 * Pre-publish confirm — the step before a transition takes the post live.
 *
 * A transition into a publish-region stage publishes the post, and it does so
 * through the workflow's own endpoint, not core's Publish. Core's pre-publish
 * panel is where other plugins get their say before a post goes live — SEO
 * checks, social sharing, checklists — through `PluginPrePublishPanel`. That
 * panel cannot be the way in: its final Publish saves with status `publish`,
 * which the publish-boundary guard refuses for a person who cannot bypass the
 * workflow. So this confirm renders the same slot itself, and those fills show
 * here, in the step the workflow does own.
 *
 * Of core's own pre-publish content, only the visibility is repeated. It is
 * one line, core's own label, and the one fact about the post that changes
 * what "publicly visible" means (a private or password-protected post). The
 * schedule is said by the warning, because a transition publishes now; core's
 * tag and featured-image suggestions are editing nudges, not checks, and are
 * one sidebar away.
 *
 * Saving locked is a plugin's way of holding a publish — core's own Publish
 * button stands down while it is — so this Publish does too.
 *
 * @package
 */

import { Button, Modal } from '@wordpress/components';
import { Text } from '@wordpress/ui';
import { useSelect } from '@wordpress/data';
import {
	PluginPrePublishPanel,
	PostVisibilityLabel,
	store as editorStore,
} from '@wordpress/editor';
import { __ } from '@wordpress/i18n';
import {
	getTransitionPublishConfirmLabel,
	getTransitionPublishConfirmTitle,
	getTransitionPublishWarning,
} from '../../common/confirm-workflow-side-effect';
import { ModalActions } from '../../common/ModalActions';

/**
 * The confirm.
 *
 * @param {Object}   props            Component props.
 * @param {string}   props.stageLabel The destination stage's label.
 * @param {boolean}  props.scheduled  Whether the post is scheduled.
 * @param {Function} props.onConfirm  Called when the person publishes.
 * @param {Function} props.onCancel   Called when the person backs out.
 * @return {JSX.Element} The dialog.
 */
export function PrePublishConfirm( {
	stageLabel,
	scheduled,
	onConfirm,
	onCancel,
} ) {
	const locked = useSelect(
		( select ) => select( editorStore ).isPostSavingLocked(),
		[]
	);

	return (
		<Modal
			title={ getTransitionPublishConfirmTitle() }
			onRequestClose={ onCancel }
			size="medium"
			className="vip-workflows-pre-publish"
		>
			<Text variant="body-md" render={ <p /> }>
				{ getTransitionPublishWarning( { stageLabel, scheduled } ) }
			</Text>
			<Text variant="body-md" render={ <p /> }>
				{ __( 'Visibility:', 'vip-workflows' ) } <PostVisibilityLabel />
			</Text>
			<div className="vip-workflows-pre-publish__checks">
				<PluginPrePublishPanel.Slot />
			</div>
			{ locked && (
				<Text variant="body-md" render={ <p /> }>
					{ __(
						'A check is holding this post. Resolve it to publish.',
						'vip-workflows'
					) }
				</Text>
			) }
			<ModalActions>
				<Button variant="tertiary" onClick={ onCancel }>
					{ __( 'Cancel', 'vip-workflows' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ onConfirm }
					disabled={ locked }
					accessibleWhenDisabled
				>
					{ getTransitionPublishConfirmLabel() }
				</Button>
			</ModalActions>
		</Modal>
	);
}
