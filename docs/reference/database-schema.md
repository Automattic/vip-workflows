# Database Schema Reference

Generated from `vip-workflow/includes/database/class-schema.php` (v2.14.0).

---

## Core Tables

### `wp_vip_sequences`
Editorial and phase process definitions. JSON config drives statuses, transitions, required tools, and role permissions. The `type` column is `'workflow'` (labeled "Editorial Sequences" in the UI) or `'phase'`.

```sql
CREATE TABLE wp_vip_sequences (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    uuid char(36) NOT NULL UNIQUE,
    type varchar(20) NOT NULL DEFAULT 'workflow',
    name varchar(255) NOT NULL,
    slug varchar(255) NOT NULL,
    description text,
    version int(10) unsigned NOT NULL DEFAULT 1,
    status varchar(20) NOT NULL DEFAULT 'draft',  -- draft, active, archived
    config longtext NOT NULL,                      -- JSON configuration
    created_by bigint(20) unsigned NOT NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    UNIQUE KEY type_slug_version (type, slug, version),
    KEY status (status),
    KEY type (type),
    KEY created_by (created_by)
);
```

### `wp_vip_workflow_events`
Audit log. Every status transition, tool run, and system event is recorded here.

```sql
CREATE TABLE wp_vip_workflow_events (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    post_id bigint(20) unsigned DEFAULT NULL,
    event_type varchar(100) NOT NULL,
    event_data longtext,                           -- JSON details
    actor_id bigint(20) unsigned DEFAULT NULL,
    actor_type varchar(20) NOT NULL DEFAULT 'user', -- user, system, automation
    created_at datetime NOT NULL,
    KEY post_id (post_id),
    KEY event_type (event_type),
    KEY actor_id (actor_id),
    KEY created_at (created_at),
    KEY post_event (post_id, event_type)
);
```

### `wp_vip_workflow_notifications`
In-app notification inbox per user.

```sql
CREATE TABLE wp_vip_workflow_notifications (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    user_id bigint(20) unsigned NOT NULL,
    post_id bigint(20) unsigned DEFAULT NULL,
    type varchar(50) NOT NULL,
    title varchar(255) NOT NULL,
    message text NOT NULL,
    data longtext,                                 -- JSON payload
    is_read tinyint(1) NOT NULL DEFAULT 0,
    created_at datetime NOT NULL,
    read_at datetime DEFAULT NULL,
    KEY user_id (user_id),
    KEY post_id (post_id),
    KEY type (type),
    KEY is_read (is_read),
    KEY created_at (created_at)
);
```

### `wp_vip_ability_results`
Tool/ability execution history. One row per tool run against a post.

```sql
CREATE TABLE wp_vip_ability_results (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    ability_id varchar(100) NOT NULL,
    post_id bigint(20) unsigned DEFAULT NULL,
    success tinyint(1) NOT NULL DEFAULT 1,
    summary text,
    result_data longtext,                          -- JSON full results
    duration_ms int(10) unsigned DEFAULT 0,
    created_by bigint(20) unsigned NOT NULL,
    created_at datetime NOT NULL,
    KEY ability_id (ability_id),
    KEY post_id (post_id),
    KEY created_at (created_at)
);
```

---

## Organization Tables

### `wp_vip_workflow_roles`
Extended role definitions beyond WordPress core roles.

```sql
CREATE TABLE wp_vip_workflow_roles (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    role_key varchar(100) NOT NULL UNIQUE,
    display_name varchar(255) NOT NULL,
    description text,
    capabilities longtext,                         -- JSON
    metadata longtext                              -- JSON
);
```

### `wp_vip_workflow_desks`
Team/desk structure. Supports hierarchy via `parent_id`.

```sql
CREATE TABLE wp_vip_workflow_desks (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    name varchar(255) NOT NULL,
    slug varchar(255) NOT NULL UNIQUE,
    description text,
    parent_id bigint(20) unsigned DEFAULT NULL,
    metadata longtext,                             -- JSON
    KEY parent_id (parent_id)
);
```

### `wp_vip_workflow_user_desks`
User-to-desk membership with role (lead, member).

```sql
CREATE TABLE wp_vip_workflow_user_desks (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    user_id bigint(20) unsigned NOT NULL,
    desk_id bigint(20) unsigned NOT NULL,
    role_key varchar(100) DEFAULT NULL,
    UNIQUE KEY user_desk (user_id, desk_id),
    KEY desk_id (desk_id)
);
```

---

## Ideation Tables

### `wp_vip_ideation_sources`
Research cards collected by assistants for ideation projects.

