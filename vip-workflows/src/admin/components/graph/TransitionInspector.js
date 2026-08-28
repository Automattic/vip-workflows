/**
 * TransitionInspector — options for the selected transition (edge).
 *
 * The same fields the old SequenceEditor crammed inline under each stage, now
 * scoped to one transition and grouped into plain-language sections: who may
 * act, what must be true first, what to capture, restrict to an assignee, who to
 * tell, where it shows. Reuses `AssignmentInputConfig` / `RequiresAssignmentConfig`
 * unchanged.
 *
 * The component is controlled: it never mutates the transition, it computes the
 * next field values and calls `onChange( partialTransition )`, which the editor
 * merges via the graph model. Removing a value passes `undefined` so it drops
 * out on JSON serialization.
 *
 * Two of the fields are lists of everything the site offers — the roles that may
 * use the transition, the channels it notifies — and both spend one line here
 * and open their checkboxes in a popover (`InspectorChoiceRow`). Flat, they took
 * the panel's height in proportion to how many roles and channels the site had
 * installed, whether or not this transition used any of them, and pushed the
 * fields under them out of sight.
 *
 * A `disabled` transition still opens all of this. It belongs to a stage whose
 * agent owns every way out, so nobody can use it — but its configuration is
 * intact and becomes live again the moment the agent is taken off the stage or
 * an outcome is routed along it. Editing what is currently unusable is the point:
 * the panel says so at the top rather than locking fields the author is setting
 * up for later.
 *
 * A *shared* transition says so at the top too, and for a sharper reason. A
 * stage holds at most one transition per target, so an agent routing two
 * outcomes to one destination puts both of them on one record: the canvas draws
 * an edge per outcome, each opens this panel, and each panel is the same one.
 * `sharedOutcomes` names everybody standing on it, so a required tool set here
 * is visibly set for all of them rather than looking like it belongs to the
 * edge that was clicked.
 *
 * @package
 */

import { TextControl, ToggleControl, Notice } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { __, _n, sprintf } from '@wordpress/i18n';
import { requirementText } from '../../../common/AgentRequirements';
import {
	AssignmentInputConfig,
	RequiresAssignmentConfig,
	expandRequiresAssignment,
} from '../TransitionAssignmentConfig';
import InspectorShell from './InspectorShell';
import InspectorSection from './InspectorSection';
import InspectorChoiceRow from './InspectorChoiceRow';
import InspectorDangerZone from './InspectorDangerZone';
import InspectorFieldList, {
	InspectorFieldListAdd,
} from './InspectorFieldList';
import {
	agentOutcomeLabel,
	agentOutcomeNames,
	derivedTransitionLabel,
} from './graph-model';

/**
 * The kinds of input a transition can be given.
 *
 * `none` is not among them any more. A transition that captures nothing now has
 * an empty list, which is the same statement without a magic value in it — and
 * "None" was never a kind of input, it was the absence of one wearing the
 * costume of a choice.
 */
const INPUT_TYPES = [
	{ label: __( 'Text area', 'vip-workflow' ), value: 'textarea' },
	{ label: __( 'Assignment', 'vip-workflow' ), value: 'assignment' },
];

/**
 * Name an input's kind, including one this build cannot author.
 *
 * A stored `text` input predates the editor offering `textarea` and still
 * collects a value at runtime, so its row has to say what it is rather than
 * render blank — the same courtesy `assigneeTypeOptions` pays a retired
 * assignee type.
 *
 * @param {string} type The input's stored type.
 * @return {string} A human-readable name for it.
 */
function inputTypeLabel( type ) {
	return INPUT_TYPES.find( ( t ) => t.value === type )?.label || type;
}

/**
 * Generate a stable id for a capture input.
 *
 * The same generator the single textarea note used, now minting an id for every
 * input that needs one. Timestamp plus randomness rather than the counter
 * `uniqueStageKey` uses: a stage key only has to be unique within its sequence,
 * while these ids end up inside `wfp_{note_id}_{slug}` meta keys that have to
 * stay distinct from every other sequence's on the same site — including ones
 * arriving later by import.
 *
 * @return {string} A fresh input id.
 */
function inputId() {
	return 'n' + Date.now() + Math.random().toString( 36 ).slice( 2, 7 );
}

