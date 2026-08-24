# Extending VIP Workflow

VIP Workflow is designed to be extended. You don't fork it; you ship a small WordPress plugin that hooks into it. This guide is the map of every extension point and the patterns that prove them out.

## At a glance

| I want to... | Use |
|--------------|------|
| Add an AI-powered research/ideation agent | Register an Ability via `vip_workflow_register_ability` (see [`vip-workflow/skills/create-agent/SKILL.md`](../../vip-workflow/skills/create-agent/SKILL.md)) |
| Add an agent that can own an AI workflow stage | Register a stage-eligible Ability plus an agent manifest with `capabilities: [ 'stage' ]`; the manifest claim is validated against the ability metadata (see [`vip-workflow/skills/create-agent/SKILL.md`](../../vip-workflow/skills/create-agent/SKILL.md)) |
| Add a check / helper tool that runs on transitions | Same Abilities API with `meta.type` = `check`, `helper`, or `validator` ([`vip-workflow/skills/create-tool/SKILL.md`](../../vip-workflow/skills/create-tool/SKILL.md)) |
| Deliver notifications over a new channel (Slack DM, push, SMS) | Extend `NotificationChannel`, filter `vip_workflow_notification_channels` ([`vip-workflow/skills/create-notification-channel/SKILL.md`](../../vip-workflow/skills/create-notification-channel/SKILL.md)) |
| Surface story prompts from an external source (wire, trending, calendars) | Register a Discovery Provider on `vip_workflow_register_discovery_providers` ([`specs/shipped/story-discovery.md`](../specs/shipped/story-discovery.md)) |
| Add a signal to story prompts another plugin fetched | Filter `vip_workflow_discovery_prompts` — cached reads only ([`reference/extension-points.md`](../reference/extension-points.md#11-discovery-prompt-enrichment)) |
| Run a recurring background job | Extend `Job`, hook into `vip_workflow_jobs_init` |
| Add an admin page under the Workflow shell | Standard `add_submenu_page` with parent slug `vip-workflow` (see [`vip-workflow/docs/PLUGIN-INTEGRATION.md`](../../vip-workflow/docs/PLUGIN-INTEGRATION.md)) |
| Add a new internal subsystem to the core plugin | Implement `ModuleInterface`, register via `vip_workflow_register_modules` ([`specs/shipped/module-registry.md`](../specs/shipped/module-registry.md)) |

## Extension plugin anatomy

Every extension lives in a sibling directory at the repo root and is a standalone WordPress plugin with `Requires Plugins: vip-workflow` in its header. They install and activate independently.

```
<extension-plugin>/
├── <extension-plugin>.php   # Plugin bootstrap, header, hook registrations
├── includes/                # PHP (classes, REST controllers)
├── src/                     # (optional) React/JS source
├── build/                   # (optional) webpack output
└── README.md
```

### PHP file naming convention

VIP Workflow follows WordPress-style `class-{kebab}.php` file naming with one addition: **acronyms are split on case transitions**. The autoloader derives file names mechanically from class names using this rule, and `AutoloaderPathsTest` enforces it in CI.

| Class name | File name |
|---|---|
| `GuidelineContextProvider` | `class-guideline-context-provider.php` |
| `YouTubeTranscript` | `class-you-tube-transcript.php` |
| `YouTubeVideoProvider` | `class-you-tube-video-provider.php` |

Extension plugins loaded via Composer classmap are not constrained by this rule, but any class placed inside `vip-workflow/includes/` must follow it or the autoloader will fail to locate it on Linux/case-sensitive filesystems.

## Deep reference: skill docs

The `vip-workflow/skills/` directory contains copy-pasteable SKILL docs written for AI agents. Humans can read them too; they are short, task-focused, and include working examples.

- **[create-agent/SKILL.md](../../vip-workflow/skills/create-agent/SKILL.md)** — Scaffolds a research, discovery, combined, or stage-capable agent. Covers input/output schemas, agent manifests, `stage_eligible`, and returning pinnable cards or stage outcomes.
- **[create-tool/SKILL.md](../../vip-workflow/skills/create-tool/SKILL.md)** — Scaffolds a check or helper tool. Covers `AbilityResult`, hard/soft enforcement, `settings_schema` for configurable fields, modal UI for helpers.
- **[create-notification-channel/SKILL.md](../../vip-workflow/skills/create-notification-channel/SKILL.md)** — Scaffolds a channel plugin. Covers `NotificationChannel` base class, filter registration, per-user config, template rendering.

## Adding an admin page

VIP Workflow's admin screens are standard WordPress admin pages under the `vip-workflow` parent menu. Register your own the normal way — it renders as an ordinary wp-admin page in the standard canvas, no special hooks required:

```php
add_action( 'admin_menu', function() {
    add_submenu_page(
        'vip-workflow',
        'My Plugin Page',
        'My Plugin',
        'edit_posts',
        'my-plugin-page',
        'my_plugin_render_page'
    );
}, 20 );
```

Full details, including the Workflows submenu ordering (core pages, then third-party pages in the Integrations group), are in [`vip-workflow/docs/PLUGIN-INTEGRATION.md`](../../vip-workflow/docs/PLUGIN-INTEGRATION.md).

## Example extension plugins

Each `workflow-*` directory at the repo root is a real, working implementation maintained with core.

### `workflow-tool-checklist`
Configurable editorial checklist rendered as a check tool. Per-site admin UI defines the checklist items; each item shows up as a check in the editor, and results are stored in `wp_vip_ability_results`. Demonstrates a check tool with its own settings page, editor-side React UI, and hard/soft enforcement knobs.

### `workflow-assistant-wikipedia`
Research assistant that pulls Wikipedia summaries and references for a story seed. It demonstrates the Ability and assistant-manifest pattern for an external source that fetches and summarizes content.

### `workflow-agent-copy-edit`
Stage-capable agent that copy-edits post bodies for grammar, spelling, punctuation, and house style. Registers `workflow-agent-copy-edit/copy-edit` and saves content changes as attributed revisions.

### `workflow-agent-tag-sanity-check`
Stage-capable agent that flags questionable post tags without modifying the post. Registers `workflow-agent-tag-sanity-check/tag-sanity-check` with read-only annotations.

### `workflow-parsely`
Product integration that contributes Parse.ly abilities, stage agents, and a discovery provider. It demonstrates how a substantial external plugin can use several extension points without coupling its implementation to core internals.

## What the core plugin gives you

The surfaces extensions plug into:

- **Abilities API** (`wp_register_ability` / `vip_workflow_register_ability`): tools, checks, helpers, AI agents, research assistants.
- **Execution context** (`VIPWorkflow\Abilities\AbilityExecutor::current_context()`): which surface asked for the run currently executing — `transition`, `ideation`, `agent`, or `''` for a direct, user-initiated run. It travels beside the input rather than in it, because abilities declare `additionalProperties => false` and an extra input key would fail validation. Read it when one ability serves surfaces that want different things: a transition reads only your `issues` and has a user waiting on a save, so an expensive check can answer a transition from cache and compute properly for everyone else.
- **Events** (`vip_workflow_*` actions and filters; central `EventBus` for auditing): a pub/sub layer for automation and notifications.
- **Module System** (`ModuleInterface`, `vip_workflow_register_modules`): register a subsystem with its own `init()` and REST controllers.
- **Notification Channels** (`vip_workflow_notification_channels` filter + `NotificationChannel` base class): plug in delivery mechanisms.
- **Jobs** (`vip_workflow_jobs_init` + `Job` base class): register ActionScheduler-backed recurring work.
- **Discovery Providers** (`vip_workflow_register_discovery_providers`): feed story prompts into ideation.
- **Stage Agents** (`meta.stage_eligible` on an ability plus a `stage` manifest capability): an AI agent that runs when a post enters an AI-owned workflow stage, then routes the exit transition based on its outcome. See [`vip-workflow/skills/create-agent/SKILL.md`](../../vip-workflow/skills/create-agent/SKILL.md) (Stage Agents).
- **Sequences**: your extension can ship JSON sequences at activation time; the editorial sequence schema lives in `vip-workflow/includes/sequences/`.
- **Querying posts by workflow stage** (`VIPWorkflow\Workflow\StageQuery`): the workflow **stage** is decoupled from `post_status`  — `post_status` stays core-owned and core-valued, and every stage declares the `status` region (`draft`/`pending`/`private`/`publish`) it lives in; status is only written when a transition crosses a region boundary. Never query workflow posts by a `post_status` value; use `StageQuery::in_stage( $sequence, $stage_key, $args )`, `in_any_workflow( $sequence )`, `by_stage_key( $stage_key )`, or `counts_by_stage( $sequence )`. This keeps your extension correct across the underlying storage (post meta today, swappable later) and lets you find post-publish-stage posts that are legitimately `publish`.
- **Stage-change events**: the workflow actions (`vip_workflow_status_transition`, `vip_workflow_entered_{stage}`, `vip_workflow_exited_{stage}`) pass a fifth `$context` array — `[ 'cause' => 'workflow'|'core', 'committed_status' => ... ]`. `cause` distinguishes an edge traversal (`workflow`) from a checkpoint reseat after a core-driven status change (`core`); `committed_status` is the post_status core actually committed (a scheduled post commits as `future`, not `publish`). Existing four-argument listeners keep working; new listeners should read `$context` rather than infer publish state from the stage. For a "post went live" signal, hook core's `transition_post_status` instead — it fires exactly once at real go-live, including the scheduled `future → publish` case.

For a deeper map of hooks, filters, and registration points, see [`docs/reference/extension-points.md`](../reference/extension-points.md).

## Getting your tests to run

Your plugin owns its own test suite. Core's bootstrap loads only `vip-workflow.php` and never reads `active_plugins`, so the core suite cannot see your plugin even when wp-env has it active — copy [`workflow-parsely/tests/bootstrap.php`](../../workflow-parsely/tests/bootstrap.php), which loads its dependencies in order and says so in its own docblock.

Nothing in CI needs editing. The integration workflow discovers what to run, so a plugin is picked up once it has:

| What | Why |
|---|---|
| A `composer.json` | CI installs dependencies for every plugin that has one, before any suite runs |
| A `phpunit.xml` or `phpunit.xml.dist` declaring `<testsuite name="integration">` | The suite name is the probe. A config with only a `unit` suite is correctly skipped |
| An entry in `.wp-env.json`'s `plugins` array, as `"./your-plugin"` | **The one manual step.** It is what mounts your directory into `wp-content/plugins` |

That last row is the one worth remembering. It is not discovered, and without it your suite is found but cannot run — `npm run test:php:integration` refuses up front, naming your plugin and the file to add it to, rather than failing later with a path error.

Unit suites follow the same idea through a different runner: `tools/code-quality/quality.mjs` picks up a `unit` testsuite plus an installed `vendor/bin/phpunit`, so `npm run test:unit` covers your plugin the moment both exist.

To see what will run without running it:

```bash
node scripts/run-integration-suites.mjs --list
```

## Breaking changes for extension authors

### Agent entry slugs now carry the whole ability ID

An agent's **entry slug** — the value in `POST /vip-workflow/v1/assistants/{slug}/settings`, in `GET /assistants/{slug}`, in the `data-assistant-slug` DOM attribute, and in the `assistant.slug` field passed to the `vipWorkflow.assistantSettings` filter — is derived, and the derivation changed.

| | Before | After |
|---|---|---|
| Registered via a **manifest** | the slug you declared | **unchanged** |
| **Auto-generated** (no manifest claims the ability) | the ability ID's vendor prefix — `workflow-assistant-wikipedia` | the whole ability ID — `workflow-assistant-wikipedia-wikipedia` |

Two core agents moved as a result: `vip-workflow-web-researcher` and `vip-workflow-media-scout`.

**Why.** The prefix-only form collapsed every ability a plugin registered onto one slug. Both core research agents derived `vip-workflow`, and because `update_settings()` resolves through `get()` — which returns the first match — saving one card wrote to the other agent's ability, and the second agent could not be addressed at all. An entry slug is how a card addresses itself, so it has to be unique.

**What to do.** Nothing, if your plugin registers a manifest — declare a slug and it is yours. If you address an agent from JavaScript, **match on your ability ID rather than on the slug**:

```javascript
// Brittle: the slug is derived and only a manifest controls its own.
if ( assistant.slug !== 'my-plugin' ) {
	return content;
}

// Stable: ability IDs are yours and never change under you.
if ( ! assistant.ability_ids?.includes( 'my-plugin/my-ability' ) ) {
	return content;
}
```

Nothing persists an entry slug — settings write through to ability IDs and provider slugs — so there is no data migration, and there is deliberately **no legacy-slug alias**: that would be fallback code, which this project does not ship. Two entries claiming one slug now raises a `_doing_it_wrong` notice instead of failing silently.

## Good citizen rules

- Every extension plugin must declare `Requires Plugins: vip-workflow`.
- Extensions never write directly to core tables. Use the public REST endpoints and filters.
- No fallback code. If the Abilities API or a filter is missing, bail early with a notice; do not polyfill VIP Workflow internals.
- Prefix everything: plugin slug, option names, meta keys, hook names, ability IDs (e.g. `workflow-agent-copy-edit/copy-edit`).
- Respect the Coding Standards in the repo root `AGENTS.md`.

### Authorize the object, not just the action

An ability that accepts an object identifier must authorize **that object** in its own `permission_callback`.

`current_user_can( 'edit_posts' )` answers "is this caller an editor of *something*", which Contributors and above satisfy. It says nothing about the post they just named. An ability that gates on it and then reads `$input['post_id']` will hand any Contributor the body of any private or scheduled post — and if the ability forwards content to an AI provider or another external service, that content crosses the vendor boundary too.

Take `array $input` and delegate the decision:

```php
public static function can_execute( array $input ): bool|\WP_Error {
	if ( empty( $input['post_id'] ) ) {
		return new \WP_Error( 'missing_post_id', __( 'Post ID is required.', 'your-plugin' ) );
	}

	$permission_error = \VIPWorkflow\Abilities\Tools\require_post_edit_permission( (int) $input['post_id'] );
	if ( $permission_error ) {
		return $permission_error;
	}

	return true;
}
```

Three things that are easy to get wrong:

- **The callback is the gate, not the read site.** Core's Abilities REST endpoint, WP-CLI and MCP all consult `permission_callback` directly. Enforcing only inside `execute()` leaves the advertised contract wrong, and a helper that happens to check on your behalf is not a substitute — state the rule where the caller reads it.
- **Never attach array error-data to a refusal.** `AbilityExecutor` treats a `WP_Error` whose data is an array as a *success* payload, so returning `array( 'status' => 403 )` silently records the denial as a successful ability result. `require_post_edit_permission()` already gets this right; hand-rolled checks usually do not.
- **Refuse unknown identifiers the same way as forbidden ones.** If a missing object produces a different answer than an unauthorized one, the ability becomes an oracle for which IDs exist.

Ideation projects register with `capability_type => 'post'` and `map_meta_cap`, so `edit_post` is the correct capability for a `project_id` as well as a `post_id`.

### Permission-callback audit

Current state of every `workflow-*` ability, so this does not have to be re-derived:

| Plugin | Object | Callback |
|---|---|---|
| `workflow-tool-checklist` | `post_id` | Object-scoped |
| `workflow-parsely` headline-suggestions | `post_id` | Object-scoped |
| `workflow-parsely` smart-linking | `post_id` | Object-scoped |
| `workflow-parsely` smart-linking-agent | `post_id` | Object-scoped |
| `workflow-agent-copy-edit` | `post_id` | Object-scoped |
| `workflow-agent-tag-sanity-check` | `post_id` | Object-scoped |
| `workflow-assistant-wikipedia` | none | Global `edit_posts` — correct |

An ability with no object identifier has nothing to scope to, and a global capability is the right question for it. The Wikipedia assistant declares `project_id` in its input schema without reading it; if you wire that parameter up, it needs the treatment above.

Coverage lives in `vip-workflow/tests/phpunit/Unit/ExtensionAbilityPermissionTest.php` and, for the Parse.ly bridge, `workflow-parsely/tests/AbilityPermissionTest.php`. Add new abilities to whichever fits.
