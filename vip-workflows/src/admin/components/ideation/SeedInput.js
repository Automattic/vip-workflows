/**
 * Seed Input Component.
 *
 * The primary entry point for story ideation. A prominent freeform
 * text input where the journalist types their ~20-word story idea.
 */

import { useState, useRef, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Spinner } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { arrowRight } from '@wordpress/icons';

import './SeedInput.css';

/**
 * @param {Object}   props              Component props.
 * @param {Function} props.onSubmit     Called with the seed text.
 * @param {boolean}  props.isSubmitting Whether a submission is in progress.
 * @return {JSX.Element} Seed input component.
 */
export default function SeedInput( { onSubmit, isSubmitting } ) {
	const [ seed, setSeed ] = useState( '' );
	const textareaRef = useRef( null );

	useEffect( () => {
		textareaRef.current?.focus();
	}, [] );

	const handleSubmit = () => {
		const trimmed = seed.trim();
		if ( trimmed && ! isSubmitting ) {
			onSubmit( trimmed );
		}
	};

	const handleKeyDown = ( e ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			handleSubmit();
		}
	};

	return (
		<Stack
			direction="column"
			gap="2xl"
			className="vip-workflow-ideation-seed"
		>
			<Stack
				direction="column"
				gap="sm"
				className="vip-workflow-ideation-seed__header"
			>
				<Text
					variant="heading-2xl"
					render={ <h1 /> }
					className="vip-workflow-ideation-seed__title"
				>
					{ __( "What's the story?", 'vip-workflow' ) }
				</Text>
				<Text
					variant="body-md"
					render={ <p /> }
					className="vip-workflow-ideation-seed__subtitle"
				>
					{ __(
						'Describe your idea in a sentence or two. Our agents will find related articles, external sources, and context to help you develop it.',
						'vip-workflow'
					) }
				</Text>
			</Stack>

			<div className="vip-workflow-ideation-seed__input-wrap vip-workflow-panel-surface">
				<textarea
					ref={ textareaRef }
					className="vip-workflow-ideation-seed__textarea"
					value={ seed }
					onChange={ ( e ) => setSeed( e.target.value ) }
					onKeyDown={ handleKeyDown }
					placeholder={ __(
						'e.g., Global coffee prices surge after severe frost damages Brazilian crops…',
						'vip-workflow'
					) }
					rows={ 3 }
					disabled={ isSubmitting }
				/>
				<Stack
					align="center"
					justify="space-between"
					className="vip-workflow-ideation-seed__actions"
				>
					{ /* wpds-allow R7 -- keyboard hint (body-sm, muted); no Text variant for hint */ }
					<span className="vip-workflow-ideation-seed__hint">
						{ __( 'Press Enter to submit', 'vip-workflow' ) }
					</span>
					<Button
						variant="primary"
						onClick={ handleSubmit }
						disabled={ ! seed.trim() || isSubmitting }
						icon={ isSubmitting ? undefined : arrowRight }
						className="vip-workflow-ideation-seed__submit"
					>
						{ isSubmitting ? (
							<Stack direction="row" align="center" gap="sm">
								<Spinner />
								{ __( 'Starting agents…', 'vip-workflow' ) }
							</Stack>
						) : (
							__( 'Start ideation', 'vip-workflow' )
						) }
					</Button>
				</Stack>
			</div>
		</Stack>
	);
}
