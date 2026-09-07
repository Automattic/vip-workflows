#!/usr/bin/env node
/**
 * run-integration-suites.mjs — run every plugin's PHPUnit integration suite.
 *
 * Which plugins run is discovered, not listed: a plugin whose PHPUnit config
 * declares an `integration` suite is picked up on the next run. Wiring one up
 * used to mean editing a workflow step, a composer loop, two duplicated path
 * filters and a pair of npm scripts — and forgetting any of them meant the
 * tests silently never ran.
 *
 * All suites share one wp-env instance. Per-plugin isolation lives in each
 * plugin's own bootstrap (see workflow-parsely/tests/bootstrap.php), and
 * starting an environment per plugin would pay the image build — most of the
 * job's wall clock — once per plugin for isolation the suites do not need.
 *
 * Usage:
 *   node scripts/run-integration-suites.mjs           run every discovered suite
 *   node scripts/run-integration-suites.mjs --list     print them and exit
 *
 * Exit codes:
 *   0  every suite passed.
 *   1  a suite failed, or a discovered plugin is not mounted in wp-env.
 *   2  nothing was discovered — treated as a failure, never a silent pass.
 *
 * Requires the tests environment to be running: npm run wp-env:start:tests
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountedInWpEnv, withIntegrationSuite } from '../tools/code-quality/plugins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = '.wp-env.tests.json';
const DB = 'wordpress_test';

const out = (m) => process.stdout.write(`${m}\n`);
const banner = (m) => process.stdout.write(`\n──────── ${m} ────────\n`);

function wpEnv(args) {
	return spawnSync('npx', ['wp-env', ...args], { cwd: ROOT, stdio: 'inherit' });
}

const suites = withIntegrationSuite(ROOT);

if (process.argv.includes('--list')) {
	suites.forEach(out);
	process.exit(0);
}

// An empty run must not read as success. Discovery returning nothing means the
// probe is wrong or the checkout is broken — either way the suite did not run,
// and reporting that as a pass is how a green board stops meaning anything.
if (suites.length === 0) {
	process.stderr.write(
		'No plugin declares an `integration` PHPUnit suite. Expected at least vip-workflows.\n'
	);
	process.exit(2);
}

/*
 * A plugin can have a suite and still be unrunnable: .wp-env.json is what maps
 * a directory into wp-content/plugins, and it stays hand-maintained. Checked up
 * front so the failure names the plugin and the file, rather than surfacing as
 * an --env-cwd path error that names neither.
 */
const mounted = mountedInWpEnv(ROOT);
const unmounted = suites.filter((p) => !mounted.includes(p));

if (unmounted.length > 0) {
	process.stderr.write(
		`These plugins declare an integration suite but are not mounted by wp-env: ${unmounted.join(', ')}\n` +
			`Add each as "./<plugin>" to the "plugins" array in .wp-env.json, then re-run.\n`
	);
	process.exit(1);
}

out(`Running integration suites: ${suites.join(', ')}`);

// Once, not per plugin: the bootstrap refuses any database whose name lacks
// "test", and every suite shares this one.
const db = wpEnv(['run', 'cli', '--config', CONFIG, 'wp', 'db', 'query', `CREATE DATABASE IF NOT EXISTS ${DB}`]);
if (db.status !== 0) {
	process.stderr.write(`Could not create the ${DB} database.\n`);
	process.exit(1);
}

// Keep going after a failure and report every result, so one plugin's red does
// not hide another's — the reason phpcs.yml sets fail-fast: false.
const failed = [];

for (const plugin of suites) {
	banner(plugin);

	const result = wpEnv([
		'run',
		'cli',
		'--config',
		CONFIG,
		`--env-cwd=wp-content/plugins/${plugin}`,
		'bash',
		'-c',
		`WORDPRESS_DB_NAME=${DB} ./vendor/bin/phpunit --testsuite integration`,
	]);

	if (result.status !== 0) failed.push(plugin);
}

if (failed.length > 0) {
	process.stderr.write(`\nIntegration suites failed: ${failed.join(', ')}\n`);
	process.exit(1);
}

out(`\nAll integration suites passed: ${suites.join(', ')}`);
