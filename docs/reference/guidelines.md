# Guidelines

Guidelines are owned by the Gutenberg/Core Guidelines feature, not by VIP Workflows.

## Storage

VIP Workflows no longer registers a `vip_guideline` CPT, custom Guidelines admin page, user profile guideline link, or `/vip-workflows/v1/guideline` REST API.

Content standards are managed in the Gutenberg UI (Settings → Guidelines) and stored in the `wp_knowledge` post type — the Knowledge primitive introduced by [WordPress/gutenberg#77230](https://github.com/WordPress/gutenberg/issues/77230) and headed for Core. Each guideline is one `guideline`-typed row:

| Aspect | Value |
| --- | --- |
| Post type | `wp_knowledge` |
| Type taxonomy | `wp_knowledge_type`, term `guideline` |
| Scope rows | slug `guideline-{scope}` (e.g. `guideline-copy`), text in `post_content` |
| Per-block rows | slug `guideline-block-{name}` (`/` encoded as `_`); canonical block name in `post_title` |
| Scope registry | `wp_guideline_scopes()` — filterable, so plugins can register their own scopes |
| Status | only `publish` rows are live; suffixed duplicates (`guideline-copy-2`) are dead data |

> **Historical note.** Guidelines were previously a singleton exposed at `/wp/v2/content-guidelines`. [WordPress/gutenberg#79263](https://github.com/WordPress/gutenberg/pull/79263) dissolved that singleton into per-scope rows and deleted the route. There is no migration — the feature was flag-gated and experimental.

## How VIP Workflows Consumes Guidelines

`DraftBuilder::gather_guideline_context()` delegates to `GuidelineContextProvider`, which reads published guideline rows directly and renders them as markdown sections ordered by the scope registry.

Rows are read with a direct query rather than through `/wp/v2/knowledge`, because that route is capability-gated on `read_knowledge_items` and returns 401 without a current user — guideline context is also assembled from cron, Action Scheduler jobs, and WP-CLI.

The Editorial Alignment Checker reads the same provider. It does not read legacy option-backed Editorial Rules.

Extensions can alter the guideline text and the alignment rules without owning storage, via the `vip_workflows_guideline_context` and `vip_workflows_editorial_alignment_rules` filters — see [extension-points.md](extension-points.md#9-editorial-guideline-filters).

## Missing Guidelines

VIP Workflows never synthesizes fallback guidelines from local storage. When there is no guideline text, AI draft generation receives `No guideline context available.` and Editorial Alignment returns a `no_rules` error.

That empty state has two very different causes, and only one is a problem:

| Situation | Detected by | Behavior |
| --- | --- | --- |
| Guidelines are not running here — Gutenberg inactive, or the feature switched off | `wp_guideline_scopes()` absent or empty | Silent. Nothing is misconfigured, so nothing is reported. |
| Guidelines are running, but nothing has been written yet | Registry present, no rows | Silent. A legitimate empty state. |
| Guidelines *should* be working and are not — the registry loaded but `wp_knowledge` is unregistered, or rows exist that no registered scope claims | Registry present, storage missing or unrecognizable | Reported once per request via `_doing_it_wrong()`. |

The third row is the guard against a repeat of the `/wp/v2/content-guidelines` removal, where guidelines silently stopped reaching every AI prompt. It is deliberately scoped so a site that does not run Gutenberg is never nagged about a feature it never enabled, and because it routes through `_doing_it_wrong()` it honours `WP_DEBUG` — a developer signal, not production log noise.

## Local Gutenberg

Root `npm run dev` loads the latest stable packaged Gutenberg release from `https://downloads.wordpress.org/plugin/gutenberg.zip` through `.wp-env.json`.

Guidelines currently sits behind Gutenberg's `gutenberg-guidelines` experiment (Settings → Experiments); enable it to exercise the integration. VIP Workflows does not enable it. [WordPress/gutenberg#79674](https://github.com/WordPress/gutenberg/pull/79674) will remove that toggle and load the feature unconditionally, which is why `GuidelineContextProvider` gates on `post_type_exists( 'wp_knowledge' )` rather than on the experiment flag.

`tests/phpunit/Integration/GuidelineContextProviderKnowledgeTest.php` asserts this integration against the real Gutenberg module, so an upstream reshape fails a test instead of silently emptying every AI prompt.
