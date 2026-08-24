/**
 * Playwright configuration for VIP Workflow end-to-end tests.
 *
 * Extends the WordPress-standard config bundled with `@wordpress/scripts`
 * (which wires up the admin storage state, the wp-env web server on port 8889,
 * and sensible defaults) and only overrides what is plugin-specific.
 *
 * See vip-workflow/docs/TESTING.md for how to run these tests.
 */

const path = require( 'path' );
const baseConfig = require( '@wordpress/scripts/config/playwright.config' );

const isCI = !! process.env.CI;

module.exports = {
	...baseConfig,
	// VIP standard layout puts e2e specs under tests/e2e/ (not the wp-scripts default ./specs).
	testDir: path.join( __dirname, 'tests', 'e2e' ),
	// CI starts wp-env before Playwright, so Playwright must not manage the server.
	// Locally, boot or reuse wp-env from the monorepo root (wp-env lives there,
	// not in this plugin directory).
	webServer: isCI
		? undefined
		: {
				...baseConfig.webServer,
				// e2e runs against the standalone tests config on :8889 (the baseURL
				// @wordpress/scripts uses), so boot `wp-env:start:tests`, not the dev
				// env (`wp-env:start`, :8888).
				command: 'npm run wp-env:start:tests --prefix ..',
		  },
};
