/**
 * Shared DataViews field-render cells.
 *
 * The list surfaces (CPT posts, My Queue, My Work, My Ideation, Audit Log) all
 * render the same two cell types — a linked title, and whoever did something
 * with their avatar — so they live here once instead of being re-implemented
 * (with drifting markup and CSS) per page. Status pills are the separate shared
 * `StatusBadge`.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';
import { Link, Stack, Text } from '@wordpress/ui';
import { wordpress } from '@wordpress/icons';

import { Avatar } from './Avatar';
import { sparkle } from './icons';

import './DataViewCells.css';

// What stands in for a picture, per kind of actor. A person is absent from this
// map on purpose: they have a picture, or initials taken from their name.
const ACTOR_GLYPHS = {
	agent: sparkle,
	system: wordpress,
};

/**
 * The site itself, as an actor.
 *
 * The server answers `null` for something no user can be credited for — a cron
 * run, a deleted account — because there is nobody to link, credit or draw, and
 * inventing a person there would be a lie the API tells. Naming that absence is
 * the view's job, which is why the word lives here and not in PHP: one place to
 * translate it, one place to change it.
 *
 * A function rather than a constant so `__()` runs when the cell renders, after
 * the locale is in place, rather than when the bundle is evaluated.
 *
 * @return {Object} An actor standing for the site.
 */
export function systemActor() {
	return {
		display_name: __( 'System', 'vip-workflow' ),
		type: 'system',
		avatar: null,
	};
}

/**
 * Linked title cell. A `@wordpress/ui` Link, which owns the whole treatment —
 * color, hover, underline. The class is a selector hook only; it carries no
 * styles, so every list's title reads exactly as the design system draws it.
 *
 * @param {Object} props          Props.
 * @param {string} props.href     Destination.
 * @param {string} [props.target] Link target (e.g. '_blank').
 * @param {*}      props.children Title text.
 * @return {JSX.Element} Title link.
 */
export function TitleLink( { href, target, children } ) {
	return (
		<Link
			href={ href }
			target={ target }
			className="vip-workflow-dataview-title"
		>
			{ children }
		</Link>
	);
}

/**
 * Who did something — an avatar followed by a name.
 *
 * Three kinds of actor turn up in these lists and all three read the same way,
 * because a reader scanning a column wants one shape, not three. What differs is
 * only what fills the avatar:
 *
 *  - a person: their picture, falling back to their initials. The shared
 *    `<Avatar>` owns that swap, so a Gravatar that 404s or is blocked shows
 *    initials rather than a broken-image glyph in the middle of a table row.
 *  - an agent: the sparkle, in this plugin's AI tone. A reviewer scanning an
 *    audit log can tell at a glance which entries an agent made, and the name
 *    beside it says which agent.
 *  - the site itself: the WordPress mark, for an event no user can be credited
 *    for — a cron run, a deleted account.
 *
 * The row is a `<Stack>` rendered as a `<span>`: the cell sits inside a table
 * cell on the list pages and inside the audit log's inline meta row ("date ·
 * name · post"), so it has to stay inline-level rather than blockify.
 *
 * It takes the whole actor rather than a name and a URL, because that is the
 * shape every route now serves (see `VIPWorkflow\Workflow\Actor`). A caller that
 * has to pick a person apart into props is a caller that can get the pieces
 * wrong, and six of them did.
 *
 * `children` is a trailing slot for something the *context* adds about this
 * person — a Kanban card's "assigned" badge, the editor's "(you)". It sits
 * inside the row so it stays on the avatar's centre line and travels with the
 * name; a sibling beside the cell would not.
 *
 * `variant` is opt-in rather than defaulted, because who owns the type depends
 * on where the cell sits. In a DataViews cell and in the audit log's meta row
 * the layout around it sets the scale, and imposing one here would override it;
 * on a card or in a dialog nothing else is setting one, so the caller names it
 * and the name stops inheriting whatever happens to be nearby.
 *
 * @param {Object} props             Props.
 * @param {Object} [props.actor]     Actor: `{ display_name, avatar, type }`. Nothing is drawn without a name.
 * @param {string} [props.size]      Avatar size — an `<Avatar>` size key. Lists use the smaller default; a card wants `sm`.
 * @param {string} [props.variant]   A `<Text>` variant for the name. Omit inside a layout that sets its own type.
 * @param {string} [props.className] Extra class for the call site's own layout.
 * @param {*}      [props.children]  Trailing slot, rendered after the name.
 * @return {JSX.Element|null} Author cell.
 */
export function AuthorCell( {
	actor,
	size = '2xs',
	variant,
	className = '',
	children,
} ) {
	const name = actor?.display_name;

	if ( ! name ) {
		return null;
	}

	const type = actor.type ?? 'user';
	const glyph = ACTOR_GLYPHS[ type ];

	return (
		<Stack
			render={ <span /> }
			align="center"
			gap="sm"
			className={ [ 'vip-workflow-dataview-author', className ]
				.filter( Boolean )
				.join( ' ' ) }
		>
			<Avatar
				src={ glyph ? undefined : actor.avatar }
				name={ name }
				icon={ glyph }
				size={ size }
				className={ `vip-workflow-dataview-avatar vip-workflow-dataview-avatar--${ type }` }
			/>
			{ /* The name is wrapped rather than left as a bare text node so a
			     call site has something to style: a Kanban card truncates it,
			     because a card is a fixed width and a long name would push the
			     rest of the meta row out of it. No truncation here — in a table
			     cell and in the audit log's meta row the surrounding layout
			     already handles the overflow, and clipping there would hide
			     names that currently read in full. */ }
			{ variant ? (
				<Text
					variant={ variant }
					render={
						<span className="vip-workflow-dataview-author__name" />
					}
				>
					{ name }
				</Text>
			) : (
				<span className="vip-workflow-dataview-author__name">
					{ name }
				</span>
			) }
			{ children }
		</Stack>
	);
}
