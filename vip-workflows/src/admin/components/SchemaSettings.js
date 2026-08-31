/**
 * Schema-driven Settings Renderer
 *
 * Auto-renders form fields from a settings_schema definition.
 * Used by the Tools, Assistants, and Notification Channels tabs
 * so that plugins can define configuration fields in PHP without
 * writing React code.
 *
 * Supported field types:
 *   - string (text input, or password if secret: true, or textarea if multiline)
 *   - string + enum (select dropdown)
 *   - integer / number (number input with optional min/max)
 *   - boolean (toggle)
 *
 * Optional props for tool check modes:
 *   - checkModes: object mapping field key to 'soft' or 'hard'
 *   - onCheckModeChange: callback(key, mode) when a check mode pill is toggled
 *   Only fields with `enforceable: true` in the schema will show the pill.
 *
 * `disabled` switches off every control the panel renders. A consumer whose
 * entity can be turned off passes it, so that a switched-off tool or agent
 * cannot be configured — and cannot mark its screen dirty — while it is off.
 *
 * @package
 */

import {
	TextControl,
	TextareaControl,
	ToggleControl,
	SelectControl,
	__experimentalToggleGroupControl as ToggleGroupControl,
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
} from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import { useId } from '@wordpress/element';

import './SchemaSettings.css';

function CheckModePill( { value, onChange, disabled = false } ) {
	return (
		<ToggleGroupControl
			label={ __( 'Check enforcement mode', 'vip-workflows' ) }
			hideLabelFromVision
			isBlock
			value={ value }
			onChange={ onChange }
			__nextHasNoMarginBottom
			__next40pxDefaultSize
		>
			{ /* `disabled` goes on the options, not the group: the group
			     spreads unknown props onto its Ariakit radio-group <div>,
			     where the attribute is inert. Each option forwards it to
			     the <button> it renders. */ }
			<ToggleGroupControlOption
				value="soft"
				label={ __( 'Soft', 'vip-workflows' ) }
				disabled={ disabled }
			/>
			<ToggleGroupControlOption
				value="hard"
				label={ __( 'Hard', 'vip-workflows' ) }
				disabled={ disabled }
			/>
		</ToggleGroupControl>
	);
}

function isMultiline( key, field ) {
	return (
		key === 'prompt' ||
		( typeof field.default === 'string' && field.default.includes( '\n' ) )
	);
}

export { CheckModePill };

