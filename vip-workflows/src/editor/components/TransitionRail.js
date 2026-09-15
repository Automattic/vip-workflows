/**
 * Transition Rail — the current stage and every way out of it, as one drawing.
 *
 * The rail offers moves, not the tools behind them. A transition's required
 * tools run on the server when it fires (StatusManager::run_transition_tools)
 * and a refusal comes back to the panel as the blocked-transition dialog, so
 * the writer's one decision is which way the post goes — a row per tool
 * beside the move read as a second button that did the same thing. A required
 * tool switched off site-wide still reaches the rail, as a `_locked`
 * transition carrying its reason (Sequence::lock_disabled_required_tools), and
 * renders like any other lock.
 *
 * @package
 */

import {
	useState,
	useEffect,
	useLayoutEffect,
	useRef,
	useCallback,
} from '@wordpress/element';
import { Button, Icon, Spinner } from '@wordpress/components';
import { check, close, error as errorTriangle } from '@wordpress/icons';
import { Badge, Stack, Text } from '@wordpress/ui';
import { speak } from '@wordpress/a11y';
import { useInstanceId } from '@wordpress/compose';
import { __, sprintf } from '@wordpress/i18n';
import { transitionLabel } from '../../common/transition-label';
import { railGeometry, ARROW_PATH, RAIL } from './transition-rail-geometry';
import '../../common/outcome-tones.css';
import '../../common/terminal-pill.css';
import './TransitionRail.css';

/**
 * The outcomes a stage agent can finish with, in reading order — the keys of
 * `agent.routing`, exactly as `graph-model.js` declares them for the canvas.
 * A local copy rather than an import because `graph-model` is the whole
 * mutation-oriented admin model, and these three strings are all the rail
 * needs of it.
 */
const AGENT_OUTCOMES = [ 'pass', 'fail', 'error' ];

/**
 * How long the taken agent outcome holds its pressed state before the panel
 * re-renders on the new stage, in ms.
 *
 * @type {number}
 */
const FLASH_MS = 700;

/**
 * The routed outcomes of an agent stage, labelled.
 *
 * Read from the sequence's `agent.routing` and the stage's own authored
 * transitions — never from the transitions payload, which is deliberately
 * empty while an agent owns the stage
 * (StatusManager::agent_owns_stage_exits).
 *
 * @param {?Object} stageConfig The agent stage's raw config.
 * @param {Array}   allStatuses Every stage's raw config.
 * @return {Array<{outcome: string, label: string}>} Routed outcomes in
 *                                                   reading order.
 */
function agentOutcomes( stageConfig, allStatuses ) {
	const routing = stageConfig?.agent?.routing || {};

	return AGENT_OUTCOMES.filter( ( outcome ) => routing[ outcome ] ).map(
		( outcome ) => {
			const targetKey = routing[ outcome ];
			const raw = ( stageConfig.transitions || [] ).find(
				( t ) => t.to === targetKey
			);
			const destination = ( allStatuses || [] ).find(
				( s ) => s.key === targetKey
			);

			return {
				outcome,
				label: transitionLabel( raw, destination?.label || targetKey ),
			};
		}
	);
}

/**
 * One fixed glyph per outcome — the sequence editor's grammar (StageNode's
 * OUTCOME_ICONS): pass is the check, fail the cross, error the triangle. The
 * round `caution` stays off this map for the same reason it stays off the
 * canvas: one warning shape per surface.
 */
const OUTCOME_ICONS = {
	pass: check,
	fail: close,
	error: errorTriangle,
};

/**
 * The outcome mark: the outcome's glyph, painted in its tone. It rides the
 * agent outcome button's icon slot, which owns the icon–label spacing.
 *
 * @param {Object} props         Component props.
 * @param {string} props.outcome 'pass' | 'fail' | 'error'.
 * @return {JSX.Element} The mark.
 */
function OutcomeMark( { outcome } ) {
	return (
		<Icon
			className={ `vip-workflows-rail__outcome vip-workflows-rail__outcome--${ outcome }` }
			icon={ OUTCOME_ICONS[ outcome ] }
			size={ 14 }
		/>
	);
}

