/**
 * Add Source Modal.
 *
 * Allows users to manually add sources to their ideation workspace
 * via URL or file upload. Uses the existing research project endpoints.
 */

import { useState, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	Modal,
	Button,
	TextControl,
	SelectControl,
	FormFileUpload,
	Notice,
} from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';

import { ModalActions } from '../../../common/ModalActions';

import './AddSourceModal.css';

const SOURCE_TYPES = [
	{ label: __( 'Article', 'vip-workflows' ), value: 'article' },
	{ label: __( 'Image', 'vip-workflows' ), value: 'image' },
	{ label: __( 'Video', 'vip-workflows' ), value: 'video' },
	{ label: __( 'Document', 'vip-workflows' ), value: 'document' },
	{ label: __( 'Audio', 'vip-workflows' ), value: 'audio' },
	{ label: __( 'Social', 'vip-workflows' ), value: 'social' },
];

/**
 * @param {Object}   props           Component props.
 * @param {number}   props.projectId Active project ID.
 * @param {Function} props.onClose   Close the modal.
 * @param {Function} props.onAdded   Callback when a source is added.
 * @return {JSX.Element} Add source modal.
 */
export default function AddSourceModal( { projectId, onClose, onAdded } ) {
	const [ mode, setMode ] = useState( 'url' );
	const [ url, setUrl ] = useState( '' );
	const [ title, setTitle ] = useState( '' );
	const [ sourceType, setSourceType ] = useState( 'article' );
	const [ uploading, setUploading ] = useState( false );
	const [ error, setError ] = useState( null );

	const handleUrlSubmit = useCallback( async () => {
		if ( ! url.trim() ) {
			return;
		}

		setUploading( true );
		setError( null );

		try {
			await apiFetch( {
				path: `/vip-workflows/v1/ideation/${ projectId }/sources`,
				method: 'POST',
				data: {
					url: url.trim(),
					title: title.trim() || undefined,
					source_type: sourceType,
					origin: 'manual_url',
				},
			} );
			onAdded();
			onClose();
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to add source.', 'vip-workflows' )
			);
		} finally {
			setUploading( false );
		}
	}, [ projectId, url, title, sourceType, onAdded, onClose ] );

	const handleFileUpload = useCallback(
		async ( event ) => {
			const file = event.target.files?.[ 0 ];
			if ( ! file ) {
				return;
			}

			setUploading( true );
			setError( null );

			const formData = new FormData();
			formData.append( 'file', file );

			try {
				await apiFetch( {
					path: `/vip-workflows/v1/ideation/${ projectId }/sources/upload`,
					method: 'POST',
					body: formData,
				} );
				onAdded();
				onClose();
			} catch ( err ) {
				setError(
					err.message ||
						__( 'Failed to upload file.', 'vip-workflows' )
				);
			} finally {
				setUploading( false );
			}
		},
		[ projectId, onAdded, onClose ]
	);

	return (
		<Modal
			title={ __( 'Add source', 'vip-workflows' ) }
			onRequestClose={ onClose }
			className="vip-workflows-ideation-add-source-modal"
			size="medium"
		>
			{ error && (
				<Notice
					status="error"
					isDismissible
					onDismiss={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }

			<Stack direction="column" gap="lg">
				<Stack gap="sm">
					<Button
						variant={ mode === 'url' ? 'primary' : 'secondary' }
						onClick={ () => setMode( 'url' ) }
						size="small"
					>
						{ __( 'Add URL', 'vip-workflows' ) }
					</Button>
					<Button
						variant={ mode === 'upload' ? 'primary' : 'secondary' }
						onClick={ () => setMode( 'upload' ) }
						size="small"
					>
						{ __( 'Upload file', 'vip-workflows' ) }
					</Button>
				</Stack>

				{ mode === 'url' ? (
					<Stack direction="column" gap="md">
						<TextControl
							label={ __( 'URL', 'vip-workflows' ) }
							value={ url }
							onChange={ setUrl }
							placeholder="https://..."
							type="url"
							__next40pxDefaultSize
						/>
						<TextControl
							label={ __( 'Title (optional)', 'vip-workflows' ) }
							value={ title }
							onChange={ setTitle }
							placeholder={ __(
								'Auto-detected from URL',
								'vip-workflows'
							) }
							__next40pxDefaultSize
						/>
						<SelectControl
							label={ __( 'Type', 'vip-workflows' ) }
							value={ sourceType }
							options={ SOURCE_TYPES }
							onChange={ setSourceType }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
					</Stack>
				) : (
					<Text variant="body-sm" render={ <p /> }>
						{ __(
							'Upload images, PDFs, or documents to add to your workspace.',
							'vip-workflows'
						) }
					</Text>
				) }
			</Stack>

			<ModalActions>
				<Button
					variant="tertiary"
					onClick={ onClose }
					disabled={ uploading }
				>
					{ __( 'Cancel', 'vip-workflows' ) }
				</Button>
				{ mode === 'url' ? (
					<Button
						variant="primary"
						onClick={ handleUrlSubmit }
						isBusy={ uploading }
						disabled={ uploading || ! url.trim() }
					>
						{ __( 'Add source', 'vip-workflows' ) }
					</Button>
				) : (
					<FormFileUpload
						accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt"
						onChange={ handleFileUpload }
						variant="primary"
						isBusy={ uploading }
						disabled={ uploading }
						__next40pxDefaultSize
					>
						{ __( 'Choose file', 'vip-workflows' ) }
					</FormFileUpload>
				) }
			</ModalActions>
		</Modal>
	);
}
