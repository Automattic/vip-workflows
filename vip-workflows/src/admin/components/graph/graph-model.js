/**
 * Graph model for the sequence editor.
 *
 * The sequence config is already a graph: a stage is an entry in `statuses[]`
 * (workflow) or `phases[]` (phase sequences), and a transition is an entry in a
 * stage's `transitions[]` array (`from` = the owning stage's key, `to` = the
 * target stage's key). The `stages` array is the single source of truth held in
 * React state; nodes and edges are *projected* from it for `@xyflow/react` each
 * render. Mutations operate on the `stages` array — never on a separate edge
 * store — so transition fields with no visual representation are never dropped in
 * a round-trip.
 *
 * Everything here is pure: each mutation returns a new `stages` array, and
 * `buildGraph` / `validateSequence` derive read-only views. This keeps the model
 * unit-testable and free of React Flow or DOM concerns (positions are added
 * later by `layout.js`).
 *
 * @package
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import { paletteColorAt, DEFAULT_STAGE_COLOR } from '../../utils/stage-palette';
import {
	DEFAULT_REGION,
	regionEntryStage,
	regionLabel,
	stageRegion,
	visibleRegions,
} from './regions';

// `stageRegion` belongs with the rest of the region vocabulary, but every
// consumer of the model reads it from here. `regionEntryStage` moved there for
// the same reason and is re-exported so its existing callers keep working.
export { regionEntryStage, stageRegion, visibleRegions };

export const NODE_TYPE = 'stage';
export const EDGE_TYPE = 'transition';

// Fixed stage-node footprint — the Figma card proportions (drawn 120×80),
// widened so typical stage names fit before truncating. Set explicitly on each
// node so React Flow renders them at a constant size rather than measuring —
// the canvas runs at 100% zoom, so on-screen size is stable.
export const STAGE_WIDTH = 200;
export const STAGE_HEIGHT = 80;

// Synthetic flow endpoints. These are rendered on the canvas but are NOT stored
// stages: the Start node's edge points at the entry stage (which the runtime
// reads as `statuses[0]`), and a stage's edge to the End node marks it terminal
// (`is_terminal`). Their ids are namespaced so they can't collide with a stage
// key (`sanitize_key` would never produce these).
export const TERMINAL_NODE_TYPE = 'terminal';
export const START_ID = '__wf_start__';
export const END_ID = '__wf_end__';

// The band a region's stages sit in. Not a stored stage — it's projected from
// `stages` plus the editor's list of visible regions, and carries no state of
// its own. It draws nothing but the region's checkpoint slot: the boundary line
// and the label are screen-space chrome (`RegionBands`), because a region is a
// section of the canvas rather than a shape on it.
export const REGION_NODE_TYPE = 'region';

// Paint order on the canvas, bottom to top: the region band, then the edges that
// cross it, then the stages.
//
// The edges have to be lifted explicitly. React Flow renders its edge layer and
// its node layer as sibling containers with the node layer last and neither
// carrying a z-index, so at equal depth a node always wins — and a band is a
// node the size of a whole region. Left at the default it clips every transition
// passing through it. Dropping it below the edges instead is not available:
// React Flow floors a node's z-index at 0.
export const REGION_Z = 0;
export const EDGE_Z = 1;
export const STAGE_Z = 2;

/**
 * Node id for a region's band.
 *
 * @param {string} region Region slug.
 * @return {string} Node id.
 */
export const regionNodeId = ( region ) => `__wf_region_${ region }__`;

/**
 * A stage's display label, by key.
 *
 * Defaults twice — to the key when the stage carries no label, and to the key
 * again when there is no such stage — and both defaults are display-only. Every
 * caller is composing a sentence for the author (a validation error, a repair
 * report), nothing branches on the result, and both conditions behind the
 * defaults are things `validateSequence` already warns about in their own right
 * — a stage with no label ("The stage keyed … has no name"), and a transition to
 * a stage that doesn't exist. Naming a broken thing by its key is how the author
 * is told which one it is; a blank would only hide it.
 *
 * The one place this belongs, so every caller that needs it — `validateSequence`
 * here, `describeRepair` in `SequenceGraphEditor.js`, and the panel titles and
 * transition endpoint labels in `Inspector.js` — says the same thing.
 *
 * @param {Array}  stages Stage objects.
 * @param {string} key    Stage key.
 * @return {string} The stage's label, or its key.
 */
export function stageLabel( stages, key ) {
	return ( stages || [] ).find( ( s ) => s.key === key )?.label || key;
}

/*
 * The label derivation lives in `src/common/transition-label.js` — the
 * editor sidebar's transition rail needs the identical strings for an agent
 * stage's routed outcomes — and is re-exported here so graph-side consumers
 * keep importing it from the model.
 */
export {
	derivedTransitionLabel,
	transitionLabel,
} from '../../../common/transition-label';

/**
 * The outcomes a stage agent can finish with, in reading order. A stage whose
 * `agent.ability_id` is set is AI-owned: the agent runs on entry and the post
 * leaves along whichever of these the run produced, so on the canvas each one is
 * its own source handle and its own edge.
 *
 * These are also the keys of `agent.routing` — the map the runtime reads
 * (`class-stage-agent-runner.php`) to pick the exit transition.
 */
export const AGENT_OUTCOMES = [ 'pass', 'fail', 'error' ];

/**
 * Whether a stage is AI-owned. The agent's ability is what makes it one: a
 * `agent` object without an `ability_id` is a partial the save path drops, and
 * the runtime treats as "not AI-owned" too.
 *
 * @param {Object} stage A stage object.
 * @return {boolean} True when an agent runs on entry to this stage.
 */
export function isAgentStage( stage ) {
	return Boolean( stage?.agent?.ability_id );
}

/**
 * Whether a handle / edge id names one of the agent outcomes.
 *
 * @param {?string} value Handle id, or null for a plain connection.
 * @return {boolean} True for `pass` / `fail` / `error`.
 */
export function isAgentOutcome( value ) {
	return AGENT_OUTCOMES.includes( value );
}

/**
 * Human label for an agent outcome. Kept here (rather than as a module-level
 * map) so the strings are translated at call time, not at import time.
 *
 * @param {string} outcome Outcome key.
 * @return {string} Translated label.
 */
export function agentOutcomeLabel( outcome ) {
	switch ( outcome ) {
		case 'pass':
			return __( 'On pass', 'vip-workflows' );
		case 'fail':
			return __( 'On fail', 'vip-workflows' );
		case 'error':
			return __( 'On error', 'vip-workflows' );
		default:
			return outcome;
	}
}

/**
 * Name a set of agent outcomes as one phrase, for the surfaces that have to
 * say "these all travel the same transition".
 *
 * Comma-joined rather than run through a conjunction: the set is at most the
 * three of `AGENT_OUTCOMES`, and every caller drops the phrase into a sentence
 * of its own where a bare list reads correctly in each.
 *
 * @param {Array} outcomes Outcome keys.
 * @return {string} Their translated labels, comma-separated.
 */
export function agentOutcomeNames( outcomes ) {
	return outcomes.map( agentOutcomeLabel ).join( ', ' );
}

/**
 * Build a stable edge id from its endpoints. A stage may have at most one
 * transition to a given target, so `from->to` uniquely identifies an edge —
 * except on an AI stage, where two outcomes may route to the same destination
 * and each is drawn as its own edge. Those carry the outcome in the id.
 *
 * Stage keys are sanitized to `[a-z0-9_-]`, so the colon can't collide with one.
 *
 * @param {string}  from      Source stage key.
 * @param {string}  to        Target stage key.
 * @param {?string} [outcome] Agent outcome this edge carries, if any.
 * @return {string} Edge id.
 */
export const edgeId = ( from, to, outcome = null ) =>
	outcome ? `${ from }:${ outcome }->${ to }` : `${ from }->${ to }`;

/**
 * Parse an edge id back into its endpoints and outcome.
 *
 * @param {string} id Edge id produced by `edgeId`.
 * @return {{ from: string, to: string, outcome: ?string }} Endpoints.
 */
export function parseEdgeId( id ) {
	const sep = id.indexOf( '->' );
	const source = id.slice( 0, sep );
	const to = id.slice( sep + 2 );
	const mark = source.indexOf( ':' );
	if ( mark === -1 ) {
		return { from: source, to, outcome: null };
	}
	return {
		from: source.slice( 0, mark ),
		to,
		outcome: source.slice( mark + 1 ),
	};
}

/**
 * Project the `stages` array into `@xyflow/react` nodes and edges. Positions are
 * zeroed here; `layout.js` fills them in. Edges whose target stage no longer
 * exists are skipped (and reported by `validateSequence`) so React Flow never
 * sees a dangling edge.
 *
 * @param {Array}    stages                    Stage objects.
 * @param {Object}   [options]                 View options.
 * @param {string}   [options.selectedNodeKey] Currently selected stage key.
 * @param {string}   [options.selectedEdgeId]  Currently selected edge id.
 * @param {Object}   [options.warnings]        `{ stageKey: string[] }` from `validateSequence`.
 * @param {boolean}  [options.isPhase]         Phase sequence (no terminal flag or status region).
 * @param {string[]} [options.regions]         Status regions to draw a group for
 *                                             (see `visibleRegions`). Empty (the
 *                                             default) draws no groups.
 * @return {{ nodes: Array, edges: Array }} React Flow graph.
 */
