/**
 * Transition input popover — the side-anchored dialog a rail transition opens
 * when it asks for an assignee before it can fire.
 *
 * It replaces a full-screen modal (AssignmentWithNotesModal) with the
 * document-sidebar popover pattern the metadata rows already follow: a popover
 * anchored beside the sidebar (placement `left-start`, mirroring core's
 * PostAuthor / PostSchedule dialogs), a header naming the action with a Close
 * icon button, the flow's inputs, then the committing action. The composition
 * mirrors MetadataRow's
 * Dropdown popover; a raw Popover is used here instead of Dropdown because
 * the trigger is a rail transition button whose click handler runs confirm
 * flows before any popover may open, so the trigger cannot be surrendered to
 * a Dropdown's renderToggle.
 *
 * Dismissal semantics are the modals' own: Close, Escape, and clicking
 * outside all abandon the transition — nothing is committed and no request
 * fires. The commit label is also the modals' own: "Submit" is deliberately
 * kept for transition-completing inputs (this is not a persist-edits Save;
 * the input completes a workflow move).
 *
 * @package
 */

import { useState, useEffect, useRef } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	ComboboxControl,
	Notice,
	Popover,
	Spinner,
	TextareaControl,
} from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { closeSmall } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';

import { ActionRow } from '../../common/ActionRow';
import { STORE_NAME } from '../store';

import './TransitionInputPopover.css';

/**
 * The shared popover shell: side-anchored, focus-trapped, headed by the
 * action's name and a Close button.
 *
 * `focusOnMount` gives the popover the dialog behaviors the modals had:
 * focus moves into it on open, tabbing is constrained inside it, Escape and
 * focus-outside call `onClose`, and focus returns to the trigger on unmount.
 *
 * @param {Object}   root0          Component props.
 * @param {string}   root0.title    Header title — the action's name.
 * @param {?Element} root0.anchor   The rail transition button the popover
 *                                  anchors to.
 * @param {Function} root0.onClose  Called on every dismissal (Close, Escape,
 *                                  click-outside). Abandons the transition.
 * @param {*}        root0.children The flow's inputs and actions.
 */
function TransitionInputPopover( { title, anchor, onClose, children } ) {
	return (
		<Popover
			anchor={ anchor }
			placement="left-start"
			offset={ 36 }
			shift
			focusOnMount="firstElement"
			onClose={ onClose }
			className="vip-workflows-transition-popover"
			// Popover renders a role-less div, where an aria-label alone is
			// prohibited ARIA that assistive tech ignores. The explicit dialog
			// role restores what the Modal announced.
			role="dialog"
			aria-label={ title }
		>
			<Stack
				className="vip-workflows-transition-popover__content"
				direction="column"
				gap="sm"
			>
				<Stack
					className="vip-workflows-transition-popover__header"
					direction="row"
					align="center"
					justify="space-between"
					gap="sm"
				>
					<Text variant="heading-sm">{ title }</Text>
					<Button
						size="small"
						icon={ closeSmall }
						label={ __( 'Close', 'vip-workflows' ) }
						showTooltip
						onClick={ onClose }
					/>
				</Stack>
				{ children }
			</Stack>
		</Popover>
	);
}

/**
 * The searchable assignable-user combobox, for the assignment flow's `user`
 * branch. A port of UserSelectModal's body: same plugin-owned route (core's
 * wp/v2/users needs `list_users`), same debounce, same loading state — the
 * suggestion list renders inline, so it hosts cleanly inside the popover.
 *
 * @param {Object}   root0            Component props.
 * @param {Array}    root0.roleFilter Role slugs to filter the user list by.
 * @param {?number}  root0.value      The currently selected user's id, so a
 *                                    prior selection stays shown while the
 *                                    notes field below it is filled in.
 * @param {Function} root0.onSelect   Called with the chosen user's id.
 */
