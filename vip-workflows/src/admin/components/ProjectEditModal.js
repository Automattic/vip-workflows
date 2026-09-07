/**
 * Project Edit Modal Component.
 *
 * Modal for editing project details (name, description, etc.).
 */

import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Modal, TextControl, Button, Notice } from '@wordpress/components';

import { ModalActions } from '../../common/ModalActions';

/**
 * Project edit modal.
 *
 * @param {Object}   props         Component props.
 * @param {Object}   props.project Project data.
 * @param {Function} props.onSave  Save callback with updated data.
 * @param {Function} props.onClose Close callback.
 * @return {JSX.Element} Modal component.
 */
export default function ProjectEditModal( { project, onSave, onClose } ) {
	const [ name, setName ] = useState( project.name || '' );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	const handleSave = async () => {
		if ( ! name.trim() ) {
			setError( __( 'Project name is required.', 'vip-workflows' ) );
			return;
		}

		setSaving( true );
		setError( null );

		try {
			await onSave( { name: name.trim() } );
			onClose();
		} catch ( err ) {
			setError( err.message );
			setSaving( false );
		}
	};

	const handleKeyDown = ( e ) => {
		if ( e.key === 'Enter' ) {
			e.preventDefault();
			handleSave();
		}
	};

	return (
		<Modal
			title={ __( 'Edit Project', 'vip-workflows' ) }
			onRequestClose={ onClose }
			size="small"
		>
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }

			<TextControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				label={ __( 'Project Name', 'vip-workflows' ) }
				value={ name }
				onChange={ setName }
				onKeyDown={ handleKeyDown }
				disabled={ saving }
			/>

			<ModalActions>
				<Button
					variant="tertiary"
					onClick={ onClose }
					disabled={ saving }
				>
					{ __( 'Cancel', 'vip-workflows' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ handleSave }
					isBusy={ saving }
					disabled={ saving }
				>
					{ __( 'Save', 'vip-workflows' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}
