# Testing VIP Workflow

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

Targeted commands for the core plugin:

```bash
cd vip-workflow
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
npm run wp-env:start:tests
npm --prefix vip-workflow run test:e2e
npm run wp-env:stop:tests
```

Use `npm --prefix vip-workflow run test:e2e:headed` for a visible browser. Failures write traces and screenshots under `vip-workflow/artifacts/`.

Tests should arrange fixtures over REST, exercise behavior through the UI, assert both UI and persisted state where useful, and delete records they create. Prefer stable class or `data-*` hooks over translated text and DOM structure.

## GitHub Actions

Public GitHub-hosted runners execute:

| Workflow | Coverage |
| --- | --- |
| `phpcs.yml` | PHP coding standards for core and Parse.ly integration |
| `js-unit.yml` | Package discovery tests, JavaScript/CSS lint, and Jest |
| `phpunit.yml` | Unit suite on PHP 8.2, 8.3, 8.4, and 8.5 |
| `phpunit-integration.yml` | Real-WordPress integration suites in wp-env |
| `e2e.yml` | Production builds and Playwright browser tests |

The integration and end-to-end workflows always stop their tests environment with an `if: always()` teardown step.
