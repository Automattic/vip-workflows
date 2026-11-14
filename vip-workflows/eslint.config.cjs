/**
 * Local ESLint config.
 *
 * Extends the @wordpress/scripts default flat config (which `wp-scripts
 * lint-js` would otherwise apply on its own) and layers project-specific
 * overrides on top.
 *
 * - globals.browser: this is browser-targeted React code, so `localStorage`,
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
 *
 * Test files: the default config applies Vitest rules to every `*.test.*` and
 * `*.spec.*` file. The unit suite runs on Jest (`wp-scripts test-unit-jest`)
 * and the e2e suite on Playwright, so each gets its own rules instead.
 */
const { createRequire } = require( 'module' );

const scriptsConfig = require( '@wordpress/scripts/config/eslint.config.cjs' );

// Resolve the lint plugins the way the default config does, through
// @wordpress/scripts, rather than relying on npm hoisting them to the top.
const fromScripts = createRequire(
	require.resolve( '@wordpress/scripts/package.json' )
);
const wpPlugin = fromScripts( '@wordpress/eslint-plugin' );
const fromWpPlugin = createRequire(
	fromScripts.resolve( '@wordpress/eslint-plugin' )
);
const globals = fromWpPlugin( 'globals' );
const jestPlugin = fromWpPlugin( 'eslint-plugin-jest' );

const UNIT_TESTS = [ 'tests/unit-js/**/*.js', 'src/**/*.test.js' ];
const E2E_TESTS = [ 'tests/e2e/**/*.js' ];

// Every `vitest/*` rule the default config turns on, switched off.
const vitestRulesOff = Object.fromEntries(
	scriptsConfig
		.flatMap( ( config ) => Object.keys( config.rules || {} ) )
		.filter( ( rule ) => rule.startsWith( 'vitest/' ) )
		.map( ( rule ) => [ rule, 'off' ] )
);

module.exports = [
	...scriptsConfig,
	{
		languageOptions: {
			globals: globals.browser,
		},
		rules: {
			'jsdoc/no-undefined-types': [
				'error',
				{ definedTypes: [ 'JSX', 'Node', 'ClipboardEvent' ] },
			],
			'no-console': [ 'error', { allow: [ 'warn', 'error' ] } ],
			'@wordpress/no-unsafe-wp-apis': 'off',
		},
	},
	{
		files: UNIT_TESTS,
		...jestPlugin.configs[ 'flat/recommended' ],
		rules: {
			...vitestRulesOff,
			...jestPlugin.configs[ 'flat/recommended' ].rules,
		},
	},
	...wpPlugin.configs[ 'test-playwright' ].map( ( config ) => ( {
		...config,
		files: E2E_TESTS,
	} ) ),
	{
		files: E2E_TESTS,
		rules: vitestRulesOff,
	},
];
