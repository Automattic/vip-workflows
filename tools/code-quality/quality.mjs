#!/usr/bin/env node
/**
 * quality.mjs — monorepo-wide lint + fast-test runner for VIP Workflows.
 *
 * Harness-agnostic: it knows how to lint and unit-test every plugin in the
 * monorepo and is callable from anything — `npm run lint`, a Claude Code hook,
 * Codex, or CI. It does NOT touch git hooks or CI config (those are owned
 * elsewhere); it only reads the repo and runs the project's own linters/tests.
 *
 * Usage:
 *   node tools/code-quality/quality.mjs lint  [--changed | --all | <file>...]
 *   node tools/code-quality/quality.mjs test  [--changed | --all | <file>...]
 *   node tools/code-quality/quality.mjs check [--changed | --all | <file>...]
 *
 * Exit codes:
 *   0  clean, or nothing to do, or a tool/dependency was missing (skipped).
 *      JS/CSS lint findings are advisory and do NOT affect the exit code.
 *   1  blocking failure: PHP lint violations or failing unit tests.
 *   2  the run could not be performed (git unavailable/errored, bad usage) —
 *      a "couldn't determine the diff" signal, never reported as success.
 *
 * Routing:
 *   PHP   → phpcs (vip-workflows/vendor/bin). Each plugin uses its own
 *           .phpcs.xml.dist if present, else the shared extension ruleset.
 *           BLOCKING.
 *   JS/CSS→ each plugin's own wp-scripts (lint-js / lint-style). ADVISORY only —
 *           findings are reported but never block (the repo has a pre-existing
 *           JS-lint backlog). Plugins without a build are skipped.
 *   Tests → unit suites only (no wp-env / integration / e2e). Capability-probed
 *           per plugin: PHP runs when a plugin has phpunit.xml.dist + installed
 *           phpunit; JS runs when its package.json declares `test:unit:js` +
 *           installed wp-scripts. So an extension's tests light up the moment it
 *           adds them — no edit here required.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, runCssHygiene, listSuppressions } from './css-hygiene.mjs';
import { CORE, plugins } from './plugins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHPCS = join(ROOT, CORE, 'vendor', 'bin', 'phpcs');
const PHPCBF = join(ROOT, CORE, 'vendor', 'bin', 'phpcbf');
const EXT_RULESET = join(ROOT, 'tools', 'code-quality', 'phpcs-extensions.xml');
// Shared phpcs args: scope to PHP (a plugin dir otherwise scans .js/.css and
// spams "DEPRECATED: Scanning CSS/JS" for every JS sniff) and drop ANSI colors
// (they're junk once the output is captured/piped by an agent).
const PHPCS_BASE_ARGS = [`--basepath=${ROOT}`, '--extensions=php', '--no-colors'];

const PHP_EXT = new Set(['.php']);
const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const CSS_EXT = new Set(['.css', '.scss', '.sass']);

// ── small console helpers ───────────────────────────────────────────────────
const out = (m) => process.stdout.write(`${m}\n`);
const note = (m) => process.stderr.write(`${m}\n`);
const banner = (m) => note(`\n──────── ${m} ────────`);
const spawnFailure = (r) => r.error?.message || (r.signal ? `signal ${r.signal}` : 'unknown');

// ── plugin discovery ─────────────────────────────────────────────────────────
// Shared with the integration runner, so the two never disagree about what a
// plugin is. See plugins.mjs.
const PLUGINS = plugins(ROOT);

/**
 * First path segment, if it names a plugin we manage; else null.
 * git emits '/'-separated paths on every OS while explicit CLI args may use the
 * platform separator, so accept both.
 */
function owner(relPath) {
	const seg = relPath.split(/[\\/]/)[0];
	return PLUGINS.includes(seg) ? seg : null;
}

function wpScripts(plugin) {
	return join(ROOT, plugin, 'node_modules', '.bin', 'wp-scripts');
}

