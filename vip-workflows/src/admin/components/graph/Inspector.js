/**
 * Inspector — routes the current selection to the right options panel.
 *
 * The floating sidebar of the sequence editor. The editor owns the sequence;
 * this only decides which view the selection calls for and hands it the slice
 * it edits.
 *
 *   node selected      → StageInspector (PhaseStageInspector for phases)
 *   status region      → RegionInspector (a region, or its checkpoint)
 *   Start/End edge     → a read-only explanation; those edges have no options
 *   transition edge    → TransitionInspector
 *   nothing selected   → SequenceSettingsInspector (sequence-level settings)
 *
 * The one piece of state it does hold is whether the panel is collapsed. That
 * has to live here rather than in `InspectorShell`: the shell unmounts each
 * time the selection swaps one panel for another, so the flag would reset on
 * every click. This component stays mounted across those swaps.
 *
 * @package
 */

import { useState, useMemo, useCallback, useEffect } from '@wordpress/element';
import { Stack, Text } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';

import InspectorShell, { InspectorCollapseContext } from './InspectorShell';
import StageInspector from './StageInspector';
import PhaseStageInspector from './PhaseStageInspector';
import TransitionInspector from './TransitionInspector';
import SequenceSettingsInspector from './SequenceSettingsInspector';
import SequenceIdentityFields from './SequenceIdentityFields';
import RegionInspector from './RegionInspector';
import {
	stageRegion,
	stageLabel,
	isTransitionDisabled,
	outcomesRoutedTo,
	START_ID,
	END_ID,
} from './graph-model';
import { DEFAULT_REGION } from './regions';

import './Inspector.css';

/**
 * wp-admin's own mobile breakpoint, matched exactly.
 *
 * Core switches its admin chrome at 782px and `admin-page.css` already tracks
 * that for the admin bar's height; `SequenceGraphEditor.css` uses the same
 * width to dock this panel across the bottom. Kept in JS as well because
 * "collapsed by default" is React state driving `hidden` — a media query alone
 * can't set it without lying to `aria-expanded`.
 */
const MOBILE_BREAKPOINT = '( max-width: 782px )';

/**
 * Whether the viewport is in wp-admin's mobile layout.
 *
 * @return {boolean} True below the breakpoint.
 */
function useIsMobileLayout() {
	const [ isMobile, setIsMobile ] = useState(
		() => window.matchMedia( MOBILE_BREAKPOINT ).matches
	);

	useEffect( () => {
		const query = window.matchMedia( MOBILE_BREAKPOINT );
		const onChange = ( event ) => setIsMobile( event.matches );
		query.addEventListener( 'change', onChange );
		// The viewport can cross the breakpoint between first render and this
		// effect (a rotation during hydration); re-read so state can't be stale.
		setIsMobile( query.matches );
		return () => query.removeEventListener( 'change', onChange );
	}, [] );

	return isMobile;
}

export default function Inspector( props ) {
	const isMobile = useIsMobileLayout();

	// Open on desktop, collapsed on mobile — where the panel spans the bottom
	// of the viewport and would otherwise bury the graph it describes. Not
	// remembered between visits, so nobody returns to a panel they don't
	// remember closing.
	const [ collapsed, setCollapsed ] = useState( isMobile );
	const toggle = useCallback( () => setCollapsed( ( c ) => ! c ), [] );

	// Crossing the breakpoint re-applies that layout's default. It does
	// discard a manual toggle, which is the intent: the panel that suits a
	// 360px-wide phone is not the one that suits a desktop canvas.
	useEffect( () => {
		setCollapsed( isMobile );
	}, [ isMobile ] );

	const collapse = useMemo(
		() => ( { collapsed, toggle } ),
		[ collapsed, toggle ]
	);

	return (
		<InspectorCollapseContext.Provider value={ collapse }>
			{ renderPanel( props ) }
		</InspectorCollapseContext.Provider>
	);
}

