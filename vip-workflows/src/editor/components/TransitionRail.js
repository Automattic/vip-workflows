/**
 * Transition Rail — the current stage, every way out of it, and the checks
 * each way out depends on, as one drawing.
 *
 * The rail replaces two things that described one relationship from opposite
 * ends: the panel's flat stack of transition buttons, and a separate Tools
 * card that grouped the same transitions' required checks under "→
 * Destination" headings. A transition's checks are attributes of the
 * transition, so they hang under its button — with no edge and no arrowhead,
 * because an edge in this graph means the post travels along it, and a check
 * is not somewhere the post goes.
 *
 * Three rules the data forces, verified rather than assumed:
 *
 * - Checks are pre-flight, not a checklist. The server re-runs every required
 *   check when a transition fires (StatusManager::transition), so a cached
 *   failure never disables a button here — the server may disagree with the
 *   cache, and a button that refuses a move the server would allow is worse
 *   than one that fires and returns the block message.
 * - Results are shared per post + ability (vip_ability_results has no
 *   transition column). A check required by two exits renders under both and
 *   one run updates both.
 * - A disabled required tool blocks at transition time. It stays visible here,
 *   disabled with the same remedy, while the transition payload carries the
 *   lock that prevents the impossible move from being offered.
 *
 * @package
 */

import {
	useState,
	useEffect,
	useLayoutEffect,
	useRef,
	useCallback,
	useMemo,
	Fragment,
} from '@wordpress/element';
import { Button, Icon, Spinner } from '@wordpress/components';
import {
	check,
	close,
	error as errorTriangle,
	lineSolid,
} from '@wordpress/icons';
import { Badge, Collapsible, Stack, Text } from '@wordpress/ui';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import { speak } from '@wordpress/a11y';
import { useInstanceId } from '@wordpress/compose';
import { __, sprintf } from '@wordpress/i18n';
import { isBefore } from '../../common/datetime';
import { transitionLabel } from '../../common/transition-label';
import { settleAppliedField } from '../../common/settle-applied-field';
import { CheckResultsModal, HelperResultModal } from './ToolResultModals';
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
 * How many of a check result's issues stay on screen before the rest go
 * behind a disclosure.
 *
 * @type {number}
 */
const VISIBLE_ISSUE_COUNT = 3;

/**
 * How long the taken agent outcome holds its pressed state before the panel
 * re-renders on the new stage, in ms.
 *
 * @type {number}
 */
const FLASH_MS = 700;

/**
 * Whether the post has been edited since this result was recorded. A pass
 * from before the last edit is a promise the component can't keep, so it must
 * not wear the same mark as a current one.
 *
 * Both operands are site-local wall clock — `created_at` is written by
 * `current_time( 'mysql' )`, `modified` is the editor's own attribute — so
 * both are read on the site's clock, by the module that owns every clock in
 * this plugin.
 *
 * @param {?Object} result   A stored ability result.
 * @param {?string} modified The post's `modified` attribute.
 * @return {boolean} True when the result predates the last edit.
 */
function isStaleResult( result, modified ) {
	return isBefore( result?.created_at, modified );
}

/**
 * One issue's effective severity — the mirror of
 * `StatusManager::run_transition_tools()`: hard when the site's `check_modes`
 * grades the issue's check key hard, or when the tool itself declared the
 * issue `error`/`hard`.
 *
 * @param {Object}  issue      One issue from a check result's output.
 * @param {?Object} checkModes The ability's per-check enforcement modes.
 * @return {string} 'hard' or 'soft'.
 */
function issueSeverity( issue, checkModes ) {
	const checkKey = issue.check_key ?? issue.type ?? 'general';
	const declared = issue.severity ?? 'warning';

	return checkModes?.[ checkKey ] === 'hard' ||
		'error' === declared ||
		'hard' === declared
		? 'hard'
		: 'soft';
}

/**
 * The indicator state for a stored result.
 *
 * @param {?Object} result A stored ability result.
 * @return {string} 'none' | 'pass' | 'fail' | 'error'.
 */
function indicatorState( result ) {
	if ( ! result ) {
		return 'none';
	}
	// A run that could not complete has not passed; the amber tone is the
	// server's own treatment of an execution error (a soft warning).
	if ( result.success === false || result.error ) {
		return 'error';
	}

	switch ( result.output?.status ) {
		case 'pass':
			return 'pass';
		case 'fail':
			return 'fail';
		case 'warning':
			return 'error';
		default:
			// A result that reports no status (a helper's stored row) has not
			// reported a verdict; hollow, not invented.
			return 'none';
	}
}

