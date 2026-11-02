import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveBlueprint, shiftWxrDates } from './build-preview-blueprint.mjs';

const ROOT = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

function readRepo( relativePath ) {
	return readFileSync( path.join( ROOT, relativePath ), 'utf8' );
}

test( 'shifts the dominant post-date month and leaves others alone', () => {
	const wxr = [
		'<wp:post_date><![CDATA[2026-01-05 14:00:00]]></wp:post_date>',
		'<wp:post_date_gmt><![CDATA[2026-01-05 14:00:00]]></wp:post_date_gmt>',
		'<wp:post_date><![CDATA[2026-01-08 16:30:00]]></wp:post_date>',
		'<wp:post_date><![CDATA[2025-12-31 09:00:00]]></wp:post_date>',
	].join( '\n' );

	const shifted = shiftWxrDates( wxr, '2026-10' );

	assert.match( shifted, /post_date><!\[CDATA\[2026-10-05 14:00:00/ );
	assert.match( shifted, /post_date_gmt><!\[CDATA\[2026-10-05 14:00:00/ );
	assert.match( shifted, /post_date><!\[CDATA\[2026-10-08 16:30:00/ );
	assert.match( shifted, /post_date><!\[CDATA\[2025-12-31 09:00:00/ );
} );

test( 'rejects a WXR document with no post dates', () => {
	assert.throws(
		() => shiftWxrDates( '<rss></rss>', '2026-10' ),
		/no wp:post_date/
	);
} );

test( 'rejects unknown build-time tokens', () => {
	assert.throws(
		() =>
			resolveBlueprint(
				{ steps: [ { url: '{{REPO_FILE:x}}' } ] },
				readRepo,
				'2026-10'
			),
		/Unknown blueprint token/
	);
} );

test( 'the preview blueprint resolves to an installable core plugin with seeded content', () => {
	const template = JSON.parse( readRepo( '.playground/blueprint.json' ) );
	const blueprint = resolveBlueprint( template, readRepo, '2026-10' );

	assert.equal(
		blueprint.landingPage,
		'/wp-admin/admin.php?page=vip-workflows'
	);

	const corePlugin = blueprint.steps.find(
		( step ) =>
			step.step === 'installPlugin' &&
			step.pluginData.url === '{{ARTIFACT_URL:vip-workflows}}'
	);
	assert.ok( corePlugin, 'core plugin is installed from the PR artifact' );
	assert.equal( corePlugin.options.activate, true );

	const importStep = blueprint.steps.find(
		( step ) => step.step === 'importWxr'
	);
	assert.ok( importStep, 'demo content is imported' );
	assert.match( importStep.file.contents, /^<\?xml/ );
	assert.match( importStep.file.contents, /CDATA\[2026-10-\d{2}/ );

	assert.ok(
		blueprint.steps.indexOf( importStep ) >
			blueprint.steps.indexOf( corePlugin ),
		'content is imported after the plugin is active'
	);
} );
