/**
 * AI provider + model settings panel.
 *
 * Which connected provider, and which of its models, the plugin's AI features
 * use — media analysis, ideation, research and the agents. API keys themselves
 * live in WordPress Settings → Connectors; this only picks among the providers a
 * key has already been configured for. Persisted via the general-settings REST
 * endpoint.
 *
 * The panel stages its edits and reports its dirty state and its save handler to
 * the Settings page, which owns the screen's one Save. See
 * docs/guides/settings-standard.md.
 *
 * @package
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { SelectControl, Notice } from '@wordpress/components';
import { Link } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';

import { SettingsSection } from './SettingsSection';
import { SettingsLoading } from './SettingsLoading';

/**
 * The id this panel reports its dirty state and its save handler under.
 */
const PANEL_ID = 'ai-services';

/**
 * Human-readable labels for the supported generation providers.
 */
const PROVIDER_LABELS = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	google: 'Google',
};

/**
 * Build select options that always contain the value the control is given.
 *
 * A `SelectControl` handed a value absent from its options renders the first
 * option instead. The field then names one thing while state holds another,
 * choosing what is already displayed fires no change event, and the form
 * silently posts — or discards — something the administrator never picked. That
 * is the defect this whole panel was repaired for, and it applies to any select
 * whose value can outlive its option list: a provider that has since been
 * disconnected, a model that is no longer in its provider's catalog, or nothing
 * chosen at all.
 *
 * The stray value is offered back as a disabled option so the control can render
 * it truthfully, while remaining unchoosable.
 *
 * @param {string[]} values      Selectable values.
 * @param {string}   held        The value the control will be given.
 * @param {Function} labelFor    Display label for a selectable value.
 * @param {string}   placeholder Label used when nothing is held.
 * @param {string}   strayFormat sprintf format for a held value not in `values`.
 * @return {Array} Options for the control.
 */
const optionsIncluding = (
	values,
	held,
	labelFor,
	placeholder,
	strayFormat
) => {
	const options = values.map( ( value ) => ( {
		label: labelFor( value ),
		value,
	} ) );

	if ( ! values.includes( held ) ) {
		options.unshift( {
			label:
				held === ''
					? placeholder
					: sprintf( strayFormat, labelFor( held ) ),
			value: held,
			disabled: true,
		} );
	}

	return options;
};

/**
 * AI provider + model settings panel.
 *
 * @param {Object}   props               Component props.
 * @param {Function} props.onDirtyChange Called with ( id, hasChanges ).
 * @param {Function} props.registerSave  Called with ( id, saveFn ).
 * @return {JSX.Element} The panel.
 */