export function buildGraph( stages, options = {} ) {
	const {
		selectedNodeKey = null,
		selectedEdgeId = null,
		warnings = {},
		isPhase = false,
		regions = [],
	} = options;

	const keys = new Set( stages.map( ( s ) => s.key ) );

	// Stages with at least one incoming transition; the rest are entry points.
	const hasIncoming = new Set();
	stages.forEach( ( stage ) => {
		( stage.transitions || [] ).forEach( ( t ) => {
			if ( keys.has( t.to ) ) {
				hasIncoming.add( t.to );
			}
		} );
	} );

	const nodes = stages.map( ( stage ) => {
		const stageWarnings = warnings[ stage.key ] || [];
		// AI stages (workflow only — phase sequences have no agents) swap the
		// single drag-out grip for one handle per outcome. The node needs to know
		// which of them are wired, so it can draw a routed handle differently
		// from one still waiting to be dragged.
		const isAgent = ! isPhase && isAgentStage( stage );
		const routing = isAgent ? stage.agent.routing || {} : null;
		return {
			id: stage.key,
			type: NODE_TYPE,
			position: { x: 0, y: 0 },
			width: STAGE_WIDTH,
			height: STAGE_HEIGHT,
			// Phase stages are fixed (the lifecycle needs both of them), so the
			// keyboard-delete path must not remove them.
			deletable: ! isPhase,
			selected: stage.key === selectedNodeKey,
			// Above the region band it sits in, and above the edges.
			zIndex: STAGE_Z,
			data: {
				label: stage.label || stage.key,
				color: stage.color || DEFAULT_STAGE_COLOR,
				// Which band the node belongs in. Read by `layout.js` to place
				// it, and by the canvas to tell a drag that changed the stage's
				// region from one that just moved it within its own.
				region: isPhase ? null : stageRegion( stage ),
				// The stage occupying its region's checkpoint slot. `layout.js`
				// docks it on the band's border; the node draws itself as the
				// way in.
				isRegionEntry: ! isPhase && Boolean( stage.region_entry ),
				isAgent,
				// Outcome → destination, restricted to destinations that exist.
				// Null on a stage with no agent, so the node can tell "not an AI
				// stage" from "an AI stage with nothing routed yet".
				routing: isAgent
					? Object.fromEntries(
							AGENT_OUTCOMES.map( ( outcome ) => [
								outcome,
								keys.has( routing[ outcome ] )
									? routing[ outcome ]
									: null,
							] )
					  )
					: null,
				isTerminal: ! isPhase && Boolean( stage.is_terminal ),
				// The node's "published" badge marks stages living in the
				// publish status region.
				publishes: ! isPhase && stage.status === 'publish',
				isEntry: ! hasIncoming.has( stage.key ),
				// Count only transitions that exist and can be used, so "N
				// transitions" matches what content can actually do here. A
				// transition to a missing stage is surfaced via the warning
				// rather than silently inflating the count, and a disabled one
				// (an AI stage's unrouted leftovers) is not a way out at all.
				transitionCount: ( stage.transitions || [] ).filter(
					( t ) =>
						keys.has( t.to ) &&
						// `isAgent` rather than the stage directly, so phase
						// mode counts the same transitions it draws.
						! ( isAgent && isTransitionDisabled( stage, t.to ) )
				).length,
				warnings: stageWarnings,
			},
		};
	} );

	// Every routed transition, so each edge can tell whether the reverse one
	// exists too. Floating edges meet the same border from both directions, so a
	// reciprocal pair has to be held apart or one of the two is drawn over.
	const routed = new Set();
	stages.forEach( ( stage ) => {
		( stage.transitions || [] ).forEach( ( transition ) => {
			if ( keys.has( transition.to ) ) {
				routed.add( edgeId( stage.key, transition.to ) );
			}
		} );
	} );

	const edges = [];
	stages.forEach( ( stage ) => {
		const routing =
			! isPhase && isAgentStage( stage )
				? stage.agent.routing || {}
				: null;
		( stage.transitions || [] ).forEach( ( transition ) => {
			if ( ! keys.has( transition.to ) ) {
				return; // dangling; surfaced as a sequence error
			}
			// On an AI stage a transition is drawn once per outcome routed
			// along it — two outcomes sharing a destination are two edges, each
			// leaving its own handle, rather than one ambiguous line. A
			// transition no outcome claims still draws once, unattributed —
			// and disabled, because the agent owns every way out of the stage.
			const claimed = routing
				? outcomesRoutedTo( stage, transition.to )
				: [];
			const disabled = Boolean( routing ) && claimed.length === 0;
			const variants = claimed.length > 0 ? claimed : [ null ];
			variants.forEach( ( outcome, index ) => {
				const id = edgeId( stage.key, transition.to, outcome );
				edges.push( {
					id,
					type: EDGE_TYPE,
					source: stage.key,
					target: transition.to,
					// Anchors the edge at the outcome's handle; null lets React
					// Flow fall back to the node's first source handle.
					sourceHandle: outcome,
					selected: id === selectedEdgeId,
					// The transition's own fields stay in `stages` — the
					// inspector reads them from there. The edge only carries
					// what the canvas itself needs (geometry + affordances; the
					// rest is added in `GraphCanvas`).
					data: {
						outcome,
						disabled,
						// Every outcome standing on this one transition record,
						// when more than one does — null otherwise. Two edges
						// drawn from one record are not two things to configure:
						// editing either edits both, because there is only one
						// of them (`outcomesRoutedTo`). The canvas and the
						// inspector both say so from this, rather than each
						// leaving the reader to discover it.
						sharedOutcomes: claimed.length > 1 ? claimed : null,
						reciprocal: routed.has(
							edgeId( transition.to, stage.key )
						),
						// Siblings drawn between this exact pair of nodes, so
						// they can be fanned apart rather than stacked.
						parallelIndex: index,
						parallelCount: variants.length,
					},
				} );
			} );
		} );
	} );

	// Synthetic Start / End endpoints (workflow only). Start connects to the
	// flow entry — the draft region's entry checkpoint ("where content
	// enters"; `setEntryStage` keeps it at `statuses[0]`, but legacy data may
	// not, so fall back to `statuses[0]` when no draft stage is marked). Each
	// terminal stage connects to End.
	if ( ! isPhase && stages.length > 0 ) {
		const entryKey = entryStageKey( stages );

		nodes.unshift( endpointNode( START_ID, 'start' ) );
		nodes.push( endpointNode( END_ID, 'end' ) );

		const startEdgeId = edgeId( START_ID, entryKey );
		edges.unshift( {
			id: startEdgeId,
			type: EDGE_TYPE,
			source: START_ID,
			target: entryKey,
			selected: startEdgeId === selectedEdgeId,
			deletable: false,
			data: { synthetic: 'start' },
		} );

		stages.forEach( ( stage ) => {
			if ( ! stage.is_terminal ) {
				return;
			}
			const id = edgeId( stage.key, END_ID );
			edges.push( {
				id,
				type: EDGE_TYPE,
				source: stage.key,
				target: END_ID,
				selected: id === selectedEdgeId,
				// Terminal status is set by connecting a stage to End and cleared
				// by deleting that edge; the End endpoint itself isn't draggable
				// (dragging it onto a stage has no well-defined meaning).
				reconnectable: false,
				data: { synthetic: 'end' },
			} );
		} );
	}

	// Status-region bands, painted at the bottom of the stack (see the layer
	// constants above) so the stages sit *in* the band rather than beside it.
	//
	// A region's entry checkpoint has no marker of its own: the stage that *is*
	// the checkpoint is docked on the band's border by `layout.js`, so the thing
	// on the boundary is the stage a post arriving from outside the workflow
	// lands at, not a label pointing at it. A region with the slot empty says so
	// (`hasEntry`), and `validateSequence` blocks Save until something fills it.
	const regionNodes = regions.map( ( region ) => {
		const members = stages.filter( ( s ) => stageRegion( s ) === region );
		return {
			id: regionNodeId( region ),
			type: REGION_NODE_TYPE,
			position: { x: 0, y: 0 },
			// Sized by `layout.js` to fit the stages it holds.
			draggable: false,
			deletable: false,
			selected: false,
			// A band is the ground the stages stand on, not something you
			// operate: it takes no pointer events (`layout.js`) and renders
			// nothing but an `aria-hidden` slot outline. React Flow's
			// `nodesFocusable` defaults to true, though, so without these it
			// would still be a tab stop announced as a node with nothing to do
			// there — one per region, ahead of Start and every stage. The
			// region's clickable identity is its label, which is a real button
			// in `RegionBands`.
			focusable: false,
			selectable: false,
			zIndex: REGION_Z,
			data: {
				region,
				label: regionLabel( region ),
				stageCount: members.length,
				hasEntry: Boolean( regionEntryStage( members, region ) ),
				// Draft is where new content is created, so a sequence always
				// needs it; and a region holding stages can't be dismissed
				// without deciding what happens to them.
				removable: region !== DEFAULT_REGION && members.length === 0,
			},
		};
	} );

	nodes.unshift( ...regionNodes );

	// Every edge rides above the region bands and below the stages — one layer
	// for the lot, applied here rather than at each push site so no future edge
	// can be added on the wrong side of a band (see the layer constants).
	return {
		nodes,
		edges: edges.map( ( edge ) => ( { ...edge, zIndex: EDGE_Z } ) ),
	};
}

/**
 * Build a synthetic Start / End node.
 *
 * @param {string} id   Node id (`START_ID` / `END_ID`).
 * @param {string} kind `'start'` or `'end'`.
 * @return {Object} React Flow node.
 */
function endpointNode( id, kind ) {
	return {
		id,
		type: TERMINAL_NODE_TYPE,
		position: { x: 0, y: 0 },
		selectable: false,
		deletable: false,
		draggable: false,
		// Nothing can be done to Start or End — they mark where the flow begins
		// and ends, and the edges either side of them are the operable part. So
		// they are taken out of the tab order too: React Flow focuses every node
		// by default, and a stop that can't be selected, moved or deleted only
		// costs a keyboard user two presses.
		focusable: false,
		width: 120,
		height: 36,
		zIndex: STAGE_Z,
		data: { kind },
	};
}

// ---------------------------------------------------------------------------
// Stage mutations — each returns a new `stages` array.
// ---------------------------------------------------------------------------

/**
 * Generate a stage key not already used in the sequence.
 *
 * @param {Array} stages Existing stages.
 * @return {string} Unique key like `status_3`.
 */
function uniqueStageKey( stages ) {
	const used = new Set( stages.map( ( s ) => s.key ) );
	let n = stages.length + 1;
	let key = `status_${ n }`;
	while ( used.has( key ) ) {
		n += 1;
		key = `status_${ n }`;
	}
	return key;
}

/**
 * Append a new stage. Picks the next palette color by position.
 *
 * The stage lands in `status` (draft unless the caller says otherwise — a stage
 * grown inside another region's group belongs to that region).
 *
 * It takes that region's entry checkpoint only when it is the region's FIRST
 * stage, matching what the server's write gate does with a region whose stages
 * carry no marker. Where a region already holds stages, the checkpoint stays a
 * slot on the group's border that a stage is dragged into: auto-filling it there
 * would put a stage somewhere the author didn't drop it, and would quietly undo
 * having just dragged one out. An empty region can't undo anything — nothing
 * holds the slot — and leaving it empty would leave the region with no landing
 * spot for a post core puts in that status, which `validateSequence` blocks Save
 * on.
 *
 * @param {Array}  stages           Existing stages.
 * @param {Object} [options]        Creation options.
 * @param {string} [options.status] Status region the new stage lives in.
 * @return {{ stages: Array, key: string }} New stages array and the new key.
 */