// A plugin has a JS/CSS toolchain only if it ships a package.json. Pure-PHP
// extensions (no package.json) have nothing for eslint/stylelint to touch, so
// the JS/CSS lint+fix steps skip them silently — a missing wp-scripts there is
// expected, not a setup gap worth warning about.
function hasJsToolchain(plugin) {
	return existsSync(join(ROOT, plugin, 'package.json'));
}

function jsonHasScript(file, name) {
	try {
		const j = JSON.parse(readFileSync(file, 'utf8'));
		return Boolean(j?.scripts?.[name]);
	} catch {
		return false;
	}
}

// ── file selection ───────────────────────────────────────────────────────────
/**
 * Repo-relative paths of changed files. Exits 2 on a genuine git failure — a
 * gate that couldn't determine the diff must NOT report success. Returns [] only
 * for the legitimate "not a git repository" case.
 */
function gitChangedFiles() {
	const r = spawnSync(
		'git',
		// quotepath=false + -z → raw, NUL-terminated, unquoted paths (handles
		// non-ASCII / special filenames that the default output would mangle).
		['-c', 'core.quotepath=false', 'status', '--porcelain', '--no-renames', '-z'],
		{ cwd: ROOT, encoding: 'utf8' }
	);
	if (r.error || r.signal || r.status === null) {
		note(`✗ quality: could not run git (${spawnFailure(r)}).`);
		process.exit(2);
	}
	if (r.status !== 0) {
		if (/not a git repository/i.test(r.stderr || '')) {
			note('⚠ quality: not a git repository — nothing to check.');
			return [];
		}
		note(`✗ quality: git failed (exit ${r.status}): ${(r.stderr || '').trim()}`);
		process.exit(2);
	}
	// Each NUL-terminated record is "XY <path>"; strip the 3-char status prefix.
	return r.stdout
		.split('\0')
		.filter(Boolean)
		.map((rec) => rec.slice(3))
		.filter((p) => existsSync(join(ROOT, p))); // drop deletions
}

/** Normalize a CLI arg to a repo-relative path. */
function toRel(p) {
	return relative(ROOT, resolve(ROOT, p));
}

// ── lint ──────────────────────────────────────────────────────────────────────
/** A plugin's own ruleset if it ships one, else the shared extension baseline. */
function phpcsStandardFor(plugin) {
	const own = join(ROOT, plugin, '.phpcs.xml.dist');
	return existsSync(own) ? own : EXT_RULESET;
}

// Both rulesets exclude the tests directories, so phpcs silently skips changed
// test files passed as explicit targets.
function isExcludedPhpTestPath(rel) {
	return /(^|\/)tests\//.test(rel.split(/[\\/]/).join('/'));
}

function runPhpcs(standard, targets, label) {
	if (!targets.length) return true;
	if (!existsSync(PHPCS)) {
		note(`⚠ lint(${label}): phpcs not installed — run \`npm run setup\`; skipped.`);
		return true;
	}
	const r = spawnSync(PHPCS, [...PHPCS_BASE_ARGS, `--standard=${standard}`, ...targets], {
		cwd: ROOT,
		encoding: 'utf8',
	});
	if (r.error || r.signal || r.status === null) {
		// Spawned but killed (OOM/timeout) or not executable — surface why rather
		// than printing an empty "✗ PHPCS:" that looks like a real violation.
		note(`✗ PHPCS (${label}): could not run phpcs (${spawnFailure(r)}).`);
		return false;
	}
	if (r.status === 0) return true;
	note(`✗ PHPCS (${label}):`);
	note(stripPhpcsNoise(r.stdout || r.stderr || '').trimEnd());
	return false;
}

// phpcs prepends per-sniff deprecation warnings to STDOUT (about JS/CSS-capable
// sniffs in the VIP ruleset). Pure noise, and it also corrupts --report=json by
// sitting before the JSON. Strip those lines everywhere phpcs output is consumed.
const PHPCS_NOISE = /^(DEPRECATED: Scanning CSS\/JS|The \S+ sniff is listening for)/;
function stripPhpcsNoise(s) {
	return (s || '')
		.split('\n')
		.filter((l) => !PHPCS_NOISE.test(l))
		.join('\n');
}

