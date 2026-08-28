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
 * That reload used to flash "Loading experiments…" over the toggles: the panel
 * remounted, and asked for a registry the server had just rendered into the
 * page. It now reads that seed and paints the toggles on the first frame. The
 * fetch remains for any screen that does not localize the registry.
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
 * The registry the server rendered into the page for this request.
 *
 * Present on the settings screen, absent elsewhere. Anything but an array is
 * treated as absent so a malformed payload falls back to fetching rather than
 * rendering an empty panel.
 *
 * @return {?Array} The seeded experiments, or null when the page did not seed them.
 */
function readSeededRegistry() {
	const seeded = window.vipWorkflowAdmin?.experimentsRegistry;
	return Array.isArray( seeded ) ? seeded : null;
}

/**
 * Map a registry to the draft state the toggles bind to.
 *
 * @param {?Array} registry Experiments, or null.
 * @return {Object} Draft enabled state keyed by experiment id.
 */
function draftsFrom( registry ) {
	return Object.fromEntries(
		( registry || [] ).map( ( experiment ) => [
			experiment.id,
			experiment.enabled,
		] )
	);
}

/**
 * Experiments panel.
 *
 * @param {Object}   props               Component props.
 * @param {Function} props.onDirtyChange Called with ( id, hasChanges ).
 * @param {Function} props.registerSave  Called with ( id, saveFn ).
 * @return {JSX.Element} The panel.
 */
export function ExperimentsSettings( { onDirtyChange, registerSave } ) {
	const [ seeded ] = useState( readSeededRegistry );
	const [ experiments, setExperiments ] = useState( seeded );
	const [ drafts, setDrafts ] = useState( () => draftsFrom( seeded ) );
	const [ loading, setLoading ] = useState( null === seeded );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		// The seed was rendered by the request that served this page, so it is
		// this page's truth. Re-requesting it would only reintroduce the
		// loading state the seed exists to avoid.
		if ( null !== seeded ) {
			return;
		}

		apiFetch( { path: '/vip-workflow/v1/settings/experiments' } )
			.then( ( data ) => {
				setExperiments( data );
				setDrafts( draftsFrom( data ) );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setLoading( false );
			} );
	}, [ seeded ] );

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
				path: '/vip-workflow/v1/settings/experiments',
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
				label={ __( 'Loading experiments…', 'vip-workflow' ) }
			/>
		);
	}

	if ( ! experiments ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ sprintf(
					/* translators: %s: error message from the experiments request. */
					__( 'Failed to load experiments: %s', 'vip-workflow' ),
					error
				) }
			</Notice>
		);
	}

	if ( experiments.length === 0 ) {
		return (
			<Text variant="body-md" render={ <p /> }>
				{ __( 'No experiments are available.', 'vip-workflow' ) }
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
									'vip-workflow'
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
