/**
 * Checklist Tool Admin Settings
 *
 * Registers a custom settings component for the checklist tool
 * using WordPress hooks to extend the VIP Workflow Integrations page.
 */

import './admin.css';
import { useState, useEffect, useCallback } from '@wordpress/element';
import { Button, TextControl, Spinner } from '@wordpress/components';
import { addFilter } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

/**
 * The soft/hard button's tooltip, or nothing while it cannot be clicked.
 *
 * Both phrasings promise a click, so neither is true once the tool is switched
 * off and the button is disabled. The reason for the grey is stated once for the
 * whole panel instead — a `title` is the wrong place for it, and one on a
 * disabled control is not reliably reachable anyway.
 *
 * @param {boolean} required Whether the item is currently a hard requirement.
 * @param {boolean} disabled Whether the tool is switched off.
 * @return {string|undefined} The tooltip, or undefined while disabled.
 */
function modeTitle( required, disabled ) {
	if ( disabled ) {
		return undefined;
	}

	return required
		? __( 'Required (click to make optional)', 'workflow-tool-checklist' )
		: __( 'Optional (click to make required)', 'workflow-tool-checklist' );
}

/**
 * Checklist Settings component for managing checklist items.
 *
 * `disabled` comes from the tool card: it is true while the checklist tool is
 * switched off. The items describe how the tool behaves when it runs, so a
 * switched-off tool offers none of them for editing — and with every control
 * off, nothing here can report a change through `onHasChangesChange` and drag
 * the screen into a dirty state either.
 *
 * The panel also says why it is grey. The card's own explanation covers only the
 * controls the card renders itself, and a filter-supplied panel replaces those,
 * so a switched-off tool would otherwise grey this out with nothing to read.
 *
 * @param {Object}   props                    Component props.
 * @param {boolean}  props.disabled           Whether the tool is switched off.
 * @param {Function} props.onSaveRef          Receives this panel's save callback.
 * @param {Function} props.onHasChangesChange Called with whether the panel has unsaved work.
 */
