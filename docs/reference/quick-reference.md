# Quick Reference

Lookup tables and cheatsheet material: main PHP entry points, every action/filter hook, every REST endpoint, and the "known issues & important patterns" section that captures gotchas around workflow stages vs `post_status`, tool execution context, hard-check enforcement, bypass permissions, transition inputs, React sidebar state, shared utilities, extension-plugin conventions, and debugging SQL.

Pair with [code-patterns.md](code-patterns.md) for full examples and [architecture.md](architecture.md) for the system context.

---

## Quick Reference

### Key Functions

```php
// Get plugin instance
$plugin = \VIPWorkflows\Plugin::get_instance();

// Get managers
$status_manager = $plugin->get_status_manager();
$post_type_manager = $plugin->get_post_type_manager();
$event_bus = $plugin->get_event_bus();
$job_scheduler = $plugin->get_job_scheduler();

// Transition status
$status_manager->transition($post_id, 'review');

// Get sequence
$repository = new \VIPWorkflows\Sequences\SequenceRepository();
$sequence = $repository->get($sequence_id);

// Execute tool
$executor = new \VIPWorkflows\Abilities\AbilityExecutor();
$result = $executor->execute('vip-workflows/seo-check', $post_id);
```

### Key Hooks

```php
// Workflow events — $context = ['cause' => 'workflow'|'core', 'committed_status' => ...]
// ('workflow' = edge traversal; 'core' = checkpoint reseat after a core status change)
do_action('vip_workflows_status_transition', $post_id, $new, $old, $sequence, $context);
do_action('vip_workflows_entered_{stage}', $post_id, $old_stage, $sequence, $context);
do_action('vip_workflows_exited_{stage}', $post_id, $new_stage, $sequence, $context);

// Tool events
do_action('vip_workflows_ability_executed', $ability_id, $post_id, $result);
do_action('vip_workflows_ability_failed', $ability_id, $post_id, $error);

// Registration
do_action('vip_workflows_register_abilities');
apply_filters('vip_workflows_notification_channels', $channels);
apply_filters('vip_workflows_media_providers', $providers);
// Note: vip_workflows_api_key_fields was removed. Keys live on
// core's Settings → Connectors; read them via VIPWorkflows\AI\Credentials.
```

### Key REST Endpoints

```
# Sequences (type: workflow/editorial, phase)
GET/POST    /vip-workflows/v1/sequences
GET/PUT/DEL /vip-workflows/v1/sequences/{id}

# Workflow
GET         /vip-workflows/v1/workflow/post/{id}/status
POST        /vip-workflows/v1/workflow/post/{id}/transition
GET         /vip-workflows/v1/workflow/post/{id}/history

# Abilities (Tools)
GET         /vip-workflows/v1/abilities
POST        /vip-workflows/v1/abilities/{id}/execute
GET         /vip-workflows/v1/tools
POST        /vip-workflows/v1/tools/{id}/settings

# Settings
GET/POST    /vip-workflows/v1/settings/general
GET         /vip-workflows/v1/settings/general/roles
# API keys are configured under Settings → Connectors.

# Notifications
GET/POST    /vip-workflows/v1/notifications/{channel}/settings

# Story Ideation
POST        /vip-workflows/v1/ideation/seed
GET         /vip-workflows/v1/ideation/{id}
POST        /vip-workflows/v1/ideation/{id}/pin
POST        /vip-workflows/v1/ideation/{id}/dismiss
POST        /vip-workflows/v1/ideation/{id}/mentor
POST        /vip-workflows/v1/ideation/{id}/generate-image

# Story Discovery
GET         /vip-workflows/v1/discovery/providers
GET         /vip-workflows/v1/discovery/recommend
GET         /vip-workflows/v1/discovery/search?provider={slug}&text={query}&filters={json}
GET         /vip-workflows/v1/discovery/filters?provider={slug}
POST        /vip-workflows/v1/discovery/select

# Unified Assistants (Integrations page)
GET         /vip-workflows/v1/assistants
GET         /vip-workflows/v1/assistants/{slug}
POST        /vip-workflows/v1/assistants/{slug}/settings

# AI Agent
POST        /vip-workflows/v1/ai-agent/chat
GET         /vip-workflows/v1/ai-agent/conversations
GET/DEL     /vip-workflows/v1/ai-agent/conversations/{id}

# Jobs
GET         /vip-workflows/v1/jobs
GET         /vip-workflows/v1/jobs/history
GET/POST    /vip-workflows/v1/jobs/{id}/settings
POST        /vip-workflows/v1/jobs/{id}/run
```

