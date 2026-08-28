/**
 * SequenceGraphEditor — the node/edge sequence editor.
 *
 * Holds the `stages` array (the sequence's `statuses[]` for workflows, or
 * `phases[]` for phase sequences) plus selection and sequence-level state,
 * composing a full-bleed `GraphCanvas` with a docked inspector. One component
 * serves both sequence types via the `mode` prop; the differences (post types /
 * metadata vs fixed phases, full vs simplified transitions, save payload) are
 * localized to a few conditionals.
 *
 * **Saving keeps the author here.** It used to navigate back to the Sequences
 * list, and that navigation was quietly doing three other jobs: confirming the
 * save, clearing the busy button, and making a second save impossible before the
 * editor knew what the first one had created. Staying means each is done on
 * purpose — the button cycles through the plugin's shared save states, and the
 * canvas re-seats from the response, because the write gate normalizes what it
 * stores and an editor holding its own copy would send that copy back.
 *
 * **Nothing is lost on the way out.** The config is diffed against that last
 * response, so Save is offered only when there is something to write, and every
 * exit — Cancel, the browser's Back, leaving wp-admin — asks first while there
 * is something to lose.
 *
 * @package
 */

import {
	useState,
	useEffect,
	useMemo,
	useCallback,
	useRef,
} from '@wordpress/element';
import { Button, Spinner, Notice } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';

import AdminPage from '../AdminPage';
import { useConfirm } from '../../../common/use-confirm';
import { getSaveButtonLabel } from '../../utils/save-button-label';
import GraphCanvas from './GraphCanvas';
import Inspector from './Inspector';
import AddPostStatusModal from './AddPostStatusModal';
import {
	addStageFromNode,
	insertStageOnEdge,
	removeStage,
	updateStage,
	setRegionEntry,
	clearRegionEntry,
	setStageStatus,
	connectEdge,
	reconnectEdge,
	reconnectEdgeToNewStage,
	disconnectEdge,
	updateTransition,
	setStageAgent,
	findTransition,
	validateSequence,
	parseEdgeId,
	visibleRegions,
	edgeId,
	isAgentOutcome,
	isAgentStage,
	stageLabel,
	START_ID,
	END_ID,
} from './graph-model';
import { REGION_ORDER, stageRegion } from './regions';
import { paletteColorAt, snapToPalette } from '../../utils/stage-palette';

import '../../../common/outcome-tones.css';
import './SequenceGraphEditor.css';

/**
 * What the server's region repair changed, said out loud.
 *
 * Replaying a stored config through the write gate can cost the author a
 * transition: a stage may hold at most one per target, and a row written before
 * that rule can carry two, so the second goes and takes its label, roles,
 * required tools and notifications with it. Naming it is the whole reason the
 * repair reports at all — a change the author is never told about is the silent
 * reshaping this reporting exists to end.
 *
 * @param {Object} repair         The repair report.
 * @param {Array}  repair.dropped Transitions the repair could not keep.
 * @param {Array}  stages         Stages to read labels from (post-repair).
 * @return {string|null} The sentence to show, or null when nothing changed.
 */
function describeRepair( { dropped }, stages ) {
	if ( dropped.length === 0 ) {
		return null;
	}
	const label = ( key ) => stageLabel( stages, key );

	return sprintf(
		/* translators: 1: number of transitions, 2: comma-separated list of transitions, each "From → To". */
		_n(
			'%1$d transition was removed because the stage already had one to the same place, and its label, roles, required tools and notifications went with it: %2$s.',
			'%1$d transitions were removed because the stage already had ones to the same places, and their labels, roles, required tools and notifications went with them: %2$s.',
			dropped.length,
			'vip-workflows'
		),
		dropped.length,
		dropped
			.map( ( d ) => `${ label( d.from ) } → ${ label( d.to ) }` )
			.join( ', ' )
	);
}

/**
 * Bring every stage's color onto the palette.
 *
 * The picker offers seven named slots, but sequences written when it was a
 * freeform `<input type="color">` hold arbitrary hexes. Rather than teach the
 * picker a "custom" entry to park those in — which lets a stage sit off the
 * palette for as long as nobody re-picks it — each is moved to the slot nearest
 * it here, on the way into the editor.
 *
 * On the way *in* specifically: this runs before the baseline snapshot is
 * taken, so a sequence someone only opened is not reported as changed, and the
 * migration is written the next time they save something they meant to.
 *
 * @param {Array} stages Stages as the server sent them.
 * @return {Array} The same stages, every color on a palette slot.
 */
const onPalette = ( stages ) =>
	stages.map( ( stage, index ) => {
		const color = snapToPalette( stage.color, index );
		return color === stage.color ? stage : { ...stage, color };
	} );

/**
 * The sequence a new editor opens on: Draft → Published → End.
 *
 * A pair, not a single stage, because one stage is not a workflow — it is a
 * start with no finish, which the validator refuses to save and the canvas
 * flags twice over (nothing leaves Draft, nothing ends the flow). An author who
 * has done nothing wrong but click "Add new" met both. So the smallest thing
 * that is actually a workflow is what they get: content is drafted, it is
 * published, and there it ends. It saves as it stands, and it reads as a
 * sequence rather than a fragment.
 *
 * `Published` also puts the publish region on the canvas without the author
 * having to find the menu that adds one — the region a sequence is least
 * likely to be able to do without.
 *
 * The transition carries no label: `Move to Published` is derived from the
 * stage's current name on every read, so a stage renamed later renames its
 * buttons too (see `addTransition` on why a generated label is never stored).
 *
 * @return {Array} The stages a new sequence starts with.
 */
const newWorkflowStages = () => [
	{
		key: 'draft',
		label: 'Draft',
		color: paletteColorAt( 0 ),
		is_terminal: false,
		status: 'draft',
		// Each stage is the only one in its region, so each is that region's
		// entry checkpoint — where posts land when core changes their status
		// into it. Every used region needs exactly one, and the write gate
		// refuses a config that gets that wrong.
		region_entry: true,
		transitions: [ { to: 'publish' } ],
	},
	{
		key: 'publish',
		label: 'Published',
		color: paletteColorAt( 1 ),
		// The edge to the End node, stored: this is where the flow finishes.
		is_terminal: true,
		status: 'publish',
		region_entry: true,
		transitions: [],
	},
];

/**
 * What the editor holds before a sequence has been read into it.
 *
 * The canvas it opens on and the dirty-state baseline that canvas is measured
 * against both come from here, so an editor nobody has touched cannot claim
 * work nobody has done: two hand-written copies of "empty" would only have to
 * drift by one field for it to.
 *
 * @param {boolean} isNew Whether the editor was opened on a new sequence.
 * @return {Object} The fields a save sends, at the values they start on.
 */
const blankSequence = ( isNew ) => ( {
	name: '',
	description: '',
	isActive: true,
	stages: isNew ? newWorkflowStages() : [],
	selectedPostTypes: [ 'post' ],
	settings: {},
	metadataFields: [],
} );

/**
 * Serialize every field a save sends, and nothing else.
 *
 * The selection and the empty status groups the author has added are editing
 * state the server never sees, so moving between stages or opening a group is
 * not a change anyone needs warning about.
 *
 * The sequence on the canvas and the baseline it is compared against are both
 * written from here, because the comparison is between strings: a baseline
 * built in a different key order would read as changed forever.
 *
 * One other place builds that string — the region repair, which amends the
 * baseline rather than retaking it (see repairRegions) by parsing it,
 * overwriting `stages` and stringifying again. That is a second construction
 * site on purpose: every key here is a non-integer string, so parse, spread and
 * overwrite hand back the same order this function laid down, and a field added
 * here is carried through without the repair being told about it. Anything that
 * needs a whole snapshot still comes back to this function for it.
 *
 * @param {boolean} isPhase Whether this is a phase sequence.
 * @param {Object}  fields  The fields a save sends.
 * @return {string} The sequence, serialized.
 */
