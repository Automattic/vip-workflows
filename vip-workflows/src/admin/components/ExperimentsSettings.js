/**
 * Experiments panel.
 *
 * Turn in-development features (feature flags) on or off.
 *
 * The toggles used to write on the spot and reload the page, which made this the
 * one immediate-apply panel on a screen whose other three stage their edits. A
 * screen is one thing or the other, so these stage too: the panel reports its
 * dirty state and its save handler to the Settings page, and the page's one Save
 * commits every changed experiment and then reloads — a reload is still required,
 * because enabling or disabling an experiment registers or removes server-side
 * menus and REST routes. See docs/guides/settings-standard.md.
 *
 * @package
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { ToggleControl, Notice } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';

import { SettingsLoading } from './SettingsLoading';

/**
 * The id this panel reports its dirty state and its save handler under.
 */
const PANEL_ID = 'experiments';

/**
 * Experiments panel.
 *
 * @param {Object}   props               Component props.
 * @param {Function} props.onDirtyChange Called with ( id, hasChanges ).
 * @param {Function} props.registerSave  Called with ( id, saveFn ).
 * @return {JSX.Element} The panel.
 */
export function ExperimentsSettings( { onDirtyChange, registerSave } ) {
	const [ experiments, setExperiments ] = useState( null );
	const [ drafts, setDrafts ] = useState( {} );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		apiFetch( { path: '/vip-workflows/v1/settings/experiments' } )
			.then( ( data ) => {
				setExperiments( data );
				setDrafts(
					Object.fromEntries(
						data.map( ( experiment ) => [
							experiment.id,
							experiment.enabled,
						] )
					)
				);
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setLoading( false );
			} );
	}, [] );

	const hasChanges = ( experiments || [] ).some(
		( experiment ) => drafts[ experiment.id ] !== experiment.enabled
	);

	useEffect( () => {
		onDirtyChange( PANEL_ID, hasChanges );
	}, [ hasChanges, onDirtyChange ] );

	const save = useCallback( async () => {
		// One route per experiment, so the save walks the changed ones. Each
		// response is the whole registry, and it is applied as it lands rather
		// than once at the end: a throw partway through the loop propagates to
		// the screen's Save, which reports it — but the experiments already
		// written are written, and holding their result back would leave the
		// panel offering to save them again.
		for ( const experiment of experiments ) {
			if ( drafts[ experiment.id ] === experiment.enabled ) {
				continue;
			}
			const latest = await apiFetch( {
				path: '/vip-workflows/v1/settings/experiments',
				method: 'POST',
				data: {
					id: experiment.id,
					enabled: drafts[ experiment.id ],
				},
			} );
			setExperiments( latest );
		}
	}, [ experiments, drafts ] );

	useEffect( () => {
		registerSave( PANEL_ID, save );
	}, [ save, registerSave ] );

	if ( loading ) {
		return (
			<SettingsLoading
				label={ __( 'Loading experiments…', 'vip-workflows' ) }
			/>
		);
	}

	if ( ! experiments ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ sprintf(
					/* translators: %s: error message from the experiments request. */
					__( 'Failed to load experiments: %s', 'vip-workflows' ),
					error
				) }
			</Notice>
		);
	}

	if ( experiments.length === 0 ) {
		return (
			<Text variant="body-md" render={ <p /> }>
				{ __( 'No experiments are available.', 'vip-workflows' ) }
			</Text>
		);
	}

	return (
		<Stack direction="column" gap="lg">
			{ experiments.map( ( experiment ) => (
				<ToggleControl
					key={ experiment.id }
					__nextHasNoMarginBottom
					label={ experiment.name }
					help={
						experiment.available
							? experiment.description
							: __(
									'Unavailable in this environment.',
									'vip-workflows'
							  )
					}
					checked={ drafts[ experiment.id ] }
					disabled={ ! experiment.available }
					onChange={ ( val ) =>
						setDrafts( ( prev ) => ( {
							...prev,
							[ experiment.id ]: val,
						} ) )
					}
				/>
			) ) }
		</Stack>
	);
}
