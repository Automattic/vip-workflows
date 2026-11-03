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

The design-system section of `check:all` runs [loupe](https://github.com/dabowman/loupe), which `npm run setup` does not install; without it that section is skipped with a warning. In Claude Code, the repo's `.claude/settings.json` offers the loupe plugin and turns its write-time hooks on; accept the prompt when you trust the folder. [`tools/code-quality/README.md`](../tools/code-quality/README.md#in-claude-code) covers the hooks and how to run loupe outside Claude Code.

Run `vip-workflows/vendor/bin/phpcbf` on changed PHP files before committing.