const serializeSequence = ( isPhase, fields ) =>
	JSON.stringify(
		isPhase
			? {
					name: fields.name,
					description: fields.description,
					isActive: fields.isActive,
					stages: fields.stages,
			  }
			: {
					name: fields.name,
					description: fields.description,
					isActive: fields.isActive,
					stages: fields.stages,
					selectedPostTypes: fields.selectedPostTypes,
					settings: fields.settings,
					metadataFields: fields.metadataFields,
			  }
	);

/**
 * The question asked before unsaved work is thrown away.
 *
 * Written once because two exits ask it — the Cancel button and a hash change
 * the author didn't make through it — and an author who meets the same question
 * worded two ways has to read both to see they mean the same thing.
 *
 * @return {Array} Arguments for `confirm()`.
 */
const discardPrompt = () => [
	__(
		'This sequence has changes that have not been saved. Leaving now discards them.',
		'vip-workflows'
	),
	{
		title: __( 'Discard unsaved changes?', 'vip-workflows' ),
		confirmLabel: __( 'Discard changes', 'vip-workflows' ),
		cancelLabel: __( 'Cancel', 'vip-workflows' ),
		isDestructive: true,
	},
];

/**
 * Why the save was refused, in full.
 *
 * One reason is a sentence, because a bulleted list of one reads as a form the
 * author has to work through. More than one is counted and listed: the count is
 * how they know the first fix is not the last, and the list is what saves them
 * pressing Save between each.
 *
 * Every sentence comes from the rule that refused — `validateSequence`, or the
 * two post-type checks the editor makes itself — and each one names what is
 * wrong and the gesture that fixes it. Nothing is composed here.
 *
 * @param {Object} props         Component props.
 * @param {Array}  props.reasons The sentences, one per reason.
 * @return {JSX.Element} The notice body.
 */
function SaveBlockers( { reasons } ) {
	if ( reasons.length === 1 ) {
		return reasons[ 0 ];
	}

	return (
		<>
			{ sprintf(
				/* translators: %d: number of things standing in the way of the save. */
				_n(
					'This sequence cannot be saved yet — %d thing needs fixing:',
					'This sequence cannot be saved yet — %d things need fixing:',
					reasons.length,
					'vip-workflows'
				),
				reasons.length
			) }
			<Stack render={ <ul /> } direction="column" gap="xs">
				{ reasons.map( ( reason ) => (
					<li key={ reason }>{ reason }</li>
				) ) }
			</Stack>
		</>
	);
}

