# Code-quality gate

Monorepo-wide lint + fast-test runner for VIP Workflows. Harness-agnostic: the
same entrypoint backs the `npm run` scripts, editor/agent hooks, and CI. It
reads the repo and runs the project's own linters/tests — it does **not** own
git hooks or CI config.

```
node tools/code-quality/quality.mjs <lint|test|check|fix|suppressions> [--changed | --all | <file>…] [--json]
```

| Command | Does |
|---|---|
| `lint` | design-system conformance (loupe, below) + PHP (phpcs) + JS/CSS (wp-scripts) |
| `test` | fast **unit** suites only — no wp-env / integration / e2e |
| `check` | `lint` then `test` |
| `fix` | run the format autofixers (phpcbf + eslint/stylelint `--fix`) over the scope — **mutates files** |
| `suppressions` | `loupe suppressions` — every honored `wpds-allow` in the tree (audit registry); extra args pass through, e.g. `--stale` |

### Scope

| Flag | Files considered |
|---|---|
| *(none)* / `--changed` | `git status` working-tree changes (default) |
| `--all` | the whole monorepo |
| `<file>…` | just the paths you name |

`--all` beats `--changed` regardless of order, so `npm run check -- --all`
works even though the `check` script bakes in `--changed`.

### Output, and driving it from an agent

`lint`/`check` print three banner-separated sections in fixed order — the
**DESIGN SYSTEM (loupe)** worklist first, then blocking **PHP (phpcs)**, then
advisory **JS / CSS lint**. phpcs output is de-noised (no ANSI colors, no
`DEPRECATED: Scanning CSS/JS` per-sniff spam, PHP files only).

**`--json`** emits a structured payload instead of text: `{ loupe, php }`.
`loupe` is loupe's own `--format json` report (`null` if loupe couldn't run);
`php` is a list of phpcs findings `{ source, rule, type, fixable, file, line,
detail }`. No ANSI, no prose — the interface for an agent that groups/sorts
findings itself. JS/CSS advisory lint is not included.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | clean, nothing to do, or a tool was missing (skipped — including loupe) |
| `1` | blocking failure — PHP lint, failing unit test, or a blocking loupe finding not in the baseline |
| `2` | couldn't run (git unavailable, bad usage) — never reported as success |

JS/CSS lint findings are **advisory** and never change the exit code (there's a
pre-existing JS-lint backlog).

### npm scripts

```
npm run lint            # lint --all            npm run lint:changed
npm run lint:all        # lint --all
npm run test:unit       # test --all            npm run test:unit:changed
npm run test:all        # test --all
npm run check           # check --changed       npm run check:all   (check --all)
npm run fix             # fix --changed         npm run fix:all     (fix --all)
npm run suppressions    # the wpds-allow registry (needs loupe)
```

`fix` defaults to `--changed` (not `--all` like the read-only verbs): it
rewrites files, so the safe default is your working changes — reach for
`fix:all` deliberately.

### What `fix` does and doesn't touch

Runs only the **mechanical** formatters — `phpcbf`, `eslint --fix`,
`stylelint --fix` — so it's safe and non-destructive. It never touches
design-system findings: run `loupe fix` for the substitutions the engine can
settle without judgement (a misspelled token, an on-role token for a hardcoded
value). The rest are refactors that need a person.

---

## Design-system conformance (loupe)

[loupe](https://github.com/dabowman/loupe) checks UI code against the WordPress
Design System: overrides of WPDS components, layout and type in CSS, hardcoded
values where a `--wpds-*` token exists, raw elements with a WPDS analog,
superseded components, and rebuilt patterns. `loupe.config.json` at the repo
root selects the `wpds` preset, names the project's class namespaces, and points
at `@wordpress/theme`'s token stylesheet (so it needs `npm run setup` first).

### Running it

loupe is not an npm dependency. `quality.mjs` finds it, in order:

1. `$LOUPE_BIN`
2. a checkout at `.loupe-engine/` (CI clones it there — gitignored)
3. `loupe` on `PATH` (the loupe Claude Code plugin puts it there)

If none is found, the section is skipped with a warning, like a missing phpcs.
To run it outside Claude Code: `git clone https://github.com/dabowman/loupe
.loupe-engine`, or symlink a checkout's `bin/loupe` onto your `PATH`.

`loupe status` prints the effective config and which rules block; `loupe explain
<rule>` prints a rule's guidance.

### The baseline

`.loupe-baseline.json` records the findings that existed when loupe was adopted.
They are accepted; only a **new** blocking finding fails the gate. Entries key
on rule + file + normalized code, not line number, so reformatting a file
doesn't resurrect them. Fixing a baselined finding is always welcome; to shrink
the file afterwards, re-run `loupe baseline` and commit the result. Never
re-baseline to get a new finding past the gate — fix it or suppress it.

CI pins the loupe commit in `.github/workflows/js-unit.yml`. A newer engine can
report findings the baseline never saw, so bump the pin and re-baseline in the
same change.

### Suppressing a needed exception

Sometimes a departure from the system is genuinely correct. Mute it **inline,
per-occurrence, with a reason** — never by disabling a file or editing a rule.

```
wpds-allow <ruleId>[, <ruleId>…] -- <reason>
```

On its own line, directly above the line the finding anchors to (loupe says
where when a directive is misplaced). Rule ids are loupe's, e.g.
`system/override`, `layout/in-css`, `tokens/hardcoded-value`.

```css
.vip-workflows-toast {
	/* wpds-allow layout/negative-margin -- must bleed into the parent's padding */
	margin-top: -4px;
}
```

A directive without a rule id or a reason, or a blanket form, is itself a
`suppression/malformed` finding. Audit the list with `npm run suppressions`;
`npm run suppressions -- --stale` lists directives that muted nothing.

**Rewriting the gate's rules isn't silent.** Any change under
`tools/code-quality/`, a `.phpcs.xml.dist`, or an eslint/stylelint config
prints `⚠ gate rules modified — human review required`.

---

## Files

| File | Role |
|---|---|
| `quality.mjs` | orchestrator — scope resolution, loupe, PHP/JS lint, unit tests, exit codes |
| `phpcs-extensions.xml` | shared PHPCS baseline for the `workflow-*` extension plugins |
