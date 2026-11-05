import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveBlueprint } from './build-preview-blueprint.mjs';

const ROOT = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);
const ARTIFACTS = [ 'vip-workflows', 'demo-content' ];

function readTemplate() {
	return JSON.parse(
		readFileSync( path.join( ROOT, '.playground/blueprint.json' ), 'utf8' )
	);
}

function stepsOf( json ) {
	return JSON.parse( json ).steps;
}

test( 'the preview blueprint installs the PR build and imports demo content', () => {
	const steps = stepsOf( resolveBlueprint( readTemplate(), ARTIFACTS ) );

	const corePlugin = steps.findIndex(
		( step ) =>
			step.step === 'installPlugin' &&
			step.pluginData.url === '{{ARTIFACT_URL:vip-workflows}}' &&
			step.options.activate === true
	);
	const unzip = steps.findIndex(
		( step ) =>
			step.step === 'unzip' &&
			step.zipFile.url === '{{ARTIFACT_URL:demo-content}}'
	);
	const shift = steps.findIndex(
		( step ) =>
			step.step === 'runPHP' &&
			step.code.includes( 'shift-wxr-dates.php' )
	);
	const importWxr = steps.findIndex( ( step ) => step.step === 'importWxr' );

	assert.ok(
		corePlugin >= 0,
		'core plugin is installed from the PR artifact'
	);
	assert.ok(
		corePlugin < unzip && unzip < shift && shift < importWxr,
		'content is extracted, date-shifted, and imported after the plugin is active'
	);
	assert.deepEqual( Object.keys( steps[ importWxr ].authorsMap ).sort(), [
		'admin',
		'author',
		'contributor',
		'editor',
	] );
} );

test( 'the build ships every artifact the blueprint references', () => {
	const build = readFileSync(
		path.join( ROOT, 'tools/playground/build-preview.sh' ),
		'utf8'
	);
	const workflow = readFileSync(
		path.join( ROOT, '.github/workflows/pr-preview-build.yml' ),
		'utf8'
	);

	assert.match( build, /^ARTIFACTS=\( vip-workflows demo-content \)$/m );
	for ( const name of ARTIFACTS ) {
		assert.match(
			workflow,
			new RegExp( `^\\s+${ name }=dist/preview/${ name }\\.zip$`, 'm' )
		);
	}
} );

test( 'rejects artifacts the build does not produce', () => {
	assert.throws(
		() =>
			resolveBlueprint(
				{ url: '{{ARTIFACT_URL:workflow-tool-checklist}}' },
				ARTIFACTS
			),
		/does not produce/
	);
} );

test( 'accepts the whitespace form the publish workflow accepts', () => {
	assert.doesNotThrow( () =>
		resolveBlueprint(
			{ url: '{{ ARTIFACT_URL:vip-workflows }}' },
			ARTIFACTS
		)
	);
} );

test( 'rejects malformed and unknown tokens', () => {
	for ( const url of [
		'{{ARTIFACT_URL:vip-workflows}',
		'{{ARTIFACT_URL: vip-workflows}',
		'{{REPO_FILE:x}}',
	] ) {
		assert.throws(
			() => resolveBlueprint( { url }, ARTIFACTS ),
			/malformed or unknown token/,
			url
		);
	}
} );

test( 'rejects characters that break the data: URL', () => {
	for ( const landingPage of [
		'/wp-admin/admin.php?page=vip-workflows#/new',
		'/wp-admin/?q=100%25',
	] ) {
		assert.throws(
			() => resolveBlueprint( { landingPage }, ARTIFACTS ),
			/breaks the Preview button/,
			landingPage
		);
	}
} );

test( 'writes the blueprint when run through a symlinked path', () => {
	const dir = mkdtempSync( path.join( tmpdir(), 'preview-blueprint-' ) );
	const link = path.join( dir, 'build-preview-blueprint.mjs' );
	symlinkSync(
		path.join( ROOT, 'tools/playground/build-preview-blueprint.mjs' ),
		link
	);
	const output = path.join( dir, 'blueprint.json' );

	execFileSync( 'node', [ link, output, ...ARTIFACTS ] );

	assert.ok( stepsOf( readFileSync( output, 'utf8' ) ).length > 0 );
} );
