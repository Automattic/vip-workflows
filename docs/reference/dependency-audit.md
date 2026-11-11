# Dependency audit: accepted advisories and overrides

What `npm audit` still reports on purpose, and which npm `overrides` hold the rest down. The [security review rubric](../guides/security-sweep-rubric.md) asks for an owner, a review trigger and a rationale for every accepted advisory; this is that record. Update it whenever an override is added or removed, or an accepted advisory changes.

Owner: VIP Workflows maintainers.

## Accepted advisories

Both ship in the core plugin's built JavaScript, through `@wordpress/*` packages that `@wordpress/scripts` bundles rather than loads from WordPress core. Neither can be fixed without changing shipped code, so neither is fixed inside a toolchain change. In `workflow-tool-checklist`, `deepmerge` is only a build and test dependency and does not ship.

| Package | Advisory | Packages | How it arrives | Why it is not reachable | Review again when |
| --- | --- | --- | --- | --- | --- |
| `deepmerge` 4.3.1 | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) (low): `mergeObject()` lets a `__proto__` key set the prototype of the returned object | `vip-workflows` (shipped), `workflow-tool-checklist` (build only) | `@wordpress/dataviews` pins it exactly and is bundled by design | The bundled call sites are DataForm's panel modal and form-validity hook, which merge the signed-in user's own form state in their browser. The plugin renders `DataViews` only, never DataForm. No fixed `deepmerge` release exists. | `@wordpress/dataviews` is updated, or `deepmerge` publishes a fix |
| `uuid` 9.0.1 | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) (moderate): missing buffer bounds check in v3, v5 and v6 when a `buf` argument is passed | `vip-workflows` | Requested by `@wordpress/components` 32 (`^9.0.1`); overriding it changes the built JS | The bundle contains only `uuid`'s v4 function, and it is not called with a buffer | `@wordpress/components` is updated to a release on `uuid` 11.1.1 or later |

`workflow-tool-checklist` overrides `uuid` (below) because it does not bundle it, so the override leaves its build output unchanged.

## Overrides

Each override lifts a dev or build tool's transitive dependency to a patched release. Each was kept only because the tool that pulls it in still passed its own checks and the built JavaScript stayed byte-identical. Remove an override once the parent package's own range admits a fixed version; `npm ls <package>` shows whether it still applies.

| Package | Override | Clears | Parent | Checked with |
| --- | --- | --- | --- | --- |
| root | `adm-zip` ^0.6.1 | adm-zip advisory | `@wordpress/env` | Predates this record; wp-env still downloads and unpacks sources |
| root | `@wp-playground/storage` › `isomorphic-git` ^1.44.12 | isomorphic-git path traversal advisories | `@wordpress/env` › `@wp-playground/cli` | wp-env boots and runs the integration suites |
| root | `express` › `qs` ^6.17.1 | qs denial-of-service advisories | `@wordpress/env` › `@wp-playground/cli` | wp-env boots; express parses query strings |
| root | `rimraf@^5` › `glob` ^14.0.4 | glob advisory | `@wordpress/env` › `rimraf` | wp-env's `rimraf( path )` calls delete as before |
| `vip-workflows`, `workflow-tool-checklist` | `copy-webpack-plugin` › `serialize-javascript` ^7.1.4 | serialize-javascript advisories | `@wordpress/scripts` webpack config | The build still copies the DataViews and design-token CSS |
| `vip-workflows`, `workflow-tool-checklist` | `markdownlint-cli` › `js-yaml` ^5.5.0, `smol-toml` ^1.9.1 | js-yaml and smol-toml advisories | `@wordpress/scripts` › `markdownlint-cli` | `wp-scripts lint-md-docs` still lints and reports |
| `vip-workflows`, `workflow-tool-checklist` | `micromark-extension-math` › `katex` ^0.18.2 | katex advisory | `markdownlint-cli` › `markdownlint` | As above |
| `vip-workflows`, `workflow-tool-checklist` | `minimatch@^10.0.0` → ^11.0.7 | minimatch ReDoS advisory | ESLint config loading, typescript-eslint | Lint covers the same files with the same findings |
| `vip-workflows`, `workflow-tool-checklist` | `glob@^10.0.0` → ^14.0.4 | glob advisory | Jest coverage, typescript-eslint | Jest runs the same suites; coverage still works |
| `vip-workflows` | `glob@^13.0.0` → ^14.0.4 | glob advisory | Jest 30 (`jest-config`, `jest-runtime`, `@jest/reporters`) | As above |
| `workflow-tool-checklist` | `uuid@^9.0.0` → ^11.1.1 | uuid advisory | `@wordpress/components` 32 | Build output byte-identical |

## Checking

From each of the repository root, `vip-workflows/` and `workflow-tool-checklist/`:

```sh
npm audit
npm audit --omit=dev
```

The full audit should list only the accepted advisories above. When it lists something else, either fix it or add it here with the same detail.
