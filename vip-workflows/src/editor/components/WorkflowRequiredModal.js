/**
 * Workflow Required Modal
 *
 * Shows when settings require/recommend workflow selection for new posts.
 *
 * @package
 */

import { useState, useEffect } from '@wordpress/element';
import { Modal, Button, Spinner, SelectControl } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { ModalActions } from '../../common/ModalActions';

export function WorkflowRequiredModal( { postId, mode, onSelect, onSkip } ) {
	const [ sequences, setSequences ] = useState( [] );
	const [ selectedId, setSelectedId ] = useState( '' );
	const [ loading, setLoading ] = useState( true );
	const [ assigning, setAssigning ] = useState( false );
	const { createErrorNotice } = useDispatch( noticesStore );

	const isRequired = mode === 'require';

	// Fetch available sequences.
	useEffect( () => {
		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/status`,
		} )
			.then( ( response ) => {
				const available = response.available_sequences || [];
				setSequences( available );
				// Pre-select first option if only one.
				if ( available.length === 1 ) {
					setSelectedId( String( available[ 0 ].id ) );
				}
				setLoading( false );
			} )
			.catch( () => {
				setSequences( [] );
				setLoading( false );
			} );
	}, [ postId ] );

	// Handle sequence assignment.
	const handleAssign = () => {
		if ( ! selectedId ) {
			return;
		}

		setAssigning( true );

		apiFetch( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/sequence`,
			method: 'POST',
			data: { sequence_id: parseInt( selectedId, 10 ) },
		} )
			.then( () => {
				onSelect?.();
			} )
			.catch( ( err ) => {
				createErrorNotice(
					err.message ||
						__( 'Failed to assign workflow', 'vip-workflows' ),
					{ type: 'snackbar' }
				);
				setAssigning( false );
			} );
	};

	const introText = isRequired
		? __(
				'Your organization requires a workflow for new posts. Please select one to continue:',
				'vip-workflows'
		  )
		: __(
				'Your organization recommends using a workflow for new posts. Select one below or skip to continue without a workflow:',
				'vip-workflows'
		  );

	let body;
	if ( loading ) {
		body = (
			<Stack
				className="vip-workflows-required-modal__loading"
				direction="row"
				justify="center"
			>
				<Spinner />
			</Stack>
		);
	} else if ( sequences.length === 0 ) {
		body = (
			<>
				<Text
					variant="body-md"
					render={ <p /> }
					className="vip-workflows-required-modal__empty"
				>
					{ __(
						'No workflows available for this post type.',
						'vip-workflows'
					) }
				</Text>
				{ ! isRequired && (
					<ModalActions>
						{ /* Same verb, same weight as the picker branch's
						     Skip: one label may not wear two variants in one
						     modal, and declining the flow stays low-stakes
						     with or without sequences to choose from. */ }
						<Button variant="tertiary" onClick={ onSkip }>
							{ __( 'Skip', 'vip-workflows' ) }
						</Button>
					</ModalActions>
				) }
			</>
		);
	} else {
		body = (
			<Stack direction="column" gap="lg">
				<SelectControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Workflow', 'vip-workflows' ) }
					value={ selectedId }
					options={ [
						{
							value: '',
							label: __(
								'— Select a workflow —',
								'vip-workflows'
							),
							disabled: true,
						},
						...sequences.map( ( bp ) => ( {
							value: String( bp.id ),
							label: bp.name,
						} ) ),
					] }
					onChange={ setSelectedId }
					disabled={ assigning }
				/>
				<ModalActions>
					{ ! isRequired && (
						<Button
							variant="tertiary"
							onClick={ onSkip }
							disabled={ assigning }
						>
							{ __( 'Skip', 'vip-workflows' ) }
						</Button>
					) }
					<Button
						variant="primary"
						onClick={ handleAssign }
						disabled={ ! selectedId || assigning }
						isBusy={ assigning }
					>
						{ __( 'Start workflow', 'vip-workflows' ) }
					</Button>
				</ModalActions>
			</Stack>
		);
	}

	return (
		<Modal
			title={ __( 'Select a Workflow', 'vip-workflows' ) }
			isDismissible={ ! isRequired }
			shouldCloseOnClickOutside={ ! isRequired }
			shouldCloseOnEsc={ ! isRequired }
			onRequestClose={ isRequired ? undefined : onSkip }
			className="vip-workflows-required-modal"
			size="small"
		>
			<div className="vip-workflows-required-modal__content">
				<Text
					variant="body-md"
					render={ <p /> }
					className="vip-workflows-required-modal__intro"
				>
					{ introText }
				</Text>

				{ body }
			</div>
		</Modal>
	);
}