function ChecklistSettings( { disabled, onSaveRef, onHasChangesChange } ) {
	const [ items, setItems ] = useState( [] );
	const [ originalItems, setOriginalItems ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ newItemLabel, setNewItemLabel ] = useState( '' );

	// Load items on mount.
	useEffect( () => {
		apiFetch( { path: '/workflow-tool-checklist/v1/items' } )
			.then( ( data ) => {
				setItems( data || [] );
				setOriginalItems( data || [] );
				setLoading( false );
			} )
			.catch( () => {
				setItems( [] );
				setOriginalItems( [] );
				setLoading( false );
			} );
	}, [] );

	const hasChanges =
		JSON.stringify( items ) !== JSON.stringify( originalItems );

	// Notify parent when hasChanges changes.
	useEffect( () => {
		if ( onHasChangesChange ) {
			onHasChangesChange( hasChanges );
		}
	}, [ hasChanges, onHasChangesChange ] );

	const saveItems = useCallback( async () => {
		if ( ! hasChanges ) {
			return;
		}

		const saved = await apiFetch( {
			path: '/workflow-tool-checklist/v1/items',
			method: 'POST',
			data: items,
		} );
		setItems( saved );
		setOriginalItems( saved );
	}, [ items, hasChanges ] );

	// Expose save function to parent via ref callback.
	useEffect( () => {
		if ( onSaveRef ) {
			onSaveRef( saveItems );
		}
	}, [ onSaveRef, saveItems ] );

	const addItem = () => {
		if ( ! newItemLabel.trim() ) {
			return;
		}
		const newItem = {
			id: `item_${ Date.now() }`,
			label: newItemLabel.trim(),
			required: false,
		};
		setItems( [ ...items, newItem ] );
		setNewItemLabel( '' );
	};

	const removeItem = ( id ) => {
		setItems( items.filter( ( item ) => item.id !== id ) );
	};

	const toggleRequired = ( id ) => {
		setItems(
			items.map( ( item ) =>
				item.id === id ? { ...item, required: ! item.required } : item
			)
		);
	};

	const updateLabel = ( id, label ) => {
		setItems(
			items.map( ( item ) =>
				item.id === id ? { ...item, label } : item
			)
		);
	};

	if ( loading ) {
		return (
			<div className="vip-checklist-settings__loading">
				<Spinner />{ ' ' }
				{ __( 'Loading items…', 'workflow-tool-checklist' ) }
			</div>
		);
	}

	return (
		<div className="vip-checklist-settings">
			<div className="vip-checklist-settings__header">
				<span>
					{ __( 'Checklist Items', 'workflow-tool-checklist' ) }
				</span>
				{ /*
				 * Why everything below is grey. The card states this for the
				 * controls it renders itself, but a filter-supplied panel
				 * replaces those, so it has to say it too — and it says it
				 * where the soft/hard legend was, since that legend describes
				 * behaviour a switched-off tool does not have.
				 */ }
				<span className="vip-checklist-settings__legend">
					{ disabled ? (
						__(
							'Enable the tool to change these settings.',
							'workflow-tool-checklist'
						)
					) : (
						<>
							<span className="vip-checklist-legend">
								⚠️{ ' ' }
								{ __(
									'Soft = optional',
									'workflow-tool-checklist'
								) }
							</span>
							<span className="vip-checklist-legend">
								🛑{ ' ' }
								{ __(
									'Hard = required',
									'workflow-tool-checklist'
								) }
							</span>
						</>
					) }
				</span>
			</div>

			<div className="vip-checklist-settings__items">
				{ items.length === 0 && (
					<p className="vip-checklist-settings__empty">
						{ __(
							'No checklist items yet. Add one below.',
							'workflow-tool-checklist'
						) }
					</p>
				) }
				{ items.map( ( item ) => (
					<div key={ item.id } className="vip-checklist-item">
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							value={ item.label }
							onChange={ ( val ) => updateLabel( item.id, val ) }
							className="vip-checklist-item__label"
							disabled={ disabled }
						/>
						<button
							type="button"
							className={ `vip-checklist-item__mode ${
								item.required
									? 'vip-checklist-item__mode--hard'
									: ''
							}` }
							onClick={ () => toggleRequired( item.id ) }
							disabled={ disabled }
							title={ modeTitle( item.required, disabled ) }
						>
							{ item.required ? '🛑 Hard' : '⚠️ Soft' }
						</button>
						<Button
							variant="tertiary"
							isDestructive
							onClick={ () => removeItem( item.id ) }
							className="vip-checklist-item__remove"
							disabled={ disabled }
						>
							✕
						</Button>
					</div>
				) ) }
			</div>

			<div className="vip-checklist-settings__add">
				<TextControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					placeholder={ __(
						'New checklist item…',
						'workflow-tool-checklist'
					) }
					value={ newItemLabel }
					onChange={ setNewItemLabel }
					disabled={ disabled }
					onKeyDown={ ( e ) => {
						if ( e.key === 'Enter' ) {
							e.preventDefault();
							addItem();
						}
					} }
				/>
				<Button
					variant="secondary"
					onClick={ addItem }
					disabled={ disabled || ! newItemLabel.trim() }
				>
					{ __( 'Add Item', 'workflow-tool-checklist' ) }
				</Button>
			</div>
		</div>
	);
}

// Register the settings component via WordPress hooks filter.
//
// `callbacks.disabled` says the tool card is switched off. A component that
// ignored it would keep letting a reader add, rename and delete items on a tool
// that never runs — the same bug the card fixed for its own controls.
addFilter(
	'vipWorkflow.toolSettingsComponent',
	'workflow-tool-checklist',
	( component, ability, callbacks ) => {
		if ( ability.id === 'workflow-tool-checklist/checklist' ) {
			return (
				<ChecklistSettings
					disabled={ callbacks.disabled }
					onHasChangesChange={ callbacks.onHasChangesChange }
					onSaveRef={ callbacks.onSaveRef }
				/>
			);
		}
		return component;
	}
);
