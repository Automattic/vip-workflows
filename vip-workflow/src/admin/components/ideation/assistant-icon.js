/**
 * Icon rendering for anything the server names by slug.
 *
 * A registration — an assistant, a channel, a job, an experiment — declares its
 * icon in PHP, which can only ship a string. This is where that string becomes
 * an element, and the map below is the whole vocabulary: a slug outside it
 * renders nothing rather than guessing.
 *
 * It is an allow-list on purpose. The two things it replaced were a dashicon
 * font class and a literal emoji passed straight through, and both are banned by
 * `docs/guides/settings-standard.md` — emoji render differently per platform,
 * carry no meaning to assistive tech and cannot be themed, and dashicons are a
 * second icon system beside the design system's own. Neither could be validated
 * either: any string at all produced *something*, so a typo shipped as a blank
 * square rather than as a bug.
 *
 * Names are `@wordpress/icons` exports in kebab-case, except where the library
 * has no twin for a picture worth keeping — `camera` resolves to `capturePhoto`
 * and `align-wide` to `alignJustify`, the same drawings under other names. Adding a slug means adding it
 * here and importing it, which is the point: that is the moment someone checks
 * the icon exists.
 *
 * @package
 */

import { Icon } from '@wordpress/components';
import {
	alignJustify,
	archive,
	bell,
	calendar,
	capturePhoto,
	chartBar,
	cog,
	comment,
	envelope,
	link,
	page,
	pencil,
	plugins,
	search,
	starFilled,
	tag,
	tool,
	trendingUp,
	typography,
} from '@wordpress/icons';

/**
 * Every icon slug a registration may name.
 *
 * @type {Object<string, Object>}
 */
const ICONS = {
	'align-wide': alignJustify,
	archive,
	bell,
	calendar,
	camera: capturePhoto,
	'chart-bar': chartBar,
	'chart-line': trendingUp,
	cog,
	comment,
	envelope,
	link,
	page,
	pencil,
	plugins,
	search,
	'star-filled': starFilled,
	tag,
	tool,
	typography,
};

/**
 * Render a registration's icon.
 *
 * @param {string} icon   Icon slug, from the vocabulary above.
 * @param {number} [size] Icon size in pixels.
 * @return {JSX.Element|null} The icon, or null when the slug is unknown.
 */
export function renderAssistantIcon( icon, size = 20 ) {
	if ( ! isKnownIcon( icon ) ) {
		return null;
	}

	return <Icon icon={ ICONS[ icon ] } size={ size } />;
}

/**
 * Whether a slug names an icon this renderer knows.
 *
 * Module-private: `renderAssistantIcon()` already answers `null` for a slug
 * outside the vocabulary, which is the whole of what a caller needs — an
 * exported predicate beside it only invites a second, divergent gate.
 *
 * @param {string} icon Icon slug.
 * @return {boolean} True when the slug is in the vocabulary.
 */
function isKnownIcon( icon ) {
	// `hasOwn`, not a bare lookup: the map is an object literal, so a slug
	// naming an Object.prototype member ('constructor', 'toString') would
	// otherwise resolve truthy and hand <Icon> something that is not one.
	return Boolean( icon && Object.hasOwn( ICONS, icon ) );
}
