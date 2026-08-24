/**
 * Checklist Tool - Editor Sidebar Panel
 *
 * Registers a sidebar panel that shows checklist items with checkboxes.
 * Users can check items, and the state is saved to post meta.
 */

import './editor.css';
import { useState, useEffect } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { registerPlugin } from '@wordpress/plugins';
import { PluginDocumentSettingPanel } from '@wordpress/editor';
import { CheckboxControl, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const TOOL_ID = 'workflow-tool-checklist/checklist';
const WORKFLOW_STORE = 'vip-workflow/editor';

/**
 * Check if any transition in the sequence references this tool.
 * @param {Object} sequence Sequence configuration.
 */
function sequenceUsesChecklist( sequence ) {
	if ( ! sequence?.statuses ) {
		return false;
	}

	return sequence.statuses.some( ( status ) =>
		( status.transitions || [] ).some( ( t ) =>
			( t.required_tools || [] ).includes( TOOL_ID )
		)
	);
}

/**
 * Checklist Panel Component
 */
function ChecklistPanel() {
	const [ items, setItems ] = useState( [] );
	const [ checkedItems, setCheckedItems ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ saving, setSaving ] = useState( false );

	const { postId, hasWorkflow, sequence } = useSelect( ( select ) => {
		const s = select( WORKFLOW_STORE );
		return {
			postId: s.getPostId(),
			hasWorkflow: s.hasWorkflow(),
			sequence: s.getSequence(),
		};
	}, [] );

	const isRelevant = hasWorkflow && sequenceUsesChecklist( sequence );

	// Load checklist items and checked state.
	useEffect( () => {
		if ( ! postId || ! isRelevant ) {
			setLoading( false );
			return;
		}

		Promise.all( [
			apiFetch( { path: '/workflow-tool-checklist/v1/items' } ),
			apiFetch( {
				path: `/workflow-tool-checklist/v1/post/${ postId }/checked`,
			} ),
		] )
			.then( ( [ itemsData, checkedData ] ) => {
				setItems( itemsData || [] );
				setCheckedItems( checkedData || [] );
				setLoading( false );
			} )
			.catch( () => {
				setItems( [] );
				setCheckedItems( [] );
				setLoading( false );
			} );
	}, [ postId, isRelevant ] );

	// Toggle a checkbox.
	const toggleItem = async ( itemId ) => {
		const newChecked = checkedItems.includes( itemId )
			? checkedItems.filter( ( id ) => id !== itemId )
			: [ ...checkedItems, itemId ];

		setCheckedItems( newChecked );
		setSaving( true );

		try {
			await apiFetch( {
				path: `/workflow-tool-checklist/v1/post/${ postId }/checked`,
				method: 'POST',
				data: { checked: newChecked },
			} );
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error( 'Failed to save checklist state:', err );
		} finally {
			setSaving( false );
		}
	};

	if ( ! isRelevant ) {
		return null;
	}

	// Don't show if no items configured.
	if ( ! loading && items.length === 0 ) {
		return null;
	}

	if ( loading ) {
		return (
			<PluginDocumentSettingPanel
				name="workflow-checklist"
				title={ __(
					'Workflow: Pre-publish Checklist',
					'workflow-tool-checklist'
				) }
				className="workflow-checklist-panel"
			>
				<div className="workflow-checklist-loading">
					<Spinner />
					{ __( 'Loading checklist…', 'workflow-tool-checklist' ) }
				</div>
			</PluginDocumentSettingPanel>
		);
	}

	const requiredItems = items.filter( ( item ) => item.required );
	const optionalItems = items.filter( ( item ) => ! item.required );
	const allRequiredChecked = requiredItems.every( ( item ) =>
		checkedItems.includes( item.id )
	);

	return (
		<PluginDocumentSettingPanel
			name="workflow-checklist"
			title={ __(
				'Workflow: Pre-publish Checklist',
				'workflow-tool-checklist'
			) }
			className="workflow-checklist-panel"
		>
			<div className="workflow-checklist">
				{ requiredItems.length > 0 && (
					<div className="workflow-checklist__section">
						<div className="workflow-checklist__section-header">
							<span className="workflow-checklist__section-icon">
								🛑
							</span>
							{ __( 'Required', 'workflow-tool-checklist' ) }
						</div>
						{ requiredItems.map( ( item ) => (
							<CheckboxControl
								key={ item.id }
								__nextHasNoMarginBottom
								label={ item.label }
								checked={ checkedItems.includes( item.id ) }
								onChange={ () => toggleItem( item.id ) }
								className="workflow-checklist__item workflow-checklist__item--required"
							/>
						) ) }
					</div>
				) }

				{ optionalItems.length > 0 && (
					<div className="workflow-checklist__section">
						<div className="workflow-checklist__section-header">
							<span className="workflow-checklist__section-icon">
								⚠️
							</span>
							{ __( 'Optional', 'workflow-tool-checklist' ) }
						</div>
						{ optionalItems.map( ( item ) => (
							<CheckboxControl
								key={ item.id }
								__nextHasNoMarginBottom
								label={ item.label }
								checked={ checkedItems.includes( item.id ) }
								onChange={ () => toggleItem( item.id ) }
								className="workflow-checklist__item"
							/>
						) ) }
					</div>
				) }

				{ saving && (
					<div className="workflow-checklist__saving">
						{ __( 'Saving…', 'workflow-tool-checklist' ) }
					</div>
				) }

				{ ! allRequiredChecked && (
					<div className="workflow-checklist__warning">
						{ __(
							'Complete all required items before publishing.',
							'workflow-tool-checklist'
						) }
					</div>
				) }

				{ allRequiredChecked && requiredItems.length > 0 && (
					<div className="workflow-checklist__success">
						{ __(
							'✓ All required items complete',
							'workflow-tool-checklist'
						) }
					</div>
				) }
			</div>
		</PluginDocumentSettingPanel>
	);
}

// Register the plugin.
registerPlugin( 'workflow-tool-checklist', {
	render: ChecklistPanel,
	icon: 'yes-alt',
} );
