# AGENTS.md — VIP Workflow

## Repository overview

VIP Workflow is a monorepo containing the core WordPress plugin in `vip-workflow/` and standalone extension plugins in the top-level `workflow-*` directories.

Start with:

- `docs/README.md` for the documentation map.
- `docs/AI_CONTEXT.md` and `docs/reference/` for architecture and subsystem references.
- `docs/guides/extending-vip-workflow.md` for extension patterns.
- `vip-workflow/docs/TESTING.md` for the test strategy.

## Commands

From the repository root:

```bash
npm run setup
npm run build
npm run check:all
npm run test:php:integration
```

From `vip-workflow/`:

```bash
composer test
npm run lint:js
npm run test:unit:js
npm run test:e2e
vendor/bin/phpcbf <file>
```

## Architecture

- Work items are WordPress posts. Domain objects use custom post types; relationship-heavy data uses dedicated tables.
- Workflow stage is stored in `_vip_workflow_current_stage_key`, never in `post_status`. WordPress owns publishing status; each sequence stage declares its core status region.
- JSON sequence configurations define stages, transitions, required tools, permissions, assignment requirements, and transition inputs. Never hardcode an editorial workflow.
- Subsystems implement `ModuleInterface`. Core services initialize first; extensions register through `vip_workflow_register_modules` and the documented registries and hooks.
- Tools and agents register through the WordPress Abilities API. Shared integrations belong in `vip-workflow/includes/integrations/`.
- Top-level `workflow-*` directories are real, independently activatable plugins that depend on VIP Workflow.

## Development rules

- Read the relevant implementation, imports, and tests before editing.
- Missing required data is a data-integrity error. Do not add silent fallbacks, runtime repairs, or legacy compatibility paths.
- Keep feature-specific code with its feature and reusable code in `includes/integrations/`.
- Use WordPress coding standards, long-form `array()` syntax in PHP, sanitization on input, escaping on output, capability checks, and nonce verification where applicable.
- Run `phpcbf` on changed PHP files before committing.
- Do not edit generated files under `vip-workflow/build/`.
- Do not place private issue identifiers or internal process references in source, comments, documentation, or changelogs.
- Do not destroy, clean, or recreate the project's wp-env/Docker databases or volumes without explicit approval.