// JS/CSS lint is ADVISORY: it reports findings but never blocks (PHP lint and
// unit tests are the blocking gates). Returns true when clean, false when it
// surfaced findings — callers use that only to annotate the summary line.
function runWpScriptsLint(plugin, cmd, files, label) {
	if (!hasJsToolchain(plugin)) return true; // pure-PHP plugin — nothing to lint
	const bin = wpScripts(plugin);
	if (!existsSync(bin)) {
		note(`⚠ ${label} (${plugin}): wp-scripts not installed — run \`npm run setup\`; skipped.`);
		return true;
	}
	// Files relative to the plugin dir; no files = lint the plugin's defaults.
	const rel = files.map((f) => relative(join(ROOT, plugin), join(ROOT, f)));
	const r = spawnSync(bin, [cmd, ...rel], {
		cwd: join(ROOT, plugin),
		encoding: 'utf8',
	});
	if (r.status === 0) return true;
	note(`⚠ ${label} (${plugin}) [advisory — not blocking]:`);
	note((r.stdout || r.stderr || '').trimEnd());
	return false;
}

/**
 * @param mode        'all' — whole-plugin scan; 'list' — only the files in `files`.
 * @param ruleFilter  optional array of hygiene rule ids to display (e.g. ['R4']).
 *
 * Three sections in fixed order — the CSS-hygiene/WPDS worklist FIRST (it's the
 * primary review surface), then blocking PHP, then advisory JS/CSS — each under
 * a banner so an agent can navigate straight to its domain.
 */
function lint(mode, files, ruleFilter) {
	let ok = true;
	let advisories = 0;

	// Bucket list-mode files once; both the PHP and JS/CSS sections read from it.
	const phpByPlugin = {};
	const js = {};
	const css = {};
	let skippedTests = 0;
	if (mode !== 'all') {
		for (const f of files.filter((x) => owner(x))) {
			const o = owner(f);
			const e = extname(f).toLowerCase();
			if (PHP_EXT.has(e)) {
				if (isExcludedPhpTestPath(f)) skippedTests++;
				else (phpByPlugin[o] ??= []).push(f);
			} else if (JS_EXT.has(e)) {
				(js[o] ??= []).push(f);
			} else if (CSS_EXT.has(e)) {
				(css[o] ??= []).push(f);
			}
		}
	}

	// 1) CSS-hygiene / WPDS — the worklist.
	banner('CSS-HYGIENE / WPDS');
	ok = cssHygiene(mode, files, ruleFilter) && ok;

	// 2) PHP (phpcs) — blocking.
	banner('PHP (phpcs)');
	if (mode === 'all') {
		for (const p of PLUGINS) {
			if (existsSync(join(ROOT, p))) ok = runPhpcs(phpcsStandardFor(p), [p], p) && ok;
		}
	} else {
		for (const [p, fs] of Object.entries(phpByPlugin)) ok = runPhpcs(phpcsStandardFor(p), fs, p) && ok;
		if (skippedTests) note(`· ${skippedTests} changed test PHP file(s) skipped — */tests/* is ruleset-excluded.`);
		if (!Object.keys(phpByPlugin).length) out('✓ php: nothing to check.');
	}

	// 3) JS/CSS lint (advisory).
	banner('JS / CSS lint (advisory)');
	if (mode === 'all') {
		for (const p of PLUGINS) {
			if (!existsSync(join(ROOT, p))) continue;
			if (!runWpScriptsLint(p, 'lint-js', [], 'lint-js')) advisories++;
			if (!runWpScriptsLint(p, 'lint-style', [], 'lint-style')) advisories++;
		}
	} else {
		for (const [p, fs] of Object.entries(js)) if (!runWpScriptsLint(p, 'lint-js', fs, 'lint-js')) advisories++;
		for (const [p, fs] of Object.entries(css)) if (!runWpScriptsLint(p, 'lint-style', fs, 'lint-style')) advisories++;
		if (!Object.keys(js).length && !Object.keys(css).length) out('✓ js/css: nothing to check.');
	}

	if (!ok) return false; // blocking PHP or hygiene failures already reported above
	if (advisories) out(`⚠ lint: blocking checks clean; ${advisories} JS/CSS advisory group(s) above (not blocking).`);
	else out('✓ lint: clean.');
	return true;
}