/**
 * What the indicator's state is called — its tooltip, and (when stale) the
 * visible note under the check row. One phrasing for both, because they are
 * the same fact told twice: once for hover, once on screen.
 *
 * @param {string}  state 'none' | 'pass' | 'fail' | 'error'.
 * @param {boolean} stale Whether the result predates the last edit.
 * @return {string} A short label.
 */
function indicatorTitle( state, stale ) {
	if ( 'none' === state ) {
		return __( 'Not run yet', 'vip-workflow' );
	}

	const base = {
		pass: __( 'Passed', 'vip-workflow' ),
		fail: __( 'Failing', 'vip-workflow' ),
		error: __( 'Warning', 'vip-workflow' ),
	}[ state ];

	return stale
		? sprintf(
				/* translators: %s: the check's last outcome (Passed / Failing / Warning). */
				__( '%s — before the latest edit', 'vip-workflow' ),
				base
		  )
		: base;
}

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
 * canvas: one warning shape per surface. `none` is not an outcome, so it gets
 * the dash a blank value gets, not a glyph pretending to be a verdict.
 */
const OUTCOME_ICONS = {
	none: lineSolid,
	pass: check,
	fail: close,
	error: errorTriangle,
};

/**
 * The outcome mark: the outcome's glyph, painted in its tone — always at full
 * tone, stale or not. The drawn dot wore age as a ring of its tone; a glyph
 * has no hollow variant, and fading the tone instead put every outcome color
 * under the 3:1 non-text contrast floor. So the mark states only the verdict,
 * and age is carried entirely in words: the indicator's title and the visible
 * stale note name both facts. The `stale` class stays on the element as the
 * state hook, drawing nothing. The neutral dash means "never asked".
 *
 * @param {Object}  props       Component props.
 * @param {string}  props.state 'none' | 'pass' | 'fail' | 'error'.
 * @param {boolean} props.stale Whether the result predates the last edit.
 * @return {JSX.Element} The mark.
 */
function OutcomeMark( { state, stale } ) {
	const classes = [
		'vip-workflow-rail__outcome',
		`vip-workflow-rail__outcome--${ state }`,
		stale && 'vip-workflow-rail__outcome--stale',
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<Icon
			className={ classes }
			icon={ OUTCOME_ICONS[ state ] }
			size={ 14 }
		/>
	);
}

/**
 * The issue list under a check result: one severity roll-up, then the issues,
 * with everything past the first few behind a disclosure so one noisy tool
 * cannot push every other row off the sidebar.
 *
 * Severity is graded per issue (site `check_modes` plus the tool's own
 * declaration), so one run can return a mix: the roll-up states the dominant
 * grade and individual lines are marked only when they differ from it.
 *
 * @param {Object}   props            Component props.
 * @param {Array}    props.issues     Issues from the result's output.
 * @param {?Object}  props.checkModes The ability's per-check modes.
 * @param {Function} props.onOpenFull Opens the full result dialog.
 * @return {JSX.Element} The list.
 */