// Pick the panel the current selection calls for. Takes everything `Inspector`
// received; each branch returns one of the panel components.
function renderPanel( {
	selection,
	isPhase,
	stages,
	selectedStage,
	selectedTransition,
	availableAgents,
	availableRoles,
	availableTools,
	toolsLoaded,
	availableChannels,
	onUpdateStage,
	onDeleteStage,
	onUpdateTransition,
	onDeleteTransition,
	onSelectEdge,
	onSetRegionEntry,
	onRemoveRegion,
	// Everything the sequence-level panel edits, passed through whole — see
	// SequenceSettingsInspector for the shape.
	sequenceSettings,
} ) {
	if ( selection?.type === 'region' ) {
		const members = stages.filter(
			( s ) => stageRegion( s ) === selection.region
		);
		const entry = members.find( ( s ) => Boolean( s.region_entry ) );
		return (
			<RegionInspector
				region={ selection.region }
				stages={ members }
				entryKey={ entry ? entry.key : null }
				onSetEntry={ ( key ) =>
					onSetRegionEntry( selection.region, key )
				}
				onRemove={ () => onRemoveRegion( selection.region ) }
				// Draft is where new content is created, and a group holding
				// stages has nowhere to put them — the same rule the canvas
				// menu gates its Remove item on.
				canRemove={
					selection.region !== DEFAULT_REGION && members.length === 0
				}
			/>
		);
	}

	if ( selection?.type === 'node' && selectedStage ) {
		if ( isPhase ) {
			return <PhaseStageInspector stage={ selectedStage } />;
		}
		return (
			<StageInspector
				stage={ selectedStage }
				availableAgents={ availableAgents }
				resolveStageLabel={ ( key ) => stageLabel( stages, key ) }
				stageExists={ ( key ) => stages.some( ( s ) => s.key === key ) }
				isKeyInUse={ ( value ) =>
					value !== selectedStage.key &&
					stages.some( ( s ) => s.key === value )
				}
				onChange={ ( changes ) =>
					onUpdateStage( selectedStage.key, changes )
				}
				onDelete={ () => onDeleteStage( selectedStage.key ) }
				// The stage panel's exit list is a way into each transition's
				// own panel, so it hands the selection back to the editor
				// exactly as the canvas does — same function, same edge ids.
				onSelectEdge={ onSelectEdge }
				canDelete={ stages.length > 1 }
			/>
		);
	}

	// Synthetic Start / End edges: explain the connection rather than show
	// transition options (they have none).
	if (
		selection?.type === 'edge' &&
		( selection.from === START_ID || selection.to === END_ID )
	) {
		const isStart = selection.from === START_ID;
		const stageKey = isStart ? selection.to : selection.from;
		return (
			<InspectorShell
				eyebrow={
					isStart
						? __( 'Flow entry', 'vip-workflows' )
						: __( 'Flow exit', 'vip-workflows' )
				}
				title={ stageLabel( stages, stageKey ) }
			>
				<Text
					variant="body-sm"
					render={ <p /> }
					className="wf-inspector__help"
				>
					{ isStart
						? __(
								'Content enters the flow at this stage. Drag the Start connection to another stage to change the entry point.',
								'vip-workflows'
						  )
						: __(
								'This is a final stage — content exits the flow here. Delete this connection to make the stage non-final.',
								'vip-workflows'
						  ) }
				</Text>
			</InspectorShell>
		);
	}

	if ( selection?.type === 'edge' && selectedTransition ) {
		const sourceStage = stages.find( ( s ) => s.key === selection.from );
		// Everyone standing on the record this panel edits. `findTransition`
		// resolves by target alone because a stage holds at most one transition
		// per target, so when two of an agent's outcomes lead here the panel is
		// editing both of them — which it has to say, since the canvas draws one
		// edge per outcome and each looks like a transition of its own.
		const sharing = outcomesRoutedTo( sourceStage, selection.to );
		return (
			<TransitionInspector
				transition={ selectedTransition }
				sourceLabel={ stageLabel( stages, selection.from ) }
				targetLabel={ stageLabel( stages, selection.to ) }
				outcome={ selection.outcome || null }
				sharedOutcomes={ sharing.length > 1 ? sharing : null }
				disabled={
					!! sourceStage &&
					isTransitionDisabled( sourceStage, selection.to )
				}
				availableRoles={ availableRoles }
				availableTools={ availableTools }
				toolsLoaded={ toolsLoaded }
				availableChannels={ availableChannels }
				simplified={ isPhase }
				onChange={ ( changes ) =>
					onUpdateTransition( selection.from, selection.to, changes )
				}
				onRemove={ () =>
					onDeleteTransition(
						selection.from,
						selection.to,
						selection.outcome || null
					)
				}
			/>
		);
	}

	// Nothing selected → sequence-level settings. Phase sequences have no post
	// types, CPT registration, or metadata fields, so they get the short form.
	if ( isPhase ) {
		const {
			name,
			onNameChange,
			description,
			onDescriptionChange,
			isActive,
			onActiveChange,
		} = sequenceSettings;
		return (
			<InspectorShell
				eyebrow={ __( 'Sequence', 'vip-workflows' ) }
				title={ name || __( 'Untitled sequence', 'vip-workflows' ) }
			>
				<Stack direction="column" gap="lg" align="stretch">
					<SequenceIdentityFields
						name={ name }
						onNameChange={ onNameChange }
						// A phase sequence gates the move between lifecycle
						// phases, so its example names that, not an editorial
						// workflow.
						namePlaceholder={ __(
							'e.g. Ideation Gate',
							'vip-workflows'
						) }
						description={ description }
						onDescriptionChange={ onDescriptionChange }
						isActive={ isActive }
						onActiveChange={ onActiveChange }
					/>
				</Stack>
			</InspectorShell>
		);
	}

	return <SequenceSettingsInspector { ...sequenceSettings } />;
}
