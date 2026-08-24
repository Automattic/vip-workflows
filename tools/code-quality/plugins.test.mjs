/**
 * Tests for the monorepo's plugin discovery.
 *
 * Two runners now depend on these probes agreeing with each other — the quality
 * runner for unit suites, the integration runner for everything wp-env — and
 * neither is exercised by CI on its own. A wrong answer here does not fail
 * loudly; it silently drops a plugin from a run, which is the failure this
 * module was written to remove in the first place.
 *
 * Fixtures are built on disk rather than mocked because every probe's job is to
 * answer a question about the filesystem. A mocked fs would only prove the
 * assertions agree with themselves.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
	CORE,
	mountedInWpEnv,
	phpunitConfig,
	plugins,
	withComposer,
	withIntegrationSuite,
} from './plugins.mjs';

const roots = [];

/** Build a throwaway repo root. `spec` maps a plugin dir to the files it holds. */
function fixture(spec = {}, extra = {}) {
	const root = mkdtempSync(join(tmpdir(), 'vipwf-plugins-'));
	roots.push(root);

	for (const [dir, files] of Object.entries(spec)) {
		mkdirSync(join(root, dir), { recursive: true });
		for (const [name, body] of Object.entries(files)) {
			writeFileSync(join(root, dir, name), body);
		}
	}
	for (const [name, body] of Object.entries(extra)) {
		writeFileSync(join(root, name), body);
	}
	return root;
}

const suiteConfig = (name, quote = '"') =>
	`<?xml version="1.0"?><phpunit><testsuites><testsuite name=${quote}${name}${quote}><directory>tests</directory></testsuite></testsuites></phpunit>`;

after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('plugins()', () => {
	it('lists core first, then workflow-* sorted', () => {
		const root = fixture({ 'workflow-zebra': {}, 'workflow-alpha': {}, 'vip-workflow': {} });
		assert.deepEqual(plugins(root), [CORE, 'workflow-alpha', 'workflow-zebra']);
	});

	it('ignores directories that are not plugins, and files that look like them', () => {
		const root = fixture({ 'workflow-real': {}, docs: {}, node_modules: {} }, { 'workflow-not-a-dir': '' });
		assert.deepEqual(plugins(root), [CORE, 'workflow-real']);
	});

	it('names core even when its directory is absent', () => {
		// Callers probe each name before using it, so an absent core is their
		// problem to report — not something discovery should quietly hide.
		assert.deepEqual(plugins(fixture({})), [CORE]);
	});
});

describe('phpunitConfig()', () => {
	it('finds either filename', () => {
		const dist = fixture({ 'workflow-a': { 'phpunit.xml.dist': '<phpunit/>' } });
		const plain = fixture({ 'workflow-a': { 'phpunit.xml': '<phpunit/>' } });

		assert.ok(phpunitConfig(dist, 'workflow-a').endsWith('phpunit.xml.dist'));
		assert.ok(phpunitConfig(plain, 'workflow-a').endsWith('phpunit.xml'));
	});

	it('prefers .dist when a plugin ships both', () => {
		const root = fixture({
			'workflow-a': { 'phpunit.xml.dist': '<phpunit/>', 'phpunit.xml': '<phpunit/>' },
		});
		assert.ok(phpunitConfig(root, 'workflow-a').endsWith('phpunit.xml.dist'));
	});

	it('returns null when a plugin has no config', () => {
		assert.equal(phpunitConfig(fixture({ 'workflow-a': {} }), 'workflow-a'), null);
	});
});

describe('withComposer()', () => {
	it('selects only plugins carrying a composer.json', () => {
		const root = fixture({
			'vip-workflow': { 'composer.json': '{}' },
			'workflow-has': { 'composer.json': '{}' },
			'workflow-has-not': {},
		});
		assert.deepEqual(withComposer(root), [CORE, 'workflow-has']);
	});

	it('answers independently of whether a suite exists', () => {
		// The two probes are deliberately different questions: composer install
		// has to run before vendor/bin/phpunit exists, so a plugin with deps and
		// no suite still needs installing.
		const root = fixture({ 'workflow-deps-only': { 'composer.json': '{}' } });

		// Core is absent from this fixture, so it is correctly filtered out too.
		assert.deepEqual(withComposer(root), ['workflow-deps-only']);
		assert.deepEqual(withIntegrationSuite(root), []);
	});
});

describe('withIntegrationSuite()', () => {
	it('selects plugins declaring an integration suite, in either filename', () => {
		const root = fixture({
			'workflow-dist': { 'phpunit.xml.dist': suiteConfig('integration') },
			'workflow-plain': { 'phpunit.xml': suiteConfig('integration') },
		});
		assert.deepEqual(withIntegrationSuite(root), ['workflow-dist', 'workflow-plain']);
	});

	it('skips a config declaring only a unit suite', () => {
		// The discrimination that keeps the runner from invoking
		// `--testsuite integration` against a plugin that has no such suite,
		// where the failure reads like a broken suite rather than a wrong flag.
		const root = fixture({ 'workflow-unit-only': { 'phpunit.xml': suiteConfig('unit') } });
		assert.deepEqual(withIntegrationSuite(root), []);
	});

	it('accepts single quotes and loose attribute spacing', () => {
		const root = fixture({
			'workflow-single': { 'phpunit.xml': suiteConfig('integration', "'") },
			'workflow-spaced': {
				'phpunit.xml': '<phpunit><testsuites><testsuite\n\t\tname="integration"></testsuite></testsuites></phpunit>',
			},
		});
		assert.deepEqual(withIntegrationSuite(root), ['workflow-single', 'workflow-spaced']);
	});

	it('does not match a suite whose name merely contains "integration"', () => {
		const root = fixture({ 'workflow-near': { 'phpunit.xml': suiteConfig('integration-slow') } });
		assert.deepEqual(withIntegrationSuite(root), []);
	});

	it('returns nothing for a tree with no configs at all', () => {
		// The runner treats this as a failure rather than a pass, so the probe
		// has to actually return empty rather than throw.
		assert.deepEqual(withIntegrationSuite(fixture({ 'workflow-bare': {} })), []);
	});
});

describe('mountedInWpEnv()', () => {
	it('reads local plugin directories and ignores external sources', () => {
		const root = fixture(
			{},
			{
				'.wp-env.json': JSON.stringify({
					plugins: [
						'https://downloads.wordpress.org/plugin/gutenberg.zip',
						'./vip-workflow',
						'./workflow-parsely',
					],
				}),
			}
		);
		assert.deepEqual(mountedInWpEnv(root), ['vip-workflow', 'workflow-parsely']);
	});

	it('returns empty when the file is absent or declares no plugins', () => {
		assert.deepEqual(mountedInWpEnv(fixture({})), []);
		assert.deepEqual(mountedInWpEnv(fixture({}, { '.wp-env.json': '{}' })), []);
	});
});

describe('against the real repo', () => {
	// Fixtures prove the probes' logic; this proves they still describe the
	// checkout they will actually run against.
	const root = new URL('../..', import.meta.url).pathname;

	it('finds core and agrees with itself about the integration suites', () => {
		assert.ok(plugins(root).includes(CORE));

		// Anything runnable must also be installable — a suite whose plugin has
		// no composer.json has no phpunit to run it.
		for (const plugin of withIntegrationSuite(root)) {
			assert.ok(
				withComposer(root).includes(plugin),
				`${plugin} declares an integration suite but has no composer.json`
			);
		}
	});
});