---

## Known Issues & Important Patterns

### WordPress VIP Patterns

**Workflow Stages vs post_status**:
- No custom post statuses — the stage lives in `_vip_workflows_current_stage_key` post meta ; `post_status` only ever takes core values
- Every stage declares a `status` region (`draft`/`pending`/`private`/`publish`); `post_status` is written only when a transition crosses a region boundary
- Core-driven status changes re-seat the post at the target region's entry stage (`region_entry`)
- Query stages via the `StageQuery` seam, never by `post_status`

**Tool Execution Context**:
- `AbilityExecutor::execute()` expects `['post_id' => $id]` context, NOT just `$post_id`
- Old pattern (wrong): `$executor->execute($ability_id, $post_id)`
- New pattern (correct): `$executor->execute($ability_id, ['post_id' => $post_id])`
- Results are `AbilityResult` objects with `success`, `score`, `status`, `issues[]`, etc.
- The surface a run came from is the optional third argument — `$executor->execute($ability_id, ['post_id' => $post_id], 'transition')` — and an ability reads it back with `AbilityExecutor::current_context()`. Never put it in the input array: abilities declare `additionalProperties => false`, so it would fail validation

**Hard Check Enforcement Logic**:
- Hard failures detected in `StatusManager::run_transition_tools()`
- Checks `AbilitySettings::is_hard_check($ability_id, $check_key)` for each issue
- Also respects issue `severity` field ('error' or 'hard' = blocking)
- Returns `WP_Error` with code `hard_check_failed` if any hard failures found
- Blocked transitions logged to `wp_vip_workflows_events` via `log_blocked_transition()`

**Bypass Permissions**:
- `Settings::can_user_bypass_workflow()` - Skip assignment requirements
- `Settings::can_user_bypass_tool_checks()` - Skip hard check enforcement
- Checked in `StatusManager::transition()` before enforcement
- Default: Administrators can bypass both (configurable in Settings → General)

**Transition Input Notes**:
- Sequence defines `input` object with `note_id`, `note_name`, `meta_key`
- Frontend sends `inputData` object with notes array during transition
- Backend stores in TWO places:
  1. `_vip_workflows_transition_data` meta (per-status history)
  2. `wp_vip_workflows_events` table (audit log with notes column)
- Meta keys generated as `wfp_{note_id}_{sanitized_slug}`

**Assignment Requirements**:
- Sequence defines `requires_assignment` with `meta_key` and `match` rule
- Match types: `current_user`, `role:editor`, etc.
- Validated via `AssignmentManager::user_satisfies_requirement()`
- Transitions locked/unlocked in frontend via `_locked` and `_locked_reason` props
- Can be bypassed if user has `can_user_bypass_workflow()` permission

**Held Transitions (`_locked` / `_locked_reason` / `_locked_code`)**:
- A transition the user may see but not take carries `_locked: true` plus
  `_locked_reason` (a finished sentence for the reader). Assignment, role and
  capability locks are all projected this way, as is the required-metadata gate
- `_locked_code` names the RULE holding it, for code rather than for a reader.
  Only the required-metadata gate sets one today
  (`Sequence::CODE_REQUIRED_METADATA`, the same string
  `StatusManager::transition()` refuses with, so the projected view and the 422
  cannot drift apart). Add a code alongside any new lock a client must
  recognise, and add the key to `get_available_transitions()`'s allowlist or the
  payload drops it silently
