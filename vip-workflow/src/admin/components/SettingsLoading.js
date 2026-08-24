/**
 * SettingsLoading — the one loading row for settings screens.
 *
 * Four hand-rolled variants existed before this (`vip-workflow-loading`,
 * `vip-workflow-assistants-loading`, `vip-workflow-integrations-loading`, and an
 * inline-`style` one in PromptsSettings); they collapse into this. The row, its
 * centring and the 8px gap are the `Stack`'s; the shared class adds only the
 * surface padding and muted tone `Stack` has no props for.
 *
 * @package
 */

import { Spinner } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';

/**
 * A spinner beside a label, while a settings screen fetches.
 *
 * @param {Object} props         Component props.
 * @param {string} [props.label] What is loading. Defaults to a generic line.
 * @return {JSX.Element} The loading row.
 */
export function SettingsLoading( { label } ) {
	return (
		<Stack className="vip-workflow-loading" align="center" gap="sm">
			<Spinner />
			{ label || __( 'Loading…', 'vip-workflow' ) }
		</Stack>
	);
}
