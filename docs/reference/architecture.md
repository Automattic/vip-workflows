# Architecture Reference

High-level orientation for VIP Workflows: what it is, the core concepts (sequences, statuses, tools, ideation, notifications, jobs, events), and the overall system architecture. Start here if you are new to the codebase.

For file-by-file layout see [file-structure.md](file-structure.md). For database tables see [database-schema.md](database-schema.md). For code examples see [code-patterns.md](code-patterns.md).

---

## What This Is

### Strategic Context

**VIP Workflows** is a workflow orchestration platform for WordPress VIP. It gives editorial teams sequence-driven statuses, governed transitions, assignments, content quality tools, automation, notifications, and ideation workflows inside WordPress.

The scope is deliberately broader than simple status transitions, but the repo now stays focused on workflows and adjacent editorial operations. Contributor identity and XML sitemap generation live in standalone plugins.

**Architecture**: Posts for content, CPTs for domain objects, join tables for relationships.

| Concept | Implementation |
|---------|---------------|
| Article/Content | `wp_posts` (Post or CPT) |
| Story (lifecycle container) | `vip_story` CPT |
| Workflow Stage | Post meta `_vip_workflows_current_stage_key` (queried via `StageQuery`) |
| Stage Transition | `StatusManager::transition()` — stage meta write; `post_status` written only when the edge crosses a status-region boundary |
| Story-to-Object links | `wp_vip_story_objects` join table + `_vip_story_id` meta |
| Audit Trail | `wp_vip_workflows_events` (post-scoped; no `story_id` column) |

See [`docs/specs/shipped/content-hierarchy.md`](../specs/shipped/content-hierarchy.md) for the full hierarchy and relationship model.

### Key Benefits

1. **WordPress-native** - Content is posts, domain objects are CPTs, leveraging core APIs
2. **Block Editor native** - Sidebar integrates with Gutenberg
3. **Story as universal grouping** - One ID connects ideation, article, and post-publish monitoring
4. **Three independent status layers** - Story status, editorial status (workflow sequence, `type: 'workflow'`), WordPress status
5. **Plugin compatibility** - Other plugins work automatically
6. **Workflow operations** - One plugin for editorial workflow, ideation, quality, and automation

---

## Core Concepts

### 1. Sequences

**Sequences** define workflows. They are JSON configurations stored in `wp_vip_sequences` table. Two types exist: **workflow** (editorial statuses for posts, labeled **"Workflow Sequences"** in the admin UI) and **phase** (transitions between content lifecycle phases: Ideation, Editorial).

> **Naming note:** The database `type` column, the PHP/JS variable names (e.g. `Sequence::TYPE_WORKFLOW`, `workflowSequences`) and the user-facing tab label all use `workflow`. A sequence of this type is not necessarily editorial — it drives whatever post types it is configured for.

```json
{
  "version": "2.0",
  "post_types": ["post"],
  "statuses": [
    {
      "key": "draft",
      "label": "Draft",
      "color": "#3498db",
      "transitions": [
        {
          "to": "review",
          "label": "Submit for Review",
          "required_tools": ["readability"]
        }
      ]
    },
    {
      "key": "review",
      "label": "In Review",
      "color": "#f39c12",
      "transitions": [
        {
          "to": "approved",
          "label": "Approve",
          "allowed_roles": ["editor", "administrator"],
          "requires_assignment": {
            "meta_key": "_vip_workflows_assigned_to",
            "match": "current_user"
          }
        },
        {
          "to": "draft",
          "label": "Request Changes",
          "inputs": [
            {
              "type": "textarea",
              "note_id": "n123abc",
              "note_name": "Change Requests",
              "meta_key": "wfp_n123abc_change_requests",
              "required": true
            }
          ]
        }
      ]
    }
  ]
}
```

**Workflow sequences can**:
- Apply to any registered post type (`post`, `page`, or a CPT the site registers)
- Define workflow stages (stored in post meta), each mapped to a core status region
- Specify allowed transitions between statuses
- Require tools to pass before transitions
- Require assignments before transitions (with role filtering)
- Request input/notes on specific transitions
- Restrict transitions by user role

