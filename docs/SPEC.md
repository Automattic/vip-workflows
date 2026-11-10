# VIP Workflows specification

VIP Workflows lets an editorial team model its process as a sequence of stages in WordPress, then enforces that process where people already work: the block editor, the admin, the command palette and MCP. Any stage can be owned by a person or by an AI agent. Transitions between stages carry the team's rules: who may move the post, which checks must pass, and who hears about it.

Two promises hold across the product. Workflows is **Jetpack-independent**: it never requires Jetpack. And its AI is **configurable and transparent**: every AI step is a tool, agent or assistant that an admin can see and tune, using the site's own provider keys.

## How to use this document

This is the one spec for the plugin and its extensions in this repo. It describes what the code does on `main`, not design history. Where it and the code disagree, the code wins and this file is wrong.

- **Reviewing a PR:** read the stories the PR touches, then check the change against the [platform surface](#platform-surface) and the feature's invariants. Each feature section lists its own footguns.
- **Writing a PR:** update the parts of this file your change affects, in the same PR. A change to behavior, stored data, routes, permissions, background jobs, outbound calls or extension points always needs an update here.
- File paths are relative to the repo root. `P/` means `vip-workflows/includes/`.

Contents: [User stories](#user-stories) · [Platform surface](#platform-surface) · [Features](#features) · [Known gaps](#known-gaps) · [Proposed](#proposed)

## User stories

Workflows does nothing to a post until an admin creates a sequence for its post type and the post joins it. From then on, the stories below describe what people do with it. They are grouped by who turns it on. A PR that breaks one of them is a regression even if every test passes.

Each story ends with what must hold for it to stay true. Where the code doesn't fully keep that promise today, the gap is listed under [Known gaps](#known-gaps).

### Newsroom

**N1. An editorial team puts its whole process inside WordPress.** A publisher with writers, editors, copy chiefs, SEO and legal review runs that process partly in other tools today, with the CMS as one stop among several. An admin builds a sequence with one stage per step (Drafting, Editing, Copy, Legal, Ready), and each stage sits in the WordPress status region it belongs to. Several review stages can all be `pending` to WordPress. Writers and editors then work only in the block editor: the workflow panel shows the current stage and the moves available from it.
*Must hold:* a stage's region decides the post status. Moving between stages in the same region never changes `post_status`. → [Sequences and stages](#sequences-and-stages)

**N2. An editor can't publish around the process.** A post in a sequence can't cross into or out of the publish side (`publish`, and scheduled `future`) except through a transition that leads there. The rule holds whether the editor uses the block editor's Publish button, Quick Edit, Bulk Edit, REST, or WP-CLI run as a user. In the block editor they see an error explaining why. Removing a post from its sequence is the audited way out. Roles in the bypass list (administrators by default) are exempt.
*Must hold:* the save-layer guard covers every write path a person can use. A new write path is a footgun until it is covered. → [Publish boundary](#publish-boundary)

**N3. A transition enforces the desk's rules.** Moving a story from Editing to Ready runs the tools the transition requires: an SEO check, a checklist, a Parse.ly performance check. Hard failures stop the move, and soft warnings must be acknowledged before it goes through. Transitions can be limited to roles and can notify email or Slack when they fire.
*Must hold:* every move, from every surface (editor, Kanban drag, My Queue, MCP), goes through `StatusManager::transition()`, and its checks run on the server. A tool's configurable settings must also be declared in its input schema, or every run is rejected. → [Transitions and tools](#transitions-and-tools)

**N4. An AI agent owns a stage, and the sequence decides where the post goes next.** A commerce desk sets an AI agent on its "Affiliate Linking" stage. When a post arrives, the agent runs in the background as the post's author, inserts the links it can verify, and leaves a note on anything ambiguous (two catalog matches for one product) instead of guessing. It then returns pass or fail, and the routes the sequence author set send the post on. Fail can send it to a human review stage.
*Must hold:* an agent returns only `pass` or `fail`, and anything else is treated as an error. An agent's content changes are saved as its own attributed revision. An agent can't publish or make a post private unless the sequence allows agent publishing and the post's author holds `publish_posts`. Agent-to-agent hops stop after 10 in a row. → [Stage agents](#stage-agents)

**N5. A person and an agent don't overwrite each other.** A person can't start an AI stage while others are co-editing the post. An agent's write is abandoned if the post changed after the agent read it, and the editor asks before saving over an agent's newer write.
*Must hold:* an agent never silently replaces a newer human save. → [Stage agents](#stage-agents)

**N6. Each desk or brand runs its own process on one install.** A publisher with many mastheads, or one site with a commerce desk and a news desk, keeps a separate sequence for each, limited to its own post types. Desks change their own stages without filing an engineering ticket. A sequence can be exported from one site and imported into another, but the import is an independent copy: Workflows doesn't share or sync sequences across a network, and isn't designed to.
*Must hold:* sequences don't share state. A change to one sequence never moves or reroutes posts in another. → [Sequences and stages](#sequences-and-stages)

**N7. An editor knows what's theirs.** My Dashboard lists the posts someone wrote recently, claimed, or has been assigned. A transition can hand the post to a named person or a role. With the My Queue experiment on, the dashboard also lists posts the person can move forward next, with one-click quick actions.
*Must hold:* these lists respect read permissions. A person never sees a post they can't read. → [Assignments](#assignments), [Experiments](#experiments)

**N8. Someone can always answer "who moved this, and why?"** The post's history shows each stage change and who or what made it, with stage labels as they were at the time. The site-wide Audit Log records stage changes, blocked transitions, tool runs and warnings, assignments and claims.
*Must hold:* every committed stage change, by a person, an agent or MCP, writes exactly one history entry. A path that changes stage without one is a bug. → [Audit and history](#audit-and-history)

**N9. A newsroom plans coverage before a draft exists (Ideation experiment).** Story discovery sources bring in candidate stories. Research agents gather background, and Parse.ly data scores a topic against how similar coverage performed. An idea becomes a draft through the Ideation → Editorial phase sequence, which can carry its own required tools and role limits.
*Must hold:* with the experiment off, its routes, menus, research agents and source processing are gone, and no ideation data is deleted. → [Ideation](#ideation), [Experiments](#experiments)

### Marketing, communications and corporate publishing: approvals and governance

For these teams, Workflows is about approvals. The question each story answers is "can I be sure the right person signed off before this went out?"

**M1. Legal always touches it last.** As the legal reviewer, I can be sure I'm the last person to act on a piece before it goes out, so I can protect the company's reputation. The sequence author makes Legal the stage whose outgoing transition leads to publishing, and limits that transition to the legal role (which also needs `publish_posts`). Nobody outside the bypass list can publish or schedule the post, including an editor whose WordPress role would normally allow it. Stages don't lock editing, so other people can still change the post while it waits in Legal. What Workflows guarantees is that Legal makes the move that publishes it, so whatever goes out is the version in front of Legal when they publish.
*Must hold:* the only ways into `publish` or `future` are transitions that lead there, and those transitions' role limits are checked on the server for every caller. → [Transitions and tools](#transitions-and-tools), [Publish boundary](#publish-boundary)
*Footguns:* a stage is not a content lock. A PR that adds stage-based locking changes this story and must say so. Administrators are in the bypass list by default, so the site's bypass list is part of this story's configuration.

**M2. A press release can't go out early.** A communications team drafts and vets releases before they reach WordPress. Staff can create and edit but never publish, because an early release is a real incident. The sequence ends in a final approval stage, and only the approver role can take the transition that publishes.
*Must hold:* role limits on a transition are checked on the server, and the publish boundary (N2) holds even for users whose WordPress role could normally publish. → [Transitions and tools](#transitions-and-tools), [Publish boundary](#publish-boundary)

**M3. Scheduling counts as publishing.** An approver sets a release to go out at 9:00 tomorrow. To Workflows, a scheduled post is already on the publish side: moving a post to scheduled takes the same transition, and the same rights, as publishing it now. Someone who can't publish a post can't schedule it either, and changing the date doesn't get around the approval. When the time comes, WordPress publishes the post itself, and Workflows lets that through because no person is crossing the boundary.
*Must hold:* `future` is treated as publish-side everywhere the publish boundary is checked. Core's scheduled `future` → `publish` write is the only exemption. → [Publish boundary](#publish-boundary)

**M4. A research blog replaces custom statuses and email chains.** A team whose process was Draft → Design Review → Editorial Approval → Author Sign-off → Scheduled models it one stage per step. Transitions send email or Slack messages to configured recipients, and everyone can see live status in WordPress instead of in a separate tracker.
*Must hold:* notifications are sent after a move commits. A failing channel never blocks or rolls back a move. → [Notifications](#notifications)

**M5. A team sets up a workflow by describing it.** Someone connected over MCP describes their process in plain language (for example, an eight-stage approval flow), and an agent creates the sequence through the `create-sequence` ability. The sequence is active by default, or saved as a draft for review when the caller asks.
*Must hold:* sequences created over MCP or REST go through the same validation as the sequence editor. The sequence schema is the contract. → [Sequences and stages](#sequences-and-stages), [REST and Abilities](#rest-and-abilities)

### Admins and developers

**A1. An admin tunes the AI instead of trusting it.** Every tool and agent is listed under Workflows → Tools and Agents, with its settings (house style, keyword list, minimum score) visible and editable, and the prompts ideation uses can be read and overridden. Agents use the site's own API keys. With no key configured, the UI says so, and nothing falls back to a hosted default.
*Must hold:* configurable, transparent AI. No AI call happens without a configured provider, and none happens outside a visible tool, agent or assistant. Workflows never requires Jetpack. → [Outbound calls](#outbound-calls)

**A2. A developer adds a check, agent or channel as an ordinary plugin.** A tool or agent is a WordPress Ability registered with Workflows. A notification channel is a registered class. Each ships as its own plugin, and the same tool works in a transition, in the command palette and over MCP.
*Must hold:* the extension points in [Extension points](#extension-points) are public API. Renaming or removing one is a breaking change, and the PR must call it out. → [Extension points](#extension-points)

**A3. An admin tries an unfinished feature without committing to it.** Ideation, Kanban, Calendar and My Queue are experiments, off by default and switched on per site.
*Must hold:* turning an experiment off removes its UI and stops its background work without deleting data. → [Experiments](#experiments)

## Platform surface

What a PR can change underneath the features: stored data, routes, permissions, background work, outbound calls and extension points. A PR that touches any of these updates the matching table.

### Stored data

**Custom tables.** All are created by `dbDelta` in `P/database/class-schema.php` (`create_tables()`), listed in `Schema::get_owned_tables()`, and dropped on uninstall.

| Table (`{prefix}` + …) | One row is | Read/written by |
| --- | --- | --- |
| `vip_sequences` | One sequence (workflow or phase) version: stages, transitions and fields as JSON in `config` | `P/sequences/class-sequence-repository.php` (object cache group `vip_sequences`) |
| `vip_workflows_events` | One audit-log event (transition, assignment, tool run, config change) with actor | `P/automation/class-event-bus.php`, `P/workflow/class-status-manager.php`; read by `P/api/class-audit-log-controller.php` |
| `vip_ability_results` | One ability/tool run's result for a post | `P/abilities/class-ability-result-repository.php` |
| `vip_ideation_sources` | One research source (URL, upload, search hit) attached to an ideation project | `P/api/class-ideation-sources-controller.php`, `P/ideation/research/class-source-processing-job.php` |
| `vip_ideation_analyses` | One AI tool output for an ideation project | `P/api/class-ideation-controller.php`, `P/ideation/research/class-ideation-post-types.php` |
| `vip_story_objects` | Join row: story ↔ post/object | `P/story/class-story.php` |
| `vip_workflows_roles` | Workflow role definition | Seeded by `P/database/class-seeder.php`; nothing reads it |
| `vip_workflows_desks`, `vip_workflows_user_desks`, `vip_workflows_notifications` | (unused) | Created by the schema; no code reads or writes them |

Retention: `P/maintenance/class-cleanup.php` runs nightly via Action Scheduler (`vip_workflows_cleanup`) and deletes `vip_ability_results` rows older than 90 days and `vip_workflows_events` rows older than one year.

**Post meta** (all underscore-prefixed, so protected, except where noted).

| Key | Purpose | Owner |
| --- | --- | --- |
| `_vip_workflows_sequence_id` | Sequence managing the post. Registered with `show_in_rest => false`; zeroing it removes the post from the workflow | `P/workflow/class-status-manager.php`, registered in `P/class-plugin.php` |
| `_vip_workflows_current_stage_key` | Current stage; the only authority for stage, never inferred from `post_status` | `P/workflow/class-status-manager.php` |
| `_vip_workflows_transition_data` | Per-stage transition data | `P/workflow/class-status-manager.php` |
| `_vip_workflows_assignment_{slot}` | One assignment slot | `P/workflow/class-assignment-manager.php` |
| `_vip_workflows_pending_assignee` | Multi-value index of users with pending assignments (feeds My Work) | `P/workflow/class-assignment-manager.php` |
| `_vip_workflows_assigned_to` | Claim (who took the post) | `P/api/class-workflow-controller.php` |
| `_vip_workflows_agent_job`, `_agent_chain`, `_agent_last_run` | Stage-agent job state | `P/workflow/class-stage-agent-runner.php` |
| `_vip_workflows_agent_actor` | On a revision: the agent ability that made the edit | `P/workflow/class-stage-agent-runner.php` |
| `wf_meta_{sequence_id}_{field_key}` | Sequence-defined metadata field. **Public key, `show_in_rest => true`**; writes gated by `edit_post`, reads filtered for users who cannot edit the post | `P/class-plugin.php` (`register_metadata_fields()`) |
| `_vip_ideation_*` (`seed`, `seed_analysis`, `board_cards`, `pinned_cards`, `dismissed_cards`, `query_log`, `assistant_statuses`, `suggested_title`, `asst_{id}`, `project_id`) | Ideation project state, all on `vip_ideation` posts except `project_id`, which is on the draft created from a project | `P/ideation/assistants/class-ideation-orchestrator.php`, `P/api/class-ideation-controller.php` |
| `vip_draft_ai_context` | AI provenance on a draft created from ideation. **Public key** (no underscore) | `P/api/class-ideation-controller.php` |
| `_vip_discovery_prompt` | Discovery prompt on a project | `P/api/class-discovery-controller.php` |
| `_vip_story_id` | Story a post belongs to | `P/story/class-story.php` |

**Options** (autoload is default unless noted).

| Option | Purpose | Owner |
| --- | --- | --- |
| `vip_workflows_db_version` | Schema version | `P/database/class-schema.php` |
| `vip_workflows_sequences_need_region_review` | Sequences a migration could not fully repair, which drives an admin notice (`autoload` off) | `P/database/class-schema.php`, `P/admin/class-admin.php` |
| `vip_workflows_assignee_index_backfill_cursor`, `…_lease` | 2.27.0 backfill progress and lease | `P/database/class-schema.php` |
| `vip_workflows_settings` | General settings, including the bypass, tool-bypass and audit-log role lists | `P/admin/class-settings.php`, `P/api/class-general-settings-controller.php` |
| `vip_workflows_experiments` | Experiment toggles | `P/experiments/class-experiment-registry.php` |
| `vip_workflows_ability_settings` | Per-tool settings and enabled flags | `P/abilities/class-ability-settings.php` |
| `vip_workflows_prompts` | Prompt overrides | `P/ai/class-prompt-settings.php` |
| `vip_workflows_ai_provider`, `vip_workflows_ai_models` | AI provider and model choice | `P/ai/class-credentials.php`, `P/api/class-general-settings-controller.php` |
| `vip_workflows_ai_model`, `vip_workflows_api_keys` | Legacy, read only as a fallback (keys stored encrypted) | `P/ai/class-credentials.php`, `P/ai/class-legacy-credential-backend.php` |
| `vip_workflows_tavily_api_key`, `vip_workflows_youtube_api_key` | API keys registered as core Connectors settings (also settable by constant or env var `VIP_WORKFLOWS_*_KEY`) | `P/ai/class-connectors-credential-backend.php` |
| `vip_workflows_search_provider` | Ideation search provider | `P/ideation/research/search-providers/class-search-provider-registry.php` |
| `vip_workflows_notification_routing`, `vip_workflows_notification_debug` | Event → channel routing, debug flag | `P/notifications/class-notification-dispatcher.php` |
| `vip_workflows_channel_{id}`, `vip_workflows_slack_destinations` | Per-channel settings (Slack webhook config) | `P/notifications/class-notification-channel.php`, `P/notifications/channels/class-slack-channel.php` |
| `vip_discovery_provider_settings`, `vip_discovery_provider_{slug}`, `vip_discovery_cache_generation` | Discovery/assistant enablement, config, cache generation | `P/assistants/class-assistant-registry.php` |
| `vip_workflows_hourly_{hour}_{action}_{subject}` | Rate-limit counter, **only without a persistent object cache** (otherwise cache group `vip_workflows_hourly_limit`). `autoload` off; the next hour's row deletes older ones | `P/integrations/class-hourly-limit.php` |

**Transients:** `vip_workflows_publish_veto_{user}_{post}` (60 s veto notice, `P/workflow/class-publish-boundary-guard.php`), `vip_workflows_ai_models_{provider}` (`P/ai/class-ai-models.php`), `vip_workflows_ai_request_{id}` (`P/ai/class-event-dispatcher.php`), `vip_notification_{channel}_{event}_{post}` (rate limit, `P/notifications/class-notification-dispatcher.php`), `vip_discovery_{recommend,search,filters}_*` (`P/api/class-discovery-controller.php`), `vip_ideation_{assistant}_{hash}` (`P/ideation/assistants/class-ideation-orchestrator.php`). **User meta:** none.

**Post types and statuses.** `vip_story` (`P/story/class-story.php`, always registered, not in REST) and `vip_ideation` (`P/ideation/research/class-ideation-post-types.php`, only with the `ideation` experiment, REST at `vip-workflows/v1/vip-ideation`). `register_post_status()` is global, not per post type: Story registers `ideation`, `editorial`, `published`, `monitoring`, `refresh` and `archived` on every site, and Ideation adds `active` and `archive`. Workflow stages are **not** post statuses: they live in `_vip_workflows_current_stage_key`, and `post_status` changes only when a move crosses a status region.

**Activation, deactivation and uninstall** (`vip-workflows/vip-workflows.php`, `vip-workflows/uninstall.php`).

- Activation runs `Schema::install()` and `Seeder::seed()`, which seeds roles and the Editorial Review sequence. It flushes rewrite rules except on VIP (`WPCOM_IS_VIP_ENV`).
- Deactivation unschedules `vip_workflows_check_sla_breaches` and flushes rewrites except on VIP. It does **not** unschedule `vip_workflows_cleanup`: Cleanup listens for `vip_workflows_deactivated`, which nothing fires.
- Uninstall drops the ten owned tables and deletes `vip_workflows_db_version`. It **keeps** every other option, all post meta, `vip_ideation`/`vip_story` posts, attachments, hourly-limit rows and scheduled actions. It runs for the current site only, with no multisite loop.

**Schema versioning.** `Schema::VERSION` (currently `2.27.0`) is compared with the `vip_workflows_db_version` option by `maybe_upgrade_schema()` on `init` priority 1, on every request type (REST, cron, CLI, front end). `install()` re-runs `dbDelta` for all tables, then `run_migrations()` runs every `get_migrations()` entry newer than the stored version, then stores the new version. There is no lock, so two requests can migrate at once. A migration can throw `MigrationDeferred` (`P/database/class-migration-deferred.php`) to resume on a later request without bumping the version, which 2.27.0's time-boxed, leased backfill does. Any other failure is logged and retried on the next request.

Rule for adding a migration (from the docblock on `run_migrations()`): bump `Schema::VERSION`, then append `['version' => 'x.y.z', 'run' => callable]` to `get_migrations()` in ascending order. The callable **must be idempotent**, because failed runs retry and fresh installs run every migration against an already-current schema. Guard DDL with `IF EXISTS`/`IF NOT EXISTS`. Put anything `dbDelta` silently ignores (DROP/RENAME/MODIFY COLUMN, DROP INDEX) in a migration. A column or table added to `create_tables()` needs a version bump, or existing sites never run `dbDelta`. A new table must also be added to `get_owned_tables()`, or uninstall leaves it behind.

### REST and Abilities

Namespace: `vip-workflows/v1` (`RestController::NAMESPACE`, `P/api/class-rest-controller.php`). Extensions use their own namespace (`workflow-tool-checklist/v1`). No route uses `__return_true` or `is_user_logged_in`. The weakest gate is `edit_posts`.

| Route (under `/vip-workflows/v1`) | Methods | Permission | Controller (`P/api/…`) |
| --- | --- | --- | --- |
| `/status` | GET | `manage_options` | `class-rest-controller.php` |
| `/workflow/post/{id}/status`, `/history`, `/ideation` | GET | `edit_post` on `{id}` | `class-workflow-controller.php` |
| `/workflow/post/{id}/transition`, `/agent-revert`, `/claim`; `/sequence` (POST assign, DELETE remove); `/unclaim` (DELETE) | POST/DELETE | `edit_post` on `{id}`, then the sequence's transition rules (see [Capabilities and roles](#capabilities-and-roles)) | `class-workflow-controller.php` |
| `/workflow/my-work`; `/my-queue`, `/kanban`, `/calendar` (only when the experiment is on) | GET | `edit_posts`; rows filtered per post by `edit_post` | `class-workflow-controller.php` |
| `/sequences`, `/sequences/{id}`, `/sequences/slug/{slug}`, `/{id}/export`, `/{id}/stats`, `/sequences/options` | GET | `edit_posts` | `class-sequences-controller.php` |
| `/sequences` (POST), `/sequences/import`, `/sequences/{id}` (POST/PUT/PATCH full replace, DELETE), `/{id}/repair-regions` | write | `manage_options` | `class-sequences-controller.php` |
| `/abilities`, `/abilities/{id}` | GET | `edit_posts`, or `edit_post` when `post_id` is given | `class-abilities-controller.php` |
| `/abilities/{id}/run` | POST | `edit_posts` and `edit_post` on the target object; core `WP_Ability::execute()` then applies the ability's own callback | `class-abilities-controller.php` |
| `/posts/{post_id}/ability-results` | GET | `edit_posts` and `edit_post` | `class-abilities-controller.php` |
| `/posts/{id}/metadata` | GET | `edit_post` | `class-metadata-controller.php` |
| `/assignable-users` | GET | `edit_posts` | `class-assignable-users-controller.php` |
| `/audit-log`, `/audit-log/event-types`, `/audit-log/users` | GET | Role in `audit_log_roles` (default administrator, editor); rows limited to the user's own actions unless the role is in `audit_log_full_access_roles` (default administrator) | `class-audit-log-controller.php` |
| `/settings/general`, `/settings/general/roles`, `/settings/experiments`, `/tools`, `/tools/{id}/settings`, `/prompts`, `/prompts/{id}`, `/assistants`, `/assistants/{slug}`, `/assistants/{slug}/settings` | GET/POST | `manage_options` | `class-general-settings-controller.php`, `class-experiments-controller.php`, `class-tools-controller.php`, `class-prompts-controller.php`, `class-assistants-controller.php` |
| `/notifications/channels`, `/notifications/events`, `/notifications/{channel}/settings`, `/notifications/{channel}/test`, `/notification-routing`, `/notification-debug`, `/slack-destinations` | GET/POST | `manage_options` | `class-notifications-controller.php` |
| `/url-meta` | GET | `edit_posts`. Fetches a caller-supplied URL server-side through `P/integrations/class-ssrf-guard.php` | `class-utility-controller.php` |
| `/ideation` (GET list), `/ideation/seed` (POST) | GET/POST | `edit_posts` | `class-ideation-controller.php` (ideation experiment only) |
| `/ideation/{id}` (GET/DELETE) and `/{id}/pin`, `/unpin`, `/dismiss`, `/restore`, `/run-assistant`, `/restart-analysis`, `/query`, `/mentor`, `/generate-image`, `/create-draft`, `/check-phase-transition`, `/summarize`, `/summary` | GET/POST/DELETE | `edit_posts` and (project author or `edit_others_posts`). The gate does not check post type; each handler does | `class-ideation-controller.php` |
| `/ideation/{id}/sources`, `/sources/{source_id}` (PUT/PATCH/DELETE), `/sources/{source_id}/summarize`, `/reprocess` | POST/PUT/DELETE | Same author-or-`edit_others_posts` gate, plus a post type check | `class-ideation-sources-controller.php` |
| `/ideation/{id}/sources/upload` | POST | `upload_files` and the gate above | `class-ideation-sources-controller.php` |
| `/discovery/providers`, `/recommend`, `/search`, `/filters`; `/discovery/select` (POST) | GET/POST | `edit_posts` | `class-discovery-controller.php` (ideation experiment only) |
| `/vip-ideation` (core posts controller for the CPT) | core | CPT custom caps; see [Capabilities and roles](#capabilities-and-roles) | `P/ideation/research/class-ideation-post-types.php` |
| `/workflow-tool-checklist/v1/items` | GET / POST | `edit_posts` / `manage_options` | `workflow-tool-checklist/workflow-tool-checklist.php` |
| `/workflow-tool-checklist/v1/post/{post_id}/checked` | GET/POST | `edit_post` | `workflow-tool-checklist/workflow-tool-checklist.php` |

**Abilities** (WordPress Abilities API, registered on `wp_abilities_api_init` from `P/class-plugin.php`, categories `vip-workflows` and `research`). "MCP public" means `meta.mcp.public => true`, so MCP adapters expose the ability to agents acting as the user. Abilities that take a `post_id` check `edit_post` inside execution with `require_post_edit_permission()` (`P/abilities/tools/helpers.php`). List-type abilities filter each row by `edit_post`.

| Ability id | Does | Permission callback | File |
| --- | --- | --- | --- |
| `vip-workflows/create-sequence`, `import-sequence`, `update-sequence`, `activate-sequence`, `validate-sequence` | Author and activate sequences (import creates a draft; update is a full replace) | `manage_options`; MCP public | `P/abilities/tools/{name}.php` |
| `vip-workflows/transition-post` | Move a post along its sequence, through the same gate as REST | `edit_posts`, then `edit_post` in execute; MCP public | `P/abilities/tools/transition-post.php` |
| `vip-workflows/remove-from-workflow` | Clear a post's sequence (audited), leaving its status | `edit_posts`, then `edit_post`; MCP public | `P/abilities/tools/remove-from-workflow.php` |
| `vip-workflows/update-post-fields` | Change title, excerpt, date or author (an author change needs `edit_others_posts`) | `edit_posts`, then `edit_post`; MCP public | `P/abilities/tools/update-post-fields.php` |
| `vip-workflows/get-sequences`, `get-workflow-summary`, `get-posts-by-status`, `get-stale-posts`, `get-recent-activity`, `get-my-assignments`, `get-available-transitions`, `get-transition-history` | Read-only queries | `edit_posts`; per-post ones check `edit_post`; MCP public | `P/abilities/tools/{name}.php` |
| `vip-workflows/seo-check`, `keyword-check`, `readability` | Stage tools (checks) | `edit_posts`, then `edit_post` | `P/abilities/tools/{name}.php` |
| `vip-workflows/archive-scout`, `web-researcher`, `media-scout` | Ideation research assistants (web and media calls out to Tavily or YouTube) | `edit_posts` | `P/ideation/assistants/class-*.php` |
| Extension abilities: `workflow-agent-copy-edit/copy-edit`, `workflow-agent-tag-sanity-check/tag-sanity-check`, `workflow-parsely/{headline-suggestions, performance-check, performance-signals, smart-linking, smart-linking-check}`, `workflow-tool-checklist/checklist`, `workflow-assistant-wikipedia/wikipedia` | Stage agents, tools, research | `edit_posts`-level, plus `edit_post` on `post_id` where one is taken | each extension's main file or `includes/` |

Stage agents run in the background (Action Scheduler) and call `wp_set_current_user()` to act as the post's author (`P/workflow/class-stage-agent-runner.php`). If the author cannot edit the post, the run stops in place. Agent edits are therefore authored by that user and pass that user's capability checks.

### Capabilities and roles

**The plugin adds no capabilities and grants nothing to any role.** It does not call `add_cap()` or `add_role()` and has no `user_has_cap` filter. Everything checks core capabilities, plus three **role-name lists** in `vip_workflows_settings` that act as policy, not capabilities.

| Action | Check | Where |
| --- | --- | --- |
| Use Workflows screens (My Dashboard, Kanban, Calendar, Ideation) | `edit_posts` | `P/admin/class-admin.php` |
| Read or move a specific post | `edit_post` on the post, then the transition's `allowed_roles` (role names in the sequence config) and required tools and fields | `P/api/class-workflow-controller.php`, `P/sequences/class-sequence.php` (`get_role_permitted_transitions()`), `P/workflow/class-status-manager.php` |
| Create, edit, activate, import or delete sequences | `manage_options` (read: `edit_posts`) | `P/api/class-sequences-controller.php`, sequence abilities |
| Settings, experiments, tools, agents, prompts, notifications, assistants | `manage_options` | the controllers in [REST and Abilities](#rest-and-abilities), `P/admin/class-settings.php`, `P/admin/class-admin.php` |
| Audit log visibility | Role in `audit_log_roles` (default `administrator`, `editor`); seeing others' events needs a role in `audit_log_full_access_roles` (default `administrator`) | `P/admin/class-settings.php` (`can_user_view_audit_log()`, `can_user_view_all_audit_logs()`) |
| Ideation projects | `edit_posts` and (author or `edit_others_posts`); uploads also need `upload_files` | `P/api/class-ideation-controller.php`, `P/api/class-ideation-sources-controller.php` |
| `vip_ideation` posts through core APIs | The CPT maps to custom capabilities (`edit_ideation_projects`, `edit_others_ideation_projects`, and so on) that no role is granted, so core `edit_post` and the core `/vip-ideation` route deny everyone except super admins. The plugin's own controllers use the author-or-`edit_others_posts` gate above | `P/ideation/research/class-ideation-post-types.php` |
| Sequence metadata fields (`wf_meta_*`) | `edit_post` for writes, and REST reads filtered by it | `P/class-plugin.php` |

**Bypass.** `Settings::can_user_bypass_workflow()` (`P/admin/class-settings.php`) is true when one of the user's roles is in `bypass_workflow_roles`, default `['administrator']`. A bypass user sees every transition, not just those their roles allow. `PublishBoundaryGuard` (`P/workflow/class-publish-boundary-guard.php`) skips its veto for them, and the client shows a confirmation instead. A separate list, `bypass_tool_check_roles` (default `['administrator']`, `can_user_bypass_tool_checks()`), lets users skip required tool checks on a transition.

The guard vetoes a non-bypass user's `post_status` change across the publish boundary on a workflow-managed post. It hooks `wp_insert_post_data` (reverts the status silently) and `rest_pre_insert_{post_type}` (returns a `WP_Error`). It never vetoes a userless write (WP-CLI without `--user`, cron, importers). Leaving Trash for a non-publish status is exempt; restoring straight to `publish` is not. The audited way through is `DELETE /workflow/post/{id}/sequence` or the `remove-from-workflow` ability.

### Background work

Workflows uses two queues. **Action Scheduler (Action Scheduler)** is bundled through Composer (`woocommerce/action-scheduler ^3.7`) and loaded from `vip-workflows/vip-workflows.php` when it is in `vendor/`. **WP-Cron** is used directly for stage agents and by the Parse.ly extension. On VIP, Cron Control runs both queues. AS also runs work on admin requests through its own async loopback runner. With `DISABLE_WP_CRON` and no runner, which is common in local environments, nothing in this table runs. Every row also says what the user sees when that happens.

| Hook | Queue and trigger | What it does | Owner | If cron does not run |
| --- | --- | --- | --- | --- |
| `vip_workflows_run_stage_agent` (`$post_id, $stage_key`) | WP-Cron single event at `time()`, scheduled when a post enters a stage whose config has `agent.ability_id` (listens on `vip_workflows_status_transition`) | Runs the stage's agent ability, then routes the post by pass, fail or error | `vip-workflows/includes/workflow/class-stage-agent-runner.php` | Post meta `_vip_workflows_agent_job` stays `pending`. After `PENDING_TTL` (15 min), `StatusManager::has_pending_agent_job()` treats it as failed so the post is not gated forever. The agent never runs. |
| `vip_workflows_run_agent` (`$task_data`) | WP-Cron single event, scheduled on `vip_workflows_agent_assigned` | Legacy agent path: calls a handler registered through the `vip_workflows_agents` filter and marks the assignment completed or expired | `vip-workflows/includes/workflow/class-agent-runner.php` | The assignment stays open. Nothing in this repo registers a `vip_workflows_agents` handler. |
| `vip_workflows_send_notification` (`channel_id, event_type, data`) | AS async action, group `vip-workflows-notifications`. Enqueued by `NotificationDispatcher::dispatch()` on stage transitions and on core go-live | Sends one notification to one channel (Slack webhook or `wp_mail`) | `vip-workflows/includes/notifications/class-notification-dispatcher.php` | Notifications queue up and are not sent. If AS is missing, the send runs synchronously inside the transition request (Slack timeout is 15 s). A failed send is logged, not retried. |
| `vip_workflows_process_source` (`$project_id, $source_id`) | AS async action, group `vip-workflows`. Enqueued by the ideation source upload and reprocess REST routes | Extracts, transcribes and summarizes an uploaded ideation source with AI (see [Outbound calls](#outbound-calls)) | `vip-workflows/includes/ideation/research/class-source-processing-job.php`, enqueued in `vip-workflows/includes/api/class-ideation-sources-controller.php` | The source stays `pending` with no summary. A job killed mid-run leaves the source in `processing` permanently, with no retry. Only registered while the `ideation` experiment is on. |
| `vip_workflows_cleanup` | AS recurring, daily. First run is 02:00 of today's site date, with `strtotime` interpreting that time as UTC. Scheduled on `admin_init` when it is not already scheduled | One `DELETE` per table: `vip_ability_results` older than 90 days and `vip_workflows_events` older than 1 year. Writes a `maintenance.cleanup` audit event. | `vip-workflows/includes/maintenance/class-cleanup.php` | Both tables grow without bound. |
| `workflow_parsely_poll_discovery` | WP-Cron recurring, custom schedule `workflow_parsely_poll` (default 15 min, filter `workflow_parsely_poll_interval`, minimum 60 s). Scheduled on every `init` when Parse.ly is enabled and configured | Calls every discovery provider's `recommend` callback and queues unscored items for scoring | `workflow-parsely/includes/discovery/class-discovery-poller.php` | Scores only fill in after someone opens ideation. |
| `workflow_parsely_warm_prompt_scores` | WP-Cron single event, `time() + 30`. It reschedules itself while the queue has items | Scores 4 queued prompts per run against Parse.ly. The queue is an option capped at 200; scores are cached for 1 day and errors for 15 min. | `workflow-parsely/includes/discovery/class-prompt-scorer.php` | Cards show no score. |
| `workflow_parsely_warm_performance_checks` | WP-Cron single event, `time() + 30`, self-rescheduling | Warms the performance-check cache, 2 posts per run, queue capped at 200 | `workflow-parsely/includes/abilities/class-performance-check.php` | The check computes on demand, which is slower. |

What bounds these loops:

- Stage agent chains stop after `MAX_CHAIN` = 10 consecutive agent-to-agent hops. The post then fails in place, never along an error route.
- A duplicate stage-agent event for the same post and stage is treated as already queued.
- The Parse.ly warmers are bounded by batch size, the queue cap and `wp_next_scheduled()` dedupe.
- There are no other retries.

Reviewer notes:

- `Cleanup::run()` deletes with no `LIMIT`. On a large table the first run is one long `DELETE`.
- `vip_workflows_activated` and `vip_workflows_deactivated` are never fired. As a result, cleanup is scheduled only by an admin page load and is never unscheduled when the plugin is deactivated.
- The plugin's `deactivate()` unschedules `vip_workflows_check_sla_breaches`, which nothing schedules.
- The Parse.ly poll runs whether or not the `ideation` experiment is enabled.

### Outbound calls

**AI provider calls.** Every generation call goes through WordPress core's PHP AI Client (`\WordPress\AiClient\AiClient::prompt()`). The supported providers are OpenAI, Anthropic and Google. Workflows registers the vendored OpenAI provider itself, because core ships no concrete providers.

How keys resolve, in order (`vip-workflows/includes/ai/class-credentials.php`):

1. The constant (`VIP_WORKFLOWS_{OPENAI|ANTHROPIC|GOOGLE|TAVILY|YOUTUBE}_KEY`).
2. WP Connectors, when `wp_get_connector()` exists (`class-connectors-credential-backend.php`).
3. Otherwise the legacy options backend.

The provider is the stored `vip_workflows_ai_provider` setting, or is derived from whichever keys exist. With no key, `AiAvailability` reports the surface as unconfigured and the UI says so. There is no hosted or default provider. `Plugin::init_ai_client()` (`vip-workflows/includes/class-plugin.php`) raises `http_request_timeout` to 60 s for `api.openai.com`, `api.anthropic.com` and `generativelanguage.googleapis.com`.

| Call site | Fires when | Data sent | Owner |
| --- | --- | --- | --- |
| Stage agents (copy edit, tag sanity, smart linking) | A post enters an AI stage that the sequence author configured (WP-Cron, see [Background work](#background-work)) | Post title, body and tags, wrapped as untrusted input. Copy edit writes a revision back to the post. | `vip-workflows/includes/abilities/agents/class-stage-agent.php`, `workflow-agent-*/`, `workflow-parsely/includes/agents/` |
| Source processing | An ideation source is uploaded or reprocessed (Action Scheduler) | Image bytes (vision), extracted PDF text, and summaries of transcripts | `vip-workflows/includes/integrations/class-media-processor.php` |
| Whisper transcription | Audio or video source, 25 MB maximum, 120 s timeout | **The raw media file**, sent directly with `wp_remote_post` to `api.openai.com/v1/audio/transcriptions`. Always uses the OpenAI key, whichever provider is selected. | `vip-workflows/includes/integrations/class-media-processor.php` |
| Ideation assistants (seed analyst, editorial mentor, archive search, draft generation, source and project summaries, AI images) | An editor acts in the Ideation UI (REST) | Seed text, source content, project context and site search results | `vip-workflows/includes/ideation/assistants/`, `vip-workflows/includes/ideation/research/class-ideation-analyzer.php`, `vip-workflows/includes/api/class-ideation-controller.php` |
| Video analysis | An editor pins a video card. The call runs only when AI is configured. | The YouTube transcript | `vip-workflows/includes/api/class-ideation-controller.php` |

Every AI call above starts from one of three places: a sequence an administrator configured, a tool or assistant an editor ran, or an upload. No AI call runs on a timer. The Parse.ly poll calls Parse.ly, not an LLM.

Footgun: `AiClient::setEventDispatcher()` replaces core's AI event dispatcher **site-wide**. As a result:

- Every AI call made by any plugin fires `vip_workflows_ai_before_generate` and `vip_workflows_ai_after_generate`.
- Every call also writes a one-hour transient holding the full prompt messages, which nothing reads back.
- Provider authentication is set on core's shared registry, so other plugins can use Workflows' keys.

**Other HTTP calls.**

| Destination | When | Data sent | Timeout and failure | Owner |
| --- | --- | --- | --- | --- |
| `hooks.slack.com`, `hooks.slack-gov.com` (host allowlist through `SsrfGuard`) | Notification send, or the "test" button | Post title, author name, stage labels | 15 s. Logged and returns false. No retry. | `vip-workflows/includes/notifications/channels/class-slack-channel.php` |
| `wp_mail` | Email channel | The same fields, sent to the configured recipients | Platform mailer | `vip-workflows/includes/notifications/channels/class-email-channel.php` |
| `api.tavily.com/search` | Web researcher assistant, media scout, and stage-agent web grounding (only when a Tavily key is set) | The search query | 30 s / 20 s. Returns an error or an empty result. | `vip-workflows/includes/ideation/research/search-providers/class-tavily-provider.php`, `vip-workflows/includes/ideation/assistants/class-tavily-*-provider.php` |
| `www.googleapis.com/youtube/v3/*` | Media scout (only when a YouTube key is set) | The search query | 5 s through `vip_safe_wp_remote_get` | `vip-workflows/includes/ideation/assistants/class-you-tube-video-provider.php` |
| `www.youtube.com/youtubei/v1/player` and caption URLs | Pinning a video card | The video ID. Uses an undocumented YouTube endpoint and a spoofed browser user agent. | 15 s. The analysis is skipped. | `vip-workflows/includes/integrations/class-you-tube-transcript.php` |
| Any user-supplied URL | Adding a URL source, the URL preview utility route, analyzing or sideloading an image card | Plain GET. `SsrfGuard` blocks private IPs and sets redirects to 0. | 10 s for metadata, 30 s for downloads | `vip-workflows/includes/integrations/class-url-meta-extractor.php`, `vip-workflows/includes/integrations/class-ssrf-guard.php`, `vip-workflows/includes/api/class-ideation-controller.php` |
| `en.wikipedia.org/w/api.php` | The Wikipedia research assistant runs | The search query | 5 s through `vip_safe_wp_remote_get` | `workflow-assistant-wikipedia/workflow-assistant-wikipedia.php` |
| Parse.ly Content API and Suggestions API, through wp-parsely's service classes. Requires the wp-parsely plugin and its `apikey`/`api_secret` option. | Smart links, headline suggestions, performance tools, the poll and the warmers | **Post content** (smart links, title suggestions), headlines and URLs | Set by wp-parsely | `workflow-parsely/includes/class-parsely-client.php` |
| VIP Telemetry library (Pendo and Tracks), only when `Automattic\VIP\Telemetry\Telemetry` exists | Tool runs, agent runs, transition gates, rate-limit hits | Counts, outcomes and durations. No content. | Errors are swallowed | `vip-workflows/includes/telemetry/class-tracker.php` |

Other outbound behavior:

- The browser embeds YouTube and Vimeo iframes for video cards (`vip-workflows/src/admin/components/ideation/cards/ImageCard.js`).
- `ContentExtractor` (`vip-workflows/includes/integrations/class-content-extractor.php`) has no callers.
- **Jetpack:** no PHP, JS or Composer reference anywhere in the core plugin or the extensions. Parse.ly goes through wp-parsely, not Jetpack.
- `Tracker::record()` briefly calls `wp_set_current_user()` to attribute events that cron starts.

### Extension points

Rows marked **[ext]** are used by a shipped `workflow-*` extension. Renaming one of them breaks that extension.

**Registries and how to join them.**

| Registry | Register with | Owner |
| --- | --- | --- |
| Abilities (tools, stage agents, research assistants) | `vip_workflows_register_ability( $name, $args )` **[ext]** wraps `wp_register_ability()` and adds `ability_class` = `VIPWorkflows\Abilities\Ability`. Call it on `wp_abilities_api_init` **[ext]** or `vip_workflows_register_abilities` **[ext]**, which fires at the end of the core registration. `meta` keys decide the surface: `type`, `supports` (`stage`), `stage_eligible`, `settings_schema`, `availability_callback`, `show_in_rest`. Categories are `vip-workflows` and `research` **[ext]**. | `vip-workflows/includes/abilities/functions.php`, `vip-workflows/includes/class-plugin.php` |
| Agents tab cards | `vip_workflows_register_assistant_meta` **[ext]** (`$registry->register( $slug, $args )`). Research-category and stage-eligible non-core abilities are also collected automatically. | `vip-workflows/includes/assistants/class-assistant-registry.php` |
| Discovery providers | `vip_workflows_register_discovery_providers` **[ext]** (`$registry->register( $slug, [label, features, callbacks] )`) | `vip-workflows/includes/discovery/class-discovery-provider-registry.php` |
| Web search providers | `vip_workflows_register_search_providers` (`SearchProviderInterface`) | `vip-workflows/includes/ideation/research/search-providers/class-search-provider-registry.php` |
| Media scout providers | filter `vip_workflows_media_providers` | `vip-workflows/includes/ideation/assistants/class-media-scout.php` |
| Notification channels | `vip_workflows_register_notification_channels` (`$dispatcher->register_channel( NotificationChannel )`) | `vip-workflows/includes/notifications/class-notification-dispatcher.php` |
| Prompts | `vip_workflows_register_prompts` | `vip-workflows/includes/ai/class-prompt-registry.php` |
| Modules | `vip_workflows_register_modules` (`$plugin->register_module( ModuleInterface )`). Modules are keyed by `get_id()`, so a duplicate ID silently replaces the earlier module. | `vip-workflows/includes/class-plugin.php` |
| Experiments | `vip_workflows_register_experiments` (`$registry->register( Experiment )`) | `vip-workflows/includes/class-plugin.php` |
| REST controllers | filter `vip_workflows_rest_controllers` | `vip-workflows/includes/api/class-rest-controller.php` |

**PHP classes, functions and options that extensions call directly** (part of the surface even though they are not hooks):

- `VIPWorkflows\Abilities\Agents\StageAgent` **[ext]**: `read_post`, `generate`, `write_content`, `result`, `verdict_token`, `wrap_untrusted`, `is_verdict`, `is_sentinel`, `is_implausibly_short`
- `Abilities\Availability` **[ext]**, `AiAvailability::for_selected_provider` **[ext]**, `Ability`, `AbilityExecutor`, `AbilitySettings`, `RequirementFactory`, `RequirementGroup` **[ext: parsely]**
- `Abilities\Tools\require_post_edit_permission()` **[ext]**
- `Assistants\AssistantRegistry` and `Discovery\DiscoveryProviderRegistry` **[ext: parsely]**
- `Sequences\SequenceRepository` **[ext: checklist]**
- Options `vip_discovery_provider_settings` and `vip_discovery_provider_{slug}` **[ext: parsely]**

**Actions and filters fired by core.**

| Hook | Type and when | Args | Owner |
| --- | --- | --- | --- |
| `vip_workflows_status_transition` | action, on every stage change | `$post_id, $new_stage, $old_stage, Sequence, $context{cause, committed_status, previous_status}` | `vip-workflows/includes/workflow/class-status-manager.php` |
| `vip_workflows_entered_{stage}` and `vip_workflows_exited_{stage}` | action, after the action above | `$post_id, $other_stage, Sequence, $context` | `vip-workflows/includes/workflow/class-status-manager.php` |
| `vip_workflows_agent_completed` and `vip_workflows_agent_failed` | action, when a stage agent or legacy agent resolves | `$post_id, $ability_id, $outcome or $message` | `vip-workflows/includes/workflow/class-stage-agent-runner.php`, `vip-workflows/includes/workflow/class-agent-runner.php` |
| `vip_workflows_agent_assigned`, `vip_workflows_assignment_{created,completed,expired,removed,notify}`, filter `vip_workflows_assignee_types` | assignment lifecycle | see source | `vip-workflows/includes/workflow/class-assignment-manager.php` |
| filter `vip_workflows_sequences_for_post` | resolving which sequences apply to a post | see source | `vip-workflows/includes/workflow/class-post-type-manager.php` |
| `vip_workflows_event_emitted` | action, on each audit event | see source | `vip-workflows/includes/automation/class-event-bus.php` |
| `vip_workflows_ai_before_generate` and `vip_workflows_ai_after_generate` | action, around **every** core AI Client call site-wide | `$log_data, $event` | `vip-workflows/includes/ai/class-event-dispatcher.php` |
| `vip_workflows_source_processed` | action, after source processing | `$project_id, $source_id, $result` | `vip-workflows/includes/ideation/research/class-source-processing-job.php` |
| `vip_workflows_experiment_enabled` and `vip_workflows_experiment_disabled` | action, on toggle | `$experiment_id` | `vip-workflows/includes/experiments/class-experiment-registry.php` |
| filters `vip_workflows_notification_events`, `vip_workflows_notification_rate_limit_ttl` (60 s), `vip_workflows_channel_settings` | notifications | see source | `vip-workflows/includes/notifications/class-notification-dispatcher.php`, `vip-workflows/includes/api/class-notifications-controller.php` |
| filter `vip_workflows_discovery_prompts` **[ext]** | decorates discovery prompt groups | see source | `vip-workflows/includes/api/class-discovery-controller.php` |
| filters `vip_workflows_guideline_context`, `vip_workflows_editorial_alignment_rules` | guideline context passed to AI | see source | `vip-workflows/includes/integrations/class-guideline-context-provider.php` |
| filters `vip_workflows_ai_image_prompt`, `vip_workflows_ai_summary_prompt`, `vip_workflows_media_pdf_prompt` | legacy prompt overrides | see source | `vip-workflows/includes/ai/class-core-prompts.php`, `vip-workflows/includes/integrations/class-media-processor.php` |
| filter `vip_workflows_{action}_hourly_limit`, action `vip_workflows_hourly_limit_reached` | per-user and per-project hourly ceilings (`ai`, `discovery_search`, `image_generation`, `project_image_generation`) | see source | `vip-workflows/includes/integrations/class-hourly-limit.php` |
| `vip_workflows_prompts_option_corrupted` | action | see source | `vip-workflows/includes/ai/class-prompt-settings.php` |

**JS extension points.** Filters through `@wordpress/hooks`:

| Filter | Used by an extension? | Owner |
| --- | --- | --- |
| `vipWorkflows.toolSettingsComponent` | **[ext: checklist]** | `vip-workflows/src/admin/components/ToolsSettings.js` |
| `vipWorkflows.assistantSettings`, `vipWorkflows.assistantSettingsComponent`, `vip_workflows_discovery_provider_settings` (legacy) | no | `vip-workflows/src/admin/components/AssistantCard.js` |
| `vipWorkflows.channelGroups`, `vipWorkflows.channelSettingsComponent` | no | `vip-workflows/src/admin/components/NotificationChannelsTab.js` |

Other JS and admin surfaces the checklist extension depends on:

- The data store `vip-workflows/editor` **[ext: checklist]**, using the selectors `getPostId`, `hasWorkflow` and `getSequence` (`vip-workflows/src/editor/store.js`).
- The admin page slug `vip-workflows-tools` **[ext: checklist]**, which the extension matches to enqueue its scripts.
- The global `window.vipWorkflowsAdmin.experiments` (`vip-workflows/includes/admin/class-admin.php`).

There are no SlotFills of Workflows' own.

### Experiments

Experiments are stored in the option `vip_workflows_experiments`, an array of enabled IDs that is not autoloaded. Resolution order is filter `vip_workflows_experiments` > option > disabled, so **every experiment is off by default**. A filter that forces an experiment on cannot be overridden from the UI or the CLI.

Ways to toggle an experiment:

- **UI:** Settings → Experiments. It calls `POST /vip-workflows/v1/settings/experiments` and requires `manage_options` (`vip-workflows/includes/api/class-experiments-controller.php`).
- **WP-CLI:** `wp vip-workflows experiment list|enable|disable <id>` (`vip-workflows/includes/experiments/class-experiment-cli.php`).

The registry is `vip-workflows/includes/experiments/class-experiment-registry.php`. The gates are read at boot, so a toggle takes effect on the next request.

| ID | Gates | Activate and deactivate side effects | Owner |
| --- | --- | --- | --- |
| `ideation` | Modules `IdeationPostTypes` (CPT `vip_ideation`), `SourceProcessingJob` (AS hook `vip_workflows_process_source`), `DiscoveryModule`, and `IdeationAdmin`. REST controllers `IdeationController`, `IdeationSourcesController`, `DiscoveryController`. The Ideation menu, the research abilities (archive scout, web researcher, media scout), and phase-type sequences (create and import are refused while it is off) | On: seeds the default phase sequence and calls `flush_rewrite_rules()`. Off: unschedules pending `vip_workflows_process_source` actions and calls `flush_rewrite_rules()`. | `vip-workflows/includes/experiments/class-ideation-experiment.php` |
| `kanban` | The Kanban submenu and `GET /vip-workflows/v1/workflow/kanban` | none | `vip-workflows/includes/experiments/class-kanban-experiment.php` |
| `calendar` | The Calendar submenu and `GET /vip-workflows/v1/workflow/calendar` | none | `vip-workflows/includes/experiments/class-calendar-experiment.php` |
| `my_queue` (underscore) | The My Queue tab on My Dashboard and `GET /vip-workflows/v1/workflow/my-queue` | none | `vip-workflows/includes/experiments/class-my-queue-experiment.php` |

The kanban, calendar and my_queue gates are in `vip-workflows/includes/admin/class-admin.php`, `vip-workflows/includes/api/class-workflow-controller.php` and the React `AppShell.js` and `MyDashboardPage.js`.

**What disabling does to data:** nothing is deleted.

- The ideation tables `vip_ideation_sources` and `vip_ideation_analyses` are created by the schema for every install, regardless of the flag.
- `vip_ideation` posts stay in `wp_posts` but their post type is no longer registered.
- Existing phase sequences remain.
- Sources left in `pending` are stranded until the experiment is re-enabled and the source is reprocessed.

Two things a reviewer should check:

- Ideation's `activate()` and `deactivate()` call `flush_rewrite_rules()` with no `WPCOM_IS_VIP_ENV` guard. The plugin's own activation hook does have that guard.
- Discovery polling in `workflow-parsely` is not gated by this experiment.

## Features

Each feature has three parts: **Behavior** (what it does now), **Invariants** (what a PR must keep true) and **Footguns** (known sharp edges).

### Sequences and stages

**Behavior**

A sequence is a row in `{prefix}vip_sequences` (`vip-workflows/includes/sequences/class-sequence-repository.php`, model in `vip-workflows/includes/sequences/class-sequence.php`). Two types exist: `workflow` (a stage graph under `config.statuses`) and `phase` (a lifecycle graph under `config.phases`). A sequence's type cannot change after creation; `update()` reads it from the stored row.

A workflow stage has a `key`, `label`, `color`, a `status` region (`draft` | `pending` | `private` | `publish`, default `draft`), optional flags (`is_initial`, `region_entry`, `is_terminal`, `is_dead_end`, `is_in_progress`, `creates_post`, `show_in_queue`), an optional `agent` block, and `transitions`. A post's workflow identity is two post meta keys: `_vip_workflows_sequence_id` and `_vip_workflows_current_stage_key` (`StatusManager::SEQUENCE_META_KEY` / `STAGE_META_KEY` in `vip-workflows/includes/workflow/class-status-manager.php`). Stage meta is the sole authority for where a post is; `post_status` only ever holds core values.

Stage and status form a matrix. A transition between two stages in the same region writes stage meta only and never touches `post_status`. A transition whose endpoints are in different regions first writes the target region's status through `wp_update_post()` (`commit_post_status()`), accepts what core commits (for example `publish` coerced to `future` for a future-dated post), then compare-and-swaps the stage meta. A transition may target any stage in any region ("open region crossings"); there is no rule that a crossing must land on a particular stage.

`region_entry` marks the one stage per used region where a post is seated when something outside the workflow puts it in that region: a core status change (Publish button, Quick Edit, REST, WP-CLI, cron, untrash) is reconciled by `StatusManager::on_status_transition()` → `resolve_reseat_stage()`, which writes the entry stage and fires the stage events with `cause: 'core'`. `future` and `trash` are overlays (`Sequence::OVERLAY_STATUSES`): they never reseat. A region the sequence does not model leaves the stage where it was and logs.

Posts enter a sequence only by explicit assignment (`POST /vip-workflows/v1/workflow/post/{id}/sequence` → `StatusManager::assign_sequence()`). The post is seated at the `region_entry` stage of the region its current status maps to, never at `is_initial`, and no status is written. Assignment is refused for a trashed post, for a sequence not mapped to the post's type, and with `unmodeled_post_status` when the sequence has no stage in the post's region. The REST path also creates a Story for the post if it has none. Post-type scoping comes from each active workflow sequence's `post_types` list (`vip-workflows/includes/workflow/class-post-type-manager.php`, filterable via `vip_workflows_sequences_for_post`). The "require/recommend a workflow" setting is enforced only by the editor modal (`vip-workflows/src/editor/components/WorkflowRequiredModal.js`).

Editorial metadata fields (`config.metadata_fields`; types `text`, `textarea`, `select`, `date`, `user`) are registered as post meta `wf_meta_{sequence_id}_{key}` on the sequence's post types, `show_in_rest`, with `auth_callback` = `edit_post` (`Plugin::register_metadata_fields()` in `vip-workflows/includes/class-plugin.php`). Only active sequences register their fields. A `required` field is enforced only on a transition that crosses into the publish region (see Transitions and tools).

Every config write goes through one gate, `Sequence::prepare_config_for_write()`, called by `SequenceRepository::create()` and `update()`. For workflow sequences it requires at least one stage, unique sanitized keys, a valid region on every stage, exactly one `region_entry` per used region (auto-assigned if none), exactly one `is_initial` (auto-assigned if none), every transition target defined, and at most one transition per target per stage. It throws `InvalidArgumentException`, which controllers return as a 422. For phase sequences it checks only the required lifecycle (`Sequence::REQUIRED_PHASES`: Ideation → Editorial).

Create and update run through `SequencesController::create_item()` / `update_item()` (`vip-workflows/includes/api/class-sequences-controller.php`), which first run `validate_metadata_fields()`, `validate_status_agents()`, `validate_assignment_keys()` and `build_config()`. The MCP abilities `create-sequence`, `update-sequence` and `import-sequence` (`vip-workflows/includes/abilities/tools/`) build a `WP_REST_Request` and call the same controller methods. `activate-sequence` re-runs `prepare_config_for_write()` as a dry run and then writes only `status`. `validate-sequence` runs all the checks without writing.

Export (`GET /sequences/{id}/export`) returns `name`, `type`, `description` and `config`. Import (`POST /sequences/import`) always creates a new row with a fresh unique slug and status `draft`, and regenerates assignment slot keys. Imported sequences are independent copies; nothing links them to the source, and sequence tables are per site (`$wpdb->prefix`), so there is no network sharing.

The phase sequence (`type: 'phase'`) holds one transition, Ideation → Editorial, with `label`, `required_tools`, `allowed_roles` and `notifications`. It is seeded as `content-lifecycle` when the `ideation` experiment is activated (`IdeationExperiment::activate()` → `Seeder::seed_phase_sequence()`), and phase sequences can be created or imported only while that experiment is on. The gate runs in `IdeationController::create_draft()` / `check_phase_transition()` (`vip-workflows/includes/api/class-ideation-controller.php`) against the first active phase sequence: missing transition or role → 403, tools run with `project_id` as input.

**Invariants**

- `post_status` is written by the workflow only in `StatusManager::commit_post_status()`, and only when a transition's endpoints are in different regions. A same-region move must not change `post_status`.
- Stage meta is the authority for a post's stage. No code path may derive the stage from `post_status`.
- The stage meta write in `transition()` is a compare-and-swap against the stage the transition validated from. A lost race returns an error and restores the previous status if one was written.
- Core-driven status changes are reconciled, never refused, by the workflow layer (the publish veto is the only exception; see Publish boundary). Overlays (`future`, `trash`) never reseat.
- `assign_sequence()` never writes `post_status` and seats only at a `region_entry` stage.
- Every config write path (REST, MCP, import, activation, migration replay) passes through `Sequence::prepare_config_for_write()`. A new validation rule there needs a schema migration that replays stored rows.
- A sequence's `type` is immutable.
- Sequence create, update, import and delete require `manage_options`. Read, list, export and stats require `edit_posts`.

**Footguns**

- Sequence updates are in place. Removing or renaming a stage key strands posts sitting at it: `transition()` fails, and `crosses_publish_boundary()` fails closed, so non-bypass users cannot change those posts' status at all. The server does not refuse a save that orphans posts. The way out is "Remove from workflow".
- Deleting a sequence (`SequenceRepository::delete()`) leaves every post's sequence meta in place. Those posts read as "in a deleted workflow" and are vetoed the same way.
- `get_sequence_for_post()` does not check the sequence's status, so posts in a `draft` or `archived` sequence keep transitioning normally.
- Metadata meta keys embed the sequence ID. An imported copy gets new keys, and a post moved to another sequence does not see its old values.
- Metadata fields are registered only for active sequences, at `init`. A field on a draft sequence is not writable over REST.
- Import does not run `build_config()`. Labels, `allowed_roles`, `notifications` and `required_tools` on transitions are stored as given in the file, subject only to the write gate. It is `manage_options`-only.
- Required metadata does not hold a core-driven status change. A scheduled post going live or a Quick Edit to Published reseats with required fields still empty.
- Workflow enforcement for new posts is editor-only. Posts created over REST, WP-CLI or Quick Draft have no workflow until assigned.
- Phase transitions: configured `notifications` are stored but never sent; `bypass_workflow_roles` and `bypass_tool_check_roles` are not consulted; unacknowledged soft warnings return a 422 `tool_check_warnings` error rather than the 200 `warnings_pending` body that workflow transitions use.
- Story status changes only on create (`ideation` or `editorial`) and on Create Draft (`ideation` → `editorial`). Nothing moves a Story to `published`, `monitoring` or `refresh`.

### Publish boundary

**Behavior**

`PublishBoundaryGuard` (`vip-workflows/includes/workflow/class-publish-boundary-guard.php`) vetoes a non-bypass user's `post_status` change across the publish boundary on a workflow-managed post. It is the one place the workflow overrides a status change core would allow.

Coverage. `wp_insert_post_data` is the backstop for every write that goes through `wp_insert_post()` / `wp_update_post()`: block editor, classic editor, Quick Edit, Bulk Edit, REST, XML-RPC, and WP-CLI run with `--user`. A vetoed write keeps everything else (title, content, meta) and puts back the stored `post_status`, `post_name`, `post_date` and `post_date_gmt`. `rest_pre_insert_{post_type}` is registered at `rest_api_init` on every `show_in_rest` post type and returns a 409 `vip_workflows_publish_boundary` error so the block editor shows the message. On `post.php`, the message is queued in a 60-second transient and shown via `admin_notices`.

The predicate is `StatusManager::crosses_publish_boundary()`. It is symmetric (into and out of publish both count). The current side comes from the post's stage region, except that a post whose committed status is publish-side counts as publish (`boundary_region()`). The target side comes from `status_to_region()`, which maps `future` → `publish` and `auto-draft` → `draft`, so scheduling counts as publishing. `trash` and `inherit` targets cross nothing. A post with sequence meta but an unresolvable sequence or stage fails closed (counts as crossing).

The veto does not apply when any of these hold (`resolve_veto()` / `is_system_context()`): the post is new or has no sequence meta; cron (`wp_doing_cron()` or `DOING_CRON`); autosave or revision; a workflow commit in progress (`StatusManager::is_transition_in_progress()`); the status is unchanged; `future` → `publish` (core going live); restoring from `trash` to a non-publish-region status; no current user; or the user is in `bypass_workflow_roles` (default `administrator`).

A post leaves its workflow through `StatusManager::remove_sequence()` (REST `DELETE /workflow/post/{id}/sequence`, or the `remove-from-workflow` ability), which needs `edit_post`. It deletes the sequence, stage and claim meta, completes pending person assignments, logs `workflow.removed`, and writes no status. The post is then unguarded. The other way through is a workflow transition into a publish-region stage, which still needs the post type's `publish_posts` cap.

**Invariants**

- The guard changes no capabilities. It only refuses a status change, and there is always an audited path through (a transition or removal).
- Cron's `future` → `publish` must never be vetoed. The `DOING_CRON` constant check exists because `wp_doing_cron()` is filterable.
- `crosses_publish_boundary()` is the only boundary predicate. Client warnings, list-table data and the server veto all read the boundary through `boundary_region()`, or the client will warn where the server refuses.
- The REST veto and the backstop cover the same posts: the REST filter is registered on every REST post type, not only mapped ones.
- Unresolvable workflow state fails closed (vetoed), never open.
- A trashed post cannot be laundered into the publish region: only non-publish-region restores are exempt.

**Footguns**

- Stages do not lock editing. Anyone with `edit_post` can change content and meta at any stage, including while an AI stage is running. The only lock is that a person cannot start an AI stage while the post is co-edited (`CoEditing::is_shared()`).
- `private` is not on the publish boundary. A non-bypass user with `publish_posts` can set a draft-region workflow post to Private through core, and the workflow reseats it. `publish` → `private` is vetoed because it leaves publish.
- `wp_publish_post()` and direct SQL writes skip `wp_insert_post_data`, so a plugin calling them publishes a workflow post with no veto. The stage still reseats through `transition_post_status`.
- On Quick Edit and Bulk Edit a vetoed change looks like success: core reports the save, the status silently reverts, and the queued notice is not shown on those screens.
- Bypass is role-based (`Settings::can_user_bypass_workflow()`), not capability-based. Adding a role to `bypass_workflow_roles` lets its members publish any workflow post directly, subject only to core caps.
- A userless write (WP-CLI without `--user`, importers, seeders) is never vetoed.

### Transitions and tools

**Behavior**

A transition is an object in a stage's `transitions` array: `to`, `label`, `required_tools`, `allowed_roles`, `notifications`, `show_in_queue`, `inputs`. Every caller goes through `StatusManager::transition()`: the editor rail and header button (`POST /vip-workflows/v1/workflow/post/{id}/transition`, `vip-workflows/includes/api/class-workflow-controller.php`), the Kanban drag (same endpoint, `vip-workflows/src/admin/components/KanbanBoard.js`), My Queue quick actions, and the `vip-workflows/transition-post` MCP ability (`vip-workflows/includes/abilities/tools/transition-post.php`). The REST route needs `edit_post`; the ability needs `edit_posts` plus `edit_post` on the post.

`transition()` checks, in order: post not trashed (409); sequence and stage present; edge exists (422); on an AI stage, target is one of the agent's routed destinations (403 `unrouted_agent_exit`); target is a defined stage; only declared input keys (400); `edit_post`; for a region crossing, the post type's `publish_posts` (into `publish`/`private`) or `edit_published_posts` (out of `publish`); `allowed_roles` (403 `forbidden_transition`, skipped for bypass roles); required assignments present and valid and able to read the post; not starting an AI stage while co-edited; a running agent job (soft warning `agent_in_progress`); required metadata on a crossing into publish (422 `required_fields_missing`, skipped for bypass roles); required tools. Only then does it write status, stage, assignments, the log row, and fire `vip_workflows_status_transition`, `vip_workflows_entered_{stage}` and `vip_workflows_exited_{stage}`.

Required tools are abilities run by `run_transition_tools()` with `{ post_id }` plus the tool's saved options (`AbilityExecutor::execute()` merges `AbilitySettings::get_options()` into the input). A tool that is disabled, missing, errors or throws is a hard failure. Each returned issue is hard if its `check_key` is set to hard in Tools settings or its severity is `error`/`hard`; otherwise soft. Any hard failure returns 422 `tool_check_failed` with `hard_failures` and `soft_warnings`, and logs `transition_blocked`. Soft warnings alone return HTTP 200 `{ warnings_pending: true, soft_warnings }` with nothing committed; resending with `acknowledge_warnings: true` commits and logs `tool_warnings`. Users in `bypass_tool_check_roles` (default `administrator`) skip tools entirely. Tool types (`meta.type`: `check`, `validator`, `helper`) only group the Tools page; on a transition, every required tool is judged by its `issues`. `transition_eligible` only filters which tools the sequence editor offers.

Offered transitions (`get_available_transitions()`) are filtered by role, by region-crossing caps, and on AI stages by routing. Edges blocked by empty required metadata or a disabled required tool are still returned, with `_locked` and `_locked_reason`.

In the block editor, the Transition Rail (`vip-workflows/src/editor/components/TransitionRail.js`) draws the current stage and one button per offered move, with the lock reason under locked ones. It shows moves only, not per-tool status. `TransitionFlow.js` owns the whole move for both the rail and the header split button: it saves a dirty post first (asking before saving a live post or saving over an agent's newer write), collects the assignment, confirms go-live (`PrePublishConfirm.js`), and shows refusals and warning acknowledgements. `WorkflowSaveGuard.js` hooks `editor.preSavePost` to warn before a core status change that would reseat or be vetoed.

Tool settings are declared in `meta.settings_schema` and edited on the Tools page. Because saved options are merged into the run input, every settings key must also be declared in the ability's `input_schema`; abilities use `additionalProperties: false`, so an undeclared key fails Abilities API input validation and the run errors (a hard failure on a transition).

**Invariants**

- Every transition, from every surface, goes through `StatusManager::transition()`. No surface writes stage meta or commits a stage move itself.
- Checks run on the server at move time. A client lock (`_locked`) is advisory; the server re-checks everything.
- Workflow bypass roles bypass workflow rules (roles, required metadata), never core capabilities (`edit_post`, region-crossing caps).
- `agent_actor` and `agent_revert` are set only in-process (`StageAgentRunner`, `revert_failed_agent_stage()`). No REST or MCP input may forward them.
- A `warnings_pending` result commits nothing.
- An agent's own exit transition is not shown its own `agent_in_progress` warning, and does not auto-acknowledge tool warnings.
- `settings_schema` keys ⊆ `input_schema` properties for every ability that can run as a required tool.

**Footguns**

- The MCP `transition-post` ability accepts no `input_data`, so it cannot take a transition with a required assignment.
- A sequence may name any ability ID in `required_tools`; nothing checks that it exists or is `transition_eligible` until it runs, and then it hard-fails every move on that edge.
- Role-denied and capability-denied moves are not written to the audit log; only tool and metadata blocks are (`transition_blocked`).
- Disabling a tool site-wide locks every transition that requires it, for everyone except tool-check bypass roles.
- Required tools run synchronously inside the transition request, once per press and again on acknowledgement.

### Assignments

**Behavior**

Assignments are inputs on transitions. A transition may declare an `inputs` entry `{ type: 'assignment', meta_key, label, assignee_type, required, on_assign }`; `assignee_type` is `user` (default), `role` or `agent`, and extensions may add types through `vip_workflows_assignee_types`. An `agent` assignment fires `vip_workflows_agent_assigned`, which `AgentRunner` queues. Free-text note inputs are retired and stripped on import and by migration. `AssignmentManager` (`vip-workflows/includes/workflow/class-assignment-manager.php`) validates inside `transition()`: undeclared keys are rejected, a `required` slot must be filled (422 `required_assignment_missing`), the user or role must exist, and a user assignee must be able to read the post at the status the move will commit (400 `assignee_cannot_read`). A role whose members cannot all read the post is accepted with a `warnings` entry in the response.

A slot is stored as `_vip_workflows_assignment_{meta_key}` with `value`, `type`, `status` (`pending`/`completed`/`expired`), `assigned_at`, `assigned_by`. When a post leaves a stage (transition, core reseat, reassignment, removal), pending `user` and `role` slots are marked completed; agent slots are not. Pending user assignments are mirrored into `_vip_workflows_pending_assignee` (one row per user), rebuilt after every slot change. A self-edge writes its slot by compare-and-set and returns 409 `assignment_conflict` if it lost a race.

My Dashboard / My Work (`GET /workflow/my-work`) lists posts the user authored (modified in the last 60 days), claimed, or has a pending user assignment on, filtered by `read_post`. The shown assignee is the most recent pending assignment, else the claimer. My Queue (`GET /workflow/my-queue`, `my_queue` experiment) lists posts at stages with `show_in_queue`, filtered by the user's role-permitted transitions, skipping the user's own posts unless self-review is allowed and posts claimed by someone else; its quick actions are transitions marked `show_in_queue` and not locked.

Claims still exist in code. `POST /workflow/post/{id}/claim` and `DELETE /workflow/post/{id}/unclaim` set and clear `_vip_workflows_assigned_to` and log `post.claimed` / `post.released`. Claiming fails with 409 if someone else holds the claim. Only the claimer or a `manage_options` user can release.

**Invariants**

- Assignment validation happens before any write in `transition()`. A refused assignment leaves status, stage and slots unchanged.
- Only declared input keys are stored or logged.
- Leaving a stage completes that stage's pending person assignments; a failed-agent revert does not.
- `_vip_workflows_pending_assignee` is derived data; the slots are the record.

**Footguns**

- Claim endpoints check only `edit_post`. `Sequence::can_user_claim()` (`reviewer_roles`) only sets the UI's `can_claim` flag, and nothing checks that the post is in a workflow.
- A claim survives stage changes and is cleared only by unclaim or removal from the workflow. It keeps the post out of other users' My Queue indefinitely.
- Role assignments are not indexed, so they do not put a post in role members' My Work, even though the access warning implies they would.
- `on_assign.notify` fires `vip_workflows_assignment_notify`, which nothing in the plugin handles. Assignees are not notified by default.

### Notifications

**Behavior**

`NotificationDispatcher` (`vip-workflows/includes/notifications/class-notification-dispatcher.php`) registers Slack destinations (one channel per configured webhook, `channels/class-slack-channel.php`), Email (`channels/class-email-channel.php`), and anything added on `vip_workflows_register_notification_channels`.

There are two routes. Publish events: the `published` event is routed by the `vip_workflows_notification_routing` option (event → channel IDs). It fires once per go-live: from `vip_workflows_status_transition` when a workflow move commits `publish` from a non-publish status, or from `transition_post_status` for a core-driven go-live on a workflow post (suppressed while a workflow commit is in progress). Routed sends are queued with Action Scheduler when available, else sent inline. Per-transition: a transition's `notifications` list sends the `transition` template ("moved from X to Y"), or the `published` template on a go-live, to each listed channel, inline in the request. A 60-second debounce per channel, event and post (`vip_workflows_notification_rate_limit_ttl`) suppresses repeats. A debug option mirrors every event to chosen channels.

Delivery failure never blocks a move: notifications fire after the status and stage are committed, `send()` returns false, and Slack logs the error.

**Invariants**

- Go-live notifies exactly once per publish, whichever path caused it.
- Notification dispatch happens after commit and cannot veto or roll back a transition.
- Routing keys must match IDs that `dispatch()` actually fires (`get_event_types()`); a mismatched key silently never matches.

**Footguns**

- Per-transition sends are synchronous. Each Slack destination can add up to 15 seconds to the transition request.
- A custom channel whose `send()` throws breaks the request after the move has committed.
- Email's "notify author" never reaches the author: the notification data carries `author_name` but not `author_id`. With no email settings saved, the channel reports configured but has no recipients. "Notify admins" emails every administrator, one `wp_mail()` call each.
- Two moves of the same post within 60 seconds to the same channel and event send one message.

### Audit and history

**Behavior**

Events are rows in `{prefix}vip_workflows_events` (`post_id`, `event_type`, JSON `event_data`, `actor_id`, `actor_type`, `created_at`), deleted after one year by `Cleanup` (`vip-workflows/includes/maintenance/class-cleanup.php`). Each stage change writes one `status_transition` row (`StatusManager::log_transition()`) with from/to keys and labels snapshotted at write time, `cause` (`workflow` or `core`), `previous_status`, `comment`, assignment notes, and `agent_actor` / `agent_revert`. Other rows: `workflow.assigned`, `workflow.removed`, `transition_blocked`, `tool_warnings`, `post.claimed`, `post.released`, `ability.executed` / `ability.failed`, and `sequence.updated` / `sequence.activated` / `sequence.deactivated` from the MCP abilities. Event-bus bookkeeping rows (`post.stage_changed`, `stage.%.entered`, `stage.%.completed`) are excluded from every audit read.

A person's move is `actor_type: 'user'` with their ID. An agent's exit transition is `actor_type: 'agent'`, `actor_id` = whoever is current when it commits (0 under cron), `event_data.agent_actor` = the ability ID. An MCP move is recorded as the authenticated user, the same as an editor move.

Per-post history (`GET /workflow/post/{id}/history`) returns only `status_transition` rows and needs `edit_post`. The Audit Log (`GET /vip-workflows/v1/audit-log`, `vip-workflows/includes/api/class-audit-log-controller.php`) needs a role in `audit_log_roles` (default administrator, editor); users outside `audit_log_full_access_roles` (default administrator) see only events they performed.

**Invariants**

- Every committed stage change writes exactly one visible `status_transition` row.
- Stage labels are snapshotted at write time; renaming a stage never rewrites history.
- Audit reads apply `StatusManager::bus_bookkeeping_exclusion()`.
- Non-full-access users are scoped to `actor_id = current user` on events, event types and the user list.

**Footguns**

- Per-post history is visible to anyone who can edit the post, including other people's and agents' moves, regardless of audit roles.
- `transition_blocked` and `tool_warnings` rows are always `actor_type: 'user'`, even when an agent was blocked (actor ID 0).
- Sequence edits made in the Sequences editor (REST) write no audit row; only MCP-made edits do.
- History older than one year is deleted.

### Admin surfaces

**Behavior**

`Admin::register_menu()` (`vip-workflows/includes/admin/class-admin.php`) adds a top-level Workflows menu. Users with `edit_posts` get My Dashboard, plus Ideation when that experiment is on. Users with `edit_others_posts` also get Kanban and Calendar when those experiments are on. Sequences (graph editor), Notifications, Agents, Tools and Settings (`vip-workflows/includes/admin/class-settings.php`) need `manage_options`. Audit Log needs `edit_others_posts` when the user's role is in `audit_log_roles`, otherwise `manage_options`. Settings hold the bypass role lists, audit roles, self-review and workflow enforcement. Each page is a React app over the REST routes above, and each route checks its own capability; menu visibility is not the security boundary.

Subsystems implement `ModuleInterface` (`get_id()`, `init()`; `vip-workflows/includes/class-module-interface.php`) and are registered in `Plugin::init_components()` (`vip-workflows/includes/class-plugin.php`) after the core services (event bus, `PostTypeManager`, `StatusManager`, `PublishBoundaryGuard`). Extensions add modules on `vip_workflows_register_modules`. All modules are initialized in one loop after registration.

**Invariants**

- `StatusManager` and `PublishBoundaryGuard` initialize before any module, so their `transition_post_status` and save-layer hooks are registered first. Notification and event listeners depend on the reseat having run.
- Every REST route and ability has its own `permission_callback`.

**Footguns**

- `register_module()` keys by `get_id()` and silently replaces an existing module with the same ID.
- `Admin` is registered only when `is_admin()`; code that needs it from REST or cron cannot rely on `get_module()`.

### Stage agents

**Behavior.** A stage becomes AI-owned when its sequence config carries `agent: { ability_id, routing: { pass?, fail?, error? }, settings? }`. The ability must be registered with `meta.stage_eligible = true`; `SequencesController::validate_status_agents()` rejects an unknown or non-eligible ability, any routing key other than `pass`/`fail`/`error`, and any routing target that is not the `to` of one of that stage's own transitions (`vip-workflows/includes/api/class-sequences-controller.php`). `settings` is stored verbatim, not checked against the ability's `settings_schema`.

On every stage change into an AI stage (edge traversal, sequence assignment, or core-driven checkpoint reseat), `StageAgentRunner::maybe_dispatch()` writes a `pending` marker to `_vip_workflows_agent_job` (stage, ability, `queued_at`, `cause`, `from_stage`, `started_by`) and schedules a single WP-Cron event `vip_workflows_run_stage_agent` (`vip-workflows/includes/workflow/class-stage-agent-runner.php`). The run executes the ability through `AbilityExecutor` with input `['post_id' => …] + settings`, in context `agent`, impersonating the post author.

The ability's output `status` must be `pass` or `fail`. A `WP_Error`, a thrown exception, an unavailable or disabled ability, or a successful run with any other `status` is the `error` outcome. Routing: the outcome's route if set; otherwise the `error` route if set; otherwise the run fails in place. The exit transition runs through `StatusManager::transition()` with `agent_actor` set, and records `_vip_workflows_agent_last_run`. A failed-in-place run sets the marker to `failed` with the error; the editor offers one action, "go back" to `from_stage` (`POST /workflow/post/{id}/agent-revert`, `StatusManager::revert_failed_agent_stage()`). There is no separate re-run: going back and forward again re-dispatches. A pending marker older than `PENDING_TTL` (15 minutes) is converted to a failure on the next read (`StatusManager::has_pending_agent_job()`).

Shared helpers for agent authors are in `vip-workflows/includes/abilities/agents/class-stage-agent.php`: `read_post()`, `generate()` (180 s request timeout, no temperature sent), `verdict_token()`/`is_verdict()`, `wrap_untrusted()`, `write_content()`, block-anchored editorial notes. Core ships no concrete stage agent; the agents live in `workflow-*` plugins (see [Included tools and agents](#included-tools-and-agents)).

**Invariants**

- Only `pass` and `fail` are verdicts. Anything else is `error`, never a guessed pass (`outcome_from_result()`).
- An unrouted outcome never invents a destination: it takes the `error` route or fails in place with a visible message.
- The run acts as the post author and only the author. If the author lacks `edit_posts`, the run fails in place (`no_actor`); it never falls back to another user (`resolve_agent_user()`). The exit transition is authorized against that user via `agent_actor_user`; `user_can( $actor, 'edit_post' )` and the region-crossing capability are enforced in `transition()` even for agents (`vip-workflows/includes/workflow/class-status-manager.php`). `agent_actor` waives only the sequence's role table, never core capabilities.
- `started_by` (the person whose move entered the stage, or the chain's starter for agent-to-agent hops) is used for telemetry attribution only, never for authorization.
- Publication guard: an agent move from outside `publish`/`private` into either is held and fails in place (`publish_held`), including via an `error` route, unless the sequence sets `settings.allow_agent_publish === true` (strict boolean). Even when waived, the author must hold `publish_posts` (`holds_publication()`, `publication_hold()`). People are not offered a held route while the agent owns the stage (`StatusManager::agent_routed_targets()`).
- From an AI stage, people may take only routed destinations; `transition()` refuses others (`unrouted_agent_exit`). While a run is pending or failed-with-go-back, `get_available_transitions()` offers none. A person who moves the post while a run is pending gets an `agent_in_progress` soft warning to confirm, and the run is abandoned (its outcome is discarded, but content it already wrote stays).
- Loop guard: `_vip_workflows_agent_chain` is incremented once per run, in `finish()`, immediately before the exit transition. A run that does not move the post never writes it. Above `MAX_CHAIN` (10) the run fails in place and never takes the error route. The counter resets when the post enters the AI stage from a stage that has no agent, and on go-back.
- A run whose stage changed under it (moved away, or left and re-entered with a newer marker) is abandoned without recording a failure (`abandon_if_superseded()`). Marker deletes are compare-and-delete and only clear a marker owned by the same stage.
- Agent exit transitions do not auto-acknowledge soft warnings. If the exit raises warnings, the marker becomes `warnings_pending` and a person confirms the exact held transition (`hold_for_warnings()`).
- A refused exit transition, a dispatch that could not be scheduled, and the loop guard always fail in place, never through the error route.
- Revisions written during a run are stamped `_vip_workflows_agent_actor` with the ability id and shown as "<agent> (agent)" in the revisions UI (`stamp_agent_revision()`, `label_agent_revision()`).
- Co-editing: `transition()` refuses a person's move into an AI stage while `CoEditing::is_shared()` reports more than one editor, and the runner fails in place (`co_editing`) if that is true when the run starts (`vip-workflows/includes/workflow/class-co-editing.php`). The count comes only from VIP Real-Time Collaboration's `RoomPresence`; without it the count is 0.
- `StageAgent::write_content()` aborts with `concurrent_edit` if `post_modified_gmt` changed since `read_post()`, and kses-filters agent-generated content.
- Post content is lower-trust than the agent's instructions: LLM verdict agents must pass content through `wrap_untrusted()` and match the pass verdict only against a per-run `verdict_token()`. A non-match is never a pass. See `docs/reference/stage-agent-verdict-threat-model.md`.
- Server logs carry identifiers only (`log_token()`); free-form error text goes to the job marker for the editor, never to `error_log`.
- Stage-agent model calls are exempt from the per-user hourly AI limit only under cron (`StageAgent::check_rate_limit()`).

**Footguns**

- Ability input is validated against `input_schema`, and the example agents set `additionalProperties: false`. Every `settings_schema` key, and every key the global ability options (`AbilitySettings::get_options()`, merged by `AbilityExecutor::execute()`) can supply, must also be declared in `input_schema`, or every run is rejected before it starts and routes as `error`.
- The chain counter resets on the *previous stage having no agent*, not on who moved the post. A person moving a post between two AI stages does not reset it; a core reseat from a non-AI stage does.
- `holds_publication()` treats `allow_agent_publish` as waived only for a real `true`; JSON imports with `"true"` stay held.
- Concurrent-edit detection is not atomic with the write: a save landing between the check and `wp_update_post()` is overwritten.
- Co-editing protection is silently absent on sites without VIP Real-Time Collaboration.
- Verdicts are not reproducible (no temperature), so a rerun is not evidence about a previous run.
- An agent that rewrites content can return `pass` without a nonce match. `workflow-agent-copy-edit` treats any reply that is neither its token nor `REJECT` as the new body, writes it, and passes; only `is_implausibly_short()` and the concurrent-edit check stand between an injected reply and the post.
- Cron must actually run. With `DISABLE_WP_CRON` and no system cron, every AI stage sits pending for 15 minutes and then reports "Agent run timed out."
- `PENDING_TTL` (15 minutes) must stay above the longest real run; `StageAgent::REQUEST_TIMEOUT` is 180 s per model call.
- Some user-facing strings say "Re-run", but there is no re-run action; the only retry is go back and forward.

### Ideation

**Behavior.** Ideation is the `ideation` experiment (`vip-workflows/includes/experiments/class-ideation-experiment.php`), off by default. Enabled state is the `vip_workflows_experiments` option, overridable by filter (`ExperimentRegistry::is_enabled()`). When on, it loads the `vip_ideation` post type and statuses, the source-processing job, the discovery module, the ideation admin screens, the `ideation`, ideation-sources and `discovery` REST controllers (`vip-workflows/includes/api/class-rest-controller.php`), and registers the three built-in research agents (`vip-workflows/includes/class-plugin.php`).

- **Story discovery.** Providers register on `vip_workflows_register_discovery_providers` with `label`, `features` (`recommend`, `search`), a required `seed` callback, `recommend`/`search`/`filters` callbacks as declared, and an optional `availability_callback` (`vip-workflows/includes/discovery/class-discovery-provider-registry.php`). `GET discovery/recommendations` calls every available, enabled `recommend` provider, caches per provider in a transient (`cache_minutes`, default 30), then applies the `vip_workflows_discovery_prompts` filter. Selecting a prompt runs the provider's `seed` callback and creates a project (`DiscoveryController::select_prompt()`).
- **Research agents.** Any ability with `meta.type = 'research'` that is enabled in ability settings is a research agent (`IdeationOrchestrator::get_research_abilities()`). Built-ins: Archive scout, Web researcher, Media scout. The orchestrator runs one agent per request (`run-assistant`, `query`), with input `{project_id, seed, seed_analysis, query?}`, caches output for an hour keyed on agent + seed + query, normalizes card URLs to `http(s)` (`SafeUrl`), and stores cards in `vip_ideation_sources` (`vip-workflows/includes/ideation/assistants/class-ideation-orchestrator.php`).
- **Interactive assistants.** Follow-up queries, "find similar" (a query seeded from a card), and the Editorial Mentor (`POST ideation/{id}/mentor`) reuse the same single-agent path. The Seed Analyst runs once on project creation. Their prompts are registered in `PromptRegistry` under `ideation/*` and are overridable by admins (`vip_workflows_prompts` option, `vip-workflows/includes/ai/class-core-prompts.php`).
- **Agents admin page.** `AssistantRegistry` groups research abilities, stage-capable agents and discovery providers into one card per plugin (`vip_workflows_register_assistant_meta`), with aggregated availability; the `assistants` REST routes require `manage_options` (`vip-workflows/includes/assistants/class-assistant-registry.php`).
- **Content hierarchy.** A `vip_story` (non-public CPT) groups an ideation project and the posts it leads to, through `wp_vip_story_objects` plus `_vip_story_id` meta (`vip-workflows/includes/story/class-story.php`). Story status moves only where code calls it: `ideation` on project creation, `editorial` on Create draft. Assigning a sequence to a post without a story also creates one at `editorial` (`WorkflowController`). The `Story` module is loaded whether or not the experiment is on.
- **Idea to draft.** `POST ideation/{id}/create-draft` first checks the active phase sequence's `ideation → editorial` transition (roles, then `required_tools` run with `{project_id}` in context `ideation`), then generates title and body with the configured AI model from the seed, analysis, pinned cards and guidelines, inserts a `post` as a draft authored by the caller, sideloads pinned images, links it to the story and writes `_vip_ideation_project_id` and `vip_draft_ai_context` (`vip-workflows/includes/api/class-ideation-controller.php`). The default phase sequence (`content-lifecycle`) is seeded when the experiment is activated (`Seeder::seed_phase_sequence()`).

Data: `vip_ideation` posts and `_vip_ideation_*` meta, `vip_ideation_sources` and `vip_ideation_analyses` tables, `vip_story` posts and `vip_story_objects`, `_vip_discovery_prompt` meta, `vip_discovery_*` options and transients, media-library attachments, Action Scheduler actions `vip_workflows_process_source`.

Outbound calls: the configured AI provider through the WordPress AI Client (seed analysis, mentor, archive reranking, source and image analysis, draft generation, AI image generation); Tavily `api.tavily.com` (web, image and video search); YouTube Data API `www.googleapis.com/youtube/v3` and the YouTube player endpoint for transcripts; OpenAI `api.openai.com/v1/audio/transcriptions` for uploaded audio/video (`MediaProcessor`); arbitrary user-supplied URLs for content extraction and image download through `SsrfGuard` (`vip-workflows/includes/integrations/`); and whatever each discovery provider or research extension calls.

**Invariants**

- Turning the experiment off hides surfaces only: modules, REST routes, menus and built-in research agents go away, queued `vip_workflows_process_source` actions are unscheduled, and no ideation data is deleted.
- While ideation is off, phase sequences cannot be created or imported, and are left out of the sequences list (`SequencesController`).
- Every ideation and discovery route requires `edit_posts`. Project routes additionally require being the project author or holding `edit_others_posts`; listing other authors' projects requires `edit_others_posts`.
- A draft is created only after the phase gate passes; a disabled or failing required tool is a hard failure.
- URLs from providers and agents are restricted to `http`/`https` before storage. Fetching a user URL goes through `SsrfGuard` (public unicast IPs only; image downloads also allowlisted, no redirects).
- An unavailable research agent reports `unavailable` with structured requirements; it is never run.
- Archive scout reads only published posts.
- Prompts the ideation features send are registered in `PromptRegistry`, so admins can read and override them. This is the "configurable, transparent AI" promise for ideation.
- No Jetpack dependency anywhere in the ideation path.

**Footguns**

- `vip_draft_ai_context` records `provider: 'openai'` and `temperature: 0.7` as literals, and `model` from an undefined `$model_name` (so `null`, with a PHP warning). The draft's AI audit record does not describe the call that was actually made.
- Hourly limits apply only to image generation (30 per account, 20 per project), uncached discovery searches, and non-cron stage-agent calls (uncapped by default). `run-assistant`, `query`, `mentor`, `summarize` and `create-draft` have no limit.
- The research cache key is agent + seed + query, not project or user: two projects with the same seed share cached cards for an hour.
- `get_recommendations()` swallows a provider exception and simply omits that provider, with no log.
- Research agents run via `$ability->execute()` directly, not `AbilityExecutor`, so global ability options are not merged into their input.
- Discovery provider config is stored in `vip_discovery_provider_{slug}` options with autoload on; a provider that keeps an API key there keeps it in an autoloaded option.
- Audio/video transcription calls OpenAI directly with the OpenAI key regardless of the selected AI provider.
- Story statuses `published`, `monitoring`, `refresh` and `archived` are registered but nothing moves a story into them.

### Parse.ly integration

**Behavior.** Lives entirely in the `workflow-parsely` extension; core has no Parse.ly code. It is active when the extension is active and wp-parsely's `Parsely\Parsely` and `Content_API_Service` classes exist; it is configured when the `parsely` option holds a non-empty `apikey` (Site ID) and `api_secret` (`workflow-parsely/workflow-parsely.php`). wp-parsely is deliberately not in `Requires Plugins`, because on VIP it is often an mu-plugin. Credentials are read from wp-parsely, never copied.

It registers: `smart-linking` and `headline-suggestions` (helpers, Suggestions API), `performance-signals` (research agent), `performance-check` (transition check), `smart-linking-check` (stage agent that leaves block notes rather than inserting links, `workflow-parsely/includes/agents/class-smart-linking-agent.php`), the `parsely-trending` discovery provider (`recommend` only), a `vip_workflows_discovery_prompts` listener that attaches cached performance tiers to other providers' prompts (`PromptScorer`), and a recurring poll (`workflow_parsely_poll_discovery`, default 15 minutes, floor 1 minute) that queues new prompts for scoring (`DiscoveryPoller`).

Outbound calls go to Parse.ly's Content API (`/analytics/posts`, `/related`, plus a local `/search` endpoint class in `workflow-parsely/includes/parsely/class-endpoint-search.php`) and Suggestions API (smart links, title suggestions), all through wp-parsely's service classes, which own the hosts and auth. Results are cached in transients (signals one day, cohorts per `cohort_cache_days`); warm queues are the `workflow_parsely_*_queue` options.

**Invariants**

- Missing plugin or credentials makes every ability unavailable with a named requirement (`plugin:wp-parsely` or `credentials:parsely`). `AbilityExecutor` then returns a failure without running it, so a stage agent takes the `error` route or fails in place, never `pass`. Direct calls return `workflow_parsely_missing_plugin` / `workflow_parsely_missing_credentials`.
- Suggestions entitlement is tracked separately: a `NO_AUTHORIZATION` on any Suggestions call is recorded by `SuggestionsGuard` and makes the Suggestions-backed abilities report `entitlement:parsely-suggestions` as unmet.
- `smart-linking-check` passes only on `NO_LINKS` (Parse.ly looked and found nothing) or an empty post. Every other API error, including `NO_DATA`, is an error.
- `performance-check` never hard-blocks. On a transition it reads only its cache: a hit shows the tier as a soft warning, a miss shows "still being gathered" as a soft warning and queues a background warm.
- `performance-check` authorizes against the specific post, since it sends that post's headline, excerpt, tags and permalink to Parse.ly.
- The poller is not scheduled, and does nothing, unless Parse.ly is configured and the `parsely-trending` provider is enabled; it is unscheduled on deactivation.

**Footguns**

- The poller runs every `recommend` provider on the site, not only Parse.ly's, and runs whether or not the ideation experiment is on.
- Missing scores are silent on the ideation screen: with Parse.ly unconfigured, `PromptScorer` returns prompts unchanged.
- A cold performance comparison takes tens of seconds; a transition always gets a pass-with-soft-warning, so the tier is advisory by construction.
- Parse.ly `url`/`link` fields carry an `itm_source=parsely-api` parameter that must be stripped before storing or showing.
- Tags returned by Parse.ly include layout and syndication directives; treat unknown conventions as non-topic.
- `smart-linking-check` adds a `noteId` attribute to blocks it annotates, so it does write `post_content` even though it never changes visible text.

### Included tools and agents

Core abilities are in `vip-workflows/includes/abilities/tools/` and `vip-workflows/includes/ideation/assistants/`; the rest are extension plugins at the repo root. "AI" means the configured provider through the WordPress AI Client.

| ID | Kind | What it does | Outbound |
| --- | --- | --- | --- |
| `vip-workflows/readability`, `seo-check`, `keyword-check` | check (transition-eligible) | Deterministic content checks | None |
| `vip-workflows/get-*`, `transition-post`, `update-post-fields`, `remove-from-workflow`, `*-sequence` | tool | Workflow and sequence operations for the command palette, MCP and CLI | None |
| `vip-workflows/archive-scout` | research (ideation) | Searches this site's published posts, AI-reranked | AI |
| `vip-workflows/web-researcher` | research (ideation) | Web search via the selected search provider | Tavily |
| `vip-workflows/media-scout` | research (ideation) | Images and video; AI image generation | Tavily, YouTube Data API, AI |
| `workflow-agent-copy-edit/copy-edit` | stage agent | Copy-edits the body and saves it as a revision; `REJECT` fails | AI |
| `workflow-agent-tag-sanity-check/tag-sanity-check` | stage agent | Flags questionable tags; fails with no tags | AI |
| `workflow-tool-checklist/checklist` | check (transition-eligible) | Configurable checklist with hard/soft items and an editor panel | None |
| `workflow-assistant-wikipedia/wikipedia` | research (ideation) | Wikipedia background search | `en.wikipedia.org` |
| `workflow-parsely/smart-linking` | helper | Suggested internal links | Parse.ly Suggestions API |
| `workflow-parsely/headline-suggestions` | helper | Headline suggestions | Parse.ly Suggestions API |
| `workflow-parsely/performance-signals` | research (ideation) | Past-performance evidence for a seed | Parse.ly Content API |
| `workflow-parsely/performance-check` | check (transition-eligible) | Past-performance tier as a soft warning | Parse.ly Content API |
| `workflow-parsely/smart-linking-check` | stage agent (also transition-eligible) | Leaves block notes for linkable phrases | Parse.ly Suggestions API |
| `parsely-trending` | discovery provider | Trending site content as story prompts | Parse.ly Content API |

## Known gaps

Places where the code doesn't fully keep a promise this file makes. A PR that fixes one removes it from this list. A PR that adds one adds it here. Feature-level sharp edges stay in each feature's Footguns.

**Configurable, transparent AI (A1)**

- `AiClient::setEventDispatcher()` replaces core's AI event dispatcher for the whole site. Every plugin's AI call fires Workflows hooks and writes a one-hour transient with the full prompt, and Workflows' provider keys are set on core's shared registry, where other plugins can use them. See [Outbound calls](#outbound-calls).
- Audio and video transcription always sends the raw file to OpenAI with the OpenAI key, whichever provider the admin selected (`P/integrations/class-media-processor.php`).
- Create Draft writes a `vip_draft_ai_context` record with a hard-coded provider and temperature and a null model, so the draft's AI record doesn't describe the call that was made (`P/api/class-ideation-controller.php`).

**Publish boundary (N2, M1–M3)**

- `private` is not on the publish boundary. A non-bypass user with `publish_posts` can make a draft-side workflow post private through core.
- `wp_publish_post()` and direct SQL writes skip the save-layer guard, so a plugin calling them publishes a workflow post with no veto.
- Removing a stage key or deleting a sequence strands posts at it, and the guard then fails closed on every status change for non-bypass users.

**Experiments (N9, A3)**

- Turning Ideation on or off calls `flush_rewrite_rules()` with no `WPCOM_IS_VIP_ENV` guard.
- The `workflow-parsely` discovery poll runs every discovery provider every 15 minutes, whether or not Ideation is on.

**Assignments and notifications (N7, M4)**

- Role assignments aren't indexed, so they don't put a post in role members' My Work.
- `on_assign.notify` fires a hook nothing handles, so assignees aren't notified.
- Email "notify author" never reaches the author.
- Phase-transition notifications are stored but never sent.

**History (N8)**

- Sequence edits made in the sequence editor (REST) write no audit row. Only MCP-made edits do.
- Role-denied and capability-denied moves aren't logged.

**Lifecycle and data**

- `vip_workflows_cleanup` is scheduled on an admin page load and never unscheduled, because the activation and deactivation hooks it listens for are never fired. Deactivation unschedules `vip_workflows_check_sla_breaches`, which nothing schedules.
- Uninstall drops the tables and the schema-version option only. Other options, post meta, ideation and story posts, and scheduled actions stay. It doesn't loop over a multisite network.
- The `vip_workflows_desks`, `vip_workflows_user_desks` and `vip_workflows_notifications` tables are created but never used, and `vip_workflows_roles` is seeded but never read.

## Proposed

Design specs awaiting review live in [`docs/specs/planned/`](specs/planned/). They describe intended behavior, not current behavior. When one ships, its content moves into the sections above and the planned file is deleted.

- [Error-state pattern](specs/planned/error-state-pattern.md)
