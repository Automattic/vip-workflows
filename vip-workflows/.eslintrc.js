/**
 * Local ESLint config.
 *
 * Extends the @wordpress/scripts default (which `wp-scripts lint-js` would
 * otherwise apply on its own) and layers project-specific overrides on top.
 *
 * - env.browser: this is browser-targeted React code, so `localStorage`,
 *   `navigator`, `FileReader`, `alert`, etc. are valid globals (clears
 *   no-undef for them; `alert`/`confirm` are still governed by no-alert).
 * - jsdoc/no-undefined-types: register a few valid types the jsdoc plugin
 *   doesn't recognize out of the box — `JSX` (React's JSX namespace, used in
 *   `@return {JSX.Element}`) and the DOM globals `Node`/`ClipboardEvent`.
 * - no-console: allow `warn`/`error` (intentional diagnostics in catch
 *   blocks); `console.log` debug calls are still disallowed.
 * - @wordpress/no-unsafe-wp-apis: off. Several controls we rely on are still
 *   `__experimental*`-prefixed in @wordpress/components@32 (e.g.
 *   `__experimentalToggleGroupControl` for segmented controls). We accept the
 *   API-stability risk rather than hand-roll equivalents; revisit when these
 *   stabilize.
 */
module.exports = {
	root: true,
	extends: [ require.resolve( '@wordpress/scripts/config/.eslintrc.js' ) ],
	env: { browser: true },
	rules: {
		'jsdoc/no-undefined-types': [
			'error',
			{ definedTypes: [ 'JSX', 'Node', 'ClipboardEvent' ] },
		],
		'no-console': [ 'error', { allow: [ 'warn', 'error' ] } ],
		'@wordpress/no-unsafe-wp-apis': 'off',
		// We render semantic headings via the WPDS pattern
		// `<Text variant="heading-*" render={ <h3 /> }>…</Text>`. The static
		// a11y rule only sees the empty `<h3 />` in the render prop and can't
		// tell that `Text` injects its children into it, so it false-positives
		// on every Text-as-heading. The headings are accessible at runtime.
		'jsx-a11y/heading-has-content': 'off',
	},
};