function CheckIssues( { issues, checkModes, onOpenFull } ) {
	const [ open, setOpen ] = useState( false );

	const graded = issues.map( ( issue ) => ( {
		issue,
		severity: issueSeverity( issue, checkModes ),
	} ) );
	const rollup = graded.some( ( g ) => 'hard' === g.severity )
		? 'hard'
		: 'soft';

	const line = ( { issue, severity }, idx ) => (
		<Text
			key={ idx }
			variant="body-sm"
			render={ <div /> }
			className={ `vip-workflow-rail__issue ${
				severity !== rollup
					? `vip-workflow-rail__issue--${ severity }`
					: ''
			}` }
		>
			{ severity !== rollup && (
				<span className="vip-workflow-rail__issue-grade">
					{ 'hard' === severity
						? __( 'Blocks:', 'vip-workflow' )
						: __( 'Warns:', 'vip-workflow' ) }
				</span>
			) }
			{ issue.message || issue.description || '' }
		</Text>
	);

	const rest = graded.slice( VISIBLE_ISSUE_COUNT );

	const footer = (
		<Button
			variant="link"
			size="small"
			className="vip-workflow-rail__full-result"
			onClick={ onOpenFull }
		>
			{ __( 'Open full result', 'vip-workflow' ) }
		</Button>
	);

	const rollupLine = (
		<Text
			variant="body-sm"
			render={ <div /> }
			className={ `vip-workflow-rail__rollup vip-workflow-rail__rollup--${ rollup }` }
		>
			{ 'hard' === rollup
				? __( 'Blocks this move.', 'vip-workflow' )
				: __( 'Warns before moving.', 'vip-workflow' ) }
		</Text>
	);

	if ( rest.length === 0 ) {
		return (
			<Stack
				className="vip-workflow-rail__issues"
				direction="column"
				gap="xs"
			>
				{ rollupLine }
				{ graded.map( line ) }
				{ footer }
			</Stack>
		);
	}

	return (
		<Collapsible.Root open={ open } onOpenChange={ setOpen }>
			<Stack
				className="vip-workflow-rail__issues"
				direction="column"
				gap="xs"
			>
				{ rollupLine }
				{ graded.slice( 0, VISIBLE_ISSUE_COUNT ).map( line ) }
				{ /* The panel stays a plain block, never a <Stack>: a
				     `display: flex` of its own would out-rank the `hidden`
				     attribute Base UI shuts it with. The column inside it
				     carries the flex. */ }
				<Collapsible.Panel>
					<Stack direction="column" gap="xs">
						{ rest.map( ( g, idx ) =>
							line( g, VISIBLE_ISSUE_COUNT + idx )
						) }
					</Stack>
				</Collapsible.Panel>
				<Collapsible.Trigger className="vip-workflow-rail__more">
					{ open
						? __( 'Show less', 'vip-workflow' )
						: sprintf(
								// translators: %d: how many further issues the tool reported.
								__( '+ %d more', 'vip-workflow' ),
								rest.length
						  ) }
				</Collapsible.Trigger>
				{ footer }
			</Stack>
		</Collapsible.Root>
	);
}

/**
 * The transition rail.
 *
 * @param {Object}   props                 Component props.
 * @param {number}   props.postId          Post ID.
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
 * @param {number}   props.resultsVersion  Bumped by the panel after every
 *                                         transition attempt, so the rail
 *                                         re-reads the results the server
 *                                         just wrote.
 * @param {?string}  props.postStatus      The post's live core status, for
 *                                         the visibility badge — decoupled
 *                                         from the stage, since a post can
 *                                         sit at a post-publish stage
 *                                         without being live.
 * @return {JSX.Element} The rail.
 */