/**
 * The transition rail.
 *
 * @param {Object}   props                 Component props.
 * @param {?Object}  props.current         The current stage's raw config.
 * @param {Array}    props.transitions     Permitted transitions (payload).
 * @param {Array}    props.allStatuses     Every stage's raw config.
 * @param {boolean}  props.agentPending    Whether a stage agent is working.
 * @param {boolean}  props.agentFailed     Whether the stage's agent failed in
 *                                         place. With the exits withheld
 *                                         (empty transitions payload) the rail
 *                                         keeps drawing the routed outcomes,
 *                                         disabled — the way out is the
 *                                         panel's Go back action, and an empty
 *                                         rail would misread as a
 *                                         role-filtered stage.
 * @param {?Object}  props.agentLastRun    The last resolved agent run
 *                                         ({stage_key, outcome, to}), when
 *                                         the server supplies it.
 * @param {boolean}  props.transitioning   Whether any transition is in
 *                                         flight.
 * @param {?string}  props.transitioningTo Destination of the in-flight
 *                                         transition.
 * @param {Function} props.onTransition    Called with a transition object and
 *                                         the clicked button element on click
 *                                         — the panel's own handler, confirms
 *                                         and input popovers included. The
 *                                         element anchors any input popover
 *                                         beside the row that asked for it.
 * @param {?string}  props.postStatus      The post's live core status, for
 *                                         the visibility badge — decoupled
 *                                         from the stage, since a post can
 *                                         sit at a post-publish stage
 *                                         without being live.
 * @return {JSX.Element} The rail.
 */
