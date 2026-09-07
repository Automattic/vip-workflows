# Code-quality gate

Monorepo-wide lint + fast-test runner for VIP Workflows. Harness-agnostic: the
same entrypoint backs the `npm run` scripts, editor/agent hooks, and CI. It
reads the repo and runs the project's own linters/tests — it does **not** own
git hooks or CI config.

```
node tools/code-quality/quality.mjs <lint|test|check|fix|suppressions> [--changed | --all | <file>…] [--rule=R4] [--json]
```

| Command | Does |
|---|---|
| `lint` | PHP (phpcs) + JS/CSS (wp-scripts) + CSS-hygiene rules (below) |
| `test` | fast **unit** suites only — no wp-env / integration / e2e |
| `check` | `lint` then `test` |
| `fix` | run the format autofixers (phpcbf + eslint/stylelint `--fix`) over the scope — **mutates files** |
| `suppressions` | print every honored `wpds-allow` in the tree (audit registry) |

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
**CSS-HYGIENE / WPDS** worklist first, then blocking **PHP (phpcs)**, then
advisory **JS / CSS lint**. phpcs output is de-noised (no ANSI colors, no
`DEPRECATED: Scanning CSS/JS` per-sniff spam, PHP files only).

Hygiene findings are grouped by rule; the fix **guidance is stated once in the
group header**, and each finding line carries only what varies:

```
⚠ R6 [advisory] × 490 — overrides a WPDS/library component — restyle via its props/tokens, not CSS
    …/AssistantCard.css:37   <Text> ← line-height
    …/AssistantsTab.css:31   <Stack> ← color
```

Two flags exist for working through a large backlog:

- **`--rule=R4`** (or `--rule=R4,R6`) — narrow the displayed hygiene findings to
  those rule ids, to fix one rule family at a time. Display-only: the blocking
  verdict is still computed on the full set, and a hidden blocking finding is
  called out so `--rule` can't mask an R0/R1.
- **`--json`** — emit a structured payload instead of text: `{ hygiene: [...],
  php: [...] }`, each finding `{ source, rule, file, line, detail, … }` (hygiene
  adds `blocking` + `guidance`; phpcs adds `type` + `fixable`). No ANSI, no
  ordering, no prose — the interface for an agent that groups/sorts findings
  itself (e.g. per-component). JS/CSS advisory lint is not included.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | clean, nothing to do, or a tool was missing (skipped) |
| `1` | blocking failure — PHP lint, failing unit test, or a blocking hygiene rule |
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
npm run suppressions    # the wpds-allow registry
```

`fix` defaults to `--changed` (not `--all` like the read-only verbs): it
rewrites files, so the safe default is your working changes — reach for
`fix:all` deliberately.

### What `fix` does and doesn't touch

Runs only the **mechanical** formatters — `phpcbf`, `eslint --fix`,
`stylelint --fix` — so it's safe and non-destructive. It never touches the
CSS-hygiene rules: R2 needs the *right* token chosen, R3–R8 are JSX/layout
refactors, and R6 is a judgement call. Auto-"fixing" those by guessing is
exactly the silent wrong change the gate exists to catch — they stay a review
worklist. Run `fix`, then `lint` to see what genuinely needs a human.

---

## CSS-hygiene / WPDS-usage rules

`css-hygiene.mjs` correlates the two sides no single linter sees at once — the
JSX that binds a class to a component, and the CSS that styles that class — to
catch design-system-usage problems that dead-code and style linters miss. It
runs inside `lint`; it only analyzes, never edits.

| Rule | Flags | Severity |
|---|---|---|
| **R0** | blanket / whole-file suppression attempts | **blocking** |
| **R1** | dead project CSS class (`vip-workflows-*` / `wf-*`, referenced in no JS/JSX/PHP) | **blocking** |
| **R2** | hardcoded value where a `--wpds-*` token exists (color/spacing/radius, incl. `0`) | advisory |
| **R3** | any `margin` — spacing belongs to the parent Stack/`gap`, not margins | advisory |
| **R4** | layout declared in CSS (`gap`, `display:flex/grid`, flex props) — use a `<Stack>`/`<HStack>` + its `gap` prop | advisory |
| **R5** | raw type styling (`font-*`, `line-height`, `letter-spacing`) — use `<Text>` or a `--wpds` type token | advisory |
| **R6** | CSS overriding a WPDS component (a class bound to one) or reaching into library internals (`.components-*`, `.react-flow*`, …) | advisory |
| **R7** | raw element with a WPDS analog: `<p>`/`<h1–6>` → `<Text>`/`<Heading>`; a **styled** `<div>`/`<span>` → `<Stack>`/`<Text>` | advisory |
| **R8** | `<Text>`/`<Heading>` typed via CSS — use its `style`/size prop, not a stylesheet | advisory |

Findings are grouped by rule (blocking first) and ranked by signal within a
rule. Advisory rules report but never fail the gate — they're the review
worklist; only R0 and R1 block.

### Why R1 is safe to block

A false "dead class" would block a commit, so R1 is deliberately narrow:

- **Only project-authored namespaces** (`PROJECT_PREFIXES` in `css-hygiene.mjs`).
  Bare/utility names and library classes are never judged dead.
- **Proven-unreferenced** across every JS/JSX/PHP file. Because a class name is
  hyphenated and an identifier can't contain a hyphen, the reference scan reads
  raw tokens (no fragile string parsing) — it over-collects, so a live class is
  never mistaken for dead.
- **Dynamic classes are honored:** `` `vip-workflows-foo-${x}` `` keeps every
  `.vip-workflows-foo-*` rule alive via its stem.

Library-owned classes (`.components-*`, `.react-flow*`, `.rbc-*`, …) are never
R1 — styling them is an R6 override instead, which is the purer signal.

---

## Suppressing a needed exception

Sometimes a departure from the system is genuinely correct. Mute it **inline,
per-occurrence, with a reason** — never by disabling a file or editing a rule.

```
wpds-allow <ruleId>[,<ruleId>…] -- <reason>
```

Placed on the offending line, or the line directly above it.

```css
.vip-workflows-toast {
	/* wpds-allow R3 -- must bleed into the parent's padding; no gap equivalent */
	margin-top: -4px;
}
```

```jsx
{/* wpds-allow R7 -- third-party widget mounts its script into this raw div */}
<div className="embed-host" />
```

Rules:

- **Rule id(s) and a reason are both required.** Multiple ids are
  comma-separated (`wpds-allow R2,R3 -- …`).
- A directive only mutes the exact rule(s) it names, on its own line / the line
  below it.
- **Anything looser is a finding, not a mute.** A `wpds-allow` with no rule id,
  a missing reason, `wpds-allow-file`, or `wpds-disable` becomes an **R0**
  (blocking) — you cannot widen the net or silence a whole file.
- **Rewriting the gate's rules isn't silent.** Any change under
  `tools/code-quality/`, a `.phpcs.xml.dist`, or an eslint/stylelint config
  prints `⚠ gate rules modified — human review required`.

### Auditing exceptions

Every honored suppression is greppable:

```
npm run suppressions
# → file:line  <ruleIds>  — <reason>   (one line per sanctioned exception)
```

Keep this list short and each entry justified; it's the record of every place
the codebase intentionally steps outside the design system.

---

## Files

| File | Role |
|---|---|
| `quality.mjs` | orchestrator — scope resolution, PHP/JS lint, unit tests, hygiene, exit codes |
| `css-hygiene.mjs` | the R0–R8 analyzer (PostCSS + lightweight JSX scanning) |
| `phpcs-extensions.xml` | shared PHPCS baseline for the `workflow-*` extension plugins |
