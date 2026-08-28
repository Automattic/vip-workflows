# Architecture Reference

High-level orientation for VIP Workflow: what it is, the core concepts (sequences, statuses, tools, ideation, notifications, jobs, events), and the overall system architecture. Start here if you are new to the codebase.

For file-by-file layout see [file-structure.md](file-structure.md). For database tables see [database-schema.md](database-schema.md). For code examples see [code-patterns.md](code-patterns.md).

---

## What This Is

### Strategic Context

**VIP Workflow** is a workflow orchestration platform for WordPress VIP. It gives editorial teams sequence-driven statuses, governed transitions, assignments, content quality tools, automation, notifications, and ideation workflows inside WordPress.

The scope is deliberately broader than simple status transitions, but the repo now stays focused on workflows and adjacent editorial operations. Contributor identity and XML sitemap generation live in standalone plugins.

**Architecture**: Posts for content, CPTs for domain objects, join tables for relationships.

| Concept | Implementation |
|---------|---------------|
| Article/Content | `wp_posts` (Post or CPT) |
| Story (lifecycle container) | `vip_story` CPT |
| Workflow Stage | Post meta `_vip_workflow_current_stage_key` (queried via `StageQuery`) |
| Stage Transition | `StatusManager::transition()` — stage meta write; `post_status` written only when the edge crosses a status-region boundary |
| Story-to-Object links | `wp_vip_story_objects` join table + `_vip_story_id` meta |
| Audit Trail | `wp_vip_workflow_events` (with `story_id` column) |

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
            "meta_key": "_vip_workflow_assigned_to",
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

Workflow stages live in post meta (`_vip_workflow_current_stage_key`), never in `post_status` — no custom post statuses are registered. `post_status` stays core-owned and only ever takes core values.

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
wp_register_ability('vip-workflow/seo-check', [
    'label'       => 'SEO Check',
    'category'    => 'vip-workflow',
    'input_schema' => [/* ... */],
    'output_schema' => [/* ... */],
    'execute_callback' => 'vip_workflow_execute_seo_check',
    'permission_callback' => function() {
        return current_user_can('edit_posts');
    },
]);
```

**Tool types**:
- **Check tools**: Validate content (SEO, readability, brand safety)
- **Helper tools**: Generate/transform content (headline generator, excerpt)

**Built-In Tools** (in vip-workflow/includes/abilities/tools/):

1. **SEO Check** (`vip-workflow/seo-check`):
   - Word count (min/max thresholds)
   - Meta description (presence, length)
   - Title tags (length, keyword placement)
   - Keyword density
   - Heading structure (H1, H2, H3 hierarchy)
   - Image alt text coverage
   - Returns score 0-100

2. **Readability** (`vip-workflow/readability`):
   - Flesch-Kincaid Reading Ease score
   - Flesch-Kincaid Grade Level
   - Average sentence length
   - Average word length
   - Complex word percentage
   - Returns score 0-100

3. **Keyword Check** (`vip-workflow/keyword-check`):
   - Target keyword density
   - Keyword placement in title/meta/headings
   - Keyword variations
   - Returns pass/warning/fail per check

4. **AI Agent** (`vip-workflow/ai-agent`):
   - Conversational AI assistant (chat interface in sidebar)
   - Multi-turn conversations with post context
   - Aware of available tools/abilities (can recommend running them)
   - Can suggest title, excerpt, and text replacements
   - Highlighted text awareness for rewriting
   - Chat history persisted per post in `vip_ai_agent_conversations` table
   - Configurable model (default: gpt-4o)
   - Display name stored in constant for easy renaming

**Extension Plugin Tools** (demonstrate extensibility):

4. **Checklist Tool** (`workflow-tool-checklist`):
   - Configurable checklist items per sequence
   - Per-item hard/soft enforcement
   - Editor UI showing checklist with checkboxes
   - Example of custom editor panel integration

Additional tools can be built as standalone plugins.

**Check modes** (configured per tool, per check):
- **Soft (warning)**: Shows warning icon, displays issues, but allows transition
- **Hard (blocking)**: Shows error icon, prevents transition until passing
- Configuration UI on the **Workflows → Tools** page (there has never been a "Settings → Integrations" screen)

**Unified Settings Schema**: All plugin types (tools, assistants, notification channels) define configurable settings via `settings_schema` in their `meta` block. The UI auto-renders fields via `SchemaSettings.js`. Tool settings with `enforceable: true` display a soft/hard check mode pill. Settings are read at runtime via `AbilitySettings::get_options()`, not from `$input`. Plugins can override the auto-rendered UI with custom React components via JS filters (e.g., `vipWorkflow.toolSettingsComponent`, `vipWorkflow.assistantSettings`). Each such filter receives a callbacks object — `{ disabled, onHasChangesChange, onSaveRef }` — which the card always supplies, so a filter callback may destructure it without guarding. `disabled` is `true` while the tool or agent is switched off, and a plugin-supplied component **must** honor it: pass it to every control, and never report `true` through `onHasChangesChange` while it is set. A card can only disable the controls it renders itself; a plugin component replaces those, so a component that ignores `disabled` leaves a switched-off tool configurable and savable.

**Tool Results Storage**:
- Stored in `wp_vip_ability_results` table
- Includes score, status, detailed results JSON, execution time
- Cached and displayed in Editor Tools Panel
- Audit trail for compliance

**Tool Execution Context**:
```php
$executor = new AbilityExecutor();
$result = $executor->execute('vip-workflow/seo-check', ['post_id' => $post_id]);

