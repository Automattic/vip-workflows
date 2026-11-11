# Docs cleanup

A prompt for a regular pass over this repo's documentation. Give the whole file to a coding agent (or follow it yourself) on a fresh branch off `main`. The result is one pull request that removes duplicates, fixes contradictions and drops claims that are no longer true, with each change in its own commit.

Run it about once a month, and after any large feature lands. Each run covers one area, in rotation: `docs/reference/`, then `docs/guides/`, then everything else. Broken links are fixed everywhere on every run. A person reviews the PR; it is bookkeeping, so it doesn't need platform review unless it changes `docs/SPEC.md` in a way that changes what reviewers check against.

The shape copies the end-to-end test prune in [#181](https://github.com/Automattic/vip-workflows/pull/181): one commit per change, a table saying where each removed thing still lives, the risky change in its own section, and before and after counts.

---

## The prompt

You are cleaning up the documentation in this repository. Work on a new branch named `docs/cleanup-YYYY-MM` off an up-to-date `main`. Don't change any code, tests, or build files.

This run covers one area, named when you're asked to run it: `docs/reference/`, `docs/guides/`, or everything else listed under "What is true". If no area is named, take the one after the area of the most recent `docs: cleanup for …` PR. Check the whole repo for broken links whatever the area. Stop at about 25 changes; list what's left under "Not fixed" for the next run.

### What is true

The code on `main` is the source of truth. After that, in order:

1. `docs/SPEC.md`: what the product does, its platform surface, and each feature's **Always true** and **Footguns** lists.
2. `docs/reference/`: deeper subsystem detail. It links to SPEC.md for anything SPEC.md already says, rather than restating it.
3. Everything else: `docs/guides/`, `docs/AI_CONTEXT.md`, `docs/README.md`, `docs/specs/` (proposed specs only), `vip-workflows/docs/`, the `vip-workflows/skills/` files, extension READMEs, and the root `README.md`, `AGENTS.md`, `CONTRIBUTING.md` and `PLAYGROUND.md`.

Leave alone: changelogs, `SECURITY.md`, anything under `node_modules/` or `build/`, `.loupe/`, and proposed specs in `docs/specs/planned/` (they describe what isn't built yet, so the code can't contradict them).

### What to look for

1. **Claims that are no longer true.** A doc names a file, class, function, hook, option, route, ability, capability or default that doesn't exist on `main`, or describes behavior the code doesn't have. Check each one against the code before changing it.
2. **Contradictions.** Two docs say different things about the same behavior. Find out which one the code agrees with, fix the other, and fix SPEC.md if it's the one that's wrong.
3. **Duplicates.** A doc restates something SPEC.md or a reference doc already says. Replace the copy with a link to the section that owns it only when the owner covers everything the copy says; keep a short sentence of context if the reader needs it to decide whether to follow the link. If the copy holds detail the owner doesn't, leave it, fix only what's untrue in it, and list it under "Not fixed". Replacing a whole file's worth of content is a reorganization, which this cleanup doesn't do.
4. **Broken links.** Run `node tools/docs-check/docs-check.mjs`. It reports relative links and in-page anchors that don't resolve, across the whole repo. Fix all of them, including ones that predate this run.
5. **History notes and version stamps.** Notes such as "removed in 2.16.0", "no longer exists", "moved on 2026-07-09" or "Generated from v2.26.0" describe the past, not `main`. Remove them, unless one stops a reader making a likely mistake (for example, a removed hook that extensions might still call); then rewrite it as a present-tense statement of what to use instead.
6. **Orphans.** A doc that nothing links to and that no longer serves a reader. Delete it only if everything still true in it is already somewhere else; say where in the table.

Don't rewrite prose for style, reorganize files, or add new documentation. If something is missing rather than wrong, list it under "Not fixed" in the PR description instead.

### How to check a claim

- Search with `git grep` on `main`, not with memory or earlier docs. A name that doesn't appear in code is gone; one that appears only in docs, tests or comments is also gone.
- Search for class, function and hook names, not file names. Docs often write `EditorIntegration.php` for a file named `class-editor-integration.php`.
- For behavior, read the code path, and cite it as `path/to/file.php` with the function or method name. Don't cite line numbers; they drift.
- If you can't tell whether a claim is true, leave it and list it under "Not sure" in the PR description, with what you checked. Claims about code outside this repository, such as another plugin, always go under "Not sure".

### Rules for the changes

- **One commit per change.** Each commit fixes one claim, one contradiction, one duplicate or one batch of broken links, so a reviewer can revert it alone. When the same untrue claim appears in several files, fix them all in one commit. When a duplicate you replace with a link also held untrue claims, that is one commit, and its table row names the claims it removed. The commit message says what changed and why, for example `docs(reference): drop the removed Desk tables from database-schema.md`.
- **SPEC.md changes go in their own commits** and their own section of the PR description (below). SPEC.md is the file platform reviewers rely on, so a wrong edit there costs the most.
- **Don't add history.** No "Updated on …", "previously …" or "as of …" notes. The commit and the PR record what changed.
- **This repository is public.** Don't add customer names, private issue identifiers, internal links or internal process references. Remove any you find, and say so in the table.
- Match the file's existing style. Don't reflow paragraphs you didn't otherwise change.

### Before and after

Before the first commit and after the last, run:

```bash
node tools/docs-check/docs-check.mjs
```

It prints the number of Markdown files and lines, then any broken links. To check only some files, pass them as arguments; absolute and relative paths both work. Record both runs for the How to test section. The PR is ready when docs-check reports no broken links, or each remaining one is explained under "Not fixed".

### The pull request

Title: `docs: cleanup for <Month YYYY>`. Follow `.github/PULL_REQUEST_TEMPLATE.md`, with these sections:

**Intent.** One paragraph: this is the regular docs cleanup from `docs/maintenance/docs-cleanup.md`, how many changes it makes, and whether it touches SPEC.md.

**Spec changes.** "None: docs-only cleanup" if SPEC.md is untouched. The Spec check only looks at plugin code, so a docs-only PR doesn't need the `no-spec-change` label. Otherwise list each SPEC.md change, then repeat the detail in the section below.

**What was done.** Group the commits by kind (no longer true, contradictions, duplicates, links, history notes, orphans), one line each.

**For the SPEC.md reviewer.** Only if SPEC.md changed. Address it to the person who reviews SPEC.md changes. For each change: the section, the old claim, the new claim, and the code that shows the new one is right. End with: "Each of these is its own commit; revert one to undo it."

**Removed or fixed, and where the truth lives.** One row per change. Two example rows (the names are made up):

| File | Removed or fixed | Why | Evidence |
| --- | --- | --- | --- |
| `docs/reference/example.md` | The `vip_workflows_example_filter` section | No longer true: nothing applies the filter | `git grep vip_workflows_example_filter` on `main` finds only this doc |
| `docs/guides/example.md` | The stage and status region table | Duplicate | [SPEC.md, Sequences and stages](../SPEC.md#sequences-and-stages) |

"Why" is one of: no longer true, contradiction, duplicate, broken link, history note, orphan, public-repo hygiene. "Evidence" is a code reference on `main`, or the SPEC.md or reference section that now owns the content.

**Not fixed.** Things found but left alone, with why: not sure (and what you checked), missing rather than wrong, or out of scope.

**How to test.**

1. The before and after counts: Markdown files and lines, and broken links.
2. `node tools/docs-check/docs-check.mjs` passes, or each remaining broken link is listed under Not fixed.
3. Spot-check three rows of the table against the evidence they cite.

---

## Changing this prompt

Edit this file in its own PR, and say which run showed the need. Keep it a prompt a person could follow by hand: no step should need a tool this repo doesn't have.
