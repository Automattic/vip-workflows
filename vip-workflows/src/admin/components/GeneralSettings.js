/**
 * General settings panel.
 *
 * Workflow enforcement, self-review, role bypass and audit-log access, as three
 * `SettingsSection`s — core's borderless fieldset-and-legend grouping, not a card
 * titled after the tab it sits in.
 *
 * The panel stages its edits and reports two things to the Settings page: whether
 * it has unsaved work, and how to save it. The screen's one Save calls back into
 * it. See docs/guides/settings-standard.md.
 *
 * @package
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	ToggleControl,
	RadioControl,
	CheckboxControl,
	Notice,
} from '@wordpress/components';
import { Fieldset, Stack, Text } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';

import { SettingsSection } from './SettingsSection';
import { SettingsLoading } from './SettingsLoading';
import './GeneralSettings.css';

/**
 * The id this panel reports its dirty state and its save handler under.
 */
const PANEL_ID = 'general';

/**
 * A named group of role checkboxes.
 *
 * A sub-group inside a section, so its name is an `h3` and its context sits
 * *above* the grid: a paragraph under a row of checkboxes reads as a footnote to
 * the last one.
 *
 * Uses `@wordpress/ui`'s `Fieldset` rather than a native `<legend>`. Base UI's
 * legend is a `<div>` wired through `aria-labelledby`, which avoids the browser
 * reserving extra intrinsic height for a rendered legend when the fieldset is a
 * flex item (see TransitionAssignmentConfig for the same pattern).
 *
 * @param {Object}   props               Component props.
 * @param {string}   props.label         Name of the group.
 * @param {string}   props.description   What selecting a role in this group does.
 * @param {Array}    props.roles         Available roles, each with `key` and `name`.
 * @param {Array}    props.selectedRoles Keys of the currently selected roles.
 * @param {Function} props.onChange      Called with the updated array of selected role keys.
 * @return {JSX.Element} The role checkbox group.
 */
function RoleCheckboxGroup( {
	label,
	description,
	roles,
	selectedRoles,
	onChange,
} ) {
	const handleChange = ( roleKey, checked ) => {
		if ( checked ) {
			onChange( [ ...selectedRoles, roleKey ] );
		} else {
			onChange( selectedRoles.filter( ( r ) => r !== roleKey ) );
		}
	};

	return (
		<Fieldset.Root className="vip-workflow-settings-field">
			<Fieldset.Legend className="vip-workflow-settings-field__legend">
				<Text variant="heading-sm" render={ <h3 /> }>
					{ label }
				</Text>
			</Fieldset.Legend>
			<Fieldset.Description
				className="vip-workflow-settings-field__description"
				render={ <Text variant="body-md" render={ <p /> } /> }
			>
				{ description }
			</Fieldset.Description>
			{ /* wpds-allow R7 -- CSS Grid (auto-fill role columns); no Stack equivalent */ }
			<div className="vip-workflow-settings-field__roles">
				{ roles.map( ( role ) => (
					<CheckboxControl
						key={ role.key }
						__nextHasNoMarginBottom
						label={ role.name }
						checked={ selectedRoles.includes( role.key ) }
						onChange={ ( checked ) =>
							handleChange( role.key, checked )
						}
					/>
				) ) }
			</div>
		</Fieldset.Root>
	);
}

/**
 * General settings panel.
 *
 * @param {Object}   props               Component props.
 * @param {Function} props.onDirtyChange Called with ( id, hasChanges ).
 * @param {Function} props.registerSave  Called with ( id, saveFn ).
 * @return {JSX.Element} The panel.
 */
