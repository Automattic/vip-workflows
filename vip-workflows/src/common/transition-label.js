/**
 * What a transition is called, everywhere one is named.
 *
 * Mirrors `StatusManager::transition_label()`, trim included. Shared between
 * the sequence editor (which shows the author the name a writer will press)
 * and the editor sidebar's transition rail (which needs the same derivation
 * for an agent stage's routed outcomes, whose transitions arrive as raw
 * sequence config rather than through the transitions payload).
 *
 * @package
 */

import { __, sprintf } from '@wordpress/i18n';

/**
 * What a transition with no authored label is called.
 *
 * A blank label is not nameless at runtime — it derives "Move to
 * {destination}" every time it is read, never stored, so a renamed stage
 * renames its buttons. Phrased as an action because these are buttons:
 * "Review" reads as a state, "Move to Review" reads as something you can
 * click.
 *
 * It takes the destination's label rather than a stages array because callers
 * resolve it differently — the graph's stage read-out through the panel's
 * `resolveStageLabel`, the transition panel from the `targetLabel` it is
 * already handed, the rail from `all_statuses`.
 *
 * @param {string} destinationLabel The destination stage's display label.
 * @return {string} The derived button label.
 */
export function derivedTransitionLabel( destinationLabel ) {
	return sprintf(
		/* translators: %s: destination stage label. */
		__( 'Move to %s', 'vip-workflows' ),
		destinationLabel
	);
}

/**
 * What a writer will see on this transition's button.
 *
 * The whole of `StatusManager::transition_label()`, trim included: an authored
 * label wins outright, and anything else derives. Whitespace counts as
 * unauthored on both sides, so a label of " " reads the same in the editor as
 * it fires in the sidebar.
 *
 * @param {Object} transition       Transition config.
 * @param {string} destinationLabel The destination stage's display label.
 * @return {string} The label the transition presents.
 */
export function transitionLabel( transition, destinationLabel ) {
	const authored = ( transition?.label || '' ).trim();

	return authored || derivedTransitionLabel( destinationLabel );
}
