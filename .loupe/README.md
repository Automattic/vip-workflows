# .loupe

Project state for [loupe](https://github.com/dabowman/loupe), the design-system
gate. `loupe.config.json` at the repo root is the entry point, and it points
here. See [`tools/code-quality/README.md`](../tools/code-quality/README.md#design-system-conformance-loupe)
for how the gate runs.

| Path | What it is |
|---|---|
| `baseline.json` | The accepted backlog: findings that existed when loupe was adopted, as loupe's set of rule + file + code keys. Only a new blocking finding fails the gate. Re-record with `npm run loupe:baseline`. |
| `baseline-counts.json` | How many findings each `baseline.json` key held. `npm run lint` fails when a blocking key holds more, so a new occurrence beside a baselined one is caught. Written by `npm run loupe:baseline` with `baseline.json`; the gate fails when the two disagree. |
| `tokens/wpds-design-tokens.css` | A copy of `@wordpress/theme`'s `prebuilt/css/design-tokens.css`, so token rules work without `npm run setup`. `npm run lint` warns when it drifts from the installed package. |

Project-level loupe extensions (a pattern registry, a component registry, a
preset layered over `wpds`) belong here too, referenced from `loupe.config.json`.
