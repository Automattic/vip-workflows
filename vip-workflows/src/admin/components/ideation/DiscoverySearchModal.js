/**
 * Discovery Search Modal.
 *
 * Full-screen-ish modal for searching a discovery provider with
 * dynamic filters. Filter controls are rendered from the provider's
 * filter definitions, so the modal is provider-agnostic.
 */

import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	TextControl,
	Button,
	Spinner,
	SelectControl,
} from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';

import { ModalActions } from '../../../common/ModalActions';
import { formatPartialDate } from '../../../common/datetime';

import './DiscoverySearchModal.css';

/**
 * @param {Object}      props            Component props.
 * @param {string}      props.provider   Provider slug to search.
 * @param {Function}    props.onSelect   Called with (provider, prompt) when a result is selected.
 * @param {Function}    props.onClose    Close the modal.
 * @param {string|null} props.submitting Currently submitting prompt key, if any.
 * @return {JSX.Element} Search modal.
 */
export default function DiscoverySearchModal( {
	provider,
	onSelect,
	onClose,
	submitting,
} ) {
	const [ providerMeta, setProviderMeta ] = useState( null );
	const [ filterDefs, setFilterDefs ] = useState( [] );
	const [ filterValues, setFilterValues ] = useState( {} );
	const [ searchText, setSearchText ] = useState( '' );
	const [ results, setResults ] = useState( null );
	const [ searching, setSearching ] = useState( false );
	const [ loadingFilters, setLoadingFilters ] = useState( true );
	const debounceRef = useRef( null );

	useEffect( () => {
		const loadProviderData = async () => {
			try {
				const [ providers, filters ] = await Promise.all( [
					apiFetch( {
						path: '/vip-workflow/v1/discovery/providers',
					} ),
					apiFetch( {
						path: `/vip-workflow/v1/discovery/filters?provider=${ provider }`,
					} ),
				] );

				const meta = providers.find( ( p ) => p.slug === provider );
				setProviderMeta( meta || { slug: provider, label: provider } );
				setFilterDefs( filters || [] );

				const defaults = {};
				( filters || [] ).forEach( ( f ) => {
					if ( f.default !== undefined ) {
						defaults[ f.key ] = f.default;
					}
				} );
				setFilterValues( defaults );
			} catch {
				setFilterDefs( [] );
			} finally {
				setLoadingFilters( false );
			}
		};

		loadProviderData();
	}, [ provider ] );

	const doSearch = useCallback(
		async ( text, filters ) => {
			setSearching( true );
			try {
				const filtersParam =
					Object.keys( filters ).length > 0
						? JSON.stringify( filters )
						: '';

				const params = new URLSearchParams();
				params.set( 'provider', provider );
				if ( text ) {
					params.set( 'text', text );
				}
				if ( filtersParam ) {
					params.set( 'filters', filtersParam );
				}

				const data = await apiFetch( {
					path: `/vip-workflow/v1/discovery/search?${ params.toString() }`,
				} );
				setResults( data );
			} catch {
				setResults( [] );
			} finally {
				setSearching( false );
			}
		},
		[ provider ]
	);

	const handleSearch = useCallback( () => {
		doSearch( searchText, filterValues );
	}, [ doSearch, searchText, filterValues ] );

	const handleTextChange = useCallback(
		( value ) => {
			setSearchText( value );

			if ( debounceRef.current ) {
				clearTimeout( debounceRef.current );
			}
			debounceRef.current = setTimeout( () => {
				if ( value.trim().length >= 3 ) {
					doSearch( value, filterValues );
				}
			}, 600 );
		},
		[ doSearch, filterValues ]
	);

	const handleFilterChange = useCallback( ( key, value ) => {
		setFilterValues( ( prev ) => ( { ...prev, [ key ]: value } ) );
	}, [] );

	const handleKeyDown = useCallback(
		( event ) => {
			if ( event.key === 'Enter' ) {
				event.preventDefault();
				handleSearch();
			}
		},
		[ handleSearch ]
	);

	return (
		<Modal
			title={
				providerMeta?.label
					? `${ __( 'Search', 'vip-workflow' ) } ${
							providerMeta.label
					  }`
					: __( 'Search stories', 'vip-workflow' )
			}
			onRequestClose={ onClose }
			className="vip-workflow-ideation-discovery-modal"
			size="large"
		>
			<Stack
				direction="column"
				gap="xl"
				className="vip-workflow-ideation-discovery-modal__body"
			>
				<Stack
					direction="column"
					gap="md"
					className="vip-workflow-ideation-discovery-modal__controls"
				>
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						placeholder={ __(
							'Search for topics, events, keywords…',
							'vip-workflow'
						) }
						value={ searchText }
						onChange={ handleTextChange }
						onKeyDown={ handleKeyDown }
						className="vip-workflow-ideation-discovery-modal__search-input"
					/>

					{ loadingFilters ? (
						<Stack
							justify="center"
							className="vip-workflow-ideation-discovery-modal__filters-loading"
						>
							<Spinner />
						</Stack>
					) : (
						filterDefs.length > 0 && (
							<Stack
								wrap="wrap"
								gap="md"
								className="vip-workflow-ideation-discovery-modal__filters"
							>
								{ filterDefs.map( ( filter ) => (
									<FilterControl
										key={ filter.key }
										filter={ filter }
										value={ filterValues[ filter.key ] }
										onChange={ ( val ) =>
											handleFilterChange(
												filter.key,
												val
											)
										}
									/>
								) ) }
							</Stack>
						)
					) }

					<ModalActions>
						<Button
							variant="primary"
							onClick={ handleSearch }
							isBusy={ searching }
							disabled={ searching }
						>
							{ __( 'Search', 'vip-workflow' ) }
						</Button>
					</ModalActions>
				</Stack>

				<div className="vip-workflow-ideation-discovery-modal__results">
					{ searching && (
						<Stack
							justify="center"
							className="vip-workflow-ideation-discovery-modal__results-loading"
						>
							<Spinner />
						</Stack>
					) }

					{ ! searching &&
						results !== null &&
						results.length === 0 && (
							<Text
								variant="body-md"
								render={ <p /> }
								className="vip-workflow-ideation-discovery-modal__no-results"
							>
								{ __(
									'No results found. Try different search terms or filters.',
									'vip-workflow'
								) }
							</Text>
						) }

					{ ! searching && results !== null && results.length > 0 && (
						// wpds-allow R7 -- responsive 2D auto-fill grid; Stack is 1D flex only
						<div className="vip-workflow-ideation-discovery-modal__results-grid">
							{ results.map( ( prompt ) => {
								const promptKey = `${ provider }-${ prompt.id }`;
								const isSubmitting = submitting === promptKey;

								return (
									<Button
										key={ prompt.id }
										className="vip-workflow-ideation-discovery__card"
										onClick={ () =>
											onSelect( providerMeta, prompt )
										}
										disabled={ !! submitting }
										data-prompt-id={ prompt.id }
									>
										{ isSubmitting && (
											// wpds-allow R7 -- absolute spinner overlay/scrim; styled in StoryDiscovery.css
											<div className="vip-workflow-ideation-discovery__card-loading">
												<Spinner />
											</div>
										) }
										{ /* wpds-allow R7 -- line-clamped title (webkit-box); no Text prop expresses clamp */ }
										<span className="vip-workflow-ideation-discovery__card-title">
											{ prompt.title }
										</span>
										{ prompt.description && (
											// wpds-allow R7 -- line-clamped description; no Text prop for clamp
											<span className="vip-workflow-ideation-discovery__card-description">
												{ prompt.description }
											</span>
										) }
										{ prompt.date && (
											// wpds-allow R7 -- inline meta label (body-sm); styled in StoryDiscovery.css
											<span className="vip-workflow-ideation-discovery__card-date">
												{ formatPartialDate(
													prompt.date,
													prompt.meta?.start_has_time
												) }
											</span>
										) }
										{ prompt.tags?.length > 0 && (
											// wpds-allow R7 -- inline tag list (body-sm); styled in StoryDiscovery.css
											<span className="vip-workflow-ideation-discovery__card-tags">
												{ prompt.tags
													.slice( 0, 3 )
													.join( ', ' ) }
											</span>
										) }
									</Button>
								);
							} ) }
						</div>
					) }
				</div>
			</Stack>
		</Modal>
	);
}

