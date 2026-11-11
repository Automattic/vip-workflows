import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

const ENV_LIB = 'node_modules/@wordpress/env/lib';
const DOCKER_CONFIG = `${ ENV_LIB }/runtime/docker/docker-config.js`;
const COMPOSE_CONFIG = `${ ENV_LIB }/runtime/docker/build-docker-compose-config.js`;
const DB_ENV = `${ ENV_LIB }/config/db-env.js`;

// Excerpts of the @wordpress/env 12.1.0 templates the patch edits, in their
// upstream order. Refresh these from the installed package when wp-env moves.
const DOCKER_CONFIG_12 = `return \`FROM wordpress\${ phpVersion }

RUN sed -i 's|deb.debian.org/debian buster|archive.debian.org/debian buster|g' /etc/apt/sources.list
RUN sed -i '/buster-updates/d' /etc/apt/sources.list

# bullseye (https://www.debian.org/News/2026/20260831)
RUN sed -i 's|deb.debian.org/debian bullseye|archive.debian.org/debian bullseye|g' /etc/apt/sources.list
RUN sed -i '/bullseye-updates/d' /etc/apt/sources.list

# Create the host's user so that we can match ownership in the container.
ARG HOST_USERNAME
\`;
return \`FROM wordpress:cli\${ phpVersion }

# Create the host's user so that we can match ownership in the container.
ARG HOST_USERNAME
\`;
`;

const COMPOSE_CONFIG_12 = `mysql: {
	image: dbEnv.getMariaDBImage( config.env.development.mariadbVersion ),
},
phpmyadmin: {
	image: 'phpmyadmin',
},
'tests-mysql': {
	image: dbEnv.getMariaDBImage( config.env.tests.mariadbVersion ),
},
'tests-phpmyadmin': {
	image: 'phpmyadmin',
},
`;

const DB_ENV_12 = `const DEFAULT_MARIADB_VERSION = 'lts';

function getMariaDBImage( mariadbVersion ) {
	return \`mariadb:\${ mariadbVersion ?? DEFAULT_MARIADB_VERSION }\`;
}
`;

/**
 * Lay out a fake repository with the patch script and the given wp-env files.
 *
 * @param {Record<string, string>} files wp-env files, keyed by repo-relative path.
 * @return {string} Fixture root.
 */
function makeFixture( files ) {
	const fixture = mkdtempSync(
		path.join( tmpdir(), 'vip-workflows-patch-wp-env-' )
	);
	mkdirSync( path.join( fixture, 'scripts' ), { recursive: true } );
	copyFileSync(
		path.join( ROOT, 'scripts/patch-wp-env.js' ),
		path.join( fixture, 'scripts/patch-wp-env.js' )
	);
	for ( const [ file, content ] of Object.entries( files ) ) {
		mkdirSync( path.dirname( path.join( fixture, file ) ), {
			recursive: true,
		} );
		writeFileSync( path.join( fixture, file ), content );
	}
	return fixture;
}

function runPatch( fixture ) {
	return spawnSync(
		process.execPath,
		[ path.join( fixture, 'scripts/patch-wp-env.js' ) ],
		{ encoding: 'utf8' }
	);
}

function read( fixture, file ) {
	return readFileSync( path.join( fixture, file ), 'utf8' );
}

function count( haystack, pattern ) {
	return ( haystack.match( pattern ) || [] ).length;
}

const CURRENT_FILES = {
	[ DOCKER_CONFIG ]: DOCKER_CONFIG_12,
	[ COMPOSE_CONFIG ]: COMPOSE_CONFIG_12,
	[ DB_ENV ]: DB_ENV_12,
};

test( 'patch-wp-env patches the @wordpress/env 12 templates', () => {
	const fixture = makeFixture( CURRENT_FILES );

	try {
		const result = runPatch( fixture );
		assert.equal( result.status, 0, result.stderr );

		const dockerConfig = read( fixture, DOCKER_CONFIG );
		assert.match(
			dockerConfig,
			/FROM mirror\.gcr\.io\/library\/wordpress\$\{ phpVersion \}/
		);
		assert.match(
			dockerConfig,
			/FROM mirror\.gcr\.io\/library\/wordpress:cli\$\{ phpVersion \}/
		);

		// The Trixie fix lands once, in the WordPress image, after the
		// bullseye archive fix and before the host user is created.
		assert.equal( count( dockerConfig, /# trixie: HTTP apt/g ), 1 );
		const bullseye = dockerConfig.indexOf( '/bullseye-updates/d' );
		const trixie = dockerConfig.indexOf( '# trixie:' );
		const hostUser = dockerConfig.indexOf( "# Create the host's user" );
		assert.ok( bullseye < trixie && trixie < hostUser );

		assert.equal(
			count(
				read( fixture, COMPOSE_CONFIG ),
				/image: 'mirror\.gcr\.io\/library\/phpmyadmin'/g
			),
			2
		);
		assert.match(
			read( fixture, DB_ENV ),
			/return `mirror\.gcr\.io\/library\/mariadb:\$\{ mariadbVersion/
		);
	} finally {
		rmSync( fixture, { recursive: true, force: true } );
	}
} );

test( 'patch-wp-env is idempotent', () => {
	const fixture = makeFixture( CURRENT_FILES );

	try {
		assert.equal( runPatch( fixture ).status, 0 );
		const once = Object.keys( CURRENT_FILES ).map( ( file ) =>
			read( fixture, file )
		);

		assert.equal( runPatch( fixture ).status, 0 );
		const twice = Object.keys( CURRENT_FILES ).map( ( file ) =>
			read( fixture, file )
		);

		assert.deepEqual( twice, once );
	} finally {
		rmSync( fixture, { recursive: true, force: true } );
	}
} );

test( 'patch-wp-env fails when the Debian anchor moves', () => {
	// The @wordpress/env 11 layout: no bullseye block before the host user.
	const fixture = makeFixture( {
		...CURRENT_FILES,
		[ DOCKER_CONFIG ]: DOCKER_CONFIG_12.replace(
			/\n# bullseye[\s\S]*?bullseye-updates\/d' \/etc\/apt\/sources\.list\n/,
			''
		),
	} );

	try {
		const result = runPatch( fixture );
		assert.equal( result.status, 1 );
		assert.match( result.stderr, /expected Debian setup was not found/ );
	} finally {
		rmSync( fixture, { recursive: true, force: true } );
	}
} );

test( 'patch-wp-env fails when the MariaDB image template moves', () => {
	const fixture = makeFixture( {
		...CURRENT_FILES,
		[ DB_ENV ]: DB_ENV_12.replace( 'return `mariadb:', 'return `maria:' ),
	} );

	try {
		const result = runPatch( fixture );
		assert.equal( result.status, 1 );
		assert.match( result.stderr, /not found in db-env\.js/ );
	} finally {
		rmSync( fixture, { recursive: true, force: true } );
	}
} );

test( 'patch-wp-env fails when db-env.js is missing', () => {
	const { [ DB_ENV ]: _dbEnv, ...withoutDbEnv } = CURRENT_FILES;
	const fixture = makeFixture( withoutDbEnv );

	try {
		const result = runPatch( fixture );
		assert.equal( result.status, 1 );
		assert.match( result.stderr, /expected db-env\.js was not found/ );
	} finally {
		rmSync( fixture, { recursive: true, force: true } );
	}
} );
