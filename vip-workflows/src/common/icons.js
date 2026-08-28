/**
 * Glyphs `@wordpress/icons` does not ship.
 *
 * Every other icon in this plugin comes from that library, which is the right
 * default: it is the house set, it is already loaded, and its glyphs are drawn
 * to one grid. What lands here is only what the library has no answer for.
 *
 * Drawn the way the library draws its own — `SVG` and `Path` from
 * `@wordpress/primitives` on a 24×24 grid, painting with `currentColor` — so
 * `<Icon>` sizes and colours one of these exactly as it does a library glyph,
 * and a caller never has to know which set a glyph came from.
 *
 * @package
 */

import { Path, SVG } from '@wordpress/primitives';

/**
 * Sparkle — the mark for something an AI did.
 *
 * A large four-pointed star with a smaller one at its shoulder. The pair is
 * centred on the grid and fills it edge to edge (x and y both run 2 → 22), the
 * same inset the library's own glyphs keep, so it sits square inside an avatar
 * rather than drifting up and to the right of one.
 *
 * Purple is this plugin's AI tone (see the `--vip-workflow-color-*-ai` tokens),
 * but the glyph states no colour of its own: an agent's avatar tints it, and a
 * caller that wants it in running text gets the text's colour.
 */
export const sparkle = (
	<SVG viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<Path
			fill="currentColor"
			d="M9.5 2.5 11.2 8.3 17 10 11.2 11.7 9.5 17.5 7.8 11.7 2 10 7.8 8.3ZM17.5 12.5 18.5 16 22 17 18.5 18 17.5 21.5 16.5 18 13 17 16.5 16Z"
		/>
	</SVG>
);
