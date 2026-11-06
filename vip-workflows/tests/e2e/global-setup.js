/**
 * Playwright global setup for VIP Workflows end-to-end tests.
 *
 * Runs the `@wordpress/scripts` global setup (log in as admin, write the
 * storage state), then checks that the environment under test holds the plugin
 * state every spec assumes. Without this check, an unseeded tests environment
 * fails every spec, including the REST-contract specs that never touch the UI,
 * and each failure reads as a broken spec instead of an empty environment.
 *
 * The check fails the run with the reseed command. It never seeds or repairs
 * anything itself: `npm run seed:tests` (repository root) does that, and runs
 * automatically after `npm run wp-env:start:tests`.
 *
 * See vip-workflows/docs/TESTING.md, "When every spec fails".
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { RequestUtils } = require( '@wordpress/e2e-test-utils-playwright' );
const wpScriptsGlobalSetup = require( '@wordpress/scripts/config/playwright/global-setup' );

const PLUGIN_DIR = path.resolve( __dirname, '..', '..' );
const EDITOR_ASSET = path.join( PLUGIN_DIR, 'build', 'editor.asset.php' );
const RESEED_HINT =
	'Reseed the tests environment from the repository root with `npm run seed:tests` ' +
	'(it also runs after `npm run wp-env:start:tests`). See vip-workflows/docs/TESTING.md, ' +
	'"When every spec fails".';

/**
 * Fail the run with an explanation of what is missing and how to fix it.
 *
 * @param {string} baseURL Site under test.
 * @param {string} problem What is missing.
 * @param {string} hint    How to fix it.
 */
function fail( baseURL, problem, hint ) {
	throw new Error(
		`VIP Workflows e2e preflight failed for ${ baseURL }: ${ problem }\n${ hint }`
	);
}

/**
 * @param {import('@playwright/test').FullConfig} config
 * @return {Promise<void>}
 */
async function globalSetup( config ) {
	const { storageState, baseURL } = config.projects[ 0 ].use;

	// The UI specs load the editor and admin bundles from build/. Without them
	// the Workflow sidebar never renders and the specs time out on locators.
	// Checked before logging in: it needs no network round trip.
	if ( ! fs.existsSync( EDITOR_ASSET ) ) {
		fail(
			baseURL,
			`${ path.relative( PLUGIN_DIR, EDITOR_ASSET ) } does not exist.`,
			'Build the plugins from the repository root with `npm run build`.'
		);
	}

	await wpScriptsGlobalSetup( config );

	// Same handling as the wp-scripts global setup: only a path is a file to read.
	const requestUtils = await RequestUtils.setup( {
		storageStatePath:
			typeof storageState === 'string' ? storageState : undefined,
		baseURL,
	} );

	try {
		await requestUtils.rest( {
			path: '/vip-workflows/v1/sequences/slug/editorial-review',
		} );
	} catch ( error ) {
		const code = error?.code || error?.message || String( error );
		if ( code === 'rest_no_route' ) {
			fail(
				baseURL,
				'the vip-workflows/v1 REST routes are not registered, so VIP Workflows is not active.',
				RESEED_HINT
			);
		}
		if ( code === 'rest_sequence_not_found' ) {
			fail(
				baseURL,
				'the seeded "editorial-review" sequence does not exist.',
				RESEED_HINT
			);
		}
		// Any other failure (auth, a PHP fatal, a non-JSON response) is not
		// missing seed data, so reseeding would not fix it.
		fail(
			baseURL,
			`the seeded "editorial-review" sequence could not be read (${ code }).`,
			'Check that the site responds and that the admin user can read the vip-workflows/v1 REST API.'
		);
	} finally {
		await requestUtils.request.dispose();
	}
}

module.exports = globalSetup;