function AssignableUserSelect( { roleFilter, value, onSelect } ) {
	const [ users, setUsers ] = useState( [] );
	const [ search, setSearch ] = useState( '' );
	const [ loading, setLoading ] = useState( true );
	const initialLoadDone = useRef( false );
	const roleFilterRef = useRef( roleFilter );

	useEffect( () => {
		let cancelled = false;

		const fetchUsers = async () => {
			// Only show loading spinner after initial load.
			if ( initialLoadDone.current ) {
				setLoading( true );
			}

			try {
				const params = new URLSearchParams();
				params.append( 'per_page', '50' );
				if ( search ) {
					params.append( 'search', search );
				}
				if ( roleFilterRef.current.length ) {
					params.append( 'roles', roleFilterRef.current.join( ',' ) );
				}

				const response = await apiFetch( {
					path: `/vip-workflows/v1/assignable-users?${ params.toString() }`,
				} );

				if ( ! cancelled ) {
					setUsers( response );
					initialLoadDone.current = true;
				}
			} catch ( err ) {
				console.error( 'Failed to fetch users:', err );
			} finally {
				if ( ! cancelled ) {
					setLoading( false );
				}
			}
		};

		// Debounce only for search changes, not initial load.
		const delay = initialLoadDone.current ? 300 : 0;
		const debounce = setTimeout( fetchUsers, delay );

		return () => {
			cancelled = true;
			clearTimeout( debounce );
		};
	}, [ search ] );

	if ( loading && users.length === 0 ) {
		return (
			<Stack
				className="vip-workflows-transition-popover__loading"
				direction="row"
				align="center"
				gap="sm"
			>
				<Spinner />
				<Text>{ __( 'Loading users…', 'vip-workflows' ) }</Text>
			</Stack>
		);
	}

	return (
		<ComboboxControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			label={ __( 'Select user', 'vip-workflows' ) }
			value={ value }
			onChange={ onSelect }
			options={ users.map( ( user ) => ( {
				value: user.id,
				label: user.name,
			} ) ) }
			onFilterValueChange={ setSearch }
			placeholder={ __( 'Search users…', 'vip-workflows' ) }
		/>
	);
}

/**
 * Assignment input for a transition: pick a user or a role and optionally add
 * notes, in one popover.
 *
 * Selection and notes render together rather than as separate steps, so
 * picking an assignee doesn't commit the transition on its own — the note
 * (when `notesLabel` is set) is captured in the same action as the
 * assignment, via one explicit Submit. When `notesLabel` is null there is
 * nothing to wait for, so a selection commits immediately, as before.
 *
 * @param {Object}           root0               Component props.
 * @param {string}           root0.title         The transition's label.
 * @param {?Element}         root0.anchor        The rail button the popover anchors
 *                                               to.
 * @param {string}           root0.assigneeType  'user' or 'role'. Any other stored type
 *                                               has no picker and opens the
 *                                               misconfigured state instead.
 * @param {Array}            root0.roleFilter    Role slugs to filter users by.
 * @param {?(string|number)} root0.initialValue  The post's current assignee for
 *                                               this input's slot, if any — preselected
 *                                               rather than asking the user to
 *                                               re-pick an assignment that already
 *                                               exists.
 * @param {?string}          root0.notesLabel    Label for the optional notes field;
 *                                               null omits it and commits on
 *                                               selection.
 * @param {boolean}          root0.notesRequired Whether notes are required to commit.
 * @param {Function}         root0.onSubmit      Called with (selectedValue, notes) on
 *                                               commit.
 * @param {Function}         root0.onClose       Called on dismissal; nothing commits.
 */
