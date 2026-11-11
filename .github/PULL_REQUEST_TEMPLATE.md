<!--
PR style for vip-workflows. Keep the section headings below; delete any guidance
comments and any section that doesn't apply. Aim for "what changed and why I'm
confident it works" — group changes under bold sub-headings, and make the test
steps something a reviewer can actually run.
-->

## Intent

<!-- One short paragraph: what this changes and *why*. If it's one PR in a
larger effort, say so and link the siblings. -->

<!-- Link the issue(s) it resolves; use one line per issue: -->
Closes #000

## Spec changes

<!-- Which sections of `docs/SPEC.md` this PR changes and what a reviewer
should check in them, for example: "Publish boundary: Always true gains a line
for private posts." Reviewers read the SPEC.md diff alongside the code.

If the PR changes no behavior SPEC.md describes, write "None:" and the reason
(for example, "None: refactor, no behavior change"), and add the
`no-spec-change` label so the Spec check passes. -->

## What was done

<!-- Group the changes under bold sub-headings by theme, not by file. Name the
key files/classes inline. Example:

**New thing**
- ...

**Core de-wired**
- ...
-->

## Data safety

<!-- OPTIONAL — include only if the change touches the DB, migrations, owned
tables, or stored data. State what is created/dropped/migrated and how existing
data survives. Delete this section if not applicable. -->

## How to test

<!-- Numbered, runnable steps. Conventionally:
1. `npm run build` (root) — compiles clean.
2. `cd vip-workflows && composer test` — unit tests pass.
3. With wp-env running: `npm run test:e2e[ -- tests/e2e/<spec>.js]` — ...
4. Manual (wp-env), as an editor/admin:
   - ...
-->

## Follow-ups

<!-- OPTIONAL — discovered-but-deferred work, each linked to its tracking issue
(for example, `#000`). Delete this section if there are none. -->
