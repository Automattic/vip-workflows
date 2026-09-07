/**
 * Transition Assignment Configuration Component
 *
 * Shared UI for configuring an assignment input, and the requires_assignment gate
 * that points at one. Used by the sequence editor's TransitionInspector.
 *
 * @package
 */

import {
	TextControl,
	SelectControl,
	ToggleControl,
	CheckboxControl,
} from '@wordpress/components';
import { Fieldset, Stack } from '@wordpress/ui';
import { __, sprintf } from '@wordpress/i18n';

import './TransitionAssignmentConfig.css';

/**
 * Sanitize an assignment slot key as it is typed.
 *
 * The key is stored through `sanitize_key()`, which STRIPS a space rather than
 * turning it into a separator — so a typed "Legal Reviewer" lands as
 * `legalreviewer` while a gate pointing at `legal_reviewer` keeps its
 * underscore, and two keys that read as the same slot silently stop matching.
 * Converting the space here keeps whatever is typed on both sides identical.
 *
 * Same rule as the stage Key field (`sanitizeStageKey` in StageInspector), so an
 * assignment key and a stage key are typed under one convention. Metadata field
 * keys are not on that convention: `sanitizeMetadataKey` collapses to `_`,
 * matching the server's own metadata key contract. The editor holds two key
 * conventions, and this is one of them — not the only one.
 *
 * @param {string} str Raw input.
 * @return {string} Sanitized key.
 */
export function sanitizeAssignmentKey( str ) {
	return str
		.toLowerCase()
		.replace( /[^a-z0-9_-]/g, '-' )
		.replace( /-+/g, '-' );
}

/**
 * A transition's assignment gate, in the one shape the form edits.
 *
 * `requires_assignment` is stored either as `{ meta_key, match }` or as the bare
 * slot key — the shorthand `AssignmentManager::normalize_requirement()` accepts,
 * `build_config()` writes back verbatim, and `gateSlotKey()` in graph-model
 * resolves, so a stored sequence really can carry it. Read straight off, a
 * string answers `undefined` for `.meta_key`, so the form drew an empty Key box
 * over a gate that names one; spread into an update, it comes apart into
 * `{ 0: 'l', 1: 'e', … }` with no `meta_key` at all and the gate is severed.
 *
 * @param {Object|string} requirement A transition's `requires_assignment`.
 * @return {{meta_key: string, match: string}} The gate, in full.
 */
export function expandRequiresAssignment( requirement ) {
	if ( requirement && 'object' === typeof requirement ) {
		return {
			meta_key: requirement.meta_key || '',
			match: requirement.match || 'current_user',
		};
	}

	return {
		meta_key: 'string' === typeof requirement ? requirement : '',
		match: 'current_user',
	};
}

/**
 * The assignee types a transition can be authored with.
 *
 * `agent` is deliberately absent. It was offered here with nothing behind it:
 * the editor's assignment popover showed a placeholder panel and committed the
 * literal id `default`, so the post advanced carrying an assignment that named
 * no agent at all. The option is withdrawn until a real agent picker exists.
 *
 * The server side is untouched — `AssignmentManager::get_assignee_types()` still
 * registers `agent`, still validates one, and the `vip_workflows_assignee_types`
 * filter can still add more — so a sequence that already stores one keeps its
 * stored shape. What is gone is authoring a new one blind.
 */
const ASSIGNEE_TYPES = [
	{ label: __( 'User', 'vip-workflows' ), value: 'user' },
	{ label: __( 'Role', 'vip-workflows' ), value: 'role' },
];

/**
 * The type options to show for a transition, including one this build no longer
 * offers.
 *
 * A stored `agent` — or a type an out-of-tree `vip_workflows_assignee_types`
 * filter registered — matches no option, and a `<select>` whose value matches
 * nothing renders blank. Blank reads as "not set yet", which is exactly wrong:
 * the transition does carry a type, and silently drawing it as unset is how an
 * author overwrites it without knowing there was anything there. Appending it,
 * disabled, names what is stored and refuses to be re-picked once changed away.
 *
 * @param {string} assigneeType The transition's stored assignee type.
 * @return {Array<Object>} Options for the assignee type select.
 */