export function GeneralSettings( { onDirtyChange, registerSave } ) {
	const [ settings, setSettings ] = useState( null );
	const [ originalSettings, setOriginalSettings ] = useState( null );
	const [ roles, setRoles ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		Promise.all( [
			apiFetch( { path: '/vip-workflow/v1/settings/general' } ),
			apiFetch( { path: '/vip-workflow/v1/settings/general/roles' } ),
		] )
			.then( ( [ settingsData, rolesData ] ) => {
				setSettings( settingsData );
				setOriginalSettings( settingsData );
				setRoles( rolesData );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setLoading( false );
			} );
	}, [] );

	const hasChanges =
		JSON.stringify( settings ) !== JSON.stringify( originalSettings );

	useEffect( () => {
		onDirtyChange( PANEL_ID, hasChanges );
	}, [ hasChanges, onDirtyChange ] );

	const save = useCallback( async () => {
		// Only the fields this panel owns are sent. The AI panel writes the
		// provider and model through the same route, so posting the whole
		// payload back would overwrite whatever it saved a moment earlier.
		const updated = await apiFetch( {
			path: '/vip-workflow/v1/settings/general',
			method: 'POST',
			data: {
				workflow_enforcement: settings.workflow_enforcement,
				workflow_enforcement_mode: settings.workflow_enforcement_mode,
				allow_self_review: settings.allow_self_review,
				bypass_workflow_roles: settings.bypass_workflow_roles,
				bypass_tool_check_roles: settings.bypass_tool_check_roles,
				audit_log_roles: settings.audit_log_roles,
				audit_log_full_access_roles:
					settings.audit_log_full_access_roles,
			},
		} );
		setSettings( updated );
		setOriginalSettings( updated );
	}, [ settings ] );

	useEffect( () => {
		registerSave( PANEL_ID, save );
	}, [ save, registerSave ] );

	if ( loading ) {
		return (
			<SettingsLoading
				label={ __( 'Loading settings…', 'vip-workflow' ) }
			/>
		);
	}

	if ( ! settings ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ sprintf(
					/* translators: %s: error message from the settings request. */
					__( 'Failed to load settings: %s', 'vip-workflow' ),
					error
				) }
			</Notice>
		);
	}

	return (
		<Stack direction="column" gap="2xl">
			<SettingsSection
				title={ __( 'Workflow behavior', 'vip-workflow' ) }
			>
				<ToggleControl
					__nextHasNoMarginBottom
					label={ __(
						'Prompt workflow selection for new posts',
						'vip-workflow'
					) }
					help={ __(
						'A modal prompts users to select a workflow when they create a post.',
						'vip-workflow'
					) }
					checked={ settings.workflow_enforcement }
					onChange={ ( val ) =>
						setSettings( {
							...settings,
							workflow_enforcement: val,
						} )
					}
				/>

				{ settings.workflow_enforcement && (
					<RadioControl
						label={ __( 'Enforcement mode', 'vip-workflow' ) }
						selected={ settings.workflow_enforcement_mode }
						options={ [
							{
								label: __(
									'Require — users must select a workflow to continue',
									'vip-workflow'
								),
								value: 'require',
							},
							{
								label: __(
									'Recommend — users can skip and continue without a workflow',
									'vip-workflow'
								),
								value: 'recommend',
							},
						] }
						onChange={ ( val ) =>
							setSettings( {
								...settings,
								workflow_enforcement_mode: val,
							} )
						}
					/>
				) }

				<ToggleControl
					__nextHasNoMarginBottom
					label={ __(
						'Allow users to review their own posts',
						'vip-workflow'
					) }
					help={ __(
						'Authors can see their own posts in the Review Queue.',
						'vip-workflow'
					) }
					checked={ settings.allow_self_review }
					onChange={ ( val ) =>
						setSettings( {
							...settings,
							allow_self_review: val,
						} )
					}
				/>
			</SettingsSection>

			<SettingsSection
				title={ __( 'Bypass permissions', 'vip-workflow' ) }
			>
				<RoleCheckboxGroup
					label={ __( 'Workflow override', 'vip-workflow' ) }
					description={ __(
						'Selected roles can change post status directly, bypassing workflow restrictions.',
						'vip-workflow'
					) }
					roles={ roles }
					selectedRoles={ settings.bypass_workflow_roles }
					onChange={ ( val ) =>
						setSettings( {
							...settings,
							bypass_workflow_roles: val,
						} )
					}
				/>

				<RoleCheckboxGroup
					label={ __( 'Tool check bypass', 'vip-workflow' ) }
					description={ __(
						'Selected roles can proceed with transitions even when required tool checks fail.',
						'vip-workflow'
					) }
					roles={ roles }
					selectedRoles={ settings.bypass_tool_check_roles }
					onChange={ ( val ) =>
						setSettings( {
							...settings,
							bypass_tool_check_roles: val,
						} )
					}
				/>
			</SettingsSection>

			<SettingsSection title={ __( 'Audit log access', 'vip-workflow' ) }>
				<RoleCheckboxGroup
					label={ __( 'Own activity', 'vip-workflow' ) }
					description={ __(
						'Selected roles can open the audit log and see their own activity in it.',
						'vip-workflow'
					) }
					roles={ roles }
					selectedRoles={ settings.audit_log_roles }
					onChange={ ( val ) =>
						setSettings( {
							...settings,
							audit_log_roles: val,
						} )
					}
				/>

				<RoleCheckboxGroup
					label={ __( 'All activity', 'vip-workflow' ) }
					description={ __(
						"Selected roles can see every user's activity in the audit log.",
						'vip-workflow'
					) }
					roles={ roles }
					selectedRoles={ settings.audit_log_full_access_roles }
					onChange={ ( val ) =>
						setSettings( {
							...settings,
							audit_log_full_access_roles: val,
						} )
					}
				/>
			</SettingsSection>
		</Stack>
	);
}
