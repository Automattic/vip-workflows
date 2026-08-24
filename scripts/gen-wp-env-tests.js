#!/usr/bin/env node
/**
 * Generates `.wp-env.tests.json` from `.wp-env.json`.
 *
 * Why this exists: wp-env deprecated the dual dev+tests start (the `env.tests`
 * block and `testsPort`/`testsEnvironment` options). The non-deprecated way to
 * run a second, isolated environment is `wp-env start --config <file>` — but a
 * custom config file FULLY REPLACES `.wp-env.json` (no merge), so the tests
 * config has to repeat the core pin, PHP version, and the whole plugins list.
 *
 * Rather than hand-maintain that duplication (add a plugin → edit two files),
 * we keep `.wp-env.json` as the single source of truth and derive the tests
 * config from it, applying only the deltas that make it a tests environment:
 *
 *   - port 8889            — matches the e2e harness default (@wordpress/scripts
 *                            globalSetup + playwright.config.js).
 *   - WP_HTTP_BLOCK_EXTERNAL — keeps tests deterministic by preventing a cold
 *                            wp-admin load from waiting on external services.
 *                            Development keeps egress for AI connectors and the
 *                            content importer, so this is tests-only.
 *   - DISABLE_WP_CRON      — with egress blocked, WP's loopback cron spawn fails
 *                            mid-request and leaves a stale `doing_cron` lock, so
 *                            due events never run and a direct wp-cron.php hit
 *                            bails for WP_CRON_LOCK_TIMEOUT. Disabling the auto-
 *                            spawn removes the lock, so a spec can drive cron
 *                            deterministically by requesting /wp-cron.php (e.g.
 *                            to run a queued stage agent). Tests-only.
 *   - testsEnvironment: false — single standalone environment, no deprecated
 *                            dual-start, no warning.
 *   - drop `lifecycleScripts` — afterStart runs `wp-env run cli` with no
 *                            `--config`, which targets the DEV env; in a
 *                            tests-only CI boot the dev env isn't running, so it
 *                            would fail the start. e2e seeds its own data and
 *                            doesn't need permalinks/import, so this is a no-op
 *                            for the suite.
 *
 * The output is a committed, generated artifact. DO NOT EDIT it by hand — edit
 * `.wp-env.json` and re-run this script. A pre-commit hook regenerates it when
 * `.wp-env.json` changes, and CI runs `--check` to fail closed on drift.
 *
 * Usage:
 *   node scripts/gen-wp-env-tests.js          # write .wp-env.tests.json
 *   node scripts/gen-wp-env-tests.js --check  # exit 1 if the file is stale
 */

const fs = require( 'fs' );
const path = require( 'path' );

const ROOT = path.join( __dirname, '..' );
const BASE_PATH = path.join( ROOT, '.wp-env.json' );
const TESTS_PATH = path.join( ROOT, '.wp-env.tests.json' );
const TESTS_PORT = 8889;

/**
 * Builds the tests config object from the base config.
 *
 * @param {Object} base Parsed `.wp-env.json`.
 * @return {Object} The derived tests config.
 */
function buildTestsConfig( base ) {
	// Rebuild explicitly (rather than spread + delete) so key order is stable
	// and the generated diff is predictable regardless of base key order.
	const tests = {};

	if ( base.$schema !== undefined ) {
		tests.$schema = base.$schema;
	}
	if ( base.core !== undefined ) {
		tests.core = base.core;
	}
	if ( base.phpVersion !== undefined ) {
		tests.phpVersion = base.phpVersion;
	}

	tests.port = TESTS_PORT;

	if ( base.plugins !== undefined ) {
		tests.plugins = base.plugins;
	}
	if ( base.mappings !== undefined ) {
		tests.mappings = base.mappings;
	}

	tests.config = {
		...( base.config ?? {} ),
		WP_HTTP_BLOCK_EXTERNAL: true,
		DISABLE_WP_CRON: true,
	};

	// Single standalone environment — no deprecated dual-start, no warning.
	tests.testsEnvironment = false;

	return tests;
}

/**
 * Serializes a config object to match the repo's tab-indented JSON style, with
 * a trailing newline, so the committed file produces no spurious diffs.
 *
 * @param {Object} config The config object.
 * @return {string} Serialized JSON.
 */
function serialize( config ) {
	return JSON.stringify( config, null, '\t' ) + '\n';
}

function main() {
	const check = process.argv.includes( '--check' );

	if ( ! fs.existsSync( BASE_PATH ) ) {
		console.error( `gen-wp-env-tests: ${ BASE_PATH } not found.` );
		process.exit( 1 );
	}

	const base = JSON.parse( fs.readFileSync( BASE_PATH, 'utf8' ) );
	const expected = serialize( buildTestsConfig( base ) );

	if ( check ) {
		const actual = fs.existsSync( TESTS_PATH )
			? fs.readFileSync( TESTS_PATH, 'utf8' )
			: null;
		if ( actual !== expected ) {
			console.error(
				'gen-wp-env-tests: .wp-env.tests.json is out of sync with .wp-env.json.\n' +
					'Run `node scripts/gen-wp-env-tests.js` and commit the result.'
			);
			process.exit( 1 );
		}
		console.log( 'gen-wp-env-tests: .wp-env.tests.json is up to date.' );
		return;
	}

	fs.writeFileSync( TESTS_PATH, expected );
	console.log( 'gen-wp-env-tests: wrote .wp-env.tests.json from .wp-env.json.' );
}

main();