**Phase sequences** define gates between the content lifecycle phases (Ideation, Editorial). The Ideation phase can have transitions to Editorial, each with configurable required tools (`context: phase`), allowed roles, and notifications. The Editorial phase is read-only in the phase sequence since its internal workflow is managed by its own sequence type.

### 2. Stages in Post Meta, Statuses as Regions

Workflow stages live in post meta (`_vip_workflows_current_stage_key`), never in `post_status` — no custom post statuses are registered. `post_status` stays core-owned and only ever takes core values.

Each stage declares the core status **region** it lives in, and each region a sequence uses has exactly one entry stage:

```jsonc
// per stage in the sequence config
{ "key": "review",    "label": "In Review", "status": "draft" }
{ "key": "published", "label": "Published", "status": "publish", "region_entry": true }
```

A transition writes `post_status` only when it crosses a region boundary (written through core, committed value accepted — a scheduled post commits as `future`). Core-driven status changes re-seat the post at the target region's entry stage. Query stages via the `StageQuery` seam, never by `post_status`.

### 3. Tools (Abilities)

**Tools** are checks/helpers that analyze content. They use the WordPress Abilities API (Core 6.9+ or via Composer).

```php
wp_register_ability('vip-workflows/seo-check', [
    'label'       => 'SEO Check',
    'category'    => 'vip-workflows',
    'input_schema' => [/* ... */],
    'output_schema' => [/* ... */],
    'execute_callback' => 'vip_workflows_execute_seo_check',
    'permission_callback' => function() {
        return current_user_can('edit_posts');
    },
]);
```

**Tool types**:
- **Check tools**: Validate content (SEO, readability, brand safety)
- **Helper tools**: Generate/transform content (headline generator, excerpt)

**Built-In Tools** (in vip-workflows/includes/abilities/tools/):

1. **SEO Check** (`vip-workflows/seo-check`):
   - Word count (min/max thresholds)
   - Meta description (presence, length)
   - Title tags (length, keyword placement)
   - Keyword density
   - Heading structure (H1, H2, H3 hierarchy)
   - Image alt text coverage
   - Returns score 0-100

2. **Readability** (`vip-workflows/readability`):
   - Flesch-Kincaid Reading Ease score
   - Flesch-Kincaid Grade Level
   - Average sentence length
   - Average word length
   - Complex word percentage
   - Returns score 0-100

3. **Keyword Check** (`vip-workflows/keyword-check`):
   - Target keyword density
   - Keyword placement in title/meta/headings
   - Keyword variations
   - Returns pass/warning/fail per check

> **AI Agent moved out of core (2026-07-09):** the conversational chat sidebar
> ability, its `AiAgentService`/`AiAgentController` classes, and the
> `vip_ai_agent_conversations` table now live in the standalone `vip-ai-agent`
> plugin, not in this repo. See
> [`docs/specs/shipped/ai-agent.md`](../specs/shipped/ai-agent.md).

**Extension Plugin Tools** (demonstrate extensibility):

1. **Checklist Tool** (`workflow-tool-checklist`):
   - Configurable checklist items per sequence
   - Per-item hard/soft enforcement
   - Editor UI showing checklist with checkboxes
   - Example of custom editor panel integration

Additional tools can be built as standalone plugins.

**Check modes** (configured per tool, per check):
- **Soft (warning)**: Shows warning icon, displays issues, but allows transition
- **Hard (blocking)**: Shows error icon, prevents transition until passing
- Configuration UI on the **Workflows → Tools** page (there has never been a "Settings → Integrations" screen)

