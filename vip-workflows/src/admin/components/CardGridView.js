/**
 * CardGridView
 *
 * A dataset drawn as a grid of `<SummaryCard>`s, with `@wordpress/dataviews`
 * supplying the chrome around it: the search box, the filter bar and pagination.
 *
 * This is DataViews *free composition*. Passing children to `<DataViews>`
 * replaces its built-in layout wholesale, so the grid below is our own markup
 * and every piece of chrome is named explicitly — including the two filter
 * parts, which the default UI draws for free and free composition does not draw
 * at all. `view.type` is `'table'` only because free composition still needs a
 * view whose type is one of `defaultLayouts`; no table is ever rendered.
 *
 * The search row reproduces the *shape* of DataViews' own default UI — search on
 * the left, the filter toggle beside it, the filter bar underneath — so a card
 * panel and a table panel (the Audit Log, My Work) put the same controls in the
 * same places. It is not the same chrome, and the difference is worth naming so
 * nobody papers over it by hand. The default UI wraps that row in
 * `.dataviews__view-actions`, the filter bar in `.dataviews-filters__container`
 * and pagination in `.dataviews-footer`; free composition renders our children
 * bare, and those three wrappers carry behaviour we therefore do without:
 *
 * - `position: sticky` — `left: 0` on the header and filter rows, `bottom: 0`
 *   plus a top border on the footer. That pins the chrome while a wide table
 *   scrolls under it. A card grid wraps instead of scrolling sideways and this
 *   panel grows to its content rather than being a fixed-height scroll box, so
 *   there is nothing here for either to stick to.
 * - Container-query padding — the insets tighten below 430px and the footer's
 *   contents stack below 560px. Our insets are one fixed pair at every width.
 * - The 16px/24px inset itself, which those wrappers apply per child. The panel
 *   applies it once, to itself, in CardGridView.css. Re-adding the vendored
 *   classes on top would double-pad rather than restore anything.
 *
 * Both filter parts render nothing when no field declares a filter, so a screen
 * that only searches passes plain fields and gets exactly the chrome it had
 * before.
 *
 * `fields` exist to power search, filtering and sorting only: the card renders
 * straight from the item, so a field no chrome reads is dead weight rather than
 * a hidden column. Free composition gives up two things along with the built-in
 * layout, and both are deliberate: the layout switcher — a grid of cards has one
 * shape and nothing to switch to — and the view config's Properties list, whose
 * columns here are the card's own anatomy rather than a set the reader picks
 * from. Sorting is *not* on that list: it lives in the same view config, and
 * dropping the whole control to be rid of the Properties list would take
 * reordering with it. The control is rendered below for exactly that reason.
 *
 * Both callers hold their whole dataset in memory, so search / filtering /
 * pagination run client-side via `filterSortAndPaginate`.
 *
 * @package
 */

import { useState, useMemo } from '@wordpress/element';
import { Stack } from '@wordpress/ui';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews/wp';

import './CardGridView.css';

/**
 * @param {Object}   props             Props.
 * @param {Array}    props.items       The whole dataset; DataViews pages it.
 * @param {Array}    props.fields      DataViews fields powering search / filter / sort.
 * @param {Function} props.renderCard  Renders one item as a card. Keyed by the wrapper that carries its list-item role, so it need not key itself.
 * @param {string}   props.searchLabel Accessible label for the search box.
 * @param {number}   props.perPage     Cards per page.
 * @param {Object}   props.sort        Initial sort, `{ field, direction }` or `{}` to keep the dataset's own order.
 * @param {Function} props.getItemId   Stable id for an item.
 * @param {Node}     [props.empty]     Rendered in place of the grid when nothing matches.
 * @return {JSX.Element} Panel.
 */
