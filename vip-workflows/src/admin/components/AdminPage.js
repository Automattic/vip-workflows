/**
 * Admin Page
 *
 * A reusable page scaffold that matches the shape and style of WordPress
 * core's `@wordpress/admin-ui` `Page` + `Breadcrumbs` components by hand.
 *
 * Why hand-rolled rather than imported? `@wordpress/admin-ui` is present in
 * `node_modules` (transitively, via `@wordpress/edit-post`), but it is not a
 * surface WordPress exposes to plugins:
 *
 *   1. The `@wordpress/dependency-extraction-webpack-plugin` lists both
 *      `@wordpress/admin-ui` and `@wordpress/ui` in its `BUNDLED_PACKAGES`
 *      array, so neither is externalized to a `wp.*` global / `wp-admin-ui`
 *      script handle the way `@wordpress/components` is. There is no shared
 *      core copy for a plugin to consume — importing it bundles a private
 *      copy and drags in `@wordpress/route` (which *is* externalized, to a
 *      `wp-route` handle core doesn't register for plugin screens).
 *   2. `@wordpress/admin-ui` opts into private APIs via
 *      `__dangerousOptInToUnstableAPIsOnlyForCoreModules`, whose own
 *      acknowledgement string states these features "are not for use in
 *      themes or plugins and doing so will break in the next version of
 *      WordPress." It sits on the pre-1.0 `@wordpress/ui` package.
 *
 * So we mirror core's rendered structure and styling, but stay decoupled from
 * the unstable package. The header is a single sticky row over a neutral
 * surface — an optional visual, the parent breadcrumb trail, the page title
 * (rendered as the trail's current item, core-style), and right-aligned
 * actions — with an optional subtitle line beneath it.
 *
 * Prop names intentionally diverge from core (`subtitle` not `subTitle`,
 * `icon` not `visual`). Aligning them would mean editing every consumer (or
 * adding alias props, which the project's no-legacy rule forbids), so the
 * public API is left as-is.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';
import { Text } from '@wordpress/ui';

import '../admin-page.css';

/**
 * Render the breadcrumb trail and the page heading as a single inline list,
 * mirroring core's `Breadcrumbs` (whose last item is the page `h1`). Parent
 * entries render as links; the trailing heading entry renders as the `h1`.
 *
 * @param {Object} props       Props.
 * @param {Array}  props.items `[{ type: 'link', label, href } | { type: 'heading', label }]`, in order.
 * @return {JSX.Element} Breadcrumb nav.
 */
function Breadcrumbs( { items } ) {
	return (
		<nav
			className="vip-workflows-admin-page__breadcrumbs"
			aria-label={ __( 'Breadcrumbs', 'vip-workflows' ) }
		>
			<ul className="vip-workflows-admin-page__breadcrumb-list">
				{ items.map( ( item, index ) => (
					<li
						key={ index }
						className="vip-workflows-admin-page__breadcrumb-item"
					>
						{ index > 0 && (
							<span
								className="vip-workflows-admin-page__breadcrumb-separator"
								aria-hidden="true"
							>
								/
							</span>
						) }
						{ item.type === 'link' ? (
							<a
								className="vip-workflows-admin-page__breadcrumb-link"
								href={ item.href }
							>
								{ item.label }
							</a>
						) : (
							<Text
								variant="heading-lg"
								render={ <h1 /> }
								className="vip-workflows-admin-page__title"
							>
								{ item.label }
							</Text>
						) }
					</li>
				) ) }
			</ul>
		</nav>
	);
}