// ── css-hygiene / WPDS-usage (see css-hygiene.mjs) ─────────────────────────────
// ruleFilter (optional) narrows what is DISPLAYED; the blocking verdict is always
// computed on the full set so `--rule R4` can never mask a lurking R0/R1.
function cssHygiene(mode, files, ruleFilter) {
	let res;
	try {
		res = runCssHygiene({ root: ROOT, plugins: PLUGINS, mode, files });
	} catch (e) {
		// A missing postcss (setup not run) must not masquerade as "clean".
		note(`⚠ css-hygiene: could not run (${e.message}); skipped.`);
		return true;
	}
	const { blocking, findings } = res;
	if (!findings.length) {
		out('✓ css-hygiene: clean.');
		return !blocking;
	}
	const filter = ruleFilter?.length ? new Set(ruleFilter) : null;
	const shown = filter ? findings.filter((f) => filter.has(f.rule)) : findings;

	// Group by rule, blocking rules first, then by rank within the module's order.
	const byRule = new Map();
	for (const f of shown) {
		if (!byRule.has(f.rule)) byRule.set(f.rule, []);
		byRule.get(f.rule).push(f);
	}
	const order = [...byRule.keys()].sort((a, b) => {
		const ba = RULES[a]?.block ? 0 : 1;
		const bb = RULES[b]?.block ? 0 : 1;
		return ba - bb || a.localeCompare(b);
	});
	for (const rule of order) {
		const group = byRule.get(rule);
		const mark = RULES[rule]?.block ? '✗' : '⚠';
		note(`\n${mark} ${rule} [${RULES[rule]?.block ? 'blocking' : 'advisory'}] × ${group.length} — ${RULES[rule]?.title}`);
		for (const f of group) note(`    ${f.file}:${f.line}  ${f.message}`);
	}
	const blk = findings.filter((f) => RULES[f.rule]?.block).length;
	const adv = findings.length - blk;
	if (filter) {
		const hiddenBlk = findings.filter((f) => RULES[f.rule]?.block && !filter.has(f.rule)).length;
		note(`\n· css-hygiene: showing ${shown.length}/${findings.length} (filter ${[...filter].join(',')}); ${blk} blocking, ${adv} advisory total.` +
			(hiddenBlk ? ` ⚠ ${hiddenBlk} blocking finding(s) hidden by the filter.` : ''));
	} else {
		note(`\n· css-hygiene: ${blk} blocking, ${adv} advisory. Justify a needed exception inline: \`wpds-allow <ruleId> -- <reason>\`.`);
	}
	return !blocking;
}

// ── test (fast unit suites only) ───────────────────────────────────────────────
function runUnit(label, bin, args, cwd) {
	if (!existsSync(bin)) {
		note(`⚠ test(${label}): dependencies missing — run \`npm run setup\`; skipped.`);
		return true;
	}
	out(`▸ test(${label})…`);
	const r = spawnSync(bin, args, { cwd, encoding: 'utf8', stdio: 'inherit' });
	if (r.error || r.signal || r.status === null) {
		note(`✗ test(${label}): could not run (${spawnFailure(r)}).`);
		return false;
	}
	if (r.status === 0) return true;
	note(`✗ test(${label}) failed.`);
	return false;
}

/**
 * Capability-probe a plugin's available unit suites. Config-driven so wiring up
 * an extension's tests never requires editing this file: PHP needs a
 * phpunit.xml.dist + installed phpunit (run via its `unit` suite); JS needs a
 * `test:unit:js` package script + installed wp-scripts.
 * @param want  {php, js} — which file types changed (so we only run relevant suites).
 */
