/**
 * plugins.mjs — what plugins this monorepo has, and what each one can run.
 *
 * Every tool that needs "the list of plugins" reads it from here rather than
 * carrying its own copy. A hand-maintained list is the failure this module
 * exists to remove: a plugin that grows a test suite but is missing from one
 * list somewhere simply never runs, with nothing failing to say so.
 *
 * The probes are capability questions, not name lookups, so a plugin lights up
 * the moment it has the files — no edit here required.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The core plugin. Always first; every extension depends on it. */
export const CORE = 'vip-workflows';

/**
 * Every plugin directory in the monorepo: core, then `workflow-*` sorted.
 *
 * Directory-name based rather than config-driven, because a plugin's directory
 * is the one thing it cannot lack.
 */
export function plugins(root) {
	const dirs = readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory() && e.name.startsWith('workflow-'))
		.map((e) => e.name);
	return [CORE, ...dirs.sort()];
}

/**
 * The plugin's PHPUnit config, whichever name it uses.
 *
 * vip-workflows ships phpunit.xml.dist, workflow-parsely ships phpunit.xml. Both
 * are legitimate; a probe that knows only one silently skips the other.
 */
export function phpunitConfig(root, plugin) {
	for (const name of ['phpunit.xml.dist', 'phpunit.xml']) {
		const path = join(root, plugin, name);
		if (existsSync(path)) return path;
	}
	return null;
}

/**
 * Plugins that need `composer install` before anything can run.
 *
 * Deliberately a different question from withIntegrationSuite(): install has to
 * happen before vendor/bin/phpunit exists, so a probe that asked for the binary
 * would skip every plugin on its first ever run.
 */
export function withComposer(root) {
	return plugins(root).filter((p) => existsSync(join(root, p, 'composer.json')));
}

/**
 * Plugins whose PHPUnit config declares an `integration` test suite.
 *
 * Read from the config rather than inferred from a tests/ directory: a plugin
 * can have tests and no integration suite, and running `--testsuite integration`
 * against it fails in a way that looks like a broken suite rather than a
 * mis-selected one.
 *
 * Matched with a regex rather than parsed — the repo has no XML dependency at
 * the root, and "does this file declare a suite by this name" does not need a
 * tree. Tolerates either quote style and arbitrary attribute spacing.
 */
export function withIntegrationSuite(root) {
	return plugins(root).filter((plugin) => {
		const config = phpunitConfig(root, plugin);
		if (!config) return false;
		return /<testsuite\s+name=["']integration["']/i.test(readFileSync(config, 'utf8'));
	});
}

/**
 * Plugins wp-env mounts into wp-content/plugins.
 *
 * Local directories appear as `./plugin-name`; the external zips in that array
 * are ignored. This list is still hand-maintained, which is why callers check
 * against it rather than assuming a discovered plugin is runnable.
 */
export function mountedInWpEnv(root) {
	const path = join(root, '.wp-env.json');
	if (!existsSync(path)) return [];

	const entries = JSON.parse(readFileSync(path, 'utf8')).plugins ?? [];
	return entries
		.filter((entry) => typeof entry === 'string' && entry.startsWith('./'))
		.map((entry) => entry.slice(2));
}
