/**
 * Story Discovery Component.
 *
 * Displays recommended story prompts from registered discovery providers
 * on the ideation landing page. Each provider renders as its own section
 * with prompts revealed in batches of 6.
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Button } from '@wordpress/components';
import { Badge, Stack, Text } from '@wordpress/ui';

import DiscoverySearchModal from './DiscoverySearchModal';
import PromptPreviewModal from './PromptPreviewModal';
import { formatPartialDate, isSameDay } from '../../../common/datetime';

import './StoryDiscovery.css';

/**
 * @param {Object}   props            Component props.
 * @param {Function} props.onSelect   Called when a prompt is selected (receives project state).
 * @param {Function} props.onNavigate Navigation callback for workspace routing.
 * @return {JSX.Element|null} Discovery sections or null while loading/empty.
 */
export default function StoryDiscovery( { onSelect, onNavigate } ) {
	const [ groups, setGroups ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ submitting, setSubmitting ] = useState( null );
	const [ modalOpen, setModalOpen ] = useState( false );
	const [ modalProvider, setModalProvider ] = useState( null );
	const [ visibleCounts, setVisibleCounts ] = useState( {} );
	const [ previewPrompt, setPreviewPrompt ] = useState( null );
	const [ previewProvider, setPreviewProvider ] = useState( null );

	useEffect( () => {
		const fetchRecommendations = async () => {
			try {
				const data = await apiFetch( {
					path: '/vip-workflows/v1/discovery/recommend',
				} );
				setGroups( data );
			} catch {
				// Silently fail; section stays hidden.
			} finally {
				setLoading( false );
			}
		};

		fetchRecommendations();
	}, [] );

	const handlePromptSelect = useCallback(
		async ( provider, prompt ) => {
			const promptKey = `${ provider.slug }-${ prompt.id }`;
			setSubmitting( promptKey );

			try {
				const state = await apiFetch( {
					path: '/vip-workflows/v1/discovery/select',
					method: 'POST',
					data: {
						provider: provider.slug,
						prompt,
					},
				} );

				onSelect( state );
				onNavigate( 'workspace', { project: state.project_id } );
			} catch {
				// Selection failed; allow retry.
			} finally {
				setSubmitting( null );
			}
		},
		[ onSelect, onNavigate ]
	);

	const handleBrowseMore = useCallback( ( providerSlug ) => {
		setModalProvider( providerSlug );
		setModalOpen( true );
	}, [] );

	const PROMPTS_PER_PAGE = 6;

	const handleShowMore = useCallback( ( slug ) => {
		setVisibleCounts( ( prev ) => ( {
			...prev,
			[ slug ]: ( prev[ slug ] || PROMPTS_PER_PAGE ) + PROMPTS_PER_PAGE,
		} ) );
	}, [] );

	if ( loading ) {
		return (
			<Stack
				direction="column"
				gap="2xl"
				className="vip-workflows-ideation-discovery vip-workflows-ideation-discovery--loading"
			>
				<div className="vip-workflows-ideation-discovery__skeleton" />
			</Stack>
		);
	}

	if ( groups.length === 0 ) {
		return null;
	}

	return (
		<>
			<Stack
				direction="column"
				gap="2xl"
				className="vip-workflows-ideation-discovery"
			>
				{ groups.map( ( group ) => (
					<Stack
						/*
						 * A provider may return more than one section — the stream
						 * splits itself by tier — and each keeps the real slug so
						 * selecting a prompt still resolves. `key` only tells them
						 * apart.
						 */
						key={ group.provider.key ?? group.provider.slug }
						direction="column"
						gap="md"
						className="vip-workflows-ideation-discovery__group"
					>
						<Stack align="center" justify="space-between">
							<Text
								variant="heading-sm"
								render={ <h3 /> }
								className="vip-workflows-ideation-discovery__group-title vip-workflows-eyebrow"
							>
								{ group.provider.label }
							</Text>
							{ /*
							 * Only for a provider that can answer a query. A
							 * provider may declare `recommend` alone — Parse.ly
							 * ranks your archive and cannot search it — and
							 * offering the modal anyway reaches a route that
							 * fails with the missing callback's name in it.
							 * Absent features are read as "cannot search": a
							 * missing button beats a button that errors.
							 */ }
							{ group.provider.features?.includes( 'search' ) && (
								<Button
									variant="link"
									className="vip-workflows-ideation-discovery__browse-more"
									onClick={ () =>
										handleBrowseMore( group.provider.slug )
									}
								>
									{ __( 'Browse more…', 'vip-workflows' ) }
								</Button>
							) }
						</Stack>
						{ ( () => {
							const slug = group.provider.slug;
							const limit =
								visibleCounts[ slug ] || PROMPTS_PER_PAGE;
							const visible = group.prompts.slice( 0, limit );
							const hasMore = group.prompts.length > limit;

							return (
								<>
									{ /* wpds-allow R7 -- responsive CSS grid (auto-fill minmax columns); Stack is flex-only */ }
									<div className="vip-workflows-ideation-discovery__grid">
										{ visible.map( ( prompt ) => {
											return (
												<Button
													key={ prompt.id }
													className="vip-workflows-ideation-discovery__card vip-workflows-card-surface"
													onClick={ () => {
														setPreviewPrompt(
															prompt
														);
														setPreviewProvider(
															group.provider
														);
													} }
													data-prompt-id={ prompt.id }
												>
													<Stack
														align="flex-start"
														justify="space-between"
														gap="sm"
														className="vip-workflows-ideation-discovery__card-header"
													>
														{ /* wpds-allow R7 -- clamped card title (line-clamp truncation + heading font) */ }
														<span className="vip-workflows-ideation-discovery__card-title">
															{ prompt.title }
														</span>
														{ prompt.importance &&
															prompt.importance !==
																'normal' && (
																<Badge
																	intent={
																		prompt.importance ===
																		'key_event'
																			? 'medium'
																			: 'high'
																	}
																>
																	{ prompt.importance ===
																	'key_event'
																		? __(
																				'Key Event',
																				'vip-workflows'
																		  )
																		: __(
																				'Top Story',
																				'vip-workflows'
																		  ) }
																</Badge>
															) }
													</Stack>
													{ prompt.date && (
														// wpds-allow R7 -- muted date label (body-sm token + fg-weak color; no Text color prop)
														<span className="vip-workflows-ideation-discovery__card-date">
															{ formatPromptDate(
																prompt
															) }
														</span>
													) }
													{ prompt.tags?.length >
														0 && (
														// wpds-allow R7 -- muted tags label (body-sm token + fg-weak color; no Text color prop)
														<span className="vip-workflows-ideation-discovery__card-tags">
															{ prompt.tags
																.slice( 0, 3 )
																.join( ', ' ) }
														</span>
													) }
												</Button>
											);
										} ) }
									</div>
									{ hasMore && (
										<div className="vip-workflows-ideation-discovery__show-more-wrap">
											<Button
												variant="link"
												className="vip-workflows-ideation-discovery__show-more"
												onClick={ () =>
													handleShowMore( slug )
												}
											>
												{ __(
													'Show more',
													'vip-workflows'
												) }
											</Button>
										</div>
									) }
								</>
							);
						} )() }
					</Stack>
				) ) }
			</Stack>

			{ modalOpen && (
				<DiscoverySearchModal
					provider={ modalProvider }
					onSelect={ handlePromptSelect }
					onClose={ () => setModalOpen( false ) }
					submitting={ submitting }
				/>
			) }

			{ previewPrompt && (
				<PromptPreviewModal
					prompt={ previewPrompt }
					provider={ previewProvider }
					onSelect={ () => {
						const p = previewPrompt;
						const prov = previewProvider;
						setPreviewPrompt( null );
						setPreviewProvider( null );
						handlePromptSelect( prov, p );
					} }
					onClose={ () => {
						setPreviewPrompt( null );
						setPreviewProvider( null );
					} }
					submitting={ !! submitting }
				/>
			) }
		</>
	);
}

/**
 * Format a prompt date range for display.
 *
 * A range that starts and ends on one day is that day, not a span of it, so the
 * two ends collapse to one string. Both ends go through `formatPartialDate`,
 * because a provider announcing an event *for a day* sends midnight UTC with the
 * time flagged as meaningless — read as an instant, that lands on the previous
 * day for every newsroom west of Greenwich.
 *
 * The same-day test needs no such care: whatever `isSameDay` does to one end it
 * does to the other, so a shift cannot make two days look like one.
 *
 * @param {Object} prompt The discovery prompt.
 * @return {string} Formatted date string.
 */
function formatPromptDate( prompt ) {
	const { date: start, date_end: end, meta = {} } = prompt;
	const startStr = formatPartialDate( start, meta.start_has_time );

	if ( ! end || isSameDay( start, end ) ) {
		return startStr;
	}

	return `${ startStr } – ${ formatPartialDate( end, meta.end_has_time ) }`;
}