export function SchemaSettings( {
	schema,
	values,
	onChange,
	className,
	checkModes,
	onCheckModeChange,
	disabled = false,
} ) {
	const instanceId = useId();
	const entries = Object.entries( schema );
	if ( entries.length === 0 ) {
		return null;
	}

	const showCheckModes = !! onCheckModeChange;

	return (
		// wpds-allow R7 -- shared settings surface (combined selector also styles AssistantCard); flex retained for that consumer
		<div className={ className || 'vip-workflows-schema-settings' }>
			{ entries.map( ( [ key, field ] ) => {
				const value = values[ key ] ?? field.default ?? '';
				const fieldId = `vip-workflows-schema-settings-${ instanceId }-${ key }`;
				const label = field.label || field.description || key;
				const help = field.label ? field.description || '' : '';
				const required = field.required || false;
				const enforceable = showCheckModes && field.enforceable;

				const pill = enforceable ? (
					<CheckModePill
						value={ checkModes?.[ key ] ?? 'soft' }
						onChange={ ( mode ) => onCheckModeChange( key, mode ) }
						disabled={ disabled }
					/>
				) : null;

				if ( field.type === 'boolean' ) {
					return (
						<div
							key={ key }
							className={
								enforceable
									? 'vip-workflows-tool-option vip-workflows-tool-option--check'
									: undefined
							}
						>
							<Stack
								align="center"
								justify="space-between"
								gap="lg"
							>
								<div
									className={
										enforceable
											? 'vip-workflows-tool-option__toggle-group'
											: undefined
									}
								>
									<ToggleControl
										__nextHasNoMarginBottom
										label={ label }
										help={ help }
										checked={
											!! (
												values[ key ] ??
												field.default ??
												false
											)
										}
										onChange={ ( val ) =>
											onChange( key, val )
										}
										disabled={ disabled }
									/>
								</div>
								{ pill }
							</Stack>
						</div>
					);
				}

				if ( field.type === 'string' && Array.isArray( field.enum ) ) {
					return (
						<div
							key={ key }
							className={
								enforceable
									? 'vip-workflows-tool-option vip-workflows-tool-option--check'
									: undefined
							}
						>
							{ enforceable && (
								// wpds-allow R7 -- label wrapper (margin only) in raw option row
								<div className="vip-workflows-tool-option__header">
									<label
										className="vip-workflows-tool-option__label"
										htmlFor={ fieldId }
									>
										{ label }
									</label>
								</div>
							) }
							<Stack
								align="center"
								justify="space-between"
								gap="lg"
							>
								<SelectControl
									__next40pxDefaultSize
									__nextHasNoMarginBottom
									id={ fieldId }
									label={ enforceable ? undefined : label }
									help={ help }
									value={ value }
									options={ field.enum.map( ( v ) => ( {
										label: v,
										value: v,
									} ) ) }
									onChange={ ( val ) => onChange( key, val ) }
									disabled={ disabled }
								/>
								{ pill }
							</Stack>
						</div>
					);
				}

				if ( field.type === 'integer' || field.type === 'number' ) {
					return (
						<div
							key={ key }
							className={
								enforceable
									? 'vip-workflows-tool-option vip-workflows-tool-option--check'
									: undefined
							}
						>
							<Stack
								align="center"
								justify="space-between"
								gap="lg"
							>
								<Stack
									direction="row"
									align="center"
									gap="md"
									className={
										enforceable
											? 'vip-workflows-tool-option__input-group'
											: undefined
									}
								>
									{ enforceable ? (
										<>
											<label
												className="vip-workflows-tool-option__label"
												htmlFor={ fieldId }
											>
												{ label }
											</label>
											<TextControl
												__next40pxDefaultSize
												__nextHasNoMarginBottom
												id={ fieldId }
												type="number"
												className="vip-workflows-tool-option__number"
												value={ value }
												onChange={ ( val ) =>
													onChange(
														key,
														field.type === 'integer'
															? parseInt(
																	val,
																	10
															  ) || 0
															: parseFloat(
																	val
															  ) || 0
													)
												}
												min={ field.minimum }
												max={ field.maximum }
												disabled={ disabled }
											/>
										</>
									) : (
										<TextControl
											__next40pxDefaultSize
											__nextHasNoMarginBottom
											type="number"
											label={ label }
											help={ help }
											value={ value }
											min={ field.minimum }
											max={ field.maximum }
											onChange={ ( val ) =>
												onChange(
													key,
													field.type === 'integer'
														? parseInt( val, 10 ) ||
																0
														: parseFloat( val ) || 0
												)
											}
											disabled={ disabled }
										/>
									) }
								</Stack>
								{ pill }
							</Stack>
						</div>
					);
				}

				if ( field.type === 'string' && isMultiline( key, field ) ) {
					return (
						<div
							key={ key }
							className={
								enforceable
									? 'vip-workflows-tool-option vip-workflows-tool-option--check'
									: undefined
							}
						>
							{ enforceable && (
								// wpds-allow R7 -- label wrapper (margin only) in raw option row
								<div className="vip-workflows-tool-option__header">
									<label
										className="vip-workflows-tool-option__label"
										htmlFor={ fieldId }
									>
										{ label }
									</label>
								</div>
							) }
							<Stack
								align="center"
								justify="space-between"
								gap="lg"
							>
								<TextareaControl
									__nextHasNoMarginBottom
									id={ fieldId }
									className="vip-workflows-tool-option__textarea"
									label={ enforceable ? undefined : label }
									help={ enforceable ? undefined : help }
									placeholder={ field.placeholder || '' }
									value={ value }
									onChange={ ( val ) => onChange( key, val ) }
									rows={ 6 }
									disabled={ disabled }
								/>
								{ pill }
							</Stack>
						</div>
					);
				}

				let textFieldLabel;
				if ( enforceable ) {
					textFieldLabel = undefined;
				} else if ( required ) {
					textFieldLabel = `${ label } *`;
				} else {
					textFieldLabel = label;
				}

				return (
					<div
						key={ key }
						className={
							enforceable
								? 'vip-workflows-tool-option vip-workflows-tool-option--check'
								: undefined
						}
					>
						{ enforceable && (
							// wpds-allow R7 -- label wrapper (margin only) in raw option row
							<div className="vip-workflows-tool-option__header">
								<label
									className="vip-workflows-tool-option__label"
									htmlFor={ fieldId }
								>
									{ required ? `${ label } *` : label }
								</label>
							</div>
						) }
						<Stack align="center" justify="space-between" gap="lg">
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								id={ fieldId }
								type={ field.secret ? 'password' : 'text' }
								label={ textFieldLabel }
								help={ help }
								value={ value }
								placeholder={ field.placeholder || '' }
								onChange={ ( val ) => onChange( key, val ) }
								disabled={ disabled }
							/>
							{ pill }
						</Stack>
					</div>
				);
			} ) }
		</div>
	);
}
