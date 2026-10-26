# Running VIP Workflows in WordPress Playground

`blueprint.json` boots WordPress trunk (the nightly build) with the core `vip-workflows` plugin for a local, disposable smoke test. The plugin is mounted from this checkout because generated assets and Composer dependencies are not committed.

From the repository root:

```bash
npm run setup
npm run build
npx @wp-playground/cli@latest start \
  --blueprint=blueprint.json \
  --mount=./vip-workflows:/wordpress/wp-content/plugins/vip-workflows
```

The WordPress and PHP versions come from `preferredVersions` in `blueprint.json`; passing `--wp` or `--php` on the command line overrides them, so leave them off unless you mean to.

Trunk moves daily, so this environment is deliberately not reproducible between runs. Use a pinned version when you need a stable target.

Open the printed URL. Playground logs you in as `admin` and lands on the Workflows dashboard.

## Pull request previews

Pull requests get a hosted preview built in CI from `.playground/blueprint.json`; see "Pull request previews" in `AGENTS.md`. To boot the same preview locally:

```bash
tools/package-plugin.sh 0.0.0-local vip-workflows
mkdir -p dist/preview
cp dist/vip-workflows-0.0.0-local.zip dist/preview/vip-workflows.zip
node tools/playground/build-preview-blueprint.mjs dist/preview/blueprint.json
sed 's#{{ARTIFACT_URL:vip-workflows}}#http://127.0.0.1:8765/vip-workflows.zip#' \
  dist/preview/blueprint.json > dist/preview/local.json
( cd dist/preview && python3 -m http.server 8765 ) &
npx @wp-playground/cli@latest server --blueprint=dist/preview/local.json
```

## Limitations

This smoke test uses SQLite and does not replace the wp-env integration or Playwright environments. The top-level `workflow-*` extensions are not mounted by the blueprint; add a `--mount` argument and activation step for each extension you want to exercise.
