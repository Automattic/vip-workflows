/**
 * A brief dissolve on the field a tool just wrote to.
 *
 * Applying a suggestion swaps the value instantly, which reads as though nothing
 * happened — especially for the title, where the writer's attention is on the
 * modal they just clicked in rather than on the field that changed. A short fade
 * makes the new value resolve in, so the change is noticed without being
 * announced.
 *
 * The fields belong to core: the title is Gutenberg's `PostTitle`, the excerpt
 * its own panel. We render neither, so there is no component to animate and the
 * only handle is the DOM node. That makes this deliberately best-effort — if a
 * selector stops matching, the value still applies and the animation simply does
 * not happen. Never let decoration break the thing it decorates.
 *
 * @package
 */

/**
 * Selectors for the fields a tool can apply to, keyed by `apply_field`.
 *
 * Core class names, so they are not ours to rely on. Kept in one place so a
 * Gutenberg change is a single edit rather than a hunt, and so an unknown field
 * is obviously unhandled rather than silently mis-targeted.
 */
const FIELD_SELECTORS = {
	title: '.editor-post-title__input, .wp-block-post-title',
	excerpt: '.editor-post-excerpt textarea',
};

/**
 * Class carrying the animation. Defined in editor/style.css, where the
 * `prefers-reduced-motion` opt-out lives with it.
 */
const SETTLE_CLASS = 'vip-workflows-field--settling';

/**
 * Roughly the animation's duration. Slightly longer, so the class is removed
 * after the animation finishes rather than cutting it short.
 */
const SETTLE_MS = 500;

/**
 * Play the dissolve on a field, if it can be found.
 *
 * @param {string} field The ability's `apply_field` — 'title', 'excerpt', …
 * @return {void}
 */
export function settleAppliedField( field ) {
	const selector = FIELD_SELECTORS[ field ];

	if ( ! selector || typeof document === 'undefined' ) {
		return;
	}

	const node = document.querySelector( selector );

	if ( ! node ) {
		// The field is not on screen — a collapsed panel, a different editor, or
		// a core change. Nothing to animate, and nothing to report.
		return;
	}

	/*
	 * Removed and re-added so a second apply restarts the animation. Without the
	 * reflow between, the browser coalesces both into one no-op and the writer
	 * gets no feedback on the second click.
	 */
	node.classList.remove( SETTLE_CLASS );
	void node.offsetWidth;
	node.classList.add( SETTLE_CLASS );

	setTimeout( () => node.classList.remove( SETTLE_CLASS ), SETTLE_MS );
}
