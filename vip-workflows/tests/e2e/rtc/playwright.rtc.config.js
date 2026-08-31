/**
 * Standalone Playwright config for the VIP RTC integration spec.
 *
 * This is intentionally separate from the main e2e config: the RTC spec runs
 * against the dev wp-env (:8888) provisioned by setup-rtc.sh, drives two raw
 * browser contexts (no shared admin storage state), and needs the RTC
 * WebSocket server running. It is never part of the default suite.
 *
 * Run:
 *   bash tests/e2e/rtc/setup-rtc.sh
 *   RTC_E2E=1 npx playwright test --config tests/e2e/rtc/playwright.rtc.config.js
 *
 * The webServer block boots the RTC WebSocket server from the sibling clone
 * (override its location with RTC_WS_DIR). Set RTC_WS_EXTERNAL=1 if you are
 * running the server yourself and don't want Playwright to manage it.
 */
const path = require( 'path' );

const WS_DIR =
	process.env.RTC_WS_DIR ||
	path.resolve(
		__dirname,
		'../../../../vip-real-time-collaboration/websocket-server'
	);

const config = {
	testDir: __dirname,
	testMatch: '**/*.spec.js',
	timeout: 120000,
	fullyParallel: false,
	workers: 1,
	reporter: 'line',
	// Reuse the gitignored artifacts dir the main config uses, so traces don't
	// land in a stray test-results/ folder.
	outputDir: path.resolve( __dirname, '../../../artifacts/rtc' ),
	use: {
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8888',
		trace: 'retain-on-failure',
	},
};

if ( process.env.RTC_E2E === '1' && ! process.env.RTC_WS_EXTERNAL ) {
	// A WebSocket server has no HTTP 200 endpoint, so wait on the raw TCP port
	// rather than an HTTP status.
	config.webServer = {
		command: `VIP_RTC_WS_AUTH_SECRET=${
			process.env.VIP_RTC_WS_AUTH_SECRET || 'vip_rtc_ws_auth_secret'
		} HOST=0.0.0.0 PORT=1234 npx tsx index.ts`,
		cwd: WS_DIR,
		port: 1234,
		reuseExistingServer: true,
		timeout: 60000,
	};
}

module.exports = config;
