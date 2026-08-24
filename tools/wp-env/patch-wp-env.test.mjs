import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test( 'patch-wp-env routes Docker Official Images through the registry mirror', () => {
	const fixture = mkdtempSync(
		path.join( tmpdir(), 'vip-workflow-patch-wp-env-' )
	);
	const scriptsDir = path.join( fixture, 'scripts' );
	const dockerDir = path.join(
		fixture,
		'node_modules/@wordpress/env/lib/runtime/docker'
	);

	mkdirSync( scriptsDir, { recursive: true } );
	mkdirSync( dockerDir, { recursive: true } );
	copyFileSync(
		path.join( ROOT, 'scripts/patch-wp-env.js' ),
		path.join( scriptsDir, 'patch-wp-env.js' )
	);

	writeFileSync(
		path.join( dockerDir, 'docker-config.js' ),
		`return \`FROM wordpress\${ phpVersion }\`;
return \`FROM wordpress:cli\${ phpVersion }\`;
RUN sed -i '/buster-updates/d' /etc/apt/sources.list

# Create the host's user
`
	);
	writeFileSync(
		path.join( dockerDir, 'build-docker-compose-config.js' ),
		`image: 'mariadb:lts',
image: 'phpmyadmin',
image: 'mariadb:lts',
image: 'phpmyadmin',
`
	);

	try {
		execFileSync( process.execPath, [
			path.join( scriptsDir, 'patch-wp-env.js' ),
		] );

		const dockerConfig = readFileSync(
			path.join( dockerDir, 'docker-config.js' ),
			'utf8'
		);
		const composeConfig = readFileSync(
			path.join( dockerDir, 'build-docker-compose-config.js' ),
			'utf8'
		);

		assert.match(
			dockerConfig,
			/FROM mirror\.gcr\.io\/library\/wordpress\$\{ phpVersion \}/
		);
		assert.match(
			dockerConfig,
			/FROM mirror\.gcr\.io\/library\/wordpress:cli\$\{ phpVersion \}/
		);
		assert.equal(
			(
				composeConfig.match(
					/mirror\.gcr\.io\/library\/mariadb:lts/g
				) || []
			).length,
			2
		);
		assert.equal(
			(
				composeConfig.match(
					/mirror\.gcr\.io\/library\/phpmyadmin/g
				) || []
			).length,
			2
		);
	} finally {
		rmSync( fixture, { recursive: true, force: true } );
	}
} );
