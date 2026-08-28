/**
 * Prompts panel.
 *
 * Lists the registered AI system prompts, grouped, and lets an admin override
 * each one. An empty override resets the prompt to its registered default.
 *
 * Each group is a `SettingsSection` — a heading over its fields, with the gap
 * between them as the only separator; the rules that used to sit between fields
 * inside a card are gone, along with the card. The panel stages its edits and
 * reports its dirty state and its save handler to the Settings page, which owns
 * the screen's one Save. See docs/guides/settings-standard.md.
 *
 * @package
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { Button, TextareaControl, Notice } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';

import { SettingsSection } from './SettingsSection';
import { SettingsLoading } from './SettingsLoading';

/**
 * The id this panel reports its dirty state and its save handler under.
 */
const PANEL_ID = 'prompts';

/**
 * Group an array of prompts by their `group` field.
 *
 * @param {Array} prompts Prompt definitions.
 * @return {Object} Map of group name => prompts.
 */
function groupByGroup( prompts ) {
	return prompts.reduce( ( acc, prompt ) => {
		const key = prompt.group || __( 'General', 'vip-workflows' );
		( acc[ key ] = acc[ key ] || [] ).push( prompt );
		return acc;
	}, {} );
}

/**
 * Prompts panel.
 *
 * @param {Object}   props               Component props.
 * @param {Function} props.onDirtyChange Called with ( id, hasChanges ).
 * @param {Function} props.registerSave  Called with ( id, saveFn ).
 * @return {JSX.Element} The panel.
 */
export function PromptsSettings( { onDirtyChange, registerSave } ) {
	const [ prompts, setPrompts ] = useState( null );
	const [ drafts, setDrafts ] = useState( {} );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		apiFetch( { path: '/vip-workflows/v1/prompts' } )
			.then( ( data ) => {
				setPrompts( data );
				setDrafts(
					Object.fromEntries(
						data.map( ( prompt ) => [
							prompt.id,
							prompt.override || '',
						] )
					)
				);
			} )
			.catch( ( err ) => setError( err.message ) );
	}, [] );

	const hasChanges = ( prompts || [] ).some(
		( prompt ) => drafts[ prompt.id ] !== ( prompt.override || '' )
	);

	useEffect( () => {
		onDirtyChange( PANEL_ID, hasChanges );
	}, [ hasChanges, onDirtyChange ] );

	const save = useCallback( async () => {
		// One route per prompt, so the save walks the edited ones and applies
		// each response as it lands.
		for ( const prompt of prompts ) {
			if ( drafts[ prompt.id ] === ( prompt.override || '' ) ) {
				continue;
			}
			const updated = await apiFetch( {
				path: `/vip-workflows/v1/prompts/${ prompt.id }`,
				method: 'POST',
				data: { prompt: drafts[ prompt.id ] },
			} );
			setPrompts( ( prev ) =>
				prev.map( ( p ) => ( p.id === updated.id ? updated : p ) )
			);
			setDrafts( ( prev ) => ( {
				...prev,
				[ updated.id ]: updated.override || '',
			} ) );
		}
	}, [ prompts, drafts ] );

	useEffect( () => {
		registerSave( PANEL_ID, save );
	}, [ save, registerSave ] );

	const setDraft = ( id, value ) => {
		setDrafts( ( prev ) => ( { ...prev, [ id ]: value } ) );
	};

	if ( error ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ sprintf(
					/* translators: %s: error message from the prompts request. */
					__( 'Failed to load prompts: %s', 'vip-workflows' ),
					error
				) }
			</Notice>
		);
	}

	if ( null === prompts ) {
		return (
			<SettingsLoading
				label={ __( 'Loading prompts…', 'vip-workflows' ) }
			/>
		);
	}

	if ( prompts.length === 0 ) {
		return (
			<Text variant="body-md" render={ <p /> }>
				{ __(
					'No configurable prompts are registered.',
					'vip-workflows'
				) }
			</Text>
		);
	}

	const groups = groupByGroup( prompts );

	return (
		<Stack direction="column" gap="2xl">
			{ Object.keys( groups ).map( ( group ) => (
				<SettingsSection key={ group } title={ group }>
					{ groups[ group ].map( ( prompt ) => (
						<Stack
							key={ prompt.id }
							data-prompt-id={ prompt.id }
							direction="column"
							gap="md"
						>
							<TextareaControl
								__nextHasNoMarginBottom
								label={ prompt.label }
								help={
									prompt.description ||
									__(
										'Leave empty to use the default.',
										'vip-workflows'
									)
								}
								value={ drafts[ prompt.id ] }
								placeholder={ prompt.default }
								rows={ 6 }
								onChange={ ( value ) =>
									setDraft( prompt.id, value )
								}
							/>
							{ /* A field-scoped utility, so it sits under its own
							     field and stays left-aligned with it rather than
							     joining the screen's action row. */ }
							{ !! prompt.override && (
								<Stack direction="row" justify="flex-start">
									<Button
										variant="tertiary"
										onClick={ () =>
											setDraft( prompt.id, '' )
										}
									>
										{ __(
											'Reset to default',
											'vip-workflows'
										) }
									</Button>
								</Stack>
							) }
						</Stack>
					) ) }
				</SettingsSection>
			) ) }
		</Stack>
	);
}