export function addStage( stages, options = {} ) {
	const { status = DEFAULT_REGION } = options;
	const key = uniqueStageKey( stages );
	const firstInRegion = ! stages.some( ( s ) => stageRegion( s ) === status );
	const next = [
		...stages,
		{
			key,
			label: sprintf(
				/* translators: %d: stage number */
				__( 'Stage %d', 'vip-workflows' ),
				stages.length + 1
			),
			color: paletteColorAt( stages.length ),
			is_terminal: false,
			status,
			region_entry: firstInRegion,
			transitions: [],
		},
	];
	return { stages: next, key };
}

/**
 * Remove a stage and any transitions targeting it.
 *
 * @param {Array}  stages Existing stages.
 * @param {string} key    Stage key to remove.
 * @return {Array} New stages array.
 */
export function removeStage( stages, key ) {
	return stages
		.filter( ( s ) => s.key !== key )
		.map( ( s ) => ( {
			...s,
			transitions: ( s.transitions || [] ).filter(
				( t ) => t.to !== key
			),
		} ) );
}

/**
 * Merge changes into a stage. When the key changes, every transition pointing at
 * the old key is rewired so edges stay connected.
 *
 * @param {Array}  stages  Existing stages.
 * @param {string} key     Stage key to update.
 * @param {Object} changes Partial stage fields.
 * @return {Array} New stages array.
 */
export function updateStage( stages, key, changes ) {
	const newKey = changes.key !== undefined ? changes.key : key;
	// Renaming onto another stage's key would collapse the two stages into one
	// node id and merge their transitions on save. Refuse the change;
	// `validateSequence` separately flags duplicates that arrive in saved data.
	if ( newKey !== key && stages.some( ( s ) => s.key === newKey ) ) {
		return stages;
	}
	return stages.map( ( stage ) => {
		let next = stage;
		if ( stage.key === key ) {
			next = { ...stage, ...changes };
		}
		if ( newKey !== key && next.transitions ) {
			next = {
				...next,
				transitions: next.transitions.map( ( t ) =>
					t.to === key ? { ...t, to: newKey } : t
				),
			};
		}
		return next;
	} );
}

/**
 * Mark a stage as its status region's entry checkpoint. Radio semantics: the
 * target gains `region_entry` and every other stage in the same region loses
 * it (each used region has exactly one entry). Stages in other regions are
 * untouched. No-op (same array back) when the key is missing or the stage is
 * already the region's sole entry.
 *
 * @param {Array}  stages Existing stages.
 * @param {string} key    Stage to mark as its region's entry.
 * @return {Array} New stages array.
 */
export function setRegionEntry( stages, key ) {
	const target = stages.find( ( s ) => s.key === key );
	if ( ! target ) {
		return stages;
	}
	const region = stageRegion( target );
	const needsChange = stages.some( ( s ) =>
		s.key === key
			? ! s.region_entry
			: Boolean( s.region_entry ) && stageRegion( s ) === region
	);
	if ( ! needsChange ) {
		return stages;
	}
	return stages.map( ( s ) => {
		if ( s.key === key ) {
			return { ...s, region_entry: true };
		}
		if ( s.region_entry && stageRegion( s ) === region ) {
			return { ...s, region_entry: false };
		}
		return s;
	} );
}

/**
 * Clear a stage's entry-checkpoint marker, leaving its region without one.
 *
 * The counterpart to dragging a stage off the checkpoint slot. Nothing is
 * promoted in its place: which stage sits on the boundary is the author's call,
 * and `validateSequence` blocks Save until a region that holds stages has one
 * again.
 *
 * @param {Array}  stages Existing stages.
 * @param {string} key    Stage to unmark.
 * @return {Array} New stages array.
 */
export function clearRegionEntry( stages, key ) {
	const target = stages.find( ( s ) => s.key === key );
	if ( ! target || ! target.region_entry ) {
		return stages;
	}
	return updateStage( stages, key, { region_entry: false } );
}

/**
 * Move a stage into a different status region.
 *
 * The checkpoint does not travel with it and is not handed on: a stage that was
 * its old region's entry stops being one (it isn't in that region any more), and
 * it does not become the new region's entry just by arriving. Both are positions
 * on a group's border that a stage is dragged into — see `setRegionEntry` — so
 * filling or vacating one behind the author's back would move a node they didn't
 * touch. `validateSequence` reports a region left without an entry.
 *
 * @param {Array}  stages Existing stages.
 * @param {string} key    Stage key to move.
 * @param {string} status New status region for the stage.
 * @return {Array} New stages array.
 */
export function setStageStatus( stages, key, status ) {
	const target = stages.find( ( s ) => s.key === key );
	if ( ! target ) {
		return stages;
	}
	if ( stageRegion( target ) === status ) {
		// Same region — still persist the explicit value when a legacy stage
		// carries no `status` field yet.
		return target.status === status
			? stages
			: updateStage( stages, key, { status } );
	}
	return updateStage( stages, key, { status, region_entry: false } );
}

/**
 * The stage the synthetic Start edge points at — the draft region's entry
 * checkpoint ("where content enters"; `setEntryStage` keeps it at
 * `statuses[0]`, but legacy data may not, so fall back to `statuses[0]` when no
 * draft stage is marked).
 *
 * Shared by the projection that draws that edge and the gestures that move it,
 * so "where does Start point" has one answer: a gesture that cannot change this
 * value has not moved the Start edge, whatever else it did to the array.
 *
 * @param {Array} stages Existing stages.
 * @return {?string} The entry stage's key, or null when there are no stages.
 */
export function entryStageKey( stages ) {
	if ( stages.length === 0 ) {
		return null;
	}
	const draftEntry = stages.find(
		( s ) => Boolean( s.region_entry ) && stageRegion( s ) === 'draft'
	);
	return draftEntry ? draftEntry.key : stages[ 0 ].key;
}

/**
 * Make a stage the flow entry. The synthetic Start edge and the draft
 * region's `region_entry` are the same concept — "where content enters" — so
 * pointing Start at a draft-region stage claims that region's entry
 * checkpoint: the stage moves to the front of the array (`statuses[0]`) and
 * becomes the draft region's sole entry.
 *
 * Dropping Start on a stage outside the draft region only reorders — the
 * target region's checkpoint is left alone, and `validateSequence` warns that
 * the flow entry sits outside the draft region.
 *
 * @param {Array}  stages Existing stages.
 * @param {string} key    Stage to promote to entry.
 * @return {Array} New stages array.
 */
export function setEntryStage( stages, key ) {
	const target = stages.find( ( s ) => s.key === key );
	if ( ! target ) {
		return stages;
	}
	const reordered =
		stages[ 0 ].key === key
			? stages
			: [ target, ...stages.filter( ( s ) => s.key !== key ) ];
	if ( stageRegion( target ) !== 'draft' ) {
		return reordered;
	}
	return setRegionEntry( reordered, key );
}

// ---------------------------------------------------------------------------
// Transition (edge) mutations.
// ---------------------------------------------------------------------------

/**
 * Add a transition from one stage to another. No-op (returns the same array) for
 * a self-loop or a duplicate target — neither of which the graph can represent.
 *
 * Where the target sits is not this function's business: a transition may cross
 * into any region, at any stage. Crossing is a runtime concern (the status write
 * and the region capability check), not an authoring constraint.
 *
 * @param {Array}  stages  Existing stages.
 * @param {string} from    Source stage key.
 * @param {string} to      Target stage key.
 * @param {Object} [extra] Extra transition fields to seed (e.g. label).
 * @return {Array} New stages array.
 */
export function addTransition( stages, from, to, extra = {} ) {
	if ( from === to ) {
		return stages;
	}
	const source = stages.find( ( s ) => s.key === from );
	const target = stages.find( ( s ) => s.key === to );
	if ( ! source || ! target ) {
		return stages;
	}
	if ( ( source.transitions || [] ).some( ( t ) => t.to === to ) ) {
		return stages;
	}
	/*
	 * No generated label is stored. An authored one is kept as given; otherwise
	 * `label` is left unset and the server derives "Move to {destination}" from
	 * the stage's current name every time it is read.
	 *
	 * Storing a generated label was the bug: a new stage defaults to "Stage N",
	 * so a transition drawn before the stage was named froze that default, and
	 * renaming the stage left the old name on the buttons writers click. A label
	 * that is never stored cannot go stale.
	 */
	const transition = { ...extra, to };

	if ( extra.label !== undefined ) {
		transition.label = extra.label;
	}

	return stages.map( ( stage ) =>
		stage.key === from
			? {
					...stage,
					transitions: [ ...( stage.transitions || [] ), transition ],
			  }
			: stage
	);
}

/**
 * Repoint an existing transition to a new target, preserving all its other
 * fields. No-op for a self-loop, when the new target is not a stage, or when the
 * source already has a transition to it.
 *
 * @param {Array}  stages Existing stages.
 * @param {string} from   Source stage key.
 * @param {string} oldTo  Current target key.
 * @param {string} newTo  New target key.
 * @return {Array} New stages array.
 */
/**
 * Whether `rewireTransition` would repoint the transition — its guard, split
 * out so a caller can ask the question without paying for the rebuild it would
 * otherwise have to throw away. `rewireTransition` gates on this rather than
 * restating it, so asking and doing cannot drift apart.
 *
 * @param {Array}  stages Existing stages.
 * @param {string} from   Source stage key.
 * @param {string} oldTo  Current target key.
 * @param {string} newTo  New target key.
 * @return {boolean} True when the repoint would happen.
 */
function canRewireTransition( stages, from, oldTo, newTo ) {
	if ( from === newTo || oldTo === newTo ) {
		return false;
	}
	const source = stages.find( ( s ) => s.key === from );
	if ( ! source || ! stages.some( ( s ) => s.key === newTo ) ) {
		return false;
	}
	return ! ( source.transitions || [] ).some( ( t ) => t.to === newTo );
}

export function rewireTransition( stages, from, oldTo, newTo ) {
	if ( ! canRewireTransition( stages, from, oldTo, newTo ) ) {
		return stages;
	}
	return stages.map( ( stage ) =>
		stage.key === from
			? {
					...stage,
					transitions: ( stage.transitions || [] ).map( ( t ) =>
						t.to === oldTo ? { ...t, to: newTo } : t
					),
			  }
			: stage
	);
}

