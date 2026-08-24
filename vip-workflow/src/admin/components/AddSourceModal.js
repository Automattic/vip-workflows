/**
 * Add Source Modal Component.
 *
 * Modal for manually adding a URL as a source.
 */

import { useState, useRef, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	Button,
	TextControl,
	TextareaControl,
	Notice,
	Spinner,
} from '@wordpress/components';
import { Stack } from '@wordpress/ui';

import { ModalActions } from '../../common/ModalActions';
import './AddSourceModal.css';

/**
 * Modal for manually adding a source URL.
 *
 * @param {Object}   props         Component props.
 * @param {Function} props.onClose Close callback.
 * @param {Function} props.onAdd   Add source callback.
 * @return {JSX.Element} Modal component.
 */
export default function AddSourceModal( { onClose, onAdd } ) {
	const [ url, setUrl ] = useState( '' );
	const [ title, setTitle ] = useState( '' );
	const [ excerpt, setExcerpt ] = useState( '' );
	const [ saving, setSaving ] = useState( false );
	const [ fetchingMeta, setFetchingMeta ] = useState( false );
	const [ error, setError ] = useState( null );
	const lastFetchedUrl = useRef( '' );

	// Extract domain from URL.
	const getDomain = ( urlString ) => {
		try {
			const parsed = new URL( urlString );
			return parsed.hostname;
		} catch {
			return '';
		}
	};

	/**
	 * Fetch metadata from URL.
	 *
	 * @param {string} urlToFetch URL to fetch metadata from.
	 */
	const fetchUrlMeta = useCallback(
		async ( urlToFetch ) => {
			// Validate URL first.
			try {
				new URL( urlToFetch );
			} catch {
				return;
			}

			// Don't re-fetch same URL.
			if ( urlToFetch === lastFetchedUrl.current ) {
				return;
			}

			// Don't overwrite if user has already entered a title.
			if ( title.trim() ) {
				return;
			}

			lastFetchedUrl.current = urlToFetch;
			setFetchingMeta( true );

			try {
				const meta = await apiFetch( {
					path: `/vip-workflow/v1/url-meta?url=${ encodeURIComponent(
						urlToFetch
					) }`,
				} );

				// Only set if title is still empty (user didn't type while loading).
				if ( ! title.trim() && meta.title ) {
					setTitle( meta.title );
				}

				// Set description as notes if empty.
				if ( ! excerpt.trim() && meta.description ) {
					setExcerpt( meta.description );
				}
			} catch {
				// Silently fail - user can still enter title manually.
			} finally {
				setFetchingMeta( false );
			}
		},
		[ title, excerpt ]
	);

	/**
	 * Handle URL field blur.
	 */
	const handleUrlBlur = () => {
		if ( url.trim() ) {
			fetchUrlMeta( url.trim() );
		}
	};

	/**
	 * Handle URL paste.
	 *
	 * @param {ClipboardEvent} e Paste event.
	 */
	const handleUrlPaste = ( e ) => {
		// Get pasted text.
		const pasted = e.clipboardData?.getData( 'text' );
		if ( pasted ) {
			// Small delay to let the input update first.
			setTimeout( () => {
				fetchUrlMeta( pasted.trim() );
			}, 100 );
		}
	};

	const handleAdd = async () => {
		if ( ! url.trim() || ! title.trim() ) {
			setError( __( 'URL and title are required.', 'vip-workflow' ) );
			return;
		}

		// Validate URL.
		try {
			new URL( url );
		} catch {
			setError( __( 'Please enter a valid URL.', 'vip-workflow' ) );
			return;
		}

		setSaving( true );
		setError( null );

		try {
			await onAdd( {
				url: url.trim(),
				title: title.trim(),
				excerpt: excerpt.trim(),
				domain: getDomain( url.trim() ),
				source_type: 'article',
			} );
		} catch ( err ) {
			setError( err.message );
			setSaving( false );
		}
	};

	return (
		<Modal
			title={ __( 'Add Source URL', 'vip-workflow' ) }
			onRequestClose={ onClose }
			className="vip-workflow-research-add-source-modal"
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

			<Stack direction="column" gap="md">
				<TextControl
					label={ __( 'URL', 'vip-workflow' ) }
					type="url"
					value={ url }
					onChange={ setUrl }
					onBlur={ handleUrlBlur }
					onPaste={ handleUrlPaste }
					placeholder="https://example.com/article"
					__nextHasNoMarginBottom
					__next40pxDefaultSize
				/>

				<div className="vip-workflow-add-source__title-wrapper">
					<TextControl
						label={ __( 'Title', 'vip-workflow' ) }
						value={ title }
						onChange={ setTitle }
						placeholder={
							fetchingMeta
								? __( 'Fetching title…', 'vip-workflow' )
								: __(
										'Article title or description',
										'vip-workflow'
								  )
						}
						__nextHasNoMarginBottom
						__next40pxDefaultSize
					/>
					{ fetchingMeta && (
						<Spinner className="vip-workflow-add-source__meta-spinner" />
					) }
				</div>

				<TextareaControl
					label={ __( 'Notes (optional)', 'vip-workflow' ) }
					help={ __(
						'Add notes about why this source is relevant.',
						'vip-workflow'
					) }
					value={ excerpt }
					onChange={ setExcerpt }
					rows={ 3 }
					__nextHasNoMarginBottom
					__next40pxDefaultSize
				/>
			</Stack>

			<ModalActions>
				<Button
					variant="tertiary"
					onClick={ onClose }
					disabled={ saving }
				>
					{ __( 'Cancel', 'vip-workflow' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ handleAdd }
					isBusy={ saving }
					disabled={ saving || ! url.trim() || ! title.trim() }
				>
					{ __( 'Add source', 'vip-workflow' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}
