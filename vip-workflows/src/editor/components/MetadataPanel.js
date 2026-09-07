/**
 * Metadata Panel component.
 *
 * Renders sequence-defined editorial metadata fields as a flat section of the
 * Workflow sidebar, following core's document-sidebar meta pattern: each field
 * is a label + clickable-value row (MetadataRow) whose popover holds the
 * field's input, the way Author and Publish work in the document sidebar.
 * Values are read and written via useEntityProp so they participate in
 * Gutenberg's real-time collaboration (Yjs) sync layer and standard post-save
 * lifecycle. The panel renders nothing at all when the active sequence
 * defines no metadata_fields.
 */

import { useEffect, useState } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { useEntityProp } from '@wordpress/core-data';
import {
	Button,
	DatePicker,
	TextControl,
	TextareaControl,
	SelectControl,
} from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { dateI18n, getDate, getSettings } from '@wordpress/date';
import { __, sprintf } from '@wordpress/i18n';

import { ActionRow } from '../../common/ActionRow';
import { MetadataUserControl } from '../../common/MetadataUserControl';
import { MetadataRow } from './MetadataRow';
import { useRequiredMetadataGate } from '../required-metadata';
import { STORE_NAME } from '../store';

/**
 * Resolve a saved user id to its display name via the plugin's
 * assignable-users route, for the row's value trigger.
 *
 * MetadataUserControl performs its own resolution while its popover is open —
 * that one is entangled with the search list — but the trigger needs the name
 * while the popover is closed, so this hook resolves it independently.
 *
 * @param {number} userId     Saved user id, 0 when unset.
 * @param {number} refreshKey Bump to re-resolve the same id (used to retry
 *                            after a failed fetch).
 * @return {Object} `{ name, missing, error }` — `name` is null until resolved;
 *                  `missing` is true when the id resolves to no visible user;
 *                  `error` is true when the lookup itself failed, which says
 *                  nothing about whether the user exists.
 */