/**
 * The storage key a note writes its value under.
 *
 * Derived from the id and the name, never typed: the runtime rebuilds the same
 * string from the same two parts when it stores the value
 * (`WorkflowPanel.handleTextInput`), so the two must agree exactly.
 *
 * @param {string} id   The input's stable id.
 * @param {string} name The note's name, as typed.
 * @return {string} The meta key, or an empty string for an unnamed note.
 */
function noteMetaKey( id, name ) {
	const slug = ( name || '' )
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '_' )
		.replace( /(^_|_$)/g, '' );

	return slug ? `wfp_${ id }_${ slug }` : '';
}

/**
 * A new input of the requested kind.
 *
 * A note gets its id here, at the moment it is added, so the key derived from it
 * is stable for the rest of the input's life however often it is renamed. An
 * assignment gets no key: its key is the slot name a `requires_assignment` gate
 * elsewhere in the sequence points at, so it is the author's to choose, and
 * `validateSequence` blocks the save until they have.
 *
 * @param {string} type The kind of input to create.
 * @return {Object} The new input.
 */
function createInput( type ) {
	if ( 'assignment' === type ) {
		return { type: 'assignment', assignee_type: 'user' };
	}

	return { type: 'textarea', note_id: inputId() };
}

/**
 * Why a tool on the list will not run, if it will not.
 *
 * The two ways it happens are not the same failure, and the executor treats them
 * differently, so the row does too. A tool switched off site-wide is skipped
 * outright — `run_transition_tools` checks `is_enabled` before it runs anything
 * — so the check the author thinks is guarding this transition is not there at
 * all. A tool whose dependencies are unmet does run, fails its gate, and lands as
 * a warning the author has to click past every time.
 *
 * Order matters: a tool that is both off and unconfigured is reported as off,
 * because that is the one that has to be undone first and the one the executor
 * notices first.
 *
 * @param {?Object} tool The serialized ability, or undefined when this site has none by that id.
 * @return {?Object} `{ short, full }`, or null when the tool is fine.
 */
function toolProblem( tool ) {
	if ( ! tool ) {
		return {
			short: __( 'Missing', 'vip-workflow' ),
			full: __(
				'No tool with this id is registered on this site — its plugin may be inactive. Saving this sequence drops it from the transition.',
				'vip-workflow'
			),
		};
	}

	if ( false === tool.enabled ) {
		return {
			short: __( 'Turned off', 'vip-workflow' ),
			full: __(
				'This tool is turned off for the whole site under Workflows → Tools, so this transition skips it and the check never runs.',
				'vip-workflow'
			),
		};
	}

	if ( false === tool.availability.available ) {
		return {
			short: __( 'Needs setup', 'vip-workflow' ),
			// An ability whose availability_callback answers a bare `false`
			// reports no requirements to name, which is the one case the
			// structured text has nothing to say about.
			full:
				requirementText( tool.availability.groups ) ||
				__(
					'This tool has required settings that are not yet configured.',
					'vip-workflow'
				),
		};
	}

	return null;
}

