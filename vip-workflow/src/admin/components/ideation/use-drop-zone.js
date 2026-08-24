/**
 * Drop Zone Hook.
 *
 * Listens for drag-and-drop events at the document level (capture phase)
 * so the entire page acts as a drop zone. Uses capture phase to fire
 * before WordPress's built-in media uploader drag handlers.
 */

import { useState, useEffect, useRef } from '@wordpress/element';

/**
 * @param {Object}   options          Hook options.
 * @param {Function} options.onDrop   Callback receiving an array of Files.
 * @param {boolean}  options.disabled Disable the drop zone.
 * @return {Object} Drop zone state.
 */
export function useDropZone( { onDrop, disabled = false } ) {
	const [ isDragging, setIsDragging ] = useState( false );
	const dragCounter = useRef( 0 );
	const onDropRef = useRef( onDrop );
	const disabledRef = useRef( disabled );
	onDropRef.current = onDrop;
	disabledRef.current = disabled;

	useEffect( () => {
		const handleDragEnter = ( e ) => {
			if ( disabledRef.current ) {
				return;
			}
			if ( ! e.dataTransfer?.types?.includes( 'Files' ) ) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			dragCounter.current++;
			setIsDragging( true );
		};

		const handleDragLeave = ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounter.current--;
			if ( dragCounter.current <= 0 ) {
				dragCounter.current = 0;
				setIsDragging( false );
			}
		};

		const handleDragOver = ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			if ( e.dataTransfer ) {
				e.dataTransfer.dropEffect = disabledRef.current
					? 'none'
					: 'copy';
			}
		};

		const handleDrop = ( e ) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounter.current = 0;
			setIsDragging( false );

			if ( disabledRef.current ) {
				return;
			}

			const files = Array.from( e.dataTransfer?.files || [] );
			if ( files.length > 0 && onDropRef.current ) {
				onDropRef.current( files );
			}
		};

		document.addEventListener( 'dragenter', handleDragEnter, true );
		document.addEventListener( 'dragleave', handleDragLeave, true );
		document.addEventListener( 'dragover', handleDragOver, true );
		document.addEventListener( 'drop', handleDrop, true );

		return () => {
			document.removeEventListener( 'dragenter', handleDragEnter, true );
			document.removeEventListener( 'dragleave', handleDragLeave, true );
			document.removeEventListener( 'dragover', handleDragOver, true );
			document.removeEventListener( 'drop', handleDrop, true );
		};
	}, [] );

	return { isDragging };
}