/**
 * Merge changes into a transition.
 *
 * @param {Array}  stages  Existing stages.
 * @param {string} from    Source stage key.
 * @param {string} to      Target stage key.
 * @param {Object} changes Partial transition fields.
 * @return {Array} New stages array.
 */
export function updateTransition( stages, from, to, changes ) {
	return stages.map( ( stage ) =>
		stage.key === from
			? {
					...stage,
					transitions: ( stage.transitions || [] ).map( ( t ) =>
						t.to === to ? { ...t, ...changes } : t
					),
			  }
			: stage
	);
}

/**
 * Remove a transition.
 *
 * @param {Array}  stages Existing stages.
 * @param {string} from   Source stage key.
 * @param {string} to     Target stage key.
 * @return {Array} New stages array.
 */
export function removeTransition( stages, from, to ) {
	return stages.map( ( stage ) =>
		stage.key === from
			? {
					...stage,
					transitions: ( stage.transitions || [] ).filter(
						( t ) => t.to !== to
					),
			  }
			: stage
	);
}

/**
 * Look up a single transition object.
 *
 * @param {Array}  stages Stage objects.
 * @param {string} from   Source stage key.
 * @param {string} to     Target stage key.
 * @return {Object|null} The transition, or null.
 */
export function findTransition( stages, from, to ) {
	const stage = stages.find( ( s ) => s.key === from );
	if ( ! stage ) {
		return null;
	}
	return ( stage.transitions || [] ).find( ( t ) => t.to === to ) || null;
}

// ---------------------------------------------------------------------------
// Agent (AI stage) mutations.
//
// An AI stage's exits are its agent's outcomes: `agent.routing` maps each of
// `AGENT_OUTCOMES` to a destination stage, and the runtime moves the post along
// the stage's transition to it. The two are kept in lockstep here — wiring an
// outcome creates the transition it travels on, and clearing one takes the
// transition with it unless another outcome still needs it — so what the canvas
// draws is exactly what the runtime will do.
// ---------------------------------------------------------------------------

/**
 * Set (or clear) the agent that owns a stage.
 *
 * Picking an ability is what makes a stage AI-owned; clearing it drops the whole
 * `agent` object, routing included. The stage's transitions are left alone —
 * they stay as ordinary transitions the stage can still be re-wired from.
 *
 * @param {Array}  stages    Existing stages.
 * @param {string} key       Stage key.
 * @param {string} abilityId Agent ability id, or '' to clear.
 * @return {Array} New stages array.
 */
export function setStageAgent( stages, key, abilityId ) {
	const stage = stages.find( ( s ) => s.key === key );
	if ( ! stage ) {
		return stages;
	}
	if ( ! abilityId ) {
		if ( ! stage.agent ) {
			return stages;
		}
		return stages.map( ( s ) => {
			if ( s.key !== key ) {
				return s;
			}
			const { agent: _drop, ...rest } = s;
			return rest;
		} );
	}
	return updateStage( stages, key, {
		agent: {
			...( stage.agent || {} ),
			ability_id: abilityId,
			routing: stage.agent?.routing || {},
		},
	} );
}

/**
 * Merge changes into a stage's `agent.routing`. An `undefined` value removes the
 * outcome. No-op on a stage with no agent.
 *
 * @param {Array}  stages  Existing stages.
 * @param {string} key     Stage key.
 * @param {Object} changes Partial outcome → destination map.
 * @return {Array} New stages array.
 */
function setRouting( stages, key, changes ) {
	const stage = stages.find( ( s ) => s.key === key );
	if ( ! stage?.agent ) {
		return stages;
	}
	const routing = { ...( stage.agent.routing || {} ) };
	Object.entries( changes ).forEach( ( [ outcome, target ] ) => {
		if ( target === undefined ) {
			delete routing[ outcome ];
		} else {
			routing[ outcome ] = target;
		}
	} );
	return updateStage( stages, key, {
		agent: { ...stage.agent, routing },
	} );
}

/**
 * Whether a transition out of a stage is disabled — present and configured, but
 * unusable while the stage stands.
 *
 * An agent owns the stage it runs on: it moves the post out along one of its
 * outcome routes, so nothing else gets to. Every other transition the stage
 * holds is therefore inert — it is not offered to anyone in the post editor, and
 * the canvas draws it greyed out.
 *
 * Derived rather than stored. A `disabled` field written onto the transition
 * would be a second source of truth for something `agent.ability_id` already
 * answers, and would go stale the moment the agent is cleared or a route moves.
 * Nothing is ever deleted for this: clearing the agent brings every transition
 * back, configuration intact.
 *
 * @param {Object} stage     The stage the transition leaves.
 * @param {string} targetKey The transition's target stage key.
 * @return {boolean} True when the transition cannot be used.
 */
export function isTransitionDisabled( stage, targetKey ) {
	// Not the same question as "is the list empty". A stage with no agent has
	// no outcomes at all, and its transitions are the ordinary usable kind —
	// only an agent-owned stage disables what none of its outcomes claims.
	if ( ! isAgentStage( stage ) ) {
		return false;
	}
	return outcomesRoutedTo( stage, targetKey ).length === 0;
}

/**
 * Which of an agent's outcomes travel the stage's transition to a target.
 *
 * More than one is the normal, supported arrangement — pass and fail can both
 * lead to Review — and it is also the one the canvas used to draw as two
 * independently configurable transitions. A stage holds at most one transition
 * per target (a server invariant: two copies disagree about which governs a
 * permission check, and `Sequence::normalize_stages` rejects the second), so
 * every outcome named here shares one record and therefore one set of required
 * tools, notifications and assignment. Whoever draws or edits that record asks
 * this to find out who else is standing on it.
 *
 * @param {Object} stage     The stage the transition leaves.
 * @param {string} targetKey The transition's target stage key.
 * @return {Array} Outcome keys in `AGENT_OUTCOMES` order; empty for a stage
 *                 with no agent, or a target no outcome routes to.
 */
export function outcomesRoutedTo( stage, targetKey ) {
	if ( ! isAgentStage( stage ) ) {
		return [];
	}
	const routing = stage.agent.routing || {};
	return AGENT_OUTCOMES.filter(
		( outcome ) => routing[ outcome ] === targetKey
	);
}

/**
 * Point one of a stage agent's outcomes at a destination stage — what dragging
 * from an outcome handle onto another stage does.
 *
 * The transition the previous destination used is left where it is: it becomes a
 * disabled transition (see `isTransitionDisabled`), so re-routing an outcome
 * never destroys the roles, tools, or notifications someone configured on it.
 *
 * @param {Array}  stages  Existing stages.
 * @param {string} from    AI stage key.
 * @param {string} outcome Outcome to route (`pass` / `fail` / `error`).
 * @param {string} to      Destination stage key.
 * @param {Object} [extra] Extra transition fields to seed, when the transition
 *                         has to be created.
 * @return {Array} New stages array — unchanged for an invalid route.
 */
/**
 * Whether `routeOutcome` would move the route — its guard, split out for the
 * same reason `canRewireTransition` is: the canvas asks this on every pointer
 * frame while an outcome edge is being dragged, and building a stages tree to
 * answer it is the wrong price for a boolean.
 *
 * @param {Array}  stages  Existing stages.
 * @param {string} from    AI stage key.
 * @param {string} outcome Outcome to route (`pass` / `fail` / `error`).
 * @param {string} to      Destination stage key.
 * @return {boolean} True when the route would move.
 */
function canRouteOutcome( stages, from, outcome, to ) {
	if ( from === to || ! isAgentOutcome( outcome ) ) {
		return false;
	}
	const source = stages.find( ( s ) => s.key === from );
	if ( ! source || ! isAgentStage( source ) ) {
		return false;
	}
	if ( ! stages.some( ( s ) => s.key === to ) ) {
		return false;
	}
	return ( source.agent.routing || {} )[ outcome ] !== to;
}

export function routeOutcome( stages, from, outcome, to, extra = {} ) {
	if ( ! canRouteOutcome( stages, from, outcome, to ) ) {
		return stages;
	}
	// The route travels on a transition, so wiring an outcome creates the one it
	// will use when the stage doesn't already have it (a no-op if it does).
	return setRouting( addTransition( stages, from, to, extra ), from, {
		[ outcome ]: to,
	} );
}

/**
 * Clear one of a stage agent's outcomes — what deleting an outcome edge does.
 *
 * The transition stays: un-routing an outcome disables the edge rather than
 * removing it, so the destination and its configuration are still there if the
 * outcome is re-pointed at it or the agent is taken off the stage. Deleting the
 * transition itself is a separate, explicit gesture on the disabled edge.
 *
 * @param {Array}  stages  Existing stages.
 * @param {string} from    AI stage key.
 * @param {string} outcome Outcome to clear.
 * @return {Array} New stages array.
 */
export function clearOutcome( stages, from, outcome ) {
	const stage = stages.find( ( s ) => s.key === from );
	if ( ! stage || ! isAgentStage( stage ) || ! isAgentOutcome( outcome ) ) {
		return stages;
	}
	if ( ! ( stage.agent.routing || {} )[ outcome ] ) {
		return stages;
	}
	return setRouting( stages, from, { [ outcome ]: undefined } );
}

// ---------------------------------------------------------------------------
// Composite mutations — the canvas "add stage" affordances.
// ---------------------------------------------------------------------------

/**
 * Add a new stage and connect the given node to it (`source → new`).
 *
 * Start is not a stage and holds no transitions, so flowing out of it means the
 * same thing a `Start → stage` connection means: the new stage becomes the flow
 * entry (see `connectEdge`).
 *
 * The gesture is a *connection* that happens to need a stage on the end of it, so
 * a connection the model refuses is a refused gesture: nothing is added. Creating
 * the stage anyway would leave an unreachable orphan on the canvas that no post
 * could ever get to. `isValidConnection` cannot catch this, because an
 * empty-canvas drop has no target node for React Flow to ask about.
 *
 * @param {Array}   stages            Existing stages.
 * @param {string}  sourceKey         Node the new stage flows out of (stage key or `START_ID`).
 * @param {Object}  [options]         Creation options.
 * @param {string}  [options.status]  Status region the new stage lands in — the
 *                                    group the connection was dropped inside.
 * @param {?string} [options.outcome] Agent outcome the drag started from, when
 *                                    the source is an AI stage — the new stage
 *                                    becomes that outcome's destination.
 * @return {{ stages: Array, key: ?string }} New stages array and the new key —
 *                                    the array back unchanged and a null key when
 *                                    the connection was refused.
 */
