/**
 * Where an idea has got to, named and toned once.
 *
 * An ideation project moves Ideation → In Editorial → Published → Monitoring.
 * Two screens show that: the My Ideation list, and the pipeline table under the
 * ideation landing's recent projects. They used to describe it twice, and
 * disagreed on both halves — the labels were duplicated literals, and the tones
 * were not merely different values but different *kinds* of colour.
 *
 * The list drew each status as a `StatusBadge` tinted from four hex literals
 * (`#757575`, `#dba617`, `#00a32a`, `#2271b1`) written into the page. That was
 * the wrong instrument twice over. `StatusBadge` exists to tint a stage colour
 * an *author* picked in the sequence editor; these four are a fixed vocabulary
 * the plugin owns, so there was no author colour to carry — and the literals
 * were the only stage-ish colours in the plugin that came from neither a
 * sequence nor the shared palette, which is how they drifted off the design
 * system without anyone deciding to.
 *
 * So the tone here is a semantic `Badge` intent, which is what the pipeline
 * table already used and what a fixed vocabulary should use: the design system
 * owns what "informational" looks like in both themes, and nothing has to be
 * re-picked when the palette moves. `draft` separates the starting state from
 * `monitoring`'s neutral, which the two `none`s would have collapsed.
 *
 * @package
 */

import { __ } from '@wordpress/i18n';

/**
 * Each pipeline status, in lifecycle order: what it is called, and its tone.
 *
 * **This list is the PHP one.** `pipeline_status` is served straight from
 * `Story::get_status()`, so the vocabulary belongs to `VIPWorkflows\Story\Story`
 * — which owns all six and registers a post status for each. A JS copy that
 * knew only four rendered a raw slug for the other two and left them out of the
 * filter, and it called `editorial` "In Editorial" where PHP calls it
 * "Editorial". Neither language can read the other's copy without a build step,
 * so the two are declared separately and `tests/phpunit/Unit/PipelineStatusTest.php`
 * reads this file and fails until they agree — the same guard `StagePalette`
 * uses. Change one side and the unit suite tells you about the other.
 *
 * Order matters — object insertion order drives the filter's option list below,
 * and a reader scanning it should see the pipeline, not an alphabetised set.
 *
 * The tones are this file's own: they are a presentation choice with no PHP
 * counterpart, so the parity guard checks slugs and labels and leaves them be.
 */
export const PIPELINE_STATUSES = {
	ideation: { label: __( 'Ideation', 'vip-workflows' ), intent: 'draft' },
	editorial: {
		label: __( 'Editorial', 'vip-workflows' ),
		intent: 'informational',
	},
	published: { label: __( 'Published', 'vip-workflows' ), intent: 'stable' },
	monitoring: { label: __( 'Monitoring', 'vip-workflows' ), intent: 'none' },
	// Live work: a published story flagged for updating reads as needing
	// attention, where an archived one is finished and reads quietest of all.
	refresh: { label: __( 'Refresh', 'vip-workflows' ), intent: 'medium' },
	archived: { label: __( 'Archived', 'vip-workflows' ), intent: 'low' },
};

/**
 * How a status reads, for a value that may be absent or unrecognised.
 *
 * A project with no `pipeline_status` is still being worked up, which is what
 * `ideation` means — the list already read it that way. A value nothing here
 * claims is shown as itself rather than swallowed: an unknown slug on screen is
 * a bug someone can report, where a blank cell is one nobody notices.
 *
 * The lookup asks `Object.hasOwn` rather than reading the key straight off the
 * map. A bare `PIPELINE_STATUSES[ slug ]` also finds everything on
 * `Object.prototype`, and those are non-nullish — so a status called
 * `constructor` or `toString` would return a function, sail past the `??`
 * below, and destructure to two undefineds instead of reaching the fallback
 * this docblock promises.
 *
 * @param {string} [status] Raw pipeline-status slug.
 * @return {{label: string, intent: string}} What to draw.
 */
export function pipelineStatus( status ) {
	const key = status || 'ideation';

	return Object.hasOwn( PIPELINE_STATUSES, key )
		? PIPELINE_STATUSES[ key ]
		: { label: status, intent: 'none' };
}

/**
 * The statuses as DataViews filter elements, in lifecycle order.
 *
 * @return {Array<{value: string, label: string}>} Filter options.
 */
export function pipelineStatusElements() {
	return Object.entries( PIPELINE_STATUSES ).map(
		( [ value, { label } ] ) => ( {
			value,
			label,
		} )
	);
}
