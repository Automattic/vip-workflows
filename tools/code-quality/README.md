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

loupe always analyzes the whole repo. Under `--changed` it reports on the whole
repo too, as CI does: a change can create a finding in a file it didn't touch,
and the baseline keeps the report to what is new. A `<file>…` list reports on
those files only.

### Output, and driving it from an agent

`lint`/`check` print three banner-separated sections in fixed order — the
**DESIGN SYSTEM (loupe)** worklist first, then blocking **PHP (phpcs)**, then
advisory **JS / CSS lint**. phpcs output is de-noised (no ANSI colors, no
`DEPRECATED: Scanning CSS/JS` per-sniff spam, PHP files only).

**`--json`** emits a structured payload instead of text: `{ loupe, php }`.
`loupe` is loupe's own `--format json` report. It is
`{ blocking: false, findings: [] }` when the scope holds no file loupe checks,
and `null` when loupe is missing (skipped) or couldn't run (exit 1, as in
`lint`). `php` is a list of phpcs findings `{ source, rule, type, fixable, file,
line, detail }`. No ANSI, no prose — the interface for an agent that groups/sorts
findings itself. JS/CSS advisory lint is not included.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | clean, nothing to do, or a tool was missing (skipped — including loupe) |
| `1` | blocking failure — PHP lint, failing unit test, a blocking loupe finding not in the baseline, or a loupe that was found but couldn't run |
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
design-system findings: run `loupe fix --changed` for the substitutions the
engine can settle without judgement (a misspelled token, an on-role token for a
hardcoded value). Bare `loupe fix` rewrites the whole repo, baselined findings
included. The rest are refactors that need a person.

---

## Design-system conformance (loupe)

[loupe](https://github.com/dabowman/loupe) checks UI code against the WordPress
Design System: overrides of WPDS components, layout and type in CSS, hardcoded
values where a `--wpds-*` token exists, raw elements with a WPDS analog,
superseded components, and rebuilt patterns. `loupe.config.json` at the repo
root selects the `wpds` preset, names the project's class namespaces, points at
`@wordpress/theme`'s token stylesheet (so it needs `npm run setup` first), names
the baseline file, and makes `css/dead-class` blocking, as css-hygiene's R1 was.
loupe walks the filesystem rather than git, so its `sources.ignore` restates the
preset's list (arrays replace on merge) and adds the gitignored `_tmp/` scratch
directory.

Two things css-hygiene reported (as advisory R6) loupe doesn't: CSS reaching into
React Flow (`.react-flow*`) or react-big-calendar (`.rbc-*`) internals, and CSS
reaching through a component's class into an element it renders (`.x svg`).
Listing those prefixes in `namespaces.external` would bring the first back as a
blocking `system/override`.

### Running it

loupe is not an npm dependency. `quality.mjs` finds it, in order:

1. `$LOUPE_BIN`
2. a checkout at `.loupe-engine/` (CI clones it there — gitignored)
3. `loupe` on `PATH` (the loupe Claude Code plugin puts it there)

If none is found, the section is skipped with a warning, like a missing phpcs.
CI's lint step runs `.loupe-engine/bin/loupe version` first, so a missing
engine fails the job there instead. To run it outside Claude Code, use the
commit CI pins (the `ref:` in `.github/workflows/js-unit.yml`), not loupe's
latest:

```
git clone https://github.com/dabowman/loupe .loupe-engine
git -C .loupe-engine checkout <ref>
```

or symlink a pinned checkout's `bin/loupe` onto your `PATH`.

`loupe status` prints the effective config and each rule's severity; its
BLOCKS/advisory column is about the Claude Code hook, which is off here, while
`lint` and CI fail on every `error` rule. `loupe explain <rule>` prints a rule's
guidance.

### The baseline

`.loupe-baseline.json` records the findings that existed when loupe was adopted.
They are accepted; a blocking finding whose key isn't there fails the gate. A
key is rule + file + normalized code, with no line number and no count. So
reformatting a file doesn't resurrect its findings, but a new finding with the
same rule and code as a baselined one in the same file is accepted too, and
moving a file, or fixing part of a finding that lists several properties
(dropping `gap` from `display,flex-direction,gap`), changes the key, so the
finding reports as new.

`loupe baseline` re-records every current finding, so it accepts whatever is in
the tree. Re-run it to shrink the file after fixing baselined findings, or after
one of those key changes, and check that the `.loupe-baseline.json` diff only
removes or renames entries. Never re-baseline to get a new finding past the gate
— fix it or suppress it.

CI pins the loupe commit in `.github/workflows/js-unit.yml`. A newer engine can
report findings the baseline never saw, so bump the pin and re-baseline in the
same change.

### Suppressing a needed exception

Sometimes a departure from the system is genuinely correct. Mute it **inline,
per-occurrence, with a reason** — never by disabling a file or editing a rule.

```
wpds-allow <ruleId>[, <ruleId>…] -- <reason>
```

On its own line, directly above the line the finding anchors to. loupe reads a
directive only when it starts its line. One trailing a declaration, as in
`padding: 0; /* wpds-allow … */` (the form css-hygiene accepted, and much of the
tree still carries), mutes nothing and is never reported; its finding sits in
the baseline instead. Rule ids are loupe's, e.g. `system/override`,
`layout/in-css`, `tokens/hardcoded-value`. The legacy ids still resolve: R0
`suppression/malformed`, R1 `css/dead-class`, R2 `tokens/hardcoded-value`, R3
`layout/margin-on-child`, R4 `layout/in-css`, R5 `typography/untokenized`, R6
`system/override`, R7 `system/raw-element`, R8 `typography/in-css`.

```css
.vip-workflows-toast {
	/* wpds-allow layout/negative-margin -- must bleed into the parent's padding */
	margin-top: -4px;
}
```

A directive without a rule id or a reason, or a blanket form, is itself a
`suppression/malformed` finding. Audit the list with `npm run suppressions`;
`npm run suppressions -- --stale` lists directives that muted nothing, and exits
1 when there are any.

**Rewriting the gate's rules isn't silent.** Any change under
`tools/code-quality/`, to `loupe.config.json` or `.loupe-baseline.json`, a
`.phpcs.xml.dist`, or an eslint/stylelint config prints `⚠ gate rules modified —
human review required`. A change to loupe's config or baseline also runs loupe
over the whole repo.

---

## Files

| File | Role |
|---|---|
| `quality.mjs` | orchestrator — scope resolution, loupe, PHP/JS lint, unit tests, exit codes |
| `phpcs-extensions.xml` | shared PHPCS baseline for the `workflow-*` extension plugins |