export function addStageFromNode( stages, sourceKey, options = {} ) {
	const { outcome = null, ...creation } = options;
	const { stages: withStage, key } = addStage( stages, creation );
	if ( sourceKey === START_ID ) {
		return { stages: setEntryStage( withStage, key ), key };
	}
	const connected = isAgentOutcome( outcome )
		? routeOutcome( withStage, sourceKey, outcome, key )
		: addTransition( withStage, sourceKey, key );
	// Asked of the result rather than pre-checked, so this stays true however the
	// primitives grow: `addTransition` and `routeOutcome` both refuse by returning
	// the array unchanged, which is indistinguishable from success without looking
	// for the edge that was supposed to appear.
	if ( ! findTransition( connected, sourceKey, key ) ) {
		return { stages, key: null };
	}
	return { stages: connected, key };
}

/**
 * Insert a new stage in the middle of an edge, splitting `from → to` into
 * `from → new → to`. The original transition's configuration rides along on the
 * first hop (`from → new`); the second hop (`new → to`) is a fresh basic
 * transition.
 *
 * On an outcome edge only that outcome is re-pointed at the new stage; any other
 * outcome sharing the old destination keeps going straight there.
 *
 * The new stage joins the source's region: an insert is a step added to an
 * existing run of work, not a status change, so it shouldn't silently move the
 * post's `post_status` boundary from where the author put it.
 *
 * @param {Array}   stages            Existing stages.
 * @param {string}  from              Source stage key of the edge.
 * @param {string}  to                Target stage key of the edge.
 * @param {Object}  [options]         Insert options.
 * @param {?string} [options.outcome] Agent outcome the edge carries, if any.
 * @return {{ stages: Array, key: string }} New stages array and the new key.
 */
export function insertStageOnEdge( stages, from, to, options = {} ) {
	const { outcome = null } = options;
	const source = stages.find( ( s ) => s.key === from );
	const { stages: withStage, key } = addStage( stages, {
		status: source ? stageRegion( source ) : DEFAULT_REGION,
	} );
	if ( isAgentOutcome( outcome ) ) {
		// The original transition's configuration rides along on the first hop,
		// the same way `rewireTransition` carries it for a plain edge — its
		// label is left to be regenerated for the new destination.
		const existing = findTransition( withStage, from, to );
		const { to: _drop, label: _label, ...fields } = existing || {};
		const rerouted = routeOutcome( withStage, from, outcome, key, fields );
		return { stages: addTransition( rerouted, key, to ), key };
	}
	const rewired = rewireTransition( withStage, from, to, key );
	return { stages: addTransition( rewired, key, to ), key };
}

// ---------------------------------------------------------------------------
// Edge gestures — the semantics behind the canvas connect / reconnect /
// delete-edge handlers. Kept here (pure) so the Start / End special cases are
// unit-testable without React Flow.
// ---------------------------------------------------------------------------

/**
 * Apply a new connection drawn on the canvas.
 *
 * A drag off an outcome handle routes that outcome; otherwise Start → stage
 * re-assigns the flow entry (`statuses[0]`), stage → End marks the source stage
 * terminal, and stage → stage adds a transition.
 *
 * @param {Array}   stages         Existing stages.
 * @param {string}  from           Source node id (stage key or `START_ID`).
 * @param {string}  to             Target node id (stage key or `END_ID`).
 * @param {?string} [sourceHandle] Handle the drag started from — an agent
 *                                 outcome, or null for a plain connection.
 * @return {{ stages: Array, selection: ?{ from: string, to: string, outcome: ?string } }}
 *         New stages array and the edge to select — `selection` is null when the
 *         gesture changed nothing.
 */
export function connectEdge( stages, from, to, sourceHandle = null ) {
	if ( isAgentOutcome( sourceHandle ) ) {
		const next = routeOutcome( stages, from, sourceHandle, to );
		return {
			stages: next,
			selection:
				next === stages ? null : { from, to, outcome: sourceHandle },
		};
	}
	if ( from === START_ID ) {
		return {
			stages: setEntryStage( stages, to ),
			selection: { from: START_ID, to },
		};
	}
	if ( to === END_ID ) {
		return {
			stages: updateStage( stages, from, { is_terminal: true } ),
			selection: { from, to: END_ID },
		};
	}
	// A refused connection (a self-loop, a duplicate target) selects nothing —
	// there is no edge to show options for.
	const next = addTransition( stages, from, to );
	return {
		stages: next,
		selection: next === stages ? null : { from, to },
	};
}

/**
 * Whether an edge-endpoint drag would actually move the endpoint.
 *
 * The question `reconnectEdge` answers by doing, asked without doing it. The
 * canvas needs it on every pointer frame to colour the lead line, and building
 * a whole stages tree per frame only to throw it away — two full `stages.map()`
 * passes rebuilding every stage object and its transitions — is the wrong price
 * for a boolean. It was also the wrong question: a truthy `selection` means
 * "there is an edge worth selecting", which is not the same as "the move the
 * anchor is depicting will happen".
 *
 * `reconnectEdge` gates on this rather than restating it, so what the author is
 * shown while dragging and what the release does cannot drift apart. Every
 * refusal is documented on `reconnectEdge`, whose branches this mirrors in
 * order.
 *
 * @param {Array}   stages    Existing stages.
 * @param {string}  oldFrom   Previous source node id.
 * @param {string}  oldTo     Previous target node id.
 * @param {string}  newFrom   New source node id.
 * @param {string}  newTo     New target node id.
 * @param {?string} [outcome] Agent outcome the dragged edge carries, if any.
 * @return {boolean} True when the drag has an effect to commit.
 */
export function canReconnect(
	stages,
	oldFrom,
	oldTo,
	newFrom,
	newTo,
	outcome = null
) {
	if ( isAgentOutcome( outcome ) ) {
		// An outcome belongs to the agent on its own stage: dragging the source
		// endpoint elsewhere would ask a different stage's agent to own the
		// route.
		return (
			newFrom === oldFrom &&
			canRouteOutcome( stages, oldFrom, outcome, newTo )
		);
	}
	if ( oldFrom === START_ID ) {
		// `setEntryStage` claims the entry only inside the draft region: asked
		// for a stage anywhere else it reorders and leaves the entry where it
		// was, so the Start edge would spring back to it. Asked of the result
		// rather than restated here, so the fallback `entryStageKey` applies to
		// data with no draft checkpoint stays one rule in one place. Both are
		// shallow array passes, and only the Start edge reaches this branch.
		return entryStageKey( setEntryStage( stages, newTo ) ) === newTo;
	}
	if ( newFrom === START_ID ) {
		// Only the Start edge itself moves the flow entry; see the docblock.
		// (Checked after the branch above, which is the Start edge's own move —
		// both ends read START_ID there.)
		return false;
	}
	if ( newTo === END_ID ) {
		const source = stages.find( ( s ) => s.key === newFrom );
		// Nothing for the endpoint to become when that stage already exits —
		// see the docblock.
		return Boolean( source ) && ! source.is_terminal;
	}
	if ( newFrom === oldFrom ) {
		return canRewireTransition( stages, oldFrom, oldTo, newTo );
	}
	// An AI stage leaves only by an outcome. Its three handles replace the drag
	// grip entirely (`StageNode`), so no connection drawn by hand can be a plain
	// one out of it — but a source endpoint dropped on the card can, and the
	// transition it would make is one no outcome claims: dead on arrival
	// (`isTransitionDisabled`), and taking the original with it.
	//
	// Asked here rather than in the canvas's `isValidConnection`, and only of a
	// source that actually moved: a transition already leaving an AI stage still
	// has a destination end the author can re-point, and a rule spelled in terms
	// of "the source is an AI stage" refuses that too.
	const arriving = stages.find( ( s ) => s.key === newFrom );
	if ( isAgentStage( arriving ) ) {
		return false;
	}
	// Both endpoints have to be real stages before the original is dropped:
	// removing first and having `addTransition` refuse an endpoint it cannot
	// find would delete the edge and put nothing back. A duplicate is refused
	// for the same reason.
	return (
		newFrom !== newTo &&
		Boolean( arriving ) &&
		stages.some( ( s ) => s.key === newTo ) &&
		! findTransition( stages, newFrom, newTo )
	);
}

/**
 * Whether an endpoint released on empty canvas would actually grow a stage.
 *
 * Delegates to the mutation rather than restating its rules: a Start endpoint
 * claims the flow entry only inside the draft band, and a stage grown off a
 * transition no outcome routes would be unreachable the moment it appeared —
 * both answers live in `reconnectEdgeToNewStage`, and a predicate that spelled
 * them out again is a second decision tree to keep in step. The canvas asks this
 * so the lead line only reads "create" where a release will create something.
 *
 * @param {Array}   stages            Existing stages.
 * @param {string}  from              Source node id of the edge being dragged.
 * @param {string}  to                The endpoint's current target node id.
 * @param {Object}  [options]         Creation options, as `reconnectEdgeToNewStage` takes them.
 * @param {string}  [options.status]  Status region the new stage would land in.
 * @param {?string} [options.outcome] Agent outcome the dragged edge carries.
 * @return {boolean} True when the release would grow a stage.
 */
export function canReconnectToNewStage( stages, from, to, options = {} ) {
	return null !== reconnectEdgeToNewStage( stages, from, to, options ).key;
}

