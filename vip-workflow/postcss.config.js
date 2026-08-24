/**
 * PostCSS configuration.
 *
 * Extends the @wordpress/scripts defaults with the WPDS token-fallbacks
 * plugin, which appends the canonical value as a var() fallback to every
 * --wpds-* design token at build time. This keeps the compiled CSS working
 * on WordPress versions that don't yet ship the design token definitions
 * (`wp-theme` stylesheet); once core defines the tokens, the runtime values
 * take precedence over the inlined fallbacks. Do not hand-write fallback
 * values in source CSS — the `no-token-fallback-values` stylelint rule
 * enforces this.
 */
module.exports = {
	plugins: [
		...require( '@wordpress/postcss-plugins-preset' ),
		require( '@wordpress/theme/postcss-plugins/postcss-ds-token-fallbacks' )
			.default,
		// A project-level postcss.config.js replaces the @wordpress/scripts
		// defaults entirely, including the production cssnano pass — restore
		// it here or production builds ship unminified CSS.
		...( process.env.NODE_ENV === 'production'
			? [
					require( 'cssnano' )( {
						preset: [
							'default',
							{ discardComments: { removeAll: true } },
						],
					} ),
			  ]
			: [] ),
	],
};