function pluginUnitSuites(plugin, want) {
	const dir = join(ROOT, plugin);
	const suites = [];
	const phpunit = join(dir, 'vendor', 'bin', 'phpunit');
	if (want.php && existsSync(join(dir, 'phpunit.xml.dist')) && existsSync(phpunit)) {
		suites.push({ label: `${plugin} php`, bin: phpunit, args: ['--testsuite', 'unit'], cwd: dir });
	}
	if (want.js && jsonHasScript(join(dir, 'package.json'), 'test:unit:js') && existsSync(wpScripts(plugin))) {
		suites.push({ label: `${plugin} js`, bin: wpScripts(plugin), args: ['test-unit-js'], cwd: dir });
	}
	return suites;
}

/**
 * @param mode  'all' — every plugin; 'list' — plugins touched by `files`.
 */
function test(mode, files) {
	// plugin -> which file types changed (controls which suites run).
	const want = new Map();
	if (mode === 'all') {
		for (const p of PLUGINS) want.set(p, { php: true, js: true });
	} else {
		for (const f of files.filter((x) => owner(x))) {
			const o = owner(f);
			const e = extname(f).toLowerCase();
			const t = want.get(o) ?? { php: false, js: false };
			if (PHP_EXT.has(e)) t.php = true;
			if (JS_EXT.has(e) || CSS_EXT.has(e)) t.js = true;
			want.set(o, t);
		}
	}

	if (!want.size) {
		out('✓ test: no changed plugins.');
		return true;
	}

	let ok = true;
	let ranAny = false;
	for (const [p, t] of want) {
		const suites = pluginUnitSuites(p, t);
		if (!suites.length) {
			note(`· test(${p}): no matching unit suite — skipped.`);
			continue;
		}
		for (const s of suites) {
			ranAny = true;
			ok = runUnit(s.label, s.bin, s.args, s.cwd) && ok;
		}
	}
	if (ok && !ranAny) out('✓ test: nothing to run.');
	return ok;
}

// ── fix (format-only autofixers) ───────────────────────────────────────────────
// Runs the mechanical fixers — phpcbf, eslint --fix, stylelint --fix — over the
// scope. It MUTATES files, so it's a separate verb from the read-only gate and
// never fails on findings (only on a fixer that couldn't run). The CSS-hygiene
// rules are intentionally NOT auto-fixed: R2 (token choice), R3–R8 (JSX/layout
// refactors) and R6 are judgement calls, not formatting.
function runPhpcbf(standard, targets, label) {
	if (!targets.length) return;
	if (!existsSync(PHPCBF)) {
		note(`⚠ fix(${label}): phpcbf not installed — run \`npm run setup\`; skipped.`);
		return;
	}
	out(`▸ phpcbf(${label})…`);
	const r = spawnSync(PHPCBF, [`--standard=${standard}`, `--basepath=${ROOT}`, ...targets], {
		cwd: ROOT,
		encoding: 'utf8',
	});
	// phpcbf exit codes: 0 nothing to fix · 1 fixed some · 2 some unfixable remain.
	// All three mean "it ran"; only a spawn error is a real failure.
	if (r.error || r.signal) {
		note(`✗ phpcbf(${label}): could not run (${spawnFailure(r)}).`);
		return;
	}
	const summary = (r.stdout || '').trim();
	if (summary) note(summary);
}

function runWpScriptsFix(plugin, cmd, files, label) {
	if (!hasJsToolchain(plugin)) return; // pure-PHP plugin — nothing to fix
	const bin = wpScripts(plugin);
	if (!existsSync(bin)) {
		note(`⚠ fix ${label} (${plugin}): wp-scripts not installed — run \`npm run setup\`; skipped.`);
		return;
	}
	const rel = files.map((f) => relative(join(ROOT, plugin), join(ROOT, f)));
	out(`▸ ${label} --fix (${plugin})…`);
	const r = spawnSync(bin, [cmd, '--fix', ...rel], { cwd: join(ROOT, plugin), encoding: 'utf8' });
	// A non-zero exit just means unfixable problems remain — expected for a fixer.
	if (r.error || r.signal) note(`✗ ${label} --fix (${plugin}): could not run (${spawnFailure(r)}).`);
}