/**
 * Apply an edge-endpoint drag (reconnect).
 *
 * - Moving the Start edge re-points the flow entry to the edge's new target; no
 *   transition is deleted. Only a draft-region stage can take it, that region's
 *   entry checkpoint *being* the flow entry, so a drop anywhere else is a no-op
 *   rather than a reorder the canvas would then draw springing back.
 * - Dragging some *other* edge's source endpoint onto Start is a no-op. Start
 *   has no transition to hand over, so the dragged edge would stay exactly
 *   where it is while the flow entry moved out from under it — a different
 *   gesture wearing a move's clothes. Reassigning the entry is the Start edge's
 *   own gesture, the same way an outcome's departure is fixed to its agent.
 * - Dragging a target endpoint onto End marks the source stage terminal and
 *   drops the original transition, so the endpoint moves to the exit rather
 *   than leaving the old edge behind — unless that stage already exits, where
 *   the gesture would only delete the transition and is a no-op instead.
 * - Same source, new target: the transition is repointed in place.
 * - New source: the transition's fields carry over to the new source — unless
 *   the new source already has a transition to the target, in which case the
 *   gesture is a no-op (removing first would destroy the original and
 *   `addTransition` would refuse the duplicate, creating nothing).
 * - An outcome edge only moves at its destination end: the outcome belongs to
 *   the agent on its own stage, so dragging the source endpoint elsewhere would
 *   be asking a different stage's agent to own the route. That gesture is a
 *   no-op. The route's configuration travels with it to the new destination,
 *   and so does the transition it travelled on — un-routing an outcome leaves
 *   its transition behind (`clearOutcome`), but a move is a move.
 *
 * @param {Array}   stages    Existing stages.
 * @param {string}  oldFrom   Previous source node id.
 * @param {string}  oldTo     Previous target node id.
 * @param {string}  newFrom   New source node id.
 * @param {string}  newTo     New target node id.
 * @param {?string} [outcome] Agent outcome the dragged edge carries, if any.
 * @return {{ stages: Array, selection: ?{ from: string, to: string, outcome: ?string } }}
 *         New stages array and the edge to select — `selection` is null for a
 *         no-op gesture (keep the current selection).
 */
export function reconnectEdge(
	stages,
	oldFrom,
	oldTo,
	newFrom,
	newTo,
	outcome = null
) {
	if ( ! canReconnect( stages, oldFrom, oldTo, newFrom, newTo, outcome ) ) {
		return { stages, selection: null };
	}
	if ( isAgentOutcome( outcome ) ) {
		// The route's configuration rides along to the new destination, the
		// same harvest `insertStageOnEdge` does when it re-points an outcome —
		// its label is left to be regenerated for the new destination. Without
		// it the route arrives on a bare transition and the roles, tools and
		// notifications the author set are silently gone.
		const existing = findTransition( stages, oldFrom, oldTo );
		const { to: _drop, label: _label, ...fields } = existing || {};
		// Whether that harvest actually landed: `addTransition` inside
		// `routeOutcome` keeps a transition the stage already had, fields and
		// all, rather than overwriting it.
		const copied = ! findTransition( stages, oldFrom, newTo );
		const routed = routeOutcome( stages, oldFrom, outcome, newTo, fields );
		// The endpoint MOVED, so the transition it travelled on moves with it.
		// `routeOutcome` only ever adds one and un-routing deliberately leaves
		// the old one in place (`clearOutcome`), so stopping here would leave
		// the stage holding two transitions carrying the same harvested
		// configuration — the same assignment slot declared twice, which
		// `validateSequence` blocks Save on and the write gate refuses with
		// `duplicate_assignment_key`. A gesture the canvas painted as valid
		// while it was held would make the sequence unsaveable.
		//
		// Left where it is when the harvest did not land (the new destination
		// kept its own configuration, so this transition still holds the only
		// copy of what was harvested) or when another outcome still travels it
		// (removing it would take that route's transition out from under it).
		const source = routed.find( ( s ) => s.key === oldFrom );
		const shared = Object.entries( source?.agent?.routing || {} ).some(
			( [ key, target ] ) => key !== outcome && target === oldTo
		);
		return {
			stages:
				copied && ! shared
					? removeTransition( routed, oldFrom, oldTo )
					: routed,
			selection: { from: oldFrom, to: newTo, outcome },
		};
	}
	if ( oldFrom === START_ID ) {
		return {
			stages: setEntryStage( stages, newTo ),
			selection: { from: START_ID, to: newTo },
		};
	}
	if ( newTo === END_ID ) {
		// A target-endpoint drag onto End converts the edge into the terminal
		// flag: mark the source terminal and drop the original transition so the
		// endpoint moves to the exit. (End edges are non-reconnectable, so newTo
		// can only reach End via a target drag, which keeps the source fixed —
		// newFrom === oldFrom — making oldFrom → oldTo the edge being moved.)
		const terminal = updateStage( stages, newFrom, { is_terminal: true } );
		return {
			stages: removeTransition( terminal, oldFrom, oldTo ),
			selection: { from: newFrom, to: END_ID },
		};
	}
	if ( newFrom === oldFrom ) {
		return {
			stages: rewireTransition( stages, oldFrom, oldTo, newTo ),
			selection: { from: oldFrom, to: newTo },
		};
	}
	const existing = findTransition( stages, oldFrom, oldTo );
	const { to: _drop, ...fields } = existing || {};
	const removed = removeTransition( stages, oldFrom, oldTo );
	return {
		stages: addTransition( removed, newFrom, newTo, fields ),
		selection: { from: newFrom, to: newTo },
	};
}

/**
 * Apply an edge-endpoint drag released on empty canvas: create the stage the
 * endpoint was reaching for, and land the endpoint on it.
 *
 * The two halves are *composed* rather than restated — a stage is added, then
 * `reconnectEdge` moves the endpoint onto it — so every rule about what moving
 * an endpoint means holds here by construction: the Start edge re-points the
 * flow entry onto the new stage, an outcome edge routes that outcome to it, and
 * a plain transition carries its fields across and leaves nothing behind.
 *
 * Only the *destination* endpoint can be released this way, which is why the new
 * stage is always the target (`from → new`). A stage grown at the other end
 * would have nothing flowing into it — the same reason `addStageFromNode` grows
 * one only out of a source.
 *
 * @param {Array}   stages            Existing stages.
 * @param {string}  from              Source node id of the edge being dragged.
 * @param {string}  to                The endpoint's current target node id.
 * @param {Object}  [options]         Creation options.
 * @param {string}  [options.status]  Status region the new stage lands in — the
 *                                    band the endpoint was released inside.
 * @param {?string} [options.outcome] Agent outcome the dragged edge carries.
 * @return {{ stages: Array, key: ?string }} New stages array and the new
 *         stage's key — the array back unchanged and a null key when the move
 *         was refused.
 */
export function reconnectEdgeToNewStage( stages, from, to, options = {} ) {
	const { outcome = null, ...creation } = options;
	const { stages: withStage, key } = addStage( stages, creation );
	const moved = reconnectEdge( withStage, from, to, from, key, outcome );
	// Asked of the result rather than pre-checked, the same way
	// `addStageFromNode` asks — and asked as "does something now reach the new
	// stage" rather than "did anything change", because a stage created for an
	// endpoint that then had nowhere to land would be an orphan no post could
	// reach. For the Start edge the thing reaching it is the flow entry rather
	// than a transition, which is a different question with the same shape.
	//
	// A disabled transition is not something that reaches: an AI stage's
	// unrouted edge is a path no content travels (`validateSequence` does not
	// walk them either), so a stage grown off one would be flagged unreachable
	// the moment it appeared.
	const source = moved.stages.find( ( s ) => s.key === from );
	const reached =
		from === START_ID
			? entryStageKey( moved.stages ) === key
			: Boolean( findTransition( moved.stages, from, key ) ) &&
			  ! isTransitionDisabled( source, key );
	if ( ! reached ) {
		return { stages, key: null };
	}
	return { stages: moved.stages, key };
}

/**
 * Apply an edge deletion.
 *
 * Removing an outcome edge un-routes that outcome (and drops its transition
 * unless another outcome still travels it); removing a stage → End edge clears
 * the stage's terminal flag; the Start edge is structural and cannot be deleted;
 * any other edge removes the transition.
 *
 * @param {Array}   stages    Existing stages.
 * @param {string}  from      Source node id.
 * @param {string}  to        Target node id.
 * @param {?string} [outcome] Agent outcome the edge carries, if any.
 * @return {Array} New stages array.
 */
export function disconnectEdge( stages, from, to, outcome = null ) {
	if ( isAgentOutcome( outcome ) ) {
		return clearOutcome( stages, from, outcome );
	}
	if ( to === END_ID ) {
		return updateStage( stages, from, { is_terminal: false } );
	}
	if ( from === START_ID ) {
		return stages;
	}
	return removeTransition( stages, from, to );
}

// ---------------------------------------------------------------------------
// Validation — mirrors the old SequenceEditor.handleSave rules and feeds both
// the Save guard (sequence-level errors) and the node warning variant
// (per-stage warnings).
// ---------------------------------------------------------------------------

/**
 * Normalize an assignment slot key the way the server normalizes it, so the two
 * sides agree on which keys are the same key.
 *
 * Slot keys and the gates pointing at them are stored through PHP's
 * `sanitize_key()` — lowercase, then everything outside `[a-z0-9_-]` stripped —
 * and `SequencesController::validate_assignment_keys()` compares them after
 * that. Comparing the raw strings here would read a slot and a gate that differ
 * only in what sanitize_key strips as two different slots, and block a Save the
 * server would have accepted.
 *
 * @param {*} value Key as stored on the transition.
 * @return {string} The key as the server will compare it, empty when there is none.
 */
function normalizeSlotKey( value ) {
	if ( typeof value !== 'string' && typeof value !== 'number' ) {
		return '';
	}
	return String( value )
		.toLowerCase()
		.replace( /[^a-z0-9_-]/g, '' );
}

/**
 * The slot key a transition's assignment gate points at.
 *
 * `requires_assignment` is either `{ meta_key, match }` or the bare key as a
 * string — the shorthand `AssignmentManager::normalize_requirement()` accepts
 * and stored sequences still carry.
 *
 * @param {Object|string} requirement A transition's `requires_assignment`.
 * @return {string} The normalized key it names, empty when it names none.
 */
function gateSlotKey( requirement ) {
	return normalizeSlotKey(
		requirement && 'object' === typeof requirement
			? requirement.meta_key
			: requirement
	);
}

/**
 * Validate a sequence.
 *
 * @param {Object}  params                       Validation input.
 * @param {string}  params.name                  Sequence name.
 * @param {Array}   params.stages                Stage objects.
 * @param {boolean} [params.isPhase]             Phase sequence (skips
 *                                               terminal/key rules that only
 *                                               apply to editorial stages).
 * @param {Array}   [params.requiredTransitions] Phase-only. The hand-offs a
 *                                               phase sequence owes, as
 *                                               `{ from, to }` pairs, from
 *                                               `/sequences/options`. Empty
 *                                               until that read lands — which
 *                                               is also while the editor has no
 *                                               canvas to save from.
 * @param {Array}   [params.agents]              Stage-eligible agents from
 *                                               `/abilities?context=stage`,
 *                                               used to warn when a stage's
 *                                               agent cannot run.
 * @return {{ valid: boolean, errors: string[], warnings: Object }} Result.
 *         `errors` block Save; `warnings` is `{ stageKey: string[] }` for nodes.
 *         A rule the server would refuse the save for appears in both, so the
 *         author is stopped *and* shown which stage to open. `valid` is
 *         `errors.length === 0`, kept as part of this function's contract for
 *         callers that only need the yes/no — the editor is not one of them,
 *         since it gathers `errors` into the reasons it shows the author.
 */
