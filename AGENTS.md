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

Every pull request from a branch in this repository gets a **Preview in WordPress Playground** button in its description. CI builds the core plugin from the PR, so reviewers do not need a local build. Fork pull requests are built but not published.

- `PR Preview - Build` (`.github/workflows/pr-preview-build.yml`) runs `tools/playground/build-preview.sh`, which packages `vip-workflows` with `tools/package-plugin.sh`, zips the demo content, and validates `.playground/blueprint.json`.
- `PR Preview - Publish` (`.github/workflows/pr-preview-publish.yml`) uploads the zips to the public `ci-artifacts` prerelease and adds the button. It runs from `main` as a `workflow_run`, so it does not appear in `gh pr checks`, and edits to it take effect only after merge. `PR Preview - Cleanup` deletes a PR's zips when it closes.
- The preview logs in as `admin` / `password`. The `editor`, `author`, and `contributor` users also use `password`, for role-specific testing. Demo posts come from `tools/vip-workflows-content.xml`. When the preview boots, `tools/playground/shift-wxr-dates.php` moves their dates by whole days so the newest post is dated today; wp-env applies the same shift.

When opening a PR:

1. Wait for **PR Preview - Build** with `gh pr checks <number> --watch`; if it fails, fix it. Then confirm the Preview button is for the head commit, because a failed or skipped publish leaves the previous commit's button in place:

   ```bash
   sha="$(gh pr view <number> --json headRefOid --jq .headRefOid)"
   gh pr view <number> --json body --jq .body | grep -q "$sha" && echo current
   ```

   If the build passed but the button is missing or stale after a few minutes, check `gh run list --workflow pr-preview-publish.yml --limit 5`. CI only checks that the blueprint is valid JSON with known tokens; it does not boot it, so open the preview once yourself before asking for review.
2. In **How to test**, tell the reviewer where to click in the preview and what they should see. Editing the description outside the `wp-playground-preview` block keeps the button; replacing the whole body re-runs the build, which restores it.
3. If the change needs specific data to reproduce, add it to `.playground/blueprint.json` or the WXR fixture in the same PR. The preview uses the PR's own blueprint. Posts by `editor`, `author`, or `contributor` (`dc:creator`) are assigned to those users. `{{ARTIFACT_URL:<name>}}` is filled in at publish time and must name a zip listed in `ARTIFACTS` in `build-preview.sh` and in the build workflow's `artifacts`. The blueprint cannot contain `#` or `%`, because the Preview button's `data:` URL breaks on them.

To check blueprint changes locally, run `npm run test:tools` and boot the preview with `tools/playground/serve-preview.sh` (see `PLAYGROUND.md`).

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
