#!/usr/bin/env node
/**
 * Generates the pull request preview blueprint from .playground/blueprint.json.
 *
 * Every `{{REPO_WXR:<path>}}` token is replaced with the contents of that
 * repository file, with post dates shifted into the current month so the
 * date-windowed Kanban and Calendar views show the seeded content. This is
 * the same shift tools/wp-env-after-start.sh applies to the local site.
 *
 * `{{ARTIFACT_URL:<name>}}` tokens are left in place; the publish workflow
 * replaces them with the public zip URLs.
 *
 * Usage: node tools/playground/build-preview-blueprint.mjs <output-path>
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);
const TEMPLATE = path.join( ROOT, '.playground/blueprint.json' );
const REPO_WXR = /^\{\{REPO_WXR:([^}]+)\}\}$/;
const POST_DATE = /(<wp:post_date(?:_gmt)?><!\[CDATA\[)(\d{4}-\d{2})/g;

/**
 * Moves the most common post-date month in a WXR document to `targetMonth`.
 *
 * @param {string} wxr         WXR document.
 * @param {string} targetMonth Month to shift to, as YYYY-MM.
 * @return {string} The shifted document.
 */
export function shiftWxrDates( wxr, targetMonth ) {
	const counts = new Map();
	for ( const [ , , month ] of wxr.matchAll( POST_DATE ) ) {
		counts.set( month, ( counts.get( month ) ?? 0 ) + 1 );
	}

	if ( counts.size === 0 ) {
		throw new Error( 'WXR fixture has no wp:post_date values to shift' );
	}

	const sourceMonth = [ ...counts.entries() ].sort(
		( a, b ) => b[ 1 ] - a[ 1 ]
	)[ 0 ][ 0 ];

	return wxr.replace( POST_DATE, ( match, prefix, month ) =>
		month === sourceMonth ? `${ prefix }${ targetMonth }` : match
	);
}

/**
 * Resolves the build-time tokens in a blueprint template.
 *
 * @param {Object}   blueprint   Parsed blueprint template.
 * @param {Function} readRepo    Reads a repository-relative path.
 * @param {string}   targetMonth Month to shift WXR dates to, as YYYY-MM.
 * @return {Object} The resolved blueprint.
 */
export function resolveBlueprint( blueprint, readRepo, targetMonth ) {
	return JSON.parse( JSON.stringify( blueprint ), ( key, value ) => {
		if ( typeof value !== 'string' ) {
			return value;
		}

		const match = value.match( REPO_WXR );
		if ( match ) {
			return shiftWxrDates( readRepo( match[ 1 ] ), targetMonth );
		}

		const unknown = value.match( /\{\{(?!ARTIFACT_URL:)[^}]*\}\}/ );
		if ( unknown ) {
			throw new Error(
				`Unknown blueprint token ${ unknown[ 0 ] } in "${ key }"`
			);
		}

		return value;
	} );
}

function readRepoFile( relativePath ) {
	const resolved = path.resolve( ROOT, relativePath );
	if ( ! resolved.startsWith( ROOT + path.sep ) ) {
		throw new Error( `${ relativePath } is outside the repository` );
	}
	return readFileSync( resolved, 'utf8' );
}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {
	const output = process.argv[ 2 ];
	if ( ! output ) {
		console.error(
			'Usage: node tools/playground/build-preview-blueprint.mjs <output-path>'
		);
		process.exit( 1 );
	}

	const template = JSON.parse( readFileSync( TEMPLATE, 'utf8' ) );
	const targetMonth = new Date().toISOString().slice( 0, 7 );
	const blueprint = resolveBlueprint( template, readRepoFile, targetMonth );

	mkdirSync( path.dirname( path.resolve( output ) ), { recursive: true } );
	writeFileSync( output, JSON.stringify( blueprint, null, '\t' ) + '\n' );
	console.log( `Wrote ${ output }` );
}
