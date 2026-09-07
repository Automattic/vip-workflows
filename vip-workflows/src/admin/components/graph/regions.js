/**
 * Post status regions.
 *
 * Every stage lives in exactly one *status region* — the core `post_status` a
 * post holds while it sits in that stage. The set is fixed and mirrors
 * `Sequence::EDITORIAL_STATUSES` on the server; a region is not something an
 * author invents, it's one of the four core statuses the workflow is allowed to
 * write. Moving between stages inside one region never touches `post_status`;
 * an edge that crosses a boundary is what commits the new status.
 *
 * On the canvas a region is a *section* of the surface the stage nodes sit in,
 * opened by a line that runs the full width of the viewport, so the boundary an
 * edge crosses is visible rather than implied by a dropdown. This module holds
 * the vocabulary — the ordered slugs, their labels, and which regions a given
 * sequence should show — so the canvas, the layout, and the inspectors all name
 * them the same way.
 *
 * Kept free of React and of `graph-model` so both can import it.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';

/**
 * The region a stage falls into when it doesn't say. Mirrors the server's
 * write-time normalization: a stage stored without a `status` is persisted as
 * `draft`.
 */
export const DEFAULT_REGION = 'draft';

/**
 * Every region, in the order content moves through them. The canvas stacks its
 * sections in this order, so the sequence reads down the page the way a post
 * actually progresses: drafted, submitted, then published (or held private).
 */
export const REGION_ORDER = [ 'draft', 'pending', 'private', 'publish' ];

/**
 * Human label for a region.
 *
 * @param {string} region Region slug.
 * @return {string} Display label — the slug itself if it isn't a known region.
 */
export function regionLabel( region ) {
	switch ( region ) {
		case 'draft':
			return __( 'Draft', 'vip-workflows' );
		case 'pending':
			return __( 'Pending Review', 'vip-workflows' );
		case 'private':
			return __( 'Private', 'vip-workflows' );
		case 'publish':
			return __( 'Published', 'vip-workflows' );
		default:
			return region;
	}
}

/**
 * Short explanation of what a region does to a post, for inspector help text.
 *
 * @param {string} region Region slug.
 * @return {string} Description.
 */
export function regionDescription( region ) {
	switch ( region ) {
		case 'draft':
			return __(
				'Work in progress. New content is created here.',
				'vip-workflows'
			);
		case 'pending':
			return __(
				'Submitted for review, not yet published.',
				'vip-workflows'
			);
		case 'private':
			return __(
				'Visible only to logged-in users who can read private posts.',
				'vip-workflows'
			);
		case 'publish':
			return __( 'Live on the site.', 'vip-workflows' );
		default:
			return '';
	}
}

/**
 * `SelectControl` options for a set of regions.
 *
 * @param {string[]} [slugs] Regions to offer; defaults to all of them.
 * @return {Array} `{ label, value }` options.
 */
export function regionOptions( slugs = REGION_ORDER ) {
	return slugs.map( ( value ) => ( { label: regionLabel( value ), value } ) );
}

/**
 * The status region a stage lives in. Mirrors the server's write-time
 * normalization (a missing `status` is persisted as `'draft'`), so the model
 * reasons about unsaved/legacy stages the same way the write gate will store
 * them.
 *
 * @param {Object} stage A stage object.
 * @return {string} The stage's status region.
 */
export function stageRegion( stage ) {
	return stage.status || DEFAULT_REGION;
}

/**
 * The stage a region's entry checkpoint points at, if one is marked.
 *
 * A region's entry stage is where a post lands when something OUTSIDE the
 * workflow puts it in that region — a core-driven status change, or a sequence
 * assigned to a post that already has a status. Mirrors
 * `Sequence::get_region_entry_stage()`, which is the server's authority for the
 * same question.
 *
 * Null covers both of the server's null cases: the sequence models no stage in
 * this region at all, and it models stages but none of them is marked. The
 * server throws on the second (a data-integrity error the write gate prevents)
 * and its caller treats the throw as "nothing re-seats" — the same answer a null
 * gives here.
 *
 * Lives here rather than in `graph-model` because it is region vocabulary, and
 * because the workflow side-effect guard resolves the checkpoint too: that
 * module is its own framework-free webpack entry, enqueued on every `edit.php`
 * screen, and must not pull the sequence-editor model in behind it.
 *
 * @param {Array}  stages Stage objects.
 * @param {string} region Region slug.
 * @return {Object|null} The entry stage, or null when the region has none.
 */
export function regionEntryStage( stages, region ) {
	return (
		( stages || [] ).find(
			( stage ) =>
				Boolean( stage.region_entry ) && stageRegion( stage ) === region
		) || null
	);
}

/**
 * Which regions the canvas should draw a section for.
 *
 * A region shows when something puts it there: a stage lives in it, or the
 * author added it explicitly from the canvas menu (an empty section waiting for
 * a stage to be dragged in). Draft is always shown — it's where new content
 * starts, so a sequence without it has nowhere to begin.
 *
 * A region carried by a stage but missing from `REGION_ORDER` is still
 * returned, at the end. It shouldn't happen (the server validates the enum on
 * write), but dropping it here would leave that stage with no section to sit in
 * and no way to see or fix it.
 *
 * @param {Array}    stages  Stage objects.
 * @param {string[]} [extra] Regions added from the canvas that hold no stage yet.
 * @return {string[]} Region slugs, in `REGION_ORDER`.
 */
export function visibleRegions( stages, extra = [] ) {
	const present = new Set( [ DEFAULT_REGION, ...extra ] );
	( stages || [] ).forEach( ( stage ) =>
		present.add( stageRegion( stage ) )
	);

	const known = REGION_ORDER.filter( ( region ) => present.has( region ) );
	const unknown = [ ...present ].filter(
		( region ) => ! REGION_ORDER.includes( region )
	);
	return [ ...known, ...unknown ];
}