- The editor may re-judge exactly one lock, and only downwards:
  `src/editor/required-metadata.js` RELEASES a `_locked_code:
  required_fields_missing` row whose fields have been filled in the sidebar but
  not yet saved. It never adds a lock — whether an edge is covered by the gate
  is a question about stage regions only `Sequence` answers. Clearing a field
  therefore still offers the move; the click saves, the server refuses, and the
  refusal re-reads the status

### React/JavaScript Patterns

**Editor Sidebar State**:
- Everything lives in one "Workflow" `PluginSidebar`; there are no
  `PluginDocumentSettingPanel`s
- `WorkflowPanel.js` is the main controller component — one
  `/workflow/post/{id}/status` request feeds the sequence name, the progress
  list, assignment/claim, the stage agent's state and the transitions
- Server returns transitions with `_locked` boolean for unavailable ones, plus
  `_locked_reason` and (for the required-metadata gate) `_locked_code` — see
  **Held Transitions** above for the one lock the editor may release itself
- Modals handle input collection before calling transition API
- `WorkflowSaveGuard.js` is mounted unconditionally from `index.js`, outside
  every card: core's `PanelBody` renders `isOpened && children`, so putting it
  in a panel tore down its `editor.preSavePost` filter whenever the panel closed
- The transition trail is `GET /workflow/post/{id}/history` (paged: `page`,
  `per_page`, totals in `X-WP-Total` / `X-WP-TotalPages`), rendered in a
  code-split modal — the route is gated on `edit_post`, unlike the role-gated
  `/audit-log`

**Sequence (Sequence) Graph Editor** (`src/admin/components/graph/`):
- `SequenceGraphEditor.js` serves both editorial (`type: 'workflow'`) and phase sequences via a `mode` prop
- `graph-model.js` is the pure model: stages ↔ nodes/edges projection, mutations, `validateSequence()`
- `GraphCanvas.js` wraps `@xyflow/react`; inspectors (`StageInspector.js`, `TransitionInspector.js`, `SequenceSettingsInspector.js`, `PhaseStageInspector.js`) edit the current selection
- `TransitionInspector.js` generates `note_id` as random string (e.g., `n123abc`) and auto-generates `meta_key` as `wfp_{note_id}_{slug}`
- Assignment input type pre-fills `meta_key: "_vip_workflows_assigned_to"`

**Build System**:
- Webpack builds multiple entry points (admin, editor, ideation, notifications)
- Run `npm run build` to compile React/CSS
- Built files in `build/` with asset manifests for dependency injection
- Use `@wordpress/*` packages for consistency with Gutenberg

**UI Conventions**:
- Add `data-*-id` attributes to list items for debugging (e.g., `data-project-id`, `data-source-id`)
- This allows easy inspection of IDs in browser DevTools

### Shared Utility Architecture

**CRITICAL: Never embed reusable functionality in feature-specific controllers.**

Generic utilities live in `includes/integrations/`:
- `MediaProcessor` - AI processing for images, audio, video, PDFs (used by research sources, assets)
- `UrlMetaExtractor` - Fetch Open Graph/meta tags from URLs (used by research, etc.)
- `AIMediaAnalyzer` - Thin event-driven adapter; hooks `vip_workflows_asset_file_uploaded` and dispatches to `MediaProcessor`. No longer contains its own AI logic.

Shared REST endpoints live in `includes/api/class-utility-controller.php`:
- `GET /vip-workflows/v1/url-meta?url=...` - URL metadata extraction

**Decision criteria:**
1. Is this specific to ONE feature? → Put in feature controller
2. Could this be used by MULTIPLE features? → Extract to `includes/integrations/` (`VIPWorkflows\Integrations`)
3. Is this a REST endpoint for generic functionality? → Put in `UtilityController`

### Extension Plugin Patterns

