/**
 * Mood Board Component.
 *
 * Groups cards by type (Analysis, Archive, Web, Images) with
 * section headers and compact card layouts.
 */

import { useState, useMemo, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Modal, TextControl, Spinner } from '@wordpress/components';
import { plus } from '@wordpress/icons';
import { Badge, Collapsible, Stack, Text } from '@wordpress/ui';

import IdeationCard from './IdeationCard';
import AddSourceModal from './AddSourceModal';
import { buildSimilarQuery, parseAiAnalysis } from './cards/shared';
import { renderAssistantIcon } from './assistant-icon';
import { ModalActions } from '../../../common/ModalActions';

import './MoodBoard.css';

// Lightning-bolt "generate" glyph, passed through Button's `icon` prop rather
// than composed into its children — hidden while generating, when the spinner
// takes its place.
const GENERATE_ICON = (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
	>
		<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
	</svg>
);

/**
 * Group cards that share a group_id into arrays.
 * Ungrouped cards are wrapped as single-element arrays for uniform handling.
 *
 * @param {Array} cards Section cards.
 * @return {Array} Array of { key, cards } objects.
 */
function groupCards( cards ) {
	const groups = [];
	const groupMap = {};

	for ( const card of cards ) {
		const gid = card.group_id;
		if ( gid ) {
			if ( ! groupMap[ gid ] ) {
				groupMap[ gid ] = { key: gid, cards: [] };
				groups.push( groupMap[ gid ] );
			}
			groupMap[ gid ].cards.push( card );
		} else {
			groups.push( { key: getCardKey( card ), cards: [ card ] } );
		}
	}

	return groups;
}

function getCardKey( card ) {
	return (
		card.source_id ||
		card.card_id ||
		`${ card.type }-${ card.entity_group || '' }`
	);
}

function resolveSection( card ) {
	const type = card.type || '';

	if ( [ 'news-angle', 'tag-cloud', 'entity' ].includes( type ) ) {
		return 'analysis';
	}

	if ( card.source_type === 'document' || card.source_type === 'audio' ) {
		return 'uploads';
	}

	if ( card.origin === 'upload' || card.origin === 'manual_url' ) {
		return 'uploads';
	}

	if ( card.ability_id ) {
		return card.ability_id;
	}

	if (
		type === 'image' ||
		type === 'media' ||
		card.source_type === 'image' ||
		card.source_type === 'video'
	) {
		return 'vip-workflows/media-scout';
	}

	if ( card.origin === 'archive' || type === 'archive-article' ) {
		return 'vip-workflows/archive-scout';
	}

	return 'vip-workflows/web-researcher';
}

const FIXED_SECTIONS = {
	analysis: {
		label: __( 'Analysis', 'vip-workflows' ),
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<circle cx="11" cy="11" r="8" />
				<path d="M21 21l-4.35-4.35" />
				<path d="M11 8v6M8 11h6" />
			</svg>
		),
		emptyText: __( 'Seed analysis in progress…', 'vip-workflows' ),
	},
	uploads: {
		label: __( 'Added by You', 'vip-workflows' ),
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
				<polyline points="17 8 12 3 7 8" />
				<line x1="12" y1="3" x2="12" y2="15" />
			</svg>
		),
		emptyText: null,
	},
};

/**
 * Section config, order and assistant mapping for one board.
 *
 * A per-agent section is keyed by the ability id its cards carry, so its heading is
 * that agent's name. It reads `label` \u2014 the human name \u2014 and not `name`, which is
 * the ability *identifier* (`WP_Ability::get_name()`). The previous
 * `a.name || a.label || a.id` precedence therefore resolved to the id on every
 * agent, which is what put `VIP-WORKFLOWS/WEB-RESEARCHER` above a board section.
 *
 * Every agent gets a section, turned-off ones included. A section is what makes
 * already-collected cards visible and attributable, and that work was done whatever
 * the agent's state is now. `isEnabled` is carried so the section can say so and can
 * withhold the controls that would run the agent again; it is not a reason to leave
 * the section out.
 *
 * @param {Array} researchAbilities Research abilities from the API.
 * @return {Object} `{ config, order, assistantMap }`.
 */