function fix(mode, files) {
	if (mode === 'all') {
		for (const p of PLUGINS) {
			if (!existsSync(join(ROOT, p))) continue;
			runPhpcbf(phpcsStandardFor(p), [p], p);
			runWpScriptsFix(p, 'lint-js', [], 'lint-js');
			runWpScriptsFix(p, 'lint-style', [], 'lint-style');
		}
	} else {
		const fixable = files.filter((f) => owner(f));
		if (!fixable.length) {
			out('✓ fix: nothing to fix.');
			return true;
		}
		const phpByPlugin = {};
		const js = {};
		const css = {};
		for (const f of fixable) {
			const o = owner(f);
			const e = extname(f).toLowerCase();
			if (PHP_EXT.has(e)) {
				if (isExcludedPhpTestPath(f)) continue;
				(phpByPlugin[o] ??= []).push(f);
			} else if (JS_EXT.has(e)) {
				(js[o] ??= []).push(f);
			} else if (CSS_EXT.has(e)) {
				(css[o] ??= []).push(f);
			}
		}
		for (const [p, fs] of Object.entries(phpByPlugin)) runPhpcbf(phpcsStandardFor(p), fs, p);
		for (const [p, fs] of Object.entries(js)) runWpScriptsFix(p, 'lint-js', fs, 'lint-js');
		for (const [p, fs] of Object.entries(css)) runWpScriptsFix(p, 'lint-style', fs, 'lint-style');
	}
	out('✓ fix: ran the available formatters. Re-run `lint` to see what remains (hygiene rules are not auto-fixed).');
	return true;
}

// ── JSON report (agent-friendly, structured, no ANSI/prose) ────────────────────
// phpcs findings via its own --report=json, one run per plugin (standards differ),
// flattened. JS/CSS advisory lint is not included (a separate, noisy backlog).
function phpcsJson(mode, files) {
	if (!existsSync(PHPCS)) return [];
	const acc = [];
	const runFor = (standard, targets) => {
		if (!targets.length) return;
		const r = spawnSync(PHPCS, [...PHPCS_BASE_ARGS, `--standard=${standard}`, '--report=json', ...targets], {
			cwd: ROOT,
			encoding: 'utf8',
			maxBuffer: 1 << 27,
		});
		// Slice from the first `{` so phpcs's deprecation preamble can't break parse.
		const raw = r.stdout || '';
		const start = raw.indexOf('{');
		let parsed;
		try {
			parsed = JSON.parse(start >= 0 ? raw.slice(start) : raw);
		} catch {
			return;
		}
		for (const [file, data] of Object.entries(parsed.files || {})) {
			for (const m of data.messages || []) {
				acc.push({
					source: 'phpcs',
					rule: m.source,
					type: (m.type || '').toLowerCase(),
					fixable: Boolean(m.fixable),
					file: file.replace(`${ROOT}/`, ''),
					line: m.line,
					detail: m.message,
				});
			}
		}
	};
	if (mode === 'all') {
		for (const p of PLUGINS) if (existsSync(join(ROOT, p))) runFor(phpcsStandardFor(p), [p]);
	} else {
		const byP = {};
		for (const f of files.filter((x) => owner(x))) {
			if (PHP_EXT.has(extname(f).toLowerCase()) && !isExcludedPhpTestPath(f)) (byP[owner(f)] ??= []).push(f);
		}
		for (const [p, fs] of Object.entries(byP)) runFor(phpcsStandardFor(p), fs);
	}
	return acc;
}

