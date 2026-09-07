/**
 * Avatar — who did something, in a fixed square of space.
 *
 * A person's picture that degrades to their initials. Every avatar in the admin
 * used to be a bare `<img src={ user.avatar }>` with no error handling. Avatar
 * URLs come from Gravatar (or whatever an install has filtered
 * `get_avatar_url` to), so a request that 404s, is blocked, or is simply empty
 * rendered the browser's broken-image glyph in a table row. This owns that
 * failure once, for every call site.
 *
 * Not every actor is a person: an agent acts, and so does the site itself. Those
 * have no picture and no initials worth taking, so they pass a glyph instead —
 * the same box, filled differently. Keeping them on this component rather than
 * beside it is what makes a row of mixed actors line up.
 *
 * Built on Base UI's Avatar primitive — the same substrate `@wordpress/ui` is
 * built on — which resolves the image out-of-band and swaps in `Avatar.Fallback`
 * when the load errors or there is no `src` at all. That is the primitive's job,
 * not ours: no `onError` handler and no "did it load" state here.
 *
 * The image and the glyph are both decorative: every call site renders the
 * actor's name immediately beside the avatar, so announcing it twice is noise.
 *
 * @package
 */

import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { Icon } from '@wordpress/ui';

import './Avatar.css';

/**
 * What each size can hold, keyed by the plugin's dimension scale.
 *
 * A smaller avatar is not the same avatar scaled: what fits changes with it, and
 * both of those are this component's business rather than a stylesheet's or a
 * call site's. Only the box itself is set in CSS, from the matching size token.
 *
 * `glyph` is the size handed to <Icon>. It is not the whole box, because a glyph
 * is drawn on a grid with an inset of its own — a library icon keeps 2 units of
 * its 24 clear on every side — so filling the box would still read smaller than
 * the initials beside it. The smaller box takes proportionally more of it, the
 * way a small mark has to.
 *
 * `initials` is how many letters there is room for. Two do not fit at `2xs`: the
 * widest pair runs past the box, and the box clips.
 */
const SIZES = {
	'2xs': { glyph: 12, initials: 1 },
	sm: { glyph: 16, initials: 2 },
};

/**
 * The letters shown when there is no usable image.
 *
 * First letter of the first word plus first letter of the last word, so
 * "Ada Lovelace" reads "AL" and a single-word name reads with one letter.
 * Split with `Array.from` rather than `[ 0 ]` so a name starting with an
 * astral character (an emoji, some CJK extensions) yields a whole glyph
 * instead of half a surrogate pair. `toUpperCase()` is a no-op for scripts
 * without case, which is the correct behaviour for them.
 *
 * @param {string} name  Display name.
 * @param {number} limit How many letters the box has room for.
 * @return {string} One or two characters, or '' for a blank name.
 */
function getInitials( name, limit ) {
	const words = String( name ?? '' )
		.trim()
		.split( /\s+/ )
		.filter( Boolean );

	if ( words.length === 0 ) {
		return '';
	}

	const first = Array.from( words[ 0 ] )[ 0 ];
	const last =
		words.length > 1 && limit > 1
			? Array.from( words[ words.length - 1 ] )[ 0 ]
			: '';

	return `${ first }${ last }`.toUpperCase();
}

/**
 * @param {Object} props             Props.
 * @param {string} [props.src]       Avatar image URL. Absent or unloadable falls back to the glyph, or to initials.
 * @param {string} props.name        Display name — the source of the initials.
 * @param {*}      [props.icon]      Glyph standing in for a picture, for an actor that is not a person.
 * @param {string} [props.size]      A key of SIZES: `2xs` or `sm`.
 * @param {string} [props.className] Extra class for the call site's own layout.
 * @return {JSX.Element} Avatar.
 */
export function Avatar( { src, name, icon, size = 'sm', className = '' } ) {
	const { glyph, initials } = SIZES[ size ];
	const classNames = [
		'vip-workflows-avatar',
		`vip-workflows-avatar--${ size }`,
		className,
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<BaseAvatar.Root className={ classNames }>
			<BaseAvatar.Image
				src={ src }
				alt=""
				className="vip-workflows-avatar__image"
			/>
			<BaseAvatar.Fallback className="vip-workflows-avatar__initials">
				{ icon ? (
					<Icon icon={ icon } size={ glyph } />
				) : (
					getInitials( name, initials )
				) }
			</BaseAvatar.Fallback>
		</BaseAvatar.Root>
	);
}
