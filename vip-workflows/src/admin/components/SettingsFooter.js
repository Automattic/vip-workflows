/**
 * SettingsFooter — the one save bar per settings screen.
 *
 * A settings screen has exactly one Save, or none at all; it never has one per
 * card or per section. This is where that button lives: pinned to the bottom of
 * the content column so it stays reachable while the reader works down a long
 * list, and holding an `ActionRow` so the button group's alignment and gap come
 * from the same primitive every other action group uses.
 *
 * The bar owns only its own chrome — the rule above it, the surface behind it,
 * and the space around it. Consumers pass buttons and nothing else.
 *
 * @package
 */

import { ActionRow } from '../../common/ActionRow';

import './SettingsFooter.css';

/**
 * The sticky save bar at the bottom of a settings screen.
 *
 * @param {Object} props          Component props.
 * @param {Node}   props.children The screen's one primary action.
 * @return {JSX.Element} The footer.
 */
export function SettingsFooter( { children } ) {
	return (
		<ActionRow className="vip-workflow-settings-footer">
			{ children }
		</ActionRow>
	);
}
