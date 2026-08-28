/**
 * AddPostStatusModal — pick a status region to add a group for.
 *
 * The choices are the core statuses the workflow is allowed to write
 * (`Sequence::EDITORIAL_STATUSES`, mirrored in `regions.js`), minus the ones
 * already on the canvas. That set is fixed rather than open-ended: a region is
 * what `post_status` a post carries, and the workflow only ever writes those
 * four — a group for anything else would be a boundary the runtime can't
 * commit.
 *
 * `available` is never empty. The canvas menu item that opens this modal is
 * disabled once every region already has a group (`GraphCanvas.js`), which is
 * where that case belongs: an author is told there is nothing to add before the
 * dialog opens, not after. So there is always a first status to preselect, and
 * always something to add.
 *
 * @package
 */

import { useState } from '@wordpress/element';
import { Modal, SelectControl, Button } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import { ModalActions } from '../../../common/ModalActions';
import { regionDescription, regionOptions } from './regions';

export default function AddPostStatusModal( { available, onAdd, onClose } ) {
	const [ selected, setSelected ] = useState( available[ 0 ] );
	const options = regionOptions( available );

	return (
		<Modal
			title={ __( 'Add post status', 'vip-workflow' ) }
			onRequestClose={ onClose }
			size="small"
		>
			<Stack direction="column" gap="lg" align="stretch">
				<SelectControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Post status', 'vip-workflow' ) }
					help={ regionDescription( selected ) }
					value={ selected }
					options={ options }
					onChange={ setSelected }
				/>
				<Text variant="body-sm" render={ <p /> }>
					{ __(
						'Adds an empty group for this status. Drag stages into it to put them in that status; a transition that crosses the group’s edge is what changes the post’s status.',
						'vip-workflow'
					) }
				</Text>
				<ModalActions>
					<Button variant="tertiary" onClick={ onClose }>
						{ __( 'Cancel', 'vip-workflow' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ () => {
							onAdd( selected );
							onClose();
						} }
					>
						{ __( 'Add status', 'vip-workflow' ) }
					</Button>
				</ModalActions>
			</Stack>
		</Modal>
	);
}