/**
 * Render a single filter control based on the filter definition.
 *
 * @param {Object}   props          Component props.
 * @param {Object}   props.filter   Filter definition from the provider.
 * @param {*}        props.value    Current filter value.
 * @param {Function} props.onChange Value change handler.
 * @return {JSX.Element} Filter control.
 */
function FilterControl( { filter, value, onChange } ) {
	if ( filter.type === 'select' && Array.isArray( filter.options ) ) {
		return (
			<SelectControl
				__next40pxDefaultSize
				label={ filter.label }
				value={ value ?? '' }
				options={ filter.options.map( ( opt ) => ( {
					label: opt.label,
					value: opt.value,
				} ) ) }
				onChange={ onChange }
				className="vip-workflow-ideation-discovery-modal__filter"
			/>
		);
	}

	if ( filter.type === 'multi_select' && Array.isArray( filter.options ) ) {
		return (
			<SelectControl
				__next40pxDefaultSize
				label={ filter.label }
				value={ value ?? [] }
				multiple
				options={ filter.options.map( ( opt ) => ( {
					label: opt.label,
					value: String( opt.value ),
				} ) ) }
				onChange={ onChange }
				className="vip-workflow-ideation-discovery-modal__filter"
			/>
		);
	}

	if ( filter.type === 'date_range' ) {
		return (
			<Stack
				direction="column"
				gap="xs"
				className="vip-workflow-ideation-discovery-modal__filter"
			>
				<Text
					variant="heading-sm"
					render={ <span /> }
					className="vip-workflow-eyebrow"
				>
					{ filter.label }
				</Text>
				<Stack
					direction="row"
					justify="space-between"
					align="center"
					gap="sm"
				>
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						type="date"
						value={ value?.from ?? '' }
						onChange={ ( from ) =>
							onChange( { ...( value || {} ), from } )
						}
						className="vip-workflow-ideation-discovery-modal__date-input"
					/>
					<span>{ __( 'to', 'vip-workflow' ) }</span>
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						type="date"
						value={ value?.to ?? '' }
						onChange={ ( to ) =>
							onChange( { ...( value || {} ), to } )
						}
						className="vip-workflow-ideation-discovery-modal__date-input"
					/>
				</Stack>
			</Stack>
		);
	}

	return null;
}