function buildSectionData( researchAbilities ) {
	const config = { ...FIXED_SECTIONS };
	const order = [ 'analysis' ];
	const assistantMap = {};

	( researchAbilities || [] ).forEach( ( a ) => {
		const key = a.id;
		config[ key ] = {
			label: a.label,
			icon: renderAssistantIcon( a.icon || 'search' ),
			emptyText: null,
			isMedia: key === 'vip-workflows/media-scout',
			isAgent: true,
			isEnabled: !! a.enabled,
		};
		order.push( key );
		assistantMap[ key ] = a.id;
	} );

	order.push( 'uploads' );

	return { config, order, assistantMap };
}

function SkeletonCard( { variant } ) {
	const isMedia = variant === 'media';
	return (
		<div
			className={ `vip-workflows-ideation-skeleton vip-workflows-panel-surface ${
				isMedia ? 'vip-workflows-ideation-skeleton--media' : ''
			}` }
		>
			<Stack direction="column" gap="sm">
				{ isMedia && (
					<div className="vip-workflows-ideation-skeleton__image" />
				) }
				<div className="vip-workflows-ideation-skeleton__line vip-workflows-ideation-skeleton__line--title" />
				<div className="vip-workflows-ideation-skeleton__line vip-workflows-ideation-skeleton__line--text" />
				<div className="vip-workflows-ideation-skeleton__line vip-workflows-ideation-skeleton__line--short" />
			</Stack>
		</div>
	);
}

const MEDIA_SUBGROUPS = [
	{
		key: 'images',
		label: __( 'Images', 'vip-workflows' ),
		icon: (
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
				<circle cx="8.5" cy="8.5" r="1.5" />
				<polyline points="21 15 16 10 5 21" />
			</svg>
		),
		filter: ( card ) => {
			if ( card.source_type === 'video' ) {
				return false;
			}
			const ai = parseAiAnalysis( card.ai_analysis );
			return ! ai.is_generated;
		},
	},
	{
		key: 'videos',
		label: __( 'Videos', 'vip-workflows' ),
		icon: (
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<polygon points="23 7 16 12 23 17 23 7" />
				<rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
			</svg>
		),
		filter: ( card ) => card.source_type === 'video',
	},
	{
		key: 'ai-generated',
		label: __( 'AI Generated', 'vip-workflows' ),
		icon: (
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
			</svg>
		),
		filter: ( card ) => {
			if ( card.source_type === 'video' ) {
				return false;
			}
			const ai = parseAiAnalysis( card.ai_analysis );
			return !! ai.is_generated;
		},
	},
];

/**
 * @param {Object}   props                   Component props.
 * @param {Array}    props.cards             Cards to display.
 * @param {Array}    props.pinnedIds         Source/card IDs that are pinned.
 * @param {number}   props.projectId         Active project ID.
 * @param {Function} props.onPin             Pin a card.
 * @param {Function} props.onDismiss         Dismiss a card.
 * @param {Function} props.onUnpin           Unpin a card.
 * @param {Function} props.onSummarize       Summarize a card via AI.
 * @param {Function} props.onSourceAdded     Callback when a source is added.
 * @param {Function} props.onGenerateImage   Generate an AI image.
 * @param {boolean}  props.isGenerating      Whether an AI image is being generated.
 * @param {Array}    props.researchAbilities Research abilities from the API.
 * @param {Array}    props.dismissedCards    Cards the user dismissed.
 * @param {Object}   props.assistants        Assistant status keyed by id.
 * @param {Function} props.onRestore         Restore a dismissed card.
 * @param {Function} props.onDelete          Delete a card.
 * @param {Function} props.onFindSimilar     Find sources similar to a card.
 * @param {Function} props.onRetry           Retry a card stuck in processing.
 * @param {Array}    props.stuckIds          IDs of cards stuck in processing.
 * @param {Object}   props.initialAssistants Initial assistant status map.
 * @return {JSX.Element} Mood board component.
 */