// $result is AbilityResult object with:
// - success (boolean)
// - score (0-100 or null)
// - status ('pass', 'warning', 'fail')
// - summary (human-readable)
// - data (detailed results array)
// - issues (array of issue objects with check_key, message, severity)
// - duration_ms (execution time)
// - post_id (context)

// Check enforcement during transitions:
$settings = AbilitySettings::get_instance();
foreach ($result->issues as $issue) {
    $check_key = $issue['check_key'] ?? 'general';
    $is_hard = $settings->is_hard_check('vip-workflow/seo-check', $check_key);
    // Or check issue severity: $issue['severity'] === 'error' or 'hard'

    if ($is_hard) {
        // Transition blocked - return WP_Error
    }
}
```

### 4. Ideation System

Pre-workflow system for capturing, developing, and assigning ideas before they become posts.

**CPTs**:
- `vip_ideation` - Story ideation projects (see Story Ideation below)
- `vip_workflow_note` - Assets/resources (documents, images, audio, video) - hidden, internal

**Assignment Methods**:
1. **Direct Assignment**: Editor assigns to specific writer
2. **Automatic**: Automation rules assign based on criteria

**Asset Management**:
- Upload documents, images, audio, video
- Automatic AI analysis on upload (Vision API for images, Whisper for audio/video)
- Search and filter asset library
- Asset metadata stored in post meta

### 4b. Story Ideation (New)

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
- REST endpoints: `/vip-workflow/v1/ideation/seed`, `/ideation/{id}`, `/ideation/{id}/pin`, `/ideation/{id}/dismiss`, `/ideation/{id}/mentor`, `/ideation/{id}/generate-image`

**Media Provider System**:

The `MediaScout` assistant orchestrates pluggable media providers for images and videos. Each provider implements `MediaProviderInterface` and is discovered via the `vip_workflow_media_providers` filter.

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
add_filter( 'vip_workflow_media_providers', function( $providers ) {
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
- `DiscoveryProviderRegistry` (singleton) collects providers via `vip_workflow_register_discovery_providers` action
- Providers declare `features` (`recommend`, `search`) and register callbacks for recommendations, search, filters, and seed composition
- `DiscoveryController` exposes REST endpoints that proxy to registered providers
- `StoryDiscovery` React component renders provider sections on the landing page between SeedInput and RecentProjects
- `DiscoverySearchModal` renders dynamic filter controls from provider filter definitions
- Providers appear in the unified Assistants tab on the Integrations page (see §6 below); plugins spanning discovery + research group their capabilities via `vip_workflow_register_assistant_meta`

**Key files**:
- `includes/discovery/` - registry and module
- `includes/api/class-discovery-controller.php` - REST controller
- `src/admin/components/ideation/StoryDiscovery.js` - landing page section
- `src/admin/components/ideation/DiscoverySearchModal.js` - search modal
- [`docs/specs/shipped/story-discovery.md`](../specs/shipped/story-discovery.md) — full spec

### 5a. Unified Assistants (Integrations page)

**One card per plugin** on the Integrations > Assistants tab, regardless of whether a plugin provides a research ability, a discovery provider, or both.

**Architecture**:
- `AssistantRegistry` (singleton) synthesizes unified entries from `AbilitySettings` (category = `research`) and `DiscoveryProviderRegistry`
- Plugins spanning multiple capabilities declare a manifest via the `vip_workflow_register_assistant_meta` action with `ability_ids`, `provider_slugs`, and merged `settings_schema`
- Single-capability plugins are auto-wrapped: abilities key by plugin prefix (`plugin/ability` → `plugin`), providers key by their provider slug
- `AssistantsController` exposes `GET /v1/assistants` and `POST /v1/assistants/{slug}/settings`; saves write through to underlying `vip_workflow_ability_settings` and `vip_discovery_provider_*` options so legacy consumers keep working unchanged
- `AssistantCard` renders the card; plugins inject custom React settings via the `vipWorkflow.assistantSettings` JS filter (with backward-compat fallback to `vipWorkflow.assistantSettingsComponent` and `vip_workflow_discovery_provider_settings`)

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

**In-App Notifications**:
- Bell icon in admin bar with unread count
- Dropdown list of recent notifications
- Click to navigate to related post
- Mark as read/unread
- Stored in `wp_vip_workflow_notifications` table

**Notification Types**:
- Status transitions (post moved to review, approved, etc.)
- Assignments (you've been assigned to a post)
- Tool failures (required check failed)
- SLA breaches (post stuck too long in status)

**Channel Configuration**:
- Email: Uses WordPress `wp_mail()`, no config needed
- Slack: Requires webhook URL in settings
- Custom: Plugin provides settings UI

### 7. Jobs System

**Background job scheduler** using ActionScheduler.

**Architecture**:
- **JobScheduler**: Wrapper around ActionScheduler with registration and monitoring
- **Job Abstract Class**: Base class for all jobs with scheduling and execution hooks
- **Built-in Jobs**: Cleanup, SLA monitoring
- **Custom Jobs**: Extensible via standalone plugins

**Built-In Jobs**:

**CleanupJob** - Daily cleanup:
- Old workflow events (configurable retention, default 90 days)
- Old ability results (configurable retention)
- Orphaned asset attachments

**SlaCheckJob** - Hourly monitoring:
- Checks posts stuck in statuses beyond configured SLA time
- Sends notifications to editors/managers
- Logs SLA violations to events table
- Configurable per-status thresholds

**Job Admin UI**:
- View all registered jobs
- See last run time and next scheduled time
- Manually trigger job execution
- View job execution history

### 8. Events & Automation

**EventBus** provides pub/sub system for workflow events.

**Workflow Events**:
```php
// Stage transitions — $context = ['cause' => 'workflow'|'core', 'committed_status' => ...]
// ('workflow' = edge traversal; 'core' = checkpoint reseat after a core status change)
do_action('vip_workflow_status_transition', $post_id, $new_stage, $old_stage, $sequence, $context);
do_action('vip_workflow_entered_{stage}', $post_id, $old_stage, $sequence, $context);
do_action('vip_workflow_exited_{stage}', $post_id, $new_stage, $sequence, $context);