export function AiModelSettings( { onDirtyChange, registerSave } ) {
	const [ provider, setProvider ] = useState( '' );
	const [ providerSelected, setProviderSelected ] = useState( false );
	const [ providers, setProviders ] = useState( [] );
	const [ model, setModel ] = useState( '' );
	const [ modelsByProvider, setModelsByProvider ] = useState( {} );
	const [ original, setOriginal ] = useState( { provider: '', model: '' } );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		apiFetch( { path: '/vip-workflow/v1/settings/general' } )
			.then( ( data ) => {
				const p = data.ai_provider || '';
				const m = data.ai_model || '';
				const models = data.ai_models || {};
				setProvider( p );
				setProviderSelected( !! data.ai_provider_selected );
				setProviders( data.ai_providers || [] );
				// Seed an unchosen model from the provider's catalog, the same
				// way switching provider does. A derived provider arrives with no
				// model, and the endpoint rejects an empty one — so without this
				// the obvious single Save stores the provider, silently drops the
				// model, and leaves the site one state further along: connected,
				// with no model chosen.
				setModel( m === '' ? ( models[ p ] || [] )[ 0 ] || '' : m );
				setModelsByProvider( models );
				// The server's answer, not the seeded one, so a seeded model reads
				// as the pending change it is.
				setOriginal( { provider: p, model: m } );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setLoading( false );
			} );
	}, [] );

	const modelOptions = modelsByProvider[ provider ] || [];

	// A stored provider that is no longer among the connected ones. Reachable by
	// rotating or removing a key in Settings → Connectors after choosing it, and
	// it strands the site exactly as an unresolved selection does: every AI
	// surface keeps reporting the old vendor's missing credential.
	const disconnected = provider !== '' && ! providers.includes( provider );

	// A provider derived from the site's only credential is in use but unsaved, so
	// it counts as pending: without this the administrator sees the right provider
	// named, nothing to change, and a disabled Save — and the selection stays
	// unwritten until a second credential turns it ambiguous.
	const unpinned = provider !== '' && ! providerSelected && ! disconnected;

	// No separate "is this complete" guard. A held model is only ever '' when the
	// provider's catalog is empty — which the endpoint accepts on its own — or
	// when the server just returned '', which sets `original` to '' in the same
	// breath and so reads as clean. The selects cannot produce the state either:
	// '' is offered back only as a disabled option. A guard for it would be
	// unreachable, and an unreachable guard is a claim no test can keep honest.
	const hasChanges =
		unpinned || provider !== original.provider || model !== original.model;

	useEffect( () => {
		onDirtyChange( PANEL_ID, hasChanges );
	}, [ hasChanges, onDirtyChange ] );

	const save = useCallback( async () => {
		const data = await apiFetch( {
			path: '/vip-workflow/v1/settings/general',
			method: 'POST',
			data: { ai_provider: provider, ai_model: model },
		} );
		const p = data.ai_provider || '';
		const m = data.ai_model || '';
		setProvider( p );
		setProviderSelected( !! data.ai_provider_selected );
		// Whatever the endpoint accepted, not what was sent — a rejected model
		// must not keep reading as saved.
		setModel( m );
		setModelsByProvider( data.ai_models || {} );
		setProviders( data.ai_providers || [] );
		setOriginal( { provider: p, model: m } );
	}, [ provider, model ] );

	useEffect( () => {
		registerSave( PANEL_ID, save );
	}, [ save, registerSave ] );

	const providerLabel = ( p ) => PROVIDER_LABELS[ p ] || p;

	const providerOptions = optionsIncluding(
		providers,
		provider,
		providerLabel,
		__( '— Select a provider —', 'vip-workflow' ),
		/* translators: %s: AI provider display name, e.g. "OpenAI". */
		__( '%s (not connected)', 'vip-workflow' )
	);

	const modelSelectOptions = optionsIncluding(
		modelOptions,
		model,
		( m ) => m,
		__( '— Select a model —', 'vip-workflow' ),
		/* translators: %s: AI model identifier, e.g. "gpt-4o". */
		__( '%s (not available)', 'vip-workflow' )
	);

	const onProviderChange = ( value ) => {
		setProvider( value );
		// Reset the model to the new provider's first available option so the
		// selection is always valid for the chosen provider.
		const next = modelsByProvider[ value ] || [];
		setModel( next.length ? next[ 0 ] : '' );
	};

	if ( loading ) {
		return (
			<SettingsLoading
				label={ __( 'Loading AI settings…', 'vip-workflow' ) }
			/>
		);
	}

	if ( error ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ sprintf(
					/* translators: %s: error message from the settings request. */
					__( 'Failed to load AI settings: %s', 'vip-workflow' ),
					error
				) }
			</Notice>
		);
	}

	/*
	 * An empty catalog means model discovery could not reach the provider, and
	 * what happens next depends on the vendor — so the help text must not claim
	 * one answer for both. OpenAI has a legacy default model to fall back on;
	 * every other provider resolves to no model at all, because
	 * `Credentials::model()` returns '' for them, and generation does not run.
	 * Promising "the default will be used" there named a default that does not
	 * exist, on the one screen an administrator would consult to find out.
	 */
	const modelHelp = ( () => {
		if ( modelOptions.length > 0 ) {
			return undefined;
		}

		return provider === 'openai'
			? __(
					'No models were discovered for this provider; the default will be used.',
					'vip-workflow'
			  )
			: __(
					'No models could be discovered for this provider, so AI features cannot generate through it. Check its connection in Settings → Connectors, or choose a provider whose models are reachable.',
					'vip-workflow'
			  );
	} )();

	return (
		<SettingsSection
			title={ __( 'AI model', 'vip-workflow' ) }
			description={ __(
				'The provider and model the plugin uses for AI features such as media analysis, ideation and research.',
				'vip-workflow'
			) }
		>
			{ providers.length === 0 ? (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'No AI provider is connected. Add an API key in Settings → Connectors to enable AI features.',
						'vip-workflow'
					) }
				</Notice>
			) : (
				<>
					{ unpinned && (
						<Notice status="info" isDismissible={ false }>
							{ __(
								'No provider has been chosen, so the only connected one is being used. Save to make that explicit — otherwise connecting a second provider will leave this site with no selection.',
								'vip-workflow'
							) }
						</Notice>
					) }
					{ provider === '' && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'More than one provider is connected and none is chosen. Choose the one AI features should generate through.',
								'vip-workflow'
							) }
						</Notice>
					) }
					{ disconnected && (
						<Notice status="warning" isDismissible={ false }>
							{ sprintf(
								/* translators: %s: AI provider display name, e.g. "OpenAI". */
								__(
									'%s is selected but no longer connected, so AI features cannot generate. Choose one of the connected providers.',
									'vip-workflow'
								),
								providerLabel( provider )
							) }
						</Notice>
					) }
					<SelectControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Provider', 'vip-workflow' ) }
						value={ provider }
						options={ providerOptions }
						onChange={ onProviderChange }
						help={
							<>
								{ __(
									'Only providers with a configured API key appear here.',
									'vip-workflow'
								) }{ ' ' }
								<Link
									href="/wp-admin/options-connectors.php"
									openInNewTab
								>
									{ __(
										'Manage API keys in Settings → Connectors',
										'vip-workflow'
									) }
								</Link>
							</>
						}
					/>
					<SelectControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Model', 'vip-workflow' ) }
						value={ model }
						options={ modelSelectOptions }
						onChange={ ( value ) => setModel( value ) }
						help={ modelHelp }
					/>
				</>
			) }
		</SettingsSection>
	);
}
