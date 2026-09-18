/**
 * StageInspector — options for the selected stage (node).
 *
 * Mirrors the stage fields from the old SequenceEditor form, scoped to one
 * stage: label, key, and color (now a fixed palette, not a freeform picker).
 * The freeform `<input type="color">` is gone — color is chosen from
 * `STAGE_PALETTE`, and only from it: a stage arriving with a hex from those
 * older pickers is moved onto the nearest slot before the editor holds it
 * (`snapToPalette`), so the picker has no off-palette value to represent.
 *
 * Where the stage sits — its post status region, and whether it holds that
 * region's entry checkpoint — is *shown* by the node's place on the canvas: the
 * section it sits in is the status, and sitting astride that section's boundary
 * line is the checkpoint. Position displays both. It is no longer the only way
 * to set either, which is the correction this panel carries: a gesture is a fine
 * way to set something, a poor way to check it, and a disastrous way to be the
 * only way — a canvas whose settings answer only to a drag has no answer at all
 * for an author who cannot make one.
 *
 * The two did not become the same control, because they are not the same shape.
 * A status is a property of the stage, so it sits with the label and the color,
 * one more thing the stage IS. A checkpoint is a property of the *region* — one
 * of its stages seats what arrives from outside, exactly one — so it stays a
 * single picker in `RegionInspector`, and the row here reports it and opens that
 * panel. A flag on each stage would be a second, mutable copy of a choice that
 * has one answer per region, and two copies of a rule drift.
 *
 * The exits are reachable from it, though. Each one names a transition with
 * options of its own, and the only way to open those was to find the matching
 * line on the canvas and click it — impossible for a transition pointing at a
 * stage that has been deleted, which draws no line at all. So an exit row
 * selects what it reports, and the transition's panel opens with it.
 *
 * **The read-out is one group, not a section per kind of thing.** A post in this
 * stage holds a status and can leave by some number of exits; whether an exit is
 * a button an author drew or an outcome an agent routes is a fact about what
 * drives it, not about where it goes. The three headings that used to sit over
 * these rows ("Placement", "Transitions", "AI stage") each restated what their
 * rows already said. A rule separates what the stage IS from where it can go,
 * because with no headings left those two read alike; every exit row also
 * carries a leading dot, neutral for a transition and the outcome's own tone
 * for a route.
 *
 * One exit is one row. On an AI stage a routed outcome and the transition it
 * travels are the same way out, so the outcome's row carries both — the
 * transition's name qualified by the outcome ("Move to Published · on pass")
 * — and the transitions listed after it are only the ones no outcome claims:
 * the disabled leftovers, and anything dangling. Listing every transition
 * under the outcomes, as this panel first did, showed each routed exit twice.
 *
 * That leaves the panel one heading ("Advanced"), so its document outline is
 * effectively flat. Deliberate for a dense inspector whose panel title already
 * names its subject — recorded here so it reads as a choice, not an oversight.
 *
 * **The agent is a control, not a group.** Picking one is what makes the stage
 * AI-owned — there is no separate toggle, because a stage with an agent and a
 * stage marked "AI" were never two different things. It used to sit in a
 * collapsible section that opened only when a stage already had one, which kept
 * it out of the way on the majority of stages that never will; it now sits with
 * the label and the color on every stage, because which agent runs a stage is
 * part of what the stage is rather than a mode to put it into. Where each of the
 * agent's outcomes leads is picked on the outcome's own row, and on the canvas
 * by dragging from the node's colored handles — the same routing, said twice
 * because one of the two is a drag.
 *
 * The stage key stays behind a disclosure — it is set once at creation — and
 * deleting the stage ends the body, in the danger zone every inspector shares.
 *
 * @package
 */

import { useState, useEffect, useMemo } from '@wordpress/element';
import {
	TextControl,
	SelectControl,
	ComboboxControl,
	DropdownMenu,
	MenuGroup,
	MenuItem,
	MenuItemsChoice,
} from '@wordpress/components';
import { chevronDown } from '@wordpress/icons';
import { Stack, Text } from '@wordpress/ui';
import { __, sprintf } from '@wordpress/i18n';
import { paletteOptions } from '../../utils/stage-palette';
import { AgentRequirements } from '../../../common/AgentRequirements';
import { Fact } from './InspectorFacts';
import InspectorFieldList, {
	InspectorFieldListAdd,
} from './InspectorFieldList';
import InspectorShell from './InspectorShell';
import InspectorSection from './InspectorSection';
import InspectorDangerZone from './InspectorDangerZone';
import {
	AGENT_OUTCOMES,
	agentOutcomeLabel,
	edgeId,
	isAgentStage,
	stageRegion,
	transitionLabel,
} from './graph-model';
import { regionDescription, regionLabel, regionOptions } from './regions';