export function validateSequence( {
	name,
	stages,
	isPhase = false,
	requiredTransitions = [],
	agents = [],
} ) {
	const errors = [];
	const warnings = {};

	const addWarning = ( key, message ) => {
		warnings[ key ] = warnings[ key ] || [];
		warnings[ key ].push( message );
	};

	// A rule the server hard-fails on, reported both ways: it blocks Save, and
	// it marks the stage holding the offending transition so the canvas says
	// which node to open. A warning alone would let the author press Save into a
	// 400 they cannot act on; an error alone would tell them what is wrong
	// without saying where.
	const addBlocker = ( key, message ) => {
		errors.push( message );
		addWarning( key || '', message );
	};

	if ( ! ( name || '' ).trim() ) {
		errors.push(
			__(
				'This sequence has no name. Click an empty part of the canvas and fill in Name in the Sequence panel.',
				'vip-workflows'
			)
		);
	}

	if ( ! stages || stages.length === 0 ) {
		errors.push(
			__(
				'This sequence has no stages, so there is nothing for a post to be in. Right-click the canvas to add one.',
				'vip-workflows'
			)
		);
		return { valid: errors.length === 0, errors, warnings };
	}

	const keys = new Set( stages.map( ( s ) => s.key ) );

	// Two stages sharing a key collapse to one status on save (and collide as
	// React Flow node ids), silently dropping the second stage's transitions.
	// Named rather than counted: "keys must be unique" leaves the author to find
	// the pair themselves, and the key is the one thing both stages have in
	// common — so it is what identifies them.
	const duplicateKeys = [
		...new Set(
			stages
				.map( ( s ) => s.key )
				.filter(
					( key, index, all ) => all.indexOf( key ) !== index && key
				)
		),
	];
	duplicateKeys.forEach( ( key ) => {
		addBlocker(
			key,
			sprintf(
				/* translators: %s: the stage key two stages share. */
				__(
					'Two stages share the key “%s”, so saving would collapse them into one and drop the second stage’s transitions. Open one of them and give it a key of its own.',
					'vip-workflows'
				),
				key
			)
		);
	} );

	// A phase sequence configures the hand-off between lifecycle phases, and
	// nothing else routes a post between them — so one missing a hand-off it
	// owes is not an incomplete drawing, it is a phase content cannot leave.
	// Which hand-offs those are is the server's answer (`required_phase_transitions`
	// from `/sequences/options`), the same source its write gate refuses on;
	// the editor used to keep its own pair of keys here, checked for presence
	// only, so a sequence holding both phases with nothing joining them passed —
	// the "no way out" check below is a warning on a phase sequence, not a
	// blocker.
	const required = isPhase ? requiredTransitions : [];

	// The phases those hand-offs are between, gathered before any of them is
	// reported: one phase can be an endpoint of several, and naming it once per
	// hand-off would say the same thing three times.
	const missingPhases = new Set(
		required
			.flatMap( ( { from, to } ) => [ from, to ] )
			.filter( ( key ) => ! keys.has( key ) )
	);

	for ( const key of missingPhases ) {
		errors.push(
			sprintf(
				/* translators: %s: required phase key */
				__(
					'Phase sequences must include the “%s” phase.',
					'vip-workflows'
				),
				key
			)
		);
	}

	for ( const { from, to } of required ) {
		// A hand-off between phases that are not both there is already reported
		// as the missing phase; saying it a second way adds nothing to fix.
		if ( missingPhases.has( from ) || missingPhases.has( to ) ) {
			continue;
		}

		const source = stages.find( ( s ) => s.key === from );

		if ( ! ( source.transitions || [] ).some( ( t ) => t.to === to ) ) {
			addBlocker(
				from,
				sprintf(
					/* translators: 1: source phase key, 2: target phase key */
					__(
						'Phase sequences must hand off from “%1$s” to “%2$s”. Drag from this phase to draw it.',
						'vip-workflows'
					),
					from,
					to
				)
			);
		}
	}

	/*
	 * An AI stage whose agent cannot run is a warning, never an error: it must
	 * not block Save, because a sequence is commonly designed before its
	 * credentials are wired. It does need to be visible on the node, since a post
	 * entering such a stage errors on arrival — StageAgentRunner treats an
	 * unavailable agent as an errored run, which takes the stage's on-error route
	 * when one is set and stops in place when it is not — and a sequence can go
	 * stale long after it was saved when a key is revoked or an extension
	 * deactivated.
	 */
	/*
	 * An empty list means "not known yet", not "nothing is available": the editor
	 * fetches agents asynchronously and falls back to `[]` when the request
	 * fails. Treating that as absence would flag every AI stage as broken on
	 * first paint, and permanently whenever the fetch errors.
	 */
	for ( const stage of agents.length > 0 ? stages : [] ) {
		const abilityId = stage.agent?.ability_id;

		if ( ! abilityId ) {
			continue;
		}

		const entry = agents.find( ( a ) => a.id === abilityId );

		if ( ! entry ) {
			addWarning(
				stage.key,
				sprintf(
					/* translators: %s: ability id of the agent the stage references. */
					__(
						'Agent “%s” is not available on this site; posts entering this stage will error — following the on-error route if one is set, stopping here otherwise.',
						'vip-workflows'
					),
					abilityId
				)
			);
			continue;
		}

		if ( false === entry.available ) {
			addWarning(
				stage.key,
				sprintf(
					/* translators: %s: agent name, e.g. "Copy Edit". */
					__(
						'Agent “%s” needs setup; until it is configured, posts entering this stage will error — following the on-error route if one is set, stopping here otherwise.',
						'vip-workflows'
					),
					entry.label
				)
			);
		}
	}

	// The stages content could enter and never leave, gathered as they are
	// reported so the terminal-stage blocker further down can name them: a
	// sequence with no end is nearly always a sequence whose last stage was
	// never joined to the End node, and those are the stages it would be.
	const deadEnds = [];

	for ( const stage of stages ) {
		// Each half named on its own, because the fix differs and so does what
		// breaks: a stage with no name is one writers meet as a blank on the
		// board, a stage with no key is one the server refuses to store.
		if ( ! stage.key && ! stage.label ) {
			addBlocker(
				'',
				__(
					'A stage on the canvas has neither a name nor a key. Open it and fill in both — the name is what writers see, the key is what the stage is stored under.',
					'vip-workflows'
				)
			);
		} else if ( ! stage.label ) {
			addBlocker(
				stage.key,
				sprintf(
					/* translators: %s: the stage's key, e.g. "in_review". */
					__(
						'The stage keyed “%s” has no name. Open it and fill in Name — it is what writers see on the board and on the buttons that move a post.',
						'vip-workflows'
					),
					stage.key
				)
			);
		} else if ( ! stage.key ) {
			addBlocker(
				'',
				sprintf(
					/* translators: %s: the stage's name, e.g. "In Review". */
					__(
						'Stage “%s” has no key, so there is nothing to store it under. Open it and fill in Key.',
						'vip-workflows'
					),
					stage.label
				)
			);
		}

		// A non-terminal stage with no *usable* way out traps content. On an AI
		// stage that means its agent routes: the transitions no outcome claims
		// are disabled, so counting them here would call a trap a way out.
		const outgoing = ( stage.transitions || [] ).filter(
			( t ) => keys.has( t.to ) && ! isTransitionDisabled( stage, t.to )
		);
		const isTerminal = ! isPhase && Boolean( stage.is_terminal );
		if ( ! isTerminal && outgoing.length === 0 ) {
			deadEnds.push( stage );
			addWarning(
				stage.key,
				isAgentStage( stage )
					? __(
							'The agent has no outcome routed anywhere and the stage is not marked final — content cannot leave it. Drag from the stage’s outcome handles to route it.',
							'vip-workflows'
					  )
					: __(
							'Stage has no outgoing transition and is not marked final — content cannot leave it.',
							'vip-workflows'
					  )
			);
		}

		// AI stage routing. The runtime reads `agent.routing` to pick the exit
		// after a run, so a route with nowhere to land strands the post in this
		// stage. Every outcome is optional, error included: an errored run with
		// no error route deliberately fails in place, where the editor offers
		// the way back — that is a designed state, not a warning.
		if ( ! isPhase && isAgentStage( stage ) ) {
			const routing = stage.agent.routing || {};
			for ( const outcome of AGENT_OUTCOMES ) {
				const target = routing[ outcome ];
				if ( ! target ) {
					continue;
				}
				if ( ! keys.has( target ) ) {
					addWarning(
						stage.key,
						sprintf(
							/* translators: 1: agent outcome label, 2: missing target stage key */
							__(
								'The agent’s “%1$s” route points to a stage that doesn’t exist (%2$s).',
								'vip-workflows'
							),
							agentOutcomeLabel( outcome ),
							target
						)
					);
				} else if (
					! ( stage.transitions || [] ).some(
						( t ) => t.to === target
					)
				) {
					addWarning(
						stage.key,
						sprintf(
							/* translators: 1: agent outcome label, 2: target stage key */
							__(
								'The agent’s “%1$s” route has no transition to travel on (%2$s). Re-drag the handle onto that stage.',
								'vip-workflows'
							),
							agentOutcomeLabel( outcome ),
							target
						)
					);
				}
			}
		}

		// Dangling transition target — names the transition and the missing
		// stage so the warning is actionable (the edge isn't drawn, so this is
		// the only place it surfaces).
		( stage.transitions || [] ).forEach( ( t ) => {
			if ( ! keys.has( t.to ) ) {
				addWarning(
					stage.key,
					sprintf(
						/* translators: 1: transition button label, 2: missing target stage key */
						__(
							'The “%1$s” transition points to a stage that doesn’t exist (%2$s). Reconnect or remove it.',
							'vip-workflows'
						),
						t.label || t.to,
						t.to
					)
				);
			}
		} );
	}

	/*
	 * Assignment slots and the gates that point at them.
	 *
	 * A transition whose input is an assignment declares a slot; taking it
	 * writes the assignment into that slot. A transition's `requires_assignment`
	 * is a pointer at one of those slots, and refuses the transition to anyone
	 * the assignment does not name. Three things break that pair, and the server
	 * refuses the save for each one — `invalid_assignment_key`,
	 * `duplicate_assignment_key`, `invalid_requires_assignment` /
	 * `unknown_assignment_key`. So all three block Save here rather than warn:
	 * every one of them is a 400 waiting to happen, and the editor reaches two
	 * of them on its own — flipping "Restrict to an assignee" on opens a gate
	 * with no key yet, and picking the Assignment input type opens a slot with
	 * no key yet.
	 *
	 * Not gated on `isPhase`: the server validates this wiring on every sequence
	 * type, and a phase sequence can carry it in from an import even though the
	 * phase inspector doesn't offer the controls.
	 *
	 * Two passes, the way the server walks it — every slot the sequence declares
	 * first, then every gate against that set — because a gate may point at a
	 * slot declared by a transition on any stage, not just its own.
	 */
	const declaredSlots = new Set();

	for ( const stage of stages ) {
		for ( const transition of stage.transitions || [] ) {
			// A transition captures a list, of which at most one entry assigns
			// work — a cap the server refuses a save for breaking, and one the
			// add control in the inspector will not let an author reach. Walked
			// as a list all the same: an assignment need not lead the list, and a
			// config imported past the editor can carry two.
			for ( const input of transition.inputs || [] ) {
				if ( input?.type !== 'assignment' ) {
					continue;
				}

				// Named the way the dangling-target rule above names one: the button
				// label the author typed, falling back to the destination key, so
				// the message points at a transition they can find.
				const transitionName = transition.label || transition.to;
				const key = normalizeSlotKey( input.meta_key );

				if ( '' === key ) {
					addBlocker(
						stage.key,
						sprintf(
							/* translators: %s: transition button label */
							__(
								'The “%s” transition assigns work but names no assignment key, so there is nowhere to record the assignment. Fill in its Assignment key.',
								'vip-workflows'
							),
							transitionName
						)
					);
					continue;
				}

				if ( declaredSlots.has( key ) ) {
					addBlocker(
						stage.key,
						sprintf(
							/* translators: 1: transition button label, 2: assignment key */
							__(
								'The “%1$s” transition assigns to “%2$s”, a key another transition already assigns — the second assignment would overwrite the first. Give this one a key of its own.',
								'vip-workflows'
							),
							transitionName,
							key
						)
					);
					continue;
				}

				declaredSlots.add( key );
			}
		}
	}

	for ( const stage of stages ) {
		for ( const transition of stage.transitions || [] ) {
			if ( ! transition.requires_assignment ) {
				continue;
			}

			const transitionName = transition.label || transition.to;
			const key = gateSlotKey( transition.requires_assignment );

			if ( '' === key ) {
				addBlocker(
					stage.key,
					sprintf(
						/* translators: %s: transition button label */
						__(
							'The “%s” transition is restricted to an assignee but names no assignment key, so nobody could take it. Name the slot it should read, or turn the restriction off.',
							'vip-workflows'
						),
						transitionName
					)
				);
				continue;
			}

			if ( ! declaredSlots.has( key ) ) {
				addBlocker(
					stage.key,
					sprintf(
						/* translators: 1: transition button label, 2: assignment key */
						__(
							'The “%1$s” transition is restricted to assignment key “%2$s”, which no transition assigns — nobody could take it. Point it at a key another transition assigns.',
							'vip-workflows'
						),
						transitionName,
						key
					)
				);
			}
		}
	}

	// Nothing ends the flow. The old wording ("at least one stage must be marked
	// as final") named the rule and left the author to work out which stage it
	// was about and how one gets marked — the two things they actually need. So
	// the stages content would pile up in are named, since those are the
	// candidates, and the gesture that ends the flow is spelled out.
	if ( ! isPhase && ! stages.some( ( s ) => s.is_terminal ) ) {
		errors.push(
			deadEnds.length > 0
				? sprintf(
						/* translators: %s: comma-separated stage names. */
						_n(
							'Nothing ends this sequence: %s has no way out and is not marked as the end, so a post arriving there would be stuck. Drag from it to the End node to finish the flow there.',
							'Nothing ends this sequence: %s have no way out and none is marked as the end, so a post arriving at one would be stuck. Drag from whichever should finish the flow to the End node.',
							deadEnds.length,
							'vip-workflows'
						),
						deadEnds
							.map( ( s ) => {
								const stageName = s.label || s.key;

								return stageName
									? `“${ stageName }”`
									: __( 'an unnamed stage', 'vip-workflows' );
							} )
							.join( ', ' )
				  )
				: __(
						'Nothing ends this sequence: no stage is joined to the End node, so a post could travel it forever without finishing. Drag from the stage that should finish the flow to the End node.',
						'vip-workflows'
				  )
		);
	}

	if ( ! isPhase ) {
		// Region-entry checkpoints. Every region holding stages needs exactly
		// one: it is where a post lands when something outside the workflow puts
		// it in that status, and without it there is no answer to "and then what
		// stage is it in". Both halves block Save — none, because the runtime has
		// nowhere to seat the post; more than one, because the server rejects it.
		//
		// A region with no stages is not checked. Those only exist as an empty
		// group someone added on the canvas, and nothing is saved for them.
		const membersByRegion = new Map();
		stages.forEach( ( stage ) => {
			const region = stageRegion( stage );
			membersByRegion.set( region, [
				...( membersByRegion.get( region ) || [] ),
				stage,
			] );
		} );
		membersByRegion.forEach( ( members, region ) => {
			const entries = members.filter( ( s ) =>
				Boolean( s.region_entry )
			);
			if ( entries.length === 0 ) {
				errors.push(
					sprintf(
						/* translators: %s: status region name (e.g. Draft, Published) */
						__(
							'The “%s” status group has no entry checkpoint. Drag one of its stages onto the group’s top edge to set where posts entering that status land.',
							'vip-workflows'
						),
						regionLabel( region )
					)
				);
				return;
			}
			if ( entries.length > 1 ) {
				errors.push(
					sprintf(
						/* translators: 1: status region name, 2: comma-separated stage labels */
						__(
							'The “%1$s” status group has more than one entry checkpoint: %2$s. Keep exactly one.',
							'vip-workflows'
						),
						regionLabel( region ),
						entries.map( ( s ) => s.label || s.key ).join( ', ' )
					)
				);
			}
		} );

		// Stages nothing can reach. A post gets into a stage exactly two ways:
		// it travels there along a transition, or something outside the
		// workflow puts it in a status and it lands on that region's
		// checkpoint. A stage with neither is dead configuration — it can be
		// labelled, coloured, given an agent, and no post will ever be in it.
		//
		// Walked from those two kinds of root rather than counted as inbound
		// edges, so a pair of stages that only point at each other is caught
		// too. Disabled transitions are not walked, for the same reason the
		// no-way-out check above does not count them: an AI stage's unrouted
		// transition is not a path content travels.
		//
		// A warning, not an error, because the canvas is not the only author.
		// `addStageFromNode` no longer creates an orphan, but the REST controller
		// and the create-sequence ability both accept a config whose stages carry
		// no transitions at all, and Sequence::prepare_config_for_write permits
		// it — reachability is not one of the gate's rules. Blocking Save here
		// would mean the editor refuses to store what the server accepts, so
		// opening such a sequence to change one colour would strand the author
		// behind an unrelated stage they never added. The node still says so.
		const reachable = new Set();
		const pending = [];
		const reach = ( key ) => {
			if ( keys.has( key ) && ! reachable.has( key ) ) {
				reachable.add( key );
				pending.push( key );
			}
		};

		reach( stages[ 0 ].key );
		stages.forEach( ( stage ) => {
			if ( stage.region_entry ) {
				reach( stage.key );
			}
		} );

		while ( pending.length > 0 ) {
			const key = pending.pop();
			const from = stages.find( ( s ) => s.key === key );
			( from.transitions || [] ).forEach( ( t ) => {
				if ( ! isTransitionDisabled( from, t.to ) ) {
					reach( t.to );
				}
			} );
		}

		stages
			.filter( ( stage ) => ! reachable.has( stage.key ) )
			.forEach( ( stage ) => {
				addWarning(
					stage.key,
					__(
						'No transition leads here and this is not its status group’s entry checkpoint, so no post can ever reach this stage.',
						'vip-workflows'
					)
				);
			} );

		// The flow entry (statuses[0], the Start edge) should live in the
		// draft region — new content is created as a draft, so an entry
		// outside it never receives new posts.
		if ( stageRegion( stages[ 0 ] ) !== 'draft' ) {
			addWarning(
				stages[ 0 ].key,
				__(
					'The flow entry is outside the “draft” status region — new content starts as a draft and will land at the draft region’s entry stage instead.',
					'vip-workflows'
				)
			);
		}
	}

	return { valid: errors.length === 0, errors, warnings };
}

