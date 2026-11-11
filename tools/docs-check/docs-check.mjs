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
 * Exits 1 if any link is broken.
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
		return;
	}
	console.log(`${report.broken.length} broken links:`);
	for (const { file, target, reason } of report.broken) {
		console.log(`- ${file}: ${target} (${reason})`);
	}
	process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