export default function MoodBoard( {
	cards,
	dismissedCards,
	pinnedIds,
	projectId,
	assistants = {},
	onPin,
	onDismiss,
	onUnpin,
	onRestore,
	onDelete,
	onSummarize,
	onSourceAdded,
	onGenerateImage,
	onFindSimilar,
	onRetry,
	stuckIds = [],
	isGenerating,
	initialAssistants = {},
	researchAbilities = [],
} ) {
	const [ addSourceOpen, setAddSourceOpen ] = useState( false );
	const [ generateOpen, setGenerateOpen ] = useState( false );
	const [ generatePrompt, setGeneratePrompt ] = useState( '' );
	const [ dismissedOpen, setDismissedOpen ] = useState( false );

	const handleGenerate = useCallback( async () => {
		if ( ! generatePrompt.trim() || ! onGenerateImage ) {
			return;
		}
		await onGenerateImage( generatePrompt.trim() );
		setGeneratePrompt( '' );
		setGenerateOpen( false );
	}, [ generatePrompt, onGenerateImage ] );

	const {
		config: SECTION_CONFIG,
		order: SECTION_ORDER,
		assistantMap: SECTION_ASSISTANT_MAP,
	} = useMemo(
		() => buildSectionData( researchAbilities ),
		[ researchAbilities ]
	);

	const pinnedSet = useMemo(
		() => new Set( pinnedIds || [] ),
		[ pinnedIds ]
	);

	// Agents that must not be started from this board.
	const offAbilityIds = useMemo(
		() =>
			new Set(
				( researchAbilities || [] )
					.filter( ( a ) => ! a.enabled )
					.map( ( a ) => a.id )
			),
		[ researchAbilities ]
	);

	const sections = useMemo( () => {
		const grouped = {};
		for ( const key of SECTION_ORDER ) {
			grouped[ key ] = [];
		}

		for ( const card of cards || [] ) {
			const section = resolveSection( card );
			if ( ! grouped[ section ] ) {
				grouped[ section ] = [];
			}
			grouped[ section ].push( card );
		}

		for ( const key of Object.keys( grouped ) ) {
			grouped[ key ].sort( ( a, b ) => {
				const aPinned = pinnedSet.has( getCardKey( a ) ) ? 0 : 1;
				const bPinned = pinnedSet.has( getCardKey( b ) ) ? 0 : 1;
				return aPinned - bPinned;
			} );
		}

		return grouped;
	}, [ cards, pinnedSet, SECTION_ORDER ] );

	if ( ! cards || cards.length === 0 ) {
		return (
			<Stack
				align="center"
				justify="center"
				className="vip-workflows-ideation-board vip-workflows-ideation-board--empty"
			>
				<Text
					variant="body-md"
					render={ <p /> }
					className="vip-workflows-ideation-board__empty-text"
				>
					{ __(
						'Agents are working on your idea…',
						'vip-workflows'
					) }
				</Text>
			</Stack>
		);
	}

	// Shared card renderer — the media-subgroup, single-card, and grouped
	// branches all render an identical <IdeationCard>; only the card differs.
	const renderCard = ( card ) => {
		const key = getCardKey( card );
		/*
		 * "Find similar" runs an agent, and which one is resolved from the card
		 * itself — so it is asked per card rather than per section: a card a
		 * turned-off agent found, and an upload whose search would fall back to a
		 * turned-off agent, offer nothing to click.
		 */
		const { assistant } = buildSimilarQuery( card );
		return (
			<IdeationCard
				key={ key }
				card={ card }
				isPinned={ pinnedSet.has( key ) }
				onPin={ onPin }
				onDismiss={ onDismiss }
				onUnpin={ onUnpin }
				onSummarize={ onSummarize }
				onFindSimilar={
					offAbilityIds.has( assistant ) ? undefined : onFindSimilar
				}
				onRetry={ onRetry }
				stuckIds={ stuckIds }
			/>
		);
	};

	// Body for a section with no cards yet: skeletons while its assistant is
	// running, the section's empty text otherwise.
	const renderEmptySectionBody = (
		sectionKey,
		sectionConfig,
		isMediaSection
	) => {
		const assistantId = SECTION_ASSISTANT_MAP[ sectionKey ];
		const apiStatus = assistantId && assistants[ assistantId ]?.status;
		const isLoading =
			assistantId &&
			( initialAssistants[ assistantId ] === 'running' ||
				apiStatus === 'pending' ||
				apiStatus === 'running' );
		if ( isLoading ) {
			return (
				// wpds-allow R7 -- responsive CSS grid (display:grid); not expressible as a Stack
				<div className="vip-workflows-ideation-section__grid">
					{ Array.from( { length: 2 }, ( _, i ) => (
						<SkeletonCard
							key={ i }
							variant={ isMediaSection ? 'media' : 'article' }
						/>
					) ) }
				</div>
			);
		}
		return sectionConfig?.emptyText ? (
			<Text
				variant="body-sm"
				render={ <p /> }
				className="vip-workflows-ideation-section__empty"
			>
				{ sectionConfig.emptyText }
			</Text>
		) : null;
	};

	return (
		<Stack
			direction="column"
			gap="xl"
			className="vip-workflows-ideation-board"
		>
			{ SECTION_ORDER.map( ( sectionKey ) => {
				const sectionConfig = SECTION_CONFIG[ sectionKey ];
				const sectionCards = sections[ sectionKey ] || [];

				if ( ! sectionConfig ) {
					if ( sectionCards.length === 0 ) {
						return null;
					}
				} else if (
					sectionCards.length === 0 &&
					! sectionConfig.emptyText &&
					sectionKey !== 'uploads'
				) {
					return null;
				}

				const isMediaSection = !! sectionConfig?.isMedia;
				// An agent an administrator has turned off. Its cards stay — they
				// were found, and may be pinned — but nothing here starts it again.
				const isOffAgent =
					!! sectionConfig?.isAgent && ! sectionConfig.isEnabled;
				const sectionSlug = sectionKey.replace( /[^a-z0-9-]/g, '-' );
				// No fallback to the section key: every key in SECTION_ORDER was
				// put there alongside its config entry, so a section without a
				// label is impossible — and the key is an ability id, which is the
				// one thing this heading must never print.
				const label = sectionConfig?.label;
				const icon = sectionConfig?.icon || null;

				let sectionBody;
				if ( sectionCards.length === 0 ) {
					sectionBody = renderEmptySectionBody(
						sectionKey,
						sectionConfig,
						isMediaSection
					);
				} else if ( isMediaSection ) {
					sectionBody = (
						<Stack direction="column" gap="md">
							{ MEDIA_SUBGROUPS.map( ( subgroup ) => {
								const subCards = sectionCards.filter(
									subgroup.filter
								);
								if ( subCards.length === 0 ) {
									return null;
								}
								return (
									<Stack
										direction="column"
										gap="xs"
										key={ subgroup.key }
									>
										<Stack
											align="center"
											gap="sm"
											className="vip-workflows-ideation-section__subheader"
										>
											<Stack
												render={ <span /> }
												align="center"
												className="vip-workflows-ideation-section__subheader-icon"
											>
												{ subgroup.icon }
											</Stack>
											<Text
												variant="heading-sm"
												render={ <span /> }
												className="vip-workflows-eyebrow"
											>
												{ subgroup.label }
											</Text>
											{ /* wpds-allow R7 -- inline count; font token + muted color, no Text variant */ }
											<span className="vip-workflows-ideation-section__subheader-count">
												{ subCards.length }
											</span>
										</Stack>
										{ /* wpds-allow R7 -- responsive CSS grid (display:grid); not expressible as a Stack */ }
										<div className="vip-workflows-ideation-section__grid">
											{ subCards.map( renderCard ) }
										</div>
									</Stack>
								);
							} ) }
						</Stack>
					);
				} else {
					sectionBody = (
						// wpds-allow R7 -- responsive CSS grid (display:grid); not expressible as a Stack
						<div className="vip-workflows-ideation-section__grid">
							{ groupCards( sectionCards ).map( ( group ) => {
								if ( group.cards.length === 1 ) {
									return renderCard( group.cards[ 0 ] );
								}
								return (
									<Stack
										direction="column"
										key={ group.key }
										className="vip-workflows-ideation-card-group vip-workflows-card-surface"
									>
										{ group.cards.map( renderCard ) }
									</Stack>
								);
							} ) }
						</div>
					);
				}

				return (
					<Stack
						direction="column"
						gap="md"
						key={ sectionKey }
						className={ `vip-workflows-ideation-section vip-workflows-ideation-section--${ sectionSlug }` }
					>
						<Stack
							align="center"
							gap="sm"
							className="vip-workflows-ideation-section__header"
						>
							{ icon && (
								<Stack
									render={ <span /> }
									align="center"
									className="vip-workflows-ideation-section__icon"
								>
									{ icon }
								</Stack>
							) }
							<Text
								variant="heading-sm"
								render={ <h3 /> }
								className="vip-workflows-ideation-section__title vip-workflows-eyebrow"
							>
								{ label }
							</Text>
							{ /* wpds-allow R7 -- inline count; font token + muted color, no Text variant */ }
							<span className="vip-workflows-ideation-section__count">
								{ sectionCards.length > 0
									? sectionCards.length
									: '' }
							</span>
							{ /*
							 * `draft` and not `low`: the caution intents are
							 * amber, and a turned-off agent is a configuration
							 * state, not something to warn a writer about. This
							 * is the same neutral tone the Editorial Sequences
							 * list gives a sequence that exists but is not live.
							 */ }
							{ isOffAgent && (
								<Badge intent="draft">
									{ __( 'Turned off', 'vip-workflows' ) }
								</Badge>
							) }
							{ isMediaSection &&
								! isOffAgent &&
								onGenerateImage && (
									<Button
										icon={
											isGenerating
												? undefined
												: GENERATE_ICON
										}
										// Icon rewrites an svg element to its
										// own 24px default; in this 24px-tall
										// small button the glyph keeps its
										// authored size instead.
										iconSize={ 14 }
										onClick={ () =>
											setGenerateOpen( true )
										}
										className="vip-workflows-ideation-section__add vip-workflows-ideation-section__generate"
										size="small"
										variant="tertiary"
										disabled={ isGenerating }
									>
										{ isGenerating ? (
											<>
												<Spinner />
												{ __(
													'Generating…',
													'vip-workflows'
												) }
											</>
										) : (
											__(
												'Generate AI image',
												'vip-workflows'
											)
										) }
									</Button>
								) }
							{ sectionKey === 'uploads' && (
								<Button
									icon={ plus }
									onClick={ () => setAddSourceOpen( true ) }
									className="vip-workflows-ideation-section__add"
									size="small"
									variant="tertiary"
								>
									{ __( 'Add source', 'vip-workflows' ) }
								</Button>
							) }
						</Stack>

						{ sectionBody }
					</Stack>
				);
			} ) }

			{ addSourceOpen && (
				<AddSourceModal
					projectId={ projectId }
					onClose={ () => setAddSourceOpen( false ) }
					onAdded={ onSourceAdded }
				/>
			) }

			{ generateOpen && (
				<Modal
					title={ __( 'Generate AI image', 'vip-workflows' ) }
					onRequestClose={ () => setGenerateOpen( false ) }
					className="vip-workflows-ideation-generate-modal"
					size="small"
				>
					<Stack direction="column" gap="md">
						<Text
							variant="body-sm"
							render={ <p /> }
							className="vip-workflows-ideation-generate-modal__hint"
						>
							{ __(
								'Describe the image you want to generate. Be specific about style, subject, and composition.',
								'vip-workflows'
							) }
						</Text>
						<TextControl
							value={ generatePrompt }
							onChange={ setGeneratePrompt }
							placeholder={ __(
								'e.g., A photojournalistic shot of a bustling newsroom at golden hour',
								'vip-workflows'
							) }
							__nextHasNoMarginBottom
							__next40pxDefaultSize
						/>
					</Stack>
					<ModalActions>
						<Button
							variant="tertiary"
							onClick={ () => setGenerateOpen( false ) }
						>
							{ __( 'Cancel', 'vip-workflows' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleGenerate }
							isBusy={ isGenerating }
							disabled={ ! generatePrompt.trim() || isGenerating }
						>
							{ __( 'Generate', 'vip-workflows' ) }
						</Button>
					</ModalActions>
				</Modal>
			) }

			{ dismissedCards && dismissedCards.length > 0 && (
				<Collapsible.Root
					open={ dismissedOpen }
					onOpenChange={ setDismissedOpen }
					className="vip-workflows-ideation-section vip-workflows-ideation-section--dismissed"
				>
					<Collapsible.Trigger className="vip-workflows-ideation-section__dismissed-toggle">
						<span
							className={ `vip-workflows-ideation-section__dismissed-chevron ${
								dismissedOpen ? 'is-open' : ''
							}` }
						>
							&#9654;
						</span>
						{ /* wpds-allow R7 -- bold disclosure label; no Text variant */ }
						<span className="vip-workflows-ideation-section__dismissed-label">
							{ __( 'Dismissed', 'vip-workflows' ) }
						</span>
						{ /* wpds-allow R7 -- inline count; font token + muted color, no Text variant */ }
						<span className="vip-workflows-ideation-section__count">
							{ dismissedCards.length }
						</span>
					</Collapsible.Trigger>
					<Collapsible.Panel>
						{ /* wpds-allow R7 -- responsive CSS grid (display:grid); not expressible as a Stack */ }
						<div className="vip-workflows-ideation-section__grid vip-workflows-ideation-section__grid--dismissed">
							{ dismissedCards.map( ( card ) => {
								const key = getCardKey( card );
								return (
									<IdeationCard
										key={ key }
										card={ card }
										isPinned={ false }
										isDismissed
										onRestore={ onRestore }
										onDelete={ onDelete }
									/>
								);
							} ) }
						</div>
					</Collapsible.Panel>
				</Collapsible.Root>
			) }
		</Stack>
	);
}