export function TransitionAssignmentPopover( {
	title,
	anchor,
	assigneeType,
	roleFilter = [],
	initialValue = null,
	notesLabel = null,
	notesRequired = false,
	onSubmit,
	onClose,
} ) {
	const roles = useSelect(
		( select ) => select( STORE_NAME ).getRoles(),
		[]
	);
	const [ selectedValue, setSelectedValue ] = useState( initialValue );
	const [ notes, setNotes ] = useState( '' );

	useEffect( () => {
		if ( 'user' !== assigneeType && 'role' !== assigneeType ) {
			// A sequence naming a type this editor cannot offer is a config
			// bug, not a user error. It is shown in the popover below; say it
			// once here too, where whoever has to fix the sequence is looking.
			console.error(
				`VIP Workflows: a transition declares assignee_type "${ assigneeType }", which has no picker. Nothing can be assigned.`
			);
		}
	}, [ assigneeType ] );

	const handleSelect = ( value ) => {
		if ( notesLabel ) {
			setSelectedValue( value );
		} else {
			onSubmit( value, '' );
		}
	};

	const canSubmit =
		null !== selectedValue && ( ! notesRequired || notes.trim() );

	const handleSubmit = () => {
		if ( ! canSubmit ) {
			return;
		}
		onSubmit( selectedValue, notes );
	};

	// Every branch below assigns one: there is no longer a shape this popover
	// answers with nothing.
	let popoverTitle = title;
	let body;

	if ( assigneeType === 'user' || assigneeType === 'role' ) {
		body = (
			<>
				{ assigneeType === 'user' ? (
					<AssignableUserSelect
						roleFilter={ roleFilter }
						value={ selectedValue }
						onSelect={ handleSelect }
					/>
				) : (
					<Stack
						className="vip-workflows-transition-popover__roles"
						direction="column"
						gap="sm"
					>
						{ ( roles || [] ).map( ( role ) => (
							<Button
								key={ role.slug }
								className="vip-workflows-transition-popover__role"
								isPressed={ role.slug === selectedValue }
								onClick={ () => handleSelect( role.slug ) }
							>
								{ role.name }
							</Button>
						) ) }
					</Stack>
				) }
				{ notesLabel && (
					<>
						<TextareaControl
							__nextHasNoMarginBottom
							label={ notesLabel }
							help={ __(
								'Notes appear in the workflow history and audit log.',
								'vip-workflows'
							) }
							value={ notes }
							onChange={ setNotes }
							rows={ 4 }
							placeholder={ __(
								'Add optional notes…',
								'vip-workflows'
							) }
						/>
						<ActionRow>
							<Button
								variant="primary"
								onClick={ handleSubmit }
								disabled={ ! canSubmit }
							>
								{ __( 'Submit', 'vip-workflows' ) }
							</Button>
						</ActionRow>
					</>
				) }
			</>
		);
	} else {
		/*
		 * Any type this editor has no picker for.
		 *
		 * `agent` used to land here with a placeholder that always committed the
		 * literal id `default`: no agent was ever chosen, and the post advanced
		 * carrying an assignment naming nothing. The sequence editor no longer
		 * offers the option, but the server still registers the type and a
		 * stored sequence may already carry one — so the branch cannot simply
		 * go away. What it must not do is what it did before (invent an
		 * assignee) or what dropping it alone would do (render an empty popover
		 * that reads as "still loading"). It names the problem and offers no
		 * commit, so the transition can only be abandoned.
		 */
		popoverTitle = __( 'Transition misconfigured', 'vip-workflows' );
		body = (
			<Notice status="error" isDismissible={ false }>
				{ sprintf(
					/* translators: %s: the assignee type stored on the transition, e.g. "agent". */
					__(
						'This transition asks for an assignee of type “%s”, which cannot be chosen here. Nothing has been assigned and the post has not moved — the sequence needs a user or role assignment instead.',
						'vip-workflows'
					),
					assigneeType
				) }
			</Notice>
		);
	}

	return (
		<TransitionInputPopover
			title={ popoverTitle }
			anchor={ anchor }
			onClose={ onClose }
		>
			{ body }
		</TransitionInputPopover>
	);
}