function useAssignableUser( userId, refreshKey = 0 ) {
	const [ resolved, setResolved ] = useState( {
		id: 0,
		name: null,
		missing: false,
		error: false,
	} );

	useEffect( () => {
		if ( ! userId ) {
			setResolved( { id: 0, name: null, missing: false, error: false } );
			return undefined;
		}

		const controller = new AbortController();
		let cancelled = false;

		const fetchUser = async () => {
			try {
				const result = await apiFetch( {
					path: `/vip-workflows/v1/assignable-users?include=${ encodeURIComponent(
						String( userId )
					) }&per_page=1`,
					signal: controller.signal,
				} );

				if ( cancelled ) {
					return;
				}

				if ( result.length === 0 ) {
					// Deleted user, or the current user can't see it.
					setResolved( {
						id: userId,
						name: null,
						missing: true,
						error: false,
					} );
					return;
				}

				setResolved( {
					id: userId,
					name: result[ 0 ].name,
					missing: false,
					error: false,
				} );
			} catch {
				if ( cancelled || controller.signal.aborted ) {
					return;
				}
				// A failed lookup is not a missing user: keep the two apart so
				// a network blip never labels a real user "(unavailable)".
				setResolved( {
					id: userId,
					name: null,
					missing: false,
					error: true,
				} );
			}
		};

		fetchUser();

		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [ userId, refreshKey ] );

	// Ignore a resolution that belongs to a previous id so a remote (Yjs)
	// change never flashes the old user's name against the new id.
	return resolved.id === userId
		? {
				name: resolved.name,
				missing: resolved.missing,
				error: resolved.error,
		  }
		: { name: null, missing: false, error: false };
}

/**
 * Row for a `user` field. Core analog: PostAuthor — the trigger shows the
 * resolved user name; the popover holds the searchable user combobox, and
 * picking a user commits and closes.
 *
 * @param {Object}   root0            Component props.
 * @param {string}   root0.label      Visible row label (with any asterisk).
 * @param {string}   root0.fieldLabel The field's plain label.
 * @param {boolean}  root0.required   Whether the field is required.
 * @param {boolean}  root0.blocking   Whether this empty field is holding a move.
 * @param {*}        root0.value      Current meta value.
 * @param {Function} root0.onChange   Change handler.
 */
function MetadataUserRow( {
	label,
	fieldLabel,
	required,
	blocking,
	value,
	onChange,
} ) {
	const userId = Number( value ) || 0;
	const [ refreshKey, setRefreshKey ] = useState( 0 );
	const { name, missing, error } = useAssignableUser( userId, refreshKey );

	let valueLabel = '';
	if ( userId ) {
		if ( name ) {
			valueLabel = name;
		} else if ( missing ) {
			valueLabel = sprintf(
				/* translators: %s: numeric user ID. */
				__( 'User #%s (unavailable)', 'vip-workflows' ),
				String( userId )
			);
		} else if ( error ) {
			// The lookup failed, which proves nothing about the user — show
			// the neutral id without the "(unavailable)" claim.
			valueLabel = sprintf(
				/* translators: %s: numeric user ID. */
				__( 'User #%s', 'vip-workflows' ),
				String( userId )
			);
		} else {
			valueLabel = __( 'Loading…', 'vip-workflows' );
		}
	}

	return (
		<MetadataRow
			label={ label }
			fieldLabel={ fieldLabel }
			required={ required }
			blocking={ blocking }
			valueLabel={ valueLabel }
			emptyLabel={ __( 'Assign a user', 'vip-workflows' ) }
			onPopoverClose={ () => {
				// Re-resolve after a failed lookup so a recovered network
				// heals the trigger without needing the id to change.
				if ( error ) {
					setRefreshKey( ( key ) => key + 1 );
				}
			} }
			renderContent={ ( { onClose } ) => (
				<MetadataUserControl
					label={ fieldLabel }
					hideLabelFromVision
					value={ userId }
					onChange={ ( newUserId ) => {
						onChange( newUserId );
						onClose();
					} }
				/>
			) }
		/>
	);
}

/**
 * Row for a `date` field. Core analog: PostSchedule — the trigger shows the
 * date formatted with the site's date format; the popover holds a calendar,
 * and picking a day commits and closes. `Remove` clears a set date, keeping
 * the field clearable the way the old native date input was.
 *
 * @param {Object}   root0            Component props.
 * @param {string}   root0.label      Visible row label (with any asterisk).
 * @param {string}   root0.fieldLabel The field's plain label.
 * @param {boolean}  root0.required   Whether the field is required.
 * @param {boolean}  root0.blocking   Whether this empty field is holding a move.
 * @param {*}        root0.value      Current meta value (`Y-m-d` or '').
 * @param {Function} root0.onChange   Change handler.
 */
function MetadataDateRow( {
	label,
	fieldLabel,
	required,
	blocking,
	value,
	onChange,
} ) {
	// getDate parses the stored `Y-m-d` in the SITE timezone. Handing the bare
	// string to dateI18n parses it browser-local instead, and a browser ahead
	// of the site renders the previous day.
	// Trimmed first: a whitespace-only value is truthy, and formatting it
	// renders "Invalid date" — a field that looks answered to the reader while
	// the transition guard, which trims, refuses it as empty.
	const storedDate = String( value ?? '' ).trim();
	const valueLabel = storedDate
		? dateI18n( getSettings().formats.date, getDate( storedDate ) )
		: '';

	return (
		<MetadataRow
			label={ label }
			fieldLabel={ fieldLabel }
			required={ required }
			blocking={ blocking }
			valueLabel={ valueLabel }
			emptyLabel={ __( 'Choose a date', 'vip-workflows' ) }
			renderContent={ ( { onClose } ) => (
				<>
					<DatePicker
						currentDate={ value || null }
						onChange={ ( newDate ) => {
							// DatePicker reports a timezone-less ISO string;
							// keep the stored shape the old date input wrote.
							onChange( newDate ? newDate.slice( 0, 10 ) : '' );
							onClose();
						} }
					/>
					{ !! value && (
						<ActionRow>
							<Button
								variant="tertiary"
								size="compact"
								onClick={ () => {
									onChange( '' );
									onClose();
								} }
							>
								{ __( 'Remove', 'vip-workflows' ) }
							</Button>
						</ActionRow>
					) }
				</>
			) }
		/>
	);
}

/**
 * Render the label + clickable-value row for a single metadata field.
 *
 * Always uses controlled inputs (value=) so remote Yjs updates trigger
 * re-renders — of the popover's input and of the value trigger alike. Free-text
 * inputs write through on every change exactly as the old inline controls did;
 * discrete pickers (select, date, user) commit and close.
 *
 * @param {Object}   root0          Component props.
 * @param {Object}   root0.field    Metadata field configuration.
 * @param {boolean}  root0.blocking Whether this field being empty is holding a
 *                                  transition the author is being offered.
 * @param {Object}   root0.meta     Current post meta values.
 * @param {Function} root0.setMeta  Setter for post meta values.
 */
function MetadataField( { field, blocking, meta, setMeta } ) {
	const currentValue = meta[ field.meta_key ] ?? '';
	const onChange = ( newValue ) =>
		setMeta( { ...meta, [ field.meta_key ]: newValue } );

	const label = field.required ? field.label + ' *' : field.label;

	switch ( field.type ) {
		case 'textarea':
			// Core analog: PostExcerpt — a multiline text in the popover that
			// writes through on every change; closing just puts the value
			// back on display in the row.
			return (
				<MetadataRow
					label={ label }
					fieldLabel={ field.label }
					required={ field.required }
					blocking={ blocking }
					valueLabel={ currentValue }
					emptyLabel={ __( 'Add text', 'vip-workflows' ) }
					renderContent={ () => (
						<TextareaControl
							__nextHasNoMarginBottom
							label={ field.label }
							hideLabelFromVision
							value={ currentValue }
							onChange={ onChange }
						/>
					) }
				/>
			);

		case 'select': {
			const options = [
				{ label: __( '— Select —', 'vip-workflows' ), value: '' },
				...( field.options || [] ).map( ( opt ) => ( {
					label: opt,
					value: opt,
				} ) ),
			];
			// Discrete picker: choosing an option commits and closes, the way
			// picking an author does.
			return (
				<MetadataRow
					label={ label }
					fieldLabel={ field.label }
					required={ field.required }
					blocking={ blocking }
					valueLabel={ currentValue }
					emptyLabel={ __( 'Choose an option', 'vip-workflows' ) }
					renderContent={ ( { onClose } ) => (
						<SelectControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							label={ field.label }
							hideLabelFromVision
							value={ currentValue }
							options={ options }
							onChange={ ( newValue ) => {
								onChange( newValue );
								onClose();
							} }
						/>
					) }
				/>
			);
		}

		case 'date':
			return (
				<MetadataDateRow
					label={ label }
					fieldLabel={ field.label }
					required={ field.required }
					blocking={ blocking }
					value={ currentValue }
					onChange={ onChange }
				/>
			);

		case 'user':
			return (
				<MetadataUserRow
					label={ label }
					fieldLabel={ field.label }
					required={ field.required }
					blocking={ blocking }
					value={ currentValue }
					onChange={ onChange }
				/>
			);

		default:
			// `text` — single-line free text; Enter commits and closes.
			return (
				<MetadataRow
					label={ label }
					fieldLabel={ field.label }
					required={ field.required }
					blocking={ blocking }
					valueLabel={ currentValue }
					emptyLabel={ __( 'Add text', 'vip-workflows' ) }
					renderContent={ ( { onClose } ) => (
						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							label={ field.label }
							hideLabelFromVision
							value={ currentValue }
							onChange={ onChange }
							onKeyDown={ ( event ) => {
								// isComposing: Enter inside IME composition
								// picks a candidate; it must not commit-close.
								if (
									event.key === 'Enter' &&
									! event.nativeEvent.isComposing
								) {
									// Without this, the stroke's keypress
									// lands on the re-focused trigger and
									// reopens the popover just closed.
									event.preventDefault();
									onClose();
								}
							} }
						/>
					) }
				/>
			);
	}
}

/**
 * Metadata panel — a flat stack of metadata rows, rendered only when the
 * active sequence defines at least one metadata field. It carries no card
 * wrapper and no heading of its own: the sidebar's main panel seats it.
 */
export function MetadataPanel() {
	const { metadataFields, postType } = useSelect( ( select ) => {
		const s = select( STORE_NAME );
		return {
			metadataFields: s.getMetadataFields(),
			postType: s.getPostType(),
		};
	}, [] );

	const [ meta, setMeta ] = useEntityProp( 'postType', postType, 'meta' );

	// Which of these rows a move is currently waiting on. The gate answers for
	// the rail and for this panel from one reading of the same fields, so the
	// rows the rail names as blocking are exactly the rows marked here.
	const { blockingFieldKeys } = useRequiredMetadataGate();

	if ( ! metadataFields || metadataFields.length === 0 ) {
		return null;
	}

	return (
		<Stack
			className="vip-workflows-metadata-panel"
			direction="column"
			gap="xs"
		>
			{ metadataFields.map( ( field ) => (
				<MetadataField
					key={ field.key }
					field={ field }
					blocking={ blockingFieldKeys.includes( field.meta_key ) }
					meta={ meta || {} }
					setMeta={ setMeta }
				/>
			) ) }
		</Stack>
	);
}
