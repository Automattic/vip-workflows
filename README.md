# VIP Workflow

[![PHPCS](https://github.com/Automattic/vip-workflows/actions/workflows/phpcs.yml/badge.svg)](https://github.com/Automattic/vip-workflows/actions/workflows/phpcs.yml)
[![JavaScript](https://github.com/Automattic/vip-workflows/actions/workflows/js-unit.yml/badge.svg)](https://github.com/Automattic/vip-workflows/actions/workflows/js-unit.yml)
[![PHPUnit](https://github.com/Automattic/vip-workflows/actions/workflows/phpunit.yml/badge.svg)](https://github.com/Automattic/vip-workflows/actions/workflows/phpunit.yml)

VIP Workflow is a workflow-orchestration platform for WordPress. It gives editorial teams sequence-driven stages, governed transitions, assignments, AI-assisted tools and agents, story ideation, discovery providers, and notifications.

## Requirements

- WordPress 7.0 or newer
- PHP 8.2 or newer
- Node.js 22 and Composer 2 for development
- Docker for the wp-env integration and end-to-end test environments

## Installation

This repository is source code and does not include generated JavaScript bundles or Composer's `vendor/` directory.

```bash
git clone https://github.com/Automattic/vip-workflows.git
cd vip-workflows
npm run setup
npm run build
```

Mount or copy `vip-workflow/` into `wp-content/plugins/`, then activate **VIP Workflow**. The `workflow-*` directories are standalone extension plugins and can be installed independently after the core plugin is active.

For the complete local setup, see [Local development](docs/local-development.md).

## Core capabilities

- **Editorial sequences** define stages, transitions, required tools, role permissions, assignment requirements, inputs, and notifications in JSON.
- **WordPress-native publishing state** keeps workflow stage in post meta while WordPress continues to own `post_status`; stages declare the core status region they occupy.
- **Story ideation** combines seed-first research, pluggable assistants, media discovery, source pinning, and draft creation.
- **Tools and agents** use the WordPress Abilities API for editor-invoked checks and automated AI-owned stages.
- **Events and automation** record workflow activity and dispatch configured actions, notifications, and recurring jobs.
- **Extensibility** supports custom tools, agents, discovery providers, notification channels, modules, and REST integrations.

## Included extensions

| Plugin | Demonstrates |
| --- | --- |
| `workflow-tool-checklist` | Configurable editorial checklist and editor UI |
| `workflow-assistant-wikipedia` | Research assistant backed by Wikipedia |
| `workflow-agent-copy-edit` | AI-owned copy-editing stage |
| `workflow-agent-tag-sanity-check` | AI-owned tag review stage |
| `workflow-parsely` | Parse.ly abilities, agents, and discovery integration |

See [Extending VIP Workflow](docs/guides/extending-vip-workflow.md) for the supported extension points.

## Development

From the repository root:

```bash
npm run setup
npm run build
npm run check:all
```

The full test strategy, including the isolated integration database and Playwright environment, is documented in [Testing](vip-workflow/docs/TESTING.md).

GitHub Actions runs PHPCS, JavaScript lint and unit tests, PHPUnit on PHP 8.2–8.5, real-WordPress integration tests, and Playwright end-to-end tests.

## Documentation

- [Documentation map](docs/README.md)
- [Architecture reference](docs/reference/architecture.md)
- [Database schema](docs/reference/database-schema.md)
- [Extension points](docs/reference/extension-points.md)
- [Shipped feature specifications](docs/specs/README.md)
- [WordPress Playground](PLAYGROUND.md)

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report security issues through the process in [SECURITY.md](SECURITY.md), not through a public issue.

VIP Workflow is licensed under the [GNU General Public License v2](LICENSE).
