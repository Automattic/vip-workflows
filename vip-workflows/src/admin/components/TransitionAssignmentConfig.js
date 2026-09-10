/**
 * Transition Assignment Configuration Component
 *
 * Shared UI for configuring an assignment input. Used by the sequence editor's
 * TransitionInspector.
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
 * The assignee types a transition can be authored with.
 *
 * `agent` is deliberately absent. It was offered here with nothing behind it:
 * the editor's assignment popover showed a placeholder panel and committed the
 * literal id `default`, so the post advanced carrying an assignment that named
 * no agent at all. The option is withdrawn until a real agent picker exists.
 *
 * The server side is untouched — `AssignmentManager::get_assignee_types()` still
 * registers `agent`, and the `vip_workflows_assignee_types` filter can still add
 * more — so a sequence that already stores one keeps its stored shape. What is
 * gone is authoring a new one blind.
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
 * The slot key is not among the fields. It is minted when the input is added
 * and never shown: nothing an author does reads it, so there is nothing for
 * them to type or to match.
 *
 * @param {Object}   props                    Component props.
 * @param {Object}   props.input              The assignment input being configured.
 * @param {Array}    props.availableRoles     Roles available to filter the assignee picker by.
 * @param {Function} props.onUpdateInput      Callback to update an input field: ( key, value ).
 * @param {Function} props.onToggleRoleFilter Callback to toggle a role in the filter: ( roleSlug ).
 * @return {JSX.Element|null} The assignment input config, or null when not applicable.
 */
export function AssignmentInputConfig( {
	input,
	availableRoles,
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