function assigneeTypeOptions( assigneeType ) {
	if ( ASSIGNEE_TYPES.some( ( type ) => type.value === assigneeType ) ) {
		return ASSIGNEE_TYPES;
	}

	return [
		...ASSIGNEE_TYPES,
		{
			label: sprintf(
				/* translators: %s: an assignee type this build cannot author, e.g. "agent". */
				__( '%s (no longer available)', 'vip-workflows' ),
				assigneeType
			),
			value: assigneeType,
			disabled: true,
		},
	];
}

/**
 * Assignment Input Configuration Section.
 *
 * Takes the one input it configures, not the transition holding it. A transition
 * captures a list now, and any entry in that list may be the assignment — so
 * reaching back through the transition would have this component decide WHICH
 * input it is editing, a question its caller has already answered.
 *
 * @param {Object}   props                    Component props.
 * @param {Object}   props.input              The assignment input being configured.
 * @param {Array}    props.availableRoles     Roles available to filter the assignee picker by.
 * @param {string}   [props.keyProblem]       Why this slot's key would have the save refused.
 * @param {Function} props.onUpdateInput      Callback to update an input field: ( key, value ).
 * @param {Function} props.onToggleRoleFilter Callback to toggle a role in the filter: ( roleSlug ).
 * @return {JSX.Element|null} The assignment input config, or null when not applicable.
 */
export function AssignmentInputConfig( {
	input,
	availableRoles,
	keyProblem,
	onUpdateInput,
	onToggleRoleFilter,
} ) {
	if ( input?.type !== 'assignment' ) {
		return null;
	}

	// Read-side default only. The write side stays with the caller's
	// `onToggleRoleFilter`, which always hands back a (possibly empty) array, so
	// the `input.filter.roles` shape persisted into sequence config is untouched.
	const roleFilter = input?.filter?.roles || [];

	const assigneeType = input?.assignee_type || 'user';

	return (
		<Stack
			direction="column"
			gap="md"
			align="stretch"
			className="vip-workflows-assignment-config"
		>
			<SelectControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				label={ __( 'Assignee type', 'vip-workflows' ) }
				value={ assigneeType }
				options={ assigneeTypeOptions( assigneeType ) }
				onChange={ ( v ) => onUpdateInput( 'assignee_type', v ) }
			/>
			<TextControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				label={ __( 'Assignment key', 'vip-workflows' ) }
				value={ input?.meta_key || '' }
				onChange={ ( v ) =>
					onUpdateInput( 'meta_key', sanitizeAssignmentKey( v ) )
				}
				placeholder={ __( 'e.g., legal-reviewer', 'vip-workflows' ) }
				help={
					keyProblem ||
					__(
						'Unique identifier for this assignment slot',
						'vip-workflows'
					)
				}
			/>
			<TextControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				label={ __( 'Label', 'vip-workflows' ) }
				value={ input?.label || '' }
				onChange={ ( v ) => onUpdateInput( 'label', v ) }
				placeholder={ __( 'e.g., Select reviewer', 'vip-workflows' ) }
			/>
			<ToggleControl
				__nextHasNoMarginBottom
				label={ __( 'Required', 'vip-workflows' ) }
				checked={ input?.required || false }
				onChange={ ( v ) => onUpdateInput( 'required', v ) }
			/>
			{ /*
			 * The role filter is a checkbox group, matching every other
			 * multi-select in this app.
			 *
			 * `availableRoles` is a short, fixed, fully-known list, and this is
			 * an inline field in a settings form — so the house pattern is a
			 * list of `CheckboxControl`s under a group label. TransitionInspector
			 * renders this same array the same way in the popover its "Allowed
			 * roles" row opens, and GeneralSettings' role pickers do too, so the
			 * two role lists in this panel still read identically. The DataViews
			 * filter UI is the standard for *browsing a dataset* (AuditLog,
			 * MyQueuePage, Calendar) and is the wrong shape here: it brings a
			 * `view` object, search, sort and pagination that a handful of roles
			 * has no use for. `FormTokenField` is the other WPDS multi-select,
			 * but it matches options by display label and accepts free text —
			 * a label/slug translation layer over a value persisted into
			 * sequence config, for no gain at this list length.
			 *
			 * `Fieldset` carries the group semantics the old pill list faked:
			 * a real <fieldset> named by `Fieldset.Legend` through
			 * `aria-labelledby`, with `Fieldset.Description` wired through
			 * `aria-describedby`, so the caveat is announced with the group
			 * instead of sitting in a <span> nothing points at. It also brings
			 * its own layout and <fieldset> reset, which is why this needs no CSS.
			 */ }
			{ assigneeType === 'user' && availableRoles.length > 0 && (
				<Fieldset.Root>
					<Fieldset.Legend>
						{ __( 'Filter by role', 'vip-workflows' ) }
					</Fieldset.Legend>
					<Fieldset.Description>
						{ __(
							'Leave all unchecked to offer every user.',
							'vip-workflows'
						) }
					</Fieldset.Description>
					<Stack direction="column" gap="md" align="stretch">
						{ availableRoles.map( ( role ) => (
							<CheckboxControl
								__nextHasNoMarginBottom
								key={ role.slug }
								label={ role.name }
								checked={ roleFilter.includes( role.slug ) }
								onChange={ () =>
									onToggleRoleFilter( role.slug )
								}
							/>
						) ) }
					</Stack>
				</Fieldset.Root>
			) }
		</Stack>
	);
}