import './StageInspector.css';

/**
 * Why the agent wired to this stage cannot run, and what it means for posts.
 *
 * Deliberately a warning rather than a block. A sequence is commonly designed
 * before its credentials exist, and an agent can go unavailable long after the
 * sequence is saved — a key is revoked, an extension is deactivated — so
 * refusing the selection would obstruct honest authoring while still not
 * guaranteeing the stage can run. Saying plainly what will happen is the honest
 * affordance.
 *
 * The consequence line is not decoration: `StageAgentRunner` treats an
 * unavailable agent as an errored run, so a post entering this stage follows
 * the agent's on-error route when one is set — and otherwise stops here with
 * the error and a go-back action.
 *
 * @param {Object} props           Component props.
 * @param {Object} props.agent     The selected agent entry, or undefined when unknown.
 * @param {string} props.abilityId The ability id the stage references.
 * @return {JSX.Element|null} Warning block, or null when the agent can run.
 */
function StageAgentWarning( { agent, abilityId } ) {
	if ( ! abilityId ) {
		return null;
	}

	// Referenced but absent from the stage-eligible list: its plugin was
	// deactivated, or the ability was renamed or removed after this sequence
	// was saved. A post entering the stage cannot run anything at all.
	if ( ! agent ) {
		return (
			<Stack
				className="vip-workflows-stage-agent-warning"
				direction="column"
				gap="xs"
			>
				<Text variant="body-md">
					{ sprintf(
						/* translators: %s: ability id, e.g. "workflow-agent-copy-edit/copy-edit". */
						__(
							'“%s” is unavailable, so posts here will error.',
							'vip-workflows'
						),
						abilityId
					) }
				</Text>
			</Stack>
		);
	}

	if ( false !== agent.available ) {
		return null;
	}

	return (
		<Stack
			className="vip-workflows-stage-agent-warning"
			direction="column"
			gap="xs"
		>
			<AgentRequirements
				groups={ agent.availability?.groups }
				ownerLabel={ agent.label }
			/>
			<Text variant="body-md">
				{ __(
					'Until this is set up, posts here will error.',
					'vip-workflows'
				) }
			</Text>
		</Stack>
	);
}

/**
 * Sanitize a stage key — lowercase letters, digits, underscore and hyphen.
 *
 * @param {string} str Raw input.
 * @return {string} Sanitized key.
 */
function sanitizeStageKey( str ) {
	return str
		.toLowerCase()
		.replace( /[^a-z0-9_-]/g, '-' )
		.replace( /-+/g, '-' );
}

/**
 * An outcome row's name once the outcome is routed: the transition it travels,
 * qualified by the outcome — "Move to Published · on pass".
 *
 * The transition's name leads because it is the identity the rest of the
 * product uses — the button a writer sees, the field `TransitionInspector`
 * edits — and the outcome reads as the qualifier saying what fires it. One
 * template per outcome rather than a "%1$s · %2$s" shell, so a translator
 * holds each whole phrase, separator and qualifier included.
 *
 * The unknown-outcome default mirrors `agentOutcomeLabel`'s: name the thing
 * as best we can rather than render a blank.
 *
 * @param {string} outcome        Outcome key (`pass` / `fail` / `error`).
 * @param {string} transitionName The transition's button label.
 * @return {string} The composed row label.
 */
function routedOutcomeLabel( outcome, transitionName ) {
	switch ( outcome ) {
		case 'pass':
			return sprintf(
				/* translators: %s: the transition's button label, e.g. "Move to Published". */
				__( '%s · on pass', 'vip-workflows' ),
				transitionName
			);
		case 'fail':
			return sprintf(
				/* translators: %s: the transition's button label, e.g. "Move to Published". */
				__( '%s · on fail', 'vip-workflows' ),
				transitionName
			);
		case 'error':
			return sprintf(
				/* translators: %s: the transition's button label, e.g. "Move to Published". */
				__( '%s · on error', 'vip-workflows' ),
				transitionName
			);
		default:
			return transitionName;
	}
}