export function TransitionRail( {
	postId,
	current,
	transitions,
	allStatuses,
	agentPending,
	agentFailed,
	agentLastRun,
	transitioning,
	transitioningTo,
	onTransition,
	resultsVersion,
	postStatus,
} ) {
	const [ abilities, setAbilities ] = useState( [] );
	const [ results, setResults ] = useState( {} );
	const [ runningCheck, setRunningCheck ] = useState( null );
	const [ flash, setFlash ] = useState( null ); // { stage, outcome }
	const [ paths, setPaths ] = useState( null );
	const [ fullResult, setFullResult ] = useState( null ); // { ability, result }
	const [ helperModal, setHelperModal ] = useState( null ); // { ability, result }
	const [ applying, setApplying ] = useState( false );
	const [ regenerating, setRegenerating ] = useState( false );

	const containerRef = useRef( null );
	const prevRef = useRef( null );
	const pathsSignatureRef = useRef( '' );
	const labelId = useInstanceId( TransitionRail, 'vip-workflow-rail-stage' );

	const { editPost } = useDispatch( editorStore );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );

	const modified = useSelect(
		( select ) =>
			select( editorStore ).getEditedPostAttribute( 'modified' ),
		[]
	);

	const currentKey = current?.key;

	// The sidebar-eligible checks, by id. Disabled required tools stay in this
	// list because they are hard blockers; their row explains why neither the
	// check nor its transition can run.
	useEffect( () => {
		if ( ! postId ) {
			return;
		}

		let cancelled = false;

		apiFetch( { path: `/vip-workflow/v1/abilities?post_id=${ postId }` } )
			.then( ( data ) => {
				if ( cancelled ) {
					return;
				}
				setAbilities(
					( data || [] ).filter(
						( ability ) => ! ability.meta?.has_sidebar_panel
					)
				);
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setAbilities( [] );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ postId, currentKey ] );

	const abilitiesById = useMemo( () => {
		const map = {};
		for ( const ability of abilities ) {
			map[ ability.id ] = ability;
		}
		return map;
	}, [ abilities ] );

	// The latest stored result per required ability — one request each,
	// because "latest per ability" is what the rail shows and the results
	// route pages the whole post's history otherwise.
	useEffect( () => {
		if ( ! postId || abilities.length === 0 ) {
			return;
		}

		let cancelled = false;

		Promise.all(
			abilities.map( ( ability ) =>
				apiFetch( {
					path: `/vip-workflow/v1/posts/${ postId }/ability-results?ability_id=${ encodeURIComponent(
						ability.id
					) }&limit=1`,
				} ).catch( () => [] )
			)
		).then( ( lists ) => {
			if ( cancelled ) {
				return;
			}
			const byAbility = {};
			lists.forEach( ( list, index ) => {
				if ( list?.[ 0 ] ) {
					byAbility[ abilities[ index ].id ] = list[ 0 ];
				}
			} );
			setResults( byAbility );
		} );

		return () => {
			cancelled = true;
		};
	}, [ postId, abilities, resultsVersion ] );

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
					__( '%1$s finished. Moved to %2$s.', 'vip-workflow' ),
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
				__( 'Moved to %s.', 'vip-workflow' ),
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

		const mark = container.querySelector( '.vip-workflow-rail__mark' );
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
		abilities,
		results,
		runningCheck,
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

	const runCheck = async ( ability ) => {
		if ( runningCheck || ! postId ) {
			return null;
		}

		setRunningCheck( ability.id );

		try {
			const result = await apiFetch( {
				path: `/vip-workflow/v1/abilities/${ ability.id }/run`,
				method: 'POST',
				data: { post_id: postId },
			} );

			if ( ability.meta?.type === 'helper' ) {
				setHelperModal( { ability, result } );
			} else {
				setResults( ( prev ) => ( {
					...prev,
					[ ability.id ]: result,
				} ) );
				speak(
					result?.output?.status === 'pass'
						? sprintf(
								/* translators: %s: the check's name. */
								__( '%s passed.', 'vip-workflow' ),
								ability.label || ability.name
						  )
						: sprintf(
								/* translators: %s: the check's name. */
								__(
									'%s finished with issues.',
									'vip-workflow'
								),
								ability.label || ability.name
						  ),
					'polite'
				);
			}

			return result;
		} catch ( err ) {
			if ( ability.meta?.type === 'helper' ) {
				setHelperModal( { ability, result: { error: err.message } } );
			} else {
				// The same treatment the server gives a tool that could not
				// run at transition time: not passed, reported, amber.
				setResults( ( prev ) => ( {
					...prev,
					[ ability.id ]: {
						success: false,
						error:
							err.message ||
							__(
								'Check could not be completed',
								'vip-workflow'
							),
					},
				} ) );
				speak(
					sprintf(
						/* translators: %s: the check's name. */
						__( '%s could not be completed.', 'vip-workflow' ),
						ability.label || ability.name
					),
					'polite'
				);
			}
			return null;
		} finally {
			setRunningCheck( null );
		}
	};

	const handleApply = async ( value ) => {
		const field = helperModal?.ability?.meta?.apply_field;
		if ( ! value || ! field ) {
			return;
		}

		setApplying( true );

		try {
			await editPost( { [ field ]: value } );
			// Best-effort flourish; see settleAppliedField for why it cannot throw.
			settleAppliedField( field );
			createSuccessNotice(
				sprintf(
					// translators: %s: the post field name that was applied (e.g. Excerpt, Title).
					__(
						'%s applied! Save the post to keep it.',
						'vip-workflow'
					),
					field.charAt( 0 ).toUpperCase() + field.slice( 1 )
				),
				{ type: 'snackbar' }
			);
			setHelperModal( null );
		} catch ( err ) {
			createErrorNotice(
				err.message || __( 'Failed to apply.', 'vip-workflow' ),
				{ type: 'snackbar' }
			);
		} finally {
			setApplying( false );
		}
	};

	const handleRegenerate = async () => {
		if ( ! helperModal ) {
			return;
		}

		setRegenerating( true );
		const result = await runCheck( helperModal.ability );
		if ( result ) {
			setHelperModal( { ability: helperModal.ability, result } );
		}
		setRegenerating( false );
	};

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
		markContent = <span className="vip-workflow-rail__dot" />;
	} else if ( showAgent ) {
		markContent = <Spinner className="vip-workflow-rail__spinner" />;
	} else if ( isCompleted ) {
		markContent = <span className="vip-workflow-rail__done" />;
	} else if ( isDeadEnd ) {
		markContent = (
			<span className="vip-workflow-rail__dot vip-workflow-rail__dot--neutral" />
		);
	} else {
		markContent = <span className="vip-workflow-rail__dot" />;
	}

	const showHere = ! isEnd && ! showAgent;

	/**
	 * One check dependency row plus its details: the state indicator sits
	 * outside the control, because the state belongs to a shared, timestamped
	 * result row and the button acts on the tool — two objects with two
	 * lifetimes.
	 *
	 * @param {string} abilityId A required tool id.
	 * @return {?JSX.Element} The row, or null for a tool the rail must omit.
	 */
	const renderCheck = ( abilityId ) => {
		const ability = abilitiesById[ abilityId ];
		if ( ! ability ) {
			// Unregistered or panel-owned abilities have no row this rail can run.
			return null;
		}

		const isDisabled = ability.enabled === false;
		const result = isDisabled ? null : results[ ability.id ];
		const isRunning = runningCheck === ability.id;
		const state = indicatorState( result );
		const stale = ! isRunning && isStaleResult( result, modified );
		const issues =
			! isRunning && Array.isArray( result?.output?.issues )
				? result.output.issues
				: [];
		const runError =
			! isRunning &&
			result &&
			( result.success === false || result.error );

		return (
			<Fragment key={ ability.id }>
				<Stack
					className="vip-workflow-rail__dep"
					direction="row"
					align="center"
					gap="sm"
				>
					<span
						className="vip-workflow-rail__dep-indicator"
						title={
							isRunning
								? __( 'Running', 'vip-workflow' )
								: indicatorTitle( state, stale )
						}
					>
						{ isRunning ? (
							<Spinner className="vip-workflow-rail__dep-spinner" />
						) : (
							<OutcomeMark state={ state } stale={ stale } />
						) }
					</span>
					<Button
						variant="secondary"
						size="compact"
						className="vip-workflow-rail__check"
						onClick={ () => runCheck( ability ) }
						isBusy={ isRunning }
						disabled={
							isDisabled || Boolean( runningCheck ) || ! postId
						}
						accessibleWhenDisabled
					>
						{ ability.label || ability.name }
					</Button>
				</Stack>
				{ isDisabled && (
					<Text
						variant="body-sm"
						render={ <div /> }
						className="vip-workflow-rail__issues vip-workflow-rail__rollup--hard"
					>
						{ __(
							'This required check is switched off. Re-enable it, or remove it from this transition.',
							'vip-workflow'
						) }
					</Text>
				) }
				{ /* The note carries the verdict AND the age: the mark stays
				     full-tone (fading it failed non-text contrast) and the
				     indicator's title is hover-only, so this line is where
				     both facts are actually readable. */ }
				{ stale && (
					<Text
						variant="body-sm"
						render={ <div /> }
						className="vip-workflow-rail__stale-note"
					>
						{ indicatorTitle( state, true ) }
					</Text>
				) }
				{ runError && (
					<Text
						variant="body-sm"
						render={ <div /> }
						className="vip-workflow-rail__issues vip-workflow-rail__rollup--soft"
					>
						{ result.error ||
							__(
								'Check could not be completed',
								'vip-workflow'
							) }
					</Text>
				) }
				{ ! runError && issues.length > 0 && (
					<CheckIssues
						issues={ issues }
						checkModes={ ability.check_modes }
						onOpenFull={ () =>
							setFullResult( { ability, result } )
						}
					/>
				) }
			</Fragment>
		);
	};

	let actions = null;

	if ( showAgent || holdFailedOutcomes ) {
		// `null`, not the empty array `.map()` would leave: an AI stage that
		// routes no outcome yet has nothing to put in the group, and an empty
		// array is truthy — it would render the labelled group anyway. Every
		// other branch here assigns an element or nothing, so this is the one
		// that has to say so.
		const outcomeActions = agentOutcomes( shownStage, allStatuses ).map(
			( { outcome, label } ) => (
				<div className="vip-workflow-rail__group" key={ outcome }>
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
						className="vip-workflow-rail__transition"
						data-rail-target=""
						disabled
						accessibleWhenDisabled
						isPressed={ flash?.outcome === outcome }
						icon={
							<OutcomeMark state={ outcome } stale={ false } />
						}
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
				className="wf-terminal-pill vip-workflow-rail__end"
				data-rail-target=""
			>
				<span className="wf-terminal-pill__label">
					{ __( 'End', 'vip-workflow' ) }
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
				'vip-workflow'
			);
		} else if ( ( current.transitions || [] ).length > 0 ) {
			emptyText = __(
				'Moves from this stage belong to other roles.',
				'vip-workflow'
			);
		} else {
			emptyText = __( 'This stage declares no moves.', 'vip-workflow' );
		}

		actions = (
			<Text
				variant="body-sm"
				render={ <p /> }
				className="vip-workflow-rail__empty"
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
				<div className="vip-workflow-rail__group" key={ t.to }>
					<Button
						variant={
							t === soleTransition ? 'primary' : 'secondary'
						}
						className="vip-workflow-rail__transition"
						data-rail-target=""
						onClick={ ( event ) =>
							onTransition( t, event.currentTarget )
						}
						isBusy={ isBusy }
						disabled={
							isLocked ||
							( transitioning && ! isBusy ) ||
							Boolean( runningCheck )
						}
						accessibleWhenDisabled
					>
						{ t.label }
					</Button>
					{ isLocked && t._locked_reason && (
						<Text
							variant="body-sm"
							render={ <p /> }
							className="vip-workflow-rail__help"
						>
							{ t._locked_reason }
						</Text>
					) }
					{ ( t.required_tools || [] ).map( renderCheck ) }
				</div>
			);
		} );
	}

	return (
		// wpds-allow R7 -- the rail is a drawing anchored to its own box: the SVG track is positioned against this element, which no <Stack> contract covers.
		<div className="vip-workflow-rail" ref={ containerRef }>
			{ paths && (
				<svg
					className="vip-workflow-rail__track"
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
							className="vip-workflow-rail__track-head"
							transform={ `translate(${ x } ${ y })` }
						/>
					) ) }
				</svg>
			) }
			<Stack
				className="vip-workflow-rail__now"
				direction="row"
				align="flex-start"
				gap="sm"
			>
				<span className="vip-workflow-rail__mark">{ markContent }</span>
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
							className="vip-workflow-rail__stage"
						>
							{ isCompleted
								? __( 'Workflow Completed', 'vip-workflow' )
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
										? __( 'Scheduled', 'vip-workflow' )
										: __( 'Live', 'vip-workflow' ) }
								</Badge>
							) }
					</Stack>
					{ showHere && (
						<Text
							variant="body-sm"
							className="vip-workflow-rail__here"
						>
							{ __( 'you are here', 'vip-workflow' ) }
						</Text>
					) }
					{ isCompleted && (
						<Text
							variant="body-sm"
							className="vip-workflow-rail__ending"
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
							className="vip-workflow-rail__description"
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
					className="vip-workflow-rail__actions"
					direction="column"
					gap="sm"
					role="group"
					aria-labelledby={ labelId }
				>
					{ actions }
				</Stack>
			) }

			{ helperModal && (
				<HelperResultModal
					result={ helperModal.result }
					toolLabel={
						helperModal.ability.label || helperModal.ability.name
					}
					onClose={ () => setHelperModal( null ) }
					onApply={
						helperModal.ability.meta?.apply_field
							? handleApply
							: null
					}
					onRegenerate={ handleRegenerate }
					applying={ applying }
					regenerating={ regenerating }
					requirementGroups={
						helperModal.ability.availability?.groups || []
					}
					resultType={ helperModal.ability.meta?.result_type }
				/>
			) }

			{ fullResult && (
				<CheckResultsModal
					result={ fullResult.result }
					toolLabel={
						fullResult.ability.label || fullResult.ability.name
					}
					onClose={ () => setFullResult( null ) }
					requirementGroups={
						fullResult.ability.availability?.groups || []
					}
				/>
			) }
		</div>
	);
}
