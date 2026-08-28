# Tools

Repository tooling and local-development helpers:

- `package-plugin.sh` builds distributable plugin archives — one installable zip per plugin.
- `restart-workflow.sh` deactivates and reactivates the plugin in wp-env.
- `use-worktree.sh` points the shared development wp-env at another Git worktree.
- `wp-env-after-start.sh` configures the local site and imports synthetic demo content.
- `create-test-authors.py` and `create-test-content.py` create optional local fixtures through the WordPress REST API.
- `code-quality/` discovers packages and runs the appropriate lint and unit-test commands.
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

Run the repository checks from the root:

```bash
npm run check:all
npm run test:tools
```

The Python content helpers require Python 3.11+, `requests`, and `python-dotenv`. They read `WP_URL`, `WP_USER`, and `WP_APP_PASSWORD` from the environment; `create-test-content.py` additionally supports `LM_STUDIO_URL` and the optional `UNSPLASH_ACCESS_KEY`.
