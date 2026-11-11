# AGENTS.md — VIP Workflows

## Repository overview

VIP Workflows is a monorepo containing the core WordPress plugin in `vip-workflows/` and standalone extension plugins in the top-level `workflow-*` directories.

Start with:

- `docs/SPEC.md` for what the product does: user stories, the platform surface, and each feature's invariants and footguns. Keep it current; see [Keeping SPEC.md current](#keeping-specmd-current).
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

## Keeping SPEC.md current

Platform reviewers check PRs against `docs/SPEC.md`, so it has to describe `main`. A PR that changes any of these updates the matching section of SPEC.md in the same PR:

- behavior a user story or a feature's **Always true** list describes,
- stored data: tables, post meta, options, transients, uninstall, migrations,
- REST routes, Abilities and their permission checks,
- capabilities, roles and the bypass lists,
- background work: WP-Cron events and Action Scheduler jobs,
- outbound calls, and what data leaves the site,
- extension points: hooks, filters and registries,
- experiment flags.

**Updating the spec usually means changing it, not adding to it.** Most PRs should edit lines that are already there: correct a claim, tighten a rule, or replace an old sentence with a new one. Some should delete: a removed feature, a footgun that's now fixed, a sentence the change makes redundant. Add a new section only for a new feature or a new piece of platform surface, and look for something to cut when you do. The spec is only useful if a reviewer can read the parts they need in a few minutes.

- Edit the existing sentence rather than adding a new one next to it.
- Add a footgun when the change leaves a sharp edge, and remove it when a later change fixes it.
- Describe what the code does now, not how it got there. History belongs in the PR, never in SPEC.md.
- A fix for a bug SPEC.md never mentioned needs no spec change: the spec already describes the intended behavior, and "this used to be broken" is history. Use the `no-spec-change` label. If the bug was written up as a footgun, remove that footgun instead.
- Leave out detail a reviewer doesn't need to judge a PR. Point to the code, or to `docs/reference/`, instead.

In the PR description, the **Spec changes** section names the SPEC.md sections the PR changes. If it changes nothing SPEC.md describes, such as a refactor, a test, a style fix, or a fix for a bug SPEC.md doesn't mention, write "None:" and the reason, and add the `no-spec-change` label. The **Spec check** workflow (`.github/workflows/spec-check.yml`, logic in `tools/spec-check/`) flags a PR that changes plugin code under `vip-workflows/includes/`, `vip-workflows/src/` or a `workflow-*` extension without touching SPEC.md or carrying that label. It checks paths only; the reviewer checks the content.

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
2. Fill in **Spec changes** (see [Keeping SPEC.md current](#keeping-specmd-current)). If the Spec check warns, update SPEC.md or add the `no-spec-change` label with a reason.
3. In **How to test**, tell the reviewer where to click in the preview and what they should see. Editing the description outside the `wp-playground-preview` block keeps the button; replacing the whole body re-runs the build, which restores it.
4. If the change needs specific data to reproduce, add it to `.playground/blueprint.json` or the WXR fixture in the same PR. The preview uses the PR's own blueprint. Posts by `editor`, `author`, or `contributor` (`dc:creator`) are assigned to those users. `{{ARTIFACT_URL:<name>}}` is filled in at publish time and must name a zip listed in `ARTIFACTS` in `build-preview.sh` and in the build workflow's `artifacts`. The blueprint cannot contain `#` or `%`, because the Preview button's `data:` URL breaks on them.

To check blueprint changes locally, run `npm run test:tools` and boot the preview with `tools/playground/serve-preview.sh` (see `PLAYGROUND.md`).

## Maintenance

Regular cleanups, each run by hand and producing one PR with one commit per change:

- **Docs cleanup:** `docs/maintenance/docs-cleanup.md`. About monthly, and after a large feature lands. It removes duplicates, fixes contradictions and drops claims that are no longer true, checked against the code on `main`. `node tools/docs-check/docs-check.mjs` counts the docs, reports broken links, and checks that `docs/SPEC.md` stays at no more than one line per 90 lines of plugin code.
- **End-to-end test prune:** the precedent the docs cleanup copies is #181, which cut duplicate and always-skipped Playwright tests and listed what still covers each one.

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