/**
 * Requires Assignment Configuration Section.
 *
 * Shows when the requires_assignment toggle is enabled.
 *
 * @param {Object}   props            Component props.
 * @param {Object}   props.transition Transition being configured.
 * @param {Function} props.onToggle   Callback fired when the requires-assignment toggle changes.
 * @param {Function} props.onUpdate   Callback to update a requires_assignment field: ( key, value ).
 * @return {JSX.Element} The requires-assignment config section.
 */
export function RequiresAssignmentConfig( { transition, onToggle, onUpdate } ) {
	// Read through the shorthand, so a gate stored as the bare key shows the key
	// it names rather than an empty box (see expandRequiresAssignment).
	const requirement = expandRequiresAssignment(
		transition.requires_assignment
	);

	return (
		<Stack
			direction="column"
			gap="md"
			align="stretch"
			className="vip-workflows-transition__requires"
		>
			<ToggleControl
				__nextHasNoMarginBottom
				label={ __( 'Requires assignment', 'vip-workflows' ) }
				checked={ Boolean( transition.requires_assignment ) }
				onChange={ onToggle }
				help={ __(
					'Restrict this transition to a previously assigned user or role',
					'vip-workflows'
				) }
			/>
			{ transition.requires_assignment && (
				<Stack
					direction="column"
					gap="md"
					align="stretch"
					className="vip-workflows-requires-config"
				>
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Assignment key', 'vip-workflows' ) }
						value={ requirement.meta_key }
						onChange={ ( v ) =>
							onUpdate( 'meta_key', sanitizeAssignmentKey( v ) )
						}
						placeholder={ __(
							'e.g., legal-reviewer',
							'vip-workflows'
						) }
						help={ __(
							'Must match assignment key from another transition',
							'vip-workflows'
						) }
					/>
					<SelectControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Match mode', 'vip-workflows' ) }
						value={ requirement.match }
						options={ [
							{
								label: __( 'Current user', 'vip-workflows' ),
								value: 'current_user',
							},
							// There is deliberately no "current user role" option.
							// The match mode does not pick the check — the stored
							// assignment's TYPE does, and the mode is only handed to
							// whichever validator the type already chose. On a role
							// assignment `current_user_role` runs the same role
							// membership test as `current_user`; on a user assignment
							// it makes validate_user_assignment() return false for
							// everyone, so the gate can never be satisfied. It was
							// offered here and then dropped on save by build_config's
							// whitelist, which is what kept it off disk.
							// Not agent-specific, despite what this option used to
							// be labelled. `user_satisfies_requirement()` answers
							// `completed` on the assignment's STATUS before it
							// looks at the type at all, and StatusManager marks
							// any gate-satisfying assignment completed — so a user
							// or role assignment reaches this mode the same way.
							{
								label: __( 'Completed', 'vip-workflows' ),
								value: 'completed',
							},
						] }
						onChange={ ( v ) => onUpdate( 'match', v ) }
					/>
				</Stack>
			) }
		</Stack>
	);
}
