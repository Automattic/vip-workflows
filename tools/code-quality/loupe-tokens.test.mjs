/**
 * The token stylesheet loupe reads must match the installed @wordpress/theme.
 *
 * loupe.config.json points `designSystem.tokenSources` at a copy committed in
 * .loupe/tokens/, not at node_modules, so the Claude Code hook can check tokens
 * in a fresh checkout or an agent worktree that has no `npm run setup`. The
 * cost of a copy is drift: a @wordpress/theme bump that adds or renames tokens
 * leaves loupe judging against the old set. This test is the guard.
 *
 * It skips where the package isn't installed; CI installs it before running it.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

const ROOT = join( dirname( fileURLToPath( import.meta.url ) ), '..', '..' );
const VENDORED = '.loupe/tokens/wpds-design-tokens.css';
const INSTALLED = 'vip-workflows/node_modules/@wordpress/theme/prebuilt/css/design-tokens.css';

it( 'loupe.config.json reads the vendored token stylesheet', () => {
	const config = JSON.parse( readFileSync( join( ROOT, 'loupe.config.json' ), 'utf8' ) );
	assert.deepEqual( config.designSystem.tokenSources, [ VENDORED ] );
	assert.ok( existsSync( join( ROOT, VENDORED ) ), `${ VENDORED } is missing` );
} );

it(
	'the vendored token stylesheet matches the installed @wordpress/theme',
	{ skip: ! existsSync( join( ROOT, INSTALLED ) ) && 'run `npm run setup` to install @wordpress/theme' },
	() => {
		const vendored = readFileSync( join( ROOT, VENDORED ), 'utf8' );
		const installed = readFileSync( join( ROOT, INSTALLED ), 'utf8' );
		assert.ok(
			vendored === installed,
			`${ VENDORED } is out of date with @wordpress/theme. Refresh it:\n    cp ${ INSTALLED } ${ VENDORED }`
		);
	}
);