/**
 * Where one of an agent's outcomes leads, as a control.
 *
 * The row it sits on already names the outcome and reports its destination, so
 * this is the picker and nothing else: every other stage, and — once the
 * outcome leads somewhere — the choice of leading nowhere. It rides in the
 * row's `trailing` slot rather than replacing the row's own button, because
 * that button opens the transition the outcome travels, which is a different
 * question with a whole panel of answers behind it.
 *
 * End is not among the options. An outcome routes to a stage and nothing else —
 * `routing` holds stage keys, and an AI stage is made final by clearing its
 * agent first — which is `isValidConnection`'s rule, stated here by having
 * nothing else to offer rather than by refusing a choice after it is made.
 *
 * @param {Object}   props         Component props.
 * @param {string}   props.outcome The outcome being routed.
 * @param {?string}  props.target  Stage key it leads to now, if any.
 * @param {Array}    props.options Destinations: `{ label, value }`.
 * @param {Function} props.onRoute Routes it: ( outcome, target ).
 * @param {Function} props.onClear Un-routes it: ( outcome ).
 * @return {JSX.Element} The picker.
 */
function OutcomeRouteMenu( { outcome, target, options, onRoute, onClear } ) {
	return (
		<DropdownMenu
			icon={ chevronDown }
			label={ sprintf(
				/* translators: %s: agent outcome label (e.g. On pass) */
				__( 'Route %s', 'vip-workflows' ),
				agentOutcomeLabel( outcome )
			) }
			toggleProps={ { size: 'small', showTooltip: true } }
		>
			{ ( { onClose } ) => (
				<>
					{ /* Radio items, so the destination it has now is checked
					     and announced as such rather than listed like the rest. */ }
					<MenuGroup>
						<MenuItemsChoice
							choices={ options }
							value={ target }
							onSelect={ ( value ) => {
								// Shut first, so focus is already on its way
								// back to the toggle before the row it names
								// re-renders underneath it.
								onClose();
								onRoute( outcome, value );
							} }
						/>
					</MenuGroup>
					{ target && (
						<MenuGroup>
							<MenuItem
								onClick={ () => {
									onClose();
									onClear( outcome );
								} }
							>
								{ __( 'Not routed', 'vip-workflows' ) }
							</MenuItem>
						</MenuGroup>
					) }
				</>
			) }
		</DropdownMenu>
	);
}

