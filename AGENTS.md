# AGENTS.md — VIP Workflows

## Repository overview

VIP Workflows is a monorepo containing the core WordPress plugin in `vip-workflows/` and standalone extension plugins in the top-level `workflow-*` directories.

Start with:

- `docs/README.md` for the documentation map.
- `docs/AI_CONTEXT.md` and `docs/reference/` for architecture and subsystem references.
- `docs/guides/extending-vip-workflows.md` for extension patterns.
- `vip-workflows/docs/TESTING.md` for the test strategy.

## Commands

From the repository root:

```bash
npm run setup
npm run build
npm run check:all
npm run test:php:integration
```

From `vip-workflows/`:

```bash
composer test
npm run lint:js
npm run test:unit:js
npm run test:e2e
vendor/bin/phpcbf <file>
```

## Pull request previews

Every pull request gets a **Preview in WordPress Playground** button in its description. CI builds the core plugin from the PR, so reviewers do not need a local build.

- `PR Preview - Build` (`.github/workflows/pr-preview-build.yml`) packages `vip-workflows` with `tools/package-plugin.sh` and generates the blueprint from `.playground/blueprint.json`.
- `PR Preview - Publish` (`.github/workflows/pr-preview-publish.yml`) uploads the zip to the public `ci-artifacts` prerelease and adds the button. It runs from `main`, so edits to it take effect only after merge.
- The preview logs in as `admin` / `password`. The `editor`, `author`, and `contributor` users also use `password`, for role-specific testing. Demo posts come from `tools/vip-workflows-content.xml`, with dates shifted into the current month.

When opening a PR:

1. Wait for **PR Preview - Publish** to finish (`gh run watch`, or check the PR body for the `wp-playground-preview:start` marker). A missing button means the build failed; fix it before asking for review.
2. In **How to test**, tell the reviewer where to click in the preview and what they should see.
3. If the change needs specific data to reproduce, add it to `.playground/blueprint.json` or the WXR fixture in the same PR. The preview uses the PR's own blueprint. `{{REPO_WXR:<path>}}` inlines a repository WXR file at build time; `{{ARTIFACT_URL:vip-workflows}}` is filled in at publish time.

To check blueprint changes locally, run `node --test tools/playground/` and boot the preview as described in `PLAYGROUND.md`.

## Architecture

- Work items are WordPress posts. Domain objects use custom post types; relationship-heavy data uses dedicated tables.
- Workflow stage is stored in `_vip_workflows_current_stage_key`, never in `post_status`. WordPress owns publishing status; each sequence stage declares its core status region.
- JSON sequence configurations define stages, transitions, required tools, permissions, and transition inputs (including assignments). Never hardcode an editorial workflow.
- Subsystems implement `ModuleInterface`. Core services initialize first; extensions register through `vip_workflows_register_modules` and the documented registries and hooks.
- Tools and agents register through the WordPress Abilities API. Shared integrations belong in `vip-workflows/includes/integrations/`.
- Top-level `workflow-*` directories are real, independently activatable plugins that depend on VIP Workflows.

## Development rules

- Read the relevant implementation, imports, and tests before editing.
- Missing required data is a data-integrity error. Do not add silent fallbacks, runtime repairs, or legacy compatibility paths.
- Keep feature-specific code with its feature and reusable code in `includes/integrations/`.
- Use WordPress coding standards, long-form `array()` syntax in PHP, sanitization on input, escaping on output, capability checks, and nonce verification where applicable.
- Run `phpcbf` on changed PHP files before committing.
- Do not edit generated files under `vip-workflows/build/`.
- Do not place private issue identifiers or internal process references in source, comments, documentation, or changelogs.
- Do not destroy, clean, or recreate the project's wp-env/Docker databases or volumes without explicit approval.
