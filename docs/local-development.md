# Local development

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- npm
- PHP 8.2 or newer
- Composer 2
- Docker Desktop or another Docker-compatible runtime for wp-env

## Setup

```bash
git clone https://github.com/Automattic/vip-workflows.git
cd vip-workflows
npm run setup
npm run build
```

`npm run setup` installs the root tooling, each JavaScript package, and Composer dependencies for the PHP packages.

## WordPress environment

Start the development environment from the repository root:

```bash
npm run wp-env:start
```

WordPress is available at <http://localhost:8888>. wp-env uses the standard local credentials `admin` / `password`.

For watch mode:

```bash
npm run watch
```

The test environment is separate from the development environment and listens on port 8889. Use the commands documented in [Testing](../vip-workflows/docs/TESTING.md); do not point integration tests at the development database.

## Quality checks

```bash
npm run check:all
npm run test:php:integration
```

Run `vip-workflows/vendor/bin/phpcbf` on changed PHP files before committing.