export default function TransitionInspector( {
	transition,
	sourceLabel,
	targetLabel,
	outcome = null,
	sharedOutcomes = null,
	disabled = false,
	availableRoles,
	availableTools,
	toolsLoaded = false,
	availableChannels,
	onChange,
	onRemove,
	simplified = false,
} ) {
	const inputs = transition.inputs || [];

	const toggleInArray = ( field, value ) => {
		const current = transition[ field ] || [];
		const next = current.includes( value )
			? current.filter( ( v ) => v !== value )
			: [ ...current, value ];
		onChange( { [ field ]: next } );
	};

	// The list is reported whole, the way every other field on this panel is:
	// the component computes the next value and hands it up, and the editor
	// merges it through the graph model.
	const updateInputs = ( next ) => onChange( { inputs: next } );

	const addInput = ( type ) =>
		updateInputs( [ ...inputs, createInput( type ) ] );

	// A transition may declare at most one assignment — it is the slot
	// `requires_assignment` gates on and the one `AssignmentManager` fills, so a
	// second names nothing distinguishable. Offered but disabled once one exists,
	// rather than withdrawn: the kind still exists, it is just spoken for, and a
	// menu that silently loses an entry reads as a bug.
	const hasAssignment = inputs.some(
		( input ) => 'assignment' === input.type
	);

	const addOptions = INPUT_TYPES.map( ( type ) => ( {
		...type,
		disabled: 'assignment' === type.value && hasAssignment,
	} ) );

	// One row per stored id, resolved against what this site offers. Every id
	// gets a row, including one nothing answers to: the list is the stored array
	// made visible, and an entry it declined to show would be an entry the author
	// cannot see, reorder or delete — which is the invisibility this list exists
	// to end, not a tidier version of it.
	const requiredToolIds = transition.required_tools || [];
	const requiredTools = requiredToolIds.map( ( id ) => ( {
		id,
		tool: availableTools.find( ( t ) => t.id === id ),
	} ) );

	// The menu offers what this transition can be given, and nothing else. Two
	// things are left out of it, for different reasons. A tool already on the
	// list is spoken for: a tool runs once per transition, so a second copy is a
	// second identical run and nothing else. A tool that cannot run on this site
	// — switched off site-wide, or with its dependencies unmet — is not on offer
	// either, because offering it greyed out reads as a capability withheld from
	// the reader rather than as one this site has not set up.
	//
	// The reason is still owed, but on the list rather than in the menu: a tool
	// the transition ALREADY carries says what is wrong with it on its own row
	// (`describeTool`), where the author has something to act on. What they
	// cannot have, they are not shown.
	const toolOptions = availableTools
		.filter(
			( tool ) =>
				! requiredToolIds.includes( tool.id ) && ! toolProblem( tool )
		)
		.map( ( tool ) => ( {
			value: tool.id,
			label: tool.label || tool.id,
			description: tool.description,
		} ) );

	const addTool = ( id ) =>
		onChange( { required_tools: [ ...requiredToolIds, id ] } );

	/**
	 * What a tool's row reads.
	 *
	 * A healthy tool leaves the value end of the row empty. There is nothing
	 * there worth saying — its category is the same word for every tool on the
	 * list — and a row that reports a state only when the state is worth
	 * reporting lets a glance down the list find the one that is wrong. The
	 * description moves into the tip, which is where a row with no popover keeps
	 * what it has to say.
	 *
	 * Until the abilities have loaded there is nothing to resolve against, so a
	 * row says only what the transition stores: its id, and no verdict. Calling
	 * every tool missing for the length of a fetch would be a false alarm.
	 *
	 * @param {Object}  entry      The stored id and the ability answering to it.
	 * @param {string}  entry.id   The ability id the transition stores.
	 * @param {?Object} entry.tool The ability, or undefined when none answers to it.
	 * @return {Object} The row's label, value, tip and state.
	 */
	const describeTool = ( { id, tool } ) => {
		if ( ! tool && ! toolsLoaded ) {
			return { label: id, value: '' };
		}

		const problem = toolProblem( tool );

		return {
			label: tool ? tool.label || tool.id : id,
			value: problem ? problem.short : '',
			tip: problem ? problem.full : tool.description,
			invalid: Boolean( problem ),
		};
	};

	const toggleRequiresAssignment = ( enabled ) => {
		onChange( {
			requires_assignment: enabled
				? { meta_key: '', match: 'current_user' }
				: undefined,
		} );
	};

	const updateRequiresAssignment = ( field, value ) => {
		onChange( {
			requires_assignment: {
				// Expanded, not spread: a gate stored as the bare slot key is a
				// string, and spreading one scatters it into { 0: 'l', 1: 'e', … }
				// with no meta_key left — the gate severed by the act of editing
				// its match mode.
				...expandRequiresAssignment( transition.requires_assignment ),
				[ field ]: value,
			},
		} );
	};

	// A channel nobody has set up notifies nobody: the dispatcher checks
	// `is_configured()` before it sends and skips the ones that answer no. So it
	// is left off the list rather than offered greyed out — a disabled row reads
	// as a capability withheld from the reader, while an absent one reads as
	// what it is, something this site has not set up. Setting one up happens
	// under Workflows → Notifications, not in this panel.
	//
	// One this transition ALREADY notifies is the exception, and the same
	// exception the tools list makes: it stays on the list and says why it is
	// silent. Withholding what can be CHOSEN is what the rule above is for;
	// withholding what IS chosen is a different thing entirely. Nothing prunes
	// the stored id — the sequence saves it back untouched — so it starts
	// sending again the moment someone fills the channel's settings in, and a
	// row that had hidden it would have spent the interval saying "None" about a
	// transition that notifies somebody, with no box to untick.
	const notifications = transition.notifications || [];
	const channelOptions = availableChannels
		.filter(
			( channel ) =>
				channel.configured || notifications.includes( channel.id )
		)
		.map( ( channel ) => ( {
			value: channel.id,
			label: channel.name || channel.id,
			help: channel.configured
				? undefined
				: __(
						'This channel is not set up, so nothing is sent on it. Finish it under Workflows → Notifications, or untick it here.',
						'vip-workflow'
				  ),
		} ) );

	const subtitle = `${ sourceLabel } → ${ targetLabel }`;

	// Collapsed-state gists, so the two sub-form sections read while shut. The
	// capture section counts rather than names: a transition can hold several
	// inputs now, and listing them would not fit on the heading line.
	const captureSummary = inputs.length
		? sprintf(
				/* translators: %d: how many inputs the transition captures. */
				_n( '%d input', '%d inputs', inputs.length, 'vip-workflow' ),
				inputs.length
		  )
		: __( 'Nothing', 'vip-workflow' );
	const assigneeSummary = transition.requires_assignment
		? __( 'On', 'vip-workflow' )
		: __( 'Off', 'vip-workflow' );

	return (
		<InspectorShell
			// An outcome edge is the agent's route, not a button someone
			// presses, so the eyebrow names the outcome that travels it — every
			// outcome, when more than one does, because the panel is editing
			// all of them at once. A disabled transition says that up front,
			// since it looks like any other once its options are open.
			eyebrow={ ( () => {
				if ( sharedOutcomes ) {
					return agentOutcomeNames( sharedOutcomes );
				}
				if ( outcome ) {
					return agentOutcomeLabel( outcome );
				}
				return disabled
					? __( 'Disabled transition', 'vip-workflow' )
					: __( 'Transition', 'vip-workflow' );
			} )() }
			title={ subtitle }
		>
			<Stack direction="column" gap="lg" align="stretch">
				{ /* Says why nothing here can fire, before the fields that
				     configure it — the alternative is an author filling in
				     roles and tools with no hint that the stage's agent has
				     taken the exit over. */ }
				{ disabled && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'This transition is disabled. An agent runs this stage and routes content onward by outcome, so nobody can use this. It keeps its settings — routing an outcome along it, or removing the stage’s agent, makes it live again.',
							'vip-workflow'
						) }
					</Notice>
				) }
				{ /* Two of the agent's outcomes leading to one destination are
				     drawn as two edges, and the canvas offers each of them a
				     panel — but a stage holds at most one transition per
				     target, so both panels are this one. Said before the
				     fields, because it is the fields it changes the meaning
				     of: filling in a tool here arms it for every outcome
				     listed, not for the edge that was clicked. */ }
				{ sharedOutcomes && (
					<Notice status="info" isDismissible={ false }>
						{ sprintf(
							/* translators: 1: comma-separated agent outcome names, e.g. "On pass, On fail"; 2: destination stage name. */
							__(
								'%1$s all lead to %2$s along this one transition, so everything below applies to all of them. Giving an outcome its own roles, tools, notifications or assignment means routing it to a stage of its own.',
								'vip-workflow'
							),
							agentOutcomeNames( sharedOutcomes ),
							targetLabel
						) }
					</Notice>
				) }
				<InspectorSection>
					{ /* The placeholder is the real default, not an invented
					     example. Leaving this blank does not leave the
					     transition nameless — the runtime derives "Move to
					     {destination}" for it on every read — so the field
					     shows the exact string blank produces, and stays
					     optional. "e.g. Submit for review" told an author
					     nothing about what they already had. */ }
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Button label', 'vip-workflow' ) }
						value={ transition.label || '' }
						onChange={ ( label ) => onChange( { label } ) }
						placeholder={ derivedTransitionLabel( targetLabel ) }
					/>

					{ /* Sits with the label because the two answer the same
					     question — where a writer meets this transition. The
					     label is what they read in the editor sidebar; this
					     decides whether it also reaches the Queue, where a
					     writer acts on a post without opening it. */ }
					{ ! simplified && (
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Show as quick action in Queue',
								'vip-workflow'
							) }
							checked={ Boolean( transition.show_in_queue ) }
							onChange={ ( v ) =>
								onChange( { show_in_queue: v } )
							}
						/>
					) }
				</InspectorSection>

				{ /* "Allowed roles", not the "Role restrictions" this was: the
				     stored field is a permit list, so the old title inverted
				     what is in it — and inverted worst against an empty value,
				     where "restrictions: none" and "allowed: all" say the same
				     thing and only one of them reads correctly at a glance. */ }
				<InspectorSection>
					<InspectorChoiceRow
						label={ __( 'Allowed roles', 'vip-workflow' ) }
						help={ __(
							'Only these roles can use this transition. With none checked, everyone can.',
							'vip-workflow'
						) }
						options={ availableRoles.map( ( role ) => ( {
							value: role.slug,
							label: role.name,
						} ) ) }
						selected={ transition.allowed_roles || [] }
						onToggle={ ( slug ) =>
							toggleInArray( 'allowed_roles', slug )
						}
						unknownHelp={ __(
							'No role with this slug exists on this site — its plugin may be inactive. Nobody matches it, so it allows nobody while it keeps the restriction on.',
							'vip-workflow'
						) }
						noneLabel={ __( 'All', 'vip-workflow' ) }
						countLabel={ ( count ) =>
							sprintf(
								/* translators: %d: how many roles may use the transition. */
								_n(
									'%d role',
									'%d roles',
									count,
									'vip-workflow'
								),
								count
							)
						}
					/>
				</InspectorSection>

				{ /* Always present, even on a site with no tools to offer: the
				     section used to disappear whole when the list was empty,
				     taking any tool the transition already required with it —
				     stored, still running, and unreachable. */ }
				<InspectorSection
					title={ __( 'Tools', 'vip-workflow' ) }
					actions={
						toolOptions.length > 0 ? (
							<InspectorFieldListAdd
								addOptions={ toolOptions }
								onAdd={ addTool }
								label={ __( 'Add a tool', 'vip-workflow' ) }
							/>
						) : undefined
					}
				>
					<InspectorFieldList
						items={ requiredTools }
						// Rows back to ids, positionally: the order the author
						// dragged them into is the order the runtime reports
						// their failures in.
						onChange={ ( next ) =>
							onChange( {
								required_tools: next.map(
									( entry ) => entry.id
								),
							} )
						}
						describe={ describeTool }
						removeLabel={ __( 'Remove tool', 'vip-workflow' ) }
						// An empty list with nothing to add to it has no "add
						// one" to offer — the section's Add control is gone for
						// the same reason — so it says what is true of the site
						// instead. `toolOptions` excludes what the transition
						// already requires, which on an empty list is nothing,
						// so here it is exactly what the site can offer.
						emptyLabel={
							toolsLoaded && 0 === toolOptions.length
								? __(
										'No tools are available for transitions on this site.',
										'vip-workflow'
								  )
								: __(
										'This transition runs no tools. Add one to check the post before it moves on.',
										'vip-workflow'
								  )
						}
					/>
				</InspectorSection>

				{ ! simplified && (
					<>
						{ /* Both of these open into sub-forms, so they stay
						     shut until they hold something. */ }
						<InspectorSection
							title={ __( 'What to capture', 'vip-workflow' ) }
							summary={ captureSummary }
							collapsible
							defaultOpen={ inputs.length > 0 }
							actions={
								<InspectorFieldListAdd
									addOptions={ addOptions }
									onAdd={ addInput }
									label={ __(
										'Add an input',
										'vip-workflow'
									) }
								/>
							}
						>
							<InspectorFieldList
								items={ inputs }
								onChange={ updateInputs }
								// A note's key is derived from its name, an
								// assignment's is typed — but both write into
								// the same place on the post, so both are
								// checked for collisions as one.
								keyOf={ ( item ) => item.meta_key || '' }
								// "Started" is having been named — an input
								// nobody has typed into yet is incomplete
								// rather than wrong, and colouring it the
								// instant it appears is validation nobody
								// asked for.
								//
								// An assignment is the exception, and is
								// started the moment it exists: its key is
								// typed rather than derived from anything, and
								// `validateSequence` blocks Save on a blank one
								// from that same moment. A row that said
								// nothing would leave the author with Save
								// switched off and no field to point at.
								isStarted={ ( item ) =>
									'assignment' === item.type ||
									Boolean( item.note_name || item.label )
								}
								describe={ ( item ) => ( {
									label:
										item.note_name ||
										item.label ||
										__( 'Untitled', 'vip-workflow' ),
									value: inputTypeLabel( item.type ),
								} ) }
								renderConfig={ ( { item, update, problem } ) =>
									'assignment' === item.type ? (
										<AssignmentInputConfig
											input={ item }
											availableRoles={ availableRoles }
											keyProblem={ problem?.full }
											onUpdateInput={ ( field, value ) =>
												update( { [ field ]: value } )
											}
											onToggleRoleFilter={ ( slug ) => {
												const roles =
													item.filter?.roles || [];
												update( {
													filter: {
														...item.filter,
														roles: roles.includes(
															slug
														)
															? roles.filter(
																	( r ) =>
																		r !==
																		slug
															  )
															: [
																	...roles,
																	slug,
															  ],
													},
												} );
											} }
										/>
									) : (
										<>
											<TextControl
												__next40pxDefaultSize
												__nextHasNoMarginBottom
												label={ __(
													'Note name',
													'vip-workflow'
												) }
												value={ item.note_name || '' }
												onChange={ ( v ) => {
													// A note written by an
													// import or an ability
													// need not carry an id;
													// minting one here is what
													// keeps the derived key
													// from reading
													// `wfp_undefined_…` and
													// the runtime from
													// dead-ending on the
													// missing id
													// (`WorkflowPanel.handleTextInput`).
													const id =
														item.note_id ||
														inputId();
													update( {
														note_id: id,
														note_name: v,
														meta_key: noteMetaKey(
															id,
															v
														),
													} );
												} }
												placeholder={ __(
													'e.g. Review notes',
													'vip-workflow'
												) }
												help={
													problem?.full ||
													__(
														'Used as the label and to generate the storage key.',
														'vip-workflow'
													)
												}
											/>
											<ToggleControl
												__nextHasNoMarginBottom
												label={ __(
													'Required',
													'vip-workflow'
												) }
												checked={ Boolean(
													item.required
												) }
												onChange={ ( v ) =>
													update( { required: v } )
												}
											/>
										</>
									)
								}
								removeLabel={ __(
									'Remove input',
									'vip-workflow'
								) }
								emptyLabel={ __(
									'This transition captures nothing. Add an input to ask for a note or an assignment before the post moves on.',
									'vip-workflow'
								) }
							/>
						</InspectorSection>

						<InspectorSection
							title={ __(
								'Restrict to an assignee',
								'vip-workflow'
							) }
							summary={ assigneeSummary }
							collapsible
							defaultOpen={ Boolean(
								transition.requires_assignment
							) }
						>
							<RequiresAssignmentConfig
								transition={ transition }
								onToggle={ toggleRequiresAssignment }
								onUpdate={ updateRequiresAssignment }
							/>
						</InspectorSection>
					</>
				) }

				{ /* Gone only when there is nothing to say: no channel worth
				     offering AND none stored. A stored id whose plugin has
				     since left the site answers to no channel at all, so it
				     makes no option — and the row still has to be here for it,
				     or the transition notifies through a setting the panel has
				     no line for. */ }
				{ ( channelOptions.length > 0 || notifications.length > 0 ) && (
					<InspectorSection>
						<InspectorChoiceRow
							label={ __( 'Notifications', 'vip-workflow' ) }
							options={ channelOptions }
							selected={ notifications }
							onToggle={ ( id ) =>
								toggleInArray( 'notifications', id )
							}
							unknownHelp={ __(
								'No channel with this id is registered on this site — its plugin may be inactive. It stays stored, and notifies again if the channel comes back.',
								'vip-workflow'
							) }
							noneLabel={ __( 'None', 'vip-workflow' ) }
							countLabel={ ( count ) =>
								sprintf(
									/* translators: %d: how many channels the transition notifies. */
									_n(
										'%d channel',
										'%d channels',
										count,
										'vip-workflow'
									),
									count
								)
							}
						/>
					</InspectorSection>
				) }

				{ /* An outcome edge is an agent's route rather than a
				     transition of its own, so removing it un-routes the
				     outcome — which is why it names the route, not the
				     transition. Singular even when the record is shared,
				     and correctly so: `clearOutcome` un-routes the one
				     outcome that was selected and leaves the transition
				     standing for whoever else was on it. */ }
				<InspectorDangerZone
					label={
						outcome
							? __( 'Remove this route', 'vip-workflow' )
							: __( 'Remove transition', 'vip-workflow' )
					}
					onClick={ onRemove }
				/>
			</Stack>
		</InspectorShell>
	);
}