// Tool execution
do_action('vip_workflow_ability_executed', $ability_id, $post_id, $result);
do_action('vip_workflow_ability_failed', $ability_id, $post_id, $error);
```

**Automation Flows** (stored in `wp_vip_automation_flows`):
- Trigger on specific events
- Evaluate conditions (post type, status, user role, etc.)
- Execute actions (send notification, run tool, webhook, etc.)
- Action handlers extensible via plugins

**Example Automation**:
```json
{
  "trigger": "status.review.entered",
  "conditions": [
    {"field": "post_type", "operator": "equals", "value": "post"}
  ],
  "actions": [
    {
      "type": "notify",
      "config": {
        "to": "role:editor",
        "channel": "slack",
        "message": "{{post.title}} needs review"
      }
    }
  ]
}
```

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

Subsystems implement `ModuleInterface` (`get_id()`, `init()`) and are registered via `Plugin::register_module()`. Core services (EventBus, PostTypeManager, StatusManager) are initialized explicitly first; modules are initialized in a loop after. External plugins register modules via `vip_workflow_register_modules` action. REST controllers use the same pattern via `vip_workflow_rest_controllers` filter.

### Component Hierarchy

```
VIPWorkflow\Plugin (Singleton Bootstrap)
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
├── Ideation\
│   ├── IdeationPostTypes (Registers ideation/note CPTs)
│   └── WorkflowNote (Model)
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
│       ├── keyword-check.php
│       └── ai-agent.php
│
├── Automation\
│   ├── EventBus (Pub/sub system)
│   ├── EventRegistry (Event definitions)
│   ├── ConditionEvaluator (Flow conditions)
│   └── handlers/
│       └── NotificationHandler
│
├── Notifications\
│   ├── NotificationDispatcher (Central dispatcher)
│   ├── Notification (Data object)
│   ├── NotificationChannel (Interface)
│   └── channels/
│       ├── EmailChannel
│       └── SlackChannel
│
├── Jobs\
│   ├── JobScheduler (ActionScheduler wrapper)
│   ├── Job (Abstract base)
│   ├── CleanupJob
│   └── SlaCheckJob
│
├── API\
│   ├── RestController (Base class)
│   ├── SequencesController
│   ├── WorkflowController (Transitions)
│   ├── AbilitiesController (Tool execution)
│   ├── AiAgentController (Chat + conversations)
│   ├── AssetsController
│   ├── NotificationsController
│   └── AuditLogController
│
├── Admin\
│   ├── Admin (Main menu, page dispatcher)
│   ├── IdeationAdmin (Ideation UI)
│   ├── Settings (General settings)
│   ├── PostsColumns (Workflow column)
│   ├── DashboardWidget ("My Workflow")
│   ├── Settings (Settings pages)
│   └── Integrations (Integrations settings)
│
├── AI\
│   ├── EventDispatcher (PSR-14 for AI request logging)
│   └── AiAgentService (Chat orchestration, system prompt, tool awareness)
│
├── Editor\
│   └── EditorIntegration (Sidebar scripts)
│
├── Database\
│   ├── Schema (Table definitions)
│   └── Seeder (Default data)
│
├── Integrations\
│   ├── AIMediaAnalyzer (event adapter — vip_workflow_asset_file_uploaded → MediaProcessor)
│   ├── MediaProcessor (core AI: image vision, audio/video transcription, PDF analysis; shared by assets + research + ideation)
│   └── UrlMetaExtractor (Fetch Open Graph/meta from URLs)
│
└── Monitoring\
    └── SlaMonitor (SLA tracking)
```

### Bootstrap Flow

```php
// vip-workflow.php
add_action('plugins_loaded', 'VIPWorkflow\init');

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
   - register_module() for each subsystem (EditorIntegration, JobScheduler, etc.)
   - Admin modules gated with is_admin()
   - do_action('vip_workflow_register_modules') for external plugins
   - foreach loop calls init() on all registered modules
4. Register hooks
```
