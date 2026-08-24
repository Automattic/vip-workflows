#!/usr/bin/env node
/**
 * Guards the local dev wp-env against a leftover CI egress block.
 *
 * A local `.wp-env.override.json` can enable `WP_HTTP_BLOCK_EXTERNAL`. That is
 * useful for isolated tests, but harmful in the development environment where
 * AI connectors and the content importer need outbound HTTP.
 *
 * If an override lingers, `wp-env start` bakes
 * `WP_HTTP_BLOCK_EXTERNAL=true` into the dev wp-config, and it STAYS there:
 * `wp-env start`/`--update` don't rewrite an existing wp-config, so deleting the
 * override doesn't undo it. The block then kills every outbound AI call —
 * AiClient::isConfigured('openai') probes api.openai.com live and fails, so
 * ideation and the editorial alignment checker report "OpenAI not connected"
 * even with a valid key. That cost a couple of silent hours once; this fails
 * loudly instead.
 *
 * Runs as `prewp-env:start`, before the override can be baked in. Skips under CI
 * and ignores a `false` value (harmless).
 *
 * Usage:
 *   node scripts/check-dev-no-http-block.js   # exit 1 if the dev override enables the block
 */

const fs = require( 'fs' );
const path = require( 'path' );

const ROOT = path.join( __dirname, '..' );
const OVERRIDE_PATH = path.join( ROOT, '.wp-env.override.json' );

// CI legitimately injects the block (egress-restricted agents). Only guard local dev.
if ( process.env.CI ) {
	process.exit( 0 );
}

if ( ! fs.existsSync( OVERRIDE_PATH ) ) {
	process.exit( 0 );
}

let override;
try {
	override = JSON.parse( fs.readFileSync( OVERRIDE_PATH, 'utf8' ) );
} catch ( err ) {
	console.error( `✖ .wp-env.override.json is not valid JSON: ${ err.message }` );
	process.exit( 1 );
}

// The override format nests defines under `config`; check the top level too for safety.
const blockValue =
	override?.config?.WP_HTTP_BLOCK_EXTERNAL ?? override?.WP_HTTP_BLOCK_EXTERNAL;

// A `false` value is harmless; only a truthy block poisons the dev wp-config.
if ( blockValue === false || blockValue === undefined || blockValue === null ) {
	process.exit( 0 );
}

console.error(
	[
		'✖ .wp-env.override.json enables WP_HTTP_BLOCK_EXTERNAL on the local dev env.',
		'',
		'  This is a CI-only setting for egress-restricted agents. Starting wp-env',
		'  with it bakes the block into the dev wp-config, which survives restarts',
		'  and breaks all outbound AI calls (ideation, the editorial alignment',
		'  checker, etc. report "OpenAI not connected" despite a valid key).',
		'',
		'  It is almost certainly a leftover from a local CI-e2e reproduction whose',
		'  cleanup trap did not fire. To fix:',
		'',
		'      rm .wp-env.override.json',
		'',
		'  Then run wp-env again. If you genuinely need the block, set CI=1.',
	].join( '\n' )
);
process.exit( 1 );
