# Running VIP Workflow in WordPress Playground

`blueprint.json` boots WordPress trunk (the nightly build) with the core `vip-workflow` plugin for a local, disposable smoke test. The plugin is mounted from this checkout because generated assets and Composer dependencies are not committed.

From the repository root:

```bash
npm run setup
npm run build
npx @wp-playground/cli@latest start \
  --blueprint=blueprint.json \
  --mount=./vip-workflow:/wordpress/wp-content/plugins/vip-workflow
```

The WordPress and PHP versions come from `preferredVersions` in `blueprint.json`; passing `--wp` or `--php` on the command line overrides them, so leave them off unless you mean to.

Trunk moves daily, so this environment is deliberately not reproducible between runs. Use a pinned version when you need a stable target.

Open the printed URL. Playground logs you in as `admin` and lands on the Workflows dashboard.

This smoke test uses SQLite and does not replace the wp-env integration or Playwright environments. The top-level `workflow-*` extensions are not mounted by the blueprint; add a `--mount` argument and activation step for each extension you want to exercise.