**Unified Settings Schema**: All plugin types (tools, assistants, notification channels) define configurable settings via `settings_schema` in their `meta` block. The UI auto-renders fields via `SchemaSettings.js`. Tool settings with `enforceable: true` display a soft/hard check mode pill. Settings are read at runtime via `AbilitySettings::get_options()`, not from `$input`. Plugins can override the auto-rendered UI with custom React components via JS filters (e.g., `vipWorkflows.toolSettingsComponent`, `vipWorkflows.assistantSettings`). Each such filter receives a callbacks object — `{ disabled, onHasChangesChange, onSaveRef }` — which the card always supplies, so a filter callback may destructure it without guarding. `disabled` is `true` while the tool or agent is switched off, and a plugin-supplied component **must** honor it: pass it to every control, and never report `true` through `onHasChangesChange` while it is set. A card can only disable the controls it renders itself; a plugin component replaces those, so a component that ignores `disabled` leaves a switched-off tool configurable and savable.

**Tool Results Storage**:
- Stored in `wp_vip_ability_results` table — one row per tool run against a post
- Includes summary, duration, and the raw `output` array (score/status/issues, shaped per the ability's `output_schema`)
- Cached and displayed in Editor Tools Panel
- This is a distinct history from the `wp_vip_workflows_events` audit log below: this table is per-tool-run detail used to gate transitions, not the site-wide event stream

**Tool Execution Context**:
```php
$executor = new AbilityExecutor();
$result = $executor->execute('vip-workflows/seo-check', ['post_id' => $post_id]);

// $result is an AbilityResult object. Its own properties are execution
// metadata: id, ability_id, post_id, success (bool), summary, error,
// duration_ms, created_by, created_at. The ability's actual output — score,
// status, issues, or whatever else the ability's output_schema declares —
// lives in $result->output, not as top-level properties.

// Check enforcement during transitions:
$settings = AbilitySettings::get_instance();
$issues = $result->output['issues'] ?? array();
foreach ($issues as $issue) {
    $check_key = $issue['check_key'] ?? 'general';
    $is_hard = $settings->is_hard_check('vip-workflows/seo-check', $check_key);
    // Or check issue severity: $issue['severity'] === 'error' or 'hard'

    if ($is_hard) {
        // Transition blocked - return WP_Error
    }
}
```

### 4. Ideation System

Pre-workflow system for capturing and developing ideas before they become posts, gated behind the `ideation` experiment (see [§ Experiments](../specs/shipped/experiments.md)). One CPT: `vip_ideation` — story ideation projects, registered by `IdeationPostTypes` in `includes/ideation/research/class-ideation-post-types.php` (namespace `VIPWorkflows\Ideation\Research`).

> **A standalone asset library used to live here and was removed** (schema migration `2.16.0`: "The Workflow Notes (assets) subsystem was removed"). There is no `vip_workflows_note` CPT, no `AssetsController`, no `AIMediaAnalyzer`, no `/vip-workflows/v1/assets/upload` route, and no `AssetManager.js` — none of that exists on `main` any more. Uploaded-document AI analysis lives inside the Story Ideation flow below instead (`_vip_ideation_asst_{id}` meta, `MediaProcessor` shared with research), not as a separate asset manager. There is also no ideation-specific assignment feature ("Direct Assignment" / "Automatic") — assignment is a workflow (post-transition) concept, handled by `AssignmentManager` and documented under Sequences above.

### 4b. Story Ideation

Upstream creative workspace for developing story ideas before they enter the editorial workflow. A journalist enters a ~20-word seed describing a story idea. The system deploys specialized AI assistants in parallel to enrich it.

**How it works**:
1. Journalist types a freeform seed (the idea)
2. Seed Analyst extracts tags, entities, search queries via LLM
3. Archive Scout searches published articles (LLM-assisted WP_Query)
4. Web Researcher searches the open web (Tavily)
5. Media Scout finds images and videos (pluggable providers)
6. Results appear as cards in a masonry mood board workspace
7. Editorial Mentor provides continuous guidance as cards are curated
8. Output: Create Draft or Backlog

**Backend** (PHP):
- Uses the `vip_ideation` CPT and `vip_ideation_sources` table
- `IdeationOrchestrator` coordinates assistant execution
- Assistants implement `AssistantInterface` (get_id, get_name, is_available, run)
- `AssistantResult` value object with status, cards, summary, meta
- `ArchiveSearchInterface` is swappable (Phase 1: `LLMAssistedWPSearch`, future: Elasticsearch)
- Card pin/dismiss states stored as project post meta
- REST endpoints: `/vip-workflows/v1/ideation/seed`, `/ideation/{id}`, `/ideation/{id}/pin`, `/ideation/{id}/dismiss`, `/ideation/{id}/mentor`, `/ideation/{id}/generate-image`

**Media Provider System**:

The `MediaScout` assistant orchestrates pluggable media providers for images and videos. Each provider implements `MediaProviderInterface` and is discovered via the `vip_workflows_media_providers` filter.

Built-in providers:
- `TavilyImageProvider` - web image search via Tavily API (`include_images: true`)
- `TavilyVideoProvider` - video search via Tavily with `include_domains` scoped to YouTube/Vimeo
- `YouTubeVideoProvider` - YouTube Data API v3 with search + contentDetails batch for durations
- `AiImageProvider` - AI image generation via OpenAI DALL-E, saves to WP Media Library

Provider interface contract:
```php
interface MediaProviderInterface {
    public function get_id(): string;
    public function get_name(): string;
    public function is_configured(): bool;
    public function is_generative(): bool;
    public function search_media( string $query, int $max_results = 8, array $context = array() );
}
```

Non-generative providers run automatically during ideation. Generative providers (DALL-E) are triggered on-demand via the generate endpoint. External plugins add providers via:
```php
add_filter( 'vip_workflows_media_providers', function( $providers ) {
    $providers[] = new MyCustomMediaProvider();
    return $providers;
} );
```

**Frontend** (React):
- `Ideation.js` page with seed input landing and workspace routing
- `SeedInput.js` - prominent freeform textarea
- `IdeationWorkspace.js` - layout: top bar + masonry board + assistant panel
- `MoodBoard.js` + `IdeationCard.js` - CSS columns masonry with type-specific cards
- `AssistantPanel.js` - collapsible right panel with mentor guidance and assistant results
- `use-card-actions.js` / `use-mentor.js` - hooks for interactions

**Key files**:
- `includes/ideation/assistants/` - all assistant classes
- `includes/api/class-ideation-controller.php` - REST controller
- `src/admin/components/ideation/` - all React components
- [`docs/specs/shipped/interactive-ideation-assistants.md`](../specs/shipped/interactive-ideation-assistants.md) — ideation assistant design

### 5. Story Discovery Framework

**Extensible provider system** for surfacing story ideas on the ideation landing page before a seed exists.

**Architecture**:
- `DiscoveryProviderRegistry` (singleton) collects providers via `vip_workflows_register_discovery_providers` action
- Providers declare `features` (`recommend`, `search`) and register callbacks for recommendations, search, filters, and seed composition
- `DiscoveryController` exposes REST endpoints that proxy to registered providers
- `StoryDiscovery` React component renders provider sections on the landing page between SeedInput and RecentProjects
- `DiscoverySearchModal` renders dynamic filter controls from provider filter definitions
- Providers appear on the unified Agents page (see §5a below); plugins spanning discovery + research group their capabilities via `vip_workflows_register_assistant_meta`

**Key files**:
- `includes/discovery/` - registry and module
- `includes/api/class-discovery-controller.php` - REST controller
- `src/admin/components/ideation/StoryDiscovery.js` - landing page section
- `src/admin/components/ideation/DiscoverySearchModal.js` - search modal
- [`docs/specs/shipped/story-discovery.md`](../specs/shipped/story-discovery.md) — full spec

### 5a. Unified Assistants (Agents page)

**One card per plugin** on the **Workflows → Agents** page (there is no longer a tabbed "Integrations" page — see [admin-ui.md](admin-ui.md)), regardless of whether a plugin provides a research ability, a discovery provider, or both.

**Architecture**:
- `AssistantRegistry` (singleton) synthesizes unified entries from `AbilitySettings` (category = `research`) and `DiscoveryProviderRegistry`
- Plugins spanning multiple capabilities declare a manifest via the `vip_workflows_register_assistant_meta` action with `ability_ids`, `provider_slugs`, and merged `settings_schema`
- Single-capability plugins are auto-wrapped: abilities key by plugin prefix (`plugin/ability` → `plugin`), providers key by their provider slug
- `AssistantsController` exposes `GET /v1/assistants` and `POST /v1/assistants/{slug}/settings`; saves write through to underlying `vip_workflows_ability_settings` and `vip_discovery_provider_*` options so legacy consumers keep working unchanged
- `AssistantCard` renders the card; plugins inject custom React settings via the `vipWorkflows.assistantSettings` JS filter (with backward-compat fallback to `vipWorkflows.assistantSettingsComponent` and `vip_workflows_discovery_provider_settings`)

**Key files**:
- `includes/assistants/class-assistant-registry.php` - unified registry
- `includes/api/class-assistants-controller.php` - REST controller
- `src/admin/components/AssistantsTab.js` - unified tab
- `src/admin/components/AssistantCard.js` - unified card
- [`docs/specs/shipped/unified-assistants-tab.md`](../specs/shipped/unified-assistants-tab.md) — full spec

### 6. Notifications System

**Multi-channel notification system** for workflow events.

**Architecture**:
- **NotificationDispatcher**: Central hub that receives requests and routes to channels
- **NotificationChannel Interface**: Standard interface for all channels
- **Built-in Channels**: Email, Slack
- **Custom Channels**: Extensible via standalone plugins

> **No in-app bell/inbox.** The `wp_vip_workflows_notifications` table is still created by `class-schema.php`, but nothing in the plugin reads or writes it — there is no admin-bar bell, no unread dropdown, no mark-as-read. The only delivery paths today are the Email and Slack channels below. If that changes, this table stops being vestigial and this note should come out.

**Notification Types** (routed via the event-to-channel matrix; see below):
- `published` — a post's first crossing into the `publish` region, whether the crossing was workflow-driven or a core-driven publish (scheduled post, quick edit, REST, CLI)
- Per-transition — any transition a sequence configures `notifications: [...]` on sends its own template to those channels directly, independent of the routing matrix

**Channel Configuration** — **Workflows → Notifications**, two tabs, one Save for the screen:
- **Channels** — one card per registered channel (Slack supports multiple webhook destinations, each its own card). Email uses `wp_mail()`; Slack needs a webhook URL
- **Routing** — the event → channels matrix (currently just `published`) plus a debug mode that mirrors every event to chosen channels for testing
- **Custom**: a plugin registers a channel via the `vip_workflows_notification_channels` filter and provides its own settings UI

### 6b. Audit Log

Two separate systems both get called "audit trail" in this codebase; they store different things and back different UI.

| | `wp_vip_workflows_events` | `wp_vip_ability_results` |
|---|---|---|
| **What it records** | Every workflow event: status transitions, blocked transitions, tool runs/warnings/failures, workflow assignment/claim/release, sequence configuration changes | One row per tool (ability) run against a post: score/status/issues, duration, success |
| **Surface** | **Workflows → Audit Log** admin page (`src/admin/pages/AuditLog.js`), a site-wide, filterable (event type, user, post, search) event stream | Editor Tools Panel — the cached result of the last run of each tool against the current post |
| **Backing controller** | `includes/api/class-audit-log-controller.php` (`GET /vip-workflows/v1/audit-log`) | `includes/api/class-abilities-controller.php` / `AbilityResultRepository` |
| **Used to gate transitions?** | No — it is a read of what already happened | Yes — `StatusManager::run_transition_tools()` reads the fresh result, not this stored history, but successful runs land here |

Both are pruned by the same nightly `Maintenance\Cleanup` routine (see §7) — ability results after 90 days, events after a year.

### 7. Scheduled Cleanup

Two tables grow one row at a time and nothing else prunes them: `vip_ability_results` (a row per tool run) and `vip_workflows_events` (a row per workflow event). `VIPWorkflows\Maintenance\Cleanup` deletes ability results older than 90 days and events older than a year, nightly at 2am site time on ActionScheduler.

It is a single routine, not a job framework. There is no job registry, no per-job settings and no Jobs screen: an earlier version had all three, plus a `Job` base class and a `vip_workflows_register_jobs` hook, and nothing outside the plugin ever used them.

**Reporting**: a run writes one `maintenance.cleanup` event to the audit log carrying what it deleted, or the database error if a DELETE failed. That is the whole interface — "did cleanup run, and did it work" is answered where every other question about what the plugin did is answered, with the same filters. The entry carries no post and no actor: it belongs to no one, and crediting it to whoever happened to be logged in when cron fired would be a lie.

### 8. Events & Automation

**EventBus** provides pub/sub system for workflow events.

**Workflow Events**:
```php
// Stage transitions — $context = ['cause' => 'workflow'|'core', 'committed_status' => ...]
// ('workflow' = edge traversal; 'core' = checkpoint reseat after a core status change)
do_action('vip_workflows_status_transition', $post_id, $new_stage, $old_stage, $sequence, $context);
do_action('vip_workflows_entered_{stage}', $post_id, $old_stage, $sequence, $context);
do_action('vip_workflows_exited_{stage}', $post_id, $new_stage, $sequence, $context);

// Tool execution
do_action('vip_workflows_ability_executed', $ability_id, $post_id, $result);
do_action('vip_workflows_ability_failed', $ability_id, $post_id, $error);
```

**What listens**: the bus stores every event it emits — that stream is what the audit log, a post's Workflow History modal and the `get-recent-activity` ability read. Delivery is `NotificationDispatcher`, which matches an event against the routing option and sends on each subscribed channel. Anything else subscribes with `add_action( 'vip_workflows_event_emitted', … )`.

There is no rules engine. An earlier version stored trigger/condition/action "flows" in `wp_vip_automation_flows` and executed them off the bus; nothing could author a flow, so the table was always empty and the engine was removed.

---

## Architecture Overview

### Visual System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Pre-Workflow: Ideation System                                  │
│                                                                  │
│  Story 1 (idea) ──→ Assets (docs, images, recordings)          │
│  Story 2 ──→ Assigned Writer                                   │
│  Story 3 (in-progress) ──→ Post Created                        │
│                                      ↓                           │
└──────────────────────────────────────┼───────────────────────────┘
                                       ↓
┌──────────────────────────────────────┼───────────────────────────┐
│  Workflow: Sequence-Driven Production                          │
│                                      ↓                           │
│  Sequence defines:                 Post                        │
│    - Stages + status regions         ↓                          │
│    - Allowed transitions          draft → review → approved     │
│    - Required tools                  ↓                          │
│    - Automations                  Tools Panel                   │
│                                   (SEO, Readability)             │
│                                      ↓                           │
│                                   Status Transition              │
│                                      ↓                           │
│                                   Events Fired                   │
│                                      ↓                           │
│                        ┌─────────────┴──────────────┐            │
│                        ↓                            ↓            │
│                   Automations                  Notifications     │
│                   (workflows)                  (email, Slack)    │
│                        ↓                                         │
│                   Background Jobs                                │
│                   (cleanup, SLA)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Module System

Subsystems implement `ModuleInterface` (`get_id()`, `init()`) and are registered via `Plugin::register_module()`. Core services (EventBus, PostTypeManager, StatusManager) are initialized explicitly first; modules are initialized in a loop after. External plugins register modules via `vip_workflows_register_modules` action. REST controllers use the same pattern via `vip_workflows_rest_controllers` filter.

### Component Hierarchy

```
VIPWorkflows\Plugin (Singleton Bootstrap)
├── Sequences\
│   ├── Sequence (Data Object)
│   └── SequenceRepository (CRUD)
│
├── Workflow\
│   ├── PostTypeManager (Maps post types to sequences)
│   ├── StatusManager (Handles transitions)
│   ├── WorkflowEvents (Emits events)
│   ├── AgentRunner (Async agent tasks)
│   └── AssignmentManager (User assignments)
│
├── Ideation\Research\
│   └── IdeationPostTypes (Registers the vip_ideation CPT — the old Workflow Notes/asset CPT was removed in schema 2.16.0)
│
├── Abilities\
│   ├── AbilityRegistry (Tool registration)
│   ├── AbilityExecutor (Execution with context)
│   ├── AbilityResult (Result object)
│   ├── AbilityResultRepository (Result storage)
│   ├── AbilitySettings (Per-tool configuration)
│   └── tools/
│       ├── seo-check.php
│       ├── readability.php
│       └── keyword-check.php
│
├── Experiments\
│   ├── Experiment (Abstract base for toggleable experiments)
│   ├── ExperimentRegistry (Tracks experiments, resolves enabled state)
│   ├── ExperimentCLI (wp vip-workflows experiment list|enable|disable)
│   └── IdeationExperiment (Gates IdeationPostTypes, SourceProcessingJob, DiscoveryModule)
│
├── Automation\
│   ├── EventBus (Records every event the plugin emits)
│   └── EventRegistry (Event definitions)
│
├── Notifications\
│   ├── NotificationDispatcher (Central dispatcher)
│   ├── Notification (Data object)
│   ├── NotificationChannel (Interface)
│   └── channels/
│       ├── EmailChannel
│       └── SlackChannel
│
├── Maintenance\
│   └── Cleanup (Nightly prune, reported to the audit log)
│
├── API\
│   ├── RestController (Base class)
│   ├── SequencesController
│   ├── WorkflowController (Transitions)
│   ├── AbilitiesController (Tool execution)
│   ├── ToolsController (Tool settings/toggles)
│   ├── NotificationsController
│   ├── ExperimentsController (Toggle experiments)
│   ├── PromptsController
│   ├── AssignableUsersController
│   ├── MetadataController
│   └── AuditLogController
│
├── Admin\
│   ├── Admin (Main menu, page dispatcher)
│   ├── IdeationAdmin (Ideation UI)
│   ├── Settings (General settings, capability checks for audit log/bypass)
│   ├── PostsColumns (Workflow column)
│   ├── DashboardWidget ("My Workflow")
│   └── AdminStyles
│
├── AI\
│   └── EventDispatcher (PSR-14 for AI request logging)
│
├── Editor\
│   └── EditorIntegration (Sidebar scripts)
│
├── Database\
│   ├── Schema (Table definitions)
│   └── Seeder (Default data)
│
└── Integrations\
    ├── MediaProcessor (core AI: image vision, audio/video transcription, PDF analysis; shared by research + ideation — no longer by an asset manager, which was removed)
    ├── UrlMetaExtractor (Fetch Open Graph/meta from URLs)
    ├── ContentExtractor (Extract text content from URLs/HTML)
    ├── DraftBuilder (Build post drafts from ideation data)
    ├── GuidelineContextProvider (Read guideline context from Gutenberg/Core for AI)
    └── YouTubeTranscript (YouTube transcript extraction)
```

### Bootstrap Flow

```php
// vip-workflows.php
add_action('plugins_loaded', 'VIPWorkflows\init');

function init() {
    $plugin = Plugin::get_instance(); // Singleton
    $plugin->init();
}

// Plugin::init()
1. Load text domain
2. Initialize core services (order matters):
   - EventBus
   - PostTypeManager (maps post types on 'init' hook)
   - StatusManager
   - Ability registration (on 'wp_abilities_api_init' hook)
   - REST API controllers
3. Register modules (order does NOT matter):
   - register_module() for each subsystem (EditorIntegration, Cleanup, etc.)
   - Admin modules gated with is_admin()
   - do_action('vip_workflows_register_modules') for external plugins
   - foreach loop calls init() on all registered modules
4. Register hooks
```
