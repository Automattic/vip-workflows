# Git hooks

Project-managed git hooks, checked into the repo and pointed at via
`core.hooksPath` (no husky / lint-staged dependency).

## Activate

```bash
git config core.hooksPath .githooks
```

Running `npm install` / `npm run setup` at the repo root does this automatically
(via the root `prepare` script), so you usually don't need to run it by hand.

## `pre-commit`

Two incremental-convergence passes over **staged** `vip-workflow` files, plus a
generated-config sync pass:

1. **JS/JSX** (`vip-workflow/src/**`, `vip-workflow/js/**`): auto-formats with
   the project's WordPress Prettier config (`wp-scripts format`) and re-stages.
2. **PHP** (`vip-workflow/**/*.php`): auto-fixes the incrementally-enforced
   phpcs sniffs in `vip-workflow/.phpcs-incremental.xml` (currently long array
   syntax, `[] → array()`) with `phpcbf` and re-stages. These sniffs are
   excluded from the main `.phpcs.xml.dist` so `composer cs` stays green while
   the codebase converges; once a full
   `vendor/bin/phpcs --standard=.phpcs-incremental.xml` run is clean, fold the
   rules back into `.phpcs.xml.dist` and delete the incremental ruleset.
3. **wp-env tests config**: `.wp-env.tests.json` is a **generated** file derived
   from `.wp-env.json` (see `scripts/gen-wp-env-tests.js`). When `.wp-env.json`
   or the generator is staged, the hook regenerates `.wp-env.tests.json` and
   re-stages it so the two never drift. Never edit `.wp-env.tests.json` by hand —
   edit `.wp-env.json`. CI runs `node scripts/gen-wp-env-tests.js --check` to
   fail closed if a `--no-verify` commit (or a clone without the hook installed)
   lets drift through.

Why: most of the code predates these standards, so a repo-wide lint drowns in
errors on untouched lines. Instead of one repo-wide reformat (which would
conflict with every open branch), the codebase converges **file-by-file** — a
file is brought into compliance the first time someone commits a change to it.

Notes:

- Neither tool fixes "only the changed lines" — the **whole** touched file is
  fixed. A one-line edit to a never-formatted file produces a chunky
  single-file diff in that commit. That's expected.
- A file that has both staged and unstaged changes is **skipped** (and a message
  is printed), so the hook never sweeps unstaged work into your commit.
- Bypass a single commit with `git commit --no-verify`.
- If `vip-workflow` deps aren't installed (npm for JS, composer for PHP), the
  hook no-ops instead of blocking.
