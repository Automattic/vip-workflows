# .loupe

Project state for [loupe](https://github.com/dabowman/loupe), the design-system
gate. `loupe.config.json` at the repo root is the entry point, and it points
here. See [`tools/code-quality/README.md`](../tools/code-quality/README.md#design-system-conformance-loupe)
for how the gate runs.

| Path | What it is |
|---|---|
| `baseline.json` | The accepted backlog: findings that existed when loupe was adopted. Only a new blocking finding fails the gate. Re-record with `loupe baseline`. |
| `tokens/wpds-design-tokens.css` | A copy of `@wordpress/theme`'s `prebuilt/css/design-tokens.css`, so token rules work without `npm run setup`. `npm run test:tools` fails when it drifts from the installed package. |

Project-level loupe extensions (a pattern registry, a component registry, a
preset layered over `wpds`) belong here too, referenced from `loupe.config.json`.