export function CardGridView( {
	items,
	fields,
	renderCard,
	searchLabel,
	perPage,
	sort,
	getItemId,
	empty,
} ) {
	// `perPage` and `sort` seed the view and are not read again: from here on the
	// view is the reader's, to search, filter and page as they like.
	const [ view, setView ] = useState( {
		type: 'table',
		search: '',
		filters: [],
		page: 1,
		perPage,
		sort,
		fields: [],
		layout: {},
	} );

	const { data, paginationInfo } = useMemo(
		() => filterSortAndPaginate( items, view, fields ),
		[ items, view, fields ]
	);

	return (
		// Deliberately a <div>: <Stack> is display:flex, which would change the
		// box DataViews lays itself out in.
		// wpds-allow R7 -- a <Stack> here is display:flex and would change DataViews' layout box
		<div className="vip-workflow-card-grid-view vip-workflow-card-surface">
			<DataViews
				data={ data }
				fields={ fields }
				view={ view }
				onChangeView={ setView }
				paginationInfo={ paginationInfo }
				defaultLayouts={ { table: {} } }
				getItemId={ getItemId }
			>
				{ /* The panel's vertical rhythm. This <Stack> exists only to own
				     it: free composition drops our children straight into
				     `.dataviews-wrapper`, a flex column DataViews owns and gives
				     no gap of its own, and hanging the spacing off that class
				     would make our layout depend on a vendored internal with no
				     styling contract — an upgrade could rename it and collapse
				     the panel with no build error and no failing test. One
				     child of ours, with a real `gap` prop, keeps the rhythm on
				     something the project owns. A part that renders null still
				     contributes no gap, so the filter bar costs nothing when
				     no field declares a filter. */ }
				<Stack direction="column" gap="lg">
					<Stack gap="sm" align="center" justify="space-between">
						<Stack gap="sm" align="center">
							{ /* The label goes on the search box, not on
							     <DataViews>: the `searchLabel` prop is read by the
							     default UI, which free composition replaces, so a
							     label passed there is silently dropped and the box
							     narrates itself as the generic "Search". */ }
							<DataViews.Search label={ searchLabel } />
							<DataViews.FiltersToggle />
						</Stack>
						{ /* Sort-by, sort-direction and items-per-page live in here.
						     They are not a built-in-layout luxury — the default UI
						     renders this alongside the search box, so leaving it out
						     is how a composed panel silently loses the ability to
						     reorder at all.

						     It is one dropdown, not a set of parts, so a composed
						     panel takes all of it or none. Two of its sections would
						     have nothing to act on here, and only one of them can be
						     talked out of rendering: Properties disappears once no
						     field is hideable, which is true and is declared on the
						     fields themselves. Density cannot — every layout type
						     supplies a `viewConfigOptions` section and this view is
						     nominally a table, so the row-height control shows and
						     does nothing. Known, and the price of the other three;
						     if it grates, the honest fix is to make the card grid
						     answer to `view.layout.density` rather than to hide the
						     control. */ }
						<DataViews.ViewConfig />
					</Stack>
					<DataViews.FiltersToggled />
					{ data.length === 0 ? (
						empty
					) : (
						/* An explicit `role="list"`, not a bare <ul>: a list whose
						   display is `grid` loses its list semantics in some screen
						   readers, and restating the role is the documented way to
						   keep them. It is what tells a reader how many cards there
						   are and which one of them they are on — the built-in grid
						   layout announced itself, and a hand-composed one has to
						   say so for itself.

						   Deliberately `list` rather than the built-in layout's
						   `grid`: a grid claims its rows and columns mean something,
						   and here they are only where the cards happened to wrap.
						   These records have an order, not coordinates. */
						/* wpds-allow R7 -- responsive CSS grid (auto-fill/minmax); Stack is flex-only and can't express a wrapping card grid */
						<div className="vip-workflow-card-grid" role="list">
							{ data.map( ( item ) => (
								/* wpds-allow R7 -- carries the list-item role for the card inside it; <Stack> would add a flex box this only needs to be a plain wrapper */
								<div
									key={ getItemId( item ) }
									className="vip-workflow-card-grid__item"
									role="listitem"
								>
									{ renderCard( item ) }
								</div>
							) ) }
						</div>
					) }
					<DataViews.Pagination />
				</Stack>
			</DataViews>
		</div>
	);
}
