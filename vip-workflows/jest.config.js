/**
 * Jest config for the JS unit suite.
 *
 * `wp-scripts test-unit-js` runs Vitest from @wordpress/scripts 36 on, and
 * `wp-scripts test-unit-jest` hands over to this project's own Jest with no
 * WordPress defaults. This reproduces the config @wordpress/scripts used to
 * supply: the WordPress Jest preset (jsdom, the jest-console checks that fail
 * a test on an unexpected `console.error`, and its test file matching), with
 * Babel transforming JSX and ESM through the WordPress Babel preset.
 */
module.exports = {
	preset: '@wordpress/jest-preset-default',
	transform: {
		'\\.[jt]sx?$': [
			'babel-jest',
			{ presets: [ '@wordpress/babel-preset-default' ] },
		],
	},
};
