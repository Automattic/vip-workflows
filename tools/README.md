# Tools

Repository tooling and local-development helpers:

- `package-plugin.sh` builds distributable plugin archives — one installable zip per plugin.
- `restart-workflow.sh` deactivates and reactivates the plugin in wp-env.
- `use-worktree.sh` points the shared development wp-env at another Git worktree.
- `wp-env-after-start.sh` configures the local site and imports synthetic demo content.
- `wp-env-seed-tests.sh` gives the tests environment the plugin state the e2e suite assumes (`npm run seed:tests`; also runs after `npm run wp-env:start:tests`).
- `wp-env-e2e-webserver.sh` is the Playwright `webServer` command for local e2e runs: it starts and seeds the tests environment, then reports ready.
- `create-test-authors.py` and `create-test-content.py` create optional local fixtures through the WordPress REST API.
- `code-quality/` discovers packages and runs the appropriate lint and unit-test commands.
- `playground/` builds the pull request preview (`build-preview.sh`), validates its blueprint (`build-preview-blueprint.mjs`), boots it locally (`serve-preview.sh`), and shifts demo-content dates for both the preview and wp-env (`shift-wxr-dates.php`).
- `wp-env/` contains regression tests for the wp-env image patcher and demo dependencies.

Packaging takes the version to stamp into the archives, and writes them to `dist/`:

```bash
tools/package-plugin.sh 1.2.0                  # every plugin
tools/package-plugin.sh 1.2.0 vip-workflows     # just the core plugin
tools/package-plugin.sh 1.2.0 --pick           # choose extensions interactively
```

The version is stamped only into the staged copy that gets archived; the working
tree is left untouched. `--pick` is the only mode that needs `gum`, so unattended
builds neither require it nor can block on a prompt. From `vip-workflows/`, the
same script runs as `npm run package -- 1.2.0`.

## Releases

Run **Create release PR** in GitHub Actions, or `npm run release -- <type-or-version>`
locally. The workflow's optional `version` input overrides `release_type` when
starting a specific release series, for example `1.0.0-beta.1`.

- `major`, `minor`, and `patch` prepare stable releases. `patch` promotes a current
  prerelease to its stable version (`1.0.0-beta.2` → `1.0.0`).
- `alpha` and `beta` start at `.1`, increment an existing matching prerelease
  number, or move alpha to beta (`1.0.0-alpha.2` → `1.0.0-beta.1`). From a stable
  version, they start a prerelease of the next patch.
- An exact version such as `1.0.0-beta.1` starts a new major/minor prerelease
  series. Versions must increase; beta-to-alpha and other downgrades are rejected.

For example, select exact `version: 1.0.0-beta.1`, then `release_type: beta` for
`1.0.0-beta.2`, and finally `release_type: patch` for stable `1.0.0`. Merge each
release PR before preparing the next one. Alpha and beta releases are marked as
GitHub prereleases, so they do not replace the latest stable release. Plugin
headers, runtime version constants, and npm manifests retain the full version.

Run the repository checks from the root:

```bash
npm run check:all
npm run test:tools
```

The Python content helpers require Python 3.11+, `requests`, and `python-dotenv`. They read `WP_URL`, `WP_USER`, and `WP_APP_PASSWORD` from the environment; `create-test-content.py` additionally supports `LM_STUDIO_URL` and the optional `UNSPLASH_ACCESS_KEY`.
