# Running VIP Workflow in WordPress Playground

`blueprint.json` boots WordPress 7.0 with the core `vip-workflow` plugin for a local, disposable smoke test. The plugin is mounted from this checkout because generated assets and Composer dependencies are not committed.

From the repository root:

```bash
npm run setup
npm run build
npx @wp-playground/cli@latest start \
  --wp=7.0 --php=8.2 \
  --blueprint=blueprint.json \
  --mount=./vip-workflow:/wordpress/wp-content/plugins/vip-workflow
```

Open the printed URL. Playground logs you in as `admin` and lands on the Workflows dashboard.

This smoke test uses SQLite and does not replace the wp-env integration or Playwright environments. The top-level `workflow-*` extensions are not mounted by the blueprint; add a `--mount` argument and activation step for each extension you want to exercise.
