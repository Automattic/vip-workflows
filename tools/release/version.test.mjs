import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { nextVersion, parseVersion } from './version.mjs';

const root = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

for ( const [ current, type, expected ] of [
	[ '0.0.5', 'patch', '0.0.6' ],
	[ '0.0.5', 'minor', '0.1.0' ],
	[ '0.0.5', 'major', '1.0.0' ],
	[ '0.0.5', 'alpha', '0.0.6-alpha.1' ],
	[ '0.0.5', 'beta', '0.0.6-beta.1' ],
	[ '0.0.5', '1.0.0-beta.1', '1.0.0-beta.1' ],
	[ '1.0.0-alpha.1', 'alpha', '1.0.0-alpha.2' ],
	[ '1.0.0-alpha.2', 'beta', '1.0.0-beta.1' ],
	[ '1.0.0-beta.1', 'beta', '1.0.0-beta.2' ],
	[ '1.0.0-beta.9', 'beta', '1.0.0-beta.10' ],
	[ '1.0.0-beta.2', 'patch', '1.0.0' ],
	[ '1.0.0-beta.2', 'minor', '1.0.0' ],
	[ '1.0.0-beta.2', 'major', '1.0.0' ],
	[ '1.2.3-beta.2', 'minor', '1.3.0' ],
	[ '1.2.3-beta.2', 'major', '2.0.0' ],
	[ '1.0.0-beta.2', '1.0.0', '1.0.0' ],
] ) {
	test( `${ current } + ${ type } = ${ expected }`, () => {
		assert.equal( nextVersion( current, type ), expected );
	} );
}

test( 'rejects duplicate versions and semantic downgrades', () => {
	for ( const type of [
		'alpha',
		'1.0.0-beta.2',
		'1.0.0-beta.1',
		'1.0.0-alpha.9',
		'0.9.9',
	] ) {
		assert.throws(
			() => nextVersion( '1.0.0-beta.2', type ),
			/must be newer/
		);
	}
	assert.throws(
		() => nextVersion( '1.0.0', '1.0.0-beta.1' ),
		/must be newer/
	);
} );

test( 'rejects malformed versions and unsupported release types', () => {
	for ( const version of [
		'',
		'v1.0.0',
		'1.0',
		'01.0.0',
		'1.0.0-beta',
		'1.0.0-beta.0',
		'1.0.0-beta.01',
		'1.0.0-rc.1',
		'1.0.0; echo bad',
	] ) {
		assert.throws(
			() => parseVersion( version ),
			/Invalid release version/
		);
	}
	assert.throws(
		() => nextVersion( '1.0.0', 'unknown' ),
		/Invalid release version/
	);
} );

test( 'the release workflow classifies stable, alpha, and beta versions', () => {
	for ( const [ version, expected ] of [
		[ '1.0.0', 'false' ],
		[ '1.0.0-alpha.1', 'true' ],
		[ '1.0.0-beta.2', 'true' ],
	] ) {
		assert.equal(
			execFileSync(
				process.execPath,
				[ 'tools/release/version.mjs', '--prerelease', version ],
				{ cwd: root, encoding: 'utf8' }
			).trim(),
			expected
		);
	}
	assert.notEqual(
		spawnSync(
			process.execPath,
			[ 'tools/release/version.mjs', '--prerelease', 'bad' ],
			{ cwd: root }
		).status,
		0
	);
} );

test( 'the release script prepares sequential beta releases and promotes to stable', ( t ) => {
	const directory = mkdtempSync( path.join( tmpdir(), 'vip-release-' ) );
	t.after( () => rmSync( directory, { recursive: true, force: true } ) );
	mkdirSync( path.join( directory, 'bin' ) );
	mkdirSync( path.join( directory, 'tools/release' ), { recursive: true } );
	mkdirSync( path.join( directory, 'vip-workflows' ) );
	cpSync(
		path.join( root, 'bin/release' ),
		path.join( directory, 'bin/release' )
	);
	cpSync(
		path.join( root, 'tools/release/version.mjs' ),
		path.join( directory, 'tools/release/version.mjs' )
	);
	writeFileSync(
		path.join( directory, 'vip-workflows/vip-workflows.php' ),
		"<?php\n/**\n * Version: 0.0.5\n */\ndefine( 'VIP_WORKFLOWS_VERSION', '0.0.5' );\n"
	);
	writeFileSync(
		path.join( directory, 'vip-workflows/package.json' ),
		JSON.stringify( { name: 'release-test', version: '0.0.5' } )
	);
	writeFileSync(
		path.join( directory, 'vip-workflows/package-lock.json' ),
		JSON.stringify( {
			name: 'release-test',
			version: '0.0.5',
			lockfileVersion: 3,
			packages: { '': { name: 'release-test', version: '0.0.5' } },
		} )
	);
	const run = ( command, args ) =>
		execFileSync( command, args, {
			cwd: directory,
			encoding: 'utf8',
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: '/dev/null',
				GIT_CONFIG_NOSYSTEM: '1',
				HUSKY: '0',
			},
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		} ).trim();
	run( 'git', [ 'init' ] );
	run( 'git', [ 'config', 'user.name', 'Release Test' ] );
	run( 'git', [ 'config', 'user.email', 'release@example.com' ] );
	run( 'git', [ 'add', '.' ] );
	run( 'git', [ 'commit', '-m', 'Initial version' ] );
	for ( const [ type, version ] of [
		[ '1.0.0-beta.1', '1.0.0-beta.1' ],
		[ 'beta', '1.0.0-beta.2' ],
		[ 'patch', '1.0.0' ],
	] ) {
		run( 'sh', [ 'bin/release', type ] );
		const php = readFileSync(
			path.join( directory, 'vip-workflows/vip-workflows.php' ),
			'utf8'
		);
		assert.ok( php.includes( `Version: ${ version }\n` ) );
		assert.ok(
			php.includes( `define( 'VIP_WORKFLOWS_VERSION', '${ version }' );` )
		);
		const manifest = JSON.parse(
			readFileSync(
				path.join( directory, 'vip-workflows/package.json' ),
				'utf8'
			)
		);
		const lock = JSON.parse(
			readFileSync(
				path.join( directory, 'vip-workflows/package-lock.json' ),
				'utf8'
			)
		);
		assert.equal( manifest.version, version );
		assert.equal( lock.version, version );
		assert.equal( lock.packages[ '' ].version, version );
		assert.equal(
			run( 'git', [ 'branch', '--show-current' ] ),
			`release/v${ version }`
		);
		assert.equal(
			run( 'git', [ 'log', '-1', '--format=%s' ] ),
			`v${ version }`
		);
		assert.equal( run( 'git', [ 'status', '--porcelain' ] ), '' );
	}
	const head = run( 'git', [ 'rev-parse', 'HEAD' ] );
	assert.throws( () => run( 'sh', [ 'bin/release', '1.0.0-beta.1' ] ) );
	assert.equal( run( 'git', [ 'rev-parse', 'HEAD' ] ), head );
	assert.equal( run( 'git', [ 'status', '--porcelain' ] ), '' );
} );
