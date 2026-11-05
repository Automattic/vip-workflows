/**
 * Tests for the loupe baseline's occurrence counts.
 *
 * loupe's baseline is a set of keys, so a second finding with the same rule,
 * file and code as a baselined one passed the gate. These drive the count
 * comparison with fixture findings shaped like `loupe check --format json`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareCounts, countKeys, countsFile, countsProblem, formatOver, loupeKey } from './loupe-counts.mjs';

const FILE = 'vip-workflows/src/admin/components/KanbanBoard.css';
const KEY = `system/override|${FILE}|<Stack> ← background`;

const override = (line) => ({
	rule: 'system/override',
	severity: 'error',
	file: FILE,
	line,
	message: '<Stack> ← background',
	code: '<Stack> ← background',
});

const advisory = (line) => ({
	rule: 'patterns/superseded-composite',
	severity: 'warn',
	file: FILE,
	line,
	message: 'SelectControl with 5 short static options',
	code: 'rule:few-static-options:SelectControl with 5 short static options',
});

describe('loupeKey', () => {
	it('is rule, file and code, with no line', () => {
		assert.equal(loupeKey(override(100)), KEY);
		assert.equal(loupeKey(override(100)), loupeKey(override(200)));
	});

	it('falls back to the message and collapses whitespace, as the engine does', () => {
		assert.equal(loupeKey({ rule: 'r', file: 'f', message: '  a\n\tb  ' }), 'r|f|a b');
	});
});

describe('compareCounts', () => {
	const counts = countKeys([override(100), override(105), override(110)]);

	it('fails a new occurrence beside a baselined one', () => {
		const { over } = compareCounts([override(100), override(105), override(110), override(127)], counts);
		assert.equal(over.length, 1);
		assert.equal(over[0].key, KEY);
		assert.equal(over[0].accepted, 3);
		assert.equal(over[0].found, 4);
		assert.deepEqual(
			over[0].findings.map((f) => f.line),
			[100, 105, 110, 127],
		);
		assert.match(formatOver(over), /1 new occurrence\(s\)[\s\S]*baseline accepts 3, found 4/);
	});

	it('passes the same count, on any lines', () => {
		const { over, under } = compareCounts([override(1), override(2), override(3)], counts);
		assert.deepEqual(over, []);
		assert.deepEqual(under, []);
	});

	it('passes fewer, and reports that the baseline can shrink', () => {
		const { over, under } = compareCounts([override(100)], counts);
		assert.deepEqual(over, []);
		assert.deepEqual(under, [{ key: KEY, accepted: 3, found: 1 }]);
	});

	it('leaves keys the baseline lacks to loupe, which reports them as new', () => {
		const other = { ...override(5), code: '<Stack> ← color', message: '<Stack> ← color' };
		assert.deepEqual(compareCounts([other], counts).over, []);
	});

	it('does not block on extra advisory findings', () => {
		const warn = countKeys([advisory(1)]);
		assert.deepEqual(compareCounts([advisory(1), advisory(2)], warn).over, []);
	});
});

describe('countsProblem', () => {
	const findings = [override(100), override(105), advisory(159)];
	const baseline = { entries: Object.keys(countKeys(findings)), findings: findings.length };

	it('accepts a sidecar recorded from the same findings', () => {
		const sidecar = countsFile(findings);
		assert.equal(sidecar.findings, 3);
		assert.equal(sidecar.counts[KEY], 2);
		assert.equal(countsProblem(baseline, sidecar), null);
	});

	it('rejects a missing sidecar instead of accepting every occurrence', () => {
		assert.match(countsProblem(baseline, undefined), /no `counts` object/);
	});

	it('rejects a sidecar whose keys differ from the baseline', () => {
		const sidecar = countsFile([override(100)]);
		assert.match(countsProblem(baseline, sidecar), /does not match/);
	});

	it('rejects counts that do not add up to the recorded findings', () => {
		const sidecar = countsFile(findings);
		sidecar.counts[KEY] = 1;
		assert.match(countsProblem(baseline, sidecar), /counts 2 finding\(s\)/);
	});

	it('rejects a count that is not a positive integer', () => {
		const sidecar = countsFile(findings);
		sidecar.counts[KEY] = 0;
		assert.match(countsProblem(baseline, sidecar), /not a positive integer/);
	});
});
