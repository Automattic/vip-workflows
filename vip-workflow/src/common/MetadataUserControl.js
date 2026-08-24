/**
 * MetadataUserControl — a searchable picker for `user` metadata fields.
 *
 * Shared because `user` fields are asked for in more than one place, and those
 * places must agree on what they write. The meta is registered as `integer`
 * with `absint`, so anything but a user id is silently stored as 0 — which
 * makes a free-text box over one of these fields a control that looks like it
 * works and never does.
 *
 * Reads through the plugin's own assignable-users route rather than core's
 * wp/v2/users, so it offers the users the workflow considers assignable.
 */

import { useEffect, useRef, useState } from '@wordpress/element';
import { ComboboxControl, Spinner } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';

const USER_FETCH_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Render a searchable user selector for user metadata fields.
 *
 * @param {Object}   root0                     Component props.
 * @param {string}   root0.label               Field label.
 * @param {number}   root0.value               Current user ID.
 * @param {Function} root0.onChange            Change handler receiving a user ID.
 * @param {boolean}  root0.hideLabelFromVision Visually hide the label (the
 *                                             popover header already names the
 *                                             field when rendered in a row).
 */
export function MetadataUserControl( {
	label,
	value,
	onChange,
	hideLabelFromVision = false,
} ) {
	const [ users, setUsers ] = useState( [] );
	const [ search, setSearch ] = useState( '' );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ searchError, setSearchError ] = useState( '' );
	const [ selectedUser, setSelectedUser ] = useState( null );
	const [ selectedError, setSelectedError ] = useState( '' );
	const [ selectedMissing, setSelectedMissing ] = useState( false );
	const initialLoadDone = useRef( false );
	const selectedUserId = value ? String( value ) : '';

	useEffect( () => {
		const controller = new AbortController();
		let cancelled = false;

		const fetchUsers = async () => {
			if ( initialLoadDone.current ) {
				setIsLoading( true );
			}

			try {
				const params = new URLSearchParams();
				params.append( 'per_page', String( USER_FETCH_LIMIT ) );
				if ( search ) {
					params.append( 'search', search );
				}

				// Plugin-owned route rather than core's wp/v2/users.
				const fetchedUsers = await apiFetch( {
					path: `/vip-workflow/v1/assignable-users?${ params.toString() }`,
					signal: controller.signal,
				} );

				if ( cancelled ) {
					return;
				}

				setUsers( fetchedUsers );
				setSearchError( '' );
				initialLoadDone.current = true;
			} catch ( err ) {
				if ( cancelled || controller.signal.aborted ) {
					return;
				}
				setSearchError(
					err.message || __( 'Unable to load users.', 'vip-workflow' )
				);
			} finally {
				if ( ! cancelled ) {
					setIsLoading( false );
				}
			}
		};

		const delay = initialLoadDone.current ? SEARCH_DEBOUNCE_MS : 0;
		const debounce = setTimeout( fetchUsers, delay );

		return () => {
			cancelled = true;
			clearTimeout( debounce );
			controller.abort();
		};
	}, [ search ] );

	// Resolve the saved user id to a display label when it is not in the search
	// list. Kept in its own state (not merged into `users`) so a fresh search —
	// which replaces `users` — never clobbers the selected user's label.
	// Depends only on selectedUserId so a search keystroke does not re-trigger it.
	useEffect( () => {
		if ( ! selectedUserId ) {
			setSelectedUser( null );
			setSelectedMissing( false );
			setSelectedError( '' );
			return undefined;
		}

		const controller = new AbortController();
		let cancelled = false;
		setSelectedMissing( false );
		// Cleared with `missing`, not only on success: a new id must not
		// inherit the previous one's failure and skip its own resolution.
		setSelectedError( '' );

		const fetchSelectedUser = async () => {
			try {
				const result = await apiFetch( {
					path: `/vip-workflow/v1/assignable-users?include=${ encodeURIComponent(
						selectedUserId
					) }&per_page=1`,
					signal: controller.signal,
				} );

				if ( cancelled ) {
					return;
				}

				// Deleted user, or the current user can't see it: mark it missing
				// so the control renders an explicit "(unavailable)" option.
				if ( result.length === 0 ) {
					setSelectedUser( null );
					setSelectedMissing( true );
					return;
				}

				setSelectedError( '' );
				setSelectedUser( result[ 0 ] );
			} catch ( err ) {
				if ( cancelled || controller.signal.aborted ) {
					return;
				}
				// `missing` stays false: a lookup that failed says nothing
				// about whether the user exists, and setting it here rendered
				// a real user as "(unavailable)" on a network blip. The error
				// is its own state, and `useAssignableUser()` — the row's
				// resolver — keeps the same two apart for the same reason.
				setSelectedUser( null );
				setSelectedError(
					err.message ||
						__(
							'Unable to load the selected user.',
							'vip-workflow'
						)
				);
			}
		};

		fetchSelectedUser();

		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [ selectedUserId ] );

	const selectedInUsers = users.some(
		( user ) => String( user.id ) === selectedUserId
	);

	// Hold the loading state until a saved id resolves (to a real user or a
	// known-missing one). Otherwise ComboboxControl latches the placeholder/
	// fallback label into its input before resolution and never refreshes it.
	// A failed lookup ends the resolution too. It is not a missing user — the
	// option below stays neutral — but leaving it out of this test held the
	// control on its spinner for the rest of the session.
	const resolvingSelected =
		!! selectedUserId &&
		! selectedInUsers &&
		! selectedUser &&
		! selectedMissing &&
		! selectedError;

	if ( ( isLoading && users.length === 0 ) || resolvingSelected ) {
		return (
			<Stack
				className="vip-workflow-metadata-user-control__loading"
				direction="row"
				align="center"
				gap="sm"
			>
				<Spinner />
				<span>{ __( 'Loading users…', 'vip-workflow' ) }</span>
			</Stack>
		);
	}

	const options = [
		{ value: '', label: __( '— Select —', 'vip-workflow' ) },
		...users.map( ( user ) => ( {
			value: String( user.id ),
			label: user.name,
		} ) ),
	];

	// Surface the saved selection when it is not in the current search list:
	// its resolved name, or an explicit "(unavailable)" option (deleted user,
	// or the current user lacks list_users) instead of a blank control that
	// hides — and can silently overwrite — the stored value.
	if ( selectedUserId && ! selectedInUsers ) {
		if ( selectedUser ) {
			options.push( {
				value: selectedUserId,
				label: selectedUser.name,
			} );
		} else if ( selectedMissing ) {
			options.push( {
				value: selectedUserId,
				label: sprintf(
					/* translators: %s: numeric user ID. */
					__( 'User #%s (unavailable)', 'vip-workflow' ),
					selectedUserId
				),
			} );
		} else if ( selectedError ) {
			// The lookup failed, so the name is unknown — but the user is not.
			// The id alone, with the failure said once in `help` below.
			options.push( {
				value: selectedUserId,
				label: sprintf(
					/* translators: %s: numeric user ID. */
					__( 'User #%s', 'vip-workflow' ),
					selectedUserId
				),
			} );
		}
	}

	// Clearing the selection reports 0, not the empty option's own ''. A `user`
	// field is the one metadata type registered as `integer` meta with
	// `show_in_rest`, and core validates a REST meta value against that
	// registered schema BEFORE the field's `absint` sanitiser runs — so an
	// empty string is rejected outright ("is not of type integer") and the post
	// cannot be saved at all. 0 is what the read side already means by "no
	// user" (see useAssignableUser), so it is what the write side sends.
	const handleChange = ( userId ) =>
		onChange( userId ? Number( userId ) : 0 );

	return (
		<ComboboxControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			label={ label }
			hideLabelFromVision={ hideLabelFromVision }
			value={ selectedUserId }
			onChange={ handleChange }
			options={ options }
			onFilterValueChange={ setSearch }
			placeholder={ __( 'Search users…', 'vip-workflow' ) }
			help={ selectedError || searchError }
		/>
	);
}