export function TransitionRail( {
	current,
	transitions,
	allStatuses,
	agentPending,
	agentFailed,
	agentLastRun,
	transitioning,
	transitioningTo,
	onTransition,
	postStatus,
} ) {
	const [ flash, setFlash ] = useState( null ); // { stage, outcome }
	const [ paths, setPaths ] = useState( null );

	const containerRef = useRef( null );
	const prevRef = useRef( null );
	const pathsSignatureRef = useRef( '' );
	const labelId = useInstanceId( TransitionRail, 'vip-workflows-rail-stage' );

	// Announce every move, and play the agent flash. The flash needs the
	// resolved outcome, which only `agent_last_run` can supply — matching on
	// the stage the run belonged to, so a coincidental stage change never
	// flashes a button nobody's routing produced. Without the field the rail
	// degrades to the announcement and the re-render.
	useEffect( () => {
		const prev = prevRef.current;
		prevRef.current = { current, agentPending };

		if ( ! prev || ! current || prev.current?.key === current.key ) {
			return;
		}

		if (
			prev.agentPending &&
			agentLastRun &&
			agentLastRun.stage_key === prev.current?.key &&
			agentLastRun.to === current.key
		) {
			setFlash( {
				stage: prev.current,
				outcome: agentLastRun.outcome,
			} );
			speak(
				sprintf(
					/* translators: 1: the agent stage's label, 2: the new stage's label. */
					__( '%1$s finished. Moved to %2$s.', 'vip-workflows' ),
					prev.current?.label || '',
					current.label || ''
				),
				'polite'
			);
			const timer = setTimeout( () => setFlash( null ), FLASH_MS );

			return () => clearTimeout( timer );
		}

		speak(
			sprintf(
				/* translators: %s: the new stage's label. */
				__( 'Moved to %s.', 'vip-workflows' ),
				current.label || ''
			),
			'polite'
		);
	}, [ current, agentPending, agentLastRun ] );

	// Measure the laid-out buttons and draw the rail from them, so the
	// drawing cannot drift from the things it annotates.
	const measure = useCallback( () => {
		const container = containerRef.current;
		if ( ! container ) {
			return;
		}

		const base = container.getBoundingClientRect();
		if ( base.height === 0 ) {
			return; // Not laid out (or jsdom) — nothing to draw against.
		}

		const mark = container.querySelector( '.vip-workflows-rail__mark' );
		const markRect = mark?.getBoundingClientRect();
		const top = markRect
			? Math.round( markRect.top - base.top + markRect.height / 2 )
			: RAIL.TRUNK_X;

		const rows = Array.from(
			container.querySelectorAll( '[data-rail-target]' )
		).map( ( el ) => {
			const rect = el.getBoundingClientRect();

			return {
				y: Math.round( rect.top - base.top + rect.height / 2 ),
			};
		} );

		const geometry = railGeometry( rows, { top } );
		const next = {
			...geometry,
			width: Math.round( base.width ),
			height: Math.round( base.height ),
		};
		const signature = JSON.stringify( next );

		if ( signature !== pathsSignatureRef.current ) {
			pathsSignatureRef.current = signature;
			setPaths( next );
		}
	}, [] );

	// One synchronous measure when the rendered shape changes, then the
	// ResizeObserver below for everything else (fonts arriving, the sidebar
	// resizing). Deliberately NOT on every render and NOT keyed on `paths`:
	// a layout effect that re-measures after its own setPaths render is one
	// unstable measurement away from React's nested-update limit taking the
	// whole editor down — with the observer, an unstable layout degrades to
	// an async correction instead of a crash.
	useLayoutEffect( () => {
		measure();
	}, [
		measure,
		transitions,
		current,
		agentPending,
		flash,
		transitioningTo,
	] );

	useLayoutEffect( () => {
		if (
			! containerRef.current ||
			typeof window.ResizeObserver !== 'function'
		) {
			return;
		}

		const observer = new window.ResizeObserver( measure );
		observer.observe( containerRef.current );

		return () => observer.disconnect();
	}, [ measure ] );

	if ( ! current ) {
		return null;
	}

	// The stage the actions describe: the just-left agent stage while its
	// outcome flashes, the live stage otherwise.
	const shownStage = flash ? flash.stage : current;
	const showAgent = Boolean( flash ) || agentPending;

	// A failure whose exits are withheld (the server released nothing because
	// the panel's Go back action is the way out) keeps the routed outcomes on
	// screen, disabled. Only when the failure DID release transitions (no
	// resolvable origin) does the rail render them as live buttons below.
	const holdFailedOutcomes =
		! showAgent && Boolean( agentFailed ) && ! transitions?.length;
	const isEnd =
		! showAgent && ! holdFailedOutcomes && Boolean( current.is_terminal );
	const isDeadEnd =
		! showAgent && ! holdFailedOutcomes && Boolean( current.is_dead_end );

	// A finished workflow, as opposed to a stopped one. Both flags can sit on
	// one stage, and where they do the dead end wins: stopping short is not
	// completing, so it keeps the neutral mark and the END pill rather than
	// the green check and the completion heading.
	const isCompleted = isEnd && ! isDeadEnd;

	let markContent;
	if ( flash ) {
		// The resolve beat: the spinner's work is done, the outcome button
		// carries the news, and the mark settles back to the plain dot.
		markContent = <span className="vip-workflows-rail__dot" />;
	} else if ( showAgent ) {
		markContent = <Spinner className="vip-workflows-rail__spinner" />;
	} else if ( isCompleted ) {
		markContent = <span className="vip-workflows-rail__done" />;
	} else if ( isDeadEnd ) {
		markContent = (
			<span className="vip-workflows-rail__dot vip-workflows-rail__dot--neutral" />
		);
	} else {
		markContent = <span className="vip-workflows-rail__dot" />;
	}

	const showHere = ! isEnd && ! showAgent;

	let actions = null;

	if ( showAgent || holdFailedOutcomes ) {
		// `null`, not the empty array `.map()` would leave: an AI stage that
		// routes no outcome yet has nothing to put in the group, and an empty
		// array is truthy — it would render the labelled group anyway. Every
		// other branch here assigns an element or nothing, so this is the one
		// that has to say so.
		const outcomeActions = agentOutcomes( shownStage, allStatuses ).map(
			( { outcome, label } ) => (
				<div className="vip-workflows-rail__group" key={ outcome }>
					{ /* The mark rides the Button's icon slot (the action
					     standard's home for a button's glyph), so the Button
					     owns the icon–label spacing too — but only if it can
					     see the label. `has-text`, which carries the gap and
					     the wider padding, is set from `!! icon && hasChildren`,
					     and `hasChildren` counts a non-empty STRING child or an
					     ARRAY of children. Wrapping the label in a lone <span>
					     is neither, so the class never landed and the icon-only
					     rule butted the glyph against the word. The label goes
					     in bare, exactly as the routed transitions below pass
					     theirs. */ }
					<Button
						variant="secondary"
						className="vip-workflows-rail__transition"
						data-rail-target=""
						disabled
						accessibleWhenDisabled
						isPressed={ flash?.outcome === outcome }
						icon={ <OutcomeMark outcome={ outcome } /> }
					>
						{ label }
					</Button>
				</div>
			)
		);
		actions = outcomeActions.length > 0 ? outcomeActions : null;
	} else if ( isCompleted ) {
		// Nothing, deliberately. The drawing is measured from the
		// `[data-rail-target]` elements in this column, and `railGeometry`
		// returns an empty drawing for zero rows — so an empty actions column
		// is also how the trunk and the arrowhead stop being drawn. An
		// arrowhead is the rail's word for "the post travels here", and a
		// finished workflow has nowhere left to travel; pointing one at a
		// label that only restates the ending would promise a move that does
		// not exist.
	} else if ( isDeadEnd ) {
		// A dead end still gets the pill: the post stopped somewhere the
		// sequence author marked as a stop, and unlike a completion that fact
		// is not already carried by the heading.
		actions = (
			<div
				className="wf-terminal-pill vip-workflows-rail__end"
				data-rail-target=""
			>
				<span className="wf-terminal-pill__label">
					{ __( 'End', 'vip-workflows' ) }
				</span>
			</div>
		);
	} else if ( ! transitions?.length ) {
		// Three empty states that must not impersonate each other: an AI stage
		// whose routed exits belong to its agent (reached job-less — e.g. a
		// zero-route agent stage, the trap the sequence editor warns about),
		// edges the sequence declares but role-filtering removed entirely
		// (a rule that HOLDS an edge — assignment, required metadata — leaves
		// it in the list as a _locked row instead, so this state means the
		// edges are gone, not held), and a stage that genuinely declares none
		// without wearing the dead-end flag.
		let emptyText;
		if ( current.agent?.ability_id ) {
			emptyText = __(
				'Moves from this stage belong to its AI agent.',
				'vip-workflows'
			);
		} else if ( ( current.transitions || [] ).length > 0 ) {
			emptyText = __(
				'Moves from this stage belong to other roles.',
				'vip-workflows'
			);
		} else {
			emptyText = __( 'This stage declares no moves.', 'vip-workflows' );
		}

		actions = (
			<Text
				variant="body-sm"
				render={ <p /> }
				className="vip-workflows-rail__empty"
			>
				{ emptyText }
			</Text>
		);
	} else {
		// The stage's one way forward carries the weight of the surface: a
		// single offered transition is the primary. Two or more stay level as
		// secondaries — promoting one of several would be the rail deciding
		// the editorial call the stage's author left open. Nor is a locked
		// move the primary: a disabled button cannot be the thing the user
		// came here to press.
		const soleTransition =
			transitions.length === 1 && ! transitions[ 0 ]._locked
				? transitions[ 0 ]
				: null;

		// Authored order, unsorted: the stage's author arranged these exits in
		// the stage inspector, and that arrangement is the only ranking the
		// sequence carries.
		actions = transitions.map( ( t ) => {
			const isLocked = Boolean( t._locked );
			const isBusy = transitioningTo === t.to;

			return (
				<div className="vip-workflows-rail__group" key={ t.to }>
					<Button
						variant={
							t === soleTransition ? 'primary' : 'secondary'
						}
						className="vip-workflows-rail__transition"
						data-rail-target=""
						onClick={ ( event ) =>
							onTransition( t, event.currentTarget )
						}
						isBusy={ isBusy }
						disabled={ isLocked || ( transitioning && ! isBusy ) }
						accessibleWhenDisabled
					>
						{ t.label }
					</Button>
					{ isLocked && t._locked_reason && (
						<Text
							variant="body-sm"
							render={ <p /> }
							className="vip-workflows-rail__help"
						>
							{ t._locked_reason }
						</Text>
					) }
				</div>
			);
		} );
	}

	return (
		// wpds-allow R7 -- the rail is a drawing anchored to its own box: the SVG track is positioned against this element, which no <Stack> contract covers.
		<div className="vip-workflows-rail" ref={ containerRef }>
			{ paths && (
				<svg
					className="vip-workflows-rail__track"
					aria-hidden="true"
					focusable="false"
					width={ paths.width }
					height={ paths.height }
				>
					{ paths.lines.map( ( d, i ) => (
						<path key={ `l${ i }` } d={ d } />
					) ) }
					{ paths.heads.map( ( { x, y }, i ) => (
						<path
							key={ `h${ i }` }
							d={ ARROW_PATH }
							className="vip-workflows-rail__track-head"
							transform={ `translate(${ x } ${ y })` }
						/>
					) ) }
				</svg>
			) }
			<Stack
				className="vip-workflows-rail__now"
				direction="row"
				align="flex-start"
				gap="sm"
			>
				<span className="vip-workflows-rail__mark">
					{ markContent }
				</span>
				<Stack direction="column">
					<Stack direction="row" align="center" gap="sm">
						{ /* An ending announces the ending, not the room the
						     post stopped in: at a completed workflow the
						     heading is that fact, and the stage's own name
						     drops to the line below. Demoted, never dropped —
						     `is_terminal` is not a synonym for success (the
						     seeded hiring sequence marks both "Hired" and
						     "Rejected" terminal), so which ending was reached
						     still has to be readable. */ }
						<Text
							variant="heading-md"
							id={ labelId }
							className="vip-workflows-rail__stage"
						>
							{ isCompleted
								? __( 'Workflow completed', 'vip-workflows' )
								: shownStage?.label }
						</Text>
						{ /* Core visibility, which the stage does not imply: a
						     post can sit at a post-publish stage without being
						     live. Withheld exactly where the heading has been
						     given over to the completion statement — there a
						     second green claim beside it names no fact the
						     reader is still missing. It is `isCompleted` and
						     not `isEnd` that governs, because the two are not
						     the same stage set: a stage carrying both flags
						     keeps its own name in the heading, and "Abandoned"
						     does not tell anyone the post is publicly live. */ }
						{ ( postStatus === 'publish' ||
							postStatus === 'future' ) &&
							! isCompleted && (
								<Badge
									intent={
										postStatus === 'future'
											? 'informational'
											: 'stable'
									}
								>
									{ postStatus === 'future'
										? __( 'Scheduled', 'vip-workflows' )
										: __( 'Live', 'vip-workflows' ) }
								</Badge>
							) }
					</Stack>
					{ showHere && (
						<Text
							variant="body-sm"
							className="vip-workflows-rail__here"
						>
							{ __( 'you are here', 'vip-workflows' ) }
						</Text>
					) }
					{ isCompleted && (
						<Text
							variant="body-sm"
							className="vip-workflows-rail__ending"
						>
							{ shownStage?.label }
						</Text>
					) }
					{ /* Descriptions exist only on seeded and imported
					     sequences — the graph editor exposes no field for one —
					     so a stage without one is ordinary, not missing data. */ }
					{ ! flash && shownStage?.description && (
						<Text
							variant="body-sm"
							className="vip-workflows-rail__description"
						>
							{ shownStage.description }
						</Text>
					) }
				</Stack>
			</Stack>
			{ /* No group when there is nothing in it: an empty labelled group
			     announces itself to a screen reader with nothing to announce,
			     and its own top margin would leave the completed state a band
			     of dead space under the heading. */ }
			{ actions && (
				<Stack
					className="vip-workflows-rail__actions"
					direction="column"
					gap="sm"
					role="group"
					aria-labelledby={ labelId }
				>
					{ actions }
				</Stack>
			) }
		</div>
	);
}