**All tools** must set `meta.type` (`check`, `helper`, `validator`, `agent`) to appear in Integrations > Tools. Tools without `meta.type` are hidden from the admin UI. Ability IDs use `vendor/name` slash format (e.g., `my-plugin/my-check`). Never use `sanitize_key()` on ability IDs.

**Check Tools** (e.g., editorial-alignment, checklist):
- Register on `wp_abilities_api_init` hook via `vip_workflows_register_ability()`
- Set `meta.type` to `'check'` or `'validator'`
- Return `AbilityResult` with `issues[]` array
- Each issue has `check_key`, `message`, `severity` ('error', 'warning', 'info')
- Define configurable settings in `meta.settings_schema` (not `input_schema`)
- Fields with `enforceable: true` get soft/hard check mode pills in UI
- Set `meta.show_in_commands = true` on ability registration so admins can enable "Show in Command Palette (⌘K)" for the tool in Integrations > Tools. The actual on/off value is admin-configured per site; the meta flag is only the opt-in gate.
- Set `meta.transition_eligible = true` on ability registration so admins can enable "Can be used in transitions" for the tool in Integrations > Tools.
- Read settings at runtime via `AbilitySettings::get_options()`, not from `$input`
- Display results inline in editor sidebar

**Helper Tools** (e.g., excerpt-generator):
- Set `meta.type` to `'helper'`
- Define configurable settings in `meta.settings_schema`
- Read settings at runtime via `AbilitySettings::get_options()`
- Use modal interface, not inline results
- Provide "Apply" button to insert generated content
- Don't block transitions (no hard checks)

**Notification Channels** (e.g., ntfy):
- Extend `NotificationChannel` base class
- Implement `get_id()`, `get_name()`, `send()`
- Register via `vip_workflows_notification_channels` filter
- Provide settings page for API keys/config

**Media Providers** (image/video sources for ideation):
- Implement `MediaProviderInterface` (get_id, get_name, is_configured, is_generative, search_media)
- Register via `vip_workflows_media_providers` filter
- Return standardized result arrays with `url`, `title`, `media_type`, `thumbnail`, `provider`, etc.
- Non-generative providers run automatically; generative run on-demand
- Built-in provider keys come from `VIPWorkflows\AI\Credentials` (core Settings → Connectors, or a `VIP_WORKFLOWS_*_KEY` constant). Third-party providers read their own key from a `wp-config.php` constant.
- Optionally implement `MediaProviderRequirements::get_unmet_requirement()` (built with `RequirementFactory`) so an unconfigured provider can explain why, instead of Media Scout reporting a bare "unavailable"
- Any provider can be turned off by removing from filter, or moved between core and external plugins

### Testing & Debugging

**Browser Testing**:
1. Navigate to post editor (`/wp-admin/post.php?post=123&action=edit`)
2. Open browser console to see API calls
3. Check Network tab for `/vip-workflows/v1/workflow/post/{id}/transition`
4. Look for WP_Error responses with `hard_check_failed` code

**Database Queries**:
```sql
-- Check blocked transitions
SELECT * FROM wp_vip_workflows_events
WHERE event_type = 'blocked_transition'
ORDER BY created_at DESC LIMIT 10;

-- Check tool results
SELECT * FROM wp_vip_ability_results
WHERE post_id = 123
ORDER BY created_at DESC;

-- Check transition history with notes
SELECT * FROM wp_vip_workflows_events
WHERE post_id = 123 AND event_type = 'status_transition'
ORDER BY created_at DESC;
```

**Common Debug Steps**:
1. Check if sequence is assigned: `get_post_meta($post_id, '_vip_workflows_sequence_id')`
2. Check current stage: `get_post_meta($post_id, '_vip_workflows_current_stage_key')`
3. Check ability settings: `AbilitySettings::get_instance()->get_options($ability_id)`
4. Check user permissions: `Settings::can_user_bypass_tool_checks()`
5. Check recent events: Query `wp_vip_workflows_events` for `post_id`
