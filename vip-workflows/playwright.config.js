/**
 * Playwright configuration for VIP Workflows end-to-end tests.
 *
 * Extends the WordPress-standard config bundled with `@wordpress/scripts`
 * (which wires up the admin storage state, the wp-env web server on port 8889,
 * and sensible defaults) and only overrides what is plugin-specific.
 *
 * See vip-workflows/docs/TESTING.md for how to run these tests.
 */

const path = require( 'path' );
const baseConfig = require( '@wordpress/scripts/config/playwright.config' );

const isCI = !! process.env.CI;

module.exports = {
	...baseConfig,
	// VIP standard layout puts e2e specs under tests/e2e/ (not the wp-scripts default ./specs).
	testDir: path.join( __dirname, 'tests', 'e2e' ),
	// Wraps the wp-scripts global setup with a preflight that fails the run
	// with the reseed command when the tests env is missing the plugin's
	// seeded state, instead of letting every spec fail on its own.
	globalSetup: require.resolve( './tests/e2e/global-setup.js' ),
	// CI starts and seeds wp-env before Playwright (`npm run wp-env:start:tests`),
	// so Playwright must not manage the server there.
	//
	// Locally, every run starts the tests env (:8889, the baseURL
	// @wordpress/scripts uses) from the monorepo root and seeds it. Readiness is
	// the ready line the script prints after the seed succeeds, not the port:
	// :8889 answers as soon as WordPress boots, before the seed has finished,
	// and a port check would let the global setup race the seed. With no `port`
	// or `url`, `reuseExistingServer` never skips the command, so an env that is
	// already running is still seeded (starting it again is a no-op).
	webServer: isCI
		? undefined
		: {
				command: 'bash ../tools/wp-env-e2e-webserver.sh',
				wait: { stdout: /VIP Workflows e2e environment ready/ },
				stdout: 'pipe',
				// A first boot pulls images and installs WordPress.
				timeout: 300_000,
		  },
};
