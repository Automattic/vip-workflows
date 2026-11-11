import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	anchorsFor,
	check,
	localLinks,
	slugify,
	toRepoPath,
} from './docs-check.mjs';

test('slugify matches GitHub anchors', () => {
	assert.equal(slugify('Publish boundary'), 'publish-boundary');
	assert.equal(slugify('Keeping SPEC.md current'), 'keeping-specmd-current');
	assert.equal(
		slugify(
			'Marketing, communications and corporate publishing: approvals and governance',
		),
		'marketing-communications-and-corporate-publishing-approvals-and-governance',
	);
	assert.equal(
		slugify('`StatusManager::transition()`'),
		'statusmanagertransition',
	);
	assert.equal(slugify('REST and Abilities'), 'rest-and-abilities');
});

test('anchorsFor numbers duplicate headings and skips code blocks', () => {
	const anchors = anchorsFor(
		'# Title\n## Footguns\n```\n# not a heading\n```\n## Footguns\n<a name="custom"></a>\n',
	);
	assert.deepEqual([...anchors].sort(), [
		'custom',
		'footguns',
		'footguns-1',
		'title',
	]);
});

test('localLinks skips URLs and code', () => {
	assert.deepEqual(
		localLinks(
			'[a](b.md) [c](https://x.test) [d](#e) `[f](g.md)`\n```\n[h](i.md)\n```\n[ref]: ../j.md\n[k](mailto:x@y.test)',
		),
		['b.md', '#e', '../j.md'],
	);
});

test('check reports missing files and anchors', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'docs-check-'));
	try {
		mkdirSync(path.join(root, 'docs'));
		writeFileSync(path.join(root, 'docs/a.md'), '# A\n## Section one\n');
		writeFileSync(
			path.join(root, 'docs/b.md'),
			[
				'# B',
				'[ok](a.md#section-one)',
				'[ok dir](../docs)',
				'[ok self](#b)',
				'[bad file](missing.md)',
				'[bad anchor](a.md#section-two)',
				'[bad self](#nope)',
				'',
			].join('\n'),
		);
		const report = check(root, ['docs/a.md', 'docs/b.md']);
		assert.equal(report.files, 2);
		assert.equal(report.lines, 9);
		assert.deepEqual(
			report.broken.map(({ target, reason }) => `${target} ${reason}`),
			[
				'missing.md file not found',
				'a.md#section-two anchor not found',
				'#nope anchor not found',
			],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('toRepoPath accepts absolute and folder-relative paths', () => {
	assert.equal(toRepoPath('/repo', '/repo', 'docs/a.md'), 'docs/a.md');
	assert.equal(toRepoPath('/repo', '/repo/docs', 'a.md'), 'docs/a.md');
	assert.equal(
		toRepoPath('/repo', '/elsewhere', '/repo/docs/a.md'),
		'docs/a.md',
	);
});