export default function StageInspector( {
	stage,
	onChange,
	onDelete,
	onSelectEdge,
	onSelectRegion,
	onSetStatus,
	onAddExit,
	onDeleteExit,
	onRouteOutcome,
	onClearOutcome,
	exitOptions = [],
	outcomeOptions = [],
	regions = [],
	canDelete,
	isKeyInUse,
	availableAgents = [],
	resolveStageLabel,
	stageExists,
	// ( targetKey ) => boolean. Needs the whole sequence and its settings
	// (`isTransitionDisabled`), which this panel is not handed.
	isTransitionDisabled,
} ) {
	// The Key field edits a local draft so a rename onto another stage's key
	// can be refused (updateStage rejects it — two stages sharing a key would
	// collapse into one on save) while still showing what was typed, flagged.
	const [ keyDraft, setKeyDraft ] = useState( stage.key || '' );
	useEffect( () => {
		setKeyDraft( stage.key || '' );
	}, [ stage.key ] );

	const keyCollides =
		keyDraft !== stage.key && Boolean( isKeyInUse?.( keyDraft ) );

	const handleKeyChange = ( value ) => {
		const sanitized = sanitizeStageKey( value );
		setKeyDraft( sanitized );
		if ( sanitized === stage.key || isKeyInUse?.( sanitized ) ) {
			return;
		}
		onChange( { key: sanitized } );
	};

	// AI-stage config. An agent runs on entry and routes the post onward by
	// outcome. Each route is picked on its outcome's row below, or drawn on the
	// canvas from the node's pass / fail / error handles.
	const isAgent = isAgentStage( stage );
	const abilityId = stage.agent?.ability_id || '';
	const routing = stage.agent?.routing || {};

	// Undefined when the stage references an ability that is no longer registered
	// — StageAgentWarning distinguishes that from an agent that is merely
	// unconfigured, because they are different problems with different fixes.
	const selectedAgent = availableAgents.find( ( a ) => a.id === abilityId );

	// Agent choices. Every stage-eligible ability on the site lands in this one
	// list, and a site running a handful of agent extensions has more of them
	// than anyone wants to scroll — hence a combobox, where the list is
	// filtered by typing rather than read end to end.
	//
	// Memoized because ComboboxControl keys its filtered list, and the
	// highlighted item in it, off this array's identity: a fresh one on every
	// keystroke in the Label field above would re-filter the whole list and
	// force an extra render of the control each time.
	const agentOptions = useMemo( () => {
		const options = availableAgents.map( ( a ) => ( {
			// Marked, not withheld: a sequence is often designed before its
			// credentials are wired, and an agent can go unavailable after the
			// sequence is saved anyway — so hiding it here would block honest
			// authoring without actually preventing the stuck state.
			label:
				false === a.available
					? sprintf(
							/* translators: %s: agent name. */
							__( '%s — setup needed', 'vip-workflows' ),
							a.label
					  )
					: a.label,
			value: a.id,
		} ) );

		// An ability that is no longer registered still has to read back as
		// itself. The combobox shows the label of whichever option matches its
		// value, so without an entry to match it would render an empty field —
		// silently disowning a value the stage is still holding.
		if ( abilityId && ! selectedAgent ) {
			options.push( {
				label: sprintf(
					/* translators: %s: ability id that is no longer registered. */
					__( '%s (unavailable)', 'vip-workflows' ),
					abilityId
				),
				value: abilityId,
			} );
		}

		return options;
	}, [ availableAgents, abilityId, selectedAgent ] );

	// Name a destination stage. Plainly — this is the stage's own label, the
	// wording the runtime builds a derived transition name out of, so nothing
	// about the editor's own state may creep into it.
	const nameTarget = ( target ) =>
		resolveStageLabel ? resolveStageLabel( target ) : target;

	// Name a destination stage for display. One helper for both read-outs below,
	// so a transition and the outcome routed along it can't describe the same
	// stage two different ways. A destination that no longer exists is reported
	// as such rather than shown as a bare key — the node carries the matching
	// warning.
	const describeTarget = ( target ) => {
		if ( stageExists && ! stageExists( target ) ) {
			return sprintf(
				/* translators: %s: stage key that no longer exists */
				__( '%s (missing)', 'vip-workflows' ),
				target
			);
		}
		return nameTarget( target );
	};

	// Where each outcome goes, resolved for display.
	const routeSummary = ( outcome ) =>
		routing[ outcome ] ? describeTarget( routing[ outcome ] ) : null;

	// Every way out of this stage, in the order the stage declares them. Named
	// by the label on the button that takes content along them — the same field
	// `TransitionInspector` edits — because that is what an author sees in the
	// post editor, and what tells two transitions to the same stage apart.
	//
	// That order is also what the drag below sets: stored order is the order a
	// writer's buttons appear in, so this list is where it is arranged.
	const transitions = stage.transitions || [];

	// Select the edge a row reports, on the canvas and in this panel at once —
	// the editor's own selection, so the transition's options open exactly as
	// they do when its line is clicked.
	//
	// Keyed by `{ from, to, outcome }`, which is one identity short of what the
	// list shows: a stage stored before the one-transition-per-target rule can
	// hold two rows to the same place, and both of them select the first. Left
	// that way deliberately — the pair is what an author is being asked to look
	// at before the repair collapses one, and making the second row inert would
	// hide half of what they are meant to see.
	const selectExit =
		( target, outcome = null ) =>
		() =>
			onSelectEdge( edgeId( stage.key, target, outcome ) );

	// On an AI stage a routed outcome and the transition it travels are one
	// exit, so the outcome's row absorbs the transition — name and all — and
	// the transitions list below carries only what no outcome claims. Listing
	// both showed every routed exit twice.
	//
	// Claimed by index, first match per target, for two reasons. Two outcomes
	// routed to the same destination travel the same transition, which is
	// absorbed once — each outcome row names it, nothing repeats below. And a
	// stage stored before the one-transition-per-target rule can hold two
	// transitions to the same place: only the first — the one `selectExit`
	// resolves — is absorbed, so the duplicate stays listed where the author
	// is asked to look at it before the repair collapses one.
	//
	// An outcome routed at a stage with no transition to travel on claims
	// nothing: deleting a stage drops the transitions aimed at it but leaves
	// the routing that named it, and a row selecting a transition that isn't
	// there would be a control that does nothing — so that row stays a plain
	// read-out, and the node carries the matching warning.
	//
	// The transitions left listed include disabled and dangling ones by
	// design: a transition no outcome claims is still configured, and for one
	// pointing at a stage that no longer exists — which draws no edge to click
	// — this list is the only reachable home of its panel and its Remove.
	const claimedExits = new Map();
	if ( isAgent ) {
		AGENT_OUTCOMES.forEach( ( outcome ) => {
			const target = routing[ outcome ];
			if ( ! target || claimedExits.has( target ) ) {
				return;
			}
			// A dangling target claims nothing, even when a transition to its
			// key exists. The editor never writes that pair, but imported JSON
			// can hold both a route and a transition naming a deleted stage —
			// and absorbing that transition would bury the only reachable home
			// of its Remove inside an outcome row. A missing `stageExists`
			// reads as "exists", matching `describeTarget`.
			if ( stageExists && ! stageExists( target ) ) {
				return;
			}
			const index = transitions.findIndex( ( t ) => t.to === target );
			if ( index !== -1 ) {
				claimedExits.set( target, index );
			}
		} );
	}
	const claimedIndices = new Set( claimedExits.values() );

	// What the transitions half of the list shows, with each entry keeping its
	// position in the stored array — the sort ids and the reorder below both
	// speak original indices, so a drag still moves the transition it grabbed.
	const listedTransitions = transitions
		.map( ( transition, index ) => ( { transition, index } ) )
		.filter( ( { index } ) => ! claimedIndices.has( index ) );

	// The transitions shown in InspectorFieldList: on a non-agent stage every
	// transition, on an agent stage only the ones no outcome claims.
	const displayedTransitions = listedTransitions.map(
		( { transition } ) => transition
	);

	// InspectorFieldList calls onChange for both reorder and remove. A
	// shorter array means a transition was removed — find it and delegate to
	// the full disconnection, which also handles Start/End special cases.
	const handleTransitionsChange = ( newList ) => {
		if ( newList.length < displayedTransitions.length ) {
			const removed = displayedTransitions.find(
				( t ) => ! newList.includes( t )
			);
			if ( removed ) {
				onDeleteExit( removed.to );
			}
			return;
		}
		if ( ! isAgent ) {
			// Non-agent: displayedTransitions IS the full array.
			onChange( { transitions: newList } );
			return;
		}
		// Agent: claimed transitions stay in their original positions;
		// unclaimed ones fill the remaining slots in their new order.
		const full = [];
		let next = 0;
		for ( let i = 0; i < transitions.length; i++ ) {
			if ( claimedIndices.has( i ) ) {
				full.push( transitions[ i ] );
			} else if ( next < newList.length ) {
				full.push( newList[ next ] );
				next++;
			}
		}
		onChange( { transitions: full } );
	};

	// The stage's own status region, and what saying it out loud has to include.
	//
	// Two sentences at most: what this status does to a post, and — only while
	// this stage is the one its region seats arrivals at — what moving it costs.
	// `setStageStatus` frees the checkpoint of the region a stage leaves, which
	// is right (a checkpoint is a position on that region's border, and the
	// stage is no longer in it) and invisible from a control, where the drag it
	// mirrors let the author watch the node come off the line. Said before the
	// change rather than reported after it: Save is blocked while a region has
	// no checkpoint, and an author who knows that in advance can set the next
	// one first.
	const region = stageRegion( stage );
	const holdsCheckpoint = Boolean( stage.region_entry );
	const statusHelp = [
		regionDescription( region ),
		holdsCheckpoint
			? sprintf(
					/* translators: %s: post status label (e.g. Pending Review) */
					__(
						'Changing this leaves “%s” with no entry checkpoint.',
						'vip-workflows'
					),
					regionLabel( region )
			  )
			: '',
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<InspectorShell
			eyebrow={ __( 'Stage', 'vip-workflows' ) }
			title={ stage.label || stage.key }
		>
			<Stack direction="column" gap="lg" align="stretch">
				<InspectorSection>
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Label', 'vip-workflows' ) }
						value={ stage.label || '' }
						onChange={ ( label ) => onChange( { label } ) }
					/>
					<SelectControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Color', 'vip-workflows' ) }
						value={ stage.color || '' }
						options={ paletteOptions() }
						onChange={ ( color ) => onChange( { color } ) }
					/>
					{ /* Which status posts hold here — the same setting the
					     node's band says, in the group of things the stage IS.
					     It is not merged into `onChange` with the fields above
					     it: the status is a move between groups, with a
					     checkpoint to free on the way out, and the editor's own
					     mutation is what knows that. */ }
					<SelectControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Post status', 'vip-workflows' ) }
						value={ region }
						// The statuses the canvas is drawing — every stage's
						// among them (`visibleRegions`). A status not drawn has
						// no band to move the node into, and adding one is the
						// sequence panel's verb.
						options={ regionOptions( regions ) }
						help={ statusHelp }
						onChange={ ( next ) => onSetStatus?.( next ) }
					/>
					<ComboboxControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Agent', 'vip-workflows' ) }
						help={ __(
							'Runs when a post enters this stage.',
							'vip-workflows'
						) }
						value={ abilityId }
						options={ agentOptions }
						placeholder={ __( 'Search agents…', 'vip-workflows' ) }
						// No "none" entry in the list — the empty state is the
						// empty field, and the reset button is how you get back
						// to it. `onChange` hands back null on reset, which is
						// the same instruction as picking nothing.
						//
						// Which is why the list must NOT open on focus:
						// ComboboxControl unmounts its reset button while
						// expanded, so with the default a keyboard user tabbing
						// into the field would find the only way to clear an
						// agent gone. Click, typing and ArrowDown all still open
						// it.
						expandOnFocus={ false }
						//
						// Routed through its own field rather than merged into
						// `agent`: clearing it drops the whole agent, and the
						// editor's mutation is what knows that.
						onChange={ ( value ) =>
							onChange( { agent_ability_id: value || '' } )
						}
					/>
					{ /* Travels with the picker: it explains the agent that was
					     just chosen, so it has to sit against it. */ }
					<StageAgentWarning
						agent={ selectedAgent }
						abilityId={ abilityId }
					/>
				</InspectorSection>

				{ /* Where this stage stands in its region, and every way out
				     of it. One group: a post here holds a status and leaves by
				     some number of exits. */ }
				<InspectorSection>
					<Stack
						render={ <ul /> }
						direction="column"
						gap="xs"
						className="wf-inspector__facts"
					>
						{ /* Reported here, set on the region. A region seats
						     arrivals at exactly one of its stages, so the
						     control belongs where that choice is one field
						     rather than a flag on each of its stages that could
						     disagree — and this row opens it, the same way an
						     exit row opens the transition it names. It loses
						     its tooltip by becoming a button (a tip is a
						     trigger, and a control inside a control is not a
						     thing); the panel it opens carries the whole
						     explanation against the picker itself. */ }
						<Fact
							label={ __( 'Entry checkpoint', 'vip-workflows' ) }
							value={
								stage.region_entry
									? __( 'Yes', 'vip-workflows' )
									: __( 'No', 'vip-workflows' )
							}
							onSelect={
								onSelectRegion
									? () => onSelectRegion( region )
									: undefined
							}
							// The row's name replaces its text, so it has to
							// carry the value too.
							selectLabel={ sprintf(
								/* translators: 1: Yes or No, 2: post status label (e.g. Pending Review) */
								__(
									'Entry checkpoint: %1$s. Open the “%2$s” post status options',
									'vip-workflows'
								),
								stage.region_entry
									? __( 'Yes', 'vip-workflows' )
									: __( 'No', 'vip-workflows' ),
								regionLabel( region )
							) }
						/>
					</Stack>

					<div className="wf-stage-inspector__exits">
						{ /* An exit that needs a destination named needs a
						     picker to name it in, and this is where the exits
						     already are. No heading over it: the rows say what
						     they are, which is why the three that used to sit
						     here went. An AI stage gets none of this — its
						     outcomes are the only ways out of it, and each one
						     picks its own destination on its own row below. */ }
						{ ! isAgent && exitOptions.length > 0 && (
							<Stack
								direction="row"
								align="center"
								justify="flex-end"
							>
								<InspectorFieldListAdd
									addOptions={ exitOptions }
									onAdd={ onAddExit }
									label={ __( 'Add exit', 'vip-workflows' ) }
									// A destination is the thing to read, even
									// when there is only one of them.
									alwaysMenu
								/>
							</Stack>
						) }
						{ /* Agent outcomes are a fixed trio, not an
						     ordered list an author adds to, so they stay
						     as standalone rows above the transition list.
						     On a non-agent stage there are none. */ }
						{ isAgent && (
							<Stack
								render={ <ul /> }
								direction="column"
								gap="xs"
								className="wf-inspector__facts"
							>
								{ AGENT_OUTCOMES.map( ( outcome ) => {
									const target = routing[ outcome ] || null;
									const destination = routeSummary( outcome );
									const claimed =
										target && claimedExits.has( target )
											? transitions[
													claimedExits.get( target )
											  ]
											: null;
									const rowLabel = claimed
										? routedOutcomeLabel(
												outcome,
												transitionLabel(
													claimed,
													nameTarget( target )
												)
										  )
										: agentOutcomeLabel( outcome );
									const disabled =
										Boolean( claimed ) &&
										isTransitionDisabled( target );
									return (
										<Fact
											key={ outcome }
											className={ [
												'wf-stage-inspector__route',
												`is-${ outcome }`,
												disabled && 'is-disabled',
											]
												.filter( Boolean )
												.join( ' ' ) }
											label={ rowLabel }
											value={
												disabled
													? sprintf(
															/* translators: %s: destination stage label */
															__(
																'%s (disabled)',
																'vip-workflows'
															),
															destination
													  )
													: destination ||
													  __(
															'Not routed',
															'vip-workflows'
													  )
											}
											empty={ ! destination }
											onSelect={
												claimed
													? selectExit(
															target,
															outcome
													  )
													: undefined
											}
											selectLabel={ sprintf(
												/* translators: %s: the row's label. */
												__(
													'Select %s',
													'vip-workflows'
												),
												rowLabel
											) }
											trailing={
												onRouteOutcome ? (
													<OutcomeRouteMenu
														outcome={ outcome }
														target={ target }
														options={
															outcomeOptions
														}
														onRoute={
															onRouteOutcome
														}
														onClear={
															onClearOutcome
														}
													/>
												) : undefined
											}
										>
											{ /* wpds-allow R7 -- an empty, aria-hidden colour dot; there is no text for <Text> to carry */ }
											<span
												className="wf-stage-inspector__route-dot"
												aria-hidden="true"
											/>
										</Fact>
									);
								} ) }
							</Stack>
						) }
						<InspectorFieldList
							items={ displayedTransitions }
							onChange={ handleTransitionsChange }
							describe={ ( transition ) => {
								const disabled = isTransitionDisabled(
									transition.to
								);
								const destination = describeTarget(
									transition.to
								);
								const label = transitionLabel(
									transition,
									nameTarget( transition.to )
								);
								return {
									label,
									value: disabled
										? sprintf(
												/* translators: %s: destination stage label */
												__(
													'%s (disabled)',
													'vip-workflows'
												),
												destination
										  )
										: destination,
									className: [
										'wf-stage-inspector__route',
										disabled && 'is-disabled',
									]
										.filter( Boolean )
										.join( ' ' ),
								};
							} }
							onItemSelect={ ( transition ) =>
								onSelectEdge(
									edgeId( stage.key, transition.to, null )
								)
							}
							sortable
							removeLabel={ __( 'Remove exit', 'vip-workflows' ) }
							emptyLabel={ __(
								'No exits yet. Add one or drag from a handle.',
								'vip-workflows'
							) }
						/>
					</div>
				</InspectorSection>

				<InspectorSection
					title={ __( 'Advanced', 'vip-workflows' ) }
					collapsible
				>
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Key', 'vip-workflows' ) }
						value={ keyDraft }
						onChange={ handleKeyChange }
						className={
							keyCollides
								? 'wf-stage-inspector__key--collides'
								: ''
						}
						help={
							keyCollides
								? __(
										'This key is already used by another stage.',
										'vip-workflows'
								  )
								: __(
										'Unique identifier for this stage.',
										'vip-workflows'
								  )
						}
					/>
				</InspectorSection>

				<InspectorDangerZone
					label={ __( 'Delete stage', 'vip-workflows' ) }
					onClick={ onDelete }
					disabled={ ! canDelete }
					description={
						canDelete
							? undefined
							: __(
									'A sequence needs at least one stage.',
									'vip-workflows'
							  )
					}
				/>
			</Stack>
		</InspectorShell>
	);
}