function buildJson(mode, files, ruleFilter) {
	let hygiene = [];
	try {
		const res = runCssHygiene({ root: ROOT, plugins: PLUGINS, mode, files });
		hygiene = res.findings.map((f) => ({
			source: 'css-hygiene',
			rule: f.rule,
			blocking: Boolean(RULES[f.rule]?.block),
			guidance: RULES[f.rule]?.title,
			file: f.file,
			line: f.line,
			detail: f.message,
		}));
		if (ruleFilter?.length) {
			const s = new Set(ruleFilter);
			hygiene = hygiene.filter((h) => s.has(h.rule));
		}
	} catch (e) {
		note(`⚠ css-hygiene (json): could not run (${e.message}).`);
	}
	return { hygiene, php: phpcsJson(mode, files) };
}

// ── entrypoint ─────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);

// `suppressions` — print the grep-able registry of every honored `wpds-allow`
// (file:line · rule · reason). The audit trail for sanctioned departures.
if (cmd === 'suppressions') {
	const list = listSuppressions({ root: ROOT, plugins: PLUGINS });
	if (!list.length) out('· no wpds-allow suppressions in the tree.');
	for (const d of list) out(`${d.file}:${d.line}  ${d.rules.join(',')}  — ${d.reason}`);
	process.exit(0);
}

const flags = rest.filter((a) => a.startsWith('--'));
const explicit = rest.filter((a) => !a.startsWith('--'));
// 'all' | 'changed' | 'list' (explicit files, no flag). `--all` wins over
// `--changed` no matter the order: the npm scripts bake in a scope flag (e.g.
// `check` → `--changed`), so `npm run check -- --all` arrives as
// `--changed --all` and the broader, explicitly-asked-for scope must take it.
const scope =
	flags.includes('--all') ? 'all' : flags.includes('--changed') ? 'changed' : explicit.length ? 'list' : 'changed';

// Resolve the file set ONCE, so `check` doesn't spawn git twice and both halves
// see the same set.
const mode = scope === 'all' ? 'all' : 'list';
let files = [];
if (scope === 'changed') files = gitChangedFiles();
else if (scope === 'list') files = explicit.map(toRel);

// Loudly surface any change to the gate's own rules — weakening a linter to pass
// is legitimate sometimes, but it must never be silent. Not blocking; just seen.
const RULE_FILES = /^(tools\/code-quality\/|.*\.phpcs\.xml\.dist$|.*\.eslintrc|.*\.stylelintrc)/;
const touchedRules = files.filter((f) => RULE_FILES.test(f.split('\\').join('/')));
if (touchedRules.length) {
	note('⚠ gate rules modified — human review required:');
	for (const f of touchedRules) note(`    ${f}`);
}

// --rule=R4 / --rules=R4,R6 → narrow the hygiene DISPLAY to those rule ids.
const ruleFlag = flags.find((f) => f.startsWith('--rule=') || f.startsWith('--rules='));
const ruleFilter = ruleFlag
	? ruleFlag.split('=')[1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
	: null;

// --json → emit a structured findings payload (hygiene + phpcs) and nothing else
// on stdout. For agents consuming findings programmatically.
if (flags.includes('--json')) {
	const payload = buildJson(mode, files, ruleFilter);
	out(JSON.stringify(payload, null, 2));
	const blocking = payload.hygiene.some((h) => h.blocking) || payload.php.some((p) => p.type === 'error');
	process.exit(blocking ? 1 : 0);
}

let ok = true;
switch (cmd) {
	case 'lint':
		ok = lint(mode, files, ruleFilter);
		break;
	case 'test':
		ok = test(mode, files);
		break;
	case 'check':
		ok = lint(mode, files, ruleFilter);
		ok = test(mode, files) && ok;
		break;
	case 'fix':
		ok = fix(mode, files);
		break;
	default:
		note('usage: quality.mjs <lint|test|check|fix|suppressions> [--changed|--all|<file>...] [--rule=R4] [--json]');
		process.exit(2);
}
process.exit(ok ? 0 : 1);