/**
 * Move one item of an authored list to another's position.
 *
 * Order is the stored array — it is already the source of truth and already
 * round-trips through this model, so reordering needs no new field and no
 * migration. Used for a stage's outgoing transitions and for the inputs a
 * transition captures: both are lists whose order an author sets by dragging and
 * a reader meets in that order.
 *
 * By position, not by identity. `from->to` uniquely identifies an edge in every
 * sequence written under the one-transition-per-target rule, but a stage stored
 * before it can still hold two transitions to the same place — and that is
 * exactly the stage an author is asked to look at before the repair collapses
 * one. The same goes for two capture inputs that have been given the same key.
 * Resolving by identity would find the first of the pair, so dragging the second
 * would move the first; positions cannot be ambiguous.
 *
 * Returns the original array reference, not a copy, when nothing moves. The
 * caller compares by identity to decide whether the sequence became dirty, so a
 * drag the author abandoned must not look like an edit.
 *
 * @param {Array}  items An authored list, in its stored order.
 * @param {number} from  Index of the item being moved.
 * @param {number} to    Index it was dropped on.
 * @return {Array} The reordered list, or the original array when unchanged.
 */
export function reorderList( items, from, to ) {
	const list = Array.isArray( items ) ? items : [];

	// An index outside the list means the drag referenced something no longer in
	// it. Reordering on a guess would silently rearrange the author's work.
	if (
		! Number.isInteger( from ) ||
		! Number.isInteger( to ) ||
		from < 0 ||
		to < 0 ||
		from >= list.length ||
		to >= list.length ||
		from === to
	) {
		return items;
	}

	const next = [ ...list ];
	const [ moved ] = next.splice( from, 1 );
	next.splice( to, 0, moved );

	return next;
}
