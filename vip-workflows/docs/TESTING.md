# Testing VIP Workflows

The repository has four test layers. Run commands from the repository root unless noted.

## Install dependencies

```bash
npm run setup
```

## Static analysis and unit tests

Run every package's configured linters and unit tests:

```bash
npm run check:all
```

Its design-system section needs loupe, which `npm run setup` does not install. Claude Code offers it from the repo's `.claude/settings.json`; see [`tools/code-quality/README.md`](../../tools/code-quality/README.md#in-claude-code).

Targeted commands for the core plugin:

```bash
cd vip-workflows
composer cs
composer test:unit
npm run lint:js
npm run lint:css
npm run test:unit:js
```

PHP unit tests use Brain\Monkey and small WordPress value-object doubles. They do not boot WordPress or access a database. The php-ai-client double in `tests/phpunit/stubs/ai-client.php` is loaded only for unit tests; integration tests use WordPress core's real AI client.

## PHP integration tests

Integration tests boot real WordPress and use a dedicated `wordpress_test` database in the isolated tests environment:

```bash
npm run wp-env:start:tests
npm run test:php:integration
npm run wp-env:stop:tests
```

`scripts/run-integration-suites.mjs` discovers every mounted plugin whose PHPUnit configuration declares an `integration` suite and runs each one. The bootstrap refuses to run when the database name does not contain `test`; never invoke the integration suite against the development environment's `wordpress` database.

`.wp-env.tests.json` is generated from `.wp-env.json` by `scripts/gen-wp-env-tests.js`. Edit the source configuration and run:

```bash
npm run lint:wp-env-config
```

## End-to-end tests

Playwright tests drive the WordPress editor and admin UI through `@wordpress/e2e-test-utils-playwright`:

```bash
npm --prefix vip-workflows run test:e2e
npm run wp-env:stop:tests
```

Locally, Playwright's `webServer` (`tools/wp-env-e2e-webserver.sh`) runs `npm run wp-env:start:tests` before every run, which starts the tests environment and then seeds it. Playwright waits for the line `VIP Workflows e2e environment ready`, which the script prints only after the seed succeeds, so the global setup and the specs never run against a half-seeded environment. The command runs even when the environment is already up: starting a running environment is a no-op, and the seed is idempotent. Expect a few extra seconds per run for the seed. Starting the environment yourself first is optional. In CI (`CI` set), the workflow runs `npm run wp-env:start:tests` itself and Playwright does not start or seed anything.

Use `npm --prefix vip-workflows run test:e2e:headed` for a visible browser. Failures write traces and screenshots under `vip-workflows/artifacts/`.

Tests should arrange fixtures over REST, exercise behavior through the UI, assert both UI and persisted state where useful, and delete records they create. Prefer stable class or `data-*` hooks over translated text and DOM structure.

### Seeded fixtures

Specs create their own posts and throwaway sequences, but they assume the tests environment already has:

- VIP Workflows active, with its database schema installed. The REST routes under `vip-workflows/v1` exist only then.
- The default data that plugin activation seeds: the workflow roles and the **Editorial Review** sequence (slug `editorial-review`, post type `post`).
- The `admin` / `password` user that wp-env creates.
- Built assets in `vip-workflows/build/`. The UI specs need them for the editor sidebar and admin screens.

The development environment gets extra setup from `tools/wp-env-after-start.sh`: a theme, permalinks, and imported demo content. The tests environment does not run that script, and the specs do not depend on any of it. The tests environment gets its plugin state from `tools/wp-env-seed-tests.sh` instead. That script runs automatically after `npm run wp-env:start:tests`, so it runs before every local Playwright run and once in CI. It is additive and idempotent: it activates the plugin, runs the activation path (schema install and seeder), and checks the result. It never resets or recreates data.

### When every spec fails

**Symptom:** many specs fail at once, or a whole file fails, including the REST-contract specs that never open the UI (for example `metadata-feature.spec.js`, "editorial metadata (REST contract)"). If a spec that only calls the REST API fails, the spec is almost never the problem. The tests environment is empty or incomplete.

The e2e global setup (`tests/e2e/global-setup.js`) checks for this before any spec runs. It stops the run with `VIP Workflows e2e preflight failed for <url>` and names what is missing:

- `build/editor.asset.php does not exist`: run `npm run build` from the repository root.
- `the vip-workflows/v1 REST routes are not registered` or `the seeded "editorial-review" sequence does not exist`: reseed the tests environment.
- `the seeded "editorial-review" sequence could not be read (<code>)`: the request failed for another reason, such as authentication or a PHP fatal error. Reseeding does not fix it; check the site and the error code.

To reseed a running tests environment, from the repository root:

```bash
npm run seed:tests
```

The script ends with `Success: Tests environment seeded`. If it reports that a table is missing although `vip_workflows_db_version` is current, the database was partly removed. The schema install skips tables when that option is current, so inspect the database before you do anything else. Do not clean or destroy the environment to fix it without agreement.

Other causes of the same symptom:

- **The suite points at the development environment.** The suite targets the tests environment on `:8889` only. It relies on that environment's `DISABLE_WP_CRON` and blocked egress, and `runDueCron()` in `tests/e2e/helpers/workflow.js` always runs WP-CLI against `.wp-env.tests.json`. Do not set `WP_BASE_URL=http://localhost:8888`. The global setup logs in again on every run and rewrites `artifacts/storage-states/admin.json` for the configured URL, so a stale storage state is not the cause.
- **Port `:8889` serves another checkout.** wp-env names each environment after the directory of its config file. A tests environment started from another worktree can hold the port, and then it serves that worktree's code and build. A local run then stops before any spec, because the `webServer` command cannot start this checkout's environment on a port that is taken. If you start Playwright another way, run `docker ps` and check that the container name matches your checkout before you trust a result.

## GitHub Actions

Public GitHub-hosted runners execute:

| Workflow | Coverage |
| --- | --- |
| `phpcs.yml` | PHP coding standards for core and Parse.ly integration |
| `js-unit.yml` | Package discovery tests, JavaScript/CSS lint, and Jest |
| `phpunit.yml` | Unit suite on PHP 8.3, 8.4, and 8.5 |
| `phpunit-integration.yml` | Real-WordPress integration suites in wp-env |
| `e2e.yml` | Production builds and Playwright browser tests |

The integration and end-to-end workflows always stop their tests environment with an `if: always()` teardown step.
