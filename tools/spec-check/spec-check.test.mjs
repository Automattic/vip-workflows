import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { evaluate, globToRegExp, isSpecRelevant } from './spec-check.mjs';

const script = fileURLToPath(new URL('./spec-check.mjs', import.meta.url));

function run(files, env = {}) {
	return spawnSync(process.execPath, [script], {
		input: files.join('\n'),
		encoding: 'utf8',
		env: { PATH: process.env.PATH, ...env },
	});
}

test('globToRegExp handles * and **', () => {
	assert.ok(
		globToRegExp('workflow-*/**').test('workflow-parsely/includes/a.php'),
	);
	assert.ok(
		!globToRegExp('workflow-*/**').test('vip-workflows/includes/a.php'),
	);
	assert.ok(globToRegExp('**/tests/**').test('tests/a.php'));
	assert.ok(
		globToRegExp('**/tests/**').test('workflow-parsely/tests/Unit/a.php'),
	);
	assert.ok(
		!globToRegExp('vip-workflows/*.php').test('vip-workflows/includes/a.php'),
	);
	assert.ok(globToRegExp('**/.*').test('workflow-parsely/.phpcs.xml.dist'));
});

test('plugin code is spec-relevant', () => {
	for (const file of [
		'vip-workflows/includes/workflow/class-status-manager.php',
		'vip-workflows/src/admin/sequence-editor/Inspector.js',
		'vip-workflows/vip-workflows.php',
		'vip-workflows/uninstall.php',
		'workflow-parsely/includes/class-discovery-provider.php',
		'workflow-agent-copy-edit/workflow-agent-copy-edit.php',
	]) {
		assert.ok(isSpecRelevant(file), file);
	}
});

test('tests, styles, docs, manifests and other paths are not', () => {
	for (const file of [
		'vip-workflows/tests/phpunit/Unit/StatusManagerTest.php',
		'vip-workflows/tests/unit-js/region-inspector.test.js',
		'workflow-parsely/tests/Unit/ProviderTest.php',
		'vip-workflows/src/admin/style.scss',
		'workflow-tool-checklist/README.md',
		'workflow-tool-checklist/package-lock.json',
		'workflow-tool-checklist/package.json',
		'workflow-parsely/composer.lock',
		'workflow-parsely/.phpcs.xml.dist',
		'docs/reference/architecture.md',
		'.github/workflows/e2e.yml',
		'tools/package-plugin.sh',
		'vip-workflows/docs/TESTING.md',
		'vip-workflows/build/index.js',
	]) {
		assert.ok(!isSpecRelevant(file), file);
	}
});

test('evaluate: no plugin code passes', () => {
	const result = evaluate({ files: ['docs/README.md'], labels: [] });
	assert.equal(result.status, 'pass');
	assert.deepEqual(result.relevant, []);
});

test('evaluate: code with SPEC.md passes', () => {
	const result = evaluate({
		files: ['vip-workflows/includes/a.php', 'docs/SPEC.md'],
		labels: [],
	});
	assert.equal(result.status, 'pass');
});

test('evaluate: code with the label is skipped', () => {
	const result = evaluate({
		files: ['vip-workflows/includes/a.php'],
		labels: ['documentation', 'no-spec-change'],
	});
	assert.equal(result.status, 'skip');
});

test('evaluate: code without SPEC.md or label is missing', () => {
	const result = evaluate({
		files: ['vip-workflows/includes/a.php', 'vip-workflows/tests/a.php'],
		labels: ['documentation'],
	});
	assert.equal(result.status, 'missing');
	assert.deepEqual(result.relevant, ['vip-workflows/includes/a.php']);
});

test('CLI warns and exits 0 by default', () => {
	const out = run(['vip-workflows/includes/a.php']);
	assert.equal(out.status, 0);
	assert.match(out.stdout, /::warning file=docs\/SPEC\.md::/);
});

test('CLI fails in strict mode', () => {
	const out = run(['vip-workflows/includes/a.php'], {
		SPEC_CHECK_STRICT: 'true',
	});
	assert.equal(out.status, 1);
	assert.match(out.stdout, /::error file=docs\/SPEC\.md::/);
});

test('CLI respects the label in strict mode', () => {
	const out = run(['vip-workflows/includes/a.php'], {
		SPEC_CHECK_STRICT: 'true',
		PR_LABELS: '["no-spec-change"]',
	});
	assert.equal(out.status, 0);
	assert.doesNotMatch(out.stdout, /::(error|warning)/);
});

test('CLI rejects malformed labels', () => {
	const out = run(['vip-workflows/includes/a.php'], {
		PR_LABELS: '"no-spec-change"',
	});
	assert.notEqual(out.status, 0);
});