```sql
CREATE TABLE wp_vip_ideation_sources (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    project_id bigint(20) unsigned NOT NULL,
    source_id varchar(20) NOT NULL,
    url varchar(2048) DEFAULT NULL,
    title varchar(500) DEFAULT NULL,
    domain varchar(255) DEFAULT NULL,
    favicon varchar(500) DEFAULT NULL,
    image varchar(500) DEFAULT NULL,
    published_at datetime DEFAULT NULL,
    author varchar(255) DEFAULT NULL,
    excerpt text,
    content longtext,
    is_trusted tinyint(1) NOT NULL DEFAULT 0,
    source_type varchar(20) NOT NULL DEFAULT 'article',
    origin varchar(20) NOT NULL DEFAULT 'search',
    ability_id varchar(100) DEFAULT NULL,
    group_id varchar(100) DEFAULT NULL,
    search_query varchar(500) DEFAULT NULL,
    attachment_id bigint(20) unsigned DEFAULT NULL,
    file_type varchar(100) DEFAULT NULL,
    file_size bigint(20) unsigned DEFAULT NULL,
    processing_status varchar(20) DEFAULT NULL,
    tags text,
    notes text,
    ai_analysis longtext,                          -- JSON
    added_by bigint(20) unsigned NOT NULL,
    added_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    KEY project_id (project_id),
    KEY domain (domain),
    KEY is_trusted (is_trusted),
    KEY source_type (source_type),
    KEY origin (origin),
    KEY ability_id (ability_id),
    KEY added_at (added_at),
    UNIQUE KEY project_source (project_id, source_id)
);
```

`source_id` is derived from the card, not random: a truncated SHA-1 over the
project id, the producing `ability_id` (null for a manually added source), and
either the URL or — for generated content that has none — the title plus body.
That makes `project_source` the deduplication mechanism, so re-running an
assistant lands on the rows it created last time instead of inserting a second
set. Existing rows are never refreshed on a re-run, because notes and pin state
are keyed on `source_id`. Uploaded documents are the one exception and keep a
random id; see `IdeationSourcesController::upload_source()` for why.

### `wp_vip_ideation_analyses`
AI analysis outputs for ideation projects (summaries, comparisons, seed analysis).

```sql
CREATE TABLE wp_vip_ideation_analyses (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    project_id bigint(20) unsigned NOT NULL,
    tool_type varchar(50) NOT NULL,
    query text,
    source_ids text,
    result longtext NOT NULL,                      -- JSON
    tokens_used int(10) unsigned DEFAULT NULL,
    created_by bigint(20) unsigned NOT NULL,
    created_at datetime NOT NULL,
    KEY project_id (project_id),
    KEY tool_type (tool_type),
    KEY created_at (created_at)
);
```

---

## Story Tables

### `wp_vip_story_objects`
Join table linking stories to their constituent objects (posts, assets).

```sql
CREATE TABLE wp_vip_story_objects (
    story_id bigint(20) unsigned NOT NULL,
    object_id bigint(20) unsigned NOT NULL,
    object_type varchar(20) NOT NULL,
    added_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (story_id, object_id),
    KEY object_lookup (object_id),
    KEY story_type (story_id, object_type)
);
```

---

## AI Agent Table

### `wp_vip_ai_agent_conversations`
Chat history per user per post/context.

> **Owned by the `vip-ai-agent` extension plugin** (extracted from core
> 2026-07-09). The plugin creates this table on activation via `dbDelta` and
> core no longer manages or drops it. The definition below is unchanged.

```sql
CREATE TABLE wp_vip_ai_agent_conversations (
    id bigint(20) unsigned AUTO_INCREMENT PRIMARY KEY,
    post_id bigint(20) unsigned DEFAULT NULL,
    user_id bigint(20) unsigned NOT NULL,
    title varchar(255) NOT NULL DEFAULT '',
    messages longtext NOT NULL,                    -- JSON array of messages
    context_type varchar(50) NOT NULL DEFAULT 'post',
    is_private tinyint(1) NOT NULL DEFAULT 0,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    KEY post_id (post_id),
    KEY user_id (user_id),
    KEY context_type (context_type),
    KEY updated_at (updated_at)
);
```

---

## Post Meta Keys

Stored in `wp_postmeta`:

| Meta Key | Type | Purpose |
|----------|------|---------|
| `_vip_workflow_sequence_id` | integer | Which sequence this post follows |
| `_vip_workflow_current_stage_key` | string | Current workflow stage (unprefixed) |
| `_vip_workflow_assigned_to` | integer | Assigned user ID |
| `_vip_workflow_assigned_desk` | integer | Assigned desk ID |
| `_vip_workflow_sla_deadline` | datetime | SLA deadline for current status |
| `_vip_workflow_transition_data` | array | Per-status transition history (serialized) |
| `wfp_{note_id}_{slug}` | mixed | Transition input notes (dynamic keys from sequence config) |
| `_vip_asset_analysis` | array | AI analysis results (serialized) |
| `_vip_asset_attached_to` | array | Object IDs this asset is attached to (serialized) |
| `_vip_ideation_asst_{id}` | array | Per-assistant execution state for ideation projects |
