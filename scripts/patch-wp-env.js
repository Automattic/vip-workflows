#!/usr/bin/env node
/**
 * Patches @wordpress/env's Docker templates for this repository's runtime.
 *
 * The wordpress:php8.2 and wordpress:latest Docker images now use Debian Trixie (13).
 * Two problems arise when building on macOS with Docker Desktop:
 *   1. apt-get update fails over HTTP — deb.debian.org:80 returns EOF.
 *   2. wordpress:latest ships with corrupted dpkg database files.
 *
 * Docker Official Images are also routed through mirror.gcr.io so CI does not
 * consume the shared, anonymous Docker Hub pull quota.
 *
 * This script patches the templates after npm install so the fixes persist. It
 * is idempotent — safe to run multiple times.
 */

const fs = require( 'fs' );
const path = require( 'path' );

const configPath = path.join(
	__dirname,
	'../node_modules/@wordpress/env/lib/runtime/docker/docker-config.js'
);
const composeConfigPath = path.join(
	__dirname,
	'../node_modules/@wordpress/env/lib/runtime/docker/build-docker-compose-config.js'
);
const dbEnvPath = path.join(
	__dirname,
	'../node_modules/@wordpress/env/lib/config/db-env.js'
);

if ( ! fs.existsSync( configPath ) ) {
	console.log( 'patch-wp-env: @wordpress/env not found, skipping.' );
	process.exit( 0 );
}

for ( const [ filePath, fileName ] of [
	[ composeConfigPath, 'build-docker-compose-config.js' ],
	[ dbEnvPath, 'db-env.js' ],
] ) {
	if ( ! fs.existsSync( filePath ) ) {
		console.error( `patch-wp-env: expected ${ fileName } was not found.` );
		process.exit( 1 );
	}
}

let dockerConfig = fs.readFileSync( configPath, 'utf8' );
let composeConfig = fs.readFileSync( composeConfigPath, 'utf8' );
let dbEnv = fs.readFileSync( dbEnvPath, 'utf8' );

// The last of wp-env's per-release Debian archive fixes in the WordPress
// Dockerfile. The Trixie fix goes after it, before the host user is created.
const TRIXIE_NEEDLE = `RUN sed -i '/bullseye-updates/d' /etc/apt/sources.list

# Create the host's user`;

const TRIXIE_PATCH = `RUN sed -i '/bullseye-updates/d' /etc/apt/sources.list

# trixie: HTTP apt fails inside Docker on macOS — deb.debian.org:80 returns EOF; use HTTPS
RUN find /etc/apt/sources.list.d/ -name '*.sources' -exec sed -i 's|http://deb.debian.org|https://deb.debian.org|g' {} + 2>/dev/null; sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list 2>/dev/null; true
# trixie: wordpress:latest ships with corrupted dpkg files that break apt-get install
RUN truncate -s 0 /var/lib/dpkg/status 2>/dev/null; truncate -s 0 /var/lib/apt/extended_states 2>/dev/null; truncate -s 0 /var/lib/dpkg/triggers/File 2>/dev/null; true

# Create the host's user`;

if ( ! dockerConfig.includes( '# trixie:' ) ) {
	if ( ! dockerConfig.includes( TRIXIE_NEEDLE ) ) {
		console.error(
			'patch-wp-env: expected Debian setup was not found in docker-config.js.\n' +
				'This likely means @wordpress/env was updated and the patch needs review.'
		);
		process.exit( 1 );
	}

	dockerConfig = dockerConfig.replace( TRIXIE_NEEDLE, TRIXIE_PATCH );
}

/**
 * Replace an expected upstream image reference, or fail closed when wp-env's
 * templates change underneath this patch.
 *
 * @param {string} content  File contents.
 * @param {string} source   Docker Hub image reference.
 * @param {string} target   Mirrored image reference.
 * @param {string} fileName File being patched.
 * @return {string} Patched contents.
 */
function replaceImage( content, source, target, fileName ) {
	if ( content.includes( target ) ) {
		return content;
	}

	if ( ! content.includes( source ) ) {
		console.error(
			`patch-wp-env: expected image reference not found in ${ fileName }: ${ source }`
		);
		process.exit( 1 );
	}

	return content.replaceAll( source, target );
}

dockerConfig = replaceImage(
	dockerConfig,
	'FROM wordpress${ phpVersion }',
	'FROM mirror.gcr.io/library/wordpress${ phpVersion }',
	'docker-config.js'
);
dockerConfig = replaceImage(
	dockerConfig,
	'FROM wordpress:cli${ phpVersion }',
	'FROM mirror.gcr.io/library/wordpress:cli${ phpVersion }',
	'docker-config.js'
);
dbEnv = replaceImage(
	dbEnv,
	'return `mariadb:${',
	'return `mirror.gcr.io/library/mariadb:${',
	'db-env.js'
);
composeConfig = replaceImage(
	composeConfig,
	"image: 'phpmyadmin'",
	"image: 'mirror.gcr.io/library/phpmyadmin'",
	'build-docker-compose-config.js'
);

fs.writeFileSync( configPath, dockerConfig );
fs.writeFileSync( composeConfigPath, composeConfig );
fs.writeFileSync( dbEnvPath, dbEnv );
console.log( 'patch-wp-env: patched @wordpress/env Docker templates.' );
