/**
 * StatusBadge — the shared workflow status pill.
 *
 * A neutral `@wordpress/ui` Badge tinted with a stage's color, used across the
 * CPT, My Queue, My Work, My Ideation, and Audit Log lists. The tint is an
 * inline style that fully replaces the Badge's colors, so the Badge carries the
 * neutral `none` intent rather than a contentful one that the style would hide.
 * `color` may be empty/undefined (e.g. core statuses without a workflow color),
 * in which case the plain neutral pill shows.
 *
 * @package
 */

import { Badge } from '@wordpress/ui';

import { statusPillStyle } from '../utils/stage-colors';

/**
 * @param {Object} props          Props.
 * @param {string} [props.color]  Stage color (hex) to tint the pill.
 * @param {*}      props.children Label text.
 * @return {JSX.Element} The status pill.
 */
export default function StatusBadge( { color, children } ) {
	return (
		<Badge intent="none" style={ statusPillStyle( color ) }>
			{ children }
		</Badge>
	);
}
