/**
 * PostCSS configuration.
 *
 * Mirrors vip-workflows/postcss.config.js: extends the @wordpress/scripts
 * defaults with the WPDS token-fallbacks plugin so every --wpds-* token in
 * the compiled CSS carries its canonical value as a var() fallback. Required
 * until WordPress core ships the design token definitions (`wp-theme`
 * stylesheet). Do not hand-write fallback values in source CSS.
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
