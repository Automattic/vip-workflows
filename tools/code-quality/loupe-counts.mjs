/**
 * Occurrence counts for the loupe baseline.
 *
 * loupe's baseline (`.loupe/baseline.json`) is a set of keys: rule + file +
 * normalized code. Every finding that shares a key is accepted, so a second
 * `<Stack> ← background` override in a file that already had one passes the
 * gate. This module adds the missing number. `.loupe/baseline-counts.json`
 * records how many findings each key held when the baseline was recorded, and
 * the gate fails when a blocking key now holds more.
 *
 * The counts are a sidecar, not a field of baseline.json, because loupe owns
 * that file: `loupe baseline` rewrites it and would drop a field it doesn't
 * know. `quality.mjs baseline` re-records both together.
 *
 * Pure functions only, so the tests can drive them with fixture findings.
 */

export const COUNTS_FILE = '.loupe/baseline-counts.json';
export const REFRESH = 'npm run loupe:baseline';

/**
 * loupe's own baseline identity (`findingKey` in the engine): rule, file, and
 * the finding's code (its message when it has none), whitespace collapsed.
 *
 * @param {{ rule: string, file: string, code?: string, message?: string }} f
 */
export const loupeKey = (f) => `${f.rule}|${f.file}|${String(f.code ?? f.message).replace(/\s+/g, ' ').trim()}`;

/**
 * How many findings share each key.
 *
 * @param {Array<object>} findings
 * @returns {Record<string, number>} keys sorted, so the file diffs cleanly.
 */
export function countKeys(findings) {
	const counts = new Map();
	for (const f of findings) {
		const key = loupeKey(f);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The sidecar for a baseline recorded from `findings`.
 *
 * @param {Array<object>} findings
 */
export function countsFile(findings) {
	return { version: 1, findings: findings.length, counts: countKeys(findings) };
}

/**
 * Check that the sidecar describes the baseline beside it. A sidecar that
 * doesn't is missing data, not a reason to accept every occurrence again: the
 * caller fails the run and names the refresh command.
 *
 * @param {{ entries: string[], findings?: number }} baseline parsed baseline.json
 * @param {unknown} sidecar parsed baseline-counts.json
 * @returns {string|null} what is wrong, or null when they agree.
 */
export function countsProblem(baseline, sidecar) {
	if (!sidecar || typeof sidecar !== 'object' || !sidecar.counts || typeof sidecar.counts !== 'object') {
		return `${COUNTS_FILE} has no \`counts\` object`;
	}
	const keys = Object.keys(sidecar.counts);
	const entries = new Set(baseline.entries);
	const missing = baseline.entries.filter((k) => !Object.hasOwn(sidecar.counts, k));
	const extra = keys.filter((k) => !entries.has(k));
	if (missing.length || extra.length) {
		return `${COUNTS_FILE} does not match .loupe/baseline.json (${missing.length} key(s) without a count, ${extra.length} count(s) for a key the baseline lacks)`;
	}
	const bad = keys.filter((k) => !Number.isInteger(sidecar.counts[k]) || sidecar.counts[k] < 1);
	if (bad.length) return `${COUNTS_FILE} has ${bad.length} count(s) that are not a positive integer`;
	const total = keys.reduce((sum, k) => sum + sidecar.counts[k], 0);
	if (typeof baseline.findings === 'number' && total !== baseline.findings) {
		return `${COUNTS_FILE} counts ${total} finding(s), .loupe/baseline.json recorded ${baseline.findings}`;
	}
	return null;
}

/**
 * Compare current findings, with no baseline applied, against the counts.
 *
 * - `over`: blocking keys the baseline holds that now have more findings than
 *   it accepted. All of the key's current findings are listed: nothing tells a
 *   new occurrence from an old one, since they share rule, file and code.
 * - `under`: keys with fewer findings than accepted (any severity). Only
 *   meaningful on a whole-repo run; on a scoped run an absent key is mostly
 *   just out of scope.
 *
 * Keys the baseline lacks are not reported here: `loupe check` already reports
 * them as new.
 *
 * @param {Array<object>} findings current findings, `--no-baseline`
 * @param {Record<string, number>} counts the sidecar's `counts`
 */
export function compareCounts(findings, counts) {
	const byKey = new Map();
	for (const f of findings) {
		const key = loupeKey(f);
		if (!byKey.has(key)) byKey.set(key, []);
		byKey.get(key).push(f);
	}
	const over = [];
	for (const [key, list] of byKey) {
		if (!Object.hasOwn(counts, key)) continue;
		if (!list.some((f) => f.severity === 'error')) continue;
		if (list.length > counts[key]) over.push({ key, accepted: counts[key], found: list.length, findings: list });
	}
	const under = Object.keys(counts)
		.filter((key) => (byKey.get(key)?.length ?? 0) < counts[key])
		.map((key) => ({ key, accepted: counts[key], found: byKey.get(key)?.length ?? 0 }));
	return { over, under };
}

/**
 * The text report for keys over their count.
 *
 * @param {ReturnType<typeof compareCounts>['over']} over
 */
export function formatOver(over) {
	const n = over.reduce((sum, o) => sum + o.found - o.accepted, 0);
	const lines = [`✗ loupe: ${n} new occurrence(s) of baselined finding(s) — the baseline accepts fewer of each:`];
	for (const o of over) {
		const f = o.findings[0];
		lines.push(`  ${f.file}  ${f.rule}  (baseline accepts ${o.accepted}, found ${o.found})`);
		lines.push(`    ${String(f.code ?? f.message).replace(/\s+/g, ' ').trim()}`);
		for (const x of o.findings) lines.push(`    line ${x.line}: ${x.message}`);
	}
	lines.push('  These share rule, file and code with a baselined finding, so any of them may be the new one. Fix one, or suppress it with a reason.');
	return lines.join('\n');
}
