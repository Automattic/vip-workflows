#!/usr/bin/env node
/**
 * Spec check: a pull request that changes plugin code should also change
 * docs/SPEC.md, or carry the `no-spec-change` label.
 *
 * Path filtering only. It doesn't judge whether the spec edit is right; the
 * reviewer does that by reading the SPEC.md diff next to the code.
 *
 * Usage (CI passes the changed files on stdin, one per line):
 *   git diff --name-only base...head | node tools/spec-check/spec-check.mjs
 *
 * Environment:
 *   PR_LABELS          JSON array of label names on the pull request.
 *   SPEC_CHECK_STRICT  "true" fails the job; anything else only warns.
 *   GITHUB_STEP_SUMMARY  if set, a short summary is appended to it.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SPEC_FILE = 'docs/SPEC.md';
export const SKIP_LABEL = 'no-spec-change';

// Code whose behavior SPEC.md describes.
export const WATCHED = [
	'vip-workflows/includes/**',
	'vip-workflows/src/**',
	'vip-workflows/vip-workflows.php',
	'vip-workflows/uninstall.php',
	'workflow-*/**',
];

// Files inside the watched paths that never change what SPEC.md describes:
// tests, styles, docs, and dependency manifests (Dependabot touches those).
export const IGNORED = [
	'**/tests/**',
	'**/__tests__/**',
	'**/*.test.*',
	'**/*.css',
	'**/*.scss',
	'**/*.md',
	'**/package.json',
	'**/package-lock.json',
	'**/composer.json',
	'**/composer.lock',
	'**/.*',
];

/**
 * Converts a glob with `*` and `**` into an anchored regular expression.
 * `**` matches across directories, `*` within one path segment.
 *
 * @param {string} glob
 * @return {RegExp} Matcher for the whole path.
 */
export function globToRegExp(glob) {
	let pattern = '';
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i];
		if (char === '*' && glob[i + 1] === '*') {
			// `**/` also matches zero directories.
			if (glob[i + 2] === '/') {
				pattern += '(?:.*/)?';
				i += 2;
			} else {
				pattern += '.*';
				i += 1;
			}
		} else if (char === '*') {
			pattern += '[^/]*';
		} else {
			pattern += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${pattern}$`);
}

const watched = WATCHED.map(globToRegExp);
const ignored = IGNORED.map(globToRegExp);

/**
 * @param {string} file Repository-relative path.
 * @return {boolean} Whether a change to this file should come with a spec change.
 */
export function isSpecRelevant(file) {
	return (
		watched.some((re) => re.test(file)) && !ignored.some((re) => re.test(file))
	);
}

/**
 * @param {Object}   input
 * @param {string[]} input.files  Changed files.
 * @param {string[]} input.labels Pull request labels.
 * @return {{ status: 'pass'|'skip'|'missing', relevant: string[], reason: string }} Result.
 */
export function evaluate({ files, labels }) {
	const relevant = files.filter(isSpecRelevant);

	if (relevant.length === 0) {
		return {
			status: 'pass',
			relevant,
			reason: 'No plugin code changed.',
		};
	}
	if (files.includes(SPEC_FILE)) {
		return {
			status: 'pass',
			relevant,
			reason: `${SPEC_FILE} is updated alongside the code.`,
		};
	}
	if (labels.includes(SKIP_LABEL)) {
		return {
			status: 'skip',
			relevant,
			reason: `Labeled \`${SKIP_LABEL}\`. The PR description's "Spec changes" section should say why.`,
		};
	}
	return {
		status: 'missing',
		relevant,
		reason: `Plugin code changed but ${SPEC_FILE} didn't. Update the matching section, or add the \`${SKIP_LABEL}\` label and say why under "Spec changes" in the PR description.`,
	};
}

function parseLabels(raw) {
	if (!raw) {
		return [];
	}
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed)) {
		throw new Error('PR_LABELS must be a JSON array of label names.');
	}
	return parsed.map(String);
}

function main() {
	const files = readFileSync(0, 'utf8')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const labels = parseLabels(process.env.PR_LABELS);
	const strict = process.env.SPEC_CHECK_STRICT === 'true';

	const result = evaluate({ files, labels });
	const lines = [`Spec check: ${result.reason}`];
	if (result.relevant.length > 0) {
		lines.push('', 'Plugin files changed:');
		lines.push(...result.relevant.map((file) => `- ${file}`));
	}
	const text = lines.join('\n');
	console.log(text);

	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`## Spec check\n\n${text.replace(/^Spec check: /, '')}\n`,
		);
	}

	if (result.status === 'missing') {
		// `::error` or `::warning` puts the message on the PR's checks page.
		console.log(
			`::${strict ? 'error' : 'warning'} file=${SPEC_FILE}::${result.reason}`,
		);
		process.exitCode = strict ? 1 : 0;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
