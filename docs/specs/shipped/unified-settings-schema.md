---
status: shipped
version: 1.0
last_updated: 2026-04-22
related: [phase-sequence, extensible-research-agents, story-discovery]
---

# Unified Settings Schema

## Problem

Four different patterns exist for plugin-configurable settings:

- **Tools** (built-in + most extensions): Settings hidden inside `input_schema` properties (any field with a `default`). Custom rendering in `ToolsSettings.js`. Saved to `vip_workflow_ability_settings[id].options`.
- **Assistants/Discovery**: `meta.settings_schema`. Rendered by `SchemaSettings.js`. Saved via dual-write to `vip_workflow_ability_settings` + `vip_discovery_provider_{slug}`.
- **Channels**: `get_settings_schema()` PHP method. Rendered by `SchemaSettings.js` (when schema present) or hardcoded UI (email/slack). Saved to `vip_workflow_channel_{id}`.
- **Editorial Alignment** (extension): Previously owned a private `workflow_editorial_alignment_settings` option and custom `class-settings-page.php`; current Guidelines work removes that rule store so the checker reads Gutenberg/Core Guidelines instead.

This also exposes a **pre-existing bug**: when tools run during transitions (workflow or phase), only `post_id`/`project_id` is passed as input. Saved settings like `min_words: 500` are never merged into `$input`, so tools fall back to hardcoded defaults. Moving settings out of `input_schema` and into `AbilitySettings::get_options()` fixes this.

## Unified Format

All plugin types define settings as `settings_schema`, an object map of `key => field_definition`:

```php
'settings_schema' => [
    'min_words' => [
        'type'        => 'integer',
        'default'     => 300,
        'label'       => 'Minimum word count',
        'description' => 'Articles below this count will flag.',
        'minimum'     => 50,
        'maximum'     => 5000,
        'enforceable' => true,   // shows soft/hard pill
    ],
    'check_meta' => [
        'type'        => 'boolean',
        'default'     => true,
        'label'       => 'Check meta description',
        'enforceable' => true,
    ],
    'prompt' => [
        'type'    => 'string',
        'default' => 'Analyze this content...',
        'label'   => 'Prompt template',
        // no 'enforceable' = no soft/hard pill
    ],
]
```

Field properties (superset of what exists today):
- `type` (string, integer, number, boolean) -- required
- `label` -- display name
- `description` -- help text
- `default` -- default value
- `required` -- field is required (used by assistants for API keys)
- `secret` -- render as password input
- `enum` -- array of allowed values (renders SelectControl)
- `minimum` / `maximum` -- for numeric fields
- `enforceable` -- boolean, if `true` renders soft/hard check mode pill alongside the field

## Custom React Override

Plugins can bypass schema-driven rendering entirely by injecting custom React components via JS filters. This takes precedence over auto-rendered settings.

For tools: `vip_workflow_tool_settings_{slug}` filter.

Use cases: the checklist tool (complex list editor), or any plugin needing UI that cannot be expressed as simple form fields.

## Changes

### 1. Enhance `SchemaSettings.js`

Currently renders: ToggleControl (boolean), SelectControl (enum), TextControl (string/number), password (secret). Already supports `minimum`/`maximum` on number inputs. Used by assistants and channels.

**Add:**
- Accept optional `checkModes` prop (object: `{ key: 'soft'|'hard' }`)
- Accept optional `onCheckModeChange` prop (callback: `(key, mode) => void`)
- For fields with `enforceable: true`, render the `CheckModePill` component (extracted from `ToolsSettings.js`) alongside the field control
- Support multiline detection for string fields (same logic as current `ToolsSettings.js`: key is `prompt` or default contains `\n`)

### 2. Backend: expose `settings_schema` on tool ability responses

In [`class-tools-controller.php`](../../../vip-workflows/includes/api/class-tools-controller.php), expose `settings_schema` from `$meta['settings_schema']` on each response item.

### 3. Move built-in tool settings from `input_schema` to `meta.settings_schema`

**Files to change:**

- [`readability.php`](../../../vip-workflows/includes/abilities/tools/readability.php) -- move `target_grade` (integer, default 8, enforceable)
- [`seo-check.php`](../../../vip-workflows/includes/abilities/tools/seo-check.php) -- move `min_words` (integer, default 300, enforceable), `min_paragraphs` (integer, default 3, enforceable), `min_images` (integer, default 1, enforceable), `check_meta` (boolean, default true, enforceable)
- [`keyword-check.php`](../../../vip-workflows/includes/abilities/tools/keyword-check.php) -- move `flagged_words` (string, default ''), `case_sensitive` (boolean, default false), `match_partial` (boolean, default false)
- The built-in AI agent -- move its model selection from execution input to the settings schema.

Each tool's `execute()` callback changes from `$input['key'] ?? default` to reading from `AbilitySettings::get_options()`. This fixes the transition-time bug where saved settings were ignored.

### 4. Move extension tool settings to `meta.settings_schema`

- [`workflow-tool-checklist`](../../../workflow-tool-checklist/) keeps its complex checklist-item settings through a JavaScript filter.
- Extension tools use the same settings schema for their own scalar options.

### 5. Update `ToolsSettings.js`

Replace `renderOptionsGroups()` (which reads from `localAbility.schema.properties`) with `SchemaSettings` usage reading from `localAbility.settings_schema`. Pass `checkModes` and `onCheckModeChange` props. Extract `CheckModePill` to a shared location. Remove the duplicated rendering logic for numbers, booleans, enums, strings, and textareas.

### 6. Channels: already consistent (document only)

Channels that override `get_settings_schema()` already use `SchemaSettings.js`. Email and Slack have hardcoded UI (acceptable since they're built-in). The ntfy extension uses a JS filter. No code changes needed here, just ensure the schema format documentation covers `enforceable` (channels won't use it since they have no check modes).

### 7. Update skill docs

- [`vip-workflows/skills/create-tool/SKILL.md`](../../../vip-workflows/skills/create-tool/SKILL.md) -- show `meta.settings_schema` instead of `input_schema` defaults
- Update the "How to Add Custom Tools" modal in `ToolsSettings.js`

### 8. Update reference docs

- [`docs/reference/architecture.md`](../../reference/architecture.md) -- document unified settings pattern
- [`docs/reference/quick-reference.md`](../../reference/quick-reference.md) -- add `settings_schema` to known patterns
- [`docs/guides/extending-vip-workflows.md`](../../guides/extending-vip-workflows.md) -- update settings section

## Migration summary

```
BEFORE                                       AFTER
------                                       -----
Tools:       input_schema + default          meta.settings_schema
Assists:     meta.settings_schema            meta.settings_schema (no change)
Channels:    get_settings_schema()           get_settings_schema() (no change)
Edit-Align:  get_option() + custom page      meta.settings_schema + AbilitySettings
AI Agent:    input_schema + default          meta.settings_schema

Tools:       $input['key'] ?? default        AbilitySettings::get_options()
Assists:     AbilitySettings::get_options()  (no change)
Edit-Align:  get_option('workflow_...')       AbilitySettings::get_options()
AI Agent:    $input['model'] ?? 'gpt-4o'     AbilitySettings::get_options()

Tools:       renderOptionsGroups()           SchemaSettings + checkModes
Assists:     SchemaSettings                  SchemaSettings (no change)
Channels:    SchemaSettings                  SchemaSettings (no change)
Edit-Align:  custom settings page            SchemaSettings (simple) + JS filter (rules)
```