/**
 * Admin page scaffold.
 *
 * @param {Object}  props               Props.
 * @param {Array}   props.breadcrumbs   `[{ label, href }]` — entries with an `href` are parent links; the entry without one is the current page and supplies the heading. E.g. `[Workflows, Sequences, "My Sequence"]` renders `Workflows / Sequences / My Sequence` with the name as the heading.
 * @param {Node}    [props.icon]        Optional visual slot before the trail/title. None by default; pass an icon to show one.
 * @param {Node}    [props.title]       Page title. When omitted, the current breadcrumb's label is used. Rendered inline as the trail's current item (the `h1`).
 * @param {Node}    [props.subtitle]    Optional supporting line under the header row. Usually a string; a node when the line carries an inline link (e.g. Notifications' how-to).
 * @param {Node}    [props.actions]     Optional right-aligned header actions (buttons, menu).
 * @param {boolean} [props.constrained] Cap the header and content at a readable column (42.5rem) centered in the container. For form/card screens; leave off for wide data screens.
 * @param {boolean} [props.fullBleed]   App-canvas mode for screens that own the whole surface and scroll internally — e.g. Kanban, Calendar. Pins the page to the viewport; the header (if any header props are passed) stays fixed and the content fills the remaining height and scrolls within itself, padding-free.
 * @param {Node}    props.children      Page content.
 * @return {JSX.Element} Admin page.
 */
export default function AdminPage( {
	breadcrumbs = [],
	icon,
	title,
	subtitle,
	actions,
	constrained = false,
	fullBleed = false,
	children,
} ) {
	// No icon unless a caller passes one; the breadcrumb root is text-only.
	const visual = icon;

	// Parent crumbs carry an `href`; the current page is the entry without one.
	// The heading text is the explicit title, or the current crumb's label.
	const linkCrumbs = breadcrumbs.filter( ( crumb ) => crumb.href );
	const currentCrumb = breadcrumbs.find( ( crumb ) => ! crumb.href );
	const headingText = title || currentCrumb?.label;

	// The heading and the parent trail render together as one inline list only
	// when there are parents (core's Breadcrumbs path). With no parents, the
	// heading stands alone (core's plain-title path) — no breadcrumb nav.
	const trailItems = [
		...linkCrumbs.map( ( crumb ) => ( { type: 'link', ...crumb } ) ),
		...( headingText ? [ { type: 'heading', label: headingText } ] : [] ),
	];
	const showBreadcrumbs = linkCrumbs.length > 0;

	const hasHeader = headingText || showBreadcrumbs || Boolean( actions );

	// The page is a navigable region (matches core's NavigableRegion wrapper),
	// labelled by the heading so the "Navigate regions" shortcut can name it.
	const regionLabel = typeof headingText === 'string' ? headingText : '';

	const headerInnerClass = constrained
		? 'vip-workflows-admin-page__header-inner is-constrained'
		: 'vip-workflows-admin-page__header-inner';
	const contentInnerClass = constrained
		? 'vip-workflows-admin-page__content-inner is-constrained'
		: 'vip-workflows-admin-page__content-inner';

	// Full-bleed pins the page to the viewport; the content fills the remaining
	// height below the header and scrolls internally rather than the page.
	const pageClass = fullBleed
		? 'vip-workflows-admin-page vip-workflows-admin-page--full-bleed'
		: 'vip-workflows-admin-page';

	return (
		<div
			className={ pageClass }
			role="region"
			aria-label={ regionLabel }
			tabIndex="-1"
		>
			{ hasHeader && (
				<header className="vip-workflows-admin-page__header">
					<div className={ headerInnerClass }>
						<div className="vip-workflows-admin-page__header-row">
							<div className="vip-workflows-admin-page__header-main">
								{ visual && (
									<span
										className="vip-workflows-admin-page__icon"
										aria-hidden="true"
									>
										{ visual }
									</span>
								) }
								{ showBreadcrumbs ? (
									<Breadcrumbs items={ trailItems } />
								) : (
									headingText && (
										<Text
											variant="heading-lg"
											render={ <h1 /> }
											className="vip-workflows-admin-page__title"
										>
											{ headingText }
										</Text>
									)
								) }
							</div>
							{ actions && (
								<div className="vip-workflows-admin-page__actions">
									{ actions }
								</div>
							) }
						</div>
						{ subtitle && (
							<Text
								variant="body-sm"
								render={ <p /> }
								className="vip-workflows-admin-page__subtitle"
							>
								{ subtitle }
							</Text>
						) }
					</div>
				</header>
			) }
			<div className="vip-workflows-admin-page__content">
				<div className={ contentInnerClass }>{ children }</div>
			</div>
		</div>
	);
}
