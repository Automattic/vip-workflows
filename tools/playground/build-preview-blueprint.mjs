#!/usr/bin/env node
/**
 * Validates .playground/blueprint.json and writes it as the pull request
 * preview blueprint.
 *
 * `{{ARTIFACT_URL:<name>}}` tokens are left in place for the publish workflow
 * to replace with public zip URLs, so each one must name an artifact the build
 * produces; publish runs from `main` after the PR's checks, so a bad token
 * would otherwise fail there or reach the reviewer's browser.
 *
 * The Preview button percent-encodes the blueprint into a `data:` URL only
 * once and Playground decodes it before fetching, so a `#` would start a URL
 * fragment and a `%` would be decoded twice. Both are rejected.
 *
 * Usage: node tools/playground/build-preview-blueprint.mjs <output-path> <artifact-name>...
 */

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);
const TEMPLATE = path.join( ROOT, '.playground/blueprint.json' );

// Same token syntax the publish workflow substitutes.
const ARTIFACT_URL = /\{\{\s*ARTIFACT_URL:([a-zA-Z0-9_-]+)\s*\}\}/g;

/**
 * Checks a blueprint template and returns it serialized for publishing.
 *
 * @param {Object}   blueprint     Parsed blueprint template.
 * @param {string[]} artifactNames Names of the zips the build produces.
 * @return {string} The blueprint JSON.
 */
export function resolveBlueprint( blueprint, artifactNames ) {
	const json = JSON.stringify( blueprint, null, '\t' );

	for ( const [ , name ] of json.matchAll( ARTIFACT_URL ) ) {
		if ( ! artifactNames.includes( name ) ) {
			throw new Error(
				`Blueprint references artifact "${ name }", which the build does not produce (${ artifactNames.join(
					', '
				) })`
			);
		}
	}

	const leftover = json.replace( ARTIFACT_URL, '' ).match( /\{\{|\}\}/ );
	if ( leftover ) {
		throw new Error(
			`Blueprint has a malformed or unknown token near "${ leftover[ 0 ] }"`
		);
	}

	const unsafe = json.match( /[#%]/ );
	if ( unsafe ) {
		throw new Error(
			`Blueprint contains "${ unsafe[ 0 ] }", which breaks the Preview button's data: URL`
		);
	}

	return json + '\n';
}

if ( realpathSync( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {
	const [ output, ...artifactNames ] = process.argv.slice( 2 );
	if ( ! output || artifactNames.length === 0 ) {
		console.error(
			'Usage: node tools/playground/build-preview-blueprint.mjs <output-path> <artifact-name>...'
		);
		process.exit( 1 );
	}

	const template = JSON.parse( readFileSync( TEMPLATE, 'utf8' ) );
	const json = resolveBlueprint( template, artifactNames );

	mkdirSync( path.dirname( path.resolve( output ) ), { recursive: true } );
	writeFileSync( output, json );
	console.log( `Wrote ${ output }` );
}
