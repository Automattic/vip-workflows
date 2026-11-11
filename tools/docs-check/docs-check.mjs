#!/usr/bin/env node
/**
 * Docs check: counts Markdown files and lines, and reports relative links and
 * in-page anchors that don't resolve. The docs cleanup
 * (docs/maintenance/docs-cleanup.md) runs it before and after.
 *
 * Usage:
 *   node tools/docs-check/docs-check.mjs            # every tracked .md file
 *   node tools/docs-check/docs-check.mjs a.md b.md  # just these
 *
 * A full run (no arguments) also compares docs/SPEC.md with the plugin code
 * it describes. The spec should stay at no more than one line for every
 * SPEC_RATIO_FLOOR lines of code, the ratio when it was written, so it grows
 * only as fast as the code does.
 *
 * Exits 1 if any link is broken or SPEC.md is over that size.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens.
 *
 * @param {string} heading Heading text without the leading #s.
 * @return {string} Anchor slug.
 */
export function slugify(heading) {
	return heading
		.trim()
		.toLowerCase()
		.replace(/<[^>]+>/g, '')
		.replace(/[`*_~]/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.replace(/\s/g, '-');
}

/**
 * Strips fenced code blocks and inline code so links inside them are ignored.
 *
 * @param {string} markdown
 * @return {string} Markdown without code.
 */
function stripCode(markdown) {
	return markdown
		.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
		.replace(/`[^`\n]*`/g, '');
}

/**
 * @param {string} markdown
 * @return {Set<string>} Anchors GitHub generates for this file's headings.
 */
export function anchorsFor(markdown) {
	const anchors = new Set();
	const seen = new Map();
	const body = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
	for (const match of body.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
		const base = slugify(match[1]);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		anchors.add(count === 0 ? base : `${base}-${count}`);
	}
	for (const match of body.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) {
		anchors.add(match[1]);
	}
	return anchors;
}

/**
 * @param {string} markdown
 * @return {string[]} Link targets that aren't external URLs.
 */
export function localLinks(markdown) {
	const targets = [];
	const body = stripCode(markdown);
	for (const match of body.matchAll(
		/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
	)) {
		targets.push(match[1]);
	}
	for (const match of body.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) {
		targets.push(match[1]);
	}
	return targets.filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

/**
 * @param {string}   root  Repository root.
 * @param {string[]} files Repository-relative Markdown paths.
 * @return {{ files: number, lines: number, broken: { file: string, target: string, reason: string }[] }} Report.
 */
export function check(root, files) {
	const broken = [];
	const anchorCache = new Map();
	let lines = 0;

	const anchorsOf = (file) => {
		if (!anchorCache.has(file)) {
			anchorCache.set(
				file,
				anchorsFor(readFileSync(path.join(root, file), 'utf8')),
			);
		}
		return anchorCache.get(file);
	};

	for (const file of files) {
		const markdown = readFileSync(path.join(root, file), 'utf8');
		lines += markdown.split('\n').length - (markdown.endsWith('\n') ? 1 : 0);

		for (const target of localLinks(markdown)) {
			const [rawPath, rawAnchor] = target.split('#');
			const targetPath = decodeURIComponent(rawPath);
			const resolved = targetPath
				? path.posix.normalize(
						targetPath.startsWith('/')
							? targetPath.slice(1)
							: path.posix.join(path.posix.dirname(file), targetPath),
				  )
				: file;

			if (!existsSync(path.join(root, resolved))) {
				broken.push({ file, target, reason: 'file not found' });
				continue;
			}
			if (
				rawAnchor &&
				resolved.endsWith('.md') &&
				statSync(path.join(root, resolved)).isFile() &&
				!anchorsOf(resolved).has(decodeURIComponent(rawAnchor))
			) {
				broken.push({ file, target, reason: 'anchor not found' });
			}
		}
	}

	return { files: files.length, lines, broken };
}

/**
 * Turns a command-line argument into a repository-relative path, so absolute
 * paths and paths relative to the current folder both work.
 *
 * @param {string} root Repository root.
 * @param {string} cwd  Current working folder.
 * @param {string} arg  Path as given.
 * @return {string} Repository-relative path with forward slashes.
 */
export function toRepoPath(root, cwd, arg) {
	return path.relative(root, path.resolve(cwd, arg)).split(path.sep).join('/');
}

export const SPEC_FILE = 'docs/SPEC.md';

// Lines of plugin code per line of SPEC.md when the spec was written
// (111,835 to 1,232 in November 2026, about 91). Lower it only on purpose.
export const SPEC_RATIO_FLOOR = 90;

/**
 * Whether a file is plugin code SPEC.md describes: PHP and JavaScript in the
 * core plugin's includes/ and src/, its main and uninstall files, and every
 * workflow-* extension, minus tests, vendored code and build output.
 *
 * @param {string} file Repository-relative path.
 * @return {boolean} Whether it counts toward the code side of the ratio.
 */
export function isPluginCode(file) {
	return (
		/^(vip-workflows\/(includes|src)\/|vip-workflows\/(vip-workflows|uninstall)\.php$|workflow-[^/]+\/)/.test(
			file,
		) &&
		/\.(php|jsx?|tsx?)$/.test(file) &&
		!/(^|\/)(tests?|__tests__|vendor|node_modules|build)\//.test(file) &&
		!/\.test\./.test(file)
	);
}

/**
 * @param {string} text File contents.
 * @return {number} Line count, as `wc -l` would give for a final newline.
 */
export function countLines(text) {
	if (text === '') {
		return 0;
	}
	return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/**
 * @param {number} codeLines Lines of plugin code.
 * @param {number} specLines Lines of SPEC.md.
 * @return {{ ratio: number, maxSpecLines: number, ok: boolean }} Comparison.
 */
export function specRatio(codeLines, specLines) {
	const ratio = specLines === 0 ? Infinity : codeLines / specLines;
	return {
		ratio,
		maxSpecLines: Math.floor(codeLines / SPEC_RATIO_FLOOR),
		ok: ratio >= SPEC_RATIO_FLOOR,
	};
}

function trackedFiles(root) {
	return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
		.split('\n')
		.filter(Boolean);
}

function trackedMarkdown(root) {
	return execFileSync('git', ['ls-files', '*.md'], {
		cwd: root,
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean)
		.filter((file) => !file.includes('node_modules/'));
}

function main() {
	const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
		encoding: 'utf8',
	}).trim();
	const args = process.argv.slice(2);
	const files =
		args.length > 0
			? args.map((arg) => toRepoPath(root, process.cwd(), arg))
			: trackedMarkdown(root);

	const report = check(root, files);
	console.log(`${report.files} Markdown files, ${report.lines} lines.`);
	if (report.broken.length === 0) {
		console.log('Every relative link and anchor resolves.');
	} else {
		console.log(`${report.broken.length} broken links:`);
		for (const { file, target, reason } of report.broken) {
			console.log(`- ${file}: ${target} (${reason})`);
		}
		process.exitCode = 1;
	}

	if (args.length > 0) {
		return;
	}
	const read = (file) => readFileSync(path.join(root, file), 'utf8');
	const codeLines = trackedFiles(root)
		.filter(isPluginCode)
		.reduce((sum, file) => sum + countLines(read(file)), 0);
	const specLines = countLines(read(SPEC_FILE));
	const { ratio, maxSpecLines, ok } = specRatio(codeLines, specLines);
	const fmt = (n) => n.toLocaleString('en-US');
	console.log(
		`${SPEC_FILE}: ${fmt(specLines)} lines for ${fmt(
			codeLines,
		)} lines of plugin code, one per ${ratio.toFixed(
			0,
		)} (keep at ${SPEC_RATIO_FLOOR} or more, so at most ${fmt(
			maxSpecLines,
		)} lines).`,
	);
	if (!ok) {
		console.log(
			`${SPEC_FILE} is ${fmt(
				specLines - maxSpecLines,
			)} lines over. Trim it as part of this run.`,
		);
		process.exitCode = 1;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