export default function SequenceGraphEditor( {
	sequenceId,
	mode = 'workflow',
	onCancel,
	// Told the id of the sequence a save has just created. Required wherever
	// this editor can create one — the page is the router, so where the address
	// goes next is its call, not this file's.
	onCreated,
} ) {
	const isPhase = mode === 'phase';
	// Whether this editor was OPENED on a new sequence — which is what decides
	// there is nothing to load and what the starting canvas holds. Where a save
	// writes to is `savedId` below, and the two stop agreeing the moment a new
	// sequence is saved.
	const isNew = ! sequenceId;

	const [ loading, setLoading ] = useState( ! isNew );
	const [ saving, setSaving ] = useState( false );
	const [ saveStatus, setSaveStatus ] = useState( null );
	const [ deleting, setDeleting ] = useState( false );
	const [ error, setError ] = useState( null );
	// Whether Save has been refused, kept apart from `error` (which reports
	// failures the server sent back). Only whether, not what: the reasons are
	// derived from the sequence as it currently stands (`saveBlockers`), so the
	// list on screen shrinks as they are fixed rather than going stale — a
	// frozen copy would go on telling someone who just fixed something that they
	// hadn't.
	const [ saveRefused, setSaveRefused ] = useState( false );
	// Whether a read the editor cannot be built without came back a failure —
	// what a sequence may be built from, or the sequence itself. Either one
	// leaves nothing to draw a canvas over, so it blocks editing outright
	// rather than rendering one against data that is not there. Both set sites
	// clear `savedSnapshot` with it, because a blocked editor has no canvas for
	// the exit guards to be guarding (see savedSnapshot).
	const [ readFailed, setReadFailed ] = useState( false );
	// Stages stored before the status-region write gate. Reading one throws
	// server-side, so we offer the author an explicit repair rather than
	// defaulting the region behind their back.
	const [ missingRegions, setMissingRegions ] = useState( [] );
	const [ repairing, setRepairing ] = useState( false );
	// What the last region repair actually changed. Held until dismissed: it is
	// the only account the author gets of a transition it could not keep.
	const [ repairReport, setRepairReport ] = useState( null );

	// The row this editor writes to. Seeded from the prop and re-pointed by the
	// first successful save of a new sequence, so the second save updates what
	// the first one created instead of posting a duplicate of it.
	const [ savedId, setSavedId ] = useState( sequenceId || null );

	// Built once for this mount, not once per read: `stages` takes the array
	// itself and the baseline below serializes the same object, so a second
	// call would measure the canvas against a different array than it holds.
	const [ blank ] = useState( () => blankSequence( isNew ) );

	const [ name, setName ] = useState( blank.name );
	const [ description, setDescription ] = useState( blank.description );
	const [ isActive, setIsActive ] = useState( blank.isActive );
	const [ stages, setStages ] = useState( blank.stages );
	const [ selection, setSelection ] = useState( null );
	const [ confirm, confirmDialog ] = useConfirm();

	// The sequence as the server last confirmed it, serialized. Unsaved work is
	// whatever differs from this. Null exactly while the canvas is not on
	// screen — before the sequence has loaded, or once a failed read has
	// blocked editing — so there is never an editable canvas without one, and
	// never a baseline without a canvas.
	//
	// That second direction is what stands the exit guards down when editing is
	// blocked: they are gated on `isDirty`, but they sit above the early return
	// that replaces the whole editor with the error, so a guard left attached
	// restores the address and waits on a confirm dialog that render never
	// draws. No question, no way on, reload only.
	//
	// Every write to it happens in the SAME batch as the state it describes: the
	// load, a save, a region repair, and a new sequence's starting canvas here.
	// Taking it in an effect instead leaves a window — the effect runs after the
	// commit that reveals the form, so a change made in between is absorbed into
	// the baseline rather than registered against it. Save then stays disabled
	// on work that was never written, both exit guards stay stood down, and the
	// next navigation discards it without asking.
	const [ savedSnapshot, setSavedSnapshot ] = useState( () =>
		isNew ? serializeSequence( isPhase, blank ) : null
	);

	// Status-region groups the author added from the canvas that hold no stage
	// yet. A region with stages in it needs no bookkeeping — it's visible
	// because a stage says so — but an empty one has nothing to derive it from,
	// so it's remembered here until something is dragged in. Editing state, not
	// sequence data: it isn't saved, and reopening the sequence shows the
	// regions its stages actually use.
	const [ addedRegions, setAddedRegions ] = useState( [] );
	const [ addingRegion, setAddingRegion ] = useState( false );

	// Phase-only. The lifecycle hand-offs a phase sequence is allowed to draw,
	// as { from, to } pairs — the server's, not this file's.
	const [ phaseTransitions, setPhaseTransitions ] = useState( [] );

	// Phase-only, and the other half of the same answer: the hand-offs a phase
	// sequence is REQUIRED to carry. Allowed and required are two different
	// facts — the first decides what the canvas will draw, the second what it
	// will save — and the write gate refuses on this one, so it is read from
	// the same place rather than kept here.
	const [ requiredPhaseTransitions, setRequiredPhaseTransitions ] = useState(
		[]
	);

	// Whether the options read has landed. Both editors wait on it — see the
	// load effect — and it is tracked in its own flag rather than read off
	// `postTypes.length`, because a phase sequence has no post types to wait on
	// and would otherwise start reading before its hand-off graph exists.
	const [ optionsLoaded, setOptionsLoaded ] = useState( false );

	// Workflow-only sequence-level state.
	const [ postTypes, setPostTypes ] = useState( [] );
	const [ selectedPostTypes, setSelectedPostTypes ] = useState(
		blank.selectedPostTypes
	);
	const [ settings, setSettings ] = useState( blank.settings );
	const [ metadataFields, setMetadataFields ] = useState(
		blank.metadataFields
	);

	// Shared reference data.
	const [ availableTools, setAvailableTools ] = useState( [] );
	const [ toolsLoaded, setToolsLoaded ] = useState( false );
	const [ availableRoles, setAvailableRoles ] = useState( [] );
	const [ availableChannels, setAvailableChannels ] = useState( [] );
	const [ availableAgents, setAvailableAgents ] = useState( [] );

	// --- Reference data ----------------------------------------------------

	useEffect( () => {
		setAvailableRoles( window.vipWorkflowsAdmin?.roles || [] );
	}, [] );

	useEffect( () => {
		const context = isPhase ? 'phase' : 'workflow';
		apiFetch( { path: `/vip-workflows/v1/abilities?context=${ context }` } )
			.then( ( tools ) => {
				setAvailableTools( tools || [] );
				setToolsLoaded( true );
			} )
			.catch( () => setAvailableTools( [] ) );
	}, [ isPhase ] );

	useEffect( () => {
		apiFetch( { path: '/vip-workflows/v1/notifications/channels' } )
			.then( ( channels ) => setAvailableChannels( channels || [] ) )
			.catch( () => setAvailableChannels( [] ) );
	}, [] );

	// Stage-eligible agents (abilities that can own an AI stage). Workflow-only:
	// phase sequences have no AI stages.
	useEffect( () => {
		if ( isPhase ) {
			return;
		}
		apiFetch( { path: '/vip-workflows/v1/abilities?context=stage' } )
			.then( ( agents ) => setAvailableAgents( agents || [] ) )
			.catch( () => setAvailableAgents( [] ) );
	}, [ isPhase ] );

	// What a sequence may be built out of, asked rather than worked out.
	//
	// The post types used to be `/wp/v2/types` minus a list of WordPress's own
	// internals kept in this file — and that list had to grow every time core
	// registered another one, which it does. The phase hand-offs used to be a
	// pair of keys written out here as well, alongside the copy the write gate
	// enforces. Both are the server's to answer: it is what accepts the save.
	useEffect( () => {
		apiFetch( { path: '/vip-workflows/v1/sequences/options' } )
			.then( ( options ) => {
				const types = options.post_types;
				const transitions = options.phase_transitions;
				const required = options.required_phase_transitions;
				// A response missing any of the lists is a broken endpoint, not
				// an empty answer, and reading it as an empty one is the failure
				// this whole path is written to avoid: no post types reads as
				// "your CPT is gone", no transitions as "this phase sequence
				// connects nothing", and no required transitions as "this one
				// owes nothing" — which would let the canvas save a lifecycle
				// the server refuses.
				if (
					! Array.isArray( types ) ||
					! Array.isArray( transitions ) ||
					! Array.isArray( required )
				) {
					throw new Error(
						__(
							'The server did not say what this sequence can be built from.',
							'vip-workflows'
						)
					);
				}
				// All in one batch, so the load effect below re-runs once when
				// the answer lands rather than once per field.
				setPostTypes( types );
				setPhaseTransitions( transitions );
				setRequiredPhaseTransitions( required );
				setOptionsLoaded( true );
			} )
			.catch( ( err ) => {
				// No fabricated fallback: a wrong post-type list would make a
				// real attached CPT look stale and silently persist a reduced
				// post_types on save, and a missing phase graph would refuse
				// every connection on the canvas without saying why. Surface
				// the failure and block editing.
				setError(
					err?.message ||
						( isPhase
							? __(
									'Could not load the phases this sequence can connect. Reload the page to try again.',
									'vip-workflows'
							  )
							: __(
									'Could not load the list of post types. Reload the page to try again.',
									'vip-workflows'
							  ) )
				);
				setReadFailed( true );
				// A new sequence has its canvas up while this read is still
				// out, so there can be work on it — and blocking editing takes
				// away both the button that would save it and the dialog that
				// would ask about discarding it. Dropping the baseline is what
				// says so: with nothing to measure against, neither exit guard
				// attaches, and the author is not held by a question the
				// blocked render cannot ask.
				setSavedSnapshot( null );
				setLoading( false );
			} );
	}, [ isPhase ] );

	// --- Load existing sequence ------------------------------------------

	// Everything the server owns, read back into the editor. Both the initial
	// load and a successful save go through it, because the write gate
	// normalizes what it stores — stage keys and transition targets through
	// `sanitize_key`, a missing region to `draft`, an unmarked region's first
	// stage into its checkpoint. An editor that kept its own copy after a save
	// would show one sequence and send another the next time.
	//
	// Post types are the one thing it leaves alone: the two callers disagree
	// about what to do with them (see each).
	//
	// It returns what it applied so the caller can take the dirty-state baseline
	// from the same values, in the same batch — post types included, from
	// whichever list that caller settled on. What it RETURNS is always the
	// server's copy, whatever it put on screen: those are the values now
	// stored, so they are what unsaved work has to be measured against.
	//
	// `sent` is what each field held when a write went out, and is how the save
	// path keeps that write from taking back edits made while it was in flight
	// (see reseat). The load path has no such window — the spinner is up and
	// there is nothing on screen to type into — so it passes nothing.
	const seedFromSequence = useCallback(
		( response, sent = null ) => {
			// Put the server's copy of one field on screen, unless the author
			// has moved that field on since the write went out. React replaces
			// state by identity on every update, so a live value that is no
			// longer the one the write carried is an edit made while it was in
			// flight — and a response is not allowed to take one of those back.
			// Fields the author did not touch still take the server's copy, so
			// the canvas ends up holding what was stored everywhere it can.
			//
			// `===` reads differently on either side of that test, and the
			// difference is known rather than overlooked. For the primitives
			// (`name`, `description`, `isActive`) it is value comparison, so an
			// edit typed and typed back while the write was out matches again
			// and takes the server's copy. For the reference-typed fields
			// (`stages`, `settings`, `metadataFields`) the same
			// round trip leaves a new identity holding equal content, so the
			// canvas keeps its own copy and the editor reads dirty on a
			// sequence that matches what was stored. That way round is the safe
			// one — falsely dirty offers a write nobody needed, never a silent
			// discard — and the next save clears it.
			const reseat = ( setter, field, value ) => {
				if ( ! sent ) {
					setter( value );
					return;
				}
				// A field the write did not carry cannot be compared against
				// what it carried, and treating that as "the author moved it
				// on" would quietly stop re-seating this field for good — the
				// canvas left holding what the gate refused to store, with
				// nothing on screen to say so. It is a mistake in this
				// function, not a state the editor can be in.
				if ( ! ( field in sent ) ) {
					throw new Error(
						`seedFromSequence: "${ field }" is not one of the fields the write carried.`
					);
				}
				setter( ( live ) => ( live === sent[ field ] ? value : live ) );
			};

			const fields = {
				name: response.name || '',
				description: response.description || '',
				isActive: response.status === 'active',
				stages: isPhase
					? response.config?.phases || []
					: onPalette( response.config?.statuses || [] ),
			};

			reseat( setName, 'name', fields.name );
			reseat( setDescription, 'description', fields.description );
			reseat( setIsActive, 'isActive', fields.isActive );
			reseat( setStages, 'stages', fields.stages );

			if ( isPhase ) {
				return fields;
			}

			fields.settings = response.config?.settings || {};
			fields.metadataFields = response.config?.metadata_fields || [];

			// Not a field anyone edits — it is the server's account of which
			// stages it could not read a region for — so it is always taken
			// from the response.
			setMissingRegions( response.stages_missing_region || [] );

			reseat( setSettings, 'settings', fields.settings );
			reseat(
				setMetadataFields,
				'metadataFields',
				fields.metadataFields
			);

			return fields;
		},
		[ isPhase ]
	);

	useEffect( () => {
		if ( isNew ) {
			return;
		}
		// Both editors wait for the options read. A workflow needs the post
		// types to flag stale selections; a phase needs the hand-off graph
		// before its canvas can judge a connection, or the author drags an edge
		// the editor refuses for a rule it has not been told yet.
		//
		// And `postTypes` is one of this effect's own dependencies, so starting
		// before the answer lands runs it a SECOND time when the answer arrives:
		// a second read of the same sequence whose re-seat carries no `sent` and
		// is therefore unconditional, throwing away anything typed between the
		// two responses and re-taking the baseline from the server's copy — the
		// silent discard the `sent` mechanism exists to prevent.
		if ( ! optionsLoaded ) {
			return;
		}

		apiFetch( { path: `/vip-workflows/v1/sequences/${ sequenceId }` } )
			.then( ( response ) => {
				const fields = seedFromSequence( response );

				if ( isPhase ) {
					setSavedSnapshot( serializeSequence( isPhase, fields ) );
					setLoading( false );
					return;
				}

				// On load, a stored post type that no longer exists is real
				// news — the sequence is attached to something that was
				// unregistered since — so it is filtered out and named.
				const savedPostTypes = response.config?.post_types || [];
				const availableSlugs = postTypes.map( ( pt ) => pt.value );
				const valid = savedPostTypes.filter( ( slug ) =>
					availableSlugs.includes( slug )
				);
				const stale = savedPostTypes.filter(
					( slug ) => ! availableSlugs.includes( slug )
				);
				if ( stale.length > 0 ) {
					setError(
						sprintf(
							/* translators: %s: comma-separated post type slugs */
							__(
								'Warning: this sequence references post types that no longer exist: %s. Select valid post types and save.',
								'vip-workflows'
							),
							stale.join( ', ' )
						)
					);
				}
				setSelectedPostTypes( valid );
				setSavedSnapshot(
					serializeSequence( isPhase, {
						...fields,
						selectedPostTypes: valid,
					} )
				);
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				// Nothing was read in, but `savedId` still names the row this
				// editor writes to. An editable canvas here is an empty
				// sequence pointed at a stored one nobody has seen: the
				// validator refuses to save no stages, so it takes adding a
				// single one to PUT a brand-new config over the whole of it.
				// A read that failed is missing data, so this bails rather
				// than offering the blank sequence as if it were the stored
				// one — and the baseline stays null, which is what "no canvas"
				// means (see savedSnapshot).
				setReadFailed( true );
				setLoading( false );
			} );
	}, [
		sequenceId,
		isNew,
		isPhase,
		optionsLoaded,
		postTypes,
		seedFromSequence,
	] );

	// --- Region repair -----------------------------------------------------

	// Replays the stored config through the server's write gate, which assigns
	// `draft` to any stage missing a region. Author-triggered on purpose: the
	// read path throws rather than defaulting, so the fix is a decision someone
	// makes, not something that happens silently on load.
	const repairRegions = useCallback( () => {
		setRepairing( true );
		setError( null );

		apiFetch( {
			path: `/vip-workflows/v1/sequences/${ savedId }/repair-regions`,
			method: 'POST',
		} )
			.then( ( response ) => {
				const repaired = response.config?.statuses || [];
				setStages( repaired );
				setMissingRegions( response.stages_missing_region || [] );
				// The repair replays the stored config through the write gate,
				// which collapses a stage's duplicate transitions on the way
				// through. `repair` says what that cost — the endpoint always
				// sends it, so a missing one is a contract break, not something
				// to paper over.
				setRepairReport( describeRepair( response.repair, repaired ) );
				// The repair writes what it replayed, so the stages that came
				// back ARE the stored ones and must not read as unsaved work.
				// Only the stages, though: the repair replays the STORED config
				// and knows nothing of edits the author has made since. Clearing
				// the whole baseline would absorb an unsaved rename into it —
				// leaving the new name on screen, Save disabled because nothing
				// looks changed, and both exit guards stood down on work that
				// was never written. So the baseline is amended, not retaken.
				setSavedSnapshot( ( previous ) =>
					// Overwriting an existing key keeps its position, so the
					// amended baseline still serializes in `snapshot`'s order.
					JSON.stringify( {
						...JSON.parse( previous ),
						stages: repaired,
					} )
				);
				setRepairing( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setRepairing( false );
			} );
	}, [ savedId ] );

	// --- Validation --------------------------------------------------------

	const validation = useMemo(
		() =>
			validateSequence( {
				name,
				stages,
				isPhase,
				requiredTransitions: requiredPhaseTransitions,
				agents: availableAgents,
			} ),
		[ name, stages, isPhase, requiredPhaseTransitions, availableAgents ]
	);

	/*
	 * Every reason this sequence cannot be written, in one list.
	 *
	 * Gathered rather than reported one at a time. Save used to show
	 * `errors[0]`, so an author with three problems fixed one, pressed Save, and
	 * met the second — the sequence looked broken in a different way each time
	 * instead of broken in three named ways once.
	 *
	 * Two of them are the editor's own, and only the editor's: what a sequence
	 * runs on is not part of the stage graph `validateSequence` reads, and the
	 * server enforces neither rule — an empty `post_types` and a label-less
	 * registration both persist, as a sequence no post can ever enter. Refusing
	 * them here is what keeps that inert row out of the database, so they belong
	 * in the same list as the rest.
	 */
	const saveBlockers = useMemo( () => {
		const reasons = [ ...validation.errors ];

		if ( ! isPhase && selectedPostTypes.length === 0 ) {
			reasons.push(
				__(
					'This sequence is attached to no post type, so nothing would ever run through it. Click an empty part of the canvas and choose at least one under Post types.',
					'vip-workflows'
				)
			);
		}

		// Two stages can be wrong in the identical way — two of them left
		// unnamed, say — and the same sentence twice is noise, not a second
		// thing to fix.
		return [ ...new Set( reasons ) ];
	}, [ validation.errors, isPhase, selectedPostTypes ] );

	// The refusal stands down once the last reason for it is gone, so it cannot
	// reappear on its own the next time a field is half-edited.
	useEffect( () => {
		if ( saveBlockers.length === 0 ) {
			setSaveRefused( false );
		}
	}, [ saveBlockers.length ] );

	// --- Unsaved work ------------------------------------------------------

	// The sequence as it stands, serialized the one way (see serializeSequence).
	const snapshot = useMemo(
		() =>
			serializeSequence( isPhase, {
				name,
				description,
				isActive,
				stages,
				selectedPostTypes,
				settings,
				metadataFields,
			} ),
		[
			isPhase,
			name,
			description,
			isActive,
			stages,
			selectedPostTypes,
			settings,
			metadataFields,
		]
	);

	const isDirty = savedSnapshot !== null && snapshot !== savedSnapshot;

	// Leaving wp-admin altogether — a reload, a closed tab, a click on the
	// wp-admin menu. The browser asks on our behalf, but only for an event that
	// was cancelled, and only while there is something to lose.
	useEffect( () => {
		if ( ! isDirty ) {
			return undefined;
		}
		const warn = ( event ) => {
			event.preventDefault();
			// Browsers show their own wording and ignore ours; assigning
			// `returnValue` is still what marks the event cancelled for the
			// ones that predate `preventDefault()` working here.
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ isDirty ] );

	// This editor's own address. Also what a guarded navigation puts back, so
	// it is derived rather than remembered — a saved-new sequence changes it,
	// and a remembered one would send the author back to `#/new`.
	const ownHash = savedId
		? `#/${ isPhase ? 'edit-phase' : 'edit' }/${ savedId }`
		: '#/new';

	// Set for a navigation this editor is making on purpose, and cleared by the
	// first `hashchange` that follows. Both exits that mean it — Cancel, once
	// answered, and deleting the sequence — go through `leaveEditor` so the
	// guard below doesn't meet a deliberate departure with the question it
	// exists to ask about an accidental one.
	const leaving = useRef( false );

	const confirmDiscard = useCallback(
		() => confirm( ...discardPrompt() ),
		[ confirm ]
	);

	const leaveEditor = useCallback( () => {
		leaving.current = true;
		onCancel?.();
	}, [ onCancel ] );

	// Leaving by browser Back, or any other hash change that didn't come from
	// the Cancel button. This cannot veto the navigation — AppShell listens for
	// `hashchange` too and registered first — but AppShell re-renders from
	// `window.location.hash` rather than from the event, so putting the address
	// back before React flushes means the list is never reached. The question
	// is then asked with the canvas still holding the work, and answering it
	// with "discard" replays the navigation the guard undid.
	useEffect( () => {
		if ( ! isDirty ) {
			return undefined;
		}

		const guard = () => {
			// The replay. It has to be let through, or the guard would ask
			// again about the navigation it was just told to allow.
			if ( leaving.current ) {
				leaving.current = false;
				return;
			}
			const target = window.location.hash;
			// The restore below fires this handler a second time; by then the
			// address is ours again and there is nothing to guard.
			if ( target === ownHash ) {
				return;
			}
			window.location.hash = ownHash;
			confirmDiscard().then( ( discard ) => {
				if ( discard ) {
					leaving.current = true;
					window.location.hash = target;
				}
			} );
		};

		window.addEventListener( 'hashchange', guard );
		return () => window.removeEventListener( 'hashchange', guard );
	}, [ isDirty, ownHash, confirmDiscard ] );

	const handleCancel = useCallback( async () => {
		if ( isDirty && ! ( await confirmDiscard() ) ) {
			return;
		}
		leaveEditor();
	}, [ isDirty, confirmDiscard, leaveEditor ] );

	// --- Selection helpers -------------------------------------------------

	const selectedStage =
		selection?.type === 'node'
			? stages.find( ( s ) => s.key === selection.key )
			: null;
	const selectedTransition =
		selection?.type === 'edge'
			? findTransition( stages, selection.from, selection.to )
			: null;

	const selectNode = useCallback(
		( key ) => setSelection( { type: 'node', key } ),
		[]
	);
	const selectEdge = useCallback( ( id ) => {
		setSelection( { type: 'edge', ...parseEdgeId( id ) } );
	}, [] );
	const selectRegion = useCallback(
		( region ) => setSelection( { type: 'region', region } ),
		[]
	);
	const clearSelection = useCallback( () => setSelection( null ), [] );

	// --- Status regions ----------------------------------------------------

	// Which groups the canvas draws: every region a stage lives in, plus the
	// empty ones the author added, plus draft (where new content starts).
	// Phase sequences have no post statuses at all, so they get no groups.
	const regions = useMemo(
		() => ( isPhase ? [] : visibleRegions( stages, addedRegions ) ),
		[ isPhase, stages, addedRegions ]
	);

	const handleAddRegion = useCallback( ( region ) => {
		setAddedRegions( ( current ) =>
			current.includes( region ) ? current : [ ...current, region ]
		);
		setSelection( { type: 'region', region } );
	}, [] );

	// Only ever reachable for an empty region (the canvas menu and the region
	// inspector both gate on it), so no stage is left pointing at a group that
	// isn't drawn.
	const handleRemoveRegion = useCallback( ( region ) => {
		setAddedRegions( ( current ) =>
			current.filter( ( r ) => r !== region )
		);
		setSelection( null );
	}, [] );

	// Where a dragged stage ended up: the group it belongs to, and whether it
	// landed in that group's checkpoint slot.
	//
	// Both halves are positions, so both are set from the drop and nothing is
	// inferred: a stage let go in the slot takes the region's checkpoint (the
	// previous holder loses it), and the stage that was holding it loses it by
	// being let go anywhere else. That second half is the whole point — it's how
	// a checkpoint is freed — so it has to happen even though it leaves the
	// sequence unsaveable until one is set again.
	const handlePlaceStage = useCallback( ( key, region, isCheckpoint ) => {
		setStages( ( current ) => {
			const moved = setStageStatus( current, key, region );
			return isCheckpoint
				? setRegionEntry( moved, key )
				: clearRegionEntry( moved, key );
		} );
	}, [] );

	// The inspector's way into the same thing the slot does — for setting a
	// checkpoint without a pointer, and for clearing one (`key` null).
	const handleSetRegionEntry = useCallback( ( region, key ) => {
		setStages( ( current ) => {
			if ( key ) {
				return setRegionEntry( current, key );
			}
			const held = current.find(
				( s ) =>
					Boolean( s.region_entry ) && stageRegion( s ) === region
			);
			return held ? clearRegionEntry( current, held.key ) : current;
		} );
	}, [] );

	// --- Stage mutations ---------------------------------------------------

	// Add a stage flowing out of an existing node — what dropping a connection on
	// empty canvas does. Returns the new stage's key so the canvas can put the
	// node where it was dropped. Memoized so its identity is stable: it feeds
	// GraphCanvas's layout memo, which would otherwise re-run the dagre layout on
	// every parent render.
	const handleAddStageFromNode = useCallback(
		( sourceKey, { region = null, outcome = null } = {} ) => {
			const result = addStageFromNode( stages, sourceKey, {
				// A stage grown inside a group belongs to that group's status;
				// one grown from an outcome handle becomes that outcome's
				// destination. The two are independent — a drag can be both.
				...( region ? { status: region } : {} ),
				outcome,
			} );
			// The connection was refused, so the gesture made nothing. The canvas
			// reads the null key and skips placing a node.
			if ( ! result.key ) {
				return null;
			}
			setStages( result.stages );
			setSelection( { type: 'node', key: result.key } );
			return result.key;
		},
		[ stages ]
	);

	// Insert a stage in the middle of an edge (the edge "+" affordance). Returns
	// the new stage's key, so the canvas can pin the node to the point on the
	// edge the "+" was clicked at instead of letting the layout re-place it.
	const handleInsertStageOnEdge = useCallback(
		( from, to, outcome ) => {
			const result = insertStageOnEdge( stages, from, to, { outcome } );
			setStages( result.stages );
			setSelection( { type: 'node', key: result.key } );
			return result.key;
		},
		[ stages ]
	);

	const handleUpdateStage = ( key, changes ) => {
		// Picking an agent routes through its own mutation rather than a plain
		// field merge, because clearing it drops the whole agent. Where a stage
		// sits — its status region and whether it holds that region's
		// checkpoint — never arrives here: both are set by dragging on the
		// canvas (`handlePlaceStage`) or from the region's side
		// (`handleSetRegionEntry`), and `StageInspector` only reads them back.
		const { agent_ability_id: agentAbilityId, ...rest } = changes;
		let next = stages;
		if ( agentAbilityId !== undefined ) {
			next = setStageAgent( next, key, agentAbilityId );
		}
		if ( Object.keys( rest ).length > 0 ) {
			const merged = updateStage( next, key, rest );
			if ( merged === next && rest.key !== undefined ) {
				// Rejected (a key rename onto an existing key) — moving the
				// selection would jump to the *other* stage with that key.
				return;
			}
			next = merged;
		}
		if ( next === stages ) {
			return;
		}
		setStages( next );
		if ( rest.key !== undefined && rest.key !== key ) {
			setSelection( { type: 'node', key: rest.key } );
		}
	};

	const handleDeleteStage = ( key ) => {
		// Phase stages are fixed — the lifecycle needs both of them (see
		// PhaseStageInspector) — so nothing may delete them.
		if ( isPhase ) {
			return;
		}
		// A sequence needs at least one stage. The inspector's Delete button is
		// already guarded (canDelete), but the React Flow keyboard-delete path is
		// not — without this, deleting the last node empties the canvas into an
		// unrecoverable state (no add affordance remains).
		setStages( ( current ) =>
			current.length <= 1 ? current : removeStage( current, key )
		);
		setSelection( null );
	};

	// --- Transition (edge) mutations --------------------------------------

	// The Start / End special cases (entry reassignment, terminal flag) and the
	// carry-over rules live in graph-model's connectEdge / disconnectEdge so they
	// stay pure and unit-testable.
	const handleConnect = ( from, to, sourceHandle ) => {
		const result = connectEdge( stages, from, to, sourceHandle );
		setStages( result.stages );
		if ( result.selection ) {
			setSelection( { type: 'edge', ...result.selection } );
		}
	};

	// An endpoint dragged from one node to another. Which of the two ends moved
	// is not a distinction the model draws — it is handed both pairs and works
	// out what changed — so the canvas passes them straight through.
	const handleReconnect = useCallback(
		( from, to, newFrom, newTo, outcome = null ) => {
			const result = reconnectEdge(
				stages,
				from,
				to,
				newFrom,
				newTo,
				outcome
			);
			// A refused move hands the array straight back, so there is nothing
			// to write and nothing to select — the endpoint springs back to
			// where the canvas already said it would.
			if ( ! result.selection ) {
				return;
			}
			setStages( result.stages );
			setSelection( { type: 'edge', ...result.selection } );
		},
		[ stages ]
	);

	// An endpoint released on empty canvas: the stage it was reaching for is
	// created and the endpoint lands on it in one step, so the transition never
	// exists pointing at nothing and one edit undoes the whole gesture. Returns
	// the new stage's key so the canvas can put the node where it was dropped.
	//
	// The new stage takes the selection rather than the edge that now reaches
	// it, the same as every other gesture that makes one: what the author needs
	// next is to name it.
	const handleReconnectToNewStage = useCallback(
		( from, to, { region = null, outcome = null } = {} ) => {
			const result = reconnectEdgeToNewStage( stages, from, to, {
				...( region ? { status: region } : {} ),
				outcome,
			} );
			// Refused, so the gesture made nothing. The canvas reads the null
			// key and skips placing a node.
			if ( ! result.key ) {
				return null;
			}
			setStages( result.stages );
			setSelection( { type: 'node', key: result.key } );
			return result.key;
		},
		[ stages ]
	);

	const handleUpdateTransition = ( from, to, changes ) => {
		setStages( ( current ) =>
			updateTransition( current, from, to, changes )
		);
	};

	const handleDeleteTransition = ( from, to, outcome = null ) => {
		// The Start edge is structural and can't be deleted.
		if ( from === START_ID ) {
			return;
		}
		setStages( ( current ) =>
			disconnectEdge( current, from, to, outcome )
		);
		setSelection( null );
	};

	const isStageKey = useCallback(
		( id ) => stages.some( ( s ) => s.key === id ),
		[ stages ]
	);

	const isValidConnection = useCallback(
		( connection ) => {
			const { source, target, sourceHandle } = connection;
			if ( source === target ) {
				return false;
			}
			// Phases are fixed and so are the hand-offs between them: a phase
			// sequence configures a lifecycle move, it does not invent one. The
			// allowed pairs come from the server, which is what decides them —
			// naming them here as well is how the canvas came to offer a
			// connection the save then dropped, or refuse one it would keep.
			if ( isPhase ) {
				return phaseTransitions.some(
					( t ) => t.from === source && t.to === target
				);
			}
			// An agent outcome routes to a stage and nothing else: `routing`
			// holds stage keys, so it has no way to name the flow's exit. An AI
			// stage is marked final by clearing its agent first.
			if ( isAgentOutcome( sourceHandle ) ) {
				return isStageKey( target );
			}
			// Nothing connects into Start or out of End.
			if ( target === START_ID || source === END_ID ) {
				return false;
			}
			// Start → real stage (defines entry).
			if ( source === START_ID ) {
				return isStageKey( target );
			}
			// Real stage → End (defines an exit).
			if ( target === END_ID ) {
				return isStageKey( source );
			}
			// Stage → stage, anywhere on the canvas: a transition may cross into
			// any region, at any stage. Both ends still have to be stages, so
			// React Flow refuses a drop the model would silently ignore.
			//
			// "An AI stage leaves only by an outcome" is NOT restated here. It
			// lives in `canReconnect`, which knows which endpoint moved — this
			// callback only sees the pair, so a rule phrased as "the source is
			// an AI stage" would also refuse re-pointing the destination of a
			// transition that already leaves one.
			return isStageKey( source ) && isStageKey( target );
		},
		[ isPhase, isStageKey, phaseTransitions ]
	);

	const togglePostType = ( slug ) => {
		setSelectedPostTypes( ( current ) =>
			current.includes( slug )
				? current.filter( ( s ) => s !== slug )
				: [ ...current, slug ]
		);
	};

	// --- Save / delete -----------------------------------------------------

	const handleSave = async () => {
		// One refusal carrying every reason — see saveBlockers. A server error
		// left over from an earlier attempt is cleared first: the notice shows
		// `error` in preference to the reasons, so leaving it set would answer
		// this press with the last press's message, and never say what is
		// wrong now.
		if ( saveBlockers.length > 0 ) {
			setError( null );
			setSaveRefused( true );
			return;
		}

		setSaving( true );
		setSaveStatus( null );
		setError( null );

		// Whether this save creates the row or updates it. Read from `savedId`,
		// not from the prop: after the first save of a new sequence there IS a
		// row, and asking the prop would post a duplicate of it.
		const creating = ! savedId;

		try {
			let payload;
			if ( isPhase ) {
				payload = {
					name,
					description,
					type: 'phase',
					status: isActive ? 'active' : 'draft',
					statuses: stages,
				};
			} else {
				// Prune tool ids whose ability no longer exists — but only once
				// the abilities list has actually loaded. Until then (or if the
				// fetch failed) `availableTools` is empty, and pruning would
				// silently strip every transition's required_tools on save.
				/*
				 * An AI stage whose agent was never chosen used to be cleaned
				 * away below, quietly, because the server rejects an agent
				 * without an ability_id. The author saw a successful save and a
				 * stage that had lost its agent, with nothing said — which reads
				 * as "the setting will not stick" rather than "you did not
				 * finish choosing one".
				 *
				 * Refused instead, naming the stage. Every other rule the server
				 * applies to an AI stage is already reported; this was the one
				 * that resolved itself by discarding the author's work.
				 */
				const unfinished = stages.filter(
					( status ) => status.agent && ! isAgentStage( status )
				);

				if ( unfinished.length > 0 ) {
					setError(
						sprintf(
							/* translators: %s: stage label or key. */
							__(
								'The “%s” stage is set to run an AI agent but none is chosen. Please set one.',
								'vip-workflows'
							),
							unfinished[ 0 ].label || unfinished[ 0 ].key
						)
					);
					setSaving( false );
					return;
				}

				const validToolIds = availableTools.map( ( t ) => t.id );
				const cleanedStatuses = stages.map( ( status ) => {
					const next = { ...status };
					// Drop a partial AI-stage agent (routing left behind by a
					// cleared ability) — the server rejects an agent without
					// ability_id.
					if ( ! isAgentStage( next ) ) {
						delete next.agent;
					}
					// Prune tool ids whose ability no longer exists — but only
					// once the abilities list has loaded (else availableTools is
					// empty and pruning would strip every transition's
					// required_tools on save).
					if ( toolsLoaded ) {
						next.transitions = ( next.transitions || [] ).map(
							( transition ) => ( {
								...transition,
								required_tools: (
									transition.required_tools || []
								).filter( ( id ) =>
									validToolIds.includes( id )
								),
							} )
						);
					}
					return next;
				} );

				const cleanedMetadata = metadataFields
					// A row nobody has typed into is incomplete rather than
					// wrong — the inspector's key warning leaves it unflagged
					// for the same reason — so it never leaves the editor. A
					// row carrying one half is a row someone started, and the
					// server refuses it by name (invalid_metadata_field_key,
					// invalid_metadata_field_label), which is exactly what the
					// inspector's warning promises. Requiring BOTH halves here
					// dropped such a row from the payload instead: the save
					// succeeded, the response reseated the field list without
					// it, and the field the author configured vanished under a
					// success toast.
					.filter( ( field ) => field.key || field.label )
					.map( ( field ) => {
						const entry = {
							key: field.key,
							label: field.label,
							type: field.type,
							required: !! field.required,
							searchable: !! field.searchable,
						};
						if ( field.type === 'select' ) {
							entry.options = ( field.options || [] )
								.map( ( o ) => o.trim() )
								.filter( Boolean );
						}
						return entry;
					} );

				payload = {
					name,
					description,
					status: isActive ? 'active' : 'draft',
					statuses: cleanedStatuses,
					post_types: selectedPostTypes,
					settings,
					metadata_fields: cleanedMetadata,
				};
			}

			const response = await apiFetch( {
				path: creating
					? '/vip-workflows/v1/sequences'
					: `/vip-workflows/v1/sequences/${ savedId }`,
				method: creating ? 'POST' : 'PUT',
				data: payload,
			} );

			// Saving keeps the author on the canvas they were working on, so
			// the canvas has to become what was stored rather than what was
			// sent — see seedFromSequence on what the write gate normalizes.
			//
			// Except where the author has moved on. The form stays live for
			// the whole of the write, and a response that reseated every field
			// would put the server's echo over anything typed since it went
			// out — the typing gone from the screen, and the baseline below
			// matching what replaced it, so Save switches off and both exit
			// guards stand down on work that was never written. So the
			// response is told what the write carried, and reseats around
			// whatever no longer matches it.
			const fields = seedFromSequence( response, {
				name,
				description,
				isActive,
				stages,
				settings,
				metadataFields,
			} );
			if ( ! isPhase ) {
				fields.selectedPostTypes = response.config?.post_types || [];
				setSelectedPostTypes( ( live ) =>
					live === selectedPostTypes ? fields.selectedPostTypes : live
				);
			}
			if ( creating ) {
				setSavedId( response.id );
				// And the page is told, because the address is the page's: it
				// is the router, it keys this editor by route, and an address
				// this file rewrote behind its back would leave the two
				// disagreeing about which editor `#/edit/{id}` denotes — until
				// some unrelated re-render resolved it to a different key and
				// remounted, over everything typed since the save.
				onCreated( response.id );
			}
			// Re-taken from what the server just sent back, leaving the editor
			// clean. In this same batch, because a baseline cleared here and
			// re-taken a commit later leaves a committed render with none: the
			// saved sequence on screen, `savedSnapshot` null, `isDirty` false
			// for the whole of that commit, and both exit guards unregistered
			// by it. A departure that lands in that window is never asked
			// about, and the retake that follows takes its values from the
			// canvas — so anything typed into the window is absorbed into the
			// baseline rather than measured against it.
			//
			// From `fields`, which is the server's copy of every field even
			// where the canvas kept the author's: what is stored is what
			// unsaved work is measured against, so a field that held onto an
			// in-flight edit reads as the unsaved work it is.
			setSavedSnapshot( serializeSequence( isPhase, fields ) );
			setSaveStatus( 'success' );
			setTimeout( () => setSaveStatus( null ), 2000 );
		} catch ( err ) {
			setError( err.message );
			setSaveStatus( 'error' );
		} finally {
			// In `finally`, not on each path: staying on the editor means a
			// success that skipped this would leave the button reading
			// "Saving…" for as long as the author kept it open.
			setSaving( false );
		}
	};

	const handleDelete = async () => {
		if (
			! ( await confirm(
				__(
					'Are you sure you want to delete this sequence? This cannot be undone.',
					'vip-workflows'
				),
				{
					title: __( 'Delete sequence', 'vip-workflows' ),
					confirmLabel: __( 'Delete', 'vip-workflows' ),
					isDestructive: true,
				}
			) )
		) {
			return;
		}
		setDeleting( true );
		setError( null );
		try {
			await apiFetch( {
				path: `/vip-workflows/v1/sequences/${ savedId }`,
				method: 'DELETE',
			} );
			// Nothing left to keep, so the unsaved-work guard has nothing to
			// warn about — `leaveEditor` says so rather than letting it ask.
			leaveEditor();
		} catch ( err ) {
			setError( err.message );
			setDeleting( false );
		}
	};

	// --- Render ------------------------------------------------------------

	const trimmedName = name.trim();
	// `savedId`, not `isNew`: once a new sequence has been saved the crumb
	// should name it rather than go on calling it new.
	const current = savedId
		? trimmedName || __( 'Edit', 'vip-workflows' )
		: __( 'New', 'vip-workflows' );
	const breadcrumbs = [
		{
			label: __( 'Workflows', 'vip-workflows' ),
			href: 'admin.php?page=vip-workflows',
		},
		{
			label: __( 'Sequences', 'vip-workflows' ),
			href: 'admin.php?page=vip-workflows-sequences',
		},
		{ label: current },
	];

	if ( loading ) {
		return (
			<AdminPage breadcrumbs={ breadcrumbs }>
				<Stack
					className="vip-workflows-loading"
					align="center"
					gap="sm"
				>
					<Spinner />
					{ __( 'Loading sequence…', 'vip-workflows' ) }
				</Stack>
			</AdminPage>
		);
	}

	// A read the editor cannot be built without failed. A failed options fetch
	// leaves us unable to validate post-type selections, or to know which
	// phases connect; a failed sequence read leaves no sequence at all, only
	// the id of the row a save would overwrite. Either way, block editing with
	// the error rather than render a canvas against data that is not there.
	if ( readFailed ) {
		return (
			<AdminPage breadcrumbs={ breadcrumbs }>
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			</AdminPage>
		);
	}

	const actions = (
		<>
			<Button
				variant="tertiary"
				onClick={ handleCancel }
				disabled={ saving }
			>
				{ __( 'Cancel', 'vip-workflows' ) }
			</Button>
			<Button
				variant="primary"
				onClick={ handleSave }
				isBusy={ saving }
				// Nothing to save is its own answer: a sequence that matches
				// what is stored has no write to make, and a button that stays
				// live says otherwise. The eighth screen in the plugin to say
				// it the same way — see getSaveButtonLabel.
				disabled={ saving || ! isDirty }
			>
				{ getSaveButtonLabel(
					saving,
					saveStatus,
					__( 'Save', 'vip-workflows' )
				) }
			</Button>
		</>
	);

	// Sequence-level settings, handed to the inspector whole. Phase sequences
	// use only the first three; the rest drive SequenceSettingsInspector.
	const sequenceSettings = {
		name,
		onNameChange: setName,
		description,
		onDescriptionChange: setDescription,
		isActive,
		onActiveChange: setIsActive,
		postTypes,
		selectedPostTypes,
		onTogglePostType: togglePostType,
		settings,
		onSettingsChange: setSettings,
		metadataFields,
		onMetadataChange: setMetadataFields,
		// Whether there is a row to delete, which a new sequence gains the
		// moment it is first saved.
		isNew: ! savedId,
		onDelete: handleDelete,
		deleting,
	};

	return (
		<AdminPage breadcrumbs={ breadcrumbs } actions={ actions } fullBleed>
			{ /* wpds-allow R7 -- the editor's positioning context (`position: relative`) for the canvas, the notices and the floating panel, not a flex container; a <Stack> would impose display:flex on it */ }
			<div className="wf-sequence-editor">
				<div className="wf-sequence-editor__canvas">
					{ ( error ||
						( saveRefused && saveBlockers.length > 0 ) ) && (
						<div className="wf-sequence-editor__notice">
							<Notice
								status="error"
								isDismissible
								onRemove={ () => {
									setError( null );
									setSaveRefused( false );
								} }
								// Said in words rather than left to be derived
								// from the markup. `Notice` announces whatever
								// it renders, and derives the announcement by
								// running `renderToString` over its children
								// mid-render — which calls any component in
								// there, hooks and all, inside `Notice`'s own
								// render. A list whose length changes then
								// changes how many hooks `Notice` appears to
								// call, and React refuses the next render. A
								// string is read as given and renders nothing.
								spokenMessage={
									error || saveBlockers.join( ' ' )
								}
							>
								{ error ? (
									error
								) : (
									<SaveBlockers reasons={ saveBlockers } />
								) }
							</Notice>
						</div>
					) }
					{ repairReport && (
						<div className="wf-sequence-editor__notice">
							<Notice
								status="warning"
								isDismissible
								onRemove={ () => setRepairReport( null ) }
							>
								{ repairReport }
							</Notice>
						</div>
					) }
					{ missingRegions.length > 0 && (
						<div className="wf-sequence-editor__notice">
							<Notice
								status="warning"
								isDismissible={ false }
								actions={ [
									{
										label: repairing
											? __(
													'Assigning…',
													'vip-workflows'
											  )
											: __(
													'Assign default status',
													'vip-workflows'
											  ),
										onClick: repairRegions,
										disabled: repairing,
										variant: 'primary',
									},
								] }
							>
								{ sprintf(
									/* translators: %s: comma-separated stage keys. */
									__(
										'These stages have no status region and cannot be used until one is set: %s. Assigning the default puts them in Draft; drag any of them into another status’s section of the canvas afterwards.',
										'vip-workflows'
									),
									missingRegions.join( ', ' )
								) }
							</Notice>
						</div>
					) }
					<GraphCanvas
						stages={ stages }
						isPhase={ isPhase }
						warnings={ validation.warnings }
						regions={ regions }
						selectedNodeKey={
							selection?.type === 'node' ? selection.key : null
						}
						selectedEdgeId={
							selection?.type === 'edge'
								? edgeId(
										selection.from,
										selection.to,
										selection.outcome || null
								  )
								: null
						}
						selectedRegion={
							selection?.type === 'region'
								? selection.region
								: null
						}
						onConnectTransition={ handleConnect }
						onReconnectTransition={
							isPhase ? undefined : handleReconnect
						}
						onReconnectTransitionToNewStage={
							isPhase ? undefined : handleReconnectToNewStage
						}
						onSelectNode={ selectNode }
						onSelectEdge={ selectEdge }
						onSelectRegion={ selectRegion }
						onClearSelection={ clearSelection }
						onDeleteNode={ handleDeleteStage }
						onDeleteEdge={ handleDeleteTransition }
						onAddStageFromNode={
							isPhase ? undefined : handleAddStageFromNode
						}
						onInsertStageOnEdge={
							isPhase ? undefined : handleInsertStageOnEdge
						}
						onPlaceStage={ handlePlaceStage }
						onAddRegion={ () => setAddingRegion( true ) }
						onRemoveRegion={ handleRemoveRegion }
						connectable
						isValidConnection={ isValidConnection }
					/>
				</div>
				<Stack
					className="wf-sequence-editor__inspector"
					render={ <aside /> }
				>
					<Inspector
						selection={ selection }
						isPhase={ isPhase }
						stages={ stages }
						selectedStage={ selectedStage }
						selectedTransition={ selectedTransition }
						onSetRegionEntry={ handleSetRegionEntry }
						onRemoveRegion={ handleRemoveRegion }
						availableAgents={ availableAgents }
						availableRoles={ availableRoles }
						availableTools={ availableTools }
						toolsLoaded={ toolsLoaded }
						availableChannels={ availableChannels }
						onUpdateStage={ handleUpdateStage }
						onDeleteStage={ handleDeleteStage }
						onUpdateTransition={ handleUpdateTransition }
						onDeleteTransition={ handleDeleteTransition }
						onSelectEdge={ selectEdge }
						sequenceSettings={ sequenceSettings }
					/>
				</Stack>
			</div>
			{ addingRegion && (
				<AddPostStatusModal
					available={ REGION_ORDER.filter(
						( region ) => ! regions.includes( region )
					) }
					onAdd={ handleAddRegion }
					onClose={ () => setAddingRegion( false ) }
				/>
			) }
			{ confirmDialog }
		</AdminPage>
	);
}
